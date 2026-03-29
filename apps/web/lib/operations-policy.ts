import "server-only";

export type OperationsRouteGroup = "chat" | "search" | "sandbox" | "knowledge_upload";

export type RouteRateLimitPolicy = {
  maxRequests: number;
  scope: "organization" | "user";
  windowMs: number;
};

export type RouteGroupPolicy = {
  group: OperationsRouteGroup;
  rateLimits: RouteRateLimitPolicy[];
};

export type OperationsPoliciesSnapshot = {
  budgets: {
    dailyModelCostCapUsdOrganization: number;
    dailyModelCostCapUsdUser: number;
    dailySandboxRunCapOrganization: number;
    dailySandboxRunCapUser: number;
    warningRatio: number;
  };
  chat: {
    maxTokensHardCap: number;
    rateLimits: RouteRateLimitPolicy[];
  };
  knowledgeUpload: {
    rateLimits: RouteRateLimitPolicy[];
  };
  sandbox: {
    rateLimits: RouteRateLimitPolicy[];
  };
  search: {
    rateLimits: RouteRateLimitPolicy[];
  };
};

function parseNumberEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const OPERATIONS_REQUEST_LOG_RETENTION_DAYS = parseNumberEnv(
  process.env.CRITJECTURE_REQUEST_LOG_RETENTION_DAYS,
  14,
);

export const OPERATIONS_USAGE_RETENTION_DAYS = parseNumberEnv(
  process.env.CRITJECTURE_USAGE_RETENTION_DAYS,
  30,
);

export const OPERATIONS_ALERT_RETENTION_DAYS = 30;

export const CHAT_MAX_TOKENS_HARD_CAP = Math.trunc(
  parseNumberEnv(process.env.CRITJECTURE_CHAT_MAX_TOKENS_HARD_CAP, 4000),
);

export const DAILY_MODEL_COST_CAP_USD_USER = parseNumberEnv(
  process.env.CRITJECTURE_DAILY_MODEL_COST_CAP_USD_USER,
  3,
);

export const DAILY_MODEL_COST_CAP_USD_ORGANIZATION = parseNumberEnv(
  process.env.CRITJECTURE_DAILY_MODEL_COST_CAP_USD_ORGANIZATION,
  20,
);

export const DAILY_SANDBOX_RUN_CAP_USER = Math.trunc(
  parseNumberEnv(process.env.CRITJECTURE_DAILY_SANDBOX_RUN_CAP_USER, 25),
);

export const DAILY_SANDBOX_RUN_CAP_ORGANIZATION = Math.trunc(
  parseNumberEnv(process.env.CRITJECTURE_DAILY_SANDBOX_RUN_CAP_ORGANIZATION, 100),
);

export const BUDGET_WARNING_RATIO = 0.8;

export const OPERATIONS_ROUTE_POLICIES: Record<OperationsRouteGroup, RouteGroupPolicy> = {
  chat: {
    group: "chat",
    rateLimits: [
      { maxRequests: 12, scope: "user", windowMs: MINUTE },
      { maxRequests: 40, scope: "organization", windowMs: MINUTE },
    ],
  },
  search: {
    group: "search",
    rateLimits: [
      { maxRequests: 30, scope: "user", windowMs: MINUTE },
      { maxRequests: 120, scope: "organization", windowMs: MINUTE },
    ],
  },
  sandbox: {
    group: "sandbox",
    rateLimits: [
      { maxRequests: 10, scope: "user", windowMs: MINUTE },
      { maxRequests: 30, scope: "organization", windowMs: MINUTE },
    ],
  },
  knowledge_upload: {
    group: "knowledge_upload",
    rateLimits: [
      { maxRequests: 12, scope: "user", windowMs: HOUR },
      { maxRequests: 40, scope: "organization", windowMs: HOUR },
    ],
  },
};

export function getRouteGroupPolicy(group: OperationsRouteGroup) {
  return OPERATIONS_ROUTE_POLICIES[group];
}

export function getOperationsPoliciesSnapshot(): OperationsPoliciesSnapshot {
  return {
    budgets: {
      dailyModelCostCapUsdOrganization: DAILY_MODEL_COST_CAP_USD_ORGANIZATION,
      dailyModelCostCapUsdUser: DAILY_MODEL_COST_CAP_USD_USER,
      dailySandboxRunCapOrganization: DAILY_SANDBOX_RUN_CAP_ORGANIZATION,
      dailySandboxRunCapUser: DAILY_SANDBOX_RUN_CAP_USER,
      warningRatio: BUDGET_WARNING_RATIO,
    },
    chat: {
      maxTokensHardCap: CHAT_MAX_TOKENS_HARD_CAP,
      rateLimits: OPERATIONS_ROUTE_POLICIES.chat.rateLimits,
    },
    knowledgeUpload: {
      rateLimits: OPERATIONS_ROUTE_POLICIES.knowledge_upload.rateLimits,
    },
    sandbox: {
      rateLimits: OPERATIONS_ROUTE_POLICIES.sandbox.rateLimits,
    },
    search: {
      rateLimits: OPERATIONS_ROUTE_POLICIES.search.rateLimits,
    },
  };
}

export function getRetentionWindowMs(days: number) {
  return Math.max(1, Math.trunc(days)) * DAY;
}

export function getBudgetWarningThreshold(limit: number) {
  return limit * BUDGET_WARNING_RATIO;
}
