"use client";

import { useEffect, useState } from "react";

import type { AnalysisPreviewBootstrapResponse } from "@/lib/marimo-types";

type MarimoPreviewPaneProps = {
  conversationId: string;
  refreshNonce?: number;
};

export function MarimoPreviewPane({ conversationId, refreshNonce = 0 }: MarimoPreviewPaneProps) {
  const [bootstrap, setBootstrap] = useState<AnalysisPreviewBootstrapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPreview() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          refreshNonce > 0
            ? `/api/analysis/workspaces/${encodeURIComponent(conversationId)}/preview/restart`
            : `/api/analysis/workspaces/${encodeURIComponent(conversationId)}/preview`,
          {
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
            },
            method: refreshNonce > 0 ? "POST" : "GET",
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as AnalysisPreviewBootstrapResponse | { error: string };

        if (!response.ok) {
          throw new Error("error" in data ? data.error : "Failed to load notebook preview.");
        }

        if (controller.signal.aborted) {
          return;
        }

        setBootstrap(data as AnalysisPreviewBootstrapResponse);
      } catch (caughtError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(caughtError instanceof Error ? caughtError.message : "Failed to load notebook preview.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      controller.abort();
    };
  }, [conversationId, refreshNonce]);

  if (loading) {
    return <div className="analysis-preview-pane__empty">Starting notebook preview…</div>;
  }

  if (error) {
    return (
      <div className="analysis-preview-pane__empty">
        <p>{error}</p>
        {bootstrap?.fallbackHtmlUrl ? (
          <a href={bootstrap.fallbackHtmlUrl} rel="noreferrer" target="_blank">
            Open last exported notebook HTML
          </a>
        ) : null}
      </div>
    );
  }

  if (!bootstrap) {
    return <div className="analysis-preview-pane__empty">Notebook preview is not available yet.</div>;
  }

  return (
    <div className="analysis-preview-pane">
      <div className="analysis-preview-pane__meta">
        <span>Revision {bootstrap.revisionId}</span>
        <span>Session expires at {new Date(bootstrap.expiresAt).toLocaleTimeString()}</span>
      </div>
      <iframe
        className="analysis-preview-pane__frame"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms"
        src={bootstrap.proxyUrl}
        title="Marimo analysis notebook"
      />
    </div>
  );
}
