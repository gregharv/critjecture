import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { organizations } from "@/lib/legacy-app-schema";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

const execFileAsync = promisify(execFile);

describe("hosted provisioning script", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("refuses to create a second hosted organization in the same deployment cell", async () => {
    const environment = await createTestAppEnvironment({
      deploymentMode: "hosted",
      organizationSlug: "acme",
    });

    try {
      await getAppDatabase();

      const scriptPath = path.join(process.cwd(), "scripts/provision-hosted-org.mjs");
      const commandEnv = {
        ...process.env,
        DATABASE_URL: environment.databaseFilePath,
        CRITJECTURE_DEPLOYMENT_MODE: "hosted",
        CRITJECTURE_HOSTED_ORGANIZATION_SLUG: "acme",
        CRITJECTURE_STORAGE_ROOT: environment.storageRoot,
      };

      const firstRun = await execFileAsync(
        "node",
        [
          scriptPath,
          "--organization-name",
          "Acme",
          "--organization-slug",
          "acme",
          "--owner-email",
          "owner@acme.test",
          "--owner-password",
          "owner-password",
        ],
        {
          cwd: process.cwd(),
          env: commandEnv,
        },
      );

      expect(firstRun).toBeTruthy();

      const db = await getAppDatabase();
      const organizationsInDb = await db.select().from(organizations);

      expect(organizationsInDb).toHaveLength(1);
      expect(organizationsInDb[0]?.slug).toBe("acme");

      await expect(
        execFileAsync(
          "node",
          [
            scriptPath,
            "--organization-name",
            "Other Org",
            "--organization-slug",
            "other-org",
            "--owner-email",
            "owner@other.test",
            "--owner-password",
            "owner-password",
          ],
          {
            cwd: process.cwd(),
            env: commandEnv,
          },
        ),
      ).rejects.toBeTruthy();

      const organizationsAfterRetry = await db.select().from(organizations);

      expect(organizationsAfterRetry).toHaveLength(1);
    } finally {
      await environment.cleanup();
    }
  });
});
