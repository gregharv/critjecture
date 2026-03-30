import { afterEach, describe, expect, it } from "vitest";

import { resetOrganizationMemberPassword, updateOrganizationMember } from "@/lib/admin-users";
import {
  authenticateUser,
  ensureSeedState,
  getAuthenticatedUserByEmail,
  resetUserSeedStateForTests,
} from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("single_org bootstrap users", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("keeps reset passwords after seed state runs again", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");

      expect(owner).not.toBeNull();

      await resetOrganizationMemberPassword({
        organizationId: owner!.organizationId,
        password: "rotated-owner-password",
        userId: owner!.id,
      });

      resetUserSeedStateForTests();
      await ensureSeedState();

      await expect(
        authenticateUser("owner@example.com", "rotated-owner-password"),
      ).resolves.not.toBeNull();
      await expect(authenticateUser("owner@example.com", "owner-password")).resolves.toBeNull();
    } finally {
      await environment.cleanup();
    }
  });

  it("does not reactivate an existing suspended membership on reseed", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const member = await getAuthenticatedUserByEmail("intern@example.com");

      expect(member).not.toBeNull();

      await updateOrganizationMember({
        organizationId: member!.organizationId,
        status: "suspended",
        userId: member!.id,
      });

      resetUserSeedStateForTests();
      await ensureSeedState();

      await expect(getAuthenticatedUserByEmail("intern@example.com")).resolves.toBeNull();
      await expect(authenticateUser("intern@example.com", "intern-password")).resolves.toBeNull();
    } finally {
      await environment.cleanup();
    }
  });
});

describe("hosted bootstrap users", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("does not seed owner or member accounts in hosted mode", async () => {
    const environment = await createTestAppEnvironment({
      deploymentMode: "hosted",
    });

    try {
      await expect(getAuthenticatedUserByEmail("owner@example.com")).resolves.toBeNull();
      await expect(getAuthenticatedUserByEmail("intern@example.com")).resolves.toBeNull();
    } finally {
      await environment.cleanup();
    }
  });
});
