import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOrganizationMember } from "@/lib/admin-users";
import { getAppDatabase } from "@/lib/legacy-app-db";
import { organizations, operationalAlerts } from "@/lib/legacy-app-schema";
import { getHostedDeploymentValidation } from "@/lib/hosted-deployment";
import {
  getHealthSummary,
  getOperationsSummary,
  runOperationsMaintenance,
} from "@/lib/operations";
import { createOrganization } from "@/lib/organizations";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("hosted deployment hardening", () => {
  afterEach(async () => {
    await resetTestAppState();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails hosted validation when the bound organization slug is missing", async () => {
    const environment = await createTestAppEnvironment({
      deploymentMode: "hosted",
      organizationSlug: "acme",
    });

    try {
      delete process.env.CRITJECTURE_HOSTED_ORGANIZATION_SLUG;

      await expect(getHostedDeploymentValidation()).resolves.toMatchObject({
        code: "missing_binding",
        valid: false,
      });

      const health = await getHealthSummary();

      expect(health.checks.find((check) => check.name === "hosted-deployment")).toMatchObject({
        status: "fail",
      });
    } finally {
      await environment.cleanup();
    }
  });

  it("authenticates only against the bound hosted organization", async () => {
    const environment = await createTestAppEnvironment({
      deploymentMode: "hosted",
      organizationSlug: "acme",
    });

    try {
      const organization = await createOrganization({
        name: "Acme",
        slug: "acme",
      });
      await createOrganizationMember({
        email: "owner@acme.test",
        name: "Acme Owner",
        organizationId: organization.id,
        password: "owner-password",
        role: "owner",
      });

      await expect(getAuthenticatedUserByEmail("owner@acme.test")).resolves.toMatchObject({
        organizationSlug: "acme",
      });

      const db = await getAppDatabase();
      await db.insert(organizations).values({
        createdAt: Date.now(),
        id: randomUUID(),
        name: "Other Org",
        slug: "other-org",
        updatedAt: Date.now(),
      });

      await expect(getHostedDeploymentValidation()).resolves.toMatchObject({
        code: "multiple_organizations",
        valid: false,
      });
      await expect(getAuthenticatedUserByEmail("owner@acme.test")).resolves.toBeNull();
    } finally {
      await environment.cleanup();
    }
  });

  it("opens a hosted binding alert when the deployment contains multiple organizations", async () => {
    const environment = await createTestAppEnvironment({
      deploymentMode: "hosted",
      organizationSlug: "acme",
    });

    try {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            authMode: "signed",
            available: true,
            boundOrganizationSlug: "acme",
            detail: "Hosted supervisor is reachable.",
            runner: "oci-container",
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      process.env.CRITJECTURE_SANDBOX_SUPERVISOR_URL = "http://127.0.0.1:4100";
      process.env.CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID = "hosted-app";
      process.env.CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET = "super-secret";

      const organization = await createOrganization({
        name: "Acme",
        slug: "acme",
      });
      const db = await getAppDatabase();
      await db.insert(organizations).values({
        createdAt: Date.now() + 1,
        id: randomUUID(),
        name: "Other Org",
        slug: "other-org",
        updatedAt: Date.now() + 1,
      });

      await runOperationsMaintenance();

      const summary = await getOperationsSummary({
        organizationId: organization.id,
        windowParam: "24h",
      });
      const dbAlerts = await db.select().from(operationalAlerts);

      expect(summary.alerts.some((alert) => alert.alertType === "hosted-organization-binding-mismatch")).toBe(true);
      expect(dbAlerts.some((alert) => alert.alertType === "hosted-organization-binding-mismatch")).toBe(true);
    } finally {
      await environment.cleanup();
    }
  });

  it("surfaces the hosted SQLite persistence envelope in health", async () => {
    const environment = await createTestAppEnvironment({
      deploymentMode: "hosted",
      organizationSlug: "acme",
    });

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              authMode: "signed",
              available: true,
              boundOrganizationSlug: "acme",
              detail: "Hosted supervisor is reachable.",
              runner: "oci-container",
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
              status: 200,
            },
          ),
        ),
      );
      process.env.CRITJECTURE_SANDBOX_SUPERVISOR_URL = "http://127.0.0.1:4100";
      process.env.CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID = "hosted-app";
      process.env.CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET = "super-secret";

      const health = await getHealthSummary();

      expect(health.persistence).toMatchObject({
        backupCadenceHours: 24,
        backupBeforeSchemaChanges: true,
        deploymentMode: "hosted",
        engine: "sqlite",
        journalMode: "wal",
        requestModel: "synchronous_requests_only",
        restoreDrillCadence: "before_first_cutover_and_quarterly",
        targetRpoHours: 24,
        targetRtoHours: 2,
        topology: "single_writer_dedicated_hosted_cell",
        writableAppInstances: 1,
      });
      expect(health.persistence.sandboxConcurrency).toMatchObject({
        globalActiveRuns: 4,
        perUserActiveRuns: 1,
      });
      expect(health.persistence.databasePath).toContain("critjecture-v2.sqlite");
      expect(health.persistence.storageRoot).toContain(environment.storageRoot);
      expect(health.checks.find((check) => check.name === "persistence")).toMatchObject({
        status: "ok",
      });
    } finally {
      await environment.cleanup();
    }
  });
});
