import { parseArgs } from "./lib/recovery.mjs";
import {
  getReleaseProofCliDefaults,
  parseFollowUpItemsArg,
  runSingleOrgRestoreDrill,
} from "./lib/release-proof.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaults = getReleaseProofCliDefaults();
  const environmentLabel = (args.environment ?? "").trim();
  const operatorName = (args.operator ?? "").trim();

  if (!environmentLabel || !operatorName) {
    throw new Error(
      [
        "Usage: node ./scripts/restore-drill-single-org.mjs",
        "--environment <environment-label>",
        "--operator <operator-name>",
        `[--output-dir ${defaults.outputDir}]`,
        `[--backup-output-dir ${defaults.backupOutputDir}]`,
        "[--notes <sign-off-notes>]",
        '[--follow-up-items "item one|item two"]',
      ].join(" "),
    );
  }

  const result = await runSingleOrgRestoreDrill({
    backupOutputDir: (args["backup-output-dir"] ?? "").trim() || defaults.backupOutputDir,
    environmentLabel,
    followUpItems: parseFollowUpItemsArg(args["follow-up-items"]),
    notes: (args.notes ?? "").trim(),
    operatorName,
    outputDir: (args["output-dir"] ?? "").trim() || defaults.outputDir,
  });

  console.log(
    JSON.stringify({
      backupDir: result.record.backup.backupDir,
      environmentLabel: result.record.environmentLabel,
      jsonPath: result.jsonPath,
      markdownPath: result.markdownPath,
      ok: true,
      operator: result.record.operator.name,
      recordType: result.record.recordType,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
