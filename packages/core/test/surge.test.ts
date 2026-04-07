import { describe, expect, test } from "vitest";

import { emitSurgeRuleset } from "../src/surge.js";
import { parseListsFromText } from "../src/parser.js";
import { resolveOneList } from "../src/resolver.js";
import type { DomainRule } from "../src/types.js";

describe("emitSurgeRuleset", () => {
  test("emits domain, suffix and keyword rules", () => {
    const parsed = parseListsFromText({
      demo: [
        "domain:example.com",
        "full:api.sample.net",
        "keyword:tracker",
      ].join("\n"),
    });

    const resolved = resolveOneList(parsed, "demo");
    const output = emitSurgeRuleset(resolved);

    expect(output.lines).toEqual([
      "DOMAIN-SUFFIX,example.com",
      "DOMAIN,api.sample.net",
      "DOMAIN-KEYWORD,tracker",
    ]);
  });

  test("skips all regex rules in skip mode", () => {
    const parsed = parseListsFromText({
      demo: [
        "domain:example.com",
        "regexp:(^|\\.)netflix\\.com$",
        "regexp:^cdn\\d-epicgames-\\d+\\.file\\.myqcloud\\.com$",
      ].join("\n"),
    });

    const resolved = resolveOneList(parsed, "demo");
    const output = emitSurgeRuleset(resolved, { regexMode: "skip" });

    expect(output.lines).toEqual(["DOMAIN-SUFFIX,example.com"]);
    expect(output.report.regex).toEqual({
      total: 2,
      converted: 0,
      skipped: 2,
    });
  });

  test("converts regex rules in standard mode", () => {
    const parsed = parseListsFromText({
      demo: [
        "domain:example.com",
        "regexp:(^|\\.)netflix\\.com$",
        "regexp:^cdn\\d-epicgames-\\d+\\.file\\.myqcloud\\.com$",
      ].join("\n"),
    });

    const resolved = resolveOneList(parsed, "demo");
    const output = emitSurgeRuleset(resolved, { regexMode: "standard" });

    expect(output.lines).toEqual([
      "DOMAIN-SUFFIX,example.com",
      "URL-REGEX,^https?://([^/]+\\.)?netflix\\.com/",
      "URL-REGEX,^https?://cdn\\d-epicgames-\\d+\\.file\\.myqcloud\\.com/",
    ]);
    expect(output.report.regex).toEqual({
      total: 2,
      converted: 2,
      skipped: 0,
    });
  });

  test("converts all regex rules in aggressive mode", () => {
    const parsed = parseListsFromText({
      demo: ["regexp:netflix\\.com"].join("\n"),
    });

    const resolved = resolveOneList(parsed, "demo");
    const output = emitSurgeRuleset(resolved, { regexMode: "aggressive" });

    expect(output.lines).toEqual([
      "URL-REGEX,^https?://[^/]*netflix\\.com[^/]*/",
    ]);
    expect(output.report.regex).toEqual({
      total: 1,
      converted: 1,
      skipped: 0,
    });
  });

  test("dedupes duplicate rules by default", () => {
    const output = emitSurgeRuleset({
      name: "DEMO",
      entries: [makeDomainRule(1), makeDomainRule(2)],
    });

    expect(output.lines).toEqual(["DOMAIN-SUFFIX,example.com"]);
  });

  test("keeps duplicates when dedupe is disabled", () => {
    const output = emitSurgeRuleset(
      {
        name: "DEMO",
        entries: [makeDomainRule(1), makeDomainRule(2)],
      },
      { dedupe: false },
    );

    expect(output.lines).toEqual([
      "DOMAIN-SUFFIX,example.com",
      "DOMAIN-SUFFIX,example.com",
    ]);
  });

  test("produces empty output for empty list", () => {
    const output = emitSurgeRuleset({ name: "EMPTY", entries: [] });
    expect(output.lines).toEqual([]);
    expect(output.text).toBe("");
  });
});

function makeDomainRule(line: number): DomainRule {
  return {
    type: "domain",
    value: "example.com",
    attrs: [],
    affiliations: [],
    plain: "domain:example.com",
    source: { list: "demo", line },
  };
}
