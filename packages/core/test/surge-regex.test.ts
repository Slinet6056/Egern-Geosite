import { describe, expect, test } from "vitest";

import { convertDomainRegexToUrlRegex } from "../src/surge-regex.js";

describe("convertDomainRegexToUrlRegex", () => {
  describe("skip mode", () => {
    test("returns null for all patterns", () => {
      expect(
        convertDomainRegexToUrlRegex("^example\\.com$", "skip"),
      ).toBeNull();
      expect(
        convertDomainRegexToUrlRegex("(^|\\.)netflix\\.com$", "skip"),
      ).toBeNull();
    });
  });

  describe("standard mode", () => {
    test("converts exact anchored domain", () => {
      expect(
        convertDomainRegexToUrlRegex("^cdn\\.example\\.com$", "standard"),
      ).toBe("^https?://cdn\\.example\\.com/");
    });

    test("converts suffix pattern with (^|\\.)", () => {
      expect(
        convertDomainRegexToUrlRegex("(^|\\.)netflix\\.com$", "standard"),
      ).toBe("^https?://([^/]+\\.)?netflix\\.com/");
    });

    test("converts suffix pattern with leading \\.", () => {
      expect(
        convertDomainRegexToUrlRegex("\\.example\\.com$", "standard"),
      ).toBe("^https?://[^/]*\\.example\\.com/");
    });

    test("converts end-anchored dynamic host suffix", () => {
      expect(convertDomainRegexToUrlRegex("javdb\\d+\\.com$", "standard")).toBe(
        "^https?://[^/]*javdb\\d+\\.com/",
      );
    });

    test("converts end-anchored host suffix with required subdomain", () => {
      expect(
        convertDomainRegexToUrlRegex(
          ".+\\.dkr\\.ecr\\.[^\\.]+\\.amazonaws\\.com$",
          "standard",
        ),
      ).toBe("^https?://[^/]*.+\\.dkr\\.ecr\\.[^\\.]+\\.amazonaws\\.com/");
    });

    test("converts anchored domain with \\d and quantifiers", () => {
      expect(
        convertDomainRegexToUrlRegex(
          "^cdn\\d-epicgames-\\d+\\.file\\.myqcloud\\.com$",
          "standard",
        ),
      ).toBe("^https?://cdn\\d-epicgames-\\d+\\.file\\.myqcloud\\.com/");
    });

    test("converts anchored domain with alternation in parens", () => {
      expect(
        convertDomainRegexToUrlRegex("^api\\.example\\.(com|net)$", "standard"),
      ).toBe("^https?://api\\.example\\.(com|net)/");
    });

    test("converts prefix-only pattern (^ without $)", () => {
      expect(
        convertDomainRegexToUrlRegex("^cdn\\.example\\.com", "standard"),
      ).toBe("^https?://cdn\\.example\\.com[^/]*/");
    });

    test("rejects pattern with lookahead", () => {
      expect(
        convertDomainRegexToUrlRegex("^(?=.*ad)example\\.com$", "standard"),
      ).toBeNull();
    });

    test("rejects pattern with backreference", () => {
      expect(
        convertDomainRegexToUrlRegex("^(a)\\1\\.com$", "standard"),
      ).toBeNull();
    });

    test("rejects pattern with path characters", () => {
      expect(
        convertDomainRegexToUrlRegex("^example\\.com/path$", "standard"),
      ).toBeNull();
    });

    test("rejects unanchored pattern", () => {
      expect(
        convertDomainRegexToUrlRegex("example\\.com", "standard"),
      ).toBeNull();
    });

    test("rejects unsafe end-anchored pattern with lookahead", () => {
      expect(
        convertDomainRegexToUrlRegex("(?!foo)example\\.com$", "standard"),
      ).toBeNull();
    });

    test("rejects pattern with top-level alternation", () => {
      expect(
        convertDomainRegexToUrlRegex("^a\\.com$|^b\\.com$", "standard"),
      ).toBeNull();
    });
  });

  describe("aggressive mode", () => {
    test("converts exact anchored domain", () => {
      expect(
        convertDomainRegexToUrlRegex("^cdn\\.example\\.com$", "aggressive"),
      ).toBe("^https?://cdn\\.example\\.com/");
    });

    test("converts suffix pattern with (^|\\.)", () => {
      expect(
        convertDomainRegexToUrlRegex("(^|\\.)netflix\\.com$", "aggressive"),
      ).toBe("^https?://([^/]+\\.)?netflix\\.com/");
    });

    test("converts unanchored pattern (would fail in standard)", () => {
      expect(convertDomainRegexToUrlRegex("example\\.com", "aggressive")).toBe(
        "^https?://[^/]*example\\.com[^/]*/",
      );
    });

    test("converts pattern with only end anchor", () => {
      expect(
        convertDomainRegexToUrlRegex("\\.example\\.com$", "aggressive"),
      ).toBe("^https?://[^/]*\\.example\\.com/");
    });

    test("converts complex pattern that standard rejects", () => {
      const result = convertDomainRegexToUrlRegex(
        "ad.*tracker\\.com$",
        "aggressive",
      );
      expect(result).not.toBeNull();
      expect(result).toBe("^https?://[^/]*ad.*tracker\\.com/");
    });
  });
});
