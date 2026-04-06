"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { AccessSnapshot } from "@/lib/access-control";
import type {
  AdminMemberRecord,
  GetOrganizationAdminResponse,
  GovernanceJobRecord,
  OrganizationComplianceSettings,
  OrganizationAdminSummary,
  OrganizationWorkspacePlanSummary,
} from "@/lib/admin-types";
import { CUSTOMER_REVIEW_DOCS } from "@/lib/customer-review-docs";
import type { UserRole } from "@/lib/roles";

type AdminSettingsPageClientProps = {
  access: AccessSnapshot;
  role: UserRole;
};

type AdminSettingsState = {
  error: string | null;
  jobs: GovernanceJobRecord[];
  loading: boolean;
  members: AdminMemberRecord[];
  organization: OrganizationAdminSummary | null;
  saving: boolean;
  settings: OrganizationComplianceSettings | null;
  workspacePlan: OrganizationWorkspacePlanSummary | null;
};

type RetentionFieldKey =
  | "alertRetentionDays"
  | "chatHistoryRetentionDays"
  | "exportArtifactRetentionDays"
  | "knowledgeImportRetentionDays"
  | "requestLogRetentionDays"
  | "usageRetentionDays";

type RetentionPolicyPreset = "30_days" | "90_days" | "1_year" | "custom";

type RetentionFieldState = Record<RetentionFieldKey, string>;

const RETENTION_FIELD_KEYS: RetentionFieldKey[] = [
  "alertRetentionDays",
  "chatHistoryRetentionDays",
  "exportArtifactRetentionDays",
  "knowledgeImportRetentionDays",
  "requestLogRetentionDays",
  "usageRetentionDays",
];

const RETENTION_FIELD_LABELS: Record<RetentionFieldKey, string> = {
  alertRetentionDays: "Alerts retention (days)",
  chatHistoryRetentionDays: "Chat history retention (days)",
  exportArtifactRetentionDays: "Export artifacts retention (days)",
  knowledgeImportRetentionDays: "Knowledge imports retention (days)",
  requestLogRetentionDays: "Request logs retention (days)",
  usageRetentionDays: "Usage events retention (days)",
};

const RETENTION_POLICY_OPTIONS: Array<{
  description: string;
  label: string;
  value: RetentionPolicyPreset;
}> = [
  {
    description: "Set all retention windows to 30 days.",
    label: "30 Days",
    value: "30_days",
  },
  {
    description: "Set all retention windows to 90 days.",
    label: "90 Days",
    value: "90_days",
  },
  {
    description: "Set all retention windows to 1 year.",
    label: "1 Year",
    value: "1_year",
  },
  {
    description: "Set each retention window independently.",
    label: "Custom",
    value: "custom",
  },
];

const RETENTION_PRESET_DAYS: Record<Exclude<RetentionPolicyPreset, "custom">, number> = {
  "30_days": 30,
  "90_days": 90,
  "1_year": 365,
};

const DEFAULT_RETENTION_FIELDS: RetentionFieldState = {
  alertRetentionDays: "",
  chatHistoryRetentionDays: "",
  exportArtifactRetentionDays: "7",
  knowledgeImportRetentionDays: "",
  requestLogRetentionDays: "",
  usageRetentionDays: "",
};

function buildUniformRetentionFields(days: number): RetentionFieldState {
  const value = `${Math.max(1, Math.trunc(days))}`;

  return {
    alertRetentionDays: value,
    chatHistoryRetentionDays: value,
    exportArtifactRetentionDays: value,
    knowledgeImportRetentionDays: value,
    requestLogRetentionDays: value,
    usageRetentionDays: value,
  };
}

function toRetentionFieldState(settings: OrganizationComplianceSettings): RetentionFieldState {
  return {
    alertRetentionDays: settings.alertRetentionDays?.toString() ?? "",
    chatHistoryRetentionDays: settings.chatHistoryRetentionDays?.toString() ?? "",
    exportArtifactRetentionDays: settings.exportArtifactRetentionDays.toString(),
    knowledgeImportRetentionDays: settings.knowledgeImportRetentionDays?.toString() ?? "",
    requestLogRetentionDays: settings.requestLogRetentionDays?.toString() ?? "",
    usageRetentionDays: settings.usageRetentionDays?.toString() ?? "",
  };
}

