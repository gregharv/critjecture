"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { AnalysisStudySummary } from "@/lib/analysis-studies";
import type { AnalysisIntakeResponse } from "@/lib/analysis-routing-types";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type AnalysisStudiesPageClientProps = {
  initialStudies: AnalysisStudySummary[];
};

function formatTimestamp(timestamp: number) {
  return DATE_TIME_FORMATTER.format(timestamp);
}

function getErrorMessage(value: unknown, fallbackMessage: string) {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }

  return fallbackMessage;
}

export function AnalysisStudiesPageClient({
  initialStudies,
}: AnalysisStudiesPageClientProps) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<AnalysisIntakeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [studies, setStudies] = useState(initialStudies);

  const hasStudies = studies.length > 0;
  const helperText = useMemo(() => {
    if (!response) {
      return "Use this workspace when a question needs rung-2 interventional or rung-3 counterfactual analysis. Ordinary conceptual chat and rung-1 observational analysis stay in chat for now.";
    }

    if (response.decision === "open_rung2_study" || response.decision === "open_rung3_study") {
      return `Opened study ${response.studyId} with question ${response.studyQuestionId}.`;
    }

    if (response.decision === "continue_chat") {
      return `This request stays in ordinary chat at ${response.nextPath}.`;
    }

    if (response.decision === "open_rung1_analysis") {
      return `This request stays on the rung-1 observational path at ${response.nextPath}.`;
    }

    if (response.decision === "ask_clarification") {
      return response.question;
    }

    return response.message;
  }, [response]);

  async function refreshStudies() {
    const studiesResponse = await fetch("/api/analysis/studies", {
      cache: "no-store",
    });
    const json = (await studiesResponse.json()) as unknown;

    if (!studiesResponse.ok) {
      throw new Error(getErrorMessage(json, "Failed to refresh analysis studies."));
    }

    const nextStudies =
      typeof json === "object" && json !== null && "studies" in json && Array.isArray(json.studies)
        ? (json.studies as AnalysisStudySummary[])
        : [];

    setStudies(nextStudies);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setError("Enter a question before starting analysis intake.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const intakeResponse = await fetch("/api/analysis/intake", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: trimmedMessage }),
      });
      const json = (await intakeResponse.json()) as unknown;

      if (!intakeResponse.ok) {
        throw new Error(getErrorMessage(json, "Analysis intake failed."));
      }

      const nextResponse = json as AnalysisIntakeResponse;
      setResponse(nextResponse);

      if (nextResponse.decision === "open_rung2_study" || nextResponse.decision === "open_rung3_study") {
        await refreshStudies();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Analysis intake failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="analysis-page">
      <div className="analysis-hero">
        <p className="analysis-hero__eyebrow">Analysis workspace</p>
        <h1 className="analysis-hero__title">Analysis studies</h1>
        <p className="analysis-hero__copy">{helperText}</p>
      </div>

      <div className="analysis-grid">
        <section className="analysis-card">
          <h2 className="analysis-card__title">Start with intake</h2>
          <p className="analysis-card__copy">
            Intake now distinguishes ordinary chat, rung-1 observational analysis, rung-2
            interventional studies, and rung-3 counterfactual studies before dataset-backed answer
            generation begins. This page currently hosts the study-backed higher-rung path.
          </p>
          <form className="analysis-intake-form" onSubmit={handleSubmit}>
            <label className="analysis-intake-form__label" htmlFor="analysis-intake-message">
              Question
            </label>
            <textarea
              id="analysis-intake-message"
              className="analysis-intake-form__textarea"
              disabled={pending}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What happens if we cut price by 10%?"
              rows={5}
              value={message}
            />
            <div className="analysis-intake-form__actions">
              <button className="analysis-intake-form__submit" disabled={pending} type="submit">
                {pending ? "Routing…" : "Run analysis intake"}
              </button>
              {error ? <p className="analysis-intake-form__error">{error}</p> : null}
            </div>
          </form>
        </section>

        <section className="analysis-card">
          <div className="analysis-card__header-row">
            <h2 className="analysis-card__title">Study list</h2>
            <span className="analysis-card__meta">{studies.length} total</span>
          </div>
          {hasStudies ? (
            <ul className="analysis-study-list">
              {studies.map((study) => (
                <li key={study.id} className="analysis-study-list__item">
                  <div className="analysis-study-list__header">
                    <strong>
                      <Link className="analysis-study-list__link" href={`/analysis/studies/${study.id}`}>
                        {study.title}
                      </Link>
                    </strong>
                    <span className="analysis-study-list__status">{study.status}</span>
                  </div>
                  <p className="analysis-study-list__question">
                    {study.currentQuestionText ?? "No active question yet."}
                  </p>
                  <p className="analysis-study-list__meta">
                    Updated {formatTimestamp(study.updatedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="analysis-card__empty">
              No study-backed higher-rung analyses yet. Use the intake panel to open the first one.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
