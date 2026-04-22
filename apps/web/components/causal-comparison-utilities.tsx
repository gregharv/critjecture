type ComparisonSnapshotRow = {
  available: boolean;
  baseRunId: string;
  id: string;
  name: string;
  pinned: boolean;
  targetRunId: string;
  updatedAt: number;
};

type RecentComparisonRow = {
  available: boolean;
  baseRunId: string;
  id: string;
  targetRunId: string;
  updatedAt: number;
};

type CausalComparisonUtilitiesProps = {
  comparisonBaseRunId: string;
  comparisonError: string | null;
  comparisonLastSyncedAt: number | null;
  comparisonPending: boolean;
  comparisonPendingAction: string | null;
  comparisonSnapshots: ComparisonSnapshotRow[];
  comparisonSuccessMessage: string | null;
  comparisonTargetRunId: string;
  editingComparisonSnapshotId: string | null;
  formatComparisonPairLabel: (baseRunId: string, targetRunId: string) => string;
  formatTimestamp: (timestamp: number) => string;
  newComparisonSnapshotName: string;
  onApplyComparisonSnapshot: (snapshotId: string) => void;
  onApplyRecentComparison: (entryId: string) => void;
  onCancelComparisonSnapshotEdit: () => void;
  onClearRecentComparisons: () => void;
  onDeleteComparisonSnapshot: (snapshotId: string) => void;
  onDeleteRecentComparison: (entryId: string) => void;
  onLoadSnapshotIntoEditor: (snapshot: { baseRunId: string; name: string; targetRunId: string }) => void;
  onNewComparisonSnapshotNameChange: (value: string) => void;
  onSaveComparisonSnapshot: () => void;
  onSaveRecentComparisonAsSnapshot: (entryId: string) => void;
  onStartRenameComparisonSnapshot: (snapshotId: string) => void;
  onSuggestSnapshotName: (value: string) => void;
  onTogglePinComparisonSnapshot: (snapshotId: string) => void;
  recentComparisons: RecentComparisonRow[];
};

const COMPARISON_UTILITY_SECTION_STYLE = {
  background: "rgba(255, 255, 255, 0.72)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 12,
  display: "grid",
  gap: 12,
  padding: 12,
} as const;

