import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { dataAssets, dataAssetVersions, dataConnections, documents, workflowRunResolvedInputs } from "@/lib/legacy-app-schema";
import {
  ensureGoogleDriveConnection,
  syncGoogleDriveDataConnection,
  type GoogleDriveSyncClient,
} from "@/lib/connectors/google-drive-connector";
import { executeWorkflowRun } from "@/lib/workflow-engine";
import { createManualWorkflowRun } from "@/lib/workflow-runs";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createWorkflow } from "@/lib/workflows";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

function buildWorkflowVersionBase(ownerUserId: string) {
  return {
    delivery: {
      channels: [],
      retry_policy: {
        backoff_multiplier: 2,
        initial_backoff_seconds: 30,
        max_attempts: 3,
      },
      schema_version: 1,
    },
    executionIdentity: {
      mode: "fixed_membership_user",
      on_identity_invalid: "block_run",
      recheck_at_enqueue: true,
      recheck_at_execution: true,
      required_membership_roles: ["admin", "owner"],
      require_membership_status: "active",
      run_as_user_id: ownerUserId,
      schema_version: 1,
    },
    outputs: {
      schema_version: 1,
      summary_template: "standard_v1",
    },
    provenance: {
      schema_version: 1,
      source_kind: "manual_builder",
    },
    recipe: {
      schema_version: 1,
      steps: [],
    },
    schedule: {
      kind: "manual_only",
      schema_version: 1,
    },
    thresholds: {
      rules: [],
      schema_version: 1,
    },
  };
}

function buildExternalObjectSelectorWorkflowVersion(
  ownerUserId: string,
  connectionId: string,
  externalObjectId: string,
) {
  return {
    ...buildWorkflowVersionBase(ownerUserId),
    inputBindings: {
      bindings: [
        {
          binding: {
            kind: "asset_selector",
            max_assets: 1,
            selection: "latest_updated_at",
            selector: {
              connection_id: connectionId,
              external_object_id: externalObjectId,
            },
          },
          input_key: "drive_csv",
        },
      ],
      schema_version: 1,
    },
    inputContract: {
      inputs: [
        {
          allowed_mime_types: ["text/csv"],
          csv_rules: {
            min_row_count: 1,
            required_columns: ["ledger_year", "contractor", "payout"],
          },
          data_kind: "table",
          input_key: "drive_csv",
          label: "Drive CSV",
          multiplicity: "one",
          required: true,
        },
      ],
      schema_version: 1,
    },
  };
}

