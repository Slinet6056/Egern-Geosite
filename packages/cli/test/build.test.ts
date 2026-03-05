import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { runCli } from "../src/index.js";

describe("runCli build", () => {
  test("generates rules artifact and stats", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "geosite-build-"));
    const dataDir = path.join(root, "data");
    const outDir = path.join(root, "out");

    await mkdir(dataDir, { recursive: true });
    await writeFile(
      path.join(dataDir, "demo"),
      "domain:example.com\nregexp:(^|\\.)netflix\\.com$\n",
      "utf8",
    );

    const code = await runCli([
      "build",
      "--data-dir",
      dataDir,
      "--out-dir",
      outDir,
    ]);
    expect(code).toBe(0);

    const rules = await readFile(
      path.join(outDir, "rules", "demo.yaml"),
      "utf8",
    );
    const resolved = await readFile(
      path.join(outDir, "resolved", "demo.json"),
      "utf8",
    );
    const globalStats = await readFile(
      path.join(outDir, "stats", "global.json"),
      "utf8",
    );

    expect(rules).toContain("domain_suffix_set:");
    expect(rules).toContain("domain_regex_set:");
    expect(rules).toContain('"(^|\\\\.)netflix\\\\.com$"');
    expect(resolved).toContain('"type": "domain"');
    expect(globalStats).toContain('"lists": 1');
  });

  test("returns code 1 when data directory does not exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "geosite-build-"));
    const missingDataDir = path.join(root, "missing-data");
    const outDir = path.join(root, "out");

    const code = await runCli([
      "build",
      "--data-dir",
      missingDataDir,
      "--out-dir",
      outDir,
    ]);

    expect(code).toBe(1);
  });

  test("accepts v2ray-rules-dat style .txt list files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "geosite-build-"));
    const dataDir = path.join(root, "v2ray-rules-dat");
    const outDir = path.join(root, "out");

    await mkdir(dataDir, { recursive: true });
    await writeFile(
      path.join(dataDir, "direct-list.txt"),
      "domain:example.com\n",
      "utf8",
    );

    const code = await runCli([
      "build",
      "--data-dir",
      dataDir,
      "--out-dir",
      outDir,
    ]);

    expect(code).toBe(0);
    const rules = await readFile(
      path.join(outDir, "rules", "direct-list.yaml"),
      "utf8",
    );
    expect(rules).toContain('"example.com"');
  });
});
