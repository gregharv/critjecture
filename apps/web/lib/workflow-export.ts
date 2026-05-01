import "server-only";

import path from "node:path";
import { readFile } from "node:fs/promises";

import { and, eq, inArray } from "drizzle-orm";

import { resolveRepositoryRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/legacy-app-db";
import { dataAssets, documents } from "@/lib/legacy-app-schema";
import {
  collectWorkflowStepInputPathHints,
  formatWorkflowStepInputRef,
  getWorkflowStepCodeFileName,
  getWorkflowStepExpectedOutputDescription,
} from "@/lib/workflow-code";
import type {
  WorkflowInputBindingV1,
  WorkflowStepV1,
  WorkflowVersionContractsV1,
} from "@/lib/workflow-types";
import type { WorkflowRecord, WorkflowVersionRecord } from "@/lib/workflows";
import { getWorkflowDetail } from "@/lib/workflows";
import { createZipArchive } from "@/lib/zip-writer";

export class WorkflowExportError extends Error {
  readonly code: string;

  constructor(message: string, code = "workflow_export_error") {
    super(message);
    this.code = code;
    this.name = "WorkflowExportError";
  }
}

type BindingHint = {
  description: string;
  input_key: string;
};

type WorkflowExportManifest = {
  exported_at: number;
  input_binding_hints: BindingHint[];
  input_path_hints: string[];
  local_runner: {
    entrypoint: string;
    python_version: string;
  };
  notes: string[];
  steps: Array<{
    code_file: string;
    expected_output: string;
    input_files: string[];
    input_refs: string[];
    kind: WorkflowStepV1["kind"];
    step_key: string;
    tool: WorkflowStepV1["tool"];
  }>;
  version: {
    created_at: number;
    id: string;
    version_number: number;
  };
  workflow: {
    current_version_id: string | null;
    current_version_number: number | null;
    description: string | null;
    id: string;
    name: string;
    status: string;
    visibility: string;
  };
};

function sanitizeArchiveSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return normalized || "workflow";
}

function buildArchiveFileName(name: string, versionNumber: number | null) {
  return `${sanitizeArchiveSegment(name)}-v${versionNumber ?? "current"}.zip`;
}

function summarizeSelector(selector: Record<string, unknown>) {
  return Object.entries(selector)
    .flatMap(([key, rawValue]) => {
      if (Array.isArray(rawValue)) {
        return rawValue.length > 0 ? [`${key}=${rawValue.join(",")}`] : [];
      }

      if (typeof rawValue === "string") {
        return rawValue.trim() ? [`${key}=${rawValue.trim()}`] : [];
      }

      return typeof rawValue === "number" ? [`${key}=${rawValue}`] : [];
    })
    .join("; ");
}

