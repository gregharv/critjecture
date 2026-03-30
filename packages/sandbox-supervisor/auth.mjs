import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SANDBOX_SUPERVISOR_SIGNATURE_HEADERS = {
  keyId: "x-critjecture-supervisor-key-id",
  nonce: "x-critjecture-supervisor-nonce",
  organizationSlug: "x-critjecture-hosted-organization-slug",
  signature: "x-critjecture-supervisor-signature",
  timestamp: "x-critjecture-supervisor-timestamp",
};

export const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function computeBodyDigest(body) {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function buildCanonicalRequest(input) {
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

function getHeaderValue(headers, name) {
  if (!headers) {
    return "";
  }

  if (typeof headers.get === "function") {
    return String(headers.get(name) ?? "").trim();
  }

  const lowerName = name.toLowerCase();

  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === lowerName) {
      return String(Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();
    }
  }

  return "";
}

export function getSupervisorAuthMode(env = process.env) {
  const keyId = env.CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID?.trim() || "";
  const secret = env.CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET?.trim() || "";
  const organizationSlug = env.CRITJECTURE_HOSTED_ORGANIZATION_SLUG?.trim().toLowerCase() || "";
  const token = env.CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN?.trim() || "";

  if (keyId && secret && organizationSlug) {
    return "signed";
  }

  if (token) {
    return "bearer";
  }

  return "none";
}

export function buildHostedSupervisorSignatureHeaders(input) {
  const timestamp = String(input.timestamp ?? Date.now());
  const canonicalRequest = buildCanonicalRequest({
    body: input.body ?? "",
    endpoint: input.endpoint,
    keyId: input.keyId,
    method: input.method,
    nonce: input.nonce,
    organizationSlug: input.organizationSlug,
    timestamp,
  });
  const signature = createHmac("sha256", input.secret)
    .update(canonicalRequest, "utf8")
    .digest("hex");

  return {
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.keyId]: input.keyId,
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.nonce]: input.nonce,
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.organizationSlug]: input.organizationSlug,
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.signature]: signature,
    [SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.timestamp]: timestamp,
  };
}

function signaturesMatch(expectedSignature, providedSignature) {
  const expected = Buffer.from(expectedSignature, "hex");
  const provided = Buffer.from(providedSignature, "hex");

  if (expected.length === 0 || provided.length === 0 || expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

function pruneSeenNonces(seenNonces, now) {
  if (!seenNonces) {
    return;
  }

  for (const [nonce, expiresAt] of seenNonces.entries()) {
    if (expiresAt <= now) {
      seenNonces.delete(nonce);
    }
  }
}

export function verifyHostedSupervisorRequest(input) {
  const now = input.now ?? Date.now();
  const maxClockSkewMs = input.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
  const headers = input.headers;
  const keyId = getHeaderValue(headers, SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.keyId);
  const nonce = getHeaderValue(headers, SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.nonce);
  const organizationSlug = getHeaderValue(headers, SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.organizationSlug);
  const providedSignature = getHeaderValue(headers, SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.signature);
  const timestamp = getHeaderValue(headers, SANDBOX_SUPERVISOR_SIGNATURE_HEADERS.timestamp);

  if (!keyId || !nonce || !organizationSlug || !providedSignature || !timestamp) {
    return {
      code: "missing_signature_headers",
      detail: "Signed supervisor request is missing one or more required headers.",
      ok: false,
    };
  }

  if (keyId !== input.expectedKeyId) {
    return {
      code: "unknown_key_id",
      detail: "Signed supervisor request used an unexpected key id.",
      ok: false,
    };
  }

  if (organizationSlug !== input.expectedOrganizationSlug) {
    return {
      code: "organization_mismatch",
      detail: `Signed supervisor request targeted organization "${organizationSlug}" but this supervisor is bound to "${input.expectedOrganizationSlug}".`,
      ok: false,
    };
  }

  const numericTimestamp = Number(timestamp);

  if (!Number.isFinite(numericTimestamp)) {
    return {
      code: "invalid_timestamp",
      detail: "Signed supervisor request timestamp is invalid.",
      ok: false,
    };
  }

  if (Math.abs(now - numericTimestamp) > maxClockSkewMs) {
    return {
      code: "timestamp_out_of_range",
      detail: "Signed supervisor request timestamp is outside the allowed clock-skew window.",
      ok: false,
    };
  }

  pruneSeenNonces(input.seenNonces, now);

  if (input.seenNonces?.has(nonce)) {
    return {
      code: "replay_detected",
      detail: "Signed supervisor request nonce has already been used.",
      ok: false,
    };
  }

  const expectedSignature = createHmac("sha256", input.secret)
    .update(
      buildCanonicalRequest({
        body: input.body ?? "",
        endpoint: input.endpoint,
        keyId,
        method: input.method,
        nonce,
        organizationSlug,
        timestamp,
      }),
      "utf8",
    )
    .digest("hex");

  if (!signaturesMatch(expectedSignature, providedSignature)) {
    return {
      code: "signature_mismatch",
      detail: "Signed supervisor request signature verification failed.",
      ok: false,
    };
  }

  input.seenNonces?.set(nonce, now + maxClockSkewMs);

  return {
    code: null,
    detail: `Signed supervisor request verified for organization "${organizationSlug}".`,
    ok: true,
  };
}
