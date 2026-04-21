import "server-only";

import path from "node:path";
import { readFile } from "node:fs/promises";

import { and, desc, eq } from "drizzle-orm";

import { resolveOrganizationStorageRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import {
  causalAnswerPackages,
  causalAnswers,
  causalEstimates,
  causalEstimands,
  causalIdentifications,
  causalRefutations,
  causalRuns,
  causalStudies,
  computeRuns,
  organizations,
  runArtifacts,
  studyQuestions,
} from "@/lib/app-schema";
import { resolvePersistedGeneratedAssetPath } from "@/lib/python-sandbox";
import { createZipArchive } from "@/lib/zip-writer";

export class CausalExportError extends Error {
  readonly code: string;

  constructor(message: string, code = "causal_export_error") {
    super(message);
    this.code = code;
    this.name = "CausalExportError";
  }
}

function sanitizeArchiveSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return normalized || "causal-run";
}

function buildArchiveFileName(input: {
  runId: string;
  studyTitle: string | null;
}) {
  const studySegment = sanitizeArchiveSegment(input.studyTitle ?? "causal-run");
  return `${studySegment}-${sanitizeArchiveSegment(input.runId)}.zip`;
}

async function resolveCausalArtifactAbsolutePath(input: {
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
  runId: string;
  studyTitle: string | null;
}) {
  return `# Causal run export

This export bundles the stored causal run state for **${input.studyTitle ?? "Causal run"}** (${input.runId}).

## Included

- \`manifest.json\`: export manifest and high-level metadata
- \`run/run.json\`: causal run row snapshot
- \`run/study.json\`: study snapshot when available
- \`run/question.json\`: study question snapshot when available
- \`run/identification.json\`: stored identification record
- \`run/estimands.json\`: identified estimands
- \`run/estimates.json\`: causal estimate rows
- \`run/refutations.json\`: stored refutation rows
- \`run/answer-package.json\`: stored causal answer package when available
- \`run/answers.json\`: grounded causal answer history
- \`run/compute-runs.json\`: compute telemetry history
- \`run/artifacts.json\`: artifact metadata
- \`artifacts/*\`: downloadable stored artifact files attached to the causal run

## Notes

- This package mirrors the stored causal run state; it does not re-run estimation.
- Causal conclusions still depend on the DAG, identification assumptions, and refutation results captured here.
- Artifact count: ${input.artifactCount}
- Compute run count: ${input.computeRunCount}
- Grounded answer count: ${input.answerCount}
`;
}

export async function exportCausalRunZip(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [run] = await db
    .select()
    .from(causalRuns)
    .where(and(eq(causalRuns.id, input.runId), eq(causalRuns.organizationId, input.organizationId)));

  if (!run) {
    throw new CausalExportError("Causal run not found.", "causal_run_not_found");
  }

  const [[organization], [study], [question], [identification], estimands, estimates, refutations, [answerPackage], answers, artifacts, compute] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, input.organizationId)),
    db.select().from(causalStudies).where(eq(causalStudies.id, run.studyId)),
    db.select().from(studyQuestions).where(eq(studyQuestions.id, run.studyQuestionId)),
    db.select().from(causalIdentifications).where(eq(causalIdentifications.runId, run.id)),
    db.select().from(causalEstimands).where(eq(causalEstimands.runId, run.id)).orderBy(desc(causalEstimands.createdAt)),
    db.select().from(causalEstimates).where(eq(causalEstimates.runId, run.id)).orderBy(desc(causalEstimates.createdAt)),
    db.select().from(causalRefutations).where(eq(causalRefutations.runId, run.id)).orderBy(desc(causalRefutations.createdAt)),
    db.select().from(causalAnswerPackages).where(eq(causalAnswerPackages.runId, run.id)),
    db.select().from(causalAnswers).where(eq(causalAnswers.runId, run.id)).orderBy(desc(causalAnswers.createdAt)),
    db.select().from(runArtifacts).where(eq(runArtifacts.runId, run.id)).orderBy(desc(runArtifacts.createdAt)),
    db.select().from(computeRuns).where(eq(computeRuns.runId, run.id)).orderBy(desc(computeRuns.createdAt)),
  ]);

  if (!organization) {
    throw new CausalExportError("Organization not found for causal run export.", "causal_export_org_missing");
  }

  const manifest = {
    answer_count: answers.length,
    artifact_count: artifacts.length,
    compute_run_count: compute.length,
    exported_at: Date.now(),
    organization: {
      id: organization.id,
      slug: organization.slug,
    },
    run: {
      dag_version_id: run.dagVersionId,
      id: run.id,
      outcome_node_key: run.outcomeNodeKey,
      primary_dataset_version_id: run.primaryDatasetVersionId,
      status: run.status,
      treatment_node_key: run.treatmentNodeKey,
    },
    study: study
      ? {
          id: study.id,
          status: study.status,
          title: study.title,
        }
      : null,
  };

  const artifactEntries = await Promise.all(
    artifacts.map(async (artifact, index) => {
      const organizationRoot = await resolveOrganizationStorageRoot(organization.slug);
      const absolutePath = await resolveCausalArtifactAbsolutePath({
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
        runId: run.id,
        studyTitle: study?.title ?? null,
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
      content: JSON.stringify(study ?? null, null, 2),
      fileName: "run/study.json",
    },
    {
      content: JSON.stringify(question ?? null, null, 2),
      fileName: "run/question.json",
    },
    {
      content: JSON.stringify(identification ?? null, null, 2),
      fileName: "run/identification.json",
    },
    {
      content: JSON.stringify(estimands, null, 2),
      fileName: "run/estimands.json",
    },
    {
      content: JSON.stringify(estimates, null, 2),
      fileName: "run/estimates.json",
    },
    {
      content: JSON.stringify(refutations, null, 2),
      fileName: "run/refutations.json",
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
      runId: run.id,
      studyTitle: study?.title ?? null,
    }),
    buffer: createZipArchive(entries),
  };
}
