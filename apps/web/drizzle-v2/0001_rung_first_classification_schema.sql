ALTER TABLE intent_classifications RENAME TO intent_classifications_legacy;

DROP INDEX IF EXISTS intent_classifications_question_created_at_idx;
DROP INDEX IF EXISTS intent_classifications_org_created_at_idx;
DROP INDEX IF EXISTS intent_classifications_routing_decision_idx;

CREATE TABLE IF NOT EXISTS intent_classifications (
  id TEXT PRIMARY KEY NOT NULL,
  study_question_id TEXT NOT NULL REFERENCES study_questions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  classifier_model_name TEXT NOT NULL,
  classifier_prompt_version TEXT NOT NULL,
  raw_output_json TEXT NOT NULL,
  is_analytical INTEGER NOT NULL,
  required_rung TEXT CHECK (required_rung IN ('rung_1_observational', 'rung_2_interventional', 'rung_3_counterfactual')),
  task_form TEXT NOT NULL CHECK (task_form IN ('describe', 'predict', 'explain', 'advise', 'compare', 'teach', 'critique', 'unknown')),
  guardrail_flag TEXT NOT NULL CHECK (guardrail_flag IN ('none', 'unsupported_rung_jump', 'unsupported_direct_mechanism', 'unsupported_actual_cause_presupposition')),
  confidence REAL NOT NULL,
  reason_text TEXT NOT NULL,
  routing_decision TEXT NOT NULL CHECK (routing_decision IN ('continue_chat', 'open_rung1_analysis', 'open_rung2_study', 'open_rung3_study', 'ask_clarification', 'blocked')),
  created_at INTEGER NOT NULL
);

INSERT INTO intent_classifications (
  id,
  study_question_id,
  organization_id,
  classifier_model_name,
  classifier_prompt_version,
  raw_output_json,
  is_analytical,
  required_rung,
  task_form,
  guardrail_flag,
  confidence,
  reason_text,
  routing_decision,
  created_at
)
SELECT
  id,
  study_question_id,
  organization_id,
  classifier_model_name,
  classifier_prompt_version,
  raw_output_json,
  1 AS is_analytical,
  CASE
    WHEN intent_type = 'counterfactual' THEN 'rung_3_counterfactual'
    WHEN is_causal = 1 THEN 'rung_2_interventional'
    WHEN intent_type IN ('associational', 'predictive') THEN 'rung_1_observational'
    ELSE NULL
  END AS required_rung,
  CASE
    WHEN intent_type = 'predictive' THEN 'predict'
    WHEN intent_type = 'diagnostic' THEN 'explain'
    WHEN intent_type = 'counterfactual' THEN 'compare'
    WHEN intent_type = 'causal' THEN 'advise'
    ELSE 'describe'
  END AS task_form,
  'none' AS guardrail_flag,
  confidence,
  reason_text,
  CASE
    WHEN routing_decision = 'continue_descriptive' THEN 'continue_chat'
    WHEN routing_decision = 'open_predictive_analysis' THEN 'open_rung1_analysis'
    WHEN routing_decision = 'open_causal_study' AND intent_type = 'counterfactual' THEN 'open_rung3_study'
    WHEN routing_decision = 'open_causal_study' THEN 'open_rung2_study'
    ELSE routing_decision
  END AS routing_decision,
  created_at
FROM intent_classifications_legacy;

DROP TABLE intent_classifications_legacy;

CREATE INDEX IF NOT EXISTS intent_classifications_question_created_at_idx ON intent_classifications(study_question_id, created_at);
CREATE INDEX IF NOT EXISTS intent_classifications_org_created_at_idx ON intent_classifications(organization_id, created_at);
CREATE INDEX IF NOT EXISTS intent_classifications_routing_decision_idx ON intent_classifications(routing_decision, created_at);
