export const CUSTOMER_REVIEW_DOCS = [
  {
    fileName: "security_review.md",
    label: "Security review pack",
    slug: "security-review",
  },
  {
    fileName: "deployment.md",
    label: "Deployment modes",
    slug: "deployment",
  },
  {
    fileName: "compliance_controls.md",
    label: "Compliance controls",
    slug: "compliance",
  },
  {
    fileName: "hosted_provisioning.md",
    label: "Hosted provisioning",
    slug: "hosted-provisioning",
  },
  {
    fileName: "hosted_launch.md",
    label: "Hosted launch package",
    slug: "hosted-launch",
  },
] as const;

export type CustomerReviewDoc = (typeof CUSTOMER_REVIEW_DOCS)[number];
export type CustomerReviewDocSlug = CustomerReviewDoc["slug"];

export function getCustomerReviewDoc(slug: string): CustomerReviewDoc | null {
  return CUSTOMER_REVIEW_DOCS.find((doc) => doc.slug === slug) ?? null;
}
