import { EgernEmitError } from "./errors.js";
import { transpileRegexToEgern } from "./regex.js";
import type {
  DomainRule,
  EmitReport,
  EmitEgernOptions,
  EmitEgernResult,
  RegexIssue,
  RegexMode,
  ResolvedList,
  EgernRule,
  EgernRuleType,
} from "./types.js";

const DEFAULT_REGEX_MODE: RegexMode = "balanced";
const EGERN_RULESET_ORDER = [
  "domain_set",
  "domain_suffix_set",
  "domain_keyword_set",
  "domain_wildcard_set",
] as const;

type EgernRulesetField = (typeof EGERN_RULESET_ORDER)[number];
type EgernRulesetRecord = Record<EgernRulesetField, string[]>;

export function emitEgernRuleset(
  list: ResolvedList,
  options: EmitEgernOptions = {},
): EmitEgernResult {
  const regexMode = options.regexMode ?? DEFAULT_REGEX_MODE;
  const onUnsupportedRegex = options.onUnsupportedRegex ?? "skip";
  const dedupe = options.dedupe ?? true;

  const rules: EgernRule[] = [];
  const report = initReport();

  for (const entry of list.entries) {
    if (entry.type === "regexp") {
      report.regex.total += 1;
      handleRegexRule(
        entry,
        list.name,
        regexMode,
        onUnsupportedRegex,
        report,
        rules,
      );
      continue;
    }

    rules.push({
      type: mapRuleType(entry),
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
      return "DOMAIN-WILDCARD";
    default:
      return "DOMAIN-WILDCARD";
  }
}

function handleRegexRule(
  entry: DomainRule,
  listName: string,
  regexMode: RegexMode,
  onUnsupportedRegex: "skip" | "error",
  report: EmitReport,
  rules: EgernRule[],
): void {
  const result = transpileRegexToEgern(entry.value, regexMode);

  if (result.status === "unsupported") {
    report.regex.unsupported += 1;
    const issue = makeIssue(
      entry,
      regexMode,
      result.reason ?? "Unsupported regex pattern.",
    );
    report.unsupported.push(issue);

    if (onUnsupportedRegex === "error") {
      throw new EgernEmitError(
        `unsupported regex in ${listName} at line ${entry.source.line}: ${entry.value} (${issue.reason})`,
      );
    }

    return;
  }

  if (result.status === "widened") {
    report.regex.widened += 1;
    report.widened.push(
      makeIssue(
        entry,
        regexMode,
        result.reason ?? "Regex widened during conversion.",
      ),
    );
  } else {
    report.regex.lossless += 1;
  }

  for (const generated of result.rules) {
    rules.push({
      type: generated.type,
      value: generated.value,
      source: entry.source,
    });
  }
}

function makeIssue(
  entry: DomainRule,
  mode: RegexMode,
  reason: string,
): RegexIssue {
  return {
    pattern: entry.value,
    source: entry.source,
    reason,
    mode,
  };
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
      lossless: 0,
      widened: 0,
      unsupported: 0,
    },
    widened: [],
    unsupported: [],
  };
}
