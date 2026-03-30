import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";

export const SANDBOX_SUPERVISOR_SIGNATURE_HEADERS = {
  keyId: "X-Critjecture-Supervisor-Key-Id",
  nonce: "X-Critjecture-Supervisor-Nonce",
  organizationSlug: "X-Critjecture-Hosted-Organization-Slug",
  signature: "X-Critjecture-Supervisor-Signature",
  timestamp: "X-Critjecture-Supervisor-Timestamp",
} as const;

export function getSandboxSupervisorKeyId() {
  return (process.env.CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID ?? "").trim();
}

export function getSandboxSupervisorHmacSecret() {
  return (process.env.CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET ?? "").trim();
}

function computeBodyDigest(body: string) {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function buildCanonicalRequest(input: {
  body: string;
  endpoint: string;
  keyId: string;
  method: string;
  nonce: string;
  organizationSlug: string;
  timestamp: string;
}) {
  return [
    input.method.toUpperCase(),
    input.endpoint,
    input.timestamp,
    input.nonce,
    input.keyId,
    input.organizationSlug,
    computeBodyDigest(input.body),
  ].join("\n");
}

export function buildHostedSupervisorSignatureHeaders(input: {
  body?: string;
  endpoint: string;
  keyId: string;
  method: string;
  organizationSlug: string;
  secret: string;
  timestamp?: string;
}) {
  const body = input.body ?? "";
  const nonce = randomUUID();
  const timestamp = input.timestamp ?? String(Date.now());
  const canonicalRequest = buildCanonicalRequest({
    body,
    endpoint: input.endpoint,
    keyId: input.keyId,
    method: input.method,
    nonce,
    organizationSlug: input.organizationSlug,
    timestamp,
  });
  const signature = createHmac("sha256", input.secret)
    .update(canonicalRequest, "utf8")
    .digest("hex");

  return {
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.keyId]: input.keyId,
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.nonce]: nonce,
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.organizationSlug]: input.organizationSlug,
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.signature]: signature,
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.timestamp]: timestamp,
  };
}