describe("google drive connector integration", () => {
  it("syncs a mocked Google Drive file into documents, assets, and versions without duplicates", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const state = {
        csv: "ledger_year,contractor,payout\n2026,Acme,1200\n",
        modifiedTime: "2026-04-01T12:00:00.000Z",
        version: "1",
      };
      const client: GoogleDriveSyncClient = {
        async downloadFile() {
          return {
            buffer: Buffer.from(state.csv, "utf8"),
            fileExtension: ".csv",
            materializedMimeType: "text/csv",
          };
        },
        async listSelectedFiles() {
          return [
            {
              fileId: "drive-file-1",
              md5Checksum: null,
              mimeType: "text/csv",
              modifiedTime: state.modifiedTime,
              name: "contractors-from-drive.csv",
              sourceUrl: "https://drive.google.com/file/d/drive-file-1/view",
              version: state.version,
            },
          ];
        },
      };

      const connection = await ensureGoogleDriveConnection({
        config: {
          auth_mode: "oauth",
          default_access_scope: "admin",
          selected_files: [
            {
              access_scope: "admin",
              file_id: "drive-file-1",
              source_url: "https://drive.google.com/file/d/drive-file-1/view",
            },
          ],
        },
        credentialsRef: "google-drive-oauth:testing",
        organizationId: owner!.organizationId,
      });

      const firstSync = await syncGoogleDriveDataConnection({
        client,
        connectionId: connection.id,
        organizationSlug: owner!.organizationSlug,
      });

      expect(firstSync.createdAssetCount).toBe(1);
      expect(firstSync.versionCreatedCount).toBe(1);
      expect(firstSync.unchangedFileCount).toBe(0);

      const db = await getAppDatabase();
      const asset = await db.query.dataAssets.findFirst({
        where: eq(dataAssets.externalObjectId, "drive-file-1"),
      });
      const document = await db.query.documents.findFirst({
        where: eq(documents.sourcePath, `admin/connectors/google-drive/${connection.id}/drive-file-1.csv`),
      });
      const firstVersionRows = asset
        ? await db.select().from(dataAssetVersions).where(eq(dataAssetVersions.assetId, asset.id))
        : [];
      const refreshedConnection = await db.query.dataConnections.findFirst({
        where: eq(dataConnections.id, connection.id),
      });

      expect(document).toEqual(
        expect.objectContaining({
          accessScope: "admin",
          displayName: "contractors-from-drive.csv",
          ingestionStatus: "ready",
          sourceType: "google_drive",
        }),
      );
      expect(asset).toEqual(
        expect.objectContaining({
          accessScope: "admin",
          assetKey: `admin/connectors/google-drive/${connection.id}/drive-file-1.csv`,
          connectionId: connection.id,
          dataKind: "table",
          displayName: "contractors-from-drive.csv",
          externalObjectId: "drive-file-1",
        }),
      );
      expect(firstVersionRows).toHaveLength(1);
      expect(firstVersionRows[0]).toEqual(
        expect.objectContaining({
          materializedPath: `admin/connectors/google-drive/${connection.id}/drive-file-1.csv`,
          rowCount: 1,
          schemaHash: expect.any(String),
          sourceVersionToken: "revision:1",
        }),
      );
      expect(refreshedConnection).toEqual(
        expect.objectContaining({
          credentialsRef: "google-drive-oauth:testing",
          kind: "google_drive",
          lastSyncAt: expect.any(Number),
          status: "active",
        }),
      );

      const secondSync = await syncGoogleDriveDataConnection({
        client,
        connectionId: connection.id,
        organizationSlug: owner!.organizationSlug,
      });

      expect(secondSync.versionCreatedCount).toBe(0);
      expect(secondSync.unchangedFileCount).toBe(1);

      const secondVersionRows = asset
        ? await db.select().from(dataAssetVersions).where(eq(dataAssetVersions.assetId, asset.id))
        : [];
      expect(secondVersionRows).toHaveLength(1);

      state.version = "2";
      state.modifiedTime = "2026-04-02T12:00:00.000Z";
      state.csv = "ledger_year,contractor,payout\n2026,Acme,1200\n2026,Beacon,900\n";

      const thirdSync = await syncGoogleDriveDataConnection({
        client,
        connectionId: connection.id,
        organizationSlug: owner!.organizationSlug,
      });

      expect(thirdSync.versionCreatedCount).toBe(1);

      const thirdVersionRows = asset
        ? await db.select().from(dataAssetVersions).where(eq(dataAssetVersions.assetId, asset.id))
        : [];
      expect(thirdVersionRows).toHaveLength(2);
      expect(thirdVersionRows.some((row) => row.sourceVersionToken === "revision:2")).toBe(true);
    } finally {
      await environment.cleanup();
    }
  });

  it("lets workflows bind a synced Drive asset by stable external_object_id", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const client: GoogleDriveSyncClient = {
        async downloadFile() {
          return {
            buffer: Buffer.from("ledger_year,contractor,payout\n2026,Acme,1200\n", "utf8"),
            fileExtension: ".csv",
            materializedMimeType: "text/csv",
          };
        },
        async listSelectedFiles() {
          return [
            {
              fileId: "drive-file-workflow",
              md5Checksum: null,
              mimeType: "text/csv",
              modifiedTime: "2026-04-03T12:00:00.000Z",
              name: "workflow-drive.csv",
              sourceUrl: "https://drive.google.com/file/d/drive-file-workflow/view",
              version: "1",
            },
          ];
        },
      };

      const connection = await ensureGoogleDriveConnection({
        config: {
          auth_mode: "oauth",
          default_access_scope: "admin",
          selected_files: [
            {
              access_scope: "admin",
              file_id: "drive-file-workflow",
            },
          ],
        },
        credentialsRef: "google-drive-oauth:testing",
        organizationId: owner!.organizationId,
      });

      await syncGoogleDriveDataConnection({
        client,
        connectionId: connection.id,
        organizationSlug: owner!.organizationSlug,
      });

      const workflow = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Drive External Object Workflow",
        organizationId: owner!.organizationId,
        status: "active",
        version: buildExternalObjectSelectorWorkflowVersion(
          owner!.id,
          connection.id,
          "drive-file-workflow",
        ),
      });

      const run = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: workflow!.workflow.id,
      });
      const execution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: run.id,
      });

      expect(execution.status).toBe("completed");

      const snapshotRows = await (await getAppDatabase()).query.workflowRunResolvedInputs.findMany({
        where: eq(workflowRunResolvedInputs.runId, run.id),
      });

      expect(snapshotRows).toHaveLength(1);
      expect(snapshotRows[0]?.materializedPath).toBe(
        `admin/connectors/google-drive/${connection.id}/drive-file-workflow.csv`,
      );
    } finally {
      await environment.cleanup();
    }
  });
});
