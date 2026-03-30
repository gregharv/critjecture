import { parseArgs } from "./lib/recovery.mjs";
import {
  createSingleOrgReleaseProof,
  getReleaseProofCliDefaults,
  parseFollowUpItemsArg,
} from "./lib/release-proof.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaults = getReleaseProofCliDefaults();

  if (
    !(args.environment ?? "").trim() ||
    !(args.operator ?? "").trim() ||
    !(args["checklist-kind"] ?? "").trim() ||
    !(args["change-scope"] ?? "").trim() ||
    !(args["restore-drill"] ?? "").trim() ||
    !(args["secret-storage-owner"] ?? "").trim() ||
    !(args["secret-rotation-owner"] ?? "").trim() ||
    !(args["tls-termination"] ?? "").trim() ||
    !(args["storage-encryption"] ?? "").trim() ||
    !(args["backup-encryption"] ?? "").trim() ||
    !(args["alert-webhook-owner"] ?? "").trim() ||
    !(args["incident-contact"] ?? "").trim()
  ) {
    throw new Error(
      [
        "Usage: node ./scripts/release-proof-single-org.mjs",
        "--environment <environment-label>",
        "--operator <operator-name>",
        "--checklist-kind <first_customer_deployment|routine_upgrade>",
        "--change-scope <app_only|migration|storage_layout|migration_and_storage>",
        "--restore-drill <restore-drill-json-path>",
        "--secret-storage-owner <owner>",
        "--secret-rotation-owner <owner>",
        "--tls-termination <expectation>",
        "--storage-encryption <expectation>",
        "--backup-encryption <expectation>",
        "--alert-webhook-owner <owner>",
        "--incident-contact <contact>",
        `[--output-dir ${defaults.outputDir}]`,
        `[--backup-output-dir ${defaults.backupOutputDir}]`,
        "[--build-ref <build-ref>]",
        "[--notes <release-notes>]",
        '[--follow-up-items "item one|item two"]',
      ].join(" "),
    );
  }

  const result = await createSingleOrgReleaseProof({
    alertWebhookOwner: (args["alert-webhook-owner"] ?? "").trim(),
    backupEncryption: (args["backup-encryption"] ?? "").trim(),
    backupOutputDir: (args["backup-output-dir"] ?? "").trim() || defaults.backupOutputDir,
    buildRef: (args["build-ref"] ?? "").trim(),
    changeScope: (args["change-scope"] ?? "").trim(),
    checklistKind: (args["checklist-kind"] ?? "").trim(),
    environmentLabel: (args.environment ?? "").trim(),
    followUpItems: parseFollowUpItemsArg(args["follow-up-items"]),
    incidentContact: (args["incident-contact"] ?? "").trim(),
    notes: (args.notes ?? "").trim(),
    operatorName: (args.operator ?? "").trim(),
    outputDir: (args["output-dir"] ?? "").trim() || defaults.outputDir,
    restoreDrillPath: (args["restore-drill"] ?? "").trim(),
    secretRotationOwner: (args["secret-rotation-owner"] ?? "").trim(),
    secretStorageOwner: (args["secret-storage-owner"] ?? "").trim(),
    storageEncryption: (args["storage-encryption"] ?? "").trim(),
    tlsTermination: (args["tls-termination"] ?? "").trim(),
  });

  console.log(
    JSON.stringify({
      backupVerificationExecuted: result.record.verification.backupVerificationExecuted,
      changeScope: result.record.changeScope,
      checklistKind: result.record.checklistKind,
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
