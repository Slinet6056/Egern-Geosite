import { buildGeoipPublicPath } from "$lib/panel/api";
import { t } from "$lib/panel/i18n";
import { countRuleLines, normalizeEtag } from "$lib/panel/utils";
import type { ServerLoad } from "@sveltejs/kit";

import type { GeoipIndex, PanelLocale } from "$lib/panel/types";

const RULES_CACHE_LIMIT = 64;
const INDEX_REVALIDATE_INTERVAL_MS = 20_000;

type IndexCacheEntry = {
  fullIndex: GeoipIndex;
  names: string[];
  upstreamEtag: string;
};

type RulesCacheEntry = {
  text: string;
  etag: string;
  stale: boolean;
  ruleLines: string;
};

let indexCache: IndexCacheEntry | null = null;
let indexRevalidateInFlight = false;
let nextIndexRevalidateAt = 0;
const rulesCache = new Map<string, RulesCacheEntry>();

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

async function fetchIndexFresh(
  fetchFn: typeof fetch,
): Promise<IndexCacheEntry> {
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
    const response = await fetchFn("/geoip", {
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

    const fullIndex = (await response.json()) as GeoipIndex;
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

export const load: ServerLoad = async ({ params, fetch }) => {
  const locale = params.lang as PanelLocale;
  const tr = (key: string, vars: Record<string, string | number> = {}) =>
    t(locale, key, vars);

  let index: GeoipIndex = {};
  let names: string[] = [];
  let selected: string | null = null;
  let previewText = tr("geoipSelectDataset");
  let etag = "-";
  let stale = "-";
  let ruleLines = "-";
  let rawLink = "#";
  let initError: string | null = null;

  try {
    let currentIndex = indexCache;
    if (!currentIndex) {
      currentIndex = await fetchIndexFresh(fetch);
    } else {
      void maybeRevalidateIndex(fetch);
    }

    names = currentIndex.names;
    index = currentIndex.fullIndex;

    if (names.length === 0) {
      previewText = tr("geoipIndexEmpty");
    } else {
      selected = names[0] ?? null;

      if (selected) {
        rawLink = buildGeoipPublicPath(selected, false);
        const rulesKey = `${currentIndex.upstreamEtag}:${selected}:nr0`;
        const cachedRules = rulesCache.get(rulesKey);

        if (cachedRules) {
          previewText =
            cachedRules.text.length === 0
              ? tr("emptyResult")
              : cachedRules.text;
          etag = cachedRules.etag;
          stale = cachedRules.stale ? tr("yes") : tr("no");
          ruleLines = cachedRules.ruleLines;
        } else {
          const rulesResponse = await fetch(
            `/geoip/${encodeURIComponent(selected)}`,
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
            previewText =
              rulesText.length === 0 ? tr("emptyResult") : rulesText;
            ruleLines = String(countRuleLines(rulesText));
            rulesCache.set(rulesKey, {
              text: rulesText,
              etag: normalizeEtag(upstreamEtag),
              stale: rulesResponse.headers.get("x-stale") === "1",
              ruleLines,
            });
            pruneRulesCache();
          }
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    previewText = tr("geoipFailedLoad", { message });
    initError = message;
  }

  return {
    locale,
    index,
    names,
    selected,
    noResolve: false,
    previewText,
    etag,
    stale,
    ruleLines,
    rawLink,
    initError,
  };
};
