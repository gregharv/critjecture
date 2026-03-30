import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resetOperationsMaintenanceStateForTests } from "@/lib/operations";
import { resetAppDatabaseForTests } from "@/lib/app-db";
import { resetUserSeedStateForTests } from "@/lib/users";

type TestUserConfig = {
  email: string;
  name: string;
  password: string;
};

type TestAppEnvironmentOptions = {
  deploymentMode?: "hosted" | "single_org";
  intern?: TestUserConfig;
  openAiApiKey?: string;
  organizationName?: string;
  organizationSlug?: string;
  owner?: TestUserConfig;
};

type TestAppEnvironment = {
  cleanup: () => Promise<void>;
  databaseFilePath: string;
  rootDir: string;
  storageRoot: string;
};

const DEFAULT_OWNER: TestUserConfig = {
  email: "owner@example.com",
  name: "Owner User",
  password: "owner-password",
};

const DEFAULT_INTERN: TestUserConfig = {
  email: "intern@example.com",
  name: "Intern User",
  password: "intern-password",
};

const ENV_KEYS = [
  "CRITJECTURE_DEPLOYMENT_MODE",
  "CRITJECTURE_INTERN_EMAIL",
  "CRITJECTURE_INTERN_NAME",
  "CRITJECTURE_INTERN_PASSWORD",
  "CRITJECTURE_HOSTED_ORGANIZATION_SLUG",
  "CRITJECTURE_ORGANIZATION_NAME",
  "CRITJECTURE_ORGANIZATION_SLUG",
  "CRITJECTURE_OWNER_EMAIL",
  "CRITJECTURE_OWNER_NAME",
  "CRITJECTURE_OWNER_PASSWORD",
  "CRITJECTURE_SANDBOX_CONTAINER_IMAGE",
  "CRITJECTURE_SANDBOX_EXECUTION_BACKEND",
  "CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET",
  "CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID",
  "CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN",
  "CRITJECTURE_SANDBOX_SUPERVISOR_URL",
  "CRITJECTURE_STORAGE_ROOT",
  "DATABASE_URL",
  "OPENAI_API_KEY",
] as const;

export async function resetTestAppState() {
  resetOperationsMaintenanceStateForTests();
  resetUserSeedStateForTests();
  await resetAppDatabaseForTests();
}

function setEnvValue(key: string, value: string | undefined) {
  if (typeof value === "undefined") {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

export async function createTestAppEnvironment(
  options: TestAppEnvironmentOptions = {},
): Promise<TestAppEnvironment> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "critjecture-test-"));
  const storageRoot = path.join(rootDir, "storage");
  const databaseFilePath = path.join(rootDir, "critjecture.sqlite");
  const previousEnv = new Map<string, string | undefined>(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const owner = options.owner ?? DEFAULT_OWNER;
  const intern = options.intern ?? DEFAULT_INTERN;

  setEnvValue("CRITJECTURE_DEPLOYMENT_MODE", options.deploymentMode ?? "single_org");
  setEnvValue("CRITJECTURE_ORGANIZATION_NAME", options.organizationName ?? "Critjecture Test Org");
  setEnvValue("CRITJECTURE_ORGANIZATION_SLUG", options.organizationSlug ?? "critjecture-test-org");
  setEnvValue(
    "CRITJECTURE_HOSTED_ORGANIZATION_SLUG",
    options.deploymentMode === "hosted" ? options.organizationSlug ?? "critjecture-test-org" : undefined,
  );
  setEnvValue("CRITJECTURE_OWNER_EMAIL", owner.email);
  setEnvValue("CRITJECTURE_OWNER_NAME", owner.name);
  setEnvValue("CRITJECTURE_OWNER_PASSWORD", owner.password);
  setEnvValue("CRITJECTURE_INTERN_EMAIL", intern.email);
  setEnvValue("CRITJECTURE_INTERN_NAME", intern.name);
  setEnvValue("CRITJECTURE_INTERN_PASSWORD", intern.password);
  setEnvValue("CRITJECTURE_STORAGE_ROOT", storageRoot);
  setEnvValue("DATABASE_URL", databaseFilePath);
  setEnvValue("OPENAI_API_KEY", options.openAiApiKey ?? "test-openai-key");

  await resetTestAppState();

  return {
    async cleanup() {
      await resetTestAppState();

      for (const [key, value] of previousEnv) {
        setEnvValue(key, value);
      }

      await rm(rootDir, { force: true, recursive: true });
    },
    databaseFilePath,
    rootDir,
    storageRoot,
  };
}
