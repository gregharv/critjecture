import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/chat");
}

test("owner can load history and open owner admin pages", async ({ page }) => {
  await page.route("**/api/conversations*", async (route) => {
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

  await page.route("**/api/workflows", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        body: JSON.stringify({
          workflow: {
            workflow: {
              id: "wf-1",
              name: "Budget review workflow",
            },
          },
        }),
        contentType: "application/json",
        status: 201,
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        workflows: [
          {
            createdAt: Date.now() - 10_000,
            currentVersionId: "wf-v1",
            currentVersionNumber: 1,
            description: "Weekly budget checks",
            id: "wf-1",
            lastRunAt: Date.now() - 5_000,
            name: "Budget review workflow",
            nextRunAt: null,
            status: "active",
            updatedAt: Date.now() - 1_000,
            visibility: "organization",
          },
        ],
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/workflows/wf-1", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        workflow: {
          currentVersion: {
            contracts: {
              delivery: {
                channels: [],
              },
              inputContract: {
                inputs: [],
              },
              recipe: {
                steps: [],
              },
            },
            createdAt: Date.now() - 10_000,
            id: "wf-v1",
            versionNumber: 1,
          },
          versions: [
            {
              createdAt: Date.now() - 10_000,
              id: "wf-v1",
              versionNumber: 1,
            },
          ],
          workflow: {
            createdAt: Date.now() - 10_000,
            currentVersionId: "wf-v1",
            currentVersionNumber: 1,
            description: "Weekly budget checks",
            id: "wf-1",
            lastRunAt: Date.now() - 5_000,
            name: "Budget review workflow",
            nextRunAt: null,
            status: "active",
            updatedAt: Date.now() - 1_000,
            visibility: "organization",
          },
        },
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/workflows/wf-1/runs?limit=100", async (route) => {
    const now = Date.now();

    await route.fulfill({
      body: JSON.stringify({
        runs: [
          {
            completedAt: now - 500,
            createdAt: now - 2_000,
            failureReason: null,
            id: "run-1",
            metadata: {},
            runAsRole: "owner",
            runAsUserId: "user-1",
            startedAt: now - 1_500,
            status: "completed",
            triggerKind: "manual",
            workflowVersionId: "wf-v1",
            workflowVersionNumber: 1,
          },
        ],
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/workflow-runs/run-1", async (route) => {
    const now = Date.now();

    await route.fulfill({
      body: JSON.stringify({
        alerts: [],
        changeSummary: {
          artifactCountDelta: 0,
          comparedToRunId: null,
          inputKeysAdded: [],
          inputKeysChanged: [],
          inputKeysRemoved: [],
          inputKeysUnchanged: [],
          statusChanged: false,
          workflowVersionChanged: false,
        },
        deliveries: [],
        inputChecks: [],
        inputRequests: [],
        previousRun: null,
        run: {
          completedAt: now - 500,
          createdAt: now - 2_000,
          failureReason: null,
          id: "run-1",
          metadata: {},
          runAsRole: "owner",
          runAsUserId: "user-1",
          startedAt: now - 1_500,
          status: "completed",
          triggerKind: "manual",
          workflowVersionId: "wf-v1",
          workflowVersionNumber: 1,
        },
        steps: [],
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
          persistence: {
            backupBeforeSchemaChanges: true,
            backupCadenceHours: 24,
            databasePath: "/tmp/critjecture-test.db",
            deploymentMode: "hosted",
            engine: "sqlite",
            journalMode: "wal",
            requestModel: "synchronous_requests_only",
            restoreDrillCadence: "before_first_cutover_and_quarterly",
            sandboxConcurrency: {
              globalActiveRuns: 4,
              perUserActiveRuns: 2,
            },
            storageRoot: "/tmp/critjecture-storage",
            targetRpoHours: 24,
            targetRtoHours: 2,
            topology: "single_writer_dedicated_hosted_cell",
            writableAppInstances: 1,
          },
          sandbox: {
            abandonedRuns: 0,
            activeRuns: 0,
            authMode: "bearer",
            available: true,
            backend: "hosted_supervisor",
            boundOrganizationSlug: "critjecture-test-org",
            detail: "Sandbox available",
            lastHeartbeatAt: Date.now(),
            lastReconciledAt: Date.now(),
            queuedRuns: 0,
            rejectedRuns: 0,
            runner: "supervisor",
            staleRuns: 0,
          },
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
          workflow: {
            rateLimits: [],
          },
        },
        rateLimitActivity: [],
        recentFailures: [],
        routeMetrics: [],
        workspace: {
          currentWindowEndAt: Date.now() + 24 * 60 * 60 * 1000,
          currentWindowStartAt: Date.now() - 24 * 60 * 60 * 1000,
          exhausted: false,
          hardCapBehavior: "block",
          monthlyIncludedCredits: 500,
          pendingCredits: 0,
          planCode: "flat-smb",
          planName: "Flat SMB",
          rateCard: {
            analysis: 8,
            chart: 10,
            chat: 1,
            document: 12,
            import: 3,
          },
          remainingCredits: 500,
          resetAt: Date.now() + 24 * 60 * 60 * 1000,
          usedCredits: 0,
        },
        workflow: {
          activeWorkflowCount: 1,
          deliveryFailedCount: 0,
          maxActiveWorkflows: 10,
          maxScheduledRunsPerWindow: 20,
          runsCompleted: 1,
          runsFailed: 0,
          runsTotal: 1,
          runsWaitingForInput: 0,
          scheduledRunsPerWindowEstimate: 0,
        },
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
            capabilitySummary: ["Owner", "Can manage workspace settings"],
            createdAt: Date.now(),
            email: "owner@example.com",
            id: "user-1",
            monthlyCreditCap: null,
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

  await login(page, "owner@example.com", "owner-password");

  await page.getByRole("button", { name: /Budget review/ }).first().click();
  await expect(page.getByText("Budget review").first()).toBeVisible();

  await page.locator(".shell-menu__summary").click();
  await page.getByRole("link", { name: "Workflows" }).click();
  await expect(page.getByRole("heading", { name: "Saved workflows and execution history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Budget review workflow" })).toBeVisible();

  await page.locator(".shell-menu__summary").click();
  await page.getByRole("link", { name: "Audit Logs" }).click();
  await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();

  await page.locator(".shell-menu__summary").click();
  await page.getByRole("link", { name: "Operations" }).click();
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();

  await page.locator(".shell-menu__summary").click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings and Governance" })).toBeVisible();
});

test("opening an existing analysis conversation from chat restores workspace mode", async ({ page }) => {
  await page.route("**/api/conversations*", async (route) => {
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

  await page.route("**/api/analysis/workspaces/conversation-1", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        latestRevision: {
          createdAt: Date.now(),
          htmlExportPath: "outputs/notebook.html",
          id: "revision-1",
          notebookPath: "analysis_workspaces/workspace-1/revisions/1/notebook.py",
          notebookSource: "import marimo",
          revisionNumber: 1,
          sandboxRunId: "run-1",
          status: "completed",
          structuredResultPath: null,
          summary: "Done",
          turnId: "turn-1",
          workspaceId: "workspace-1",
        },
        workspace: {
          conversationId: "conversation-1",
          createdAt: Date.now(),
          id: "workspace-1",
          latestRevisionId: "revision-1",
          latestSandboxRunId: "run-1",
          organizationId: "org-1",
          status: "completed",
          title: "Budget review",
          updatedAt: Date.now(),
          userId: "user-1",
        },
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/analysis/workspaces/conversation-1/preview", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        expiresAt: Date.now() + 15 * 60 * 1000,
        fallbackHtmlUrl: "/api/generated-files/run-1/outputs/notebook.html",
        port: 27123,
        proxyUrl: "/api/analysis/workspaces/conversation-1/preview/proxy/?token=preview-token",
        revisionId: "revision-1",
        sessionId: "session-1",
        workspaceId: "workspace-1",
      }),
      contentType: "application/json",
    });
  });

  await page.route("**/api/analysis/workspaces/conversation-1/preview/proxy/?token=*", async (route) => {
    await route.fulfill({
      body: "<html><body>preview</body></html>",
      contentType: "text/html",
    });
  });

  await page.route("**/api/analysis/workspaces/conversation-1/preview/proxy/**", async (route) => {
    await route.fulfill({
      body: "<html><body>preview</body></html>",
      contentType: "text/html",
    });
  });

  await login(page, "owner@example.com", "owner-password");

  await page.getByRole("button", { name: /Budget review/ }).first().click();
  await page.waitForURL("**/analysis/conversation-1");
  await expect(page.getByRole("link", { name: "Back to chats" })).toBeVisible();
  await expect(page.getByRole("button", { name: "History" })).toHaveCount(0);
});

test("intern is redirected away from owner admin pages", async ({ page }) => {
  await login(page, "intern@example.com", "intern-password");

  await page.goto("/admin/logs");
  await page.waitForURL("**/chat");
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Audit Logs" })).toHaveCount(0);
});
