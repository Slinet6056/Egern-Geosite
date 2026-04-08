import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  convertDomainRegexToUrlRegex,
  parseListsFromText,
  resolveAllLists,
  type DomainRule,
  type SurgeRegexMode,
} from "@egern-geosite/core";

import { loadListsFromDirectory } from "./fs-loader.js";

export type RegexFailureReason =
  | "lookaround"
  | "backreference"
  | "path-character"
  | "top-level-alternation"
  | "unsafe-domain-pattern"
  | "unsupported-shape";

export interface RegexPatternOccurrence {
  list: string;
  line: number;
}

export interface RegexPatternReport {
  aggressiveResult: string;
  occurrences: RegexPatternOccurrence[];
  pattern: string;
  reason: RegexFailureReason;
}

export interface RegexReasonSummary {
  entries: number;
  patterns: number;
}

export interface RegexAnalysisReport {
  generatedAt: string;
  source: {
    dataDir: string;
    mode: "existing" | "cloned";
  };
  summary: {
    lists: number;
    regexpEntries: number;
    standardConverted: number;
    standardSkipped: number;
    uniqueUnsupportedPatterns: number;
  };
  reasons: Record<RegexFailureReason, RegexReasonSummary>;
  unsupportedPatterns: RegexPatternReport[];
}

export interface AnalyzeSurgeRegexOptions {
  dataDir: string;
  listNames?: string[];
  sourceMode: "existing" | "cloned";
}

interface UnsupportedPatternAccumulator {
  aggressiveResult: string;
  occurrences: RegexPatternOccurrence[];
  pattern: string;
  reason: RegexFailureReason;
}

const FAILURE_REASON_ORDER: RegexFailureReason[] = [
  "unsupported-shape",
  "unsafe-domain-pattern",
  "top-level-alternation",
  "lookaround",
  "path-character",
  "backreference",
];

export async function analyzeSurgeRegexCoverage(
  options: AnalyzeSurgeRegexOptions,
): Promise<RegexAnalysisReport> {
  const sourceRecord = await loadListsFromDirectory(options.dataDir);
  const parsed = parseListsFromText(sourceRecord);
  const resolved = resolveAllLists(parsed);
  const requestedListNames = resolveRequestedListNames(
    resolved,
    options.listNames,
  );

  const unsupportedPatterns = new Map<string, UnsupportedPatternAccumulator>();
  const reasons = createReasonSummaryRecord();
  let regexpEntries = 0;
  let standardConverted = 0;

  for (const listName of requestedListNames) {
    const resolvedList = resolved[listName]!;

    for (const entry of resolvedList.entries) {
      if (entry.type !== "regexp") {
        continue;
      }

      regexpEntries += 1;
      const standardResult = convertDomainRegexToUrlRegex(
        entry.value,
        "standard",
      );
      if (standardResult !== null) {
        standardConverted += 1;
        continue;
      }

      const reason = classifyStandardFailure(entry.value);
      const aggressiveResult = convertDomainRegexToUrlRegex(
        entry.value,
        "aggressive",
      );
      if (aggressiveResult === null) {
        throw new Error(
          `aggressive regex conversion unexpectedly failed: ${entry.value}`,
        );
      }

      const key = `${reason}\u0000${entry.value}`;
      const existing = unsupportedPatterns.get(key);
      const occurrence = {
        line: entry.source.line,
        list: entry.source.list,
      };

      if (existing) {
        existing.occurrences.push(occurrence);
      } else {
        unsupportedPatterns.set(key, {
          aggressiveResult,
          occurrences: [occurrence],
          pattern: entry.value,
          reason,
        });
      }

      reasons[reason].entries += 1;
    }
  }

  for (const pattern of unsupportedPatterns.values()) {
    reasons[pattern.reason].patterns += 1;
  }

  const unsupportedPatternList = Array.from(unsupportedPatterns.values())
    .map((pattern) => ({
      aggressiveResult: pattern.aggressiveResult,
      occurrences: pattern.occurrences.sort(compareOccurrence),
      pattern: pattern.pattern,
      reason: pattern.reason,
    }))
    .sort(compareUnsupportedPattern);

  return {
    generatedAt: new Date().toISOString(),
    reasons,
    source: {
      dataDir: options.dataDir,
      mode: options.sourceMode,
    },
    summary: {
      lists: requestedListNames.length,
      regexpEntries,
      standardConverted,
      standardSkipped: regexpEntries - standardConverted,
      uniqueUnsupportedPatterns: unsupportedPatternList.length,
    },
    unsupportedPatterns: unsupportedPatternList,
  };
}

