import { parseArgs, restoreBackup } from "./lib/recovery.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backupDir = (args.backup ?? "").trim();
  const databasePath = (args["database-path"] ?? "").trim();
  const storageRoot = (args["storage-root"] ?? "").trim();

  if (!backupDir || !databasePath || !storageRoot) {
    throw new Error(
      [
        "Usage: node ./scripts/restore-backup.mjs",
        "--backup <backup-directory>",
        "--database-path <target-database-path>",
        "--storage-root <target-storage-root>",
      ].join(" "),
    );
  }

  const result = await restoreBackup({
    backupDir,
    databasePath,
    storageRoot,
  });
  console.log(
    JSON.stringify({
      deploymentMode: result.manifest.deploymentMode,
      organizations: result.restoredOrganizationSlugs,
      restoredDatabasePath: result.databasePath,
      restoredStorageRoot: result.storageRoot,
      ok: true,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
