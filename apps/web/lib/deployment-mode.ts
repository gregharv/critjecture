import "server-only";

export const DEPLOYMENT_MODES = ["single_org", "hosted"] as const;

export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export function getDeploymentMode(): DeploymentMode {
  const configuredValue = (process.env.CRITJECTURE_DEPLOYMENT_MODE ?? "").trim().toLowerCase();

  return configuredValue === "hosted" ? "hosted" : "single_org";
}

export function isHostedDeployment() {
  return getDeploymentMode() === "hosted";
}

export function isSingleOrgDeployment() {
  return getDeploymentMode() === "single_org";
}
