PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_idx ON organizations(slug);
CREATE INDEX IF NOT EXISTS organizations_status_idx ON organizations(status);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('member', 'admin', 'owner')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'suspended')),
  monthly_credit_cap INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_org_user_idx ON organization_memberships(organization_id, user_id);
CREATE INDEX IF NOT EXISTS organization_memberships_org_status_idx ON organization_memberships(organization_id, status);
CREATE INDEX IF NOT EXISTS organization_memberships_user_status_idx ON organization_memberships(user_id, status);

CREATE TABLE IF NOT EXISTS organization_settings (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  causal_mode_required INTEGER NOT NULL DEFAULT 1,
  require_dag_approval INTEGER NOT NULL DEFAULT 1,
  require_admin_approval_for_signed_dags INTEGER NOT NULL DEFAULT 0,
  allow_descriptive_mode INTEGER NOT NULL DEFAULT 1,
  default_runner_kind TEXT NOT NULL DEFAULT 'pywhy' CHECK (default_runner_kind IN ('pywhy', 'dowhy', 'hybrid')),
  default_runner_version TEXT,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_settings_org_idx ON organization_settings(organization_id);
CREATE INDEX IF NOT EXISTS organization_settings_updated_by_idx ON organization_settings(updated_by_user_id);

CREATE TABLE IF NOT EXISTS workspace_plans (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  monthly_included_credits INTEGER NOT NULL,
  billing_anchor_at INTEGER NOT NULL,
  current_window_start_at INTEGER NOT NULL,
  current_window_end_at INTEGER NOT NULL,
  hard_cap_behavior TEXT NOT NULL DEFAULT 'block' CHECK (hard_cap_behavior = 'block'),
  rate_card_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_plans_organization_id_idx ON workspace_plans(organization_id);
CREATE INDEX IF NOT EXISTS workspace_plans_window_end_idx ON workspace_plans(current_window_end_at);

CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  route_key TEXT NOT NULL,
  route_group TEXT NOT NULL,
  method TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  study_id TEXT,
  study_question_id TEXT,
  causal_run_id TEXT,
  compute_run_id TEXT,
  status_code INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  model_name TEXT,
  duration_ms INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS request_logs_route_group_started_at_idx ON request_logs(route_group, started_at);
CREATE INDEX IF NOT EXISTS request_logs_organization_id_started_at_idx ON request_logs(organization_id, started_at);
CREATE INDEX IF NOT EXISTS request_logs_user_id_started_at_idx ON request_logs(user_id, started_at);
CREATE INDEX IF NOT EXISTS request_logs_study_id_started_at_idx ON request_logs(study_id, started_at);
CREATE INDEX IF NOT EXISTS request_logs_causal_run_id_started_at_idx ON request_logs(causal_run_id, started_at);

CREATE TABLE IF NOT EXISTS workspace_commercial_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  usage_class TEXT NOT NULL CHECK (usage_class IN ('causal_intake', 'causal_run', 'causal_answer', 'dataset_profile', 'reference_ingest', 'system')),
  credits_delta INTEGER NOT NULL,
  window_start_at INTEGER NOT NULL,
  window_end_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released', 'blocked')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_commercial_ledger_request_id_idx ON workspace_commercial_ledger(request_id);
CREATE INDEX IF NOT EXISTS workspace_commercial_ledger_org_window_status_idx ON workspace_commercial_ledger(organization_id, window_start_at, status);
CREATE INDEX IF NOT EXISTS workspace_commercial_ledger_user_window_status_idx ON workspace_commercial_ledger(user_id, window_start_at, status);

CREATE TABLE IF NOT EXISTS data_connections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('filesystem', 'upload', 'bulk_import', 'google_drive', 'google_sheets', 's3', 'database')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error', 'archived')),
  config_json TEXT NOT NULL DEFAULT '{}',
  credentials_ref TEXT,
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS data_connections_org_kind_idx ON data_connections(organization_id, kind);
CREATE INDEX IF NOT EXISTS data_connections_org_status_updated_at_idx ON data_connections(organization_id, status, updated_at);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES data_connections(id) ON DELETE SET NULL,
  dataset_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  access_scope TEXT NOT NULL DEFAULT 'admin' CHECK (access_scope IN ('public', 'admin')),
  data_kind TEXT NOT NULL DEFAULT 'table' CHECK (data_kind IN ('table', 'spreadsheet', 'panel', 'event_log')),
  grain_description TEXT,
  time_column_name TEXT,
  entity_id_column_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deprecated')),
  active_version_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS datasets_org_key_idx ON datasets(organization_id, dataset_key);
CREATE INDEX IF NOT EXISTS datasets_org_scope_updated_at_idx ON datasets(organization_id, access_scope, updated_at);
CREATE INDEX IF NOT EXISTS datasets_status_updated_at_idx ON datasets(status, updated_at);
CREATE INDEX IF NOT EXISTS datasets_active_version_id_idx ON datasets(active_version_id);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  source_version_token TEXT,
  source_modified_at INTEGER,
  content_hash TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  row_count INTEGER,
  byte_size INTEGER,
  materialized_path TEXT NOT NULL,
  ingestion_status TEXT NOT NULL DEFAULT 'pending' CHECK (ingestion_status IN ('pending', 'profiling', 'ready', 'failed', 'archived')),
  profile_status TEXT NOT NULL DEFAULT 'pending' CHECK (profile_status IN ('pending', 'ready', 'failed')),
  ingestion_error TEXT,
  profile_error TEXT,
  indexed_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_versions_dataset_version_idx ON dataset_versions(dataset_id, version_number);
CREATE INDEX IF NOT EXISTS dataset_versions_dataset_created_at_idx ON dataset_versions(dataset_id, created_at);
CREATE INDEX IF NOT EXISTS dataset_versions_org_status_updated_at_idx ON dataset_versions(organization_id, ingestion_status, updated_at);
CREATE INDEX IF NOT EXISTS dataset_versions_content_hash_idx ON dataset_versions(dataset_id, content_hash);

CREATE TABLE IF NOT EXISTS dataset_version_columns (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  column_order INTEGER NOT NULL,
  physical_type TEXT NOT NULL,
  semantic_type TEXT NOT NULL DEFAULT 'unknown' CHECK (semantic_type IN ('unknown', 'identifier', 'time', 'numeric', 'categorical', 'boolean', 'text', 'currency', 'percentage', 'treatment_candidate', 'outcome_candidate')),
  nullable INTEGER NOT NULL DEFAULT 1,
  is_indexed_candidate INTEGER NOT NULL DEFAULT 0,
  is_treatment_candidate INTEGER NOT NULL DEFAULT 0,
  is_outcome_candidate INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_version_columns_version_name_idx ON dataset_version_columns(dataset_version_id, column_name);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_version_columns_version_order_idx ON dataset_version_columns(dataset_version_id, column_order);
CREATE INDEX IF NOT EXISTS dataset_version_columns_version_semantic_idx ON dataset_version_columns(dataset_version_id, semantic_type);
CREATE INDEX IF NOT EXISTS dataset_version_columns_org_created_at_idx ON dataset_version_columns(organization_id, created_at);

CREATE TABLE IF NOT EXISTS dataset_version_column_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES dataset_version_columns(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  missing_rate REAL,
  distinct_count INTEGER,
  min_value_text TEXT,
  max_value_text TEXT,
  sample_values_json TEXT NOT NULL DEFAULT '[]',
  profile_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_version_column_profiles_column_idx ON dataset_version_column_profiles(column_id);
CREATE INDEX IF NOT EXISTS dataset_version_column_profiles_version_idx ON dataset_version_column_profiles(dataset_version_id);

CREATE TABLE IF NOT EXISTS causal_studies (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'awaiting_dataset', 'awaiting_dag', 'awaiting_approval', 'ready_to_run', 'running', 'completed', 'blocked', 'archived')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  current_question_id TEXT,
  current_dag_id TEXT,
  current_dag_version_id TEXT,
  current_run_id TEXT,
  current_answer_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS causal_studies_org_status_updated_at_idx ON causal_studies(organization_id, status, updated_at);
CREATE INDEX IF NOT EXISTS causal_studies_created_by_updated_at_idx ON causal_studies(created_by_user_id, updated_at);

CREATE TABLE IF NOT EXISTS study_questions (
  id TEXT PRIMARY KEY NOT NULL,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('cause_of_observed_change', 'intervention_effect', 'counterfactual', 'mediation', 'instrumental_variable', 'selection_bias', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'clarifying', 'ready', 'closed', 'archived')),
  proposed_treatment_label TEXT,
  proposed_outcome_label TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS study_questions_study_created_at_idx ON study_questions(study_id, created_at);
CREATE INDEX IF NOT EXISTS study_questions_org_status_created_at_idx ON study_questions(organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS intent_classifications (
  id TEXT PRIMARY KEY NOT NULL,
  study_question_id TEXT NOT NULL REFERENCES study_questions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  classifier_model_name TEXT NOT NULL,
  classifier_prompt_version TEXT NOT NULL,
  raw_output_json TEXT NOT NULL,
  is_causal INTEGER NOT NULL,
  intent_type TEXT NOT NULL CHECK (intent_type IN ('descriptive', 'diagnostic', 'causal', 'counterfactual', 'unclear')),
  confidence REAL NOT NULL,
  reason_text TEXT NOT NULL,
  routing_decision TEXT NOT NULL CHECK (routing_decision IN ('continue_descriptive', 'open_causal_study', 'ask_clarification', 'blocked')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS intent_classifications_question_created_at_idx ON intent_classifications(study_question_id, created_at);
CREATE INDEX IF NOT EXISTS intent_classifications_org_created_at_idx ON intent_classifications(organization_id, created_at);
CREATE INDEX IF NOT EXISTS intent_classifications_routing_decision_idx ON intent_classifications(routing_decision, created_at);

CREATE TABLE IF NOT EXISTS study_messages (
  id TEXT PRIMARY KEY NOT NULL,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('user', 'assistant', 'system')),
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  message_kind TEXT NOT NULL CHECK (message_kind IN ('question', 'clarification', 'classification_notice', 'dataset_binding_notice', 'dag_note', 'approval_notice', 'run_summary', 'final_answer')),
  content_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS study_messages_study_created_at_idx ON study_messages(study_id, created_at);
CREATE INDEX IF NOT EXISTS study_messages_org_created_at_idx ON study_messages(organization_id, created_at);

CREATE TABLE IF NOT EXISTS study_dataset_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  dataset_version_id TEXT REFERENCES dataset_versions(id) ON DELETE SET NULL,
  binding_role TEXT NOT NULL CHECK (binding_role IN ('primary', 'auxiliary', 'candidate', 'external_requirement')),
  is_active INTEGER NOT NULL DEFAULT 1,
  binding_note TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS study_dataset_bindings_study_dataset_role_idx ON study_dataset_bindings(study_id, dataset_id, binding_role);
CREATE UNIQUE INDEX IF NOT EXISTS study_dataset_bindings_one_active_primary_idx ON study_dataset_bindings(study_id) WHERE binding_role = 'primary' AND is_active = 1;
CREATE INDEX IF NOT EXISTS study_dataset_bindings_active_idx ON study_dataset_bindings(study_id, is_active);
CREATE INDEX IF NOT EXISTS study_dataset_bindings_dataset_version_idx ON study_dataset_bindings(dataset_version_id);

CREATE TABLE IF NOT EXISTS causal_dags (
  id TEXT PRIMARY KEY NOT NULL,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready_for_approval', 'approved', 'superseded', 'archived')),
  current_version_id TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS causal_dags_study_status_updated_at_idx ON causal_dags(study_id, status, updated_at);
CREATE INDEX IF NOT EXISTS causal_dags_org_updated_at_idx ON causal_dags(organization_id, updated_at);

CREATE TABLE IF NOT EXISTS causal_dag_versions (
  id TEXT PRIMARY KEY NOT NULL,
  dag_id TEXT NOT NULL REFERENCES causal_dags(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  primary_dataset_version_id TEXT REFERENCES dataset_versions(id) ON DELETE SET NULL,
  graph_json TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '{}',
  layout_json TEXT NOT NULL DEFAULT '{}',
  treatment_node_key TEXT,
  outcome_node_key TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS causal_dag_versions_dag_version_idx ON causal_dag_versions(dag_id, version_number);
CREATE INDEX IF NOT EXISTS causal_dag_versions_study_created_at_idx ON causal_dag_versions(study_id, created_at);
CREATE INDEX IF NOT EXISTS causal_dag_versions_dataset_version_idx ON causal_dag_versions(primary_dataset_version_id);

CREATE TABLE IF NOT EXISTS causal_dag_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  dag_version_id TEXT NOT NULL REFERENCES causal_dag_versions(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  label TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN ('observed_feature', 'treatment', 'outcome', 'confounder', 'mediator', 'collider', 'instrument', 'selection', 'latent', 'external_data_needed', 'note')),
  source_type TEXT NOT NULL CHECK (source_type IN ('dataset', 'user', 'system')),
  observed_status TEXT NOT NULL CHECK (observed_status IN ('observed', 'unobserved', 'missing_external')),
  dataset_version_id TEXT REFERENCES dataset_versions(id) ON DELETE SET NULL,
  dataset_column_id TEXT REFERENCES dataset_version_columns(id) ON DELETE SET NULL,
  description TEXT,
  assumption_note TEXT,
  position_x REAL,
  position_y REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  CHECK (source_type != 'dataset' OR dataset_column_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS causal_dag_nodes_version_key_idx ON causal_dag_nodes(dag_version_id, node_key);
CREATE INDEX IF NOT EXISTS causal_dag_nodes_version_type_idx ON causal_dag_nodes(dag_version_id, node_type);
CREATE INDEX IF NOT EXISTS causal_dag_nodes_column_idx ON causal_dag_nodes(dataset_column_id);

CREATE TABLE IF NOT EXISTS causal_dag_edges (
  id TEXT PRIMARY KEY NOT NULL,
  dag_version_id TEXT NOT NULL REFERENCES causal_dag_versions(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  edge_key TEXT NOT NULL,
  source_node_id TEXT NOT NULL REFERENCES causal_dag_nodes(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL REFERENCES causal_dag_nodes(id) ON DELETE CASCADE,
  relationship_label TEXT NOT NULL DEFAULT 'causes',
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS causal_dag_edges_version_edge_key_idx ON causal_dag_edges(dag_version_id, edge_key);
CREATE UNIQUE INDEX IF NOT EXISTS causal_dag_edges_version_source_target_idx ON causal_dag_edges(dag_version_id, source_node_id, target_node_id);
CREATE INDEX IF NOT EXISTS causal_dag_edges_source_idx ON causal_dag_edges(source_node_id);
CREATE INDEX IF NOT EXISTS causal_dag_edges_target_idx ON causal_dag_edges(target_node_id);

CREATE TABLE IF NOT EXISTS causal_assumptions (
  id TEXT PRIMARY KEY NOT NULL,
  dag_version_id TEXT NOT NULL REFERENCES causal_dag_versions(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assumption_type TEXT NOT NULL CHECK (assumption_type IN ('no_unmeasured_confounding', 'positivity', 'consistency', 'measurement_validity', 'selection_ignorability', 'instrument_validity', 'frontdoor_sufficiency', 'custom')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'asserted' CHECK (status IN ('asserted', 'flagged', 'contested', 'accepted')),
  related_node_id TEXT REFERENCES causal_dag_nodes(id) ON DELETE SET NULL,
  related_edge_id TEXT REFERENCES causal_dag_edges(id) ON DELETE SET NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS causal_assumptions_dag_version_idx ON causal_assumptions(dag_version_id);
CREATE INDEX IF NOT EXISTS causal_assumptions_status_idx ON causal_assumptions(status, created_at);
CREATE INDEX IF NOT EXISTS causal_assumptions_related_node_idx ON causal_assumptions(related_node_id);

CREATE TABLE IF NOT EXISTS causal_data_requirements (
  id TEXT PRIMARY KEY NOT NULL,
  dag_version_id TEXT NOT NULL REFERENCES causal_dag_versions(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  related_node_id TEXT REFERENCES causal_dag_nodes(id) ON DELETE SET NULL,
  variable_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'missing' CHECK (status IN ('missing', 'requested', 'in_progress', 'collected', 'waived')),
  importance_rank INTEGER,
  reason_needed TEXT NOT NULL,
  suggested_source TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS causal_data_requirements_dag_status_idx ON causal_data_requirements(dag_version_id, status);
CREATE INDEX IF NOT EXISTS causal_data_requirements_study_status_idx ON causal_data_requirements(study_id, status);

CREATE TABLE IF NOT EXISTS causal_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  dag_version_id TEXT NOT NULL REFERENCES causal_dag_versions(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  approved_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approval_kind TEXT NOT NULL CHECK (approval_kind IN ('user_signoff', 'admin_signoff', 'compliance_signoff')),
  approval_text TEXT NOT NULL,
  approval_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS causal_approvals_dag_created_at_idx ON causal_approvals(dag_version_id, created_at);
CREATE INDEX IF NOT EXISTS causal_approvals_study_created_at_idx ON causal_approvals(study_id, created_at);
CREATE INDEX IF NOT EXISTS causal_approvals_approved_by_idx ON causal_approvals(approved_by_user_id, created_at);

CREATE TABLE IF NOT EXISTS causal_runs (
  id TEXT PRIMARY KEY NOT NULL,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  study_question_id TEXT NOT NULL REFERENCES study_questions(id) ON DELETE CASCADE,
  dag_version_id TEXT NOT NULL REFERENCES causal_dag_versions(id) ON DELETE CASCADE,
  primary_dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE RESTRICT,
  approval_id TEXT REFERENCES causal_approvals(id) ON DELETE SET NULL,
  treatment_node_key TEXT NOT NULL,
  outcome_node_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'identified', 'estimated', 'refuted', 'completed', 'failed', 'not_identifiable', 'cancelled')),
  runner_kind TEXT NOT NULL DEFAULT 'pywhy' CHECK (runner_kind IN ('pywhy', 'dowhy', 'hybrid')),
  runner_version TEXT,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  failure_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS causal_runs_study_created_at_idx ON causal_runs(study_id, created_at);
CREATE INDEX IF NOT EXISTS causal_runs_org_status_created_at_idx ON causal_runs(organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS causal_runs_dag_version_idx ON causal_runs(dag_version_id);
CREATE INDEX IF NOT EXISTS causal_runs_primary_dataset_version_idx ON causal_runs(primary_dataset_version_id);
CREATE INDEX IF NOT EXISTS causal_runs_requested_by_idx ON causal_runs(requested_by_user_id, created_at);

CREATE TABLE IF NOT EXISTS causal_run_dataset_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES causal_runs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE RESTRICT,
  binding_role TEXT NOT NULL CHECK (binding_role IN ('primary', 'auxiliary', 'candidate', 'external_requirement')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS causal_run_dataset_bindings_run_dataset_role_idx ON causal_run_dataset_bindings(run_id, dataset_version_id, binding_role);
CREATE INDEX IF NOT EXISTS causal_run_dataset_bindings_dataset_version_idx ON causal_run_dataset_bindings(dataset_version_id);

CREATE TABLE IF NOT EXISTS causal_identifications (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES causal_runs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  identified INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('backdoor', 'frontdoor', 'iv', 'mediation', 'none')),
  estimand_expression TEXT,
  adjustment_set_json TEXT NOT NULL DEFAULT '[]',
  blocking_reasons_json TEXT NOT NULL DEFAULT '[]',
  identification_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS causal_identifications_run_idx ON causal_identifications(run_id);
CREATE INDEX IF NOT EXISTS causal_identifications_identified_idx ON causal_identifications(identified, created_at);

CREATE TABLE IF NOT EXISTS causal_estimands (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES causal_runs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  estimand_kind TEXT NOT NULL CHECK (estimand_kind IN ('ate', 'att', 'atc', 'nde', 'nie', 'late', 'custom')),
  estimand_label TEXT NOT NULL,
  estimand_expression TEXT NOT NULL,
  identification_assumptions_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS causal_estimands_run_idx ON causal_estimands(run_id);
CREATE INDEX IF NOT EXISTS causal_estimands_kind_idx ON causal_estimands(estimand_kind, created_at);

CREATE TABLE IF NOT EXISTS causal_estimates (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES causal_runs(id) ON DELETE CASCADE,
  estimand_id TEXT NOT NULL REFERENCES causal_estimands(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  estimator_name TEXT NOT NULL,
  estimator_config_json TEXT NOT NULL DEFAULT '{}',
  effect_name TEXT NOT NULL,
  estimate_value REAL,
  std_error REAL,
  confidence_interval_low REAL,
  confidence_interval_high REAL,
  p_value REAL,
  estimate_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS causal_estimates_run_idx ON causal_estimates(run_id);
CREATE INDEX IF NOT EXISTS causal_estimates_estimand_idx ON causal_estimates(estimand_id);
CREATE INDEX IF NOT EXISTS causal_estimates_estimator_idx ON causal_estimates(estimator_name, created_at);

CREATE TABLE IF NOT EXISTS causal_refutations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES causal_runs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refuter_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'warning', 'not_run')),
  summary_text TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS causal_refutations_run_refuter_idx ON causal_refutations(run_id, refuter_name);
CREATE INDEX IF NOT EXISTS causal_refutations_status_idx ON causal_refutations(status, created_at);

CREATE TABLE IF NOT EXISTS compute_runs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  study_id TEXT REFERENCES causal_studies(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES causal_runs(id) ON DELETE SET NULL,
  compute_kind TEXT NOT NULL CHECK (compute_kind IN ('causal_identification', 'causal_estimation', 'causal_refutation', 'dataset_profiling', 'document_chunking')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'starting', 'running', 'finalizing', 'completed', 'failed', 'timed_out', 'rejected', 'abandoned')),
  backend TEXT NOT NULL,
  runner TEXT NOT NULL,
  failure_reason TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 0,
  cpu_limit_seconds INTEGER NOT NULL DEFAULT 0,
  memory_limit_bytes INTEGER NOT NULL DEFAULT 0,
  max_processes INTEGER NOT NULL DEFAULT 0,
  stdout_max_bytes INTEGER NOT NULL DEFAULT 0,
  artifact_max_bytes INTEGER NOT NULL DEFAULT 0,
  code_text TEXT NOT NULL DEFAULT '',
  input_manifest_json TEXT NOT NULL DEFAULT '[]',
  stdout_text TEXT,
  stderr_text TEXT,
  lease_expires_at INTEGER,
  last_heartbeat_at INTEGER,
  cleanup_status TEXT NOT NULL DEFAULT 'pending' CHECK (cleanup_status IN ('pending', 'completed', 'failed', 'skipped')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  CHECK (run_id IS NOT NULL OR study_id IS NOT NULL),
  CHECK (compute_kind NOT IN ('causal_identification', 'causal_estimation', 'causal_refutation') OR run_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS compute_runs_run_id_idx ON compute_runs(run_id);
CREATE INDEX IF NOT EXISTS compute_runs_study_id_idx ON compute_runs(study_id);
CREATE INDEX IF NOT EXISTS compute_runs_org_status_created_at_idx ON compute_runs(organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS compute_runs_status_lease_expires_at_idx ON compute_runs(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  study_id TEXT REFERENCES causal_studies(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES causal_runs(id) ON DELETE SET NULL,
  compute_run_id TEXT REFERENCES compute_runs(id) ON DELETE SET NULL,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('graph_json', 'graph_export_png', 'estimand_report', 'estimate_json', 'refutation_report', 'answer_package', 'stdout', 'stderr', 'misc')),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS run_artifacts_run_idx ON run_artifacts(run_id);
CREATE INDEX IF NOT EXISTS run_artifacts_compute_run_idx ON run_artifacts(compute_run_id);
CREATE INDEX IF NOT EXISTS run_artifacts_kind_created_at_idx ON run_artifacts(artifact_kind, created_at);
CREATE INDEX IF NOT EXISTS run_artifacts_expires_at_idx ON run_artifacts(expires_at);

CREATE TABLE IF NOT EXISTS causal_answer_packages (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES causal_runs(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  package_json TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS causal_answer_packages_run_idx ON causal_answer_packages(run_id);
CREATE INDEX IF NOT EXISTS causal_answer_packages_study_created_at_idx ON causal_answer_packages(study_id, created_at);

CREATE TABLE IF NOT EXISTS causal_answers (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES causal_runs(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES causal_studies(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  answer_package_id TEXT NOT NULL REFERENCES causal_answer_packages(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  answer_format TEXT NOT NULL DEFAULT 'markdown',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS causal_answers_run_idx ON causal_answers(run_id);
CREATE INDEX IF NOT EXISTS causal_answers_study_created_at_idx ON causal_answers(study_id, created_at);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  route_key TEXT NOT NULL,
  route_group TEXT NOT NULL,
  event_type TEXT NOT NULL,
  usage_class TEXT NOT NULL CHECK (usage_class IN ('causal_intake', 'causal_classification', 'dataset_profile', 'dag_authoring', 'causal_run', 'causal_answer', 'reference_ingest', 'system')),
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  study_id TEXT REFERENCES causal_studies(id) ON DELETE SET NULL,
  causal_run_id TEXT REFERENCES causal_runs(id) ON DELETE SET NULL,
  subject_name TEXT,
  status TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  commercial_credits INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_events_route_group_created_at_idx ON usage_events(route_group, created_at);
CREATE INDEX IF NOT EXISTS usage_events_organization_id_created_at_idx ON usage_events(organization_id, created_at);
CREATE INDEX IF NOT EXISTS usage_events_study_id_created_at_idx ON usage_events(study_id, created_at);
CREATE INDEX IF NOT EXISTS usage_events_causal_run_id_created_at_idx ON usage_events(causal_run_id, created_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id TEXT PRIMARY KEY NOT NULL,
  route_group TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  bucket_start_at INTEGER NOT NULL,
  bucket_width_seconds INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_buckets_scope_bucket_idx ON rate_limit_buckets(route_group, scope_type, scope_id, bucket_start_at, bucket_width_seconds);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_updated_at_idx ON rate_limit_buckets(updated_at);

CREATE TABLE IF NOT EXISTS operational_alerts (
  id TEXT PRIMARY KEY NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  study_id TEXT REFERENCES causal_studies(id) ON DELETE SET NULL,
  causal_run_id TEXT REFERENCES causal_runs(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS operational_alerts_status_last_seen_at_idx ON operational_alerts(status, last_seen_at);
CREATE INDEX IF NOT EXISTS operational_alerts_organization_id_last_seen_at_idx ON operational_alerts(organization_id, last_seen_at);
CREATE INDEX IF NOT EXISTS operational_alerts_causal_run_id_last_seen_at_idx ON operational_alerts(causal_run_id, last_seen_at);

CREATE TABLE IF NOT EXISTS organization_compliance_settings (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_log_retention_days INTEGER,
  usage_retention_days INTEGER,
  study_history_retention_days INTEGER,
  reference_retention_days INTEGER,
  run_artifact_retention_days INTEGER NOT NULL DEFAULT 7,
  legacy_archive_retention_days INTEGER,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_compliance_settings_org_idx ON organization_compliance_settings(organization_id);
CREATE INDEX IF NOT EXISTS organization_compliance_settings_updated_by_idx ON organization_compliance_settings(updated_by_user_id);

CREATE TABLE IF NOT EXISTS governance_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('organization_export', 'history_purge', 'reference_delete', 'legacy_archive_export')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  trigger_request_id TEXT,
  target_label TEXT NOT NULL,
  cutoff_timestamp INTEGER,
  artifact_storage_path TEXT,
  artifact_file_name TEXT,
  artifact_byte_size INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS governance_jobs_org_created_at_idx ON governance_jobs(organization_id, created_at);
CREATE INDEX IF NOT EXISTS governance_jobs_status_updated_at_idx ON governance_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS governance_jobs_type_completed_at_idx ON governance_jobs(job_type, completed_at);
