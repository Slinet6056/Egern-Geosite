import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { analyzeSurgeRegexCoverage } from "../src/analyze-surge-regex.js";
import { runCli } from "../src/index.js";

describe("analyzeSurgeRegexCoverage", () => {
  test("groups unsupported standard regex patterns and writes report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "geosite-analyze-"));
    const dataDir = path.join(root, "data");
    const reportPath = path.join(root, "report.json");

    await mkdir(dataDir, { recursive: true });
    await writeFile(
      path.join(dataDir, "demo"),
      [
        "regexp:foo|bar",
        "regexp:^(?!ads\\.).*$",
        "regexp:^api/(foo|bar)$",
        "regexp:(^|\\.)netflix\\.com$",
      ].join("\n") + "\n",
      "utf8",
    );

    const report = await analyzeSurgeRegexCoverage({
      dataDir,
      sourceMode: "existing",
    });

    expect(report.summary.regexpEntries).toBe(4);
    expect(report.summary.standardConverted).toBe(1);
    expect(report.summary.standardSkipped).toBe(3);
    expect(report.reasons["top-level-alternation"].entries).toBe(1);
    expect(report.reasons.lookaround.entries).toBe(1);
    expect(report.reasons["path-character"].entries).toBe(1);
    expect(report.unsupportedPatterns[0]?.occurrences.length).toBe(1);

    const code = await runCli([
      "analyze-surge-regex",
      "--data-dir",
      dataDir,
      "--report-json",
      reportPath,
    ]);

    expect(code).toBe(0);
    const reportJson = await readFile(reportPath, "utf8");
    expect(reportJson).toContain('"standardSkipped": 3');
    expect(reportJson).toContain('"top-level-alternation"');
    expect(reportJson).toContain('"lookaround"');
    expect(reportJson).toContain('"path-character"');
  });
});
