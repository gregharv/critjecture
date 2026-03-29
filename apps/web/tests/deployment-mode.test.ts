import { afterEach, describe, expect, it } from "vitest";

import { getDeploymentMode } from "@/lib/deployment-mode";

const originalMode = process.env.CRITJECTURE_DEPLOYMENT_MODE;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.CRITJECTURE_DEPLOYMENT_MODE;
  } else {
    process.env.CRITJECTURE_DEPLOYMENT_MODE = originalMode;
  }
});

describe("getDeploymentMode", () => {
  it("defaults to single_org", () => {
    delete process.env.CRITJECTURE_DEPLOYMENT_MODE;
    expect(getDeploymentMode()).toBe("single_org");
  });

  it("recognizes hosted mode", () => {
    process.env.CRITJECTURE_DEPLOYMENT_MODE = "hosted";
    expect(getDeploymentMode()).toBe("hosted");
  });
});