function inferRetentionPolicy(fields: RetentionFieldState): RetentionPolicyPreset {
  const parsedValues = RETENTION_FIELD_KEYS.map((key) => {
    const trimmed = fields[key].trim();
    return trimmed.length > 0 ? Number(trimmed) : Number.NaN;
  });

  if (!parsedValues.every((value) => Number.isFinite(value))) {
    return "custom";
  }

  const [firstValue, ...restValues] = parsedValues;

  if (!restValues.every((value) => value === firstValue)) {
    return "custom";
  }

  if (firstValue === RETENTION_PRESET_DAYS["30_days"]) {
    return "30_days";
  }

  if (firstValue === RETENTION_PRESET_DAYS["90_days"]) {
    return "90_days";
  }

  if (firstValue === RETENTION_PRESET_DAYS["1_year"]) {
    return "1_year";
  }

  return "custom";
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: number | null) {
  return value ? DATE_TIME_FORMATTER.format(value) : "Not yet";
}

function formatBytes(value: number | null) {
  if (value === null) {
    return "Pending";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function getLatestCompletedExportJob(jobs: GovernanceJobRecord[]) {
  return jobs.find((job) => job.jobType === "organization_export" && job.status === "completed") ?? null;
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

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export function AdminSettingsPageClient({ access, role }: AdminSettingsPageClientProps) {
  const [state, setState] = useState<AdminSettingsState>({
    error: null,
    jobs: [],
    loading: true,
    members: [],
    organization: null,
    saving: false,
    settings: null,
    workspacePlan: null,
  });
  const [organizationName, setOrganizationName] = useState("");
  const [newMember, setNewMember] = useState({
    email: "",
    name: "",
    password: "",
    role: "member",
  });
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicyPreset>("custom");
  const [retentionFields, setRetentionFields] =
    useState<RetentionFieldState>(DEFAULT_RETENTION_FIELDS);
  const [cutoffDate, setCutoffDate] = useState("");
  const [showDataDeletionModal, setShowDataDeletionModal] = useState(false);

  const applyRetentionPreset = (preset: RetentionPolicyPreset) => {
    setRetentionPolicy(preset);

    if (preset === "custom") {
      return;
    }

    setRetentionFields(buildUniformRetentionFields(RETENTION_PRESET_DAYS[preset]));
  };

  const refresh = async () => {
    setState((current) => ({
      ...current,
      error: null,
      loading: current.organization === null,
    }));

    try {
      const [organizationResponse, membersResponse, settingsResponse, jobsResponse] =
        await Promise.all([
          fetch("/api/admin/organization", { cache: "no-store" }),
          fetch("/api/admin/members", { cache: "no-store" }),
          fetch("/api/admin/compliance-settings", { cache: "no-store" }),
          fetch("/api/admin/governance-jobs", { cache: "no-store" }),
        ]);
      const [organizationData, membersData, settingsData, jobsData] = await Promise.all([
        parseJson(organizationResponse),
        parseJson(membersResponse),
        parseJson(settingsResponse),
        parseJson(jobsResponse),
      ]);

      if (
        !organizationResponse.ok ||
        !membersResponse.ok ||
        !settingsResponse.ok ||
        !jobsResponse.ok
      ) {
        throw new Error(
          getErrorMessage(
            organizationData.error
              ? organizationData
              : membersData.error
                ? membersData
                : settingsData.error
                  ? settingsData
                  : jobsData,
            "Failed to load admin settings.",
          ),
        );
      }

      const organizationPayload = organizationData as GetOrganizationAdminResponse;
      const organization = organizationPayload.organization as OrganizationAdminSummary;
      const members = membersData.members as AdminMemberRecord[];
      const settings = settingsData.settings as OrganizationComplianceSettings;
      const jobs = jobsData.jobs as GovernanceJobRecord[];

      const nextRetentionFields = toRetentionFieldState(settings);

      setOrganizationName(organization.name);
      setRetentionFields(nextRetentionFields);
      setRetentionPolicy(inferRetentionPolicy(nextRetentionFields));
      setState({
        error: null,
        jobs,
        loading: false,
        members,
        organization,
        saving: false,
        settings,
        workspacePlan: organizationPayload.workspacePlan,
      });
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load admin settings.",
        loading: false,
        saving: false,
      }));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!state.jobs.some((job) => job.status === "queued" || job.status === "running")) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void refresh();
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [state.jobs]);

  useEffect(() => {
    if (!showDataDeletionModal) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDataDeletionModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showDataDeletionModal]);

  const latestExportJob = useMemo(() => getLatestCompletedExportJob(state.jobs), [state.jobs]);
  const activeExportJob = useMemo(
    () =>
      state.jobs.find(
        (job) =>
          job.jobType === "organization_export" &&
          (job.status === "queued" || job.status === "running"),
      ) ?? null,
    [state.jobs],
  );
  const canQueueDeletionJobs = Boolean(latestExportJob && cutoffDate);

  const updateMember = async (
    memberId: string,
    body: Record<string, number | string | null>,
  ) => {
    setState((current) => ({ ...current, error: null, saving: true }));

    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const data = await parseJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to update member."));
      }

      await refresh();
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error ? caughtError.message : "Failed to update member.",
        saving: false,
      }));
    }
  };

  const resetPassword = async (memberId: string) => {
    const nextPassword = window.prompt("Set a new password for this member:");

    if (!nextPassword) {
      return;
    }

    setState((current) => ({ ...current, error: null, saving: true }));

    try {
      const response = await fetch(
        `/api/admin/members/${encodeURIComponent(memberId)}/reset-password`,
        {
          body: JSON.stringify({ password: nextPassword }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const data = await parseJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to reset password."));
      }

      await refresh();
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error ? caughtError.message : "Failed to reset password.",
        saving: false,
      }));
    }
  };

  const handleOrganizationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState((current) => ({ ...current, error: null, saving: true }));

    try {
      const response = await fetch("/api/admin/organization", {
        body: JSON.stringify({ name: organizationName }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const data = await parseJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to update organization."));
      }

      await refresh();
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error ? caughtError.message : "Failed to update organization.",
        saving: false,
      }));
    }
  };

  const handleCreateMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState((current) => ({ ...current, error: null, saving: true }));

    try {
      const response = await fetch("/api/admin/members", {
        body: JSON.stringify(newMember),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = await parseJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to create member."));
      }

      setNewMember({
        email: "",
        name: "",
        password: "",
        role: "member",
      });
      await refresh();
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error ? caughtError.message : "Failed to create member.",
        saving: false,
      }));
    }
  };

  const handleRetentionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState((current) => ({ ...current, error: null, saving: true }));

    const toNullableNumber = (value: string) => {
      const trimmed = value.trim();
      return trimmed ? Number(trimmed) : null;
    };

    const normalizedRetentionFields =
      retentionPolicy === "custom"
        ? retentionFields
        : buildUniformRetentionFields(RETENTION_PRESET_DAYS[retentionPolicy]);

    try {
      const response = await fetch("/api/admin/compliance-settings", {
        body: JSON.stringify({
          alertRetentionDays: toNullableNumber(normalizedRetentionFields.alertRetentionDays),
          chatHistoryRetentionDays: toNullableNumber(
            normalizedRetentionFields.chatHistoryRetentionDays,
          ),
          exportArtifactRetentionDays: Number(
            normalizedRetentionFields.exportArtifactRetentionDays || "7",
          ),
          knowledgeImportRetentionDays: toNullableNumber(
            normalizedRetentionFields.knowledgeImportRetentionDays,
          ),
          requestLogRetentionDays: toNullableNumber(
            normalizedRetentionFields.requestLogRetentionDays,
          ),
          usageRetentionDays: toNullableNumber(normalizedRetentionFields.usageRetentionDays),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PUT",
      });
      const data = await parseJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to save retention settings."));
      }

      await refresh();
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to save retention settings.",
        saving: false,
      }));
    }
  };

  const queueJob = async (jobType: string) => {
    setState((current) => ({ ...current, error: null, saving: true }));

    try {
      const cutoffTimestamp = cutoffDate
        ? new Date(`${cutoffDate}T00:00:00.000Z`).getTime()
        : undefined;
      const response = await fetch("/api/admin/governance-jobs", {
        body: JSON.stringify({
          cutoffTimestamp,
          exportJobId: latestExportJob?.id,
          jobType,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = await parseJson(response);

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to queue governance job."));
      }

      await refresh();
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error ? caughtError.message : "Failed to queue governance job.",
        saving: false,
      }));
    }
  };

  return (
    <section className="settings-page">
      <header className="settings-hero">
        <div>
          <div className="settings-hero__eyebrow">Admin</div>
          <h1 className="settings-hero__title">Settings and Governance</h1>
          <p className="settings-hero__copy">
            Workspace credits, member guardrails, retention rules, exports, and review docs.
          </p>
        </div>
        {state.error ? <p className="settings-error">{state.error}</p> : null}
      </header>

      {state.loading ? (
        <div className="settings-panel">
          <p>Loading settings…</p>
        </div>
      ) : (
        <div className="settings-grid">
          <section className="settings-panel">
            <div className="settings-panel__header">
              <div>
                <div className="settings-panel__eyebrow">Organization</div>
                <h2>{state.organization?.name}</h2>
              </div>
              <span className="settings-panel__meta">{state.organization?.slug}</span>
            </div>
            {state.workspacePlan ? (
              <div className="settings-job__header">
                <strong>
                  {state.workspacePlan.planName}: {formatCredits(state.workspacePlan.remainingCredits)} credits left
                </strong>
                <span className={`settings-status settings-status--${state.workspacePlan.exhausted ? "failed" : "completed"}`}>
                  resets {formatTimestamp(state.workspacePlan.resetAt)}
                </span>
              </div>
            ) : null}
            <form className="settings-form" onSubmit={handleOrganizationSubmit}>
              <label className="settings-field">
                <span>Display name</span>
                <input
                  disabled={!access.canManageOrganizationSettings}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  type="text"
                  value={organizationName}
                />
              </label>
              <button
                className="settings-button"
                disabled={state.saving || !access.canManageOrganizationSettings}
                type="submit"
              >
                Save organization
              </button>
            </form>
          </section>

          <section className="settings-panel">
            <div className="settings-panel__header">
              <div>
                <div className="settings-panel__eyebrow">Governance</div>
                <h2>Retention and lifecycle controls</h2>
              </div>
              <span className="settings-panel__meta">
                Updated {formatTimestamp(state.settings?.updatedAt ?? null)}
              </span>
            </div>
            <form className="settings-form" onSubmit={handleRetentionSubmit}>
              <label className="settings-field">
                <span>Data retention policy</span>
                <select
                  disabled={!access.canManageGovernance}
                  onChange={(event) =>
                    applyRetentionPreset(event.target.value as RetentionPolicyPreset)
                  }
                  value={retentionPolicy}
                >
                  {RETENTION_POLICY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <p className="settings-panel__meta">
                {RETENTION_POLICY_OPTIONS.find((option) => option.value === retentionPolicy)
                  ?.description ?? "Configure how long governance data is kept."}
              </p>

              {retentionPolicy === "custom" ? (
                <div className="settings-form settings-form--grid">
                  {RETENTION_FIELD_KEYS.map((key) => (
                    <label className="settings-field" key={key}>
                      <span>{RETENTION_FIELD_LABELS[key]}</span>
                      <input
                        disabled={!access.canManageGovernance}
                        onChange={(event) =>
                          setRetentionFields((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        type="number"
                        value={retentionFields[key]}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="settings-panel__meta">
                  All retention categories will be saved as {RETENTION_PRESET_DAYS[retentionPolicy]} days.
                </p>
              )}

              <button
                className="settings-button"
                disabled={state.saving || !access.canManageGovernance}
                type="submit"
              >
                Save retention policy
              </button>
            </form>
            <div className="settings-data-deletion">
              <p className="settings-panel__meta">
                Need to remove historical data? Open a guided flow that explains the required export
                step before permanent deletion actions.
              </p>
              <button
                className="settings-button settings-button--ghost"
                disabled={state.saving || !access.canManageGovernance}
                onClick={() => setShowDataDeletionModal(true)}
                type="button"
              >
                Manage Data Deletion
              </button>
            </div>

            {showDataDeletionModal ? (
              <div
                className="settings-dialog-backdrop"
                onClick={() => setShowDataDeletionModal(false)}
                role="presentation"
              >
                <div
                  aria-label="Data deletion workflow"
                  aria-modal="true"
                  className="settings-dialog"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                >
                  <div className="settings-dialog__header">
                    <div>
                      <p className="settings-dialog__eyebrow">Data Deletion</p>
                      <h3 className="settings-dialog__title">Guided compliance workflow</h3>
                    </div>
                    <button
                      className="settings-button settings-button--ghost"
                      onClick={() => setShowDataDeletionModal(false)}
                      type="button"
                    >
                      Close
                    </button>
                  </div>

                  <p className="settings-panel__meta">
                    To maintain an audit trail, queue and complete a full export before deletion.
                    Then choose a cutoff date and select what to purge.
                  </p>

                  <div className="settings-dialog__steps">
                    <article className="settings-dialog__step">
                      <div className="settings-dialog__step-header">
                        <strong>Step 1 · Queue a full export</strong>
                        {activeExportJob ? (
                          <span className={`settings-status settings-status--${activeExportJob.status}`}>
                            {activeExportJob.status}
                          </span>
                        ) : latestExportJob ? (
                          <span className="settings-status settings-status--completed">ready</span>
                        ) : (
                          <span className="settings-dialog__required">required</span>
                        )}
                      </div>
                      <p className="settings-panel__meta">
                        {activeExportJob
                          ? `An export is currently ${activeExportJob.status}.`
                          : latestExportJob
                            ? `Latest completed export: ${formatTimestamp(latestExportJob.completedAt ?? latestExportJob.updatedAt)}.`
                            : "No completed full export is available yet."}
                      </p>
                      <button
                        className="settings-button"
                        disabled={state.saving || !access.canManageGovernance}
                        onClick={() => void queueJob("organization_export")}
                        type="button"
                      >
                        Queue full export
                      </button>
                    </article>

                    <article className="settings-dialog__step">
                      <div className="settings-dialog__step-header">
                        <strong>Step 2 · Choose deletion cutoff</strong>
                        {cutoffDate ? (
                          <span className="settings-status settings-status--completed">set</span>
                        ) : (
                          <span className="settings-dialog__required">required</span>
                        )}
                      </div>
                      <label className="settings-field">
                        <span>Delete data created before</span>
                        <input
                          disabled={!access.canManageGovernance}
                          onChange={(event) => setCutoffDate(event.target.value)}
                          type="date"
                          value={cutoffDate}
                        />
                      </label>
                    </article>

                    <article className="settings-dialog__step">
                      <div className="settings-dialog__step-header">
                        <strong>Step 3 · Queue deletion task</strong>
                        {canQueueDeletionJobs ? (
                          <span className="settings-status settings-status--completed">ready</span>
                        ) : (
                          <span className="settings-dialog__required">blocked</span>
                        )}
                      </div>
                      <p className="settings-panel__meta">
                        Choose one deletion action after export + cutoff are both ready.
                      </p>
                      <div className="settings-job-controls">
                        <button
                          className="settings-button settings-button--ghost"
                          disabled={
                            state.saving || !access.canManageGovernance || !canQueueDeletionJobs
                          }
                          onClick={() => void queueJob("history_purge")}
                          type="button"
                        >
                          Purge chat history
                        </button>
                        <button
                          className="settings-button settings-button--ghost"
                          disabled={
                            state.saving || !access.canManageGovernance || !canQueueDeletionJobs
                          }
                          onClick={() => void queueJob("import_metadata_purge")}
                          type="button"
                        >
                          Purge import metadata
                        </button>
                        <button
                          className="settings-button settings-button--ghost"
                          disabled={
                            state.saving || !access.canManageGovernance || !canQueueDeletionJobs
                          }
                          onClick={() => void queueJob("knowledge_delete")}
                          type="button"
                        >
                          Delete managed files
                        </button>
                      </div>
                    </article>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="settings-panel">
            <div className="settings-panel__header">
              <div>
                <div className="settings-panel__eyebrow">Members</div>
                <h2>Access and identity</h2>
              </div>
              <span className="settings-panel__meta">{state.members.length} members</span>
            </div>
            <form className="settings-form settings-form--inline" onSubmit={handleCreateMember}>
              <input
                disabled={!access.canManageMembers}
                onChange={(event) =>
                  setNewMember((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Name"
                type="text"
                value={newMember.name}
              />
              <input
                disabled={!access.canManageMembers}
                onChange={(event) =>
                  setNewMember((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="Email"
                type="email"
                value={newMember.email}
              />
              <input
                disabled={!access.canManageMembers}
                onChange={(event) =>
                  setNewMember((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="Initial password"
                type="text"
                value={newMember.password}
              />
              <select
                disabled={!access.canManageMembers}
                onChange={(event) =>
                  setNewMember((current) => ({ ...current, role: event.target.value }))
                }
                value={newMember.role}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              <button
                className="settings-button"
                disabled={state.saving || !access.canManageMembers}
                type="submit"
              >
                Add member
              </button>
            </form>
            <div className="settings-table">
              {state.members.map((member) => (
                <article className="settings-table__row" key={member.id}>
                  <div>
                    <strong>{member.name || member.email}</strong>
                    <div className="settings-table__meta">
                      {member.email}
                      {member.monthlyCreditCap === null
                        ? " • shared workspace pool"
                        : ` • cap ${formatCredits(member.monthlyCreditCap)} credits`}
                    </div>
                    <div className="settings-table__meta">
                      {member.capabilitySummary.join(" • ")}
                    </div>
                  </div>
                  <select
                    disabled={!access.canManageMembers}
                    defaultValue={member.role}
                    onChange={(event) =>
                      void updateMember(member.id, { role: event.target.value })
                    }
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                  <select
                    disabled={!access.canManageMembers}
                    defaultValue={member.status}
                    onChange={(event) =>
                      void updateMember(member.id, { status: event.target.value })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="restricted">Restricted</option>
                    <option value="suspended">Suspended</option>
                  </select>
                  <input
                    disabled={!access.canManageMembers}
                    defaultValue={member.monthlyCreditCap ?? ""}
                    min={0}
                    onBlur={(event) => {
                      const trimmed = event.target.value.trim();
                      void updateMember(member.id, {
                        monthlyCreditCap: trimmed === "" ? null : Number(trimmed),
                      });
                    }}
                    placeholder="Shared pool"
                    type="number"
                  />
                  <button
                    className="settings-button settings-button--ghost"
                    disabled={!access.canManageMembers}
                    onClick={() => void resetPassword(member.id)}
                    type="button"
                  >
                    Reset password
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="settings-panel">
            <div className="settings-panel__header">
              <div>
                <div className="settings-panel__eyebrow">Access Control</div>
                <h2>{role === "owner" ? "Owner policy view" : "Admin policy view"}</h2>
              </div>
            </div>
            <div className="settings-table">
              {[
                "member: public-scope chat, search, analysis, chart, and document access",
                "admin: member access plus member management, policy visibility, audit logs, operations, and review docs",
                "owner: admin access plus organization settings, export downloads, and destructive governance",
                "restricted: sign-in allowed, but search, chat, imports, and sandbox tools are blocked",
              ].map((line) => (
                <article className="settings-table__row" key={line}>
                  <div>{line}</div>
                </article>
              ))}
            </div>
          </section>

          <section className="settings-panel">
            <div className="settings-panel__header">
              <div>
                <div className="settings-panel__eyebrow">Governance Jobs</div>
                <h2>Recent exports and purge runs</h2>
              </div>
              <span className="settings-panel__meta">{state.jobs.length} jobs</span>
            </div>
            <div className="settings-jobs">
              {state.jobs.map((job) => (
                <article className="settings-job" key={job.id}>
                  <div className="settings-job__header">
                    <strong>{job.jobType}</strong>
                    <span className={`settings-status settings-status--${job.status}`}>
                      {job.status}
                    </span>
                  </div>
                  <p>{job.targetLabel}</p>
                  <div className="settings-table__meta">
                    <span>{formatTimestamp(job.createdAt)}</span>
                    <span>{job.requestedByUserEmail ?? "Automatic"}</span>
                    <span>{job.artifact.hasArtifact ? formatBytes(job.artifact.byteSize) : "No artifact"}</span>
                  </div>
                  {job.artifact.hasArtifact && access.canManageGovernance ? (
                    <a
                      className="settings-link"
                      href={`/api/admin/governance-jobs/${encodeURIComponent(job.id)}/download`}
                    >
                      Download export
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="settings-panel">
            <div className="settings-panel__header">
              <div>
                <div className="settings-panel__eyebrow">Customer Review</div>
                <h2>Review package and operational docs</h2>
              </div>
            </div>
            <div className="settings-docs">
              {CUSTOMER_REVIEW_DOCS.map((doc) => (
                <a
                  key={doc.slug}
                  className="settings-link"
                  href={`/api/admin/customer-review/${doc.slug}`}
                  target="_blank"
                >
                  {doc.label}
                </a>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
