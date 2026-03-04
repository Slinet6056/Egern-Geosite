import { redirect } from "@sveltejs/kit";
import type { ServerLoad } from "@sveltejs/kit";

function detectLang(acceptLanguage: string | null): "zh" | "en" {
  if (!acceptLanguage) {
    return "zh";
  }

  const lower = acceptLanguage.toLowerCase();
  if (lower.includes("zh")) {
    return "zh";
  }

  return "en";
}

export const load: ServerLoad = ({ request }) => {
  const lang = detectLang(request.headers.get("accept-language"));
  throw redirect(307, `/${lang}`);
};
