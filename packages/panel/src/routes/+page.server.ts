import type { ServerLoad } from "@sveltejs/kit";
import {
  buildGeoipPublicPath,
  buildRulesPublicPath,
  buildSurgeGeoipPublicPath,
  buildSurgeRulesPublicPath,
} from "$lib/panel/api";
import { SSR_INITIAL_LIST_LIMIT } from "$lib/panel/constants";
import { t } from "$lib/panel/i18n";
import { getPanelLocale } from "$lib/panel/locale";
import {
  countRuleLines,
  countRuleMatchTypes,
  countSurgeRuleLines,
  countSurgeRuleMatchTypes,
  normalizeEtag,
} from "$lib/panel/utils";

import type {
  GeoipIndex,
  GeositeIndex,
  PanelPlatform,
  RuleMatchCounts,
  SurgeRuleMatchCounts,
} from "$lib/panel/types";

import { isSurgeHost } from "$lib/server/geosite-upstream";

const RULES_CACHE_LIMIT = 64;
const INDEX_REVALIDATE_INTERVAL_MS = 20_000;

type IndexCacheEntry = {
  fullIndex: GeositeIndex;
  names: string[];
  upstreamEtag: string;
};

type RulesCacheEntry = {
  text: string;
  etag: string;
  stale: boolean;
  ruleLines: string;
  ruleTypeCounts: RuleMatchCounts | null;
};

type GeoipIndexCacheEntry = {
  fullIndex: GeoipIndex;
  names: string[];
  upstreamEtag: string;
};

type GeoipRulesCacheEntry = {
  text: string;
  etag: string;
  stale: boolean;
  ruleLines: string;
};

let indexCache: IndexCacheEntry | null = null;
let indexRevalidateInFlight = false;
let nextIndexRevalidateAt = 0;
const rulesCache = new Map<string, RulesCacheEntry>();
let geoipIndexCache: GeoipIndexCacheEntry | null = null;
let geoipIndexRevalidateInFlight = false;
let nextGeoipIndexRevalidateAt = 0;
const geoipRulesCache = new Map<string, GeoipRulesCacheEntry>();

function pruneRulesCache(): void {
  while (rulesCache.size > RULES_CACHE_LIMIT) {
    const firstKey = rulesCache.keys().next();
    if (firstKey.done) {
      return;
    }
    rulesCache.delete(firstKey.value);
  }
}

function getUpstreamEtagRaw(headers: Headers): string {
  return headers.get("x-upstream-etag") ?? headers.get("etag") ?? "-";
}

function pruneGeoipRulesCache(): void {
  while (geoipRulesCache.size > RULES_CACHE_LIMIT) {
    const firstKey = geoipRulesCache.keys().next();
    if (firstKey.done) {
      return;
    }
    geoipRulesCache.delete(firstKey.value);
  }
}

