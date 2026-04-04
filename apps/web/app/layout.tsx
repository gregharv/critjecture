import type { Metadata } from "next";
import { cookies } from "next/headers";

import "@mariozechner/mini-lit/styles/themes/claude.css";
import "./pi-web-ui.generated.css";
import "./pi-web-ui.css";
import "./globals.css";
import { THEME_COOKIE_NAME, normalizeThemePreference } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Critjecture",
  description: "Critjecture knowledge workspace for RBAC-aware operational search.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themePreference = normalizeThemePreference(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return (
    <html lang="en" className={themePreference} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
