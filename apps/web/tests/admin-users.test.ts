import { describe, expect, it } from "vitest";

import { wouldRemoveLastActiveOwner } from "@/lib/admin-users";

describe("wouldRemoveLastActiveOwner", () => {
  it("blocks demoting the only active owner", () => {
    expect(
      wouldRemoveLastActiveOwner({
        activeOwnerCount: 1,
        currentRole: "owner",
        currentStatus: "active",
        nextRole: "member",
        nextStatus: "active",
      }),
    ).toBe(true);
  });

  it("allows suspension when another active owner remains", () => {
    expect(
      wouldRemoveLastActiveOwner({
        activeOwnerCount: 2,
        currentRole: "owner",
        currentStatus: "active",
        nextRole: "owner",
        nextStatus: "suspended",
      }),
    ).toBe(false);
  });
});
