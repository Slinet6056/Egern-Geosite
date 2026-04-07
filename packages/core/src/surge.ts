import type {
  DomainRule,
  EmitSurgeOptions,
  EmitSurgeResult,
  ResolvedList,
  SurgeEmitReport,
  SurgeRegexMode,
  SurgeRule,
  SurgeRuleType,
} from "./types.js";
import { convertDomainRegexToUrlRegex } from "./surge-regex.js";

export function emitSurgeRuleset(
  list: ResolvedList,
  options: EmitSurgeOptions = {},
): EmitSurgeResult {
  const dedupe = options.dedupe ?? true;
  const regexMode: SurgeRegexMode = options.regexMode ?? "standard";

  const rules: SurgeRule[] = [];
  const report: SurgeEmitReport = {
    regex: { total: 0, converted: 0, skipped: 0 },
  };

  for (const entry of list.entries) {
    if (entry.type === "regexp") {
      report.regex.total += 1;
      const converted = convertDomainRegexToUrlRegex(entry.value, regexMode);
      if (converted !== null) {
        report.regex.converted += 1;
        rules.push({
          type: "URL-REGEX",
          value: converted,
          source: entry.source,
        });
      } else {
        report.regex.skipped += 1;
      }
      continue;
    }

    rules.push({
      type: mapRuleType(entry),
      value: entry.value,
      source: entry.source,
    });
  }

  const normalizedRules = dedupe ? dedupeRules(rules) : rules;
  const lines = serializeSurgeRuleset(normalizedRules);

  return {
    lines,
    text: lines.join("\n"),
    rules: normalizedRules,
    report,
  };
}

function serializeSurgeRuleset(rules: SurgeRule[]): string[] {
  return rules.map((rule) => `${rule.type},${rule.value}`);
}

function mapRuleType(rule: DomainRule): SurgeRuleType {
  switch (rule.type) {
    case "domain":
      return "DOMAIN-SUFFIX";
    case "full":
      return "DOMAIN";
    case "keyword":
      return "DOMAIN-KEYWORD";
    default:
      return "DOMAIN-KEYWORD";
  }
}

function dedupeRules(rules: SurgeRule[]): SurgeRule[] {
  const seen = new Set<string>();
  const output: SurgeRule[] = [];

  for (const rule of rules) {
    const key = `${rule.type},${rule.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(rule);
  }

  return output;
}
