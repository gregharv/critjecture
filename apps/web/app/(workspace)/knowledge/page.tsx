import { KnowledgePageClient } from "@/components/knowledge-page-client";
import { requirePageUser } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const user = await requirePageUser();

  return <KnowledgePageClient access={user.access} role={user.role} />;
}
