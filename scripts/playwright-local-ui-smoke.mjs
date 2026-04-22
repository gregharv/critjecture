#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = path.resolve(__dirname, "..");
const artifactDirectory = path.join(repositoryRoot, ".artifacts");
const serverLogPath = path.join(artifactDirectory, "playwright-local-ui-smoke-server.log");

const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const configuredBaseUrlObject = new URL(configuredBaseURL);
const email =
  process.env.PLAYWRIGHT_EMAIL ?? process.env.CRITJECTURE_OWNER_EMAIL ?? "owner@example.com";
const password =
  process.env.PLAYWRIGHT_PASSWORD ?? process.env.CRITJECTURE_OWNER_PASSWORD ?? "owner-password";
const headless = process.env.HEADLESS !== "false";
const slowMo = Number(process.env.SLOW_MO ?? 0);
const allowWriteActions = process.env.PLAYWRIGHT_ALLOW_WRITE_ACTIONS === "true";
const signOutAtEnd = process.env.PLAYWRIGHT_SIGN_OUT_AT_END === "true";
const autoStartServer = process.env.PLAYWRIGHT_START_SERVER !== "false";
const serverCommand = process.env.PLAYWRIGHT_SERVER_COMMAND ?? "pnpm dev";
const serverCommandCwd = path.resolve(
  repositoryRoot,
  process.env.PLAYWRIGHT_SERVER_CWD ?? ".",
);
const defaultTimeoutMs = Number(process.env.PLAYWRIGHT_TIMEOUT_MS ?? 20_000);
const serverStartTimeoutMs = Number(process.env.PLAYWRIGHT_SERVER_TIMEOUT_MS ?? 120_000);
const serverProbeTimeoutMs = Number(process.env.PLAYWRIGHT_SERVER_PROBE_TIMEOUT_MS ?? 2_500);
const serverProbeIntervalMs = Number(process.env.PLAYWRIGHT_SERVER_PROBE_INTERVAL_MS ?? 1_000);
const isolatedStorageRoot = path.join(
  artifactDirectory,
  `playwright-local-ui-smoke-storage-${Date.now()}`,
);

let activeBaseURL = configuredBaseURL;

function logStep(message) {
  console.log(`[playwright-local-ui-smoke] ${message}`);
}

function buildBaseUrlCandidates(baseURL) {
  const candidates = [new URL(baseURL).toString()];
  const parsed = new URL(baseURL);

  if (parsed.hostname === "localhost") {
    parsed.hostname = "127.0.0.1";
    candidates.push(parsed.toString());
  } else if (parsed.hostname === "127.0.0.1") {
    parsed.hostname = "localhost";
    candidates.push(parsed.toString());
  }

  return [...new Set(candidates)];
}

function buildUrl(routePath) {
  return new URL(routePath, activeBaseURL).toString();
}

async function mkdirIfNeeded(targetPath) {
  await mkdir(targetPath, { recursive: true });
}

async function isVisible(locator, timeout = 2_500) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function expectVisible(locator, _description, timeout = defaultTimeoutMs) {
  await locator.first().waitFor({ state: "visible", timeout });
  return locator.first();
}

async function expectHeading(page, headingName) {
  return expectVisible(page.getByRole("heading", { name: headingName }), `heading: ${String(headingName)}`);
}

async function expectUrlPath(page, expectedPathPrefix) {
  await page.waitForURL(
    (currentUrl) =>
      currentUrl.pathname === expectedPathPrefix ||
      currentUrl.pathname.startsWith(`${expectedPathPrefix}/`),
    { timeout: defaultTimeoutMs },
  );
}

