import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import {
  organizationMemberships,
  workspaceCommercialLedger,
  workspacePlans,
} from "@/lib/app-schema";

export const COMMERCIAL_USAGE_CLASSES = [
  "analysis",
  "chart",
  "chat",
  "document",
  "import",
] as const;

export type CommercialUsageClass = (typeof COMMERCIAL_USAGE_CLASSES)[number];

export type WorkspacePlanRateCard = Record<CommercialUsageClass, number>;

export type WorkspacePlanWindow = {
  endAt: number;
  startAt: number;
};

export type WorkspacePlanSummary = {
  currentWindowEndAt: number;
  currentWindowStartAt: number;
  hardCapBehavior: "block";
  monthlyIncludedCredits: number;
  planCode: string;
  planName: string;
  rateCard: WorkspacePlanRateCard;
};

export type WorkspacePlanUsageSnapshot = {
  exhausted: boolean;
  pendingCredits: number;
  remainingCredits: number;
  resetAt: number;
  usedCredits: number;
  windowEndAt: number;
  windowStartAt: number;
};

export const DEFAULT_WORKSPACE_PLAN: WorkspacePlanSummary = {
  currentWindowEndAt: 0,
  currentWindowStartAt: 0,
  hardCapBehavior: "block",
  monthlyIncludedCredits: 500,
  planCode: "flat-smb",
  planName: "Flat SMB",
  rateCard: {
    analysis: 8,
    chart: 10,
    chat: 1,
    document: 12,
    import: 2,
  },
};

function addUtcMonths(timestamp: number, months: number) {
  const next = new Date(timestamp);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.getTime();
}

export function getWorkspaceBillingWindow(anchorAt: number, timestamp: number): WorkspacePlanWindow {
  let startAt = anchorAt;
  let endAt = addUtcMonths(startAt, 1);

  while (timestamp >= endAt) {
    startAt = endAt;
    endAt = addUtcMonths(startAt, 1);
  }

  while (timestamp < startAt) {
    endAt = startAt;
    startAt = addUtcMonths(startAt, -1);
  }

  return {
    endAt,
    startAt,
  };
}

function parseRateCardJson(value: string): WorkspacePlanRateCard {
  try {
    const parsed = JSON.parse(value) as Partial<Record<CommercialUsageClass, unknown>>;

    return {
      analysis:
        typeof parsed.analysis === "number" && Number.isFinite(parsed.analysis)
          ? Math.max(0, Math.trunc(parsed.analysis))
          : DEFAULT_WORKSPACE_PLAN.rateCard.analysis,
      chart:
        typeof parsed.chart === "number" && Number.isFinite(parsed.chart)
          ? Math.max(0, Math.trunc(parsed.chart))
          : DEFAULT_WORKSPACE_PLAN.rateCard.chart,
      chat:
        typeof parsed.chat === "number" && Number.isFinite(parsed.chat)
          ? Math.max(0, Math.trunc(parsed.chat))
          : DEFAULT_WORKSPACE_PLAN.rateCard.chat,
      document:
        typeof parsed.document === "number" && Number.isFinite(parsed.document)
          ? Math.max(0, Math.trunc(parsed.document))
          : DEFAULT_WORKSPACE_PLAN.rateCard.document,
      import:
        typeof parsed.import === "number" && Number.isFinite(parsed.import)
          ? Math.max(0, Math.trunc(parsed.import))
          : DEFAULT_WORKSPACE_PLAN.rateCard.import,
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_PLAN.rateCard };
  }
}

function mapWorkspacePlanRow(row: typeof workspacePlans.$inferSelect): WorkspacePlanSummary {
  return {
    currentWindowEndAt: row.currentWindowEndAt,
    currentWindowStartAt: row.currentWindowStartAt,
    hardCapBehavior: row.hardCapBehavior,
    monthlyIncludedCredits: row.monthlyIncludedCredits,
    planCode: row.planCode,
    planName: row.planName,
    rateCard: parseRateCardJson(row.rateCardJson),
  };
}

export function getCommercialUsageClassForRoute(input: {
  routeGroup: string;
  routeKey: string;
}): CommercialUsageClass | null {
  if (input.routeGroup === "chat" && input.routeKey === "chat.stream") {
    return "chat";
  }

  if (input.routeGroup === "knowledge_import") {
    return "import";
  }

  if (input.routeKey === "knowledge.files.upload_async") {
    return "import";
  }

  if (input.routeKey === "data-analysis.run") {
    return "analysis";
  }

  if (input.routeKey === "visual-graph.run") {
    return "chart";
  }

  if (input.routeKey === "document.generate") {
    return "document";
  }

  return null;
}

