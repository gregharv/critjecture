export const CAUSAL_DAG_NODE_TYPE_VALUES = [
  "observed_feature",
  "treatment",
  "outcome",
  "confounder",
  "mediator",
  "collider",
  "instrument",
  "selection",
  "latent",
  "external_data_needed",
  "note",
] as const;

export const CAUSAL_DAG_NODE_SOURCE_TYPE_VALUES = ["dataset", "user", "system"] as const;
export const CAUSAL_DAG_NODE_OBSERVED_STATUS_VALUES = [
  "observed",
  "unobserved",
  "missing_external",
] as const;

export const CAUSAL_ASSUMPTION_TYPE_VALUES = [
  "no_unmeasured_confounding",
  "positivity",
  "consistency",
  "measurement_validity",
  "selection_ignorability",
  "instrument_validity",
  "frontdoor_sufficiency",
  "custom",
] as const;

export const CAUSAL_ASSUMPTION_STATUS_VALUES = [
  "asserted",
  "flagged",
  "contested",
  "accepted",
] as const;

export const CAUSAL_DATA_REQUIREMENT_STATUS_VALUES = [
  "missing",
  "requested",
  "in_progress",
  "collected",
  "waived",
] as const;

export const CAUSAL_APPROVAL_KIND_VALUES = [
  "user_signoff",
  "admin_signoff",
  "compliance_signoff",
] as const;
