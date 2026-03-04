import type { ParamMatcher } from "@sveltejs/kit";

export const match = ((param: string) =>
  param === "zh" || param === "en") satisfies ParamMatcher;