async function probeBaseURL(baseURL) {
  try {
    const response = await fetch(baseURL, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(serverProbeTimeoutMs),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function resolveReachableBaseURL() {
  const candidates = buildBaseUrlCandidates(configuredBaseURL);

  for (const candidate of candidates) {
    if (await probeBaseURL(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function waitForReachableBaseURL(timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const reachable = await resolveReachableBaseURL();
    if (reachable) {
      return reachable;
    }

    await new Promise((resolve) => setTimeout(resolve, serverProbeIntervalMs));
  }

  return null;
}

function terminateProcessTree(child) {
  if (!child || child.killed) {
    return;
  }

  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, "SIGTERM");
      return;
    }
  } catch {
    // Fall through to a direct child kill.
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // Ignore cleanup failures.
  }
}

function buildAutoStartServerEnv() {
  const port =
    configuredBaseUrlObject.port ||
    (configuredBaseUrlObject.protocol === "https:" ? "443" : "80");
  const legacyDatabasePath = path.join(isolatedStorageRoot, "critjecture.sqlite");
  const v2DatabasePath = path.join(isolatedStorageRoot, "critjecture-v2.sqlite");

  return {
    ...process.env,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "playwright-test-secret",
    CRITJECTURE_DEPLOYMENT_MODE: process.env.CRITJECTURE_DEPLOYMENT_MODE ?? "single_org",
    CRITJECTURE_INTERN_EMAIL:
      process.env.CRITJECTURE_INTERN_EMAIL ?? "intern@example.com",
    CRITJECTURE_INTERN_NAME:
      process.env.CRITJECTURE_INTERN_NAME ?? "Intern User",
    CRITJECTURE_INTERN_PASSWORD:
      process.env.CRITJECTURE_INTERN_PASSWORD ?? "intern-password",
    CRITJECTURE_LEGACY_DATABASE_URL: legacyDatabasePath,
    CRITJECTURE_ORGANIZATION_NAME:
      process.env.CRITJECTURE_ORGANIZATION_NAME ?? "Critjecture Test Org",
    CRITJECTURE_ORGANIZATION_SLUG:
      process.env.CRITJECTURE_ORGANIZATION_SLUG ?? "critjecture-test-org",
    CRITJECTURE_OWNER_EMAIL: process.env.CRITJECTURE_OWNER_EMAIL ?? email,
    CRITJECTURE_OWNER_NAME:
      process.env.CRITJECTURE_OWNER_NAME ?? "Playwright Owner",
    CRITJECTURE_OWNER_PASSWORD: process.env.CRITJECTURE_OWNER_PASSWORD ?? password,
    CRITJECTURE_STORAGE_ROOT: process.env.CRITJECTURE_STORAGE_ROOT ?? isolatedStorageRoot,
    CRITJECTURE_V2_DATABASE_URL: v2DatabasePath,
    DATABASE_URL: process.env.DATABASE_URL ?? v2DatabasePath,
    HOSTNAME: process.env.HOSTNAME ?? configuredBaseUrlObject.hostname,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? "1",
    NODE_ENV: process.env.NODE_ENV ?? "test",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test-openai-key",
    PORT: process.env.PORT ?? port,
  };
}

async function ensureServerAvailability() {
  const reachable = await resolveReachableBaseURL();
  if (reachable) {
    activeBaseURL = reachable;
    if (reachable !== configuredBaseURL) {
      logStep(`Using reachable base URL ${reachable} instead of ${configuredBaseURL}`);
    }
    return null;
  }

  if (!autoStartServer) {
    throw new Error(
      `Could not reach ${configuredBaseURL}. Start the app first (for example: \`pnpm dev\`) or allow auto-start with PLAYWRIGHT_START_SERVER=true.`,
    );
  }

  await mkdirIfNeeded(artifactDirectory);
  await mkdirIfNeeded(isolatedStorageRoot);
  const serverLog = createWriteStream(serverLogPath, { flags: "w" });

  logStep(`No server detected at ${configuredBaseURL}. Starting one with: ${serverCommand}`);
  logStep(`Server logs: ${serverLogPath}`);

  const child = spawn(serverCommand, {
    cwd: serverCommandCwd,
    detached: process.platform !== "win32",
    env: buildAutoStartServerEnv(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.pipe(serverLog);
  child.stderr?.pipe(serverLog);

  const exitedEarly = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

  const reachableAfterStart = await Promise.race([
    waitForReachableBaseURL(serverStartTimeoutMs),
    exitedEarly.then(() => null),
  ]);

  if (!reachableAfterStart) {
    terminateProcessTree(child);
    serverLog.end();
    throw new Error(
      `Timed out waiting for ${configuredBaseURL} after starting \`${serverCommand}\`. Check ${serverLogPath}.`,
    );
  }

  activeBaseURL = reachableAfterStart;
  if (reachableAfterStart !== configuredBaseURL) {
    logStep(`Using reachable base URL ${reachableAfterStart} instead of ${configuredBaseURL}`);
  }
  logStep(`Server is ready at ${activeBaseURL}`);

  return { child, serverLog };
}

async function openShellMenu(page) {
  const menuSummary = page.locator(".shell-menu__summary");
  await expectVisible(menuSummary, "workspace shell menu");

  const menu = page.locator(".shell-menu");
  const isOpen = (await menu.getAttribute("open")) !== null;

  if (!isOpen) {
    await menuSummary.click();
    await expectVisible(page.locator(".shell-menu__panel"), "workspace navigation panel");
  }
}

async function closeShellMenu(page) {
  const menu = page.locator(".shell-menu");
  const isOpen = (await menu.getAttribute("open")) !== null;

  if (isOpen) {
    await page.locator(".shell-menu__summary").click();
    await page.locator(".shell-menu__panel").waitFor({ state: "hidden", timeout: defaultTimeoutMs }).catch(() => {});
  }
}

async function loginIfNeeded(page) {
  logStep(`Opening ${activeBaseURL}`);
  await page.goto(activeBaseURL, { waitUntil: "domcontentloaded" });

  const loginHeading = page.getByRole("heading", { name: /sign in to the workspace/i });
  if (await isVisible(loginHeading, 10_000)) {
    logStep(`Logging in as ${email}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await Promise.all([
      page.waitForURL((currentUrl) => currentUrl.pathname !== "/login", {
        timeout: defaultTimeoutMs,
      }),
      page.getByRole("button", { name: "Sign In" }).click(),
    ]);
  }

  await expectVisible(page.locator(".shell-menu__summary"), "authenticated workspace shell");
  logStep(`Authenticated at ${page.url()}`);
}

async function toggleAppearance(page) {
  logStep("Toggling the appearance control in the shell menu");
  await openShellMenu(page);

  const enabledThemeButton = page.locator(".shell-theme__button:not([disabled])").first();
  await expectVisible(enabledThemeButton, "enabled appearance toggle");
  const nextThemeLabel = (await enabledThemeButton.textContent())?.trim() ?? "selected theme";

  await enabledThemeButton.click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await expectVisible(page.locator(".shell-menu__summary"), "workspace shell after theme change");

  const nowDisabled = page.locator(`.shell-theme__button[disabled]`, {
    hasText: nextThemeLabel,
  });
  await nowDisabled.first().waitFor({ state: "attached", timeout: 5_000 });
  assert.ok(
    await nowDisabled.first().isDisabled(),
    `Expected ${nextThemeLabel} appearance button to become disabled after toggling.`,
  );
  await closeShellMenu(page);
}

async function navigateViaShell(page, linkName, expectedPathPrefix) {
  await openShellMenu(page);
  const link = page.getByRole("link", { name: linkName, exact: true });
  const exists = await link.count();

  if (!exists) {
    logStep(`Skipping shell link ${linkName}; it is not available for this account.`);
    await closeShellMenu(page);
    return false;
  }

  logStep(`Navigating via shell menu to ${linkName}`);
  await link.click();
  await expectUrlPath(page, expectedPathPrefix);
  return true;
}

async function verifyCausalPage(page) {
  logStep("Verifying the causal workspace");
  await expectHeading(page, "Causal studies");

  const questionInput = page.getByLabel("Question", { exact: true });
  await expectVisible(questionInput, "causal question field");
  await questionInput.fill("Did discount rate affect conversion?");

  const runButton = page.getByRole("button", { name: /Run causal intake/i });
  await expectVisible(runButton, "Run causal intake button");
  assert.equal(
    await runButton.isDisabled(),
    false,
    "Run causal intake should be enabled after entering a question.",
  );

  if (allowWriteActions) {
    logStep("Submitting the causal intake form because PLAYWRIGHT_ALLOW_WRITE_ACTIONS=true");
    await runButton.click();
    await expectVisible(page.locator(".causal-hero__copy"), "updated causal helper text");
  }
}

async function verifyChatPage(page) {
  logStep("Verifying the chat workspace");
  await expectVisible(page.locator(".chat-toolbar__summary"), "chat toolbar");
  await page.locator(".chat-fallback-overlay").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});

  const historyToggle = page.getByRole("button", { name: /conversation history sidebar/i });
  await expectVisible(historyToggle, "chat history toggle");
  const firstHistoryLabel = await historyToggle.getAttribute("aria-label");
  await historyToggle.click();

  const secondHistoryLabel = await historyToggle.getAttribute("aria-label");
  assert.notEqual(
    secondHistoryLabel,
    firstHistoryLabel,
    "Chat history toggle should change its label after clicking.",
  );

  await historyToggle.click();
  const thirdHistoryLabel = await historyToggle.getAttribute("aria-label");
  assert.equal(
    thirdHistoryLabel,
    firstHistoryLabel,
    "Chat history toggle should return to its original state after clicking twice.",
  );

  const chatComposer = page.locator(".chat-host textarea").first();
  if (await isVisible(chatComposer, 15_000)) {
    await chatComposer.fill("Playwright local smoke test draft message");
    assert.equal(
      await chatComposer.inputValue(),
      "Playwright local smoke test draft message",
      "Chat composer should accept typed input.",
    );
    await chatComposer.fill("");
  }

  await page.locator(".chat-toolbar__summary").click();
  await expectVisible(page.getByRole("button", { name: "New chat" }), "chat toolbar actions");
  await page.keyboard.press("Escape").catch(() => {});
}

async function verifyKnowledgePage(page) {
  logStep("Verifying the knowledge workspace");
  await expectHeading(page, "Async imports for search and analysis");

  const importScope = page.getByLabel("Import scope", { exact: true });
  if (await isVisible(importScope)) {
    await importScope.selectOption("admin").catch(() => {});
    await importScope.selectOption("public").catch(() => {});
  }

  const demoDownloadsToggle = page.getByRole("button", { name: /demo downloads/i });
  await expectVisible(demoDownloadsToggle, "demo downloads toggle");
  await demoDownloadsToggle.click();
  await expectVisible(
    page.getByRole("button", { name: /Hide demo downloads/i }),
    "collapsed demo downloads toggle",
  );
  await expectVisible(
    page.getByRole("link", { name: /Download CSV/i }).first(),
    "demo dataset download link",
  );
  await page.getByRole("button", { name: /Hide demo downloads/i }).click();

  const refreshButton = page.getByRole("button", { name: "Refresh", exact: true });
  await expectVisible(refreshButton, "knowledge refresh button");
  await refreshButton.click();

  const statusFilter = page.getByLabel("Status", { exact: true });
  if (await isVisible(statusFilter)) {
    await statusFilter.selectOption("failed").catch(() => {});
    await statusFilter.selectOption("all").catch(() => {});
  }
}

async function verifyWorkflowsPage(page) {
  logStep("Verifying the workflows workspace");
  await expectHeading(page, "Saved workflows and execution history");
}

async function verifyOperationsPage(page) {
  logStep("Verifying the operations workspace");
  await expectHeading(page, "Operations");
}

async function verifyAuditLogsPage(page) {
  logStep("Verifying the audit logs workspace");
  await expectHeading(page, "Audit Logs");
}

async function verifySettingsPage(page) {
  logStep("Verifying the settings workspace");
  await expectHeading(page, "Settings and Governance");
}

async function verifyPredictivePage(page) {
  logStep("Verifying the predictive workspace via direct navigation");
  await page.goto(buildUrl("/predictive"), { waitUntil: "domcontentloaded" });
  await expectUrlPath(page, "/predictive");
  await expectHeading(page, "Associational and predictive analysis");

  const presetSelect = page.getByLabel("Analysis preset", { exact: true });
  await expectVisible(presetSelect, "predictive preset selector");
  await presetSelect.selectOption("forecast");
  await presetSelect.selectOption("standard");

  const taskKindSelect = page.getByLabel("Task kind", { exact: true });
  await expectVisible(taskKindSelect, "predictive task kind selector");
  await taskKindSelect.selectOption("regression");
  await taskKindSelect.selectOption("classification");
}

async function maybeSignOut(page) {
  if (!signOutAtEnd) {
    return;
  }

  logStep("Signing out because PLAYWRIGHT_SIGN_OUT_AT_END=true");
  await openShellMenu(page);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.waitForURL((currentUrl) => currentUrl.pathname === "/login", {
    timeout: defaultTimeoutMs,
  });
  await expectHeading(page, /sign in to the workspace/i);
}

let startedServer = null;

const browser = await chromium.launch({
  headless,
  slowMo,
});

const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 960 },
});

const page = await context.newPage();
page.setDefaultTimeout(defaultTimeoutMs);

try {
  startedServer = await ensureServerAvailability();
  await loginIfNeeded(page);

  await expectUrlPath(page, "/chat").catch(async () => {
    await page.goto(buildUrl("/chat"), { waitUntil: "domcontentloaded" });
    await expectUrlPath(page, "/chat");
  });

  await verifyChatPage(page);
  await toggleAppearance(page);

  if (await navigateViaShell(page, "Causal", "/causal")) {
    await verifyCausalPage(page);
  }

  if (await navigateViaShell(page, "Knowledge", "/knowledge")) {
    await verifyKnowledgePage(page);
  }

  if (await navigateViaShell(page, "Workflows", "/workflows")) {
    await verifyWorkflowsPage(page);
  }

  if (await navigateViaShell(page, "Operations", "/admin/operations")) {
    await verifyOperationsPage(page);
  }

  if (await navigateViaShell(page, "Audit Logs", "/admin/logs")) {
    await verifyAuditLogsPage(page);
  }

  if (await navigateViaShell(page, "Settings", "/admin/settings")) {
    await verifySettingsPage(page);
  }

  if (!(await navigateViaShell(page, "Predictive", "/predictive"))) {
    await verifyPredictivePage(page);
  }
  await maybeSignOut(page);

  logStep("Smoke test completed successfully.");
} catch (error) {
  await mkdirIfNeeded(artifactDirectory);
  const screenshotPath = path.join(artifactDirectory, "playwright-local-ui-smoke-failure.png");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  console.error(`\n[playwright-local-ui-smoke] Failed. Screenshot saved to ${screenshotPath}`);

  if (startedServer) {
    console.error(`[playwright-local-ui-smoke] Started server log: ${serverLogPath}`);
  }

  throw error;
} finally {
  await context.close();
  await browser.close();

  if (startedServer) {
    terminateProcessTree(startedServer.child);
    startedServer.serverLog.end();
  }
}
