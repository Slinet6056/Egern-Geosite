import {
  emitEgernRuleset,
  parseListsFromText,
  resolveAllLists,
  type DomainRule,
  type ResolvedList,
} from "@egern-geosite/core";
import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync } from "fflate";

const DEFAULT_UPSTREAM_ZIP_URL =
  "https://github.com/Loyalsoldier/v2ray-rules-dat/archive/refs/heads/release.zip";
const DEFAULT_UPSTREAM_USER_AGENT = "egern-geosite-worker/2";
const LATEST_STATE_KEY = "state/latest.json";
const SNAPSHOT_CACHE_LIMIT = 2;
const RESOLVED_CACHE_LIMIT = 2;

const VALID_LIST_NAME = /^[a-z0-9!-]+$/;
const VALID_ATTR_NAME = /^[a-z0-9!-]+$/;

const snapshotCache = new Map<string, Promise<SnapshotPayload>>();
const geoipSnapshotCache = new Map<string, Promise<GeoipSnapshotPayload>>();
const resolvedCache = new Map<string, Promise<Record<string, ResolvedList>>>();
const artifactBuildLocks = new Map<string, Promise<ArtifactBuildResult>>();
const geoipArtifactBuildLocks = new Map<
  string,
  Promise<GeoipArtifactBuildResult>
>();

