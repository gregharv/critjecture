import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getSessionUser } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();

  if (user) {
    redirect("/causal");
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-copy">
          <p className="auth-eyebrow">Critjecture</p>
          <h1>Sign in to the workspace</h1>
          <p>
            Chat, audits, and generated files now require an authenticated session. Use
            one of the bootstrap accounts configured in `apps/web/.env.local`.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
