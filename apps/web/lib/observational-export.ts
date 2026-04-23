import "server-only";

import path from "node:path";
import { readFile } from "node:fs/promises";

import { and, desc, eq } from "drizzle-orm";

import { resolveOrganizationStorageRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import {
  computeRuns,
  datasetVersions,
  datasets,
  organizations,
  observationalAnswerPackages,
  observationalAnswers,
  observationalResults,
  observationalRuns,
  runArtifacts,
} from "@/lib/app-schema";
import { resolvePersistedGeneratedAssetPath } from "@/lib/python-sandbox";
import { createZipArchive } from "@/lib/zip-writer";

function parseObservationalRunMetadata(metadataJson: string) {
  try {
    const parsed = JSON.parse(metadataJson) as {
      forecastConfig?: {
        horizonUnit?: string;
        horizonValue?: number;
        timeColumnName?: string;
      } | null;
      preset?: string;
    };

    return {
      forecastConfig:
        parsed.forecastConfig &&
        typeof parsed.forecastConfig.horizonUnit === "string" &&
        typeof parsed.forecastConfig.horizonValue === "number" &&
        typeof parsed.forecastConfig.timeColumnName === "string"
          ? parsed.forecastConfig
          : null,
      preset: parsed.preset === "forecast" ? "forecast" : "standard",
    } as const;
  } catch {
    return {
      forecastConfig: null,
      preset: "standard",
    } as const;
  }
}

export class ObservationalExportError extends Error {
  readonly code: string;

  constructor(message: string, code = "observational_export_error") {
    super(message);
    this.code = code;
    this.name = "ObservationalExportError";
  }
}

function sanitizeArchiveSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return normalized || "observational-run";
}

function buildArchiveFileName(input: {
  datasetDisplayName: string | null;
  runId: string;
}) {
  const datasetSegment = sanitizeArchiveSegment(input.datasetDisplayName ?? "observational-run");
  return `${datasetSegment}-${sanitizeArchiveSegment(input.runId)}.zip`;
}

async function resolveObservationalArtifactAbsolutePath(input: {
  organizationRoot: string;
  storagePath: string;
}) {
  if (path.isAbsolute(input.storagePath)) {
    const relativeFromRoot = path.relative(input.organizationRoot, input.storagePath);
    if (
      relativeFromRoot !== "" &&
      relativeFromRoot !== ".." &&
      !relativeFromRoot.startsWith(`..${path.sep}`)
    ) {
      return input.storagePath;
    }
  }

  return resolvePersistedGeneratedAssetPath(input.organizationRoot, input.storagePath);
}

function buildReadme(input: {
  answerCount: number;
  artifactCount: number;
  computeRunCount: number;
  datasetDisplayName: string | null;
  runId: string;
}) {
  return `# Observational run export

This export bundles the stored observational run state for **${input.datasetDisplayName ?? "Observational run"}** (${input.runId}).

## Included

- \`manifest.json\`: export manifest and high-level metadata
- \`run/run.json\`: observational run row snapshot
- \`run/result.json\`: observational result row snapshot when available
- \`run/answer-package.json\`: stored observational answer package when available
- \`run/answers.json\`: grounded observational answer history
- \`run/compute-runs.json\`: compute telemetry history
- \`run/artifacts.json\`: artifact metadata
- \`artifacts/*\`: downloadable stored artifact files attached to the observational run

## Notes

- This package mirrors the stored observational run state; it does not re-run the model.
- Observational and associational outputs in this package do not establish causal effects.
- Artifact count: ${input.artifactCount}
- Compute run count: ${input.computeRunCount}
- Grounded answer count: ${input.answerCount}
`;
}

