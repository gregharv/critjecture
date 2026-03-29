import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/chat");
}

test("owner can load history and open owner admin pages", async ({ page }) => {
  await login(page, "owner@example.com", "owner-password");

  await page.route("**/api/conversations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        conversations: [
          {
            createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
            id: "conversation-1",
            lastModified: new Date().toISOString(),
            messageCount: 2,
            preview: "Budget review preview",
            thinkingLevel: "medium",
            title: "Budget review",
            usage: {
              cacheRead: 0,
              cacheWrite: 0,
              cost: {
                cacheRead: 0,
                cacheWrite: 0,
                input: 0.001,
                output: 0.002,
                total: 0.003,
              },
              input: 10,
              output: 20,
              totalTokens: 30,
            },
          },
        ],
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/conversations/conversation-1", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        conversation: {
          createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
          id: "conversation-1",
          lastModified: new Date().toISOString(),
          messages: [],
          model: {
            api: "openai",
            id: "gpt-5.4-mini",
            name: "GPT-5.4 Mini",
            provider: "openai",
          },
          thinkingLevel: "medium",
          title: "Budget review",
        },
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/admin/logs?limit=50", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ turns: [] }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/admin/operations/summary?window=24h", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        alerts: [],
        health: {
          checks: [],
          status: "ok",
          timestamp: new Date().toISOString(),
        },
        policies: {
          budgets: {
            dailyModelCostCapUsdOrganization: 25,
            dailyModelCostCapUsdUser: 5,
            dailySandboxRunCapOrganization: 100,
            dailySandboxRunCapUser: 25,
            warningRatio: 0.8,
          },
          chat: {
            maxTokensHardCap: 4000,
            rateLimits: [],
          },
          knowledgeImport: {
            rateLimits: [],
          },
          knowledgeUpload: {
            rateLimits: [],
          },
          sandbox: {
            rateLimits: [],
          },
          search: {
            rateLimits: [],
          },
        },
        rateLimitActivity: [],
        recentFailures: [],
        routeMetrics: [],
        usageSummary: {
          byEventType: [],
          byRouteGroup: [],
          byUser: [],
          window: "24h",
        },
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/admin/organization", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        organization: {
          id: "org-1",
          name: "Critjecture Test Org",
          slug: "critjecture-test-org",
        },
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/admin/members", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        members: [
          {
            createdAt: Date.now(),
            email: "owner@example.com",
            id: "user-1",
            name: "Owner User",
            role: "owner",
            status: "active",
            updatedAt: Date.now(),
          },
        ],
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/admin/compliance-settings", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        settings: {
          alertRetentionDays: 30,
          chatHistoryRetentionDays: null,
          exportArtifactRetentionDays: 7,
          knowledgeImportRetentionDays: null,
          requestLogRetentionDays: 30,
          updatedAt: Date.now(),
          updatedByUserEmail: "owner@example.com",
          usageRetentionDays: 30,
        },
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/admin/governance-jobs", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ jobs: [] }),
      contentType: "application/json",
    });
  });

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("dialog", { name: "Conversation history" })).toBeVisible();
  await page.getByRole("button", { name: "Budget review" }).click();
  await expect(page.getByText("Budget review").first()).toBeVisible();

  await page.getByRole("link", { name: "Audit Logs" }).click();
  await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();

  await page.getByRole("link", { name: "Operations" }).click();
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings and Governance" })).toBeVisible();
  await expect(page.getByText("owner@example.com", { exact: true }).last()).toBeVisible();
});

test("intern is redirected away from owner admin pages", async ({ page }) => {
  await login(page, "intern@example.com", "intern-password");

  await page.goto("/admin/logs");
  await page.waitForURL("**/chat");
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Audit Logs" })).toHaveCount(0);
});
