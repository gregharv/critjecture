"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { CausalStudySummary } from "@/lib/causal-studies";
import type { CausalIntakeResponse } from "@/lib/causal-intent-types";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type CausalStudiesPageClientProps = {
  initialStudies: CausalStudySummary[];
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

export function CausalStudiesPageClient({
  initialStudies,
}: CausalStudiesPageClientProps) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<CausalIntakeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [studies, setStudies] = useState(initialStudies);

  const hasStudies = studies.length > 0;
  const helperText = useMemo(() => {
    if (!response) {
      return "Intent routing happens before any dataset analysis. Ask a what-if question to open a causal study, a predictive question to open the predictive path, or a descriptive question to stay observational.";
    }

    if (response.decision === "open_causal_study") {
      return `Opened study ${response.studyId} with question ${response.studyQuestionId}.`;
    }

    if (response.decision === "continue_descriptive") {
      return `This request stays on the descriptive path at ${response.nextPath}.`;
    }

    if (response.decision === "open_predictive_analysis") {
      return `This request opens the predictive path at ${response.nextPath}.`;
    }

    if (response.decision === "ask_clarification") {
      return response.question;
    }

    return response.message;
  }, [response]);

  async function refreshStudies() {
    const studiesResponse = await fetch("/api/causal/studies", {
      cache: "no-store",
    });
    const json = (await studiesResponse.json()) as unknown;

    if (!studiesResponse.ok) {
      throw new Error(getErrorMessage(json, "Failed to refresh causal studies."));
    }

    const nextStudies =
      typeof json === "object" && json !== null && "studies" in json && Array.isArray(json.studies)
        ? (json.studies as CausalStudySummary[])
        : [];

    setStudies(nextStudies);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setError("Enter a question before starting causal intake.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const intakeResponse = await fetch("/api/causal/intake", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: trimmedMessage }),
      });
      const json = (await intakeResponse.json()) as unknown;

      if (!intakeResponse.ok) {
        throw new Error(getErrorMessage(json, "Causal intake failed."));
      }

      const nextResponse = json as CausalIntakeResponse;
      setResponse(nextResponse);

      if (nextResponse.decision === "open_causal_study") {
        await refreshStudies();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Causal intake failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="causal-page">
      <div className="causal-hero">
        <p className="causal-hero__eyebrow">Causal-first workspace</p>
        <h1 className="causal-hero__title">Causal studies</h1>
        <p className="causal-hero__copy">{helperText}</p>
      </div>

      <div className="causal-grid">
        <section className="causal-card">
          <h2 className="causal-card__title">Start with intake</h2>
          <p className="causal-card__copy">
            Intake classifies intent before any dataset analysis. Causal questions open a study;
            descriptive and diagnostic questions stay on an observational path; predictive questions
            route to a separate predictive path.
          </p>
          <form className="causal-intake-form" onSubmit={handleSubmit}>
            <label className="causal-intake-form__label" htmlFor="causal-intake-message">
              Question
            </label>
            <textarea
              id="causal-intake-message"
              className="causal-intake-form__textarea"
              disabled={pending}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Did discount rate affect conversion?"
              rows={5}
              value={message}
            />
            <div className="causal-intake-form__actions">
              <button className="causal-intake-form__submit" disabled={pending} type="submit">
                {pending ? "Routing…" : "Run causal intake"}
              </button>
              {error ? <p className="causal-intake-form__error">{error}</p> : null}
            </div>
          </form>
        </section>

        <section className="causal-card">
          <div className="causal-card__header-row">
            <h2 className="causal-card__title">Study list</h2>
            <span className="causal-card__meta">{studies.length} total</span>
          </div>
          {hasStudies ? (
            <ul className="causal-study-list">
              {studies.map((study) => (
                <li key={study.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>
                      <Link className="causal-study-list__link" href={`/causal/studies/${study.id}`}>
                        {study.title}
                      </Link>
                    </strong>
                    <span className="causal-study-list__status">{study.status}</span>
                  </div>
                  <p className="causal-study-list__question">
                    {study.currentQuestionText ?? "No active question yet."}
                  </p>
                  <p className="causal-study-list__meta">
                    Updated {formatTimestamp(study.updatedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">
              No causal studies yet. Use the intake panel to open the first one.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
