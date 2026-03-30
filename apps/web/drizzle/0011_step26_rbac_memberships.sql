CREATE TABLE `organization_memberships__step26_new` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `role` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `monthly_credit_cap` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `organization_memberships_role_check`
    CHECK (`role` in ('member', 'admin', 'owner')),
  CONSTRAINT `organization_memberships_status_check`
    CHECK (`status` in ('active', 'restricted', 'suspended'))
);

INSERT INTO `organization_memberships__step26_new` (
  `id`,
  `organization_id`,
  `user_id`,
  `role`,
  `status`,
  `monthly_credit_cap`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `organization_id`,
  `user_id`,
  CASE
    WHEN `role` = 'owner' THEN 'owner'
    ELSE 'member'
  END,
  CASE
    WHEN `status` = 'suspended' THEN 'suspended'
    ELSE 'active'
  END,
  `monthly_credit_cap`,
  `created_at`,
  `updated_at`
FROM `organization_memberships`;

DROP TABLE `organization_memberships`;

ALTER TABLE `organization_memberships__step26_new`
RENAME TO `organization_memberships`;

CREATE UNIQUE INDEX `organization_memberships_org_user_idx`
ON `organization_memberships` (`organization_id`, `user_id`);

CREATE INDEX `organization_memberships_org_status_idx`
ON `organization_memberships` (`organization_id`, `status`);
