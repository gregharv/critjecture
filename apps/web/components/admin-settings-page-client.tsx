"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type {
  AdminMemberRecord,
  GovernanceJobRecord,
  OrganizationComplianceSettings,
  OrganizationAdminSummary,
} from "@/lib/admin-types";
import { CUSTOMER_REVIEW_DOCS } from "@/lib/customer-review-docs";

type AdminSettingsState = {
  error: string | null;
  jobs: GovernanceJobRecord[];
  loading: boolean;
  members: AdminMemberRecord[];
  organization: OrganizationAdminSummary | null;
  saving: boolean;
  settings: OrganizationComplianceSettings | null;
};

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

export function AdminSettingsPageClient() {
  const [state, setState] = useState<AdminSettingsState>({
    error: null,
    jobs: [],
    loading: true,
    members: [],
    organization: null,
    saving: false,
    settings: null,
  });
  const [organizationName, setOrganizationName] = useState("");
  const [newMember, setNewMember] = useState({
    email: "",
    name: "",
    password: "",
    role: "intern",
  });
  const [retentionFields, setRetentionFields] = useState<Record<string, string>>({
    alertRetentionDays: "",
    chatHistoryRetentionDays: "",
    exportArtifactRetentionDays: "7",
    knowledgeImportRetentionDays: "",
    requestLogRetentionDays: "",
    usageRetentionDays: "",
  });
  const [cutoffDate, setCutoffDate] = useState("");

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

      const organization = organizationData.organization as OrganizationAdminSummary;
      const members = membersData.members as AdminMemberRecord[];
      const settings = settingsData.settings as OrganizationComplianceSettings;
      const jobs = jobsData.jobs as GovernanceJobRecord[];

      setOrganizationName(organization.name);
      setRetentionFields({
        alertRetentionDays: settings.alertRetentionDays?.toString() ?? "",
        chatHistoryRetentionDays: settings.chatHistoryRetentionDays?.toString() ?? "",
        exportArtifactRetentionDays: settings.exportArtifactRetentionDays.toString(),
        knowledgeImportRetentionDays: settings.knowledgeImportRetentionDays?.toString() ?? "",
        requestLogRetentionDays: settings.requestLogRetentionDays?.toString() ?? "",
        usageRetentionDays: settings.usageRetentionDays?.toString() ?? "",
      });
      setState({
        error: null,
        jobs,
        loading: false,
        members,
        organization,
        saving: false,
        settings,
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

  const latestExportJob = useMemo(() => getLatestCompletedExportJob(state.jobs), [state.jobs]);

  const updateMember = async (
    memberId: string,
    body: Record<string, string | null>,
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
        role: "intern",
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

    try {
      const response = await fetch("/api/admin/compliance-settings", {
        body: JSON.stringify({
          alertRetentionDays: toNullableNumber(retentionFields.alertRetentionDays),
          chatHistoryRetentionDays: toNullableNumber(retentionFields.chatHistoryRetentionDays),
          exportArtifactRetentionDays: Number(retentionFields.exportArtifactRetentionDays || "7"),
          knowledgeImportRetentionDays: toNullableNumber(
            retentionFields.knowledgeImportRetentionDays,
          ),
          requestLogRetentionDays: toNullableNumber(retentionFields.requestLogRetentionDays),
          usageRetentionDays: toNullableNumber(retentionFields.usageRetentionDays),
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
            Owner-managed members, retention rules, organization exports, and review docs.
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
            <form className="settings-form" onSubmit={handleOrganizationSubmit}>
              <label className="settings-field">
                <span>Display name</span>
                <input
                  onChange={(event) => setOrganizationName(event.target.value)}
                  type="text"
                  value={organizationName}
                />
              </label>
              <button className="settings-button" disabled={state.saving} type="submit">
                Save organization
              </button>
            </form>
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
                onChange={(event) =>
                  setNewMember((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Name"
                type="text"
                value={newMember.name}
              />
              <input
                onChange={(event) =>
                  setNewMember((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="Email"
                type="email"
                value={newMember.email}
              />
              <input
                onChange={(event) =>
                  setNewMember((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="Initial password"
                type="text"
                value={newMember.password}
              />
              <select
                onChange={(event) =>
                  setNewMember((current) => ({ ...current, role: event.target.value }))
                }
                value={newMember.role}
              >
                <option value="intern">Intern</option>
                <option value="owner">Owner</option>
              </select>
              <button className="settings-button" disabled={state.saving} type="submit">
                Add member
              </button>
            </form>
            <div className="settings-table">
              {state.members.map((member) => (
                <article className="settings-table__row" key={member.id}>
                  <div>
                    <strong>{member.name || member.email}</strong>
                    <div className="settings-table__meta">{member.email}</div>
                  </div>
                  <select
                    defaultValue={member.role}
                    onChange={(event) =>
                      void updateMember(member.id, { role: event.target.value })
                    }
                  >
                    <option value="intern">Intern</option>
                    <option value="owner">Owner</option>
                  </select>
                  <select
                    defaultValue={member.status}
                    onChange={(event) =>
                      void updateMember(member.id, { status: event.target.value })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                  <button
                    className="settings-button settings-button--ghost"
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
                <div className="settings-panel__eyebrow">Governance</div>
                <h2>Retention and lifecycle controls</h2>
              </div>
              <span className="settings-panel__meta">
                Updated {formatTimestamp(state.settings?.updatedAt ?? null)}
              </span>
            </div>
            <form className="settings-form settings-form--grid" onSubmit={handleRetentionSubmit}>
              {Object.entries(retentionFields).map(([key, value]) => (
                <label className="settings-field" key={key}>
                  <span>{key}</span>
                  <input
                    onChange={(event) =>
                      setRetentionFields((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    type="number"
                    value={value}
                  />
                </label>
              ))}
              <button className="settings-button" disabled={state.saving} type="submit">
                Save retention rules
              </button>
            </form>
            <div className="settings-job-controls">
              <button
                className="settings-button"
                disabled={state.saving}
                onClick={() => void queueJob("organization_export")}
                type="button"
              >
                Queue full export
              </button>
              <label className="settings-field">
                <span>Deletion cutoff</span>
                <input
                  onChange={(event) => setCutoffDate(event.target.value)}
                  type="date"
                  value={cutoffDate}
                />
              </label>
              <button
                className="settings-button settings-button--ghost"
                disabled={state.saving || !latestExportJob || !cutoffDate}
                onClick={() => void queueJob("history_purge")}
                type="button"
              >
                Purge chat history
              </button>
              <button
                className="settings-button settings-button--ghost"
                disabled={state.saving || !latestExportJob || !cutoffDate}
                onClick={() => void queueJob("import_metadata_purge")}
                type="button"
              >
                Purge import metadata
              </button>
              <button
                className="settings-button settings-button--ghost"
                disabled={state.saving || !latestExportJob || !cutoffDate}
                onClick={() => void queueJob("knowledge_delete")}
                type="button"
              >
                Delete managed files
              </button>
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
                  {job.artifact.hasArtifact ? (
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
