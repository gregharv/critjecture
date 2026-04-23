import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/chat$/);
}

async function sendChatMessage(page: Page, message: string) {
  const composer = page.getByPlaceholder("Type a message...");
  await composer.fill(message);
  await composer.press("Enter");
}

test("chat triggers clarification questions and carries clarification state across follow-ups", async ({ page }) => {
  const capturedBodies: Array<Record<string, unknown>> = [];
  const savedConversationSnapshots: Array<Record<string, unknown>> = [];
  let clarificationRequestCount = 0;

  await page.route("**/api/conversations/*", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as { sessionData?: Record<string, unknown> };
      if (payload.sessionData) {
        savedConversationSnapshots.push(payload.sessionData);
      }
    }

    await route.fallback();
  });

  await page.route("**/api/analysis/intake", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    capturedBodies.push(payload);
    clarificationRequestCount += 1;

    if (clarificationRequestCount === 1) {
      await route.fulfill({
        body: JSON.stringify({
          clarificationState: {
            epistemicPosture: "data_limited",
          },
          decision: "ask_clarification",
          intent: {
            confidence: 0.63,
            intent_type: "unclear",
            is_causal: false,
            reason: "Need a little more context before choosing an analysis path.",
          },
          question:
            "Understood — you're focused on conversion. Do you want the first pass overall, or broken out by something like region, segment, or customer type?",
        }),
        contentType: "application/json",
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        clarificationState: {
          epistemicPosture: "data_limited",
        },
        decision: "ask_clarification",
        classification: {
          analysis_mode: "dataset_backed_analysis",
          confidence: 0.71,
          guardrail_flag: "none",
          reason: "Still need the main time window before analyzing.",
          required_rung: "rung_1_observational",
          task_form: "explain",
        },
        question: "Got it — we'll start at the overall level. What time period should we focus on for conversion?",
      }),
      contentType: "application/json",
    });
  });

  await login(page, "owner@example.com", "owner-password");
  await page.goto("/chat");
  await page.waitForLoadState("networkidle");

  await sendChatMessage(page, "Can you help me understand conversion?");

  await expect.poll(() => capturedBodies.length).toBe(1);
  await expect(page.locator(".chat-clarification-banner")).toBeVisible();
  await expect(page.locator(".chat-clarification-banner__eyebrow")).toContainText(
    /Checking data fit|Clarifying what the data can support|Aligning the question to the data/,
  );
  await expect(page.locator(".chat-clarification-banner__lead")).toContainText(
    /shaping it around what the data can support|the question fits the data we likely have|the available data can actually answer/,
  );
  await expect(
    page.locator(".chat-clarification-banner__question").getByText(
      "Understood — you're focused on conversion. Do you want the first pass overall, or broken out by something like region, segment, or customer type?",
    ),
  ).toBeVisible();
  await expect
    .poll(() => JSON.stringify(savedConversationSnapshots.at(-1) ?? {}))
    .toContain("Understood — you're focused on conversion. Do you want the first pass overall, or broken out by something like region, segment, or customer type?");

  await sendChatMessage(page, "overall first");

  await expect.poll(() => capturedBodies.length).toBe(2);
  await expect(
    page
      .locator(".chat-clarification-banner__question")
      .getByText("Got it — we'll start at the overall level. What time period should we focus on for conversion?"),
  ).toBeVisible();
  await expect
    .poll(() => JSON.stringify(savedConversationSnapshots.at(-1) ?? {}))
    .toContain("Got it — we'll start at the overall level. What time period should we focus on for conversion?");

  expect(capturedBodies).toHaveLength(2);
  expect(capturedBodies[0]).toMatchObject({
    clarificationState: null,
    message: "Can you help me understand conversion?",
  });
  expect(capturedBodies[1]).toMatchObject({
    clarificationState: {
      epistemicPosture: "data_limited",
    },
    message: "Can you help me understand conversion?\nI want to start at the overall level first.",
  });
});

