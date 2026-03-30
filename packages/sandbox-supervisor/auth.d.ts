export const SANDBOX_SUPERVISOR_SIGNATURE_HEADERS: {
  readonly keyId: string;
  readonly nonce: string;
  readonly organizationSlug: string;
  readonly signature: string;
  readonly timestamp: string;
};

export const DEFAULT_MAX_CLOCK_SKEW_MS: number;

export function getSupervisorAuthMode(
  env?: Record<string, string | undefined>,
): "bearer" | "none" | "signed";

export function buildHostedSupervisorSignatureHeaders(input: {
  body?: string;
  endpoint: string;
  keyId: string;
  method: string;
  nonce: string;
  organizationSlug: string;
  secret: string;
  timestamp?: number | string;
}): Record<string, string>;

export function verifyHostedSupervisorRequest(input: {
  body?: string;
  endpoint: string;
  expectedKeyId: string;
  expectedOrganizationSlug: string;
  headers: Headers | Record<string, string | string[] | undefined>;
  maxClockSkewMs?: number;
  method: string;
  now?: number;
  secret: string;
  seenNonces?: Map<string, number>;
}): {
  code: string | null;
  detail: string;
  ok: boolean;
};