export async function exportObservationalRunZip(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [run] = await db
    .select()
    .from(observationalRuns)
    .where(and(eq(observationalRuns.id, input.runId), eq(observationalRuns.organizationId, input.organizationId)));

  if (!run) {
    throw new ObservationalExportError("Observational run not found.", "observational_run_not_found");
  }

  const metadata = parseObservationalRunMetadata(run.metadataJson);

  const [[organization], [dataset], [datasetVersion], [result], [answerPackage], answers, artifacts, compute] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, input.organizationId)),
    db.select().from(datasets).where(eq(datasets.id, run.datasetId)),
    db.select().from(datasetVersions).where(eq(datasetVersions.id, run.datasetVersionId)),
    db.select().from(observationalResults).where(eq(observationalResults.runId, run.id)),
    db.select().from(observationalAnswerPackages).where(eq(observationalAnswerPackages.runId, run.id)),
    db.select().from(observationalAnswers).where(eq(observationalAnswers.runId, run.id)).orderBy(desc(observationalAnswers.createdAt)),
    db.select().from(runArtifacts).where(eq(runArtifacts.predictiveRunId, run.id)).orderBy(desc(runArtifacts.createdAt)),
    db.select().from(computeRuns).where(eq(computeRuns.predictiveRunId, run.id)).orderBy(desc(computeRuns.createdAt)),
  ]);

  if (!organization) {
    throw new ObservationalExportError(
      "Organization not found for observational run export.",
      "observational_export_org_missing",
    );
  }

  const manifest = {
    answer_count: answers.length,
    artifact_count: artifacts.length,
    compute_run_count: compute.length,
    dataset: dataset
      ? {
          dataset_key: dataset.datasetKey,
          display_name: dataset.displayName,
          id: dataset.id,
        }
      : null,
    dataset_version: datasetVersion
      ? {
          id: datasetVersion.id,
          row_count: datasetVersion.rowCount,
          version_number: datasetVersion.versionNumber,
        }
      : null,
    exported_at: Date.now(),
    organization: {
      id: organization.id,
      slug: organization.slug,
    },
    run: {
      claim_label: run.claimLabel,
      forecast_config: metadata.forecastConfig,
      id: run.id,
      preset: metadata.preset,
      status: run.status,
      target_column_name: run.targetColumnName,
      task_kind: run.taskKind,
    },
  };

  const artifactEntries = await Promise.all(
    artifacts.map(async (artifact, index) => {
      const organizationRoot = await resolveOrganizationStorageRoot(organization.slug);
      const absolutePath = await resolveObservationalArtifactAbsolutePath({
        organizationRoot,
        storagePath: artifact.storagePath,
      });
      const content = await readFile(absolutePath);
      const normalizedFileName = sanitizeArchiveSegment(String(index + 1).padStart(2, "0"));

      return {
        content,
        fileName: `artifacts/${normalizedFileName}-${artifact.fileName}`,
      };
    }),
  );

  const entries = [
    {
      content: buildReadme({
        answerCount: answers.length,
        artifactCount: artifacts.length,
        computeRunCount: compute.length,
        datasetDisplayName: dataset?.displayName ?? null,
        runId: run.id,
      }),
      fileName: "README.md",
    },
    {
      content: JSON.stringify(manifest, null, 2),
      fileName: "manifest.json",
    },
    {
      content: JSON.stringify(run, null, 2),
      fileName: "run/run.json",
    },
    {
      content: JSON.stringify(dataset ?? null, null, 2),
      fileName: "run/dataset.json",
    },
    {
      content: JSON.stringify(datasetVersion ?? null, null, 2),
      fileName: "run/dataset-version.json",
    },
    {
      content: JSON.stringify(result ?? null, null, 2),
      fileName: "run/result.json",
    },
    {
      content: JSON.stringify(answerPackage ?? null, null, 2),
      fileName: "run/answer-package.json",
    },
    {
      content: JSON.stringify(answers, null, 2),
      fileName: "run/answers.json",
    },
    {
      content: JSON.stringify(compute, null, 2),
      fileName: "run/compute-runs.json",
    },
    {
      content: JSON.stringify(artifacts, null, 2),
      fileName: "run/artifacts.json",
    },
    ...artifactEntries,
  ];

  return {
    archiveFileName: buildArchiveFileName({
      datasetDisplayName: dataset?.displayName ?? null,
      runId: run.id,
    }),
    buffer: createZipArchive(entries),
  };
}
