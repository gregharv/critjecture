import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

import { GET } from "@/app/api/admin/customer-review/[doc]/route";

describe("GET /api/admin/customer-review/[doc]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/customer-review/security-review"), {
      params: Promise.resolve({ doc: "security-review" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 403 for member users", async () => {
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "member" }));

    const response = await GET(new Request("http://localhost/api/admin/customer-review/security-review"), {
      params: Promise.resolve({ doc: "security-review" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 200 for admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "admin" }));

    const response = await GET(new Request("http://localhost/api/admin/customer-review/security-review"), {
      params: Promise.resolve({ doc: "security-review" }),
    });

    expect(response.status).toBe(200);
  });

  it("returns 404 for unknown document slugs", async () => {
    const response = await GET(new Request("http://localhost/api/admin/customer-review/unknown"), {
      params: Promise.resolve({ doc: "unknown" }),
    });

    expect(response.status).toBe(404);
  });

  it("serves markdown for known review documents", async () => {
    const response = await GET(new Request("http://localhost/api/admin/customer-review/hosted-launch"), {
      params: Promise.resolve({ doc: "hosted-launch" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(body).toContain("# Hosted Launch Package");
  });
});
