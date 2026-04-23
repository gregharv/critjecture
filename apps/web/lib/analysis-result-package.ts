import "server-only";

import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { deriveAnalysisEpistemicVerdict } from "@/lib/analysis-claim-labels";
import {
  analysisAnswerPackages,
  analysisApprovals,
  analysisAnswers,
  analysisAssumptions,
  analysisEstimates,
  analysisEstimands,
  analysisIdentifications,
  analysisRefutations,
  analysisRunDatasetBindings,
  analysisRuns,
  analysisStudies,
  studyQuestions,
} from "@/lib/app-schema";

export async function buildAndStoreAnalysisAnswerPackage(input: {
  organizationId: string;
  runId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const [run] = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.id, input.runId), eq(analysisRuns.organizationId, input.organizationId)));

  if (!run) {
    throw new Error("Analysis run not found.");
  }

  const [study, question, identification, bindings, estimands, estimates, refutations, assumptions, approval] =
    await Promise.all([
      db.select().from(analysisStudies).where(eq(analysisStudies.id, input.studyId)),
      db.select().from(studyQuestions).where(eq(studyQuestions.id, run.studyQuestionId)),
      db.select().from(analysisIdentifications).where(eq(analysisIdentifications.runId, run.id)),
      db.select().from(analysisRunDatasetBindings).where(eq(analysisRunDatasetBindings.runId, run.id)),
      db.select().from(analysisEstimands).where(eq(analysisEstimands.runId, run.id)),
      db.select().from(analysisEstimates).where(eq(analysisEstimates.runId, run.id)),
      db.select().from(analysisRefutations).where(eq(analysisRefutations.runId, run.id)),
      db.select().from(analysisAssumptions).where(eq(analysisAssumptions.dagVersionId, run.dagVersionId)),
      run.approvalId
        ? db.select().from(analysisApprovals).where(eq(analysisApprovals.id, run.approvalId))
        : Promise.resolve([]),
    ]);

  const epistemicVerdict = deriveAnalysisEpistemicVerdict({
    blockingReasons: identification[0] ? (JSON.parse(identification[0].blockingReasonsJson) as string[]) : [],
    identified: identification[0]?.identified ?? null,
    outcomeNodeKey: run.outcomeNodeKey,
    refutationStatuses: refutations.map((refutation) => refutation.status),
    treatmentNodeKey: run.treatmentNodeKey,
  });

  const packageObject = {
    assumptions: assumptions.map((assumption) => ({
      assumptionType: assumption.assumptionType,
      description: assumption.description,
      status: assumption.status,
    })),
    approval: approval[0]
      ? {
          approvalKind: approval[0].approvalKind,
          approvalText: approval[0].approvalText,
          createdAt: approval[0].createdAt,
          id: approval[0].id,
        }
      : null,
    estimates: estimates.map((estimate) => ({
      confidenceIntervalHigh: estimate.confidenceIntervalHigh,
      confidenceIntervalLow: estimate.confidenceIntervalLow,
      effectName: estimate.effectName,
      estimateValue: estimate.estimateValue,
      estimatorName: estimate.estimatorName,
      pValue: estimate.pValue,
      stdError: estimate.stdError,
    })),
    estimands: estimands.map((estimand) => ({
      estimandExpression: estimand.estimandExpression,
      estimandKind: estimand.estimandKind,
      estimandLabel: estimand.estimandLabel,
    })),
    epistemicVerdict,
    identification: identification[0]
      ? {
          adjustmentSet: JSON.parse(identification[0].adjustmentSetJson),
          blockingReasons: JSON.parse(identification[0].blockingReasonsJson),
          identified: identification[0].identified,
          method: identification[0].method,
          statusLabel: identification[0].identified ? "identified" : "not identified",
        }
      : null,
    limitations:
      identification[0] && !identification[0].identified
        ? JSON.parse(identification[0].blockingReasonsJson)
        : [],
    nextSteps:
      identification[0] && !identification[0].identified
        ? [
            "Revise the DAG to resolve unobserved or missing confounding.",
            "Collect the explicitly missing data requirements before rerunning.",
          ]
        : [],
    question: question[0]?.questionText ?? null,
    refutations: refutations.map((refutation) => ({
      refuterName: refutation.refuterName,
      status: refutation.status,
      summaryText: refutation.summaryText,
    })),
    run: {
      dagVersionId: run.dagVersionId,
      outcomeNodeKey: run.outcomeNodeKey,
      primaryDatasetVersionId: run.primaryDatasetVersionId,
      requestedByUserId: run.requestedByUserId,
      runId: run.id,
      status: run.status,
      treatmentNodeKey: run.treatmentNodeKey,
    },
    runDatasetBindings: bindings.map((binding) => ({
      bindingRole: binding.bindingRole,
      datasetId: binding.datasetId,
      datasetVersionId: binding.datasetVersionId,
    })),
    study: {
      id: study[0]?.id ?? input.studyId,
      title: study[0]?.title ?? null,
    },
  };

  const packageJson = JSON.stringify(packageObject);
  const packageHash = createHash("sha256").update(packageJson).digest("hex");
  const now = Date.now();

  const existing = await db
    .select()
    .from(analysisAnswerPackages)
    .where(eq(analysisAnswerPackages.runId, run.id));

  if (existing[0]) {
    await db
      .update(analysisAnswerPackages)
      .set({
        packageJson,
        packageHash,
      })
      .where(eq(analysisAnswerPackages.id, existing[0].id));

    return { id: existing[0].id, packageHash, packageJson };
  }

  const packageId = `analysis-answer-package:${run.id}`;
  await db.insert(analysisAnswerPackages).values({
    id: packageId,
    runId: run.id,
    studyId: input.studyId,
    organizationId: input.organizationId,
    packageJson,
    packageHash,
    createdAt: now,
  });

  return { id: packageId, packageHash, packageJson };
}

export async function getAnalysisRunPackage(runId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(analysisAnswerPackages)
    .where(eq(analysisAnswerPackages.runId, runId));

  return rows[0] ?? null;
}

export async function getLatestAnalysisAnswersForStudy(studyId: string) {
  const db = await getAppDatabase();
  return db.select().from(analysisAnswers).where(eq(analysisAnswers.studyId, studyId));
}
