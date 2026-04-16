import type { WorkflowStepInputRefV1, WorkflowStepV1 } from "@/lib/workflow-types";

function sanitizeCodePathSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || "step";
}

export function getWorkflowStepCodeFileName(step: WorkflowStepV1, index: number) {
  return `${String(index + 1).padStart(2, "0")}_${sanitizeCodePathSegment(step.step_key)}.py`;
}

export function getWorkflowStepExpectedOutputDescription(step: WorkflowStepV1) {
  if (step.tool === "run_data_analysis") {
    return "Optional structured output at outputs/result.csv, outputs/result.json, or outputs/result.txt";
  }

  if (step.tool === "generate_visual_graph") {
    return "Required output at outputs/chart.png";
  }

  return "Required output at outputs/notice.pdf";
}

export function formatWorkflowStepInputRef(inputRef: WorkflowStepInputRefV1) {
  if (inputRef.type === "workflow_input") {
    return `workflow_input:${inputRef.input_key}`;
  }

  return `step_output:${inputRef.step_key}.${inputRef.output_key}`;
}

export function collectWorkflowStepInputPathHints(step: WorkflowStepV1) {
  return [...new Set((step.config.input_files ?? []).map((value) => value.trim()).filter(Boolean))];
}
