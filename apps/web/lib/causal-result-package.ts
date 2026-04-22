import "server-only";

import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { deriveCausalEpistemicVerdict } from "@/lib/causal-claim-labels";
import {
  causalAnswerPackages,
  causalApprovals,
  causalAnswers,
  causalAssumptions,
  causalEstimates,
  causalEstimands,
  causalIdentifications,
  causalRefutations,
  causalRunDatasetBindings,
  causalRuns,
  causalStudies,
  studyQuestions,
} from "@/lib/app-schema";

export async function buildAndStoreCausalAnswerPackage(input: {
  organizationId: string;
  runId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const [run] = await db
    .select()
    .from(causalRuns)
    .where(and(eq(causalRuns.id, input.runId), eq(causalRuns.organizationId, input.organizationId)));

  if (!run) {
    throw new Error("Causal run not found.");
  }

  const [study, question, identification, bindings, estimands, estimates, refutations, assumptions, approval] =
    await Promise.all([
      db.select().from(causalStudies).where(eq(causalStudies.id, input.studyId)),
      db.select().from(studyQuestions).where(eq(studyQuestions.id, run.studyQuestionId)),
      db.select().from(causalIdentifications).where(eq(causalIdentifications.runId, run.id)),
      db.select().from(causalRunDatasetBindings).where(eq(causalRunDatasetBindings.runId, run.id)),
      db.select().from(causalEstimands).where(eq(causalEstimands.runId, run.id)),
      db.select().from(causalEstimates).where(eq(causalEstimates.runId, run.id)),
      db.select().from(causalRefutations).where(eq(causalRefutations.runId, run.id)),
      db.select().from(causalAssumptions).where(eq(causalAssumptions.dagVersionId, run.dagVersionId)),
      run.approvalId
        ? db.select().from(causalApprovals).where(eq(causalApprovals.id, run.approvalId))
        : Promise.resolve([]),
    ]);

  const epistemicVerdict = deriveCausalEpistemicVerdict({
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
    .from(causalAnswerPackages)
    .where(eq(causalAnswerPackages.runId, run.id));

  if (existing[0]) {
    await db
      .update(causalAnswerPackages)
      .set({
        packageJson,
        packageHash,
      })
      .where(eq(causalAnswerPackages.id, existing[0].id));

    return { id: existing[0].id, packageHash, packageJson };
  }

  const packageId = `answer-package:${run.id}`;
  await db.insert(causalAnswerPackages).values({
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

export async function getCausalRunPackage(runId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(causalAnswerPackages)
    .where(eq(causalAnswerPackages.runId, runId));

  return rows[0] ?? null;
}

export async function getLatestCausalAnswersForStudy(studyId: string) {
  const db = await getAppDatabase();
  return db.select().from(causalAnswers).where(eq(causalAnswers.studyId, studyId));
}
