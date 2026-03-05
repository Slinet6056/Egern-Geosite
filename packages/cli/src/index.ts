#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  aggregateGlobalStats,
  countFilterAttrs,
  countResolvedEntries,
  countSourceEntries,
  emitEgernRuleset,
  outputStatsFromEmit,
  parseListsFromText,
  resolveAllLists,
  type ListStats,
} from "@egern-geosite/core";

import { getStringFlag, parseCliArgs } from "./args.js";
import { loadListsFromDirectory } from "./fs-loader.js";

interface BuildIndexEntry {
  name: string;
  sourceFile?: string;
  filters: string[];
  path: string;
}

interface BuildMeta {
  generatedAt: string;
  lists: number;
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseCliArgs(argv);

  switch (parsed.command) {
    case "build":
      return runBuild(parsed.flags);
    case "help":
    default:
      printHelp();
      return parsed.command === "help" ? 0 : 1;
  }
}

async function runBuild(
  flags: Record<string, string | boolean>,
): Promise<number> {
  const dataDir = getStringFlag(flags, "data-dir");
  const outDir = path.resolve(
    process.cwd(),
    getStringFlag(flags, "out-dir") ?? "out",
  );
  const listArg = getStringFlag(flags, "list");

  if (!dataDir) {
    console.error("missing required flag: --data-dir");
    return 1;
  }

  const resolvedDataDir = path.resolve(process.cwd(), dataDir);
  let sourceRecord: Record<string, string>;
  try {
    sourceRecord = await loadListsFromDirectory(resolvedDataDir);
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) {
      console.error(
        `data directory not found: ${resolvedDataDir}\n` +
          "hint: pass --data-dir pointing to v2ray-rules-dat (release branch clone).",
      );
      return 1;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `failed to read data directory ${resolvedDataDir}: ${message}`,
    );
    return 1;
  }

  const parsed = parseListsFromText(sourceRecord);
  const resolved = resolveAllLists(parsed);

  const requestedNames = listArg
    ? splitListArg(listArg).map((name) => name.toUpperCase())
    : Object.keys(resolved).sort();

  for (const listName of requestedNames) {
    if (!resolved[listName]) {
      console.error(`list not found: ${listName}`);
      return 1;
    }
  }

  await mkdir(path.join(outDir, "rules"), { recursive: true });
  await mkdir(path.join(outDir, "resolved"), { recursive: true });
  await mkdir(path.join(outDir, "stats", "lists"), { recursive: true });
  await mkdir(path.join(outDir, "index"), { recursive: true });

  const listStats: ListStats[] = [];
  const indexRecord: Record<string, BuildIndexEntry> = {};

  for (const listName of requestedNames) {
    const resolvedList = resolved[listName]!;
    const sourceEntries = parsed[listName] ?? [];

    const emitted = emitEgernRuleset(resolvedList);

    const outputPath = path.join(
      outDir,
      "rules",
      `${listName.toLowerCase()}.yaml`,
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${emitted.text}\n`, "utf8");

    const resolvedPath = path.join(
      outDir,
      "resolved",
      `${listName.toLowerCase()}.json`,
    );
    await writeFile(
      resolvedPath,
      `${JSON.stringify(resolvedList.entries, null, 2)}\n`,
      "utf8",
    );

    const currentListStats: ListStats = {
      name: listName,
      source: countSourceEntries(sourceEntries),
      resolved: countResolvedEntries(resolvedList.entries),
      filters: {
        attrs: countFilterAttrs(resolvedList.entries),
      },
      output: outputStatsFromEmit(emitted),
    };

    listStats.push(currentListStats);

    const perListStatsPath = path.join(
      outDir,
      "stats",
      "lists",
      `${listName.toLowerCase()}.json`,
    );
    await writeFile(
      perListStatsPath,
      `${JSON.stringify(currentListStats, null, 2)}\n`,
      "utf8",
    );

    const sourceFile =
      sourceRecord[listName.toLowerCase()] !== undefined
        ? listName.toLowerCase()
        : undefined;
    indexRecord[listName.toLowerCase()] = {
      name: listName,
      ...(sourceFile ? { sourceFile } : {}),
      filters: Object.keys(currentListStats.filters.attrs).sort(),
      path: `rules/${listName.toLowerCase()}.yaml`,
    };
  }

  const globalStats = aggregateGlobalStats(listStats);
  const meta: BuildMeta = {
    generatedAt: new Date().toISOString(),
    lists: listStats.length,
  };

  await writeFile(
    path.join(outDir, "stats", "global.json"),
    `${JSON.stringify(globalStats, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outDir, "index", "geosite.json"),
    `${JSON.stringify(indexRecord, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outDir, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );

  console.log(`generated lists=${listStats.length} output=${outDir}`);
  return 0;
}

function hasErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === code;
}

function splitListArg(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function printHelp(): void {
  console.log(`egern-geosite commands:
  build --data-dir <dir> [--list <a,b,c>] [--out-dir <dir>]

build output layout:
  <out>/meta.json
  <out>/index/geosite.json
  <out>/rules/<list>.yaml
  <out>/resolved/<list>.json
  <out>/stats/global.json
  <out>/stats/lists/<list>.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(message);
      process.exitCode = 1;
    });
}
