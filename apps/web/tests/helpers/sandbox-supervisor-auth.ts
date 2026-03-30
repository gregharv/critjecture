type HostedSupervisorSignatureHeadersInput = {
  body?: string;
  endpoint: string;
  keyId: string;
  method: string;
  nonce: string;
  organizationSlug: string;
  secret: string;
  timestamp?: number;
};

type HostedSupervisorVerificationInput = {
  body?: string;
  endpoint: string;
  expectedKeyId: string;
  expectedOrganizationSlug: string;
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined;
  maxClockSkewMs?: number;
  method: string;
  now?: number;
  secret: string;
  seenNonces?: Map<string, number>;
};

type HostedSupervisorVerificationResult =
  | {
      code: null;
      detail: string;
      ok: true;
    }
  | {
      code: string;
      detail: string;
      ok: false;
    };

type SandboxSupervisorAuthModule = {
  DEFAULT_MAX_CLOCK_SKEW_MS: number;
  buildHostedSupervisorSignatureHeaders: (
    input: HostedSupervisorSignatureHeadersInput,
  ) => Record<string, string>;
  verifyHostedSupervisorRequest: (
    input: HostedSupervisorVerificationInput,
  ) => HostedSupervisorVerificationResult;
};

// @ts-expect-error The supervisor auth helper is authored as ESM .mjs; tests use a typed wrapper.
import * as sandboxSupervisorAuthModule from "../../../../packages/sandbox-supervisor/auth.mjs";

const typedModule = sandboxSupervisorAuthModule as SandboxSupervisorAuthModule;

export const DEFAULT_MAX_CLOCK_SKEW_MS = typedModule.DEFAULT_MAX_CLOCK_SKEW_MS;
export const buildHostedSupervisorSignatureHeaders =
  typedModule.buildHostedSupervisorSignatureHeaders;
export const verifyHostedSupervisorRequest = typedModule.verifyHostedSupervisorRequest;
