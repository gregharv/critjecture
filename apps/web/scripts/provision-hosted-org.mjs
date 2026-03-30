import Database from "better-sqlite3";
import { cp, mkdir, readdir } from "node:fs/promises";
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

async function directoryHasEntries(targetPath) {
  try {
    const entries = await readdir(targetPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function ensureOrganizationCompanyDataRoot(repositoryRoot, storageRoot, organizationSlug) {
  const organizationRoot = path.join(storageRoot, "organizations", organizationSlug);
  const companyDataRoot = path.join(organizationRoot, "company_data");
  const templateRoot = path.join(repositoryRoot, "sample_company_data");

  await mkdir(organizationRoot, { recursive: true });

  if (!(await directoryHasEntries(companyDataRoot))) {
    await cp(templateRoot, companyDataRoot, { recursive: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const organizationName = (args["organization-name"] ?? "").trim();
  const organizationSlug = normalizeSlug(args["organization-slug"] ?? organizationName);
  const ownerEmail = (args["owner-email"] ?? "").trim().toLowerCase();
  const ownerPassword = (args["owner-password"] ?? "").trim();
  const ownerName = (args["owner-name"] ?? "Owner").trim() || "Owner";
  const internEmail = (args["intern-email"] ?? "").trim().toLowerCase();
  const internPassword = (args["intern-password"] ?? "").trim();
  const internName = (args["intern-name"] ?? "Intern").trim() || "Intern";

  if (!organizationName || !ownerEmail || !ownerPassword) {
    throw new Error(
      "Usage: node ./scripts/provision-hosted-org.mjs --organization-name <name> --owner-email <email> --owner-password <password> [--organization-slug <slug>] [--owner-name <name>] [--intern-email <email> --intern-password <password> --intern-name <name>]",
    );
  }

  const storageRoot =
    parseConfiguredFilePath(process.env.CRITJECTURE_STORAGE_ROOT, repositoryRoot) ??
    path.join(repositoryRoot, "storage");
  const dbPath =
    parseConfiguredFilePath(process.env.DATABASE_URL, repositoryRoot) ??
    path.join(storageRoot, "critjecture.sqlite");

  await mkdir(path.dirname(dbPath), { recursive: true });
  await mkdir(storageRoot, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");

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
  await ensureOrganizationCompanyDataRoot(repositoryRoot, storageRoot, organizationSlug);

  console.log(
    JSON.stringify({
      ok: true,
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
