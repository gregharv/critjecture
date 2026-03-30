import { parseArgs, verifyBackupDrills } from "./lib/recovery.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deploymentMode = (args["deployment-mode"] ?? "both").trim().toLowerCase();
  const result = await verifyBackupDrills({ deploymentMode });

  console.log(
    JSON.stringify({
      deploymentMode: result.deploymentMode,
      drills: result.results,
      ok: true,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
