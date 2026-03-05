import type { RuleMatchCounts } from "$lib/panel/types";

export function countRuleLines(text: string): number {
  const lines = text.split(/\r?\n/);
  const yamlItems = lines.filter((line) =>
    line.trimStart().startsWith("- "),
  ).length;
  if (yamlItems > 0) {
    return yamlItems;
  }

  return lines.filter((line) => line.length > 0).length;
}

export function normalizeEtag(value: string | null): string {
  if (!value) {
    return "-";
  }

  const compact = value.replace(/^W\//, "").replaceAll('"', "");
  return compact.slice(0, 7) || "-";
}

export function countRuleMatchTypes(text: string): RuleMatchCounts {
  const counts: RuleMatchCounts = {
    exact: 0,
    keyword: 0,
    suffix: 0,
    regexp: 0,
    wildcard: 0,
  };
  const fieldToType: Record<string, keyof RuleMatchCounts> = {
    domain_set: "exact",
    domain_keyword_set: "keyword",
    domain_suffix_set: "suffix",
    domain_regex_set: "regexp",
    domain_wildcard_set: "wildcard",
  };

  let currentType: keyof RuleMatchCounts | null = null;
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.endsWith(":")) {
      currentType = fieldToType[trimmed.slice(0, -1)] ?? null;
      continue;
    }

    if (currentType && trimmed.startsWith("- ")) {
      counts[currentType] += 1;
      continue;
    }

    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      currentType = null;
    }
  }

  return counts;
}