async function buildBindingHints(input: {
  contracts: WorkflowVersionContractsV1;
  organizationId: string;
}) {
  const assetIds = input.contracts.inputBindings.bindings.flatMap((binding) =>
    binding.binding.kind === "asset_id" ? [binding.binding.asset_id] : [],
  );
  const documentIds = input.contracts.inputBindings.bindings.flatMap((binding) =>
    binding.binding.kind === "document_id" ? [binding.binding.document_id] : [],
  );
  const db = await getAppDatabase();
  const [assetRows, documentRows] = await Promise.all([
    assetIds.length > 0
      ? db
          .select({
            assetKey: dataAssets.assetKey,
            displayName: dataAssets.displayName,
            id: dataAssets.id,
          })
          .from(dataAssets)
          .where(
            and(
              eq(dataAssets.organizationId, input.organizationId),
              inArray(dataAssets.id, assetIds),
            ),
          )
      : Promise.resolve([]),
    documentIds.length > 0
      ? db
          .select({
            displayName: documents.displayName,
            id: documents.id,
            sourcePath: documents.sourcePath,
          })
          .from(documents)
          .where(
            and(
              eq(documents.organizationId, input.organizationId),
              inArray(documents.id, documentIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const assetsById = new Map(assetRows.map((row) => [row.id, row]));
  const documentsById = new Map(documentRows.map((row) => [row.id, row]));

  return input.contracts.inputBindings.bindings.map((binding) => ({
    description: describeBindingHint(binding, assetsById, documentsById),
    input_key: binding.input_key,
  }));
}

function describeBindingHint(
  binding: WorkflowInputBindingV1,
  assetsById: Map<string, { assetKey: string; displayName: string; id: string }>,
  documentsById: Map<string, { displayName: string; id: string; sourcePath: string }>,
) {
  if (binding.binding.kind === "asset_id") {
    const asset = assetsById.get(binding.binding.asset_id);

    return asset
      ? `asset_id bound to ${asset.assetKey} (${asset.displayName})`
      : `asset_id bound to ${binding.binding.asset_id}`;
  }

  if (binding.binding.kind === "document_id") {
    const document = documentsById.get(binding.binding.document_id);

    return document
      ? `document_id bound to ${document.sourcePath} (${document.displayName})`
      : `document_id bound to ${binding.binding.document_id}`;
  }

  if (binding.binding.kind === "asset_selector") {
    return `asset_selector using ${summarizeSelector(binding.binding.selector as Record<string, unknown>) || "metadata selectors"}`;
  }

  return `selector using ${summarizeSelector(binding.binding.selector as Record<string, unknown>) || "metadata selectors"}`;
}

function collectInputPathHints(contracts: WorkflowVersionContractsV1) {
  return [
    ...new Set(
      contracts.recipe.steps.flatMap((step) => collectWorkflowStepInputPathHints(step)),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function buildWorkflowManifest(input: {
  bindingHints: BindingHint[];
  contracts: WorkflowVersionContractsV1;
  workflow: WorkflowRecord;
  workflowVersion: WorkflowVersionRecord;
}) {
  const inputPathHints = collectInputPathHints(input.contracts);

  return {
    exported_at: Date.now(),
    input_binding_hints: input.bindingHints,
    input_path_hints: inputPathHints,
    local_runner: {
      entrypoint: "runner/run_workflow.py",
      python_version: ">=3.13",
    },
    notes: [
      "This package contains workflow code and contracts, but not your source data files.",
      "Place the latest private data files under ./inputs/ using the same relative paths referenced by the exported step code.",
      "Hosted scheduling, access control, delivery endpoints, and audit history are not reproduced by the local runner.",
    ],
    steps: input.contracts.recipe.steps.map((step, index) => ({
      code_file: `steps/${getWorkflowStepCodeFileName(step, index)}`,
      expected_output: getWorkflowStepExpectedOutputDescription(step),
      input_files: collectWorkflowStepInputPathHints(step),
      input_refs: step.input_refs.map((inputRef) => formatWorkflowStepInputRef(inputRef)),
      kind: step.kind,
      step_key: step.step_key,
      tool: step.tool,
    })),
    version: {
      created_at: input.workflowVersion.createdAt,
      id: input.workflowVersion.id,
      version_number: input.workflowVersion.versionNumber,
    },
    workflow: {
      current_version_id: input.workflow.currentVersionId,
      current_version_number: input.workflow.currentVersionNumber,
      description: input.workflow.description,
      id: input.workflow.id,
      name: input.workflow.name,
      status: input.workflow.status,
      visibility: input.workflow.visibility,
    },
  } satisfies WorkflowExportManifest;
}

async function resolvePythonSandboxRequirements() {
  try {
    const repositoryRoot = await resolveRepositoryRoot();
    const pyprojectPath = path.join(repositoryRoot, "packages", "python-sandbox", "pyproject.toml");
    const pyproject = await readFile(pyprojectPath, "utf8");
    const dependencyBlockMatch = pyproject.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    const dependencyBlock = dependencyBlockMatch?.[1] ?? "";
    const requirements = [...dependencyBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");

    if (requirements.length > 0) {
      return requirements.join("\n");
    }
  } catch {
    // Fall back to the checked-in baseline requirements.
  }

  return ["matplotlib>=3.10.8", "polars>=1.39.3", "reportlab>=4.4.10"].join("\n");
}

function buildRunnerScript() {
  return `from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = json.loads((ROOT / "workflow.json").read_text(encoding="utf-8"))
INPUTS_DIR = ROOT / "inputs"
OUTPUTS_DIR = ROOT / "outputs"


def main() -> int:
    INPUTS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Running workflow: {MANIFEST['workflow']['name']}")
    print(f"Expected input path hints: {MANIFEST.get('input_path_hints', [])}")

    for step in MANIFEST["steps"]:
        script_path = ROOT / step["code_file"]
        print(f"\\n==> {step['step_key']} ({step['tool']})")
        print(f"    script: {script_path.relative_to(ROOT)}")
        print(f"    expected output: {step['expected_output']}")
        subprocess.run([sys.executable, str(script_path)], cwd=ROOT, check=True)

    print("\\nWorkflow completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

function buildReadme(input: {
  manifest: WorkflowExportManifest;
  workflowVersionNumber: number;
}) {
  const inputHints = input.manifest.input_path_hints.length
    ? input.manifest.input_path_hints.map((hint) => `- ${hint}`).join("\n")
    : "- No explicit input file paths were captured. Review workflow.json input_binding_hints and the step code before running locally.";
  const bindingHints = input.manifest.input_binding_hints.length
    ? input.manifest.input_binding_hints
        .map((hint) => `- ${hint.input_key}: ${hint.description}`)
        .join("\n")
    : "- No binding hints recorded.";

  return `# ${input.manifest.workflow.name}

Exported workflow package for version ${input.workflowVersionNumber}.

## What is included

- \`workflow.json\`: normalized export manifest
- \`contracts/*.json\`: exact workflow contracts from the hosted app
- \`steps/*.py\`: Python code for each workflow step
- \`runner/run_workflow.py\`: simple local runner
- \`requirements.txt\`: Python dependencies used by the hosted sandbox

## Running locally

1. Create a virtual environment with Python 3.13+.
2. Install dependencies:
   \`pip install -r requirements.txt\`
3. Put your latest private data files under \`./inputs/\`.
4. Run:
   \`python runner/run_workflow.py\`

## Input path hints

${inputHints}

## Binding hints

${bindingHints}

## Notes

- This package does not include your hosted source files or secrets.
- Hosted scheduling, delivery integrations, identity checks, and audit history are not reproduced here.
- Review each step script before local execution and adapt file paths if your local layout differs.
`;
}

export async function exportWorkflowZip(input: {
  organizationId: string;
  workflowId: string;
}) {
  const detail = await getWorkflowDetail(input);

  if (!detail) {
    throw new WorkflowExportError("Workflow not found.", "workflow_not_found");
  }

  if (!detail.currentVersion) {
    throw new WorkflowExportError(
      "Workflow does not have a current version to export.",
      "workflow_version_missing",
    );
  }

  const bindingHints = await buildBindingHints({
    contracts: detail.currentVersion.contracts,
    organizationId: input.organizationId,
  });
  const manifest = buildWorkflowManifest({
    bindingHints,
    contracts: detail.currentVersion.contracts,
    workflow: detail.workflow,
    workflowVersion: detail.currentVersion,
  });
  const requirements = await resolvePythonSandboxRequirements();
  const entries = [
    {
      content: buildReadme({
        manifest,
        workflowVersionNumber: detail.currentVersion.versionNumber,
      }),
      fileName: "README.md",
    },
    {
      content: JSON.stringify(manifest, null, 2),
      fileName: "workflow.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.inputContract, null, 2),
      fileName: "contracts/input-contract.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.inputBindings, null, 2),
      fileName: "contracts/input-bindings.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.recipe, null, 2),
      fileName: "contracts/recipe.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.outputs, null, 2),
      fileName: "contracts/outputs.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.thresholds, null, 2),
      fileName: "contracts/thresholds.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.delivery, null, 2),
      fileName: "contracts/delivery.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.schedule, null, 2),
      fileName: "contracts/schedule.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.executionIdentity, null, 2),
      fileName: "contracts/execution-identity.json",
    },
    {
      content: JSON.stringify(detail.currentVersion.contracts.provenance, null, 2),
      fileName: "contracts/provenance.json",
    },
    {
      content: requirements,
      fileName: "requirements.txt",
    },
    {
      content: buildRunnerScript(),
      fileName: "runner/run_workflow.py",
    },
    ...detail.currentVersion.contracts.recipe.steps.map((step, index) => ({
      content: step.config.python_code,
      fileName: `steps/${getWorkflowStepCodeFileName(step, index)}`,
    })),
  ];

  return {
    archiveFileName: buildArchiveFileName(detail.workflow.name, detail.currentVersion.versionNumber),
    buffer: createZipArchive(entries),
  };
}
