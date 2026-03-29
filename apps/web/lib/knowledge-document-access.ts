import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { documents } from "@/lib/app-schema";
import { KNOWLEDGE_MANAGED_SOURCE_TYPES } from "@/lib/knowledge-import-types";

export async function getManagedKnowledgeDocumentByPath(input: {
  organizationId: string;
  relativePath: string;
}) {
  const db = await getAppDatabase();

  return db.query.documents.findFirst({
    where: and(
      eq(documents.organizationId, input.organizationId),
      eq(documents.sourcePath, input.relativePath),
      inArray(documents.sourceType, [...KNOWLEDGE_MANAGED_SOURCE_TYPES]),
    ),
  });
}

export async function assertManagedKnowledgeDocumentReady(input: {
  organizationId: string;
  relativePath: string;
}) {
  const document = await getManagedKnowledgeDocumentByPath(input);

  if (!document) {
    return null;
  }

  if (document.ingestionStatus !== "ready") {
    throw new Error(
      `Knowledge file is not ready for use yet: ${input.relativePath} (status: ${document.ingestionStatus}).`,
    );
  }

  return document;
}
