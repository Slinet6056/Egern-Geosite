import { describe, expect, test } from "vitest";

import { EgernEmitError } from "../src/errors.js";
import { parseListsFromText } from "../src/parser.js";
import { transpileRegexToEgern } from "../src/regex.js";
import { resolveOneList } from "../src/resolver.js";
import { emitEgernRuleset } from "../src/egern.js";

describe("transpileRegexToEgern", () => {
  test("converts exact and suffix regex losslessly", () => {
    expect(transpileRegexToEgern("^github\\.com$", "strict")).toEqual({
      status: "lossless",
      rules: [{ type: "DOMAIN", value: "github.com" }],
    });

    expect(transpileRegexToEgern("(^|\\.)netflix\\.com$", "strict")).toEqual({
      status: "lossless",
      rules: [{ type: "DOMAIN-SUFFIX", value: "netflix.com" }],
    });
  });

  test("widens complex regex in balanced mode", () => {
    expect(
      transpileRegexToEgern(
        "^cdn\\d-epicgames-\\d+\\.file\\.myqcloud\\.com$",
        "balanced",
      ),
    ).toEqual({
      status: "widened",
      rules: [
        {
          type: "DOMAIN-WILDCARD",
          value: "cdn*-epicgames-*.file.myqcloud.com",
        },
      ],
      reason: "Regex converted to heuristic DOMAIN-WILDCARD pattern.",
    });
  });

  test("forces conversion in full mode when balanced cannot convert", () => {
    expect(
      transpileRegexToEgern("^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$", "balanced"),
    ).toEqual({
      status: "unsupported",
      rules: [],
      reason: "Unable to convert regexp into a valid Egern domain pattern.",
    });

    expect(
      transpileRegexToEgern("^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$", "full"),
    ).toEqual({
      status: "widened",
      rules: [{ type: "DOMAIN-WILDCARD", value: "*" }],
      reason: "Regex downgraded to match-all wildcard in full mode.",
    });
  });
});

describe("emitEgernRuleset", () => {
  test("emits Egern ruleset yaml and tracks regex report", () => {
    const parsed = parseListsFromText({
      demo: [
        "domain:example.com",
        "full:api.example.com",
        "keyword:tracker",
        "regexp:(^|\\.)netflix\\.com$",
        "regexp:^cdn\\d-epicgames-\\d+\\.file\\.myqcloud\\.com$",
      ].join("\n"),
    });

    const resolved = resolveOneList(parsed, "demo");
    const output = emitEgernRuleset(resolved, { regexMode: "balanced" });

    expect(output.lines).toEqual([
      "domain_suffix_set:",
      '  - "example.com"',
      '  - "netflix.com"',
      "domain_keyword_set:",
      '  - "tracker"',
      "domain_wildcard_set:",
      '  - "cdn*-epicgames-*.file.myqcloud.com"',
    ]);

    expect(output.report.regex).toEqual({
      total: 2,
      lossless: 1,
      widened: 1,
      unsupported: 0,
    });
  });

  test("throws when unsupported regex is configured as error", () => {
    const parsed = parseListsFromText({
      demo: "regexp:^a(?=b)\\.example\\.com$",
    });

    const resolved = resolveOneList(parsed, "demo");
    expect(() =>
      emitEgernRuleset(resolved, {
        regexMode: "balanced",
        onUnsupportedRegex: "error",
      }),
    ).toThrow(EgernEmitError);
  });
});
