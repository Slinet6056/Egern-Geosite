export type DomainRuleType = "domain" | "full" | "keyword" | "regexp";
export type EntryType = DomainRuleType | "include";

export interface SourceLocation {
  list: string;
  line: number;
}

export interface DomainRule {
  type: DomainRuleType;
  value: string;
  attrs: string[];
  affiliations: string[];
  plain: string;
  source: SourceLocation;
}

export interface IncludeRule {
  type: "include";
  sourceList: string;
  attrs: string[];
  mustAttrs: string[];
  banAttrs: string[];
  source: SourceLocation;
}

export type SourceEntry = DomainRule | IncludeRule;

export interface ResolvedList {
  name: string;
  entries: DomainRule[];
}

export type EgernRuleType =
  | "DOMAIN-SUFFIX"
  | "DOMAIN"
  | "DOMAIN-KEYWORD"
  | "DOMAIN-REGEX"
  | "DOMAIN-WILDCARD";

export interface EgernRule {
  type: EgernRuleType;
  value: string;
  source: SourceLocation;
}

export interface EmitReport {
  regex: {
    total: number;
    emitted: number;
  };
}

export interface EmitEgernOptions {
  dedupe?: boolean;
}

export interface EmitEgernResult {
  lines: string[];
  text: string;
  rules: EgernRule[];
  report: EmitReport;
}

export interface SourceCounts {
  domain: number;
  full: number;
  keyword: number;
  regexp: number;
  include: number;
  affiliations: number;
  attributes: number;
}

export interface ResolvedCounts {
  rules: number;
  domain: number;
  full: number;
  keyword: number;
  regexp: number;
}

export interface OutputStats {
  rules: number;
  bytes: number;
  regex: EmitReport["regex"];
}

export interface ListStats {
  name: string;
  source: SourceCounts;
  resolved: ResolvedCounts;
  filters: {
    attrs: Record<string, number>;
  };
  output: OutputStats;
}

export interface GlobalStats {
  lists: number;
  source: SourceCounts;
  resolved: ResolvedCounts;
  output: OutputStats;
}

// Surge types

export type SurgeRuleType =
  | "DOMAIN"
  | "DOMAIN-SUFFIX"
  | "DOMAIN-KEYWORD"
  | "URL-REGEX";

export type SurgeRegexMode = "skip" | "standard" | "aggressive";

export interface SurgeRule {
  type: SurgeRuleType;
  value: string;
  source: SourceLocation;
}

export interface SurgeEmitReport {
  regex: {
    total: number;
    converted: number;
    skipped: number;
  };
}

export interface EmitSurgeOptions {
  dedupe?: boolean;
  regexMode?: SurgeRegexMode;
}

export interface EmitSurgeResult {
  lines: string[];
  text: string;
  rules: SurgeRule[];
  report: SurgeEmitReport;
}
