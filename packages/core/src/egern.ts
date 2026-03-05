import type {
  DomainRule,
  EmitReport,
  EmitEgernOptions,
  EmitEgernResult,
  ResolvedList,
  EgernRule,
  EgernRuleType,
} from "./types.js";

const EGERN_RULESET_ORDER = [
  "domain_set",
  "domain_suffix_set",
  "domain_keyword_set",
  "domain_regex_set",
  "domain_wildcard_set",
] as const;

type EgernRulesetField = (typeof EGERN_RULESET_ORDER)[number];
type EgernRulesetRecord = Record<EgernRulesetField, string[]>;

export function emitEgernRuleset(
  list: ResolvedList,
  options: EmitEgernOptions = {},
): EmitEgernResult {
  const dedupe = options.dedupe ?? true;

  const rules: EgernRule[] = [];
  const report = initReport();

  for (const entry of list.entries) {
    const mapped = mapRuleType(entry);
    if (mapped === "DOMAIN-REGEX") {
      report.regex.total += 1;
      report.regex.emitted += 1;
    }

    rules.push({
      type: mapped,
      value: entry.value,
      source: entry.source,
    });
  }

  const normalizedRules = dedupe ? dedupeRules(rules) : rules;
  const lines = serializeEgernRuleset(normalizedRules);

  return {
    lines,
    text: lines.join("\n"),
    rules: normalizedRules,
    report,
  };
}

function serializeEgernRuleset(rules: EgernRule[]): string[] {
  const sets: EgernRulesetRecord = {
    domain_set: [],
    domain_suffix_set: [],
    domain_keyword_set: [],
    domain_regex_set: [],
    domain_wildcard_set: [],
  };

  for (const rule of rules) {
    sets[mapEgernRulesetField(rule.type)].push(rule.value);
  }

  const lines: string[] = [];
  for (const field of EGERN_RULESET_ORDER) {
    const matches = sets[field];
    if (matches.length === 0) {
      continue;
    }

    lines.push(`${field}:`);
    for (const match of matches) {
      lines.push(`  - ${JSON.stringify(match)}`);
    }
  }

  return lines;
}

function mapEgernRulesetField(ruleType: EgernRuleType): EgernRulesetField {
  switch (ruleType) {
    case "DOMAIN":
      return "domain_set";
    case "DOMAIN-SUFFIX":
      return "domain_suffix_set";
    case "DOMAIN-KEYWORD":
      return "domain_keyword_set";
    case "DOMAIN-REGEX":
      return "domain_regex_set";
    case "DOMAIN-WILDCARD":
      return "domain_wildcard_set";
    default:
      return "domain_wildcard_set";
  }
}

function mapRuleType(rule: DomainRule): EgernRuleType {
  switch (rule.type) {
    case "domain":
      return "DOMAIN-SUFFIX";
    case "full":
      return "DOMAIN";
    case "keyword":
      return "DOMAIN-KEYWORD";
    case "regexp":
      return "DOMAIN-REGEX";
    default:
      return "DOMAIN-WILDCARD";
  }
}

function dedupeRules(rules: EgernRule[]): EgernRule[] {
  const seen = new Set<string>();
  const output: EgernRule[] = [];

  for (const rule of rules) {
    const key = `${rule.type},${rule.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(rule);
  }

  return output;
}

function initReport(): EmitReport {
  return {
    regex: {
      total: 0,
      emitted: 0,
    },
  };
}
