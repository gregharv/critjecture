import { afterEach, describe, expect, it } from "vitest";

import {
  createOrganizationMember,
  listOrganizationMembers,
  updateOrganizationMember,
} from "@/lib/admin-users";
import {
  beginObservedRequest,
  finalizeObservedRequest,
  getOperationsSummary,
} from "@/lib/operations";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  getWorkspaceCommercialUsageSnapshot,
  getWorkspacePlanSummary,
} from "@/lib/workspace-plans";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("workspace commercial controls", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("bootstraps a default workspace plan for the seeded organization", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");

      expect(owner).not.toBeNull();

      const plan = await getWorkspacePlanSummary(owner!.organizationId);
      const usage = await getWorkspaceCommercialUsageSnapshot({
        organizationId: owner!.organizationId,
      });

      expect(plan.planCode).toBe("flat-smb");
      expect(plan.monthlyIncludedCredits).toBe(500);
      expect(plan.rateCard.chat).toBe(1);
      expect(plan.rateCard.analysis).toBe(8);
      expect(usage.usedCredits).toBe(0);
      expect(usage.remainingCredits).toBe(500);
      expect(usage.resetAt).toBe(plan.currentWindowEndAt);
    } finally {
      await environment.cleanup();
    }
  });

  it("treats suspended memberships as unauthenticated for workspace access", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const intern = await getAuthenticatedUserByEmail("intern@example.com");

      expect(intern).not.toBeNull();

      await updateOrganizationMember({
        organizationId: intern!.organizationId,
        status: "suspended",
        userId: intern!.id,
      });

      await expect(getAuthenticatedUserByEmail("intern@example.com")).resolves.toBeNull();
    } finally {
      await environment.cleanup();
    }
  });

  it("surfaces per-member monthly credit caps in admin and operations views", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");

      expect(owner).not.toBeNull();

      const member = await createOrganizationMember({
        email: "analyst@example.com",
        name: "Analyst User",
        organizationId: owner!.organizationId,
        password: "analyst-password",
        role: "intern",
      });

      await updateOrganizationMember({
        monthlyCreditCap: 75,
        organizationId: owner!.organizationId,
        userId: member.id,
      });

      const memberUser = await getAuthenticatedUserByEmail("analyst@example.com");

      expect(memberUser).not.toBeNull();

      const observed = beginObservedRequest({
        method: "POST",
        routeGroup: "chat",
        routeKey: "chat.stream",
        user: memberUser,
      });

      await finalizeObservedRequest(observed, {
        outcome: "ok",
        response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
        usageEvents: [
          {
            eventType: "model_completion",
            status: "completed",
          },
        ],
      });

      const memberList = await listOrganizationMembers(owner!.organizationId);
      const updatedMember = memberList.members.find((row) => row.id === member.id);
      const operations = await getOperationsSummary({
        organizationId: owner!.organizationId,
        windowParam: "24h",
      });

      expect(updatedMember?.monthlyCreditCap).toBe(75);
      expect(operations.workspace.planCode).toBe("flat-smb");
      expect(operations.usageSummary.byUser.find((row) => row.userId === member.id)).toMatchObject({
        creditCap: 75,
        remainingCreditCap: 75,
        status: "active",
      });
    } finally {
      await environment.cleanup();
    }
  });
});
