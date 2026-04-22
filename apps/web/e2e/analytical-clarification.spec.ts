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

  await page.route("**/api/causal/intake", async (route) => {
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
        intent: {
          confidence: 0.71,
          intent_type: "unclear",
          is_causal: false,
          reason: "Still need the main time window before analyzing.",
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
  await expect(page.locator(".chat-clarification-banner__eyebrow")).toContainText(
    /Checking the causal framing|Pressure-testing the causal story|Checking causal assumptions/,
  );
  await expect(page.locator(".chat-clarification-banner__lead")).toContainText(
    /pressure-test the causal framing|check the causal framing before we run with it|not jumping from a pattern to a causal story too quickly/,
  );
  await expect(
    page.locator(".chat-toolbar__title").getByText(/waterpressure\.csv/),
  ).toBeVisible();
  await expect
    .poll(() => JSON.stringify(savedConversationSnapshots.at(-1) ?? {}), { timeout: 10_000 })
    .toMatch(/shared driver or confounding pattern|challenge the direct-causation framing|omitted context or a common driver/);
});
