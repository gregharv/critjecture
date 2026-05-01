import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const values = {};

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (!entry.startsWith("--")) {
      continue;
    }

    const key = entry.slice(2);
    const nextValue = argv[index + 1];
    values[key] = nextValue && !nextValue.startsWith("--") ? nextValue : "true";

    if (values[key] === nextValue) {
      index += 1;
    }
  }

  return values;
}

function normalizeSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "critjecture-org";
}

function parseConfiguredFilePath(value, baseDir) {
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("file:")) {
    return fileURLToPath(new URL(trimmed));
  }

  return path.resolve(baseDir, trimmed);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

async function ensureOrganizationCompanyDataRoot(storageRoot, organizationSlug) {
  const organizationRoot = path.join(storageRoot, "organizations", organizationSlug);
  const companyDataRoot = path.join(organizationRoot, "company_data");

  await mkdir(companyDataRoot, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const organizationName = (args["organization-name"] ?? "").trim();
  const organizationSlug = normalizeSlug(args["organization-slug"] ?? organizationName);
  const hostedOrganizationSlug = normalizeSlug(
    args["hosted-organization-slug"] ?? process.env.CRITJECTURE_HOSTED_ORGANIZATION_SLUG ?? organizationSlug,
  );
  const ownerEmail = (args["owner-email"] ?? "").trim().toLowerCase();
  const ownerPassword = (args["owner-password"] ?? "").trim();
  const ownerName = (args["owner-name"] ?? "Owner").trim() || "Owner";
  const internEmail = (args["intern-email"] ?? "").trim().toLowerCase();
  const internPassword = (args["intern-password"] ?? "").trim();
  const internName = (args["intern-name"] ?? "Intern").trim() || "Intern";

  if (!organizationName || !ownerEmail || !ownerPassword) {
    throw new Error(
      "Usage: node ./scripts/provision-hosted-org.mjs --organization-name <name> --owner-email <email> --owner-password <password> [--organization-slug <slug>] [--hosted-organization-slug <slug>] [--owner-name <name>] [--intern-email <email> --intern-password <password> --intern-name <name>]",
    );
  }

  if (!hostedOrganizationSlug) {
    throw new Error(
      "Hosted provisioning requires CRITJECTURE_HOSTED_ORGANIZATION_SLUG or --hosted-organization-slug.",
    );
  }

  if (organizationSlug !== hostedOrganizationSlug) {
    throw new Error(
      `Hosted provisioning is bound to organization "${hostedOrganizationSlug}". Refusing to provision "${organizationSlug}".`,
    );
  }

  const storageRoot =
    parseConfiguredFilePath(process.env.CRITJECTURE_STORAGE_ROOT, repositoryRoot) ??
    path.join(repositoryRoot, "storage");
  const dbPath =
    parseConfiguredFilePath(
      process.env.CRITJECTURE_LEGACY_DATABASE_URL ?? process.env.LEGACY_DATABASE_URL ?? process.env.DATABASE_URL,
      repositoryRoot,
    ) ?? path.join(storageRoot, "critjecture.sqlite");

  await mkdir(path.dirname(dbPath), { recursive: true });
  await mkdir(storageRoot, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");

  const organizationCountRow = sqlite
    .prepare("SELECT COUNT(*) AS count FROM organizations")
    .get();
  const organizationCount = Number(organizationCountRow?.count ?? 0);

  if (organizationCount > 0) {
    throw new Error(
      `Hosted mode permits exactly one organization per deployment cell. This deployment already contains ${organizationCount} organization${organizationCount === 1 ? "" : "s"}.`,
    );
  }

  const organizationExists = sqlite
    .prepare("SELECT id FROM organizations WHERE slug = ? LIMIT 1")
    .get(organizationSlug);

  if (organizationExists) {
    throw new Error(`Organization slug "${organizationSlug}" already exists.`);
  }

  const userExists = sqlite
    .prepare("SELECT id FROM users WHERE email IN (?, ?)")
    .all(ownerEmail, internEmail || ownerEmail);

  if (userExists.length > 0) {
    throw new Error("One of the requested user emails already exists.");
  }

  const now = Date.now();
  const organizationId = randomUUID();
  const ownerUserId = randomUUID();

  const insertOrganization = sqlite.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertUser = sqlite.prepare(
    "INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
  );
  const insertMembership = sqlite.prepare(
    "INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const tx = sqlite.transaction(() => {
    insertOrganization.run(organizationId, organizationName, organizationSlug, now, now);
    insertUser.run(
      ownerUserId,
      ownerEmail,
      ownerName,
      "owner",
      hashPassword(ownerPassword),
      now,
      now,
    );
    insertMembership.run(randomUUID(), organizationId, ownerUserId, "owner", now, now);

    if (internEmail && internPassword) {
      const internUserId = randomUUID();
      insertUser.run(
        internUserId,
        internEmail,
        internName,
        "intern",
        hashPassword(internPassword),
        now,
        now,
      );
      insertMembership.run(randomUUID(), organizationId, internUserId, "member", now, now);
    }
  });

  tx();
  await ensureOrganizationCompanyDataRoot(storageRoot, organizationSlug);

  console.log(
    JSON.stringify({
      ok: true,
      hostedOrganizationSlug,
      organizationId,
      organizationName,
      organizationSlug,
      ownerEmail,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
