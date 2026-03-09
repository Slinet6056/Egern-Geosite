import type { Handle } from "@sveltejs/kit";

import { getPanelLocale } from "$lib/panel/locale";

export const handle: Handle = async ({ event, resolve }) => {
  const lang = getPanelLocale(event.cookies);

  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace("%lang%", lang),
  });
};
