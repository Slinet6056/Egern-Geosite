export type PanelLocale = "zh" | "en";

export interface GeositeIndexItem {
  name?: string;
  sourceFile?: string;
  filters?: string[];
  path?: string;
}

export type GeositeIndex = Record<string, GeositeIndexItem>;

export interface GeoipIndexItem {
  name?: string;
  sourceFile?: string;
  ipv4Count?: number;
  ipv6Count?: number;
  defaultPath?: string;
  noResolvePath?: string;
}

export type GeoipIndex = Record<string, GeoipIndexItem>;

export interface RuleMatchCounts {
  exact: number;
  keyword: number;
  suffix: number;
  regexp: number;
  wildcard: number;
}

export interface RulesMeta {
  etag: string;
  stale: boolean;
  ruleLines: number;
}
