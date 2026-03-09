import type { Cookies } from "@sveltejs/kit";

import type { PanelLocale } from "./types";

export const LOCALE_COOKIE_NAME = "egern-panel-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function normalizePanelLocale(
  value: string | null | undefined,
): PanelLocale {
  return value === "en" ? "en" : "zh";
}

export function getPanelLocale(cookies: Pick<Cookies, "get">): PanelLocale {
  return normalizePanelLocale(cookies.get(LOCALE_COOKIE_NAME));
}