export function CausalComparisonUtilities({
  comparisonBaseRunId,
  comparisonError,
  comparisonLastSyncedAt,
  comparisonPending,
  comparisonPendingAction,
  comparisonSnapshots,
  comparisonSuccessMessage,
  comparisonTargetRunId,
  editingComparisonSnapshotId,
  formatComparisonPairLabel,
  formatTimestamp,
  newComparisonSnapshotName,
  onApplyComparisonSnapshot,
  onApplyRecentComparison,
  onCancelComparisonSnapshotEdit,
  onClearRecentComparisons,
  onDeleteComparisonSnapshot,
  onDeleteRecentComparison,
  onLoadSnapshotIntoEditor,
  onNewComparisonSnapshotNameChange,
  onSaveComparisonSnapshot,
  onSaveRecentComparisonAsSnapshot,
  onStartRenameComparisonSnapshot,
  onSuggestSnapshotName,
  onTogglePinComparisonSnapshot,
  recentComparisons,
}: CausalComparisonUtilitiesProps) {
  return (
    <>
      <div
        aria-atomic="true"
        aria-live="polite"
        className="causal-readiness"
        style={{ marginBottom: 12 }}
      >
        {comparisonPendingAction ? <p className="causal-card__meta">{comparisonPendingAction}</p> : null}
        {comparisonError ? <p className="causal-intake-form__error">{comparisonError}</p> : null}
        {!comparisonPendingAction && !comparisonError && comparisonSuccessMessage ? (
          <p className="causal-card__meta" style={{ color: "#166534" }}>{comparisonSuccessMessage}</p>
        ) : null}
        {!comparisonPendingAction && !comparisonError && comparisonLastSyncedAt ? (
          <p className="causal-card__meta">Last synced {formatTimestamp(comparisonLastSyncedAt)}</p>
        ) : null}
      </div>
      <div className="causal-grid" style={{ marginTop: 0 }}>
        <div style={COMPARISON_UTILITY_SECTION_STYLE}>
          <div className="causal-card__header-row">
            <div>
              <strong className="causal-card__meta">Named comparison snapshots</strong>
              <p className="causal-card__meta">Saved to your account for this study.</p>
            </div>
            <span className="causal-card__meta">{comparisonSnapshots.length} saved</span>
          </div>
          <div className="causal-inline-form">
            <input
              className="causal-text-input"
              onChange={(event) => onNewComparisonSnapshotNameChange(event.target.value)}
              placeholder={editingComparisonSnapshotId ? "Rename selected snapshot" : "Name this comparison snapshot"}
              value={newComparisonSnapshotName}
            />
            <button
              className="causal-inline-button"
              disabled={
                comparisonPending ||
                !newComparisonSnapshotName.trim() ||
                (!editingComparisonSnapshotId && (!comparisonBaseRunId || !comparisonTargetRunId))
              }
              onClick={onSaveComparisonSnapshot}
              type="button"
            >
              {comparisonPending
                ? editingComparisonSnapshotId
                  ? "Renaming…"
                  : "Saving…"
                : editingComparisonSnapshotId
                  ? "Rename snapshot"
                  : "Save snapshot"}
            </button>
            {editingComparisonSnapshotId ? (
              <button
                className="causal-inline-button"
                disabled={comparisonPending}
                onClick={onCancelComparisonSnapshotEdit}
                type="button"
              >
                Cancel rename
              </button>
            ) : null}
          </div>
          {comparisonSnapshots.length ? (
            <ul className="causal-study-list">
              {comparisonSnapshots.map((snapshot) => (
                <li key={snapshot.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{snapshot.name}</strong>
                    <div className="causal-inline-actions">
                      {snapshot.pinned ? (
                        <span
                          className="causal-card__meta"
                          style={{
                            background: "#fffbeb",
                            border: "1px solid rgba(217, 119, 6, 0.18)",
                            borderRadius: 999,
                            color: "#b45309",
                            display: "inline-flex",
                            fontWeight: 600,
                            padding: "4px 10px",
                          }}
                        >
                          Pinned
                        </span>
                      ) : null}
                      <span className="causal-study-list__status">
                        {snapshot.available ? "available" : "run missing"}
                      </span>
                    </div>
                  </div>
                  <p className="causal-study-list__meta">
                    {formatComparisonPairLabel(snapshot.baseRunId, snapshot.targetRunId)} · updated {formatTimestamp(snapshot.updatedAt)}
                  </p>
                  <div className="causal-inline-actions" style={{ marginTop: 8, rowGap: 8 }}>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending || !snapshot.available}
                      onClick={() => onApplyComparisonSnapshot(snapshot.id)}
                      type="button"
                    >
                      Apply snapshot
                    </button>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending}
                      onClick={() => onStartRenameComparisonSnapshot(snapshot.id)}
                      type="button"
                    >
                      Rename
                    </button>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending}
                      onClick={() => onTogglePinComparisonSnapshot(snapshot.id)}
                      type="button"
                    >
                      {snapshot.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending}
                      onClick={() =>
                        onLoadSnapshotIntoEditor({
                          baseRunId: snapshot.baseRunId,
                          name: snapshot.name,
                          targetRunId: snapshot.targetRunId,
                        })
                      }
                      type="button"
                    >
                      Load into editor
                    </button>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending}
                      onClick={() => onDeleteComparisonSnapshot(snapshot.id)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No named comparison snapshots yet.</p>
          )}
        </div>
        <div style={COMPARISON_UTILITY_SECTION_STYLE}>
          <div className="causal-card__header-row">
            <div>
              <strong className="causal-card__meta">Recent comparisons</strong>
              <p className="causal-card__meta">Automatically tracked for your account as you open comparison pairs.</p>
            </div>
            <div className="causal-inline-actions">
              <span className="causal-card__meta">{recentComparisons.length} recent</span>
              {recentComparisons.length ? (
                <button className="causal-inline-button" disabled={comparisonPending} onClick={onClearRecentComparisons} type="button">
                  Clear history
                </button>
              ) : null}
            </div>
          </div>
          {recentComparisons.length ? (
            <ul className="causal-study-list">
              {recentComparisons.map((entry) => (
                <li key={entry.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{formatComparisonPairLabel(entry.baseRunId, entry.targetRunId)}</strong>
                    <span className="causal-study-list__status">
                      {entry.available ? "available" : "run missing"}
                    </span>
                  </div>
                  <p className="causal-study-list__meta">Last used {formatTimestamp(entry.updatedAt)}</p>
                  <div className="causal-inline-actions" style={{ marginTop: 8, rowGap: 8 }}>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending || !entry.available}
                      onClick={() => onApplyRecentComparison(entry.id)}
                      type="button"
                    >
                      Reopen comparison
                    </button>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending || !entry.available}
                      onClick={() => onSaveRecentComparisonAsSnapshot(entry.id)}
                      type="button"
                    >
                      Save as snapshot
                    </button>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending || !entry.available}
                      onClick={() => onSuggestSnapshotName(`${entry.baseRunId} vs ${entry.targetRunId}`)}
                      type="button"
                    >
                      Suggest snapshot name
                    </button>
                    <button
                      className="causal-inline-button"
                      disabled={comparisonPending}
                      onClick={() => onDeleteRecentComparison(entry.id)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No recent comparisons yet.</p>
          )}
        </div>
      </div>
    </>
  );
}
