ALTER TABLE `organization_memberships`
ADD COLUMN `status` text NOT NULL DEFAULT 'active';

ALTER TABLE `organization_memberships`
ADD COLUMN `monthly_credit_cap` integer;

CREATE INDEX `organization_memberships_org_status_idx`
ON `organization_memberships` (`organization_id`, `status`);

CREATE TABLE `workspace_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `plan_code` text NOT NULL,
  `plan_name` text NOT NULL,
  `monthly_included_credits` integer NOT NULL,
  `billing_anchor_at` integer NOT NULL,
  `current_window_start_at` integer NOT NULL,
  `current_window_end_at` integer NOT NULL,
  `hard_cap_behavior` text NOT NULL DEFAULT 'block',
  `rate_card_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `workspace_plans_hard_cap_behavior_check`
    CHECK (`hard_cap_behavior` in ('block'))
);

CREATE UNIQUE INDEX `workspace_plans_organization_id_idx`
ON `workspace_plans` (`organization_id`);

CREATE INDEX `workspace_plans_window_end_idx`
ON `workspace_plans` (`current_window_end_at`);

CREATE TABLE `workspace_commercial_ledger` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `request_id` text NOT NULL,
  `request_log_id` text REFERENCES `request_logs`(`id`) ON DELETE set null,
  `route_group` text NOT NULL,
  `usage_class` text NOT NULL,
  `credits_delta` integer NOT NULL,
  `window_start_at` integer NOT NULL,
  `window_end_at` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'reserved',
  `metadata_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `workspace_commercial_ledger_usage_class_check`
    CHECK (`usage_class` in ('analysis', 'chart', 'chat', 'document', 'import')),
  CONSTRAINT `workspace_commercial_ledger_status_check`
    CHECK (`status` in ('reserved', 'committed', 'released', 'blocked'))
);

CREATE INDEX `workspace_commercial_ledger_request_id_idx`
ON `workspace_commercial_ledger` (`request_id`);

CREATE INDEX `workspace_commercial_ledger_org_window_status_idx`
ON `workspace_commercial_ledger` (`organization_id`, `window_start_at`, `status`);

CREATE INDEX `workspace_commercial_ledger_user_window_status_idx`
ON `workspace_commercial_ledger` (`user_id`, `window_start_at`, `status`);

ALTER TABLE `usage_events`
ADD COLUMN `usage_class` text NOT NULL DEFAULT 'system';

ALTER TABLE `usage_events`
ADD COLUMN `commercial_credits` integer NOT NULL DEFAULT 0;
