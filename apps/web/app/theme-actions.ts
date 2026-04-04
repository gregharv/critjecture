"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  THEME_COOKIE_MAX_AGE_SECONDS,
  THEME_COOKIE_NAME,
  isThemePreference,
} from "@/lib/theme";

function normalizeReturnTo(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "/chat";
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/chat";
  }

  return trimmed;
}

export async function setThemePreferenceAction(formData: FormData) {
  const theme = formData.get("theme");
  const returnTo = normalizeReturnTo(formData.get("returnTo"));

  if (typeof theme !== "string" || !isThemePreference(theme)) {
    redirect(returnTo);
  }

  const cookieStore = await cookies();

  cookieStore.set({
    name: THEME_COOKIE_NAME,
    value: theme,
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  });

  redirect(returnTo);
}
