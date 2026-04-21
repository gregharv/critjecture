import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { causalAnswerPackages, causalAnswers, causalRuns, causalStudies } from "@/lib/app-schema";

export const CAUSAL_ANSWER_MODEL_NAME = "grounded-package-template";
export const CAUSAL_ANSWER_PROMPT_VERSION = "causal_answer_markdown_v1";

type ParsedCausalAnswerPackage = {
  assumptions?: Array<{
    assumptionType?: string;
    description?: string;
    status?: string;
  }>;
  approval?:
    | null
    | {
        approvalKind?: string;
        approvalText?: string;
        createdAt?: number;
        id?: string;
      };
  estimates?: Array<{
    confidenceIntervalHigh?: number | null;
    confidenceIntervalLow?: number | null;
    effectName?: string;
    estimateValue?: number | null;
    estimatorName?: string;
    pValue?: number | null;
    stdError?: number | null;
  }>;
  estimands?: Array<{
    estimandExpression?: string;
    estimandKind?: string;
    estimandLabel?: string;
  }>;
  identification?:
    | null
    | {
        adjustmentSet?: string[];
        blockingReasons?: string[];
        identified?: boolean;
        method?: string;
        statusLabel?: string;
      };
  limitations?: string[];
  nextSteps?: string[];
  question?: string | null;
  refutations?: Array<{
    refuterName?: string;
    status?: string;
    summaryText?: string;
  }>;
  run?: {
    dagVersionId?: string;
    outcomeNodeKey?: string;
    primaryDatasetVersionId?: string;
    requestedByUserId?: string;
    runId?: string;
    status?: string;
    treatmentNodeKey?: string;
  };
  runDatasetBindings?: Array<{
    bindingRole?: string;
    datasetId?: string;
    datasetVersionId?: string;
  }>;
  study?: {
    id?: string;
    title?: string | null;
  };
};

function parsePackageJson(packageJson: string) {
  const parsed = JSON.parse(packageJson) as ParsedCausalAnswerPackage;

  return {
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
    approval: parsed.approval ?? null,
    estimates: Array.isArray(parsed.estimates) ? parsed.estimates : [],
    estimands: Array.isArray(parsed.estimands) ? parsed.estimands : [],
    identification: parsed.identification ?? null,
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
    question: typeof parsed.question === "string" ? parsed.question : null,
    refutations: Array.isArray(parsed.refutations) ? parsed.refutations : [],
    run: parsed.run ?? {},
    runDatasetBindings: Array.isArray(parsed.runDatasetBindings) ? parsed.runDatasetBindings : [],
    study: parsed.study ?? {},
  };
}

function formatNumber(value: number | null | undefined, digits = 4) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "not reported";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function renderEstimateSummary(
  estimate: NonNullable<ReturnType<typeof parsePackageJson>["estimates"]>[number] | undefined,
) {
  if (!estimate || typeof estimate.estimateValue !== "number") {
    return "No identified causal estimate is available in the stored package.";
  }

  const intervalText =
    typeof estimate.confidenceIntervalLow === "number" && typeof estimate.confidenceIntervalHigh === "number"
      ? ` with a 95% interval from ${formatNumber(estimate.confidenceIntervalLow)} to ${formatNumber(estimate.confidenceIntervalHigh)}`
      : "";

  return `The stored causal estimate for **${estimate.effectName ?? "the treatment effect"}** is **${formatNumber(estimate.estimateValue)}** using **${estimate.estimatorName ?? "the recorded estimator"}**${intervalText}.`;
}

