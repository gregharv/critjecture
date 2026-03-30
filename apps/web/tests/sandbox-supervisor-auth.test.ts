import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_CLOCK_SKEW_MS,
  buildHostedSupervisorSignatureHeaders,
  verifyHostedSupervisorRequest,
} from "@/tests/helpers/sandbox-supervisor-auth";

describe("sandbox supervisor signed auth", () => {
  it("verifies a valid signed hosted request", () => {
    const headers = buildHostedSupervisorSignatureHeaders({
      body: JSON.stringify({ organizationSlug: "acme" }),
      endpoint: "/runs/execute",
      keyId: "hosted-app",
      method: "POST",
      nonce: "nonce-1",
      organizationSlug: "acme",
      secret: "super-secret",
      timestamp: 1_710_000_000_000,
    });

    expect(
      verifyHostedSupervisorRequest({
        body: JSON.stringify({ organizationSlug: "acme" }),
        endpoint: "/runs/execute",
        expectedKeyId: "hosted-app",
        expectedOrganizationSlug: "acme",
        headers,
        method: "POST",
        now: 1_710_000_000_100,
        secret: "super-secret",
        seenNonces: new Map(),
      }),
    ).toMatchObject({
      code: null,
      ok: true,
    });
  });

  it("rejects expired timestamps", () => {
    const headers = buildHostedSupervisorSignatureHeaders({
      body: "",
      endpoint: "/health",
      keyId: "hosted-app",
      method: "GET",
      nonce: "nonce-2",
      organizationSlug: "acme",
      secret: "super-secret",
      timestamp: 1_710_000_000_000,
    });

    expect(
      verifyHostedSupervisorRequest({
        body: "",
        endpoint: "/health",
        expectedKeyId: "hosted-app",
        expectedOrganizationSlug: "acme",
        headers,
        method: "GET",
        now: 1_710_000_000_000 + DEFAULT_MAX_CLOCK_SKEW_MS + 1,
        secret: "super-secret",
        seenNonces: new Map(),
      }),
    ).toMatchObject({
      code: "timestamp_out_of_range",
      ok: false,
    });
  });

  it("rejects organization mismatches and replayed nonces", () => {
    const headers = buildHostedSupervisorSignatureHeaders({
      body: JSON.stringify({ organizationSlug: "other" }),
      endpoint: "/runs/execute",
      keyId: "hosted-app",
      method: "POST",
      nonce: "nonce-3",
      organizationSlug: "other",
      secret: "super-secret",
      timestamp: 1_710_000_000_000,
    });
    const seenNonces = new Map<string, number>();

    expect(
      verifyHostedSupervisorRequest({
        body: JSON.stringify({ organizationSlug: "other" }),
        endpoint: "/runs/execute",
        expectedKeyId: "hosted-app",
        expectedOrganizationSlug: "acme",
        headers,
        method: "POST",
        now: 1_710_000_000_100,
        secret: "super-secret",
        seenNonces,
      }),
    ).toMatchObject({
      code: "organization_mismatch",
      ok: false,
    });

    const validHeaders = buildHostedSupervisorSignatureHeaders({
      body: "",
      endpoint: "/health",
      keyId: "hosted-app",
      method: "GET",
      nonce: "nonce-4",
      organizationSlug: "acme",
      secret: "super-secret",
      timestamp: 1_710_000_000_000,
    });

    expect(
      verifyHostedSupervisorRequest({
        body: "",
        endpoint: "/health",
        expectedKeyId: "hosted-app",
        expectedOrganizationSlug: "acme",
        headers: validHeaders,
        method: "GET",
        now: 1_710_000_000_100,
        secret: "super-secret",
        seenNonces,
      }).ok,
    ).toBe(true);

    expect(
      verifyHostedSupervisorRequest({
        body: "",
        endpoint: "/health",
        expectedKeyId: "hosted-app",
        expectedOrganizationSlug: "acme",
        headers: validHeaders,
        method: "GET",
        now: 1_710_000_000_200,
        secret: "super-secret",
        seenNonces,
      }),
    ).toMatchObject({
      code: "replay_detected",
      ok: false,
    });
  });
});
