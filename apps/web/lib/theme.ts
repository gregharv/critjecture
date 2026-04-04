export const THEME_COOKIE_NAME = "critjecture-theme";
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const THEME_PREFERENCES = ["dark", "light"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

export function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function normalizeThemePreference(value: string | undefined): ThemePreference {
  if (value && isThemePreference(value)) {
    return value;
  }

  return DEFAULT_THEME_PREFERENCE;
}
