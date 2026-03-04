import type { PanelMode } from "./types";

const GEOSITE_API_BASE = "/geosite";
const GEOSITE_PUBLIC_BASE = "/geosite";

function normalizeNameWithFilter(name: string, filter: string | null): string {
  return filter ? `${name}@${filter}` : name;
}

function buildPath(
  base: string,
  mode: PanelMode,
  name: string,
  filter: string | null,
): string {
  const withFilter = normalizeNameWithFilter(name, filter);
  return `${base}/${mode}/${encodeURIComponent(withFilter)}`;
}

export function buildRulesApiPath(
  mode: PanelMode,
  name: string,
  filter: string | null,
): string {
  return buildPath(GEOSITE_API_BASE, mode, name, filter);
}

export function buildRulesPublicPath(
  mode: PanelMode,
  name: string,
  filter: string | null,
): string {
  return `${buildPath(GEOSITE_PUBLIC_BASE, mode, name, filter)}.yaml`;
}
