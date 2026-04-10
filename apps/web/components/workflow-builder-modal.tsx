"use client";

import { useState } from "react";

import type { WorkflowDraftFromChatTurn } from "@/lib/workflow-builder-types";
import type { WorkflowStatus, WorkflowVisibility } from "@/lib/workflow-types";

export type SaveWorkflowDraftInput = {
  description: string | null;
  name: string;
  status: WorkflowStatus;
  version: WorkflowDraftFromChatTurn["version"];
  visibility: WorkflowVisibility;
};

type WorkflowBuilderModalProps = {
  draft: WorkflowDraftFromChatTurn;
  error: string | null;
  onClose: () => void;
  onSave: (input: SaveWorkflowDraftInput) => void;
  saving: boolean;
};

export function WorkflowBuilderModal({
  draft,
  error,
  onClose,
  onSave,
  saving,
}: WorkflowBuilderModalProps) {
  const [name, setName] = useState(draft.suggestedName);
  const [description, setDescription] = useState(draft.suggestedDescription ?? "");
  const [status, setStatus] = useState<WorkflowStatus>(draft.status);
  const [visibility, setVisibility] = useState<WorkflowVisibility>(draft.visibility);

  return (
    <div className="workflow-builder-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="Workflow builder"
        aria-modal="true"
        className="workflow-builder-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="workflow-builder-modal__header">
          <div>
            <p className="workflow-builder-modal__eyebrow">Save as workflow</p>
            <h2 className="workflow-builder-modal__title">Finalize workflow draft</h2>
          </div>
          <button
            className="chat-toolbar__button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="workflow-builder-modal__body">
          <label className="workflow-builder-modal__field">
            <span>Name</span>
            <input
              className="workflow-builder-modal__input"
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
              placeholder="Workflow name"
              type="text"
              value={name}
            />
          </label>

          <label className="workflow-builder-modal__field">
            <span>Description</span>
            <textarea
              className="workflow-builder-modal__textarea"
              disabled={saving}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe what this workflow should monitor."
              rows={3}
              value={description}
            />
          </label>

          <div className="workflow-builder-modal__row">
            <label className="workflow-builder-modal__field">
              <span>Status</span>
              <select
                className="workflow-builder-modal__input"
                disabled={saving}
                onChange={(event) => setStatus(event.target.value as WorkflowStatus)}
                value={status}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
              </select>
            </label>

            <label className="workflow-builder-modal__field">
              <span>Visibility</span>
              <select
                className="workflow-builder-modal__input"
                disabled={saving}
                onChange={(event) => setVisibility(event.target.value as WorkflowVisibility)}
                value={visibility}
              >
                <option value="organization">Organization</option>
                <option value="private">Private</option>
              </select>
            </label>
          </div>

          <section className="workflow-builder-modal__summary">
            <h3>Compiled recipe summary</h3>
            <ul>
              <li>
                Turn: <code>{draft.turnId}</code>
              </li>
              <li>{draft.sourceSummary.analysisToolCallCount} analysis step(s)</li>
              <li>{draft.sourceSummary.chartToolCallCount} chart step(s)</li>
              <li>{draft.sourceSummary.documentToolCallCount} document step(s)</li>
              <li>{draft.inputFilePaths.length} input file binding(s)</li>
            </ul>
          </section>

          {draft.unresolvedInputPaths.length > 0 ? (
            <section className="workflow-builder-modal__warning">
              <h3>Input binding warning</h3>
              <p>
                Some inputs did not map to managed document IDs. Selector fallbacks were created
                and may need review before activation.
              </p>
              <ul>
                {draft.unresolvedInputPaths.map((inputPath) => (
                  <li key={inputPath}>{inputPath}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {error ? <p className="workflow-builder-modal__error">{error}</p> : null}
        </div>

        <footer className="workflow-builder-modal__footer">
          <button className="chat-toolbar__button" disabled={saving} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="chat-toolbar__button chat-toolbar__button--primary"
            disabled={saving || !name.trim()}
            onClick={() => {
              onSave({
                description: description.trim() ? description.trim() : null,
                name: name.trim(),
                status,
                version: draft.version,
                visibility,
              });
            }}
            type="button"
          >
            {saving ? "Saving…" : "Save workflow"}
          </button>
        </footer>
      </div>
    </div>
  );
}