export async function ensureWorkspacePlanForOrganization(input: {
  billingAnchorAt?: number;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const existing = await db.query.workspacePlans.findFirst({
    where: eq(workspacePlans.organizationId, input.organizationId),
  });

  if (existing) {
    return existing;
  }

  const now = Date.now();
  const billingAnchorAt = input.billingAnchorAt ?? now;
  const window = getWorkspaceBillingWindow(billingAnchorAt, now);
  const createdPlan = {
    createdAt: now,
    currentWindowEndAt: window.endAt,
    currentWindowStartAt: window.startAt,
    hardCapBehavior: DEFAULT_WORKSPACE_PLAN.hardCapBehavior,
    id: randomUUID(),
    monthlyIncludedCredits: DEFAULT_WORKSPACE_PLAN.monthlyIncludedCredits,
    organizationId: input.organizationId,
    planCode: DEFAULT_WORKSPACE_PLAN.planCode,
    planName: DEFAULT_WORKSPACE_PLAN.planName,
    rateCardJson: JSON.stringify(DEFAULT_WORKSPACE_PLAN.rateCard),
    billingAnchorAt,
    updatedAt: now,
  } satisfies typeof workspacePlans.$inferInsert;

  await db.insert(workspacePlans).values(createdPlan);

  return createdPlan;
}

export async function getWorkspacePlanSummary(organizationId: string) {
  const db = await getAppDatabase();
  const existing = await ensureWorkspacePlanForOrganization({ organizationId });
  const nextWindow = getWorkspaceBillingWindow(existing.billingAnchorAt, Date.now());

  if (
    existing.currentWindowStartAt !== nextWindow.startAt ||
    existing.currentWindowEndAt !== nextWindow.endAt
  ) {
    await db
      .update(workspacePlans)
      .set({
        currentWindowEndAt: nextWindow.endAt,
        currentWindowStartAt: nextWindow.startAt,
        updatedAt: Date.now(),
      })
      .where(eq(workspacePlans.id, existing.id));

    return {
      ...mapWorkspacePlanRow(existing),
      currentWindowEndAt: nextWindow.endAt,
      currentWindowStartAt: nextWindow.startAt,
    };
  }

  return mapWorkspacePlanRow(existing);
}

export async function getWorkspaceCommercialUsageSnapshot(input: {
  organizationId: string;
  userId?: string | null;
}) {
  const db = await getAppDatabase();
  const plan = await getWorkspacePlanSummary(input.organizationId);
  const baseWhere = and(
    eq(workspaceCommercialLedger.organizationId, input.organizationId),
    eq(workspaceCommercialLedger.windowStartAt, plan.currentWindowStartAt),
  );
  const userWhere =
    typeof input.userId === "string"
      ? and(baseWhere, eq(workspaceCommercialLedger.userId, input.userId))
      : baseWhere;

  const [committedRows, pendingRows] = await Promise.all([
    db
      .select({
        total: sql<number>`coalesce(sum(${workspaceCommercialLedger.creditsDelta}), 0)`,
      })
      .from(workspaceCommercialLedger)
      .where(and(userWhere, eq(workspaceCommercialLedger.status, "committed"))),
    db
      .select({
        total: sql<number>`coalesce(sum(${workspaceCommercialLedger.creditsDelta}), 0)`,
      })
      .from(workspaceCommercialLedger)
      .where(and(userWhere, eq(workspaceCommercialLedger.status, "reserved"))),
  ]);

  const usedCredits = Number(committedRows[0]?.total ?? 0);
  const pendingCredits = Number(pendingRows[0]?.total ?? 0);
  const remainingCredits = Math.max(
    0,
    plan.monthlyIncludedCredits - usedCredits - pendingCredits,
  );

  return {
    exhausted: remainingCredits <= 0,
    pendingCredits,
    remainingCredits,
    resetAt: plan.currentWindowEndAt,
    usedCredits,
    windowEndAt: plan.currentWindowEndAt,
    windowStartAt: plan.currentWindowStartAt,
  } satisfies WorkspacePlanUsageSnapshot;
}

export async function getOrganizationMembershipCommercialPolicy(input: {
  organizationId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  const membership = await db.query.organizationMemberships.findFirst({
    where: and(
      eq(organizationMemberships.organizationId, input.organizationId),
      eq(organizationMemberships.userId, input.userId),
    ),
  });

  if (!membership) {
    return null;
  }

  return {
    monthlyCreditCap: membership.monthlyCreditCap,
    status: membership.status,
  };
}
