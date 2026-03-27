import type { Metadata } from "next";

import "@mariozechner/mini-lit/styles/themes/claude.css";
import "./pi-web-ui.generated.css";
import "./pi-web-ui.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Critjecture",
  description: "Critjecture knowledge workspace for RBAC-aware operational search.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
