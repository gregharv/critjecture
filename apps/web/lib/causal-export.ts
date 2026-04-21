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

function buildComparisonArchiveFileName(input: {
  baseRunId: string;
  studyTitle: string | null;
  targetRunId: string;
}) {
  const studySegment = sanitizeArchiveSegment(input.studyTitle ?? "causal-comparison");
  return `${studySegment}-compare-${sanitizeArchiveSegment(input.baseRunId)}-vs-${sanitizeArchiveSegment(input.targetRunId)}.zip`;
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

function buildComparisonReadme(input: {
  baseRunId: string;
  studyTitle: string | null;
  targetRunId: string;
}) {
  return `# Causal run comparison export

This export bundles a comparison snapshot for **${input.studyTitle ?? "Causal study"}**.

## Compared runs

- Baseline: ${input.baseRunId}
- Comparison: ${input.targetRunId}

## Included

- \`manifest.json\`: export manifest and high-level metadata
- \`compare/summary.json\`: computed comparison summary and deltas
- \`study/study.json\`: shared study snapshot
- \`runs/base/*\`: stored baseline run state
- \`runs/target/*\`: stored comparison run state
- \`artifacts/base/*\`: baseline artifacts
- \`artifacts/target/*\`: comparison artifacts

## Notes

- This package compares already stored causal run state only.
- Deltas reflect persisted identification, estimate, answer, refutation, compute, and artifact records.
- Use this export when you need an auditable comparison snapshot outside the app UI.
`;
}

function parseJsonStringArray(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function areStringSetsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const leftSorted = [...left].sort((a, b) => a.localeCompare(b));
  const rightSorted = [...right].sort((a, b) => a.localeCompare(b));

  return leftSorted.every((value, index) => value === rightSorted[index]);
}

async function getCausalRunExportSnapshot(input: {
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

  const [[study], [question], [identification], estimands, estimates, refutations, [answerPackage], answers, artifacts, compute] = await Promise.all([
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

  return {
    answerPackage: answerPackage ?? null,
    answers,
    artifacts,
    compute,
    estimates,
    estimands,
    identification: identification ?? null,
    question: question ?? null,
    refutations,
    run,
    study: study ?? null,
  };
}

async function buildArtifactEntries(input: {
  artifacts: typeof runArtifacts.$inferSelect[];
  organizationRoot: string;
  prefix: string;
}) {
  return Promise.all(
    input.artifacts.map(async (artifact, index) => {
      const absolutePath = await resolveCausalArtifactAbsolutePath({
        organizationRoot: input.organizationRoot,
        storagePath: artifact.storagePath,
      });
      const content = await readFile(absolutePath);
      const normalizedFileName = sanitizeArchiveSegment(String(index + 1).padStart(2, "0"));

      return {
        content,
        fileName: `${input.prefix}/${normalizedFileName}-${artifact.fileName}`,
      };
    }),
  );
}

export async function exportCausalRunZip(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [[organization], snapshot] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, input.organizationId)),
    getCausalRunExportSnapshot(input),
  ]);

  if (!organization) {
    throw new CausalExportError("Organization not found for causal run export.", "causal_export_org_missing");
  }

  const { answerPackage, answers, artifacts, compute, estimates, estimands, identification, question, refutations, run, study } = snapshot;

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

  const organizationRoot = await resolveOrganizationStorageRoot(organization.slug);
  const artifactEntries = await buildArtifactEntries({
    artifacts,
    organizationRoot,
    prefix: "artifacts",
  });

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

export async function exportCausalRunComparisonZip(input: {
  baseRunId: string;
  organizationId: string;
  studyId: string;
  targetRunId: string;
}) {
  const db = await getAppDatabase();
  const [[organization], baseSnapshot, targetSnapshot] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, input.organizationId)),
    getCausalRunExportSnapshot({
      organizationId: input.organizationId,
      runId: input.baseRunId,
    }),
    getCausalRunExportSnapshot({
      organizationId: input.organizationId,
      runId: input.targetRunId,
    }),
  ]);

  if (!organization) {
    throw new CausalExportError(
      "Organization not found for causal comparison export.",
      "causal_export_org_missing",
    );
  }

  if (baseSnapshot.run.studyId !== input.studyId || targetSnapshot.run.studyId !== input.studyId) {
    throw new CausalExportError(
      "Both runs must belong to the requested causal study.",
      "causal_comparison_study_mismatch",
    );
  }

  const baseAdjustmentSet = parseJsonStringArray(baseSnapshot.identification?.adjustmentSetJson);
  const targetAdjustmentSet = parseJsonStringArray(targetSnapshot.identification?.adjustmentSetJson);
  const baseBlockingReasons = parseJsonStringArray(baseSnapshot.identification?.blockingReasonsJson);
  const targetBlockingReasons = parseJsonStringArray(targetSnapshot.identification?.blockingReasonsJson);
  const baseEstimandLabels = [...new Set(baseSnapshot.estimands.map((estimand) => estimand.estimandLabel))].sort((left, right) => left.localeCompare(right));
  const targetEstimandLabels = [...new Set(targetSnapshot.estimands.map((estimand) => estimand.estimandLabel))].sort((left, right) => left.localeCompare(right));
  const baseRefuterNames = [...new Set(baseSnapshot.refutations.map((refutation) => refutation.refuterName))].sort((left, right) => left.localeCompare(right));
  const targetRefuterNames = [...new Set(targetSnapshot.refutations.map((refutation) => refutation.refuterName))].sort((left, right) => left.localeCompare(right));
  const basePrimaryEstimate = baseSnapshot.estimates[0] ?? null;
  const targetPrimaryEstimate = targetSnapshot.estimates[0] ?? null;

  const comparisonSummary = {
    base_run: {
      adjustment_set: baseAdjustmentSet,
      answer_count: baseSnapshot.answers.length,
      artifact_count: baseSnapshot.artifacts.length,
      estimator_name: basePrimaryEstimate?.estimatorName ?? null,
      identified: baseSnapshot.identification?.identified ?? null,
      identification_method: baseSnapshot.identification?.method ?? null,
      id: baseSnapshot.run.id,
      primary_estimate_value: basePrimaryEstimate?.estimateValue ?? null,
      refutation_count: baseSnapshot.refutations.length,
      refuter_names: baseRefuterNames,
      status: baseSnapshot.run.status,
    },
    delta: {
      adjustment_set_changed: !areStringSetsEqual(baseAdjustmentSet, targetAdjustmentSet),
      answer_count_delta: targetSnapshot.answers.length - baseSnapshot.answers.length,
      artifact_count_delta: targetSnapshot.artifacts.length - baseSnapshot.artifacts.length,
      blocking_reasons_changed: !areStringSetsEqual(baseBlockingReasons, targetBlockingReasons),
      compute_run_count_delta: targetSnapshot.compute.length - baseSnapshot.compute.length,
      estimate_delta:
        typeof basePrimaryEstimate?.estimateValue === "number" && typeof targetPrimaryEstimate?.estimateValue === "number"
          ? targetPrimaryEstimate.estimateValue - basePrimaryEstimate.estimateValue
          : null,
      estimand_labels_changed: !areStringSetsEqual(baseEstimandLabels, targetEstimandLabels),
      identification_changed:
        (baseSnapshot.identification?.identified ?? null) !== (targetSnapshot.identification?.identified ?? null),
      identification_method_changed:
        (baseSnapshot.identification?.method ?? null) !== (targetSnapshot.identification?.method ?? null),
      refutation_count_delta: targetSnapshot.refutations.length - baseSnapshot.refutations.length,
      refuter_set_changed: !areStringSetsEqual(baseRefuterNames, targetRefuterNames),
      treatment_or_outcome_changed:
        baseSnapshot.run.treatmentNodeKey !== targetSnapshot.run.treatmentNodeKey ||
        baseSnapshot.run.outcomeNodeKey !== targetSnapshot.run.outcomeNodeKey,
    },
    target_run: {
      adjustment_set: targetAdjustmentSet,
      answer_count: targetSnapshot.answers.length,
      artifact_count: targetSnapshot.artifacts.length,
      estimator_name: targetPrimaryEstimate?.estimatorName ?? null,
      identified: targetSnapshot.identification?.identified ?? null,
      identification_method: targetSnapshot.identification?.method ?? null,
      id: targetSnapshot.run.id,
      primary_estimate_value: targetPrimaryEstimate?.estimateValue ?? null,
      refutation_count: targetSnapshot.refutations.length,
      refuter_names: targetRefuterNames,
      status: targetSnapshot.run.status,
    },
  };

  const manifest = {
    base_run_id: baseSnapshot.run.id,
    comparison_type: "causal_run_pair",
    exported_at: Date.now(),
    organization: {
      id: organization.id,
      slug: organization.slug,
    },
    study: baseSnapshot.study
      ? {
          id: baseSnapshot.study.id,
          status: baseSnapshot.study.status,
          title: baseSnapshot.study.title,
        }
      : null,
    target_run_id: targetSnapshot.run.id,
  };

  const organizationRoot = await resolveOrganizationStorageRoot(organization.slug);
  const [baseArtifactEntries, targetArtifactEntries] = await Promise.all([
    buildArtifactEntries({
      artifacts: baseSnapshot.artifacts,
      organizationRoot,
      prefix: "artifacts/base",
    }),
    buildArtifactEntries({
      artifacts: targetSnapshot.artifacts,
      organizationRoot,
      prefix: "artifacts/target",
    }),
  ]);

  const entries = [
    {
      content: buildComparisonReadme({
        baseRunId: baseSnapshot.run.id,
        studyTitle: baseSnapshot.study?.title ?? targetSnapshot.study?.title ?? null,
        targetRunId: targetSnapshot.run.id,
      }),
      fileName: "README.md",
    },
    {
      content: JSON.stringify(manifest, null, 2),
      fileName: "manifest.json",
    },
    {
      content: JSON.stringify(comparisonSummary, null, 2),
      fileName: "compare/summary.json",
    },
    {
      content: JSON.stringify(baseSnapshot.study ?? targetSnapshot.study ?? null, null, 2),
      fileName: "study/study.json",
    },
    {
      content: JSON.stringify(baseSnapshot.question ?? null, null, 2),
      fileName: "runs/base/question.json",
    },
    {
      content: JSON.stringify(baseSnapshot.run, null, 2),
      fileName: "runs/base/run.json",
    },
    {
      content: JSON.stringify(baseSnapshot.identification ?? null, null, 2),
      fileName: "runs/base/identification.json",
    },
    {
      content: JSON.stringify(baseSnapshot.estimands, null, 2),
      fileName: "runs/base/estimands.json",
    },
    {
      content: JSON.stringify(baseSnapshot.estimates, null, 2),
      fileName: "runs/base/estimates.json",
    },
    {
      content: JSON.stringify(baseSnapshot.refutations, null, 2),
      fileName: "runs/base/refutations.json",
    },
    {
      content: JSON.stringify(baseSnapshot.answerPackage ?? null, null, 2),
      fileName: "runs/base/answer-package.json",
    },
    {
      content: JSON.stringify(baseSnapshot.answers, null, 2),
      fileName: "runs/base/answers.json",
    },
    {
      content: JSON.stringify(baseSnapshot.compute, null, 2),
      fileName: "runs/base/compute-runs.json",
    },
    {
      content: JSON.stringify(baseSnapshot.artifacts, null, 2),
      fileName: "runs/base/artifacts.json",
    },
    {
      content: JSON.stringify(targetSnapshot.question ?? null, null, 2),
      fileName: "runs/target/question.json",
    },
    {
      content: JSON.stringify(targetSnapshot.run, null, 2),
      fileName: "runs/target/run.json",
    },
    {
      content: JSON.stringify(targetSnapshot.identification ?? null, null, 2),
      fileName: "runs/target/identification.json",
    },
    {
      content: JSON.stringify(targetSnapshot.estimands, null, 2),
      fileName: "runs/target/estimands.json",
    },
    {
      content: JSON.stringify(targetSnapshot.estimates, null, 2),
      fileName: "runs/target/estimates.json",
    },
    {
      content: JSON.stringify(targetSnapshot.refutations, null, 2),
      fileName: "runs/target/refutations.json",
    },
    {
      content: JSON.stringify(targetSnapshot.answerPackage ?? null, null, 2),
      fileName: "runs/target/answer-package.json",
    },
    {
      content: JSON.stringify(targetSnapshot.answers, null, 2),
      fileName: "runs/target/answers.json",
    },
    {
      content: JSON.stringify(targetSnapshot.compute, null, 2),
      fileName: "runs/target/compute-runs.json",
    },
    {
      content: JSON.stringify(targetSnapshot.artifacts, null, 2),
      fileName: "runs/target/artifacts.json",
    },
    ...baseArtifactEntries,
    ...targetArtifactEntries,
  ];

  return {
    archiveFileName: buildComparisonArchiveFileName({
      baseRunId: baseSnapshot.run.id,
      studyTitle: baseSnapshot.study?.title ?? targetSnapshot.study?.title ?? null,
      targetRunId: targetSnapshot.run.id,
    }),
    buffer: createZipArchive(entries),
  };
}
