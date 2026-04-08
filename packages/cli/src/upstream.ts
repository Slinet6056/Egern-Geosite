import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_UPSTREAM_REPO_URL =
  "https://github.com/Loyalsoldier/v2ray-rules-dat.git";
export const DEFAULT_UPSTREAM_BRANCH = "release";

export interface UpstreamDataDirResult {
  cleanup(): Promise<void>;
  dataDir: string;
  mode: "existing" | "cloned";
}

export async function prepareUpstreamDataDir(
  dataDir: string | undefined,
  fetchUpstream: boolean,
): Promise<UpstreamDataDirResult> {
  if (dataDir) {
    return {
      cleanup: async () => {},
      dataDir: path.resolve(process.cwd(), dataDir),
      mode: "existing",
    };
  }

  if (!fetchUpstream) {
    throw new Error(
      "missing required flag: --data-dir (or pass --fetch-upstream to clone the real dataset)",
    );
  }

  const cloneRoot = await mkdtemp(
    path.join(tmpdir(), "egern-geosite-upstream-"),
  );
  const cloneDir = path.join(cloneRoot, "v2ray-rules-dat");

  await execFileAsync("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    DEFAULT_UPSTREAM_BRANCH,
    DEFAULT_UPSTREAM_REPO_URL,
    cloneDir,
  ]);

  return {
    cleanup: async () => {
      await rm(cloneRoot, { force: true, recursive: true });
    },
    dataDir: cloneDir,
    mode: "cloned",
  };
}
