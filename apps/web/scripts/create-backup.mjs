import { createBackupFromEnv, parseArgs } from "./lib/recovery.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = (args["output-dir"] ?? "").trim();

  if (!outputDir) {
    throw new Error(
      "Usage: node ./scripts/create-backup.mjs --output-dir <backup-parent-directory>",
    );
  }

  const result = await createBackupFromEnv({ outputDir });
  console.log(
    JSON.stringify({
      backupDir: result.backupDir,
      createdAt: result.manifest.createdAt,
      deploymentMode: result.manifest.deploymentMode,
      organizations: result.manifest.organizations,
      ok: true,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
