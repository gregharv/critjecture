"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";
import { getLoginFailureReason } from "@/lib/users";

export type LoginActionState = {
  error: string | null;
};

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  const password =
    typeof formData.get("password") === "string" ? String(formData.get("password")) : "";

  const failureReason = await getLoginFailureReason(email, password);

  if (failureReason === "suspended") {
    return { error: "This account or membership is suspended." };
  }

  if (failureReason === "invalid") {
    return { error: "Invalid email or password." };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/chat",
    });

    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return { error: "Invalid email or password." };
      }

      return { error: "Unable to sign in right now." };
    }

    throw error;
  }
}

export async function logoutAction() {
  await signOut({
    redirectTo: "/login",
  });
}
