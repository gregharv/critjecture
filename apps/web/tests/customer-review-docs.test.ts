import path from "node:path";
import { access } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { CUSTOMER_REVIEW_DOCS, getCustomerReviewDoc } from "@/lib/customer-review-docs";

describe("customer review docs catalog", () => {
  it("includes the expected slugs in stable order", () => {
    expect(CUSTOMER_REVIEW_DOCS.map((doc) => doc.slug)).toEqual([
      "security-review",
      "deployment",
      "compliance",
      "hosted-provisioning",
      "hosted-launch",
    ]);
  });

  it("resolves every configured doc to a file in docs/", async () => {
    await Promise.all(
      CUSTOMER_REVIEW_DOCS.map(async (doc) => {
        const filePath = path.join(process.cwd(), "docs", doc.fileName);

        await expect(access(filePath)).resolves.toBeUndefined();
      }),
    );
  });

  it("looks up known documents and rejects unknown slugs", () => {
    expect(getCustomerReviewDoc("deployment")?.fileName).toBe("deployment.md");
    expect(getCustomerReviewDoc("security-review")?.fileName).toBe("security_review.md");
    expect(getCustomerReviewDoc("hosted-launch")?.fileName).toBe("hosted_launch.md");
    expect(getCustomerReviewDoc("not-a-doc")).toBeNull();
  });
});
