ALTER TABLE `sandbox_runs`
ADD COLUMN `inline_workspace_files_json` text NOT NULL DEFAULT '[]';

CREATE TABLE `analysis_results` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `turn_id` text NOT NULL REFERENCES `chat_turns`(`id`) ON DELETE cascade,
  `input_files_json` text NOT NULL DEFAULT '[]',
  `csv_schemas_json` text NOT NULL DEFAULT '[]',
  `chart_json` text NOT NULL,
  `point_count` integer NOT NULL,
  `payload_bytes` integer NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);

CREATE INDEX `analysis_results_expires_at_idx`
ON `analysis_results` (`expires_at`);

CREATE INDEX `analysis_results_org_turn_user_idx`
ON `analysis_results` (`organization_id`, `turn_id`, `user_id`);