export interface R2ObjectBodyLike {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2PutOptionsLike {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    options?: R2PutOptionsLike,
  ): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface AssetsBindingLike {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  GEOSITE_BUCKET: R2BucketLike;
  ASSETS?: AssetsBindingLike;
  UPSTREAM_ZIP_URL?: string;
  UPSTREAM_USER_AGENT?: string;
}

export interface ScheduledEventLike {
  cron: string;
  scheduledTime: number;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerDeps {
  now?: () => number;
  fetchImpl?: typeof fetch;
}

interface SnapshotMeta {
  sourceKey: string;
  indexKey: string;
  listCount: number;
  generatedAt: string;
}

interface GeoipPendingMeta {
  sourceKey: string;
  generatedAt: string;
}

interface LatestState {
  upstream: {
    zipUrl: string;
    etag: string;
  };
  snapshot: SnapshotMeta;
  geoipSnapshot?: SnapshotMeta;
  geoipPending?: GeoipPendingMeta;
  previousEtag: string | null;
  checkedAt: string;
}

interface SnapshotPayload {
  version: 1;
  etag: string;
  zipUrl: string;
  generatedAt: string;
  lists: Record<string, string>;
}

interface GeoipListPayload {
  ipv4Cidrs: string[];
  ipv6Cidrs: string[];
  reverseMatch: boolean;
}

interface GeoipSnapshotPayload {
  version: 1;
  etag: string;
  zipUrl: string;
  generatedAt: string;
  lists: Record<string, GeoipListPayload>;
}

interface GeositeIndexEntry {
  name: string;
  sourceFile: string;
  filters: string[];
  path: string;
}

type GeositeIndex = Record<string, GeositeIndexEntry>;

interface GeoipIndexEntry {
  name: string;
  sourceFile: string;
  ipv4Count: number;
  ipv6Count: number;
  defaultPath: string;
  noResolvePath: string;
}

type GeoipIndex = Record<string, GeoipIndexEntry>;

interface RefreshResult {
  updated: boolean;
  reason: "etag-unchanged" | "etag-updated" | "geoip-finalized";
  checkedAt: string;
  etag: string;
  listCount: number;
}

interface ArtifactBuildResult {
  listFound: boolean;
  output: string;
  availableFilters: string[];
}

interface GeoipArtifactBuildResult {
  listFound: boolean;
  output: string;
}

export function createWorker(deps: WorkerDeps = {}): {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<Response>;
  scheduled(
    event: ScheduledEventLike,
    env: WorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<void>;
} {
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = resolveFetchImpl(deps.fetchImpl);

  return {
    async fetch(
      request: Request,
      env: WorkerEnv,
      ctx: ExecutionContextLike,
    ): Promise<Response> {
      return handleFetch(request, env, ctx);
    },

    async scheduled(
      _event: ScheduledEventLike,
      env: WorkerEnv,
      _ctx: ExecutionContextLike,
    ): Promise<void> {
      await refreshGeositeRun(env, { now, fetchImpl });
    },
  };
}

export async function refreshGeositeRun(
  env: WorkerEnv,
  deps: WorkerDeps = {},
): Promise<RefreshResult> {
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = resolveFetchImpl(deps.fetchImpl);
  const checkedAt = new Date(now()).toISOString();
  const zipUrl = env.UPSTREAM_ZIP_URL ?? DEFAULT_UPSTREAM_ZIP_URL;
  const userAgent = env.UPSTREAM_USER_AGENT ?? DEFAULT_UPSTREAM_USER_AGENT;

  const current = await readJson<LatestState>(
    env.GEOSITE_BUCKET,
    LATEST_STATE_KEY,
  );

  const headResponse = await fetchImpl(zipUrl, {
    method: "HEAD",
    headers: {
      "user-agent": userAgent,
    },
  });
  if (!headResponse.ok) {
    throw new Error(
      `failed to check upstream zip: ${headResponse.status} ${headResponse.statusText}`,
    );
  }

  const observedHeadEtag = normalizeEtag(headResponse.headers.get("etag"));
  if (observedHeadEtag && current?.upstream.etag === observedHeadEtag) {
    const finalized = await finalizePendingGeoipSnapshot(
      env,
      current,
      checkedAt,
    );
    if (finalized) {
      return {
        updated: true,
        reason: "geoip-finalized",
        checkedAt,
        etag: current.upstream.etag,
        listCount: current.snapshot.listCount,
      };
    }

    const unchangedState: LatestState = {
      ...current,
      checkedAt,
    };
    await writeJson(env.GEOSITE_BUCKET, LATEST_STATE_KEY, unchangedState);

    return {
      updated: false,
      reason: "etag-unchanged",
      checkedAt,
      etag: observedHeadEtag,
      listCount: current.snapshot.listCount,
    };
  }

  const downloadResponse = await fetchImpl(zipUrl, {
    headers: {
      "user-agent": userAgent,
    },
  });
  if (!downloadResponse.ok) {
    throw new Error(
      `failed to download upstream zip: ${downloadResponse.status} ${downloadResponse.statusText}`,
    );
  }

  const zipBytes = new Uint8Array(await downloadResponse.arrayBuffer());
  const downloadedEtag = normalizeEtag(downloadResponse.headers.get("etag"));
  const computedEtag =
    downloadedEtag ?? observedHeadEtag ?? (await sha256Hex(zipBytes));

  if (current?.upstream.etag === computedEtag) {
    const finalized = await finalizePendingGeoipSnapshot(
      env,
      current,
      checkedAt,
    );
    if (finalized) {
      return {
        updated: true,
        reason: "geoip-finalized",
        checkedAt,
        etag: current.upstream.etag,
        listCount: current.snapshot.listCount,
      };
    }

    const unchangedState: LatestState = {
      ...current,
      checkedAt,
    };
    await writeJson(env.GEOSITE_BUCKET, LATEST_STATE_KEY, unchangedState);

    return {
      updated: false,
      reason: "etag-unchanged",
      checkedAt,
      etag: computedEtag,
      listCount: current.snapshot.listCount,
    };
  }

  const extracted = extractSourcesFromZip(zipBytes);
  const sources = extracted.geositeSources;
  const geoipDat = extracted.geoipDat;
  const listCount = Object.keys(sources).length;
  if (listCount === 0) {
    throw new Error("no geosite data files found in upstream zip");
  }
  // Validate snapshot can be parsed and resolved before publishing it as latest.
  const parsed = parseListsFromText(sources);
  void resolveAllLists(parsed);

  const generatedAt = new Date(now()).toISOString();
  const sourceKey = snapshotSourceKey(computedEtag);
  const indexKey = snapshotIndexKey(computedEtag);
  const geoipPendingKey = geoipPendingSourceKey(computedEtag);

  const snapshotPayload: SnapshotPayload = {
    version: 1,
    etag: computedEtag,
    zipUrl,
    generatedAt,
    lists: sources,
  };

  const compressedSnapshot = gzipSync(strToU8(JSON.stringify(snapshotPayload)));
  const index = buildIndexFromSources(sources);

  await writeBinary(env.GEOSITE_BUCKET, sourceKey, compressedSnapshot, {
    contentType: "application/json",
    cacheControl: "public, max-age=31536000, immutable",
  });
  await writeJson(env.GEOSITE_BUCKET, indexKey, index);

  if (geoipDat) {
    await writeBinary(env.GEOSITE_BUCKET, geoipPendingKey, geoipDat, {
      contentType: "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    });
  }

  const snapshotMeta: SnapshotMeta = {
    sourceKey,
    indexKey,
    listCount,
    generatedAt,
  };

  const geoipPendingMeta: GeoipPendingMeta | undefined = geoipDat
    ? {
        sourceKey: geoipPendingKey,
        generatedAt,
      }
    : undefined;

  const nextState: LatestState = {
    upstream: {
      zipUrl,
      etag: computedEtag,
    },
    snapshot: snapshotMeta,
    ...(geoipPendingMeta ? { geoipPending: geoipPendingMeta } : {}),
    previousEtag: current?.upstream.etag ?? null,
    checkedAt,
  };

  const latestBeforeWrite = await readJson<LatestState>(
    env.GEOSITE_BUCKET,
    LATEST_STATE_KEY,
  );
  if (
    latestBeforeWrite &&
    latestBeforeWrite.upstream.etag !== current?.upstream.etag
  ) {
    return {
      updated: false,
      reason: "etag-unchanged",
      checkedAt,
      etag: latestBeforeWrite.upstream.etag,
      listCount: latestBeforeWrite.snapshot.listCount,
    };
  }

  await writeJson(env.GEOSITE_BUCKET, LATEST_STATE_KEY, nextState);

  snapshotCache.clear();
  geoipSnapshotCache.clear();
  resolvedCache.clear();

  return {
    updated: true,
    reason: "etag-updated",
    checkedAt,
    etag: computedEtag,
    listCount,
  };
}

async function finalizePendingGeoipSnapshot(
  env: WorkerEnv,
  current: LatestState,
  checkedAt: string,
): Promise<boolean> {
  const pending = current.geoipPending;
  if (!pending || current.geoipSnapshot) {
    return false;
  }

  const latestBeforeWrite = await readJson<LatestState>(
    env.GEOSITE_BUCKET,
    LATEST_STATE_KEY,
  );
  if (!latestBeforeWrite) {
    return false;
  }

  if (latestBeforeWrite.upstream.etag !== current.upstream.etag) {
    return false;
  }

  if (latestBeforeWrite.geoipSnapshot) {
    return false;
  }

  const activePending = latestBeforeWrite.geoipPending;
  if (!activePending || activePending.sourceKey !== pending.sourceKey) {
    return false;
  }

  const rawObject = await env.GEOSITE_BUCKET.get(activePending.sourceKey);
  if (!rawObject) {
    return false;
  }

  const geoipDat = new Uint8Array(await rawObject.arrayBuffer());
  const geoipSources = extractSourcesFromGeoipDatBytes(geoipDat);
  const geoipListCount = Object.keys(geoipSources).length;
  const generatedAt = activePending.generatedAt;
  const geoipSourceKey = geoipSnapshotSourceKey(current.upstream.etag);
  const geoipIndexKey = geoipSnapshotIndexKey(current.upstream.etag);

  const geoipSnapshotPayload: GeoipSnapshotPayload = {
    version: 1,
    etag: current.upstream.etag,
    zipUrl: current.upstream.zipUrl,
    generatedAt,
    lists: geoipSources,
  };
  const compressedGeoipSnapshot = gzipSync(
    strToU8(JSON.stringify(geoipSnapshotPayload)),
  );
  const geoipIndex = buildGeoipIndexFromSources(geoipSources);

  await writeBinary(
    env.GEOSITE_BUCKET,
    geoipSourceKey,
    compressedGeoipSnapshot,
    {
      contentType: "application/json",
      cacheControl: "public, max-age=31536000, immutable",
    },
  );
  await writeJson(env.GEOSITE_BUCKET, geoipIndexKey, geoipIndex);

  const { geoipPending: _ignored, ...withoutPending } = latestBeforeWrite;
  const nextState: LatestState = {
    ...withoutPending,
    geoipSnapshot: {
      sourceKey: geoipSourceKey,
      indexKey: geoipIndexKey,
      listCount: geoipListCount,
      generatedAt,
    },
    checkedAt,
  };

  await writeJson(env.GEOSITE_BUCKET, LATEST_STATE_KEY, nextState);
  geoipSnapshotCache.clear();

  if (env.GEOSITE_BUCKET.delete) {
    await env.GEOSITE_BUCKET.delete(activePending.sourceKey);
  }

  return true;
}

async function handleFetch(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContextLike,
): Promise<Response> {
  if (request.method !== "GET") {
    return text(405, "method not allowed");
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/geosite") {
    return handleGeositeIndex(request, env, ctx);
  }

  if (path === "/geoip") {
    return handleGeoipIndex(request, env, ctx);
  }

  if (path.startsWith("/geoip/")) {
    const suffix = path.slice("/geoip/".length);
    const decoded = safeDecodeURIComponent(suffix);
    if (decoded === null) {
      return text(400, "invalid path encoding");
    }

    const noResolve = parseBooleanQueryFlag(url, "no_resolve");
    return handleGeoipRules(
      request,
      stripOptionalSuffix(decoded, ".yaml"),
      noResolve,
      env,
      ctx,
    );
  }

  if (path.startsWith("/geosite/")) {
    const suffix = path.slice("/geosite/".length);
    const segments = suffix.split("/").filter((item) => item.length > 0);
    if (segments.length === 0) {
      return text(404, "not found");
    }

    if (segments.length >= 2 && isLegacyModeSegment(segments[0]!)) {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/geosite/${segments.slice(1).join("/")}`;
      return Response.redirect(redirectUrl.toString(), 308);
    }

    const decoded = safeDecodeURIComponent(segments.join("/"));
    if (decoded === null) {
      return text(400, "invalid path encoding");
    }

    return handleGeositeRules(
      request,
      stripOptionalSuffix(decoded, ".yaml"),
      env,
      ctx,
    );
  }

  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return text(404, "not found");
}

async function handleGeositeIndex(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const latest = await ensureLatestState(env);
  if (!latest) {
    return json(503, { ok: false, error: "geosite data not ready" });
  }

  const indexEtag = buildIndexEtag(latest.upstream.etag);
  const indexHeaders = {
    "cache-control":
      "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
    etag: indexEtag,
    "x-upstream-etag": latest.upstream.etag,
    "x-generated-at": latest.snapshot.generatedAt,
    "x-checked-at": latest.checkedAt,
  };

  if (matchesIfNoneMatch(request.headers.get("if-none-match"), indexEtag)) {
    return notModified(indexHeaders);
  }

  const index = await readJson<GeositeIndex>(
    env.GEOSITE_BUCKET,
    latest.snapshot.indexKey,
  );
  if (index) {
    return json(200, index, indexHeaders);
  }

  const snapshot = await loadSnapshotPayload(env, latest);
  const builtIndex = buildIndexFromSources(snapshot.lists);
  ctx.waitUntil(
    writeJson(env.GEOSITE_BUCKET, latest.snapshot.indexKey, builtIndex),
  );

  return json(200, builtIndex, indexHeaders);
}

async function handleGeoipIndex(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const latest = await ensureLatestState(env);
  if (!latest || !latest.geoipSnapshot) {
    return json(503, { ok: false, error: "geoip data not ready" });
  }

  const indexEtag = buildGeoipIndexEtag(latest.upstream.etag);
  const indexHeaders = {
    "cache-control":
      "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
    etag: indexEtag,
    "x-upstream-etag": latest.upstream.etag,
    "x-generated-at": latest.geoipSnapshot.generatedAt,
    "x-checked-at": latest.checkedAt,
  };

  if (matchesIfNoneMatch(request.headers.get("if-none-match"), indexEtag)) {
    return notModified(indexHeaders);
  }

  const index = await readJson<GeoipIndex>(
    env.GEOSITE_BUCKET,
    latest.geoipSnapshot.indexKey,
  );
  if (index) {
    return json(200, index, indexHeaders);
  }

  const snapshot = await loadGeoipSnapshotPayload(env, latest);
  const builtIndex = buildGeoipIndexFromSources(snapshot.lists);
  ctx.waitUntil(
    writeJson(env.GEOSITE_BUCKET, latest.geoipSnapshot.indexKey, builtIndex),
  );

  return json(200, builtIndex, indexHeaders);
}

async function handleGeositeRules(
  request: Request,
  nameWithFilter: string,
  env: WorkerEnv,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const { name, filter } = splitNameFilter(nameWithFilter);
  if (!isValidListName(name) || (filter !== null && !isValidAttr(filter))) {
    return text(400, "invalid name");
  }

  const latest = await ensureLatestState(env);
  if (!latest) {
    return text(503, "geosite data not ready");
  }

  const latestKey = artifactKey(latest.upstream.etag, name, filter);
  const latestArtifact = await readText(env.GEOSITE_BUCKET, latestKey);
  if (latestArtifact !== null) {
    const responseEtag = buildRulesEtag(latest.upstream.etag, name, filter);
    const headers = responseHeaders(latest.upstream.etag, name, filter, false);
    if (
      matchesIfNoneMatch(request.headers.get("if-none-match"), responseEtag)
    ) {
      return notModified(headers);
    }
    return text(200, latestArtifact, headers);
  }

  const index = await readJson<GeositeIndex>(
    env.GEOSITE_BUCKET,
    latest.snapshot.indexKey,
  );
  if (index && !index[name]) {
    return text(404, `list not found: ${name}`);
  }

  const compilePromise = ensureArtifactForLatest(env, latest, name, filter);

  if (!filter && latest.previousEtag && index && index[name]) {
    const staleKey = artifactKey(latest.previousEtag, name, filter);
    const staleArtifact = await readText(env.GEOSITE_BUCKET, staleKey);
    if (staleArtifact !== null) {
      const responseEtag = buildRulesEtag(latest.previousEtag, name, filter);
      const headers = responseHeaders(latest.previousEtag, name, filter, true);
      ctx.waitUntil(
        compilePromise
          .then((result) =>
            maybeEnrichIndexFilters(env, latest, name, result.availableFilters),
          )
          .catch(() => undefined),
      );

      if (
        matchesIfNoneMatch(request.headers.get("if-none-match"), responseEtag)
      ) {
        return notModified(headers);
      }
      return text(200, staleArtifact, headers);
    }
  }

  const build = await compilePromise;
  if (!build.listFound) {
    return text(404, `list not found: ${name}`);
  }

  if (build.availableFilters.length > 0) {
    ctx.waitUntil(
      maybeEnrichIndexFilters(env, latest, name, build.availableFilters),
    );
  }

  const responseEtag = buildRulesEtag(latest.upstream.etag, name, filter);
  const headers = responseHeaders(latest.upstream.etag, name, filter, false);
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), responseEtag)) {
    return notModified(headers);
  }
  return text(200, build.output, headers);
}

async function handleGeoipRules(
  request: Request,
  nameRaw: string,
  noResolve: boolean,
  env: WorkerEnv,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const name = nameRaw.trim().toLowerCase();
  if (!isValidListName(name)) {
    return text(400, "invalid name");
  }

  const latest = await ensureLatestState(env);
  if (!latest || !latest.geoipSnapshot) {
    return text(503, "geoip data not ready");
  }

  const latestKey = geoipArtifactKey(latest.upstream.etag, name);
  const latestArtifact = await readText(env.GEOSITE_BUCKET, latestKey);
  if (latestArtifact !== null) {
    const responseEtag = buildGeoipRulesEtag(
      latest.upstream.etag,
      name,
      noResolve,
    );
    const headers = geoipResponseHeaders(
      latest.upstream.etag,
      name,
      false,
      noResolve,
    );
    if (
      matchesIfNoneMatch(request.headers.get("if-none-match"), responseEtag)
    ) {
      return notModified(headers);
    }
    const output = noResolve
      ? withNoResolveLine(latestArtifact)
      : latestArtifact;
    return text(200, output, headers);
  }

  const index = await readJson<GeoipIndex>(
    env.GEOSITE_BUCKET,
    latest.geoipSnapshot.indexKey,
  );
  if (index && !index[name]) {
    return text(404, `list not found: ${name}`);
  }

  const compilePromise = ensureGeoipArtifactForLatest(env, latest, name);

  if (latest.previousEtag && index && index[name]) {
    const staleKey = geoipArtifactKey(latest.previousEtag, name);
    const staleArtifact = await readText(env.GEOSITE_BUCKET, staleKey);
    if (staleArtifact !== null) {
      const responseEtag = buildGeoipRulesEtag(
        latest.previousEtag,
        name,
        noResolve,
      );
      const headers = geoipResponseHeaders(
        latest.previousEtag,
        name,
        true,
        noResolve,
      );
      ctx.waitUntil(
        compilePromise.then(() => undefined).catch(() => undefined),
      );

      if (
        matchesIfNoneMatch(request.headers.get("if-none-match"), responseEtag)
      ) {
        return notModified(headers);
      }

      const output = noResolve
        ? withNoResolveLine(staleArtifact)
        : staleArtifact;
      return text(200, output, headers);
    }
  }

  const build = await compilePromise;
  if (!build.listFound) {
    return text(404, `list not found: ${name}`);
  }

  const responseEtag = buildGeoipRulesEtag(
    latest.upstream.etag,
    name,
    noResolve,
  );
  const headers = geoipResponseHeaders(
    latest.upstream.etag,
    name,
    false,
    noResolve,
  );
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), responseEtag)) {
    return notModified(headers);
  }

  const output = noResolve ? withNoResolveLine(build.output) : build.output;
  return text(200, output, headers);
}

function splitNameFilter(input: string): {
  name: string;
  filter: string | null;
} {
  const normalized = input.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at === -1) {
    return { name: normalized, filter: null };
  }

  const name = normalized.slice(0, at);
  const filter = normalized.slice(at + 1);
  return {
    name,
    filter: filter.length === 0 ? null : filter,
  };
}

function stripOptionalSuffix(input: string, suffix: string): string {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().endsWith(suffix.toLowerCase())) {
    return trimmed.slice(0, -suffix.length);
  }
  return trimmed;
}

function buildRulesFileName(name: string, filter: string | null): string {
  const normalizedName = name.toLowerCase();
  return `${filter ? `${normalizedName}@${filter}` : normalizedName}.yaml`;
}

function buildGeoipRulesFileName(name: string): string {
  return `${name.toLowerCase()}.yaml`;
}

function responseHeaders(
  etag: string,
  name: string,
  filter: string | null,
  stale: boolean,
): Record<string, string> {
  const responseEtag = buildRulesEtag(etag, name, filter);
  const fileName = buildRulesFileName(name, filter);
  return {
    "content-type": "text/yaml; charset=utf-8",
    "content-disposition": `inline; filename="${fileName}"`,
    "cache-control": stale
      ? "public, max-age=60, s-maxage=120, stale-while-revalidate=900"
      : "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    etag: responseEtag,
    "x-upstream-etag": etag,
    "x-list": name.toLowerCase(),
    ...(filter ? { "x-filter": filter } : {}),
    ...(stale ? { "x-stale": "1" } : {}),
  };
}

function geoipResponseHeaders(
  etag: string,
  name: string,
  stale: boolean,
  noResolve: boolean,
): Record<string, string> {
  return {
    "content-type": "text/yaml; charset=utf-8",
    "content-disposition": `inline; filename="${buildGeoipRulesFileName(name)}"`,
    "cache-control": stale
      ? "public, max-age=60, s-maxage=120, stale-while-revalidate=900"
      : "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    etag: buildGeoipRulesEtag(etag, name, noResolve),
    "x-upstream-etag": etag,
    "x-list": name.toLowerCase(),
    ...(noResolve ? { "x-no-resolve": "1" } : {}),
    ...(stale ? { "x-stale": "1" } : {}),
  };
}

function buildIndexEtag(upstreamEtag: string): string {
  return `"${upstreamEtag}-index"`;
}

function buildGeoipIndexEtag(upstreamEtag: string): string {
  return `"${upstreamEtag}-geoip-index"`;
}

function buildRulesEtag(
  upstreamEtag: string,
  name: string,
  filter: string | null,
): string {
  return `"${upstreamEtag}:${name.toLowerCase()}${filter ? `@${filter}` : ""}"`;
}

function buildGeoipRulesEtag(
  upstreamEtag: string,
  name: string,
  noResolve: boolean,
): string {
  return `"${upstreamEtag}:geoip:${name.toLowerCase()}:nr${noResolve ? "1" : "0"}"`;
}

function matchesIfNoneMatch(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) {
    return false;
  }

  if (ifNoneMatch.trim() === "*") {
    return true;
  }

  return ifNoneMatch
    .split(",")
    .map((item) => item.trim())
    .some((item) => item === etag);
}

function notModified(headers: Record<string, string>): Response {
  const nextHeaders = { ...headers };
  delete nextHeaders["content-type"];
  return new Response(null, {
    status: 304,
    headers: nextHeaders,
  });
}

async function ensureArtifactForLatest(
  env: WorkerEnv,
  latest: LatestState,
  name: string,
  filter: string | null,
): Promise<ArtifactBuildResult> {
  const lockKey = `${latest.upstream.etag}:${artifactName(name, filter)}`;
  const existingLock = artifactBuildLocks.get(lockKey);
  if (existingLock) {
    return existingLock;
  }

  const lock = (async () => {
    const outputKey = artifactKey(latest.upstream.etag, name, filter);
    const existing = await readText(env.GEOSITE_BUCKET, outputKey);
    if (existing !== null) {
      return {
        listFound: true,
        output: existing,
        availableFilters: [],
      };
    }

    const resolved = await loadResolvedLists(env, latest);
    const target = resolved[name.toUpperCase()];
    if (!target) {
      return {
        listFound: false,
        output: "",
        availableFilters: [],
      };
    }

    const availableFilters = collectFilters(target.entries);
    if (filter && !availableFilters.includes(filter)) {
      return {
        listFound: true,
        output: "",
        availableFilters,
      };
    }

    const entries = filter
      ? target.entries.filter((entry) => entry.attrs.includes(filter))
      : target.entries;

    const emitted = emitEgernRuleset({
      name: target.name,
      entries,
    });

    const output = emitted.text.length > 0 ? `${emitted.text}\n` : "";
    await writeText(env.GEOSITE_BUCKET, outputKey, output, {
      contentType: "application/yaml; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
    });
    return {
      listFound: true,
      output,
      availableFilters,
    };
  })().finally(() => {
    artifactBuildLocks.delete(lockKey);
  });

  artifactBuildLocks.set(lockKey, lock);
  return lock;
}

async function ensureGeoipArtifactForLatest(
  env: WorkerEnv,
  latest: LatestState,
  name: string,
): Promise<GeoipArtifactBuildResult> {
  const lockKey = `geoip:${latest.upstream.etag}:${name}`;
  const existingLock = geoipArtifactBuildLocks.get(lockKey);
  if (existingLock) {
    return existingLock;
  }

  const lock = (async () => {
    const outputKey = geoipArtifactKey(latest.upstream.etag, name);
    const existing = await readText(env.GEOSITE_BUCKET, outputKey);
    if (existing !== null) {
      return {
        listFound: true,
        output: existing,
      };
    }

    const snapshot = await loadGeoipSnapshotPayload(env, latest);
    const target = snapshot.lists[name];
    if (!target) {
      return {
        listFound: false,
        output: "",
      };
    }

    const output = emitGeoipRuleset(target);
    await writeText(env.GEOSITE_BUCKET, outputKey, output, {
      contentType: "application/yaml; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
    });

    return {
      listFound: true,
      output,
    };
  })().finally(() => {
    geoipArtifactBuildLocks.delete(lockKey);
  });

  geoipArtifactBuildLocks.set(lockKey, lock);
  return lock;
}

async function loadResolvedLists(
  env: WorkerEnv,
  latest: LatestState,
): Promise<Record<string, ResolvedList>> {
  const cacheKey = latest.upstream.etag;
  const cached = resolvedCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const snapshot = await loadSnapshotPayload(env, latest);
    const parsed = parseListsFromText(snapshot.lists);
    return resolveAllLists(parsed);
  })();

  resolvedCache.set(cacheKey, pending);
  pruneMap(resolvedCache, RESOLVED_CACHE_LIMIT);
  return pending.catch((error) => {
    resolvedCache.delete(cacheKey);
    throw error;
  });
}

async function loadSnapshotPayload(
  env: WorkerEnv,
  latest: LatestState,
): Promise<SnapshotPayload> {
  const cacheKey = latest.snapshot.sourceKey;
  const cached = snapshotCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const object = await env.GEOSITE_BUCKET.get(latest.snapshot.sourceKey);
    if (!object) {
      throw new Error(`snapshot not found: ${latest.snapshot.sourceKey}`);
    }

    const compressed = new Uint8Array(await object.arrayBuffer());
    const payloadText = strFromU8(gunzipSync(compressed));
    return JSON.parse(payloadText) as SnapshotPayload;
  })();

  snapshotCache.set(cacheKey, pending);
  pruneMap(snapshotCache, SNAPSHOT_CACHE_LIMIT);
  return pending.catch((error) => {
    snapshotCache.delete(cacheKey);
    throw error;
  });
}

async function loadGeoipSnapshotPayload(
  env: WorkerEnv,
  latest: LatestState,
): Promise<GeoipSnapshotPayload> {
  const meta = latest.geoipSnapshot;
  if (!meta) {
    throw new Error("geoip snapshot not available");
  }

  const cacheKey = meta.sourceKey;
  const cached = geoipSnapshotCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const object = await env.GEOSITE_BUCKET.get(meta.sourceKey);
    if (!object) {
      throw new Error(`snapshot not found: ${meta.sourceKey}`);
    }

    const compressed = new Uint8Array(await object.arrayBuffer());
    const payloadText = strFromU8(gunzipSync(compressed));
    return JSON.parse(payloadText) as GeoipSnapshotPayload;
  })();

  geoipSnapshotCache.set(cacheKey, pending);
  pruneMap(geoipSnapshotCache, SNAPSHOT_CACHE_LIMIT);
  return pending.catch((error) => {
    geoipSnapshotCache.delete(cacheKey);
    throw error;
  });
}

async function ensureLatestState(env: WorkerEnv): Promise<LatestState | null> {
  return readJson<LatestState>(env.GEOSITE_BUCKET, LATEST_STATE_KEY);
}

async function maybeEnrichIndexFilters(
  env: WorkerEnv,
  latest: LatestState,
  listName: string,
  filters: string[],
): Promise<void> {
  if (filters.length === 0) {
    return;
  }

  const normalizedFilters = [...new Set(filters)].sort();
  const index = await readJson<GeositeIndex>(
    env.GEOSITE_BUCKET,
    latest.snapshot.indexKey,
  );
  if (!index) {
    return;
  }

  const lookupName = listName.toLowerCase();
  const current = index[lookupName];
  if (!current) {
    return;
  }

  if (isSameStringArray(current.filters, normalizedFilters)) {
    return;
  }

  const nextIndex: GeositeIndex = {
    ...index,
    [lookupName]: {
      ...current,
      filters: normalizedFilters,
    },
  };

  await writeJson(env.GEOSITE_BUCKET, latest.snapshot.indexKey, nextIndex);
}

function buildIndexFromSources(sources: Record<string, string>): GeositeIndex {
  const names = Object.keys(sources).sort();
  const index: GeositeIndex = {};

  for (const listName of names) {
    index[listName] = {
      name: listName.toUpperCase(),
      sourceFile: listName,
      filters: [],
      path: `rules/${listName}.yaml`,
    };
  }

  return index;
}

function buildGeoipIndexFromSources(
  sources: Record<string, GeoipListPayload>,
): GeoipIndex {
  const names = Object.keys(sources).sort();
  const index: GeoipIndex = {};

  for (const listName of names) {
    const current = sources[listName];
    if (!current) {
      continue;
    }

    index[listName] = {
      name: listName.toUpperCase(),
      sourceFile: listName,
      ipv4Count: current.ipv4Cidrs.length,
      ipv6Count: current.ipv6Cidrs.length,
      defaultPath: `geoip/${listName}.yaml`,
      noResolvePath: `geoip/${listName}.yaml?no_resolve=true`,
    };
  }

  return index;
}

function emitGeoipRuleset(list: GeoipListPayload): string {
  const lines: string[] = [];

  if (list.ipv4Cidrs.length > 0) {
    lines.push("ip_cidr_set:");
    for (const cidr of list.ipv4Cidrs) {
      lines.push(`  - ${JSON.stringify(cidr)}`);
    }
  }

  if (list.ipv6Cidrs.length > 0) {
    lines.push("ip_cidr6_set:");
    for (const cidr of list.ipv6Cidrs) {
      lines.push(`  - ${JSON.stringify(cidr)}`);
    }
  }

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function withNoResolveLine(content: string): string {
  return `no_resolve: true\n${content}`;
}

function collectFilters(entries: DomainRule[]): string[] {
  const attrs = new Set<string>();

  for (const entry of entries) {
    for (const attr of entry.attrs) {
      attrs.add(attr);
    }
  }

  return Array.from(attrs).sort();
}

function extractSourcesFromZip(zipData: Uint8Array): {
  geositeSources: Record<string, string>;
  geoipDat: Uint8Array | null;
} {
  const files = unzipSync(zipData);
  const geositeSources = extractSourcesFromGeositeDat(files);
  if (geositeSources === null) {
    throw new Error("no geosite.dat found in upstream zip");
  }

  const geoipDat = extractGeoipDatFile(files);

  return {
    geositeSources,
    geoipDat,
  };
}

function extractGeoipDatFile(
  files: Record<string, Uint8Array>,
): Uint8Array | null {
  for (const [filePath, content] of Object.entries(files)) {
    if (/\/geoip\.dat$/i.test(filePath)) {
      return content;
    }
  }

  return null;
}

interface GeositeDatDomain {
  type: number;
  value: string;
  attrs: string[];
}

interface GeositeDatEntry {
  countryCode: string;
  domains: GeositeDatDomain[];
}

interface GeoipDatCidr {
  ip: Uint8Array;
  prefix: number;
}

interface GeoipDatEntry {
  countryCode: string;
  cidrs: GeoipDatCidr[];
  reverseMatch: boolean;
}

interface ProtoReader {
  input: Uint8Array;
  offset: number;
}

function extractSourcesFromGeositeDat(
  files: Record<string, Uint8Array>,
): Record<string, string> | null {
  for (const [filePath, content] of Object.entries(files)) {
    if (!/\/geosite\.dat$/i.test(filePath)) {
      continue;
    }

    const parsed = parseGeositeDat(content);
    if (parsed.length === 0) {
      throw new Error("geosite.dat is empty");
    }

    const lineMap = new Map<string, string[]>();
    for (const entry of parsed) {
      const listName = entry.countryCode.trim().toLowerCase();
      if (!VALID_LIST_NAME.test(listName)) {
        continue;
      }

      const lines = lineMap.get(listName) ?? [];
      for (const domain of entry.domains) {
        const line = toGeositeSourceLine(domain);
        if (!line) {
          continue;
        }
        lines.push(line);
      }
      lineMap.set(listName, lines);
    }

    if (lineMap.size === 0) {
      throw new Error("geosite.dat contains no valid list names");
    }

    const sources: Record<string, string> = {};
    for (const [listName, lines] of lineMap.entries()) {
      sources[listName] = lines.join("\n");
    }
    return sources;
  }

  return null;
}

function parseGeositeDat(input: Uint8Array): GeositeDatEntry[] {
  const reader: ProtoReader = { input, offset: 0 };
  const entries: GeositeDatEntry[] = [];

  while (!protoEof(reader)) {
    const tag = readVarint(reader);
    const field = tag >>> 3;
    const wireType = tag & 0x07;

    if (field === 1 && wireType === 2) {
      entries.push(parseGeositeDatEntry(readLengthDelimited(reader)));
      continue;
    }

    skipField(reader, wireType);
  }

  return entries;
}

function parseGeositeDatEntry(input: Uint8Array): GeositeDatEntry {
  const reader: ProtoReader = { input, offset: 0 };
  let countryCode = "";
  const domains: GeositeDatDomain[] = [];

  while (!protoEof(reader)) {
    const tag = readVarint(reader);
    const field = tag >>> 3;
    const wireType = tag & 0x07;

    if (field === 1 && wireType === 2) {
      countryCode = strFromU8(readLengthDelimited(reader));
      continue;
    }

    if (field === 2 && wireType === 2) {
      domains.push(parseGeositeDatDomain(readLengthDelimited(reader)));
      continue;
    }

    skipField(reader, wireType);
  }

  return {
    countryCode,
    domains,
  };
}

function parseGeositeDatDomain(input: Uint8Array): GeositeDatDomain {
  const reader: ProtoReader = { input, offset: 0 };
  let type = 0;
  let value = "";
  const attrs: string[] = [];

  while (!protoEof(reader)) {
    const tag = readVarint(reader);
    const field = tag >>> 3;
    const wireType = tag & 0x07;

    if (field === 1 && wireType === 0) {
      type = readVarint(reader);
      continue;
    }

    if (field === 2 && wireType === 2) {
      value = strFromU8(readLengthDelimited(reader));
      continue;
    }

    if (field === 3 && wireType === 2) {
      const key = parseGeositeDatAttribute(readLengthDelimited(reader));
      if (key) {
        attrs.push(key);
      }
      continue;
    }

    skipField(reader, wireType);
  }

  return {
    type,
    value,
    attrs,
  };
}

function parseGeositeDatAttribute(input: Uint8Array): string | null {
  const reader: ProtoReader = { input, offset: 0 };

  while (!protoEof(reader)) {
    const tag = readVarint(reader);
    const field = tag >>> 3;
    const wireType = tag & 0x07;

    if (field === 1 && wireType === 2) {
      return strFromU8(readLengthDelimited(reader));
    }

    skipField(reader, wireType);
  }

  return null;
}

function toGeositeSourceLine(domain: GeositeDatDomain): string | null {
  const value = domain.value.trim();
  if (!value) {
    return null;
  }

  let prefix: string;
  if (domain.type === 0) {
    prefix = `keyword:${value}`;
  } else if (domain.type === 2) {
    prefix = `domain:${value}`;
  } else if (domain.type === 1) {
    prefix = `regexp:${value}`;
  } else if (domain.type === 3) {
    prefix = `full:${value}`;
  } else {
    return null;
  }

  const attrs = Array.from(
    new Set(
      domain.attrs
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0 && VALID_ATTR_NAME.test(item)),
    ),
  );
  if (attrs.length === 0) {
    return prefix;
  }

  return `${prefix} ${attrs.map((attr) => `@${attr}`).join(" ")}`;
}

function extractSourcesFromGeoipDatBytes(
  content: Uint8Array,
): Record<string, GeoipListPayload> {
  const reader: ProtoReader = { input: content, offset: 0 };
  const grouped = new Map<
    string,
    {
      ipv4: Set<string>;
      ipv6: Set<string>;
      reverseMatch: boolean;
    }
  >();

  while (!protoEof(reader)) {
    const tag = readVarint(reader);
    const field = tag >>> 3;
    const wireType = tag & 0x07;

    if (field === 1 && wireType === 2) {
      const entry = parseGeoipDatEntry(readLengthDelimited(reader));
      const listName = entry.countryCode.trim().toLowerCase();
      if (!VALID_LIST_NAME.test(listName)) {
        continue;
      }

      const current = grouped.get(listName) ?? {
        ipv4: new Set<string>(),
        ipv6: new Set<string>(),
        reverseMatch: false,
      };

      for (const cidr of entry.cidrs) {
        const normalized = toGeoipCidrString(cidr);
        if (!normalized) {
          continue;
        }

        if (normalized.family === "ipv4") {
          current.ipv4.add(normalized.cidr);
        } else {
          current.ipv6.add(normalized.cidr);
        }
      }

      current.reverseMatch = current.reverseMatch || entry.reverseMatch;
      grouped.set(listName, current);
      continue;
    }

    skipField(reader, wireType);
  }

  if (grouped.size === 0) {
    throw new Error("geoip.dat contains no valid list names");
  }

  const sources: Record<string, GeoipListPayload> = {};
  for (const [listName, item] of grouped.entries()) {
    sources[listName] = {
      ipv4Cidrs: Array.from(item.ipv4),
      ipv6Cidrs: Array.from(item.ipv6),
      reverseMatch: item.reverseMatch,
    };
  }

  return sources;
}

function parseGeoipDatEntry(input: Uint8Array): GeoipDatEntry {
  const reader: ProtoReader = { input, offset: 0 };
  let countryCode = "";
  const cidrs: GeoipDatCidr[] = [];
  let reverseMatch = false;

  while (!protoEof(reader)) {
    const tag = readVarint(reader);
    const field = tag >>> 3;
    const wireType = tag & 0x07;

    if (field === 1 && wireType === 2) {
      countryCode = strFromU8(readLengthDelimited(reader));
      continue;
    }

    if (field === 2 && wireType === 2) {
      cidrs.push(parseGeoipDatCidr(readLengthDelimited(reader)));
      continue;
    }

    if (field === 3 && wireType === 0) {
      reverseMatch = readVarint(reader) !== 0;
      continue;
    }

    skipField(reader, wireType);
  }

  return {
    countryCode,
    cidrs,
    reverseMatch,
  };
}

function parseGeoipDatCidr(input: Uint8Array): GeoipDatCidr {
  const reader: ProtoReader = { input, offset: 0 };
  let ip = new Uint8Array();
  let prefix = 0;

  while (!protoEof(reader)) {
    const tag = readVarint(reader);
    const field = tag >>> 3;
    const wireType = tag & 0x07;

    if (field === 1 && wireType === 2) {
      ip = Uint8Array.from(readLengthDelimited(reader));
      continue;
    }

    if (field === 2 && wireType === 0) {
      prefix = readVarint(reader);
      continue;
    }

    skipField(reader, wireType);
  }

  return {
    ip,
    prefix,
  };
}

function toGeoipCidrString(
  cidr: GeoipDatCidr,
): { family: "ipv4" | "ipv6"; cidr: string } | null {
  if (cidr.ip.length === 4) {
    if (!isValidCidrPrefix(cidr.prefix, 32)) {
      return null;
    }

    return {
      family: "ipv4",
      cidr: `${toIpv4String(cidr.ip)}/${cidr.prefix}`,
    };
  }

  if (cidr.ip.length === 16) {
    if (!isValidCidrPrefix(cidr.prefix, 128)) {
      return null;
    }

    return {
      family: "ipv6",
      cidr: `${toIpv6String(cidr.ip)}/${cidr.prefix}`,
    };
  }

  return null;
}

function isValidCidrPrefix(prefix: number, max: number): boolean {
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= max;
}

function toIpv4String(ip: Uint8Array): string {
  return Array.from(ip).join(".");
}

function toIpv6String(ip: Uint8Array): string {
  const parts: string[] = [];
  for (let index = 0; index < 16; index += 2) {
    const value = ((ip[index] ?? 0) << 8) | (ip[index + 1] ?? 0);
    parts.push(value.toString(16));
  }

  return parts.join(":");
}

function protoEof(reader: ProtoReader): boolean {
  return reader.offset >= reader.input.length;
}

function readVarint(reader: ProtoReader): number {
  let shift = 0;
  let value = 0;

  for (let index = 0; index < 10; index += 1) {
    if (reader.offset >= reader.input.length) {
      throw new Error("unexpected EOF while reading varint");
    }

    const byte = reader.input[reader.offset] ?? 0;
    reader.offset += 1;
    value += (byte & 0x7f) * 2 ** shift;

    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) {
        throw new Error("varint exceeds safe integer range");
      }
      return value;
    }

    shift += 7;
  }

  throw new Error("varint is too long");
}

function readLengthDelimited(reader: ProtoReader): Uint8Array {
  const length = readVarint(reader);
  if (length < 0) {
    throw new Error("negative length-delimited size");
  }

  const end = reader.offset + length;
  if (end > reader.input.length) {
    throw new Error("length-delimited field exceeds input size");
  }

  const view = reader.input.subarray(reader.offset, end);
  reader.offset = end;
  return view;
}

function skipField(reader: ProtoReader, wireType: number): void {
  if (wireType === 0) {
    void readVarint(reader);
    return;
  }

  if (wireType === 1) {
    const end = reader.offset + 8;
    if (end > reader.input.length) {
      throw new Error("fixed64 field exceeds input size");
    }
    reader.offset = end;
    return;
  }

  if (wireType === 2) {
    void readLengthDelimited(reader);
    return;
  }

  if (wireType === 5) {
    const end = reader.offset + 4;
    if (end > reader.input.length) {
      throw new Error("fixed32 field exceeds input size");
    }
    reader.offset = end;
    return;
  }

  throw new Error(`unsupported wire type: ${wireType}`);
}

function normalizeEtag(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  return (
    raw.replace(/^W\//, "").replace(/^"/, "").replace(/"$/, "").trim() || null
  );
}

async function sha256Hex(input: Uint8Array): Promise<string> {
  const copied = Uint8Array.from(input);
  const digest = await crypto.subtle.digest("SHA-256", copied.buffer);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function artifactName(name: string, filter: string | null): string {
  return filter ? `${name}@${filter}` : name;
}

function artifactKey(
  etag: string,
  name: string,
  filter: string | null,
): string {
  return `artifacts/${etag}/${artifactName(name, filter)}.yaml`;
}

function geoipArtifactKey(etag: string, name: string): string {
  return `artifacts/${etag}/geoip/${name.toLowerCase()}.yaml`;
}

function snapshotSourceKey(etag: string): string {
  return `snapshots/${etag}/sources.json.gz`;
}

function geoipSnapshotSourceKey(etag: string): string {
  return `snapshots/${etag}/geoip/sources.json.gz`;
}

function geoipPendingSourceKey(etag: string): string {
  return `snapshots/${etag}/geoip/raw.dat`;
}

function snapshotIndexKey(etag: string): string {
  return `snapshots/${etag}/index/geosite.json`;
}

function geoipSnapshotIndexKey(etag: string): string {
  return `snapshots/${etag}/index/geoip.json`;
}

function isLegacyModeSegment(input: string): boolean {
  return input === "strict" || input === "balanced" || input === "full";
}

function isValidListName(input: string): boolean {
  return VALID_LIST_NAME.test(input);
}

function isValidAttr(input: string): boolean {
  return VALID_ATTR_NAME.test(input);
}

function parseBooleanQueryFlag(url: URL, key: string): boolean {
  const raw = url.searchParams.get(key);
  if (!raw) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function readText(
  bucket: R2BucketLike,
  key: string,
): Promise<string | null> {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  return object.text();
}

async function readJson<T>(
  bucket: R2BucketLike,
  key: string,
): Promise<T | null> {
  const content = await readText(bucket, key);
  if (content === null) {
    return null;
  }
  return JSON.parse(content) as T;
}

async function writeText(
  bucket: R2BucketLike,
  key: string,
  content: string,
  options: { contentType?: string; cacheControl?: string } = {},
): Promise<void> {
  const metadata: NonNullable<R2PutOptionsLike["httpMetadata"]> = {
    contentType: options.contentType ?? "text/plain; charset=utf-8",
  };
  if (options.cacheControl) {
    metadata.cacheControl = options.cacheControl;
  }

  await bucket.put(key, content, {
    httpMetadata: metadata,
  });
}

async function writeJson(
  bucket: R2BucketLike,
  key: string,
  value: unknown,
): Promise<void> {
  await bucket.put(key, `${JSON.stringify(value)}\n`, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
    },
  });
}

async function writeBinary(
  bucket: R2BucketLike,
  key: string,
  value: Uint8Array,
  options: { contentType: string; cacheControl?: string },
): Promise<void> {
  const metadata: NonNullable<R2PutOptionsLike["httpMetadata"]> = {
    contentType: options.contentType,
  };
  if (options.cacheControl) {
    metadata.cacheControl = options.cacheControl;
  }

  await bucket.put(key, value, {
    httpMetadata: metadata,
  });
}

function resolveFetchImpl(input?: typeof fetch): typeof fetch {
  if (input) {
    return input;
  }

  return (request: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    fetch(request, init);
}

function pruneMap<T>(map: Map<string, T>, keep: number): void {
  while (map.size > keep) {
    const first = map.keys().next();
    if (first.done) {
      return;
    }
    map.delete(first.value);
  }
}

function isSameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function text(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers,
  });
}

const worker = createWorker();

export default {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<Response> {
    return worker.fetch(request, env, ctx);
  },

  scheduled(
    event: ScheduledEventLike,
    env: WorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<void> {
    return worker.scheduled(event, env, ctx);
  },
};
