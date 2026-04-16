import { requirePageUser } from "@/lib/auth-state";
import { WorkspaceShell } from "@/components/workspace-shell";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePageUser();

  return <WorkspaceShell user={user}>{children}</WorkspaceShell>;
}
