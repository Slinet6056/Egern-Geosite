const GEOSITE_API_BASE = "/geosite";
const GEOSITE_PUBLIC_BASE = "/geosite";
const GEOIP_API_BASE = "/geoip";
const GEOIP_PUBLIC_BASE = "/geoip";

function normalizeNameWithFilter(name: string, filter: string | null): string {
  return filter ? `${name}@${filter}` : name;
}

function buildPath(base: string, name: string, filter: string | null): string {
  const withFilter = normalizeNameWithFilter(name, filter);
  return `${base}/${encodeURIComponent(withFilter)}`;
}

function appendNoResolve(path: string, noResolve: boolean): string {
  return noResolve ? `${path}?no_resolve=true` : path;
}

export function buildRulesApiPath(name: string, filter: string | null): string {
  return buildPath(GEOSITE_API_BASE, name, filter);
}

export function buildRulesPublicPath(
  name: string,
  filter: string | null,
): string {
  return `${buildPath(GEOSITE_PUBLIC_BASE, name, filter)}.yaml`;
}

export function buildGeoipApiPath(name: string, noResolve: boolean): string {
  const base = `${GEOIP_API_BASE}/${encodeURIComponent(name)}`;
  return appendNoResolve(base, noResolve);
}

export function buildGeoipPublicPath(name: string, noResolve: boolean): string {
  const base = `${GEOIP_PUBLIC_BASE}/${encodeURIComponent(name)}.yaml`;
  return appendNoResolve(base, noResolve);
}
