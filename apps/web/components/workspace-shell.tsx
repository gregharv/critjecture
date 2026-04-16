import type { ReactNode } from "react";

import { cookies } from "next/headers";

import { DetailsOutsideDismiss } from "@/components/details-outside-dismiss";
import { WorkspaceNav } from "@/components/workspace-nav";
import type { SessionUser } from "@/lib/auth-state";
import { THEME_COOKIE_NAME, normalizeThemePreference } from "@/lib/theme";

type WorkspaceShellProps = {
  children: ReactNode;
  user: SessionUser;
};

export async function WorkspaceShell({
  children,
  user,
}: WorkspaceShellProps) {
  const cookieStore = await cookies();
  const themePreference = normalizeThemePreference(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return (
    <main className="shell-page">
      <DetailsOutsideDismiss />
      <section className="shell-frame">
        <WorkspaceNav user={user} themePreference={themePreference} />
        <div className="shell-body">{children}</div>
      </section>
    </main>
  );
}
