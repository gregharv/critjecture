import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3101";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3101",
    cwd: __dirname,
    env: {
      CRITJECTURE_DEPLOYMENT_MODE: "single_org",
      CRITJECTURE_INTERN_EMAIL: "intern@example.com",
      CRITJECTURE_INTERN_NAME: "Intern User",
      CRITJECTURE_INTERN_PASSWORD: "intern-password",
      CRITJECTURE_ORGANIZATION_NAME: "Critjecture Test Org",
      CRITJECTURE_ORGANIZATION_SLUG: "critjecture-test-org",
      CRITJECTURE_OWNER_EMAIL: "owner@example.com",
      CRITJECTURE_OWNER_NAME: "Owner User",
      CRITJECTURE_OWNER_PASSWORD: "owner-password",
      CRITJECTURE_STORAGE_ROOT: "./.playwright-storage",
      CRITJECTURE_LEGACY_DATABASE_URL: "./.playwright-storage/critjecture.sqlite",
      CRITJECTURE_V2_DATABASE_URL: "./.playwright-storage/critjecture-v2.sqlite",
      AUTH_SECRET: "playwright-test-secret",
      DATABASE_URL: "./.playwright-storage/critjecture-v2.sqlite",
      NODE_ENV: "test",
      OPENAI_API_KEY: "test-openai-key",
    },
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
    url: baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