function renderGroundedAnswerMarkdown(packageJson: string) {
  const parsed = parsePackageJson(packageJson);
  const question = parsed.question ?? "No study question was stored.";
  const treatment = parsed.run.treatmentNodeKey ?? "unassigned_treatment";
  const outcome = parsed.run.outcomeNodeKey ?? "unassigned_outcome";
  const identification = parsed.identification;
  const estimate = parsed.estimates[0];
  const estimand = parsed.estimands[0];
  const bindings = parsed.runDatasetBindings
    .map((binding) => `${binding.bindingRole ?? "dataset"}: ${binding.datasetVersionId ?? binding.datasetId ?? "unknown"}`)
    .join(", ");

  const lines = [
    "# Grounded causal answer",
    "",
    "## Question",
    question,
    "",
    "## Conclusion",
  ];

  if (!identification || identification.identified !== true) {
    lines.push(
      `The effect of **${treatment}** on **${outcome}** is **not identified** from the approved DAG and pinned dataset bindings in this study.`,
    );
  } else {
    lines.push(renderEstimateSummary(estimate));
  }

  lines.push(
    "",
    "## Grounding",
    `- Study: ${parsed.study.title ?? parsed.study.id ?? "unknown study"}`,
    `- Run: ${parsed.run.runId ?? "unknown run"}`,
    `- DAG version: ${parsed.run.dagVersionId ?? "unknown"}`,
    `- Dataset bindings: ${bindings || "none recorded"}`,
    `- Identification: ${identification?.statusLabel ?? (identification ? (identification.identified ? "identified" : "not identified") : "not recorded")}`,
    `- Method: ${identification?.method ?? "not recorded"}`,
  );

  if (estimand) {
    lines.push(
      "",
      "## Estimand",
      `- ${estimand.estimandLabel ?? estimand.estimandKind ?? "Stored estimand"}: ${estimand.estimandExpression ?? "expression not recorded"}`,
    );
  }

  if (identification?.adjustmentSet?.length) {
    lines.push(
      "",
      "## Adjustment set",
      ...identification.adjustmentSet.map((variable) => `- ${variable}`),
    );
  }

  lines.push("", "## Assumptions");
  if (parsed.assumptions.length) {
    lines.push(
      ...parsed.assumptions.map(
        (assumption) =>
          `- ${assumption.description ?? assumption.assumptionType ?? "Unnamed assumption"} (${assumption.status ?? "status not recorded"})`,
      ),
    );
  } else {
    lines.push("- No explicit assumptions were recorded in the stored package.");
  }

  lines.push("", "## Limitations");
  if (parsed.limitations.length) {
    lines.push(...parsed.limitations.map((limitation) => `- ${limitation}`));
  } else if (!identification?.identified) {
    lines.push("- The effect is not identified under the current graph and data.");
  } else {
    lines.push("- No additional limitations were recorded in the stored package.");
  }

  lines.push("", "## Refutations");
  if (parsed.refutations.length) {
    lines.push(
      ...parsed.refutations.map(
        (refutation) =>
          `- ${refutation.refuterName ?? "Stored refutation"}: ${refutation.status ?? "unknown status"} — ${refutation.summaryText ?? "No summary recorded."}`,
      ),
    );
  } else {
    lines.push("- No refutation results were recorded for this run.");
  }

  lines.push("", "## Approval");
  if (parsed.approval) {
    lines.push(
      `- ${parsed.approval.approvalKind ?? "approval"} at ${parsed.approval.createdAt ? new Date(parsed.approval.createdAt).toISOString() : "unknown time"}`,
      `- ${parsed.approval.approvalText ?? "Approval text not recorded."}`,
    );
  } else {
    lines.push("- No approval record was attached to the stored package.");
  }

  lines.push("", "## Next steps");
  if (parsed.nextSteps.length) {
    lines.push(...parsed.nextSteps.map((step) => `- ${step}`));
  } else if (identification?.identified) {
    lines.push("- Review whether the identifying assumptions are credible for the decision at hand.");
  } else {
    lines.push("- Resolve the blocking assumptions or missing variables before interpreting any causal effect.");
  }

  lines.push(
    "",
    "## Guardrail note",
    "This answer was rendered from the stored causal answer package only. It did not re-analyze the dataset or use descriptive analysis tools.",
  );

  return lines.join("\n");
}

export async function listCausalAnswersForStudy(input: {
  organizationId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  return db
    .select()
    .from(causalAnswers)
    .where(and(eq(causalAnswers.organizationId, input.organizationId), eq(causalAnswers.studyId, input.studyId)))
    .orderBy(desc(causalAnswers.createdAt));
}

export async function listCausalAnswersForRun(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  return db
    .select()
    .from(causalAnswers)
    .where(and(eq(causalAnswers.organizationId, input.organizationId), eq(causalAnswers.runId, input.runId)))
    .orderBy(desc(causalAnswers.createdAt));
}

export async function getLatestCausalAnswerForRun(input: {
  organizationId: string;
  runId: string;
}) {
  const answers = await listCausalAnswersForRun(input);
  return answers[0] ?? null;
}

export async function createGroundedCausalAnswer(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [run] = await db
    .select()
    .from(causalRuns)
    .where(and(eq(causalRuns.id, input.runId), eq(causalRuns.organizationId, input.organizationId)));

  if (!run) {
    throw new Error("Causal run not found.");
  }

  const [answerPackage] = await db
    .select()
    .from(causalAnswerPackages)
    .where(
      and(
        eq(causalAnswerPackages.runId, run.id),
        eq(causalAnswerPackages.studyId, run.studyId),
        eq(causalAnswerPackages.organizationId, input.organizationId),
      ),
    );

  if (!answerPackage) {
    throw new Error("A causal answer package must exist before generating the final answer.");
  }

  const id = randomUUID();
  const createdAt = Date.now();
  const answerText = renderGroundedAnswerMarkdown(answerPackage.packageJson);

  await db.insert(causalAnswers).values({
    id,
    runId: run.id,
    studyId: run.studyId,
    organizationId: input.organizationId,
    answerPackageId: answerPackage.id,
    modelName: CAUSAL_ANSWER_MODEL_NAME,
    promptVersion: CAUSAL_ANSWER_PROMPT_VERSION,
    answerText,
    answerFormat: "markdown",
    createdAt,
  });

  await db
    .update(causalStudies)
    .set({
      currentAnswerId: id,
      updatedAt: createdAt,
    })
    .where(eq(causalStudies.id, run.studyId));

  const [storedAnswer] = await db.select().from(causalAnswers).where(eq(causalAnswers.id, id));
  return storedAnswer ?? null;
}

export function parseCausalAnswerPackageForDisplay(packageJson: string) {
  return parsePackageJson(packageJson);
}
