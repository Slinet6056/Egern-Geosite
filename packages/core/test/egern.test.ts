import { describe, expect, test } from "vitest";

import { emitEgernRuleset } from "../src/egern.js";
import { parseListsFromText } from "../src/parser.js";
import { resolveOneList } from "../src/resolver.js";
import type { DomainRule } from "../src/types.js";

describe("emitEgernRuleset", () => {
  test("emits domain, suffix, keyword and regex sets losslessly", () => {
    const parsed = parseListsFromText({
      demo: [
        "domain:example.com",
        "full:api.sample.net",
        "keyword:tracker",
        "regexp:(^|\\.)netflix\\.com$",
        "regexp:^cdn\\d-epicgames-\\d+\\.file\\.myqcloud\\.com$",
      ].join("\n"),
    });

    const resolved = resolveOneList(parsed, "demo");
    const output = emitEgernRuleset(resolved);

    expect(output.lines).toEqual([
      "domain_set:",
      '  - "api.sample.net"',
      "domain_suffix_set:",
      '  - "example.com"',
      "domain_keyword_set:",
      '  - "tracker"',
      "domain_regex_set:",
      '  - "(^|\\\\.)netflix\\\\.com$"',
      '  - "^cdn\\\\d-epicgames-\\\\d+\\\\.file\\\\.myqcloud\\\\.com$"',
    ]);

    expect(output.report.regex).toEqual({
      total: 2,
      emitted: 2,
    });
  });

  test("dedupes duplicated regex rules by default", () => {
    const output = emitEgernRuleset({
      name: "DEMO",
      entries: [makeRegexRule(1), makeRegexRule(2)],
    });

    expect(output.lines).toEqual([
      "domain_regex_set:",
      '  - "(^|\\\\.)netflix\\\\.com$"',
    ]);
    expect(output.report.regex).toEqual({
      total: 2,
      emitted: 2,
    });
  });

  test("keeps duplicated regex rules when dedupe is disabled", () => {
    const output = emitEgernRuleset(
      {
        name: "DEMO",
        entries: [makeRegexRule(1), makeRegexRule(2)],
      },
      { dedupe: false },
    );

    expect(output.lines).toEqual([
      "domain_regex_set:",
      '  - "(^|\\\\.)netflix\\\\.com$"',
      '  - "(^|\\\\.)netflix\\\\.com$"',
    ]);
    expect(output.report.regex).toEqual({
      total: 2,
      emitted: 2,
    });
  });
});

function makeRegexRule(line: number): DomainRule {
  return {
    type: "regexp",
    value: "(^|\\.)netflix\\.com$",
    attrs: [],
    affiliations: [],
    plain: "regexp:(^|\\.)netflix\\.com$",
    source: {
      list: "demo",
      line,
    },
  };
}