export async function writeRegexAnalysisReport(
  outputPath: string,
  report: RegexAnalysisReport,
): Promise<void> {
  const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await writeFile(
    resolvedOutputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

export function printRegexAnalysisSummary(report: RegexAnalysisReport): void {
  console.log(
    [
      `source=${report.source.mode}`,
      `data_dir=${report.source.dataDir}`,
      `lists=${report.summary.lists}`,
      `regexp_total=${report.summary.regexpEntries}`,
      `standard_converted=${report.summary.standardConverted}`,
      `standard_skipped=${report.summary.standardSkipped}`,
      `unique_unsupported=${report.summary.uniqueUnsupportedPatterns}`,
    ].join(" "),
  );

  console.log("unsupported reasons:");
  for (const reason of FAILURE_REASON_ORDER) {
    const summary = report.reasons[reason];
    if (summary.entries === 0) {
      continue;
    }

    console.log(
      `  - ${reason}: entries=${summary.entries} patterns=${summary.patterns}`,
    );
  }

  if (report.unsupportedPatterns.length === 0) {
    console.log("no unsupported regex patterns found in standard mode");
    return;
  }

  console.log("top unsupported patterns:");
  for (const pattern of report.unsupportedPatterns.slice(0, 20)) {
    const locations = pattern.occurrences
      .slice(0, 3)
      .map((occurrence) => `${occurrence.list}:${occurrence.line}`)
      .join(", ");
    console.log(
      `  - reason=${pattern.reason} count=${pattern.occurrences.length} pattern=${JSON.stringify(pattern.pattern)} aggressive=${JSON.stringify(pattern.aggressiveResult)} locations=${locations}`,
    );
  }
}

function compareOccurrence(
  left: RegexPatternOccurrence,
  right: RegexPatternOccurrence,
): number {
  return left.list.localeCompare(right.list) || left.line - right.line;
}

function compareUnsupportedPattern(
  left: UnsupportedPatternAccumulator,
  right: UnsupportedPatternAccumulator,
): number {
  const byCount = right.occurrences.length - left.occurrences.length;
  if (byCount !== 0) {
    return byCount;
  }

  const byReason =
    FAILURE_REASON_ORDER.indexOf(left.reason) -
    FAILURE_REASON_ORDER.indexOf(right.reason);
  if (byReason !== 0) {
    return byReason;
  }

  return left.pattern.localeCompare(right.pattern);
}

function createReasonSummaryRecord(): Record<
  RegexFailureReason,
  RegexReasonSummary
> {
  return {
    backreference: { entries: 0, patterns: 0 },
    lookaround: { entries: 0, patterns: 0 },
    "path-character": { entries: 0, patterns: 0 },
    "top-level-alternation": { entries: 0, patterns: 0 },
    "unsafe-domain-pattern": { entries: 0, patterns: 0 },
    "unsupported-shape": { entries: 0, patterns: 0 },
  };
}

function classifyStandardFailure(pattern: string): RegexFailureReason {
  if (/\(\?[=!<]/.test(pattern)) {
    return "lookaround";
  }

  if (/\\[1-9]/.test(pattern)) {
    return "backreference";
  }

  if (pattern.includes("/")) {
    return "path-character";
  }

  let inner = pattern;
  const hasStart = inner.startsWith("^");
  const hasEnd = inner.endsWith("$");
  if (hasStart) {
    inner = inner.slice(1);
  }
  if (hasEnd) {
    inner = inner.slice(0, -1);
  }

  if (inner.startsWith("(^|\\.)")) {
    return isDomainSafeForStandard(inner.slice("(^|\\.)".length))
      ? "unsupported-shape"
      : classifyUnsafeDomainPattern(inner.slice("(^|\\.)".length));
  }

  if (hasStart && hasEnd) {
    return isDomainSafeForStandard(inner)
      ? "unsupported-shape"
      : classifyUnsafeDomainPattern(inner);
  }

  if (!hasStart && hasEnd) {
    return isDomainSafeForStandard(inner)
      ? "unsupported-shape"
      : classifyUnsafeDomainPattern(inner);
  }

  if (hasStart && !hasEnd) {
    return isDomainSafeForStandard(inner)
      ? "unsupported-shape"
      : classifyUnsafeDomainPattern(inner);
  }

  if (hasTopLevelAlternation(inner)) {
    return "top-level-alternation";
  }

  return "unsupported-shape";
}

function classifyUnsafeDomainPattern(
  domainPattern: string,
): RegexFailureReason {
  if (hasTopLevelAlternation(domainPattern)) {
    return "top-level-alternation";
  }

  return "unsafe-domain-pattern";
}

function hasTopLevelAlternation(pattern: string): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;

    if (ch === "\\") {
      i += 1;
      continue;
    }

    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }

    if (ch === "]") {
      bracketDepth -= 1;
      continue;
    }

    if (bracketDepth > 0) {
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      continue;
    }

    if (ch === ")") {
      parenDepth -= 1;
      continue;
    }

    if (ch === "|" && parenDepth === 0) {
      return true;
    }
  }

  return false;
}

function isDomainSafeForStandard(domainPattern: string): boolean {
  if (
    domainPattern.includes("/") ||
    domainPattern.includes("(?") ||
    domainPattern.includes("\\b")
  ) {
    return false;
  }

  let index = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (index < domainPattern.length) {
    const ch = domainPattern[index]!;

    if (ch === "\\") {
      const next = domainPattern[index + 1];
      if (next === undefined) {
        return false;
      }
      index += 2;
      continue;
    }

    if (ch === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }

    if (ch === "]") {
      bracketDepth -= 1;
      if (bracketDepth < 0) {
        return false;
      }
      index += 1;
      continue;
    }

    if (bracketDepth > 0) {
      index += 1;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth < 0) {
        return false;
      }
      index += 1;
      continue;
    }

    if (ch === "|" && parenDepth === 0) {
      return false;
    }

    if (ch === "{") {
      const close = domainPattern.indexOf("}", index);
      if (close === -1) {
        return false;
      }
      index = close + 1;
      continue;
    }

    if (ch === "^" || ch === "$") {
      return false;
    }

    index += 1;
  }

  return parenDepth === 0 && bracketDepth === 0;
}

function resolveRequestedListNames(
  resolved: Record<string, { entries: DomainRule[] }>,
  listNames: string[] | undefined,
): string[] {
  if (!listNames || listNames.length === 0) {
    return Object.keys(resolved).sort();
  }

  const normalizedListNames = listNames.map((name) => name.toUpperCase());
  for (const listName of normalizedListNames) {
    if (!resolved[listName]) {
      throw new Error(`list not found: ${listName}`);
    }
  }

  return normalizedListNames;
}

export function splitListArg(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function isSurgeRegexMode(value: string): value is SurgeRegexMode {
  return value === "skip" || value === "standard" || value === "aggressive";
}
