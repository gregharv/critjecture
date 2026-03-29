import type { SessionUser } from "@/lib/auth-state";
import type { UserRole } from "@/lib/roles";

export function createSessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    email: "owner@example.com",
    id: "user-1",
    name: "Owner User",
    organizationId: "org-1",
    organizationName: "Critjecture Test Org",
    organizationSlug: "critjecture-test-org",
    role: "owner",
    ...overrides,
  };
}

export function createJsonRequest(
  url: string,
  body?: unknown,
  init: Omit<RequestInit, "body" | "method"> & { method?: string } = {},
) {
  return new Request(url, {
    ...init,
    body: typeof body === "undefined" ? undefined : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    method: init.method ?? "POST",
  });
}

export async function readJson<T>(response: Response) {
  return (await response.json()) as T;
}

export function createRateLimitDecision(overrides: Partial<{
  errorCode: string;
  limit: number;
  scope: string;
  windowMs: number;
}> = {}) {
  return {
    errorCode: "rate_limited",
    limit: 3,
    scope: "user",
    windowMs: 60_000,
    ...overrides,
  };
}

export function createBudgetDecision(overrides: Partial<{
  errorCode: string;
  metadata: Record<string, unknown>;
}> = {}) {
  return {
    errorCode: "budget_exceeded",
    metadata: {
      scope: "organization",
      ...overrides.metadata,
    },
  };
}

export function createSearchResult(role: UserRole = "owner") {
  const scopeDescription =
    role === "owner"
      ? "all company_data files for the organization"
      : "public company_data files for the organization";

  return {
    candidateFiles: [
      {
        file: role === "owner" ? "admin/contractors_2026.csv" : "public/holidays.txt",
        matchedTerms: ["2026", "contractors"],
        matches: [
          {
            file: role === "owner" ? "admin/contractors_2026.csv" : "public/holidays.txt",
            line: 1,
            text: role === "owner" ? "ledger_year,contractor,payout" : "Office closed July 4",
          },
        ],
        preview:
          role === "owner"
            ? {
                columns: ["ledger_year", "contractor", "payout"],
                kind: "csv" as const,
                rows: [["2026", "Acme", "1200"]],
              }
            : {
                kind: "text" as const,
                lines: ["Office closed July 4"],
              },
        score: 10,
      },
    ],
    matches: [
      {
        file: role === "owner" ? "admin/contractors_2026.csv" : "public/holidays.txt",
        line: 1,
        text: role === "owner" ? "ledger_year,contractor,payout" : "Office closed July 4",
      },
    ],
    recommendedFiles: [role === "owner" ? "admin/contractors_2026.csv" : "public/holidays.txt"],
    scopeDescription,
    searchedDirectory: role === "owner" ? "company_data" : "company_data/public",
    selectedFiles: [role === "owner" ? "admin/contractors_2026.csv" : "public/holidays.txt"],
    selectionReason: "single-candidate" as const,
    selectionRequired: false,
  };
}
