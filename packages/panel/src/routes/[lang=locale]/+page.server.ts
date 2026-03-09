import { redirect } from "@sveltejs/kit";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  normalizePanelLocale,
} from "$lib/panel/locale";

import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ cookies, params, url }) => {
  cookies.set(LOCALE_COOKIE_NAME, normalizePanelLocale(params.lang), {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });

  throw redirect(308, `/${url.search}`);
};
