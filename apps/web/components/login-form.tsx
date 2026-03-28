"use client";

import { useActionState } from "react";

import { loginAction, type LoginActionState } from "@/app/auth-actions";

const INITIAL_STATE: LoginActionState = {
  error: null,
};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);

  return (
    <form action={formAction} className="auth-form">
      <label className="auth-field">
        <span>Email</span>
        <input
          autoComplete="username"
          className="auth-input"
          name="email"
          required
          type="email"
        />
      </label>

      <label className="auth-field">
        <span>Password</span>
        <input
          autoComplete="current-password"
          className="auth-input"
          name="password"
          required
          type="password"
        />
      </label>

      {state.error ? <p className="auth-error">{state.error}</p> : null}

      <button className="auth-submit" disabled={pending} type="submit">
        {pending ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}