async function fetchIndexFresh(
  fetchFn: typeof fetch,
): Promise<IndexCacheEntry> {
  const response = await fetchFn("/geosite", {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const fullIndex = (await response.json()) as GeositeIndex;
  const names = Object.keys(fullIndex).sort();
  const upstreamEtag = getUpstreamEtagRaw(response.headers);

  const next: IndexCacheEntry = {
    fullIndex,
    names,
    upstreamEtag,
  };
  indexCache = next;
  return next;
}

async function maybeRevalidateIndex(fetchFn: typeof fetch): Promise<void> {
  if (!indexCache || indexRevalidateInFlight) {
    return;
  }
  if (Date.now() < nextIndexRevalidateAt) {
    return;
  }

  indexRevalidateInFlight = true;
  nextIndexRevalidateAt = Date.now() + INDEX_REVALIDATE_INTERVAL_MS;

  try {
    const response = await fetchFn("/geosite", {
      headers: {
        accept: "application/json",
        "if-none-match": indexCache.upstreamEtag,
      },
    });
    if (response.status === 304) {
      return;
    }
    if (!response.ok) {
      return;
    }

    const fullIndex = (await response.json()) as GeositeIndex;
    indexCache = {
      fullIndex,
      names: Object.keys(fullIndex).sort(),
      upstreamEtag: getUpstreamEtagRaw(response.headers),
    };
  } catch {
  } finally {
    indexRevalidateInFlight = false;
  }
}

async function fetchGeoipIndexFresh(
  fetchFn: typeof fetch,
): Promise<GeoipIndexCacheEntry> {
  const response = await fetchFn("/geoip", {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const fullIndex = (await response.json()) as GeoipIndex;
  const names = Object.keys(fullIndex).sort();
  const upstreamEtag = getUpstreamEtagRaw(response.headers);

  const next: GeoipIndexCacheEntry = {
    fullIndex,
    names,
    upstreamEtag,
  };
  geoipIndexCache = next;
  return next;
}

async function maybeRevalidateGeoipIndex(fetchFn: typeof fetch): Promise<void> {
  if (!geoipIndexCache || geoipIndexRevalidateInFlight) {
    return;
  }
  if (Date.now() < nextGeoipIndexRevalidateAt) {
    return;
  }

  geoipIndexRevalidateInFlight = true;
  nextGeoipIndexRevalidateAt = Date.now() + INDEX_REVALIDATE_INTERVAL_MS;

  try {
    const response = await fetchFn("/geoip", {
      headers: {
        accept: "application/json",
        "if-none-match": geoipIndexCache.upstreamEtag,
      },
    });
    if (response.status === 304) {
      return;
    }
    if (!response.ok) {
      return;
    }

    const fullIndex = (await response.json()) as GeoipIndex;
    geoipIndexCache = {
      fullIndex,
      names: Object.keys(fullIndex).sort(),
      upstreamEtag: getUpstreamEtagRaw(response.headers),
    };
  } catch {
  } finally {
    geoipIndexRevalidateInFlight = false;
  }
}

export const load: ServerLoad = async ({ cookies, fetch, url }) => {
  const locale = getPanelLocale(cookies);
  const platform: PanelPlatform = isSurgeHost(url.hostname) ? "surge" : "egern";
  const tr = (key: string, vars: Record<string, string | number> = {}) =>
    t(locale, key, vars);

  let index: GeositeIndex = {};
  let names: string[] = [];
  let selected: string | null = null;
  let previewText = tr("selectDataset");
  let etag = "-";
  let stale = "-";
  let ruleLines = "-";
  let ruleTypeCounts: RuleMatchCounts | null = null;
  let surgeRuleTypeCounts: SurgeRuleMatchCounts | null = null;
  let rawLink = "#";
  let initError: string | null = null;
  let geoipIndex: GeoipIndex = {};
  let geoipNames: string[] = [];
  let geoipSelected: string | null = null;
  let geoipPreviewText = tr("geoipSelectDataset");
  let geoipEtag = "-";
  let geoipStale = "-";
  let geoipRuleLines = "-";
  let geoipRawLink = "#";
  let geoipInitError: string | null = null;

  try {
    let currentIndex = indexCache;
    if (!currentIndex) {
      currentIndex = await fetchIndexFresh(fetch);
    } else {
      void maybeRevalidateIndex(fetch);
    }

    names = currentIndex.names;
    const fullIndex = currentIndex.fullIndex;

    if (names.length === 0) {
      previewText = tr("indexEmpty");
    } else {
      selected = names[0];
      const initialIndex: GeositeIndex = {};
      for (const name of names.slice(0, SSR_INITIAL_LIST_LIMIT)) {
        const entry = fullIndex[name];
        if (entry) {
          initialIndex[name] = entry;
        }
      }
      const selectedEntry = fullIndex[selected];
      if (selectedEntry) {
        initialIndex[selected] = selectedEntry;
      }
      index = initialIndex;

      rawLink =
        platform === "surge"
          ? buildSurgeRulesPublicPath(selected, null, "skip")
          : buildRulesPublicPath(selected, null);
      const rulesKey = `${currentIndex.upstreamEtag}:${selected}`;
      const cachedRules = rulesCache.get(rulesKey);

      if (cachedRules) {
        previewText =
          cachedRules.text.length === 0 ? tr("emptyResult") : cachedRules.text;
        etag = cachedRules.etag;
        stale = cachedRules.stale ? tr("yes") : tr("no");
        ruleLines = cachedRules.ruleLines;
        ruleTypeCounts = cachedRules.ruleTypeCounts;
      } else {
        const rulesResponse = await fetch(
          `/geosite/${encodeURIComponent(selected)}`,
          {
            headers: {
              accept: "application/yaml, text/plain;q=0.8, */*;q=0.1",
            },
          },
        );
        const rulesText = await rulesResponse.text();

        const upstreamEtag =
          rulesResponse.headers.get("x-upstream-etag") ??
          currentIndex.upstreamEtag;
        etag = normalizeEtag(upstreamEtag);
        stale =
          rulesResponse.headers.get("x-stale") === "1" ? tr("yes") : tr("no");
        if (!rulesResponse.ok) {
          previewText =
            `${rulesResponse.status} ${rulesResponse.statusText}\n${rulesText}`.trim();
        } else {
          previewText = rulesText.length === 0 ? tr("emptyResult") : rulesText;
          if (platform === "surge") {
            ruleLines = String(countSurgeRuleLines(rulesText));
            surgeRuleTypeCounts = countSurgeRuleMatchTypes(rulesText);
          } else {
            ruleLines = String(countRuleLines(rulesText));
            ruleTypeCounts = countRuleMatchTypes(rulesText);
          }
          rulesCache.set(rulesKey, {
            text: rulesText,
            etag: normalizeEtag(upstreamEtag),
            stale: rulesResponse.headers.get("x-stale") === "1",
            ruleLines,
            ruleTypeCounts,
          });
          pruneRulesCache();
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    previewText = tr("failedLoad", { message });
    initError = message;
  }

  try {
    let currentGeoipIndex = geoipIndexCache;
    if (!currentGeoipIndex) {
      currentGeoipIndex = await fetchGeoipIndexFresh(fetch);
    } else {
      void maybeRevalidateGeoipIndex(fetch);
    }

    geoipNames = currentGeoipIndex.names;
    geoipIndex = currentGeoipIndex.fullIndex;

    if (geoipNames.length === 0) {
      geoipPreviewText = tr("geoipIndexEmpty");
    } else {
      geoipSelected = geoipNames[0] ?? null;

      if (geoipSelected) {
        geoipRawLink =
          platform === "surge"
            ? buildSurgeGeoipPublicPath(geoipSelected, false)
            : buildGeoipPublicPath(geoipSelected, false);
        const geoipRulesKey = `${currentGeoipIndex.upstreamEtag}:${geoipSelected}:nr0`;
        const cachedGeoipRules = geoipRulesCache.get(geoipRulesKey);

        if (cachedGeoipRules) {
          geoipPreviewText =
            cachedGeoipRules.text.length === 0
              ? tr("emptyResult")
              : cachedGeoipRules.text;
          geoipEtag = cachedGeoipRules.etag;
          geoipStale = cachedGeoipRules.stale ? tr("yes") : tr("no");
          geoipRuleLines = cachedGeoipRules.ruleLines;
        } else {
          const geoipRulesResponse = await fetch(
            `/geoip/${encodeURIComponent(geoipSelected)}`,
            {
              headers: {
                accept: "application/yaml, text/plain;q=0.8, */*;q=0.1",
              },
            },
          );
          const geoipRulesText = await geoipRulesResponse.text();

          const upstreamEtag =
            geoipRulesResponse.headers.get("x-upstream-etag") ??
            currentGeoipIndex.upstreamEtag;
          geoipEtag = normalizeEtag(upstreamEtag);
          geoipStale =
            geoipRulesResponse.headers.get("x-stale") === "1"
              ? tr("yes")
              : tr("no");

          if (!geoipRulesResponse.ok) {
            geoipPreviewText =
              `${geoipRulesResponse.status} ${geoipRulesResponse.statusText}\n${geoipRulesText}`.trim();
          } else {
            geoipPreviewText =
              geoipRulesText.length === 0 ? tr("emptyResult") : geoipRulesText;
            geoipRuleLines = String(countRuleLines(geoipRulesText));
            geoipRulesCache.set(geoipRulesKey, {
              text: geoipRulesText,
              etag: normalizeEtag(upstreamEtag),
              stale: geoipRulesResponse.headers.get("x-stale") === "1",
              ruleLines: geoipRuleLines,
            });
            pruneGeoipRulesCache();
          }
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    geoipPreviewText = tr("geoipFailedLoad", { message });
    geoipInitError = message;
  }

  return {
    locale,
    platform,
    index,
    names,
    selected,
    previewText,
    etag,
    stale,
    ruleLines,
    ruleTypeCounts,
    surgeRuleTypeCounts,
    rawLink,
    initError,
    geoipData: {
      locale,
      platform,
      index: geoipIndex,
      names: geoipNames,
      selected: geoipSelected,
      noResolve: false,
      previewText: geoipPreviewText,
      etag: geoipEtag,
      stale: geoipStale,
      ruleLines: geoipRuleLines,
      rawLink: geoipRawLink,
      initError: geoipInitError,
    },
  };
};