test("chat triggers a clarification question for loaded mechanism requests", async ({ page }) => {
  const savedConversationSnapshots: Array<Record<string, unknown>> = [];

  await page.route("**/api/conversations/*", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as { sessionData?: Record<string, unknown> };
      if (payload.sessionData) {
        savedConversationSnapshots.push(payload.sessionData);
      }
    }

    await route.fallback();
  });

  await login(page, "owner@example.com", "owner-password");
  await page.goto("/chat");
  await page.waitForLoadState("networkidle");

  await sendChatMessage(
    page,
    `I have uploaded the following files for you to use: waterpressure.csv

I uploaded the file: waterpressure.csv

In our municipal infrastructure dataset, we have identified a robust, statistically significant negative correlation (r = -0.85) between localized water main pressure (PSI) and residential substation load (MW). As water pressure drops, electrical load reliably spikes. Assuming this telemetry is accurate, what are the specific electromechanical mechanisms or physical fluid-dynamics pathways where a loss of municipal water pressure forces residential electrical equipment to draw more amperage from the grid?`,
  );

  await expect(page.locator(".chat-clarification-banner")).toBeVisible();
  await expect(page.locator(".chat-clarification-banner__eyebrow")).not.toBeEmpty();
  await expect(page.locator(".chat-clarification-banner__lead")).not.toBeEmpty();
  await expect(
    page.locator(".chat-toolbar__title").getByText(/waterpressure\.csv/),
  ).toBeVisible();
  await expect
    .poll(() => JSON.stringify(savedConversationSnapshots.at(-1) ?? {}), { timeout: 10_000 })
    .toMatch(/shared driver|confounding pattern|direct-causation framing|omitted context|third factor|measurement artifact|alternative explanations|shared demand patterns|hypothesis to test|rather than assuming|directly causing/);
});

test("loaded mechanism clarification follow-ups stay in chat and render a reply", async ({ page }) => {
  let intakeCount = 0;
  let streamBody: Record<string, unknown> | null = null;
  const auditedAssistantMessages: Array<Record<string, unknown>> = [];

  await page.route("**/api/audit/assistant-messages", async (route) => {
    auditedAssistantMessages.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      body: JSON.stringify({ ok: true }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/analysis/intake", async (route) => {
    intakeCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        clarificationState: {
          clarificationKind: "presupposition_reframe",
          epistemicPosture: "guardrail",
        },
        decision: "ask_clarification",
        classification: {
          analysis_mode: "dataset_backed_analysis",
          confidence: 0.9,
          guardrail_flag: "unsupported_direct_mechanism",
          reason: "Loaded mechanism from observation.",
          required_rung: "rung_1_observational",
          task_form: "explain",
        },
        question:
          "Would you like me to treat the pressure-load relationship as a causal mechanism to explain, or first assess whether the correlation could be driven by a third factor or measurement artifact?",
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/stream", async (route) => {
    streamBody = route.request().postDataJSON() as Record<string, unknown>;

    const events = [
      'data: {"type":"start"}\n\n',
      'data: {"type":"text_start","contentIndex":0}\n\n',
      'data: {"type":"text_delta","contentIndex":0,"delta":"The pattern may be real, but correlation alone does not establish a direct mechanism."}\n\n',
      'data: {"type":"text_end","contentIndex":0}\n\n',
      'data: {"type":"done","reason":"stop","usage":{"cost":{"total":0,"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"input":0,"output":0,"totalTokens":0}}\n\n',
    ].join("");

    await route.fulfill({
      body: events,
      contentType: "text/event-stream",
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });

  await login(page, "owner@example.com", "owner-password");
  await page.goto("/chat");
  await page.waitForLoadState("networkidle");

  await sendChatMessage(
    page,
    `@public/uploads/2026/04/waterpressure.csv In our municipal infrastructure dataset, we have identified a robust, statistically significant negative correlation (r = -0.85) between localized water main pressure (PSI) and residential substation load (MW). As water pressure drops, electrical load reliably spikes. Assuming this telemetry is accurate, what are the specific electromechanical mechanisms or physical fluid-dynamics pathways where a loss of municipal water pressure forces residential electrical equipment to draw more amperage from the grid?`,
  );

  await expect(page.locator(".chat-clarification-banner")).toBeVisible();

  await sendChatMessage(page, "sure");

  await expect.poll(() => intakeCount).toBe(1);
  await expect.poll(() => streamBody !== null).toBe(true);
  await expect(page.locator(".chat-clarification-banner")).not.toBeVisible();
  await expect(page.locator("body")).toContainText("sure");
  await expect
    .poll(() => JSON.stringify(auditedAssistantMessages), { timeout: 10_000 })
    .toContain("The pattern may be real, but correlation alone does not establish a direct mechanism.");
  await expect(
    page.getByText("The pattern may be real, but correlation alone does not establish a direct mechanism."),
  ).toBeVisible();
  await expect
    .poll(() => JSON.stringify(streamBody), { timeout: 10_000 })
    .toContain("observational pattern alone does not establish a direct mechanism");
});
