import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSandboxExecutionBackend,
  getSandboxRunnerForBackend,
} from "@/lib/sandbox-policy";
import { getSandboxBackendHealth } from "@/lib/python-sandbox";

const ENV_KEYS = [
  "CRITJECTURE_DEPLOYMENT_MODE",
  "CRITJECTURE_SANDBOX_CONTAINER_IMAGE",
  "CRITJECTURE_SANDBOX_EXECUTION_BACKEND",
  "CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN",
  "CRITJECTURE_SANDBOX_SUPERVISOR_URL",
] as const;

const previousEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sandbox execution backend policy", () => {
  it("defaults single_org to the container supervisor", () => {
    delete process.env.CRITJECTURE_DEPLOYMENT_MODE;
    delete process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND;

    expect(getSandboxExecutionBackend()).toBe("container_supervisor");
  });

  it("defaults hosted to the hosted supervisor", () => {
    process.env.CRITJECTURE_DEPLOYMENT_MODE = "hosted";
    delete process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND;

    expect(getSandboxExecutionBackend()).toBe("hosted_supervisor");
  });

  it("allows an explicit local supervisor override", () => {
    process.env.CRITJECTURE_DEPLOYMENT_MODE = "single_org";
    process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND = "local_supervisor";

    expect(getSandboxExecutionBackend()).toBe("local_supervisor");
  });

  it("maps backends to the expected runners", () => {
    expect(getSandboxRunnerForBackend("container_supervisor")).toBe("oci-container");
    expect(getSandboxRunnerForBackend("local_supervisor")).toBe("bubblewrap");
    expect(getSandboxRunnerForBackend("hosted_supervisor")).toBe("hosted-supervisor");
  });
});

describe("sandbox backend health", () => {
  it("fails closed when the container supervisor config is incomplete", async () => {
    process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND = "container_supervisor";
    delete process.env.CRITJECTURE_SANDBOX_SUPERVISOR_URL;
    delete process.env.CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN;

    await expect(getSandboxBackendHealth()).resolves.toEqual({
      available: false,
      backend: "container_supervisor",
      detail:
        "Container sandbox supervisor configuration is incomplete: CRITJECTURE_SANDBOX_CONTAINER_IMAGE, CRITJECTURE_SANDBOX_SUPERVISOR_URL, CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN.",
    });
  });

  it("reports reachable container supervisor health details", async () => {
    process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND = "container_supervisor";
    process.env.CRITJECTURE_SANDBOX_CONTAINER_IMAGE = "critjecture/sandbox-runner:latest";
    process.env.CRITJECTURE_SANDBOX_SUPERVISOR_URL = "http://127.0.0.1:4100";
    process.env.CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN = "secret";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          detail: "Container supervisor is ready with image critjecture/sandbox-runner:latest.",
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

    await expect(getSandboxBackendHealth()).resolves.toEqual({
      available: true,
      backend: "container_supervisor",
      detail: "Container supervisor is ready with image critjecture/sandbox-runner:latest.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
        method: "GET",
      }),
    );
  });
});
