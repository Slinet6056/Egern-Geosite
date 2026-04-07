<svelte:options runes={false} />

<script lang="ts">
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { Check, Copy, ExternalLink, Moon, Sun } from "@lucide/svelte";

  import {
    buildRulesApiPath,
    buildRulesPublicPath,
    buildSurgeRulesApiPath,
    buildSurgeRulesPublicPath,
  } from "$lib/panel/api";
  import type { GeoipPanelData } from "$lib/panel/geoip-panel";
  import { SSR_INITIAL_LIST_LIMIT } from "$lib/panel/constants";
  import GeoipPanel from "$lib/panel/geoip-panel.svelte";
  import { t } from "$lib/panel/i18n";
  import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME } from "$lib/panel/locale";
  import type {
    GeositeIndex,
    PanelLocale,
    PanelPlatform,
    RuleMatchCounts,
    SurgeRegexMode,
    SurgeRuleMatchCounts,
  } from "$lib/panel/types";
  import {
    countRuleLines,
    countRuleMatchTypes,
    countSurgeRuleLines,
    countSurgeRuleMatchTypes,
    normalizeEtag,
  } from "$lib/panel/utils";

  import {
    Alert,
    AlertDescription,
    AlertTitle,
  } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Separator } from "$lib/components/ui/separator";
  import { Skeleton } from "$lib/components/ui/skeleton";

  const NONE_FILTER = "__none__";
  const THEME_STORAGE_KEY = "egern-panel-theme";
  const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

  const SURGE_REGEX_MODES = [
    { key: "skip" as SurgeRegexMode, labelKey: "regexModeSkip" },
    { key: "standard" as SurgeRegexMode, labelKey: "regexModeStandard" },
    { key: "aggressive" as SurgeRegexMode, labelKey: "regexModeAggressive" },
  ] as const;

  type ThemePreference = "system" | "light" | "dark";

  interface GeositePageData {
    locale: PanelLocale;
    platform: PanelPlatform;
    index: GeositeIndex;
    names: string[];
    selected: string | null;
    previewText: string;
    etag: string;
    stale: string;
    ruleLines: string;
    ruleTypeCounts: RuleMatchCounts | null;
    surgeRuleTypeCounts: SurgeRuleMatchCounts | null;
    rawLink: string;
    initError: string | null;
    geoipData: GeoipPanelData;
  }

  type DashboardView = "geosite" | "geoip";

  export let data: GeositePageData;

  let locale: PanelLocale;
  let platform: PanelPlatform;
  let index: GeositeIndex;
  let names: string[];
  let selected: string | null;
  let search: string;
  let selectedFilter: string;
  let manualFilter: string;
  let debouncedManualFilter: string;
  let listCount: string;
  let previewText: string;
  let etag: string;
  let stale: string;
  let ruleLines: string;
  let ruleTypeCounts: RuleMatchCounts | null;
  let surgeRuleTypeCounts: SurgeRuleMatchCounts | null;
  let rawLink: string;
  let isIndexLoading: boolean;
  let isRulesLoading: boolean;
  let initError: string | null;
  let isIndexHydrating: boolean;
  let surgeRegexMode: SurgeRegexMode = "standard";

  let loadToken = 0;
  let lastQueryKey = "";
  let manualDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedLinkKey: string | null = null;
  let copiedQuickLinkTimer: ReturnType<typeof setTimeout> | null = null;
  let themePreference: ThemePreference = "system";
  let resolvedTheme: "light" | "dark" = "light";
  let canPersistTheme = true;
  let themeModeLabel = "";
  let themeToggleAriaLabel = "";
  let activeView: DashboardView = "geosite";

  let tr: (key: string, vars?: Record<string, string | number>) => string = (
    key,
    vars = {},
  ) => t(locale, key, vars);
  $: tr = (key, vars = {}) => t(locale, key, vars);
  $: themeModeLabel =
    themePreference === "dark"
      ? tr("themeDark")
      : themePreference === "light"
        ? tr("themeLight")
        : tr("themeSystem");
  $: themeToggleAriaLabel = tr("themeToggleAria", { mode: themeModeLabel });

  function applyServerData(next: GeositePageData) {
    const nextLocale = next.locale as PanelLocale;
    locale = nextLocale;
    platform = next.platform ?? "egern";
    index = next.index ?? {};
    names = next.names ?? [];
    selected = next.selected ?? null;
    search = "";
    selectedFilter = NONE_FILTER;
    manualFilter = "";
    debouncedManualFilter = "";
    listCount = next.initError
      ? t(nextLocale, "error")
      : t(nextLocale, "listsCount", { count: names.length });
    previewText = next.previewText ?? t(nextLocale, "selectDataset");
    etag = next.etag ?? "-";
    stale = next.stale ?? "-";
    ruleLines = next.ruleLines ?? "-";
    ruleTypeCounts = next.ruleTypeCounts ?? null;
    surgeRuleTypeCounts = next.surgeRuleTypeCounts ?? null;
    rawLink = next.rawLink ?? "#";
    isIndexLoading = false;
    isRulesLoading = false;
    isIndexHydrating = false;
    initError = next.initError ?? null;
    lastQueryKey = selected ? `${selected}|` : "";
  }

  applyServerData(data);
  $: applyServerData(data);

  $: selectedInfo = selected ? index[selected] : undefined;
  $: availableFilters = selectedInfo?.filters ?? [];
  $: filteredNames = (() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return names;
    }
    return names.filter((name) => name.includes(query));
  })();
  $: renderLimit =
    browser && hasFullIndex ? filteredNames.length : SSR_INITIAL_LIST_LIMIT;
  $: displayNames = filteredNames.slice(0, renderLimit);
  $: hasFullIndex =
    names.length > 0 && Object.keys(index).length >= names.length;

  $: liveFilter = (() => {
    const manual = manualFilter.trim().toLowerCase();
    if (manual) {
      return manual;
    }
    return selectedFilter === NONE_FILTER ? null : selectedFilter;
  })();

  $: debouncedFilter = (() => {
    const manual = debouncedManualFilter.trim().toLowerCase();
    if (manual) {
      return manual;
    }
    return selectedFilter === NONE_FILTER ? null : selectedFilter;
  })();

  $: quickLinks = (() => {
    if (!selected) {
      return [] as Array<{ key: string; label: string; href: string }>;
    }
    if (platform === "surge") {
      return SURGE_REGEX_MODES.map((item) => ({
        key: item.key,
        label: tr(item.labelKey),
        href: buildSurgeRulesPublicPath(
          selected as string,
          liveFilter,
          item.key as SurgeRegexMode,
        ),
      }));
    }
    return [
      {
        key: "yaml",
        label: "yaml",
        href: buildRulesPublicPath(selected as string, liveFilter),
      },
      {
        key: "plain",
        label: "plain",
        href: buildRulesApiPath(selected as string, liveFilter),
      },
    ];
  })();

  $: if (initError) {
    listCount = tr("error");
  } else {
    listCount = tr("listsCount", { count: names.length });
  }
  $: siteOrigin =
    platform === "surge"
      ? "https://surge.slinet.moe"
      : "https://egern.slinet.moe";
  $: canonicalUrl = `${siteOrigin}/`;

  $: if (browser) {
    if (manualDebounceTimer) {
      clearTimeout(manualDebounceTimer);
    }
    manualDebounceTimer = setTimeout(() => {
      debouncedManualFilter = manualFilter;
    }, 280);
  }

  $: if (selected) {
    const queryKey = `${selected}|${debouncedFilter ?? ""}`;
    if (queryKey !== lastQueryKey) {
      void loadRules(debouncedFilter);
    }
  } else {
    rawLink = "#";
  }

  function resetMeta() {
    etag = "-";
    stale = "-";
    ruleLines = "-";
    ruleTypeCounts = null;
    surgeRuleTypeCounts = null;
  }

  function resolveTheme(preference: ThemePreference): "light" | "dark" {
    if (preference === "system") {
      return window.matchMedia(THEME_MEDIA_QUERY).matches ? "dark" : "light";
    }
    return preference;
  }

  function applyTheme(preference: ThemePreference) {
    if (!browser) {
      return;
    }

    resolvedTheme = resolveTheme(preference);
    const isDark = resolvedTheme === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("latte", !isDark);
    document.documentElement.classList.toggle("macchiato", isDark);
  }

  function setThemePreference(next: ThemePreference) {
    themePreference = next;

    if (!browser) {
      return;
    }

    if (canPersistTheme) {
      try {
        if (next === "system") {
          window.localStorage.removeItem(THEME_STORAGE_KEY);
        } else {
          window.localStorage.setItem(THEME_STORAGE_KEY, next);
        }
      } catch {
        canPersistTheme = false;
      }
    }

    applyTheme(next);
  }

  function cycleThemePreference() {
    if (themePreference === "system") {
      setThemePreference("light");
      return;
    }

    if (themePreference === "light") {
      setThemePreference("dark");
      return;
    }

    setThemePreference("system");
  }

  function switchLocale(nextLocale: PanelLocale) {
    if (!browser || nextLocale === locale) {
      return;
    }

    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Max-Age=${LOCALE_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
    window.location.reload();
  }

  function switchView(nextView: DashboardView) {
    activeView = nextView;
  }

  async function loadRules(filter: string | null, force = false) {
    if (!selected) {
      return;
    }

    const queryKey =
      platform === "surge"
        ? `${selected}|${filter ?? ""}|${surgeRegexMode}`
        : `${selected}|${filter ?? ""}`;
    if (!force && queryKey === lastQueryKey) {
      return;
    }
    lastQueryKey = queryKey;

    const token = ++loadToken;
    isRulesLoading = true;
    previewText = tr("loading");
    resetMeta();

    const apiPath =
      platform === "surge"
        ? buildSurgeRulesApiPath(selected, filter, surgeRegexMode)
        : buildRulesApiPath(selected, filter);
    rawLink =
      platform === "surge"
        ? buildSurgeRulesPublicPath(selected, filter, surgeRegexMode)
        : buildRulesPublicPath(selected, filter);

    try {
      const response = await fetch(apiPath, {
        headers: {
          accept:
            platform === "surge"
              ? "text/plain;q=1, */*;q=0.1"
              : "application/yaml, text/plain;q=0.8, */*;q=0.1",
        },
      });
      const body = await response.text();

      if (token !== loadToken) {
        return;
      }

      etag = normalizeEtag(response.headers.get("x-upstream-etag"));
      stale = response.headers.get("x-stale") === "1" ? tr("yes") : tr("no");

      if (!response.ok) {
        previewText =
          `${response.status} ${response.statusText}\n${body}`.trim();
        ruleLines = "-";
        return;
      }

      previewText = body.length === 0 ? tr("emptyResult") : body;
      if (platform === "surge") {
        ruleLines = String(countSurgeRuleLines(body));
        surgeRuleTypeCounts = countSurgeRuleMatchTypes(body);
      } else {
        ruleLines = String(countRuleLines(body));
        ruleTypeCounts = countRuleMatchTypes(body);
      }
    } catch (error) {
      if (token !== loadToken) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      previewText = tr("requestFailed", { message });
      resetMeta();
    } finally {
      if (token === loadToken) {
        isRulesLoading = false;
      }
    }
  }

  async function initIndex() {
    isIndexLoading = true;
    initError = null;

    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        response = await fetch("/geosite", {
          headers: { accept: "application/json" },
        });
        if (response.ok) {
          break;
        }

        if (response.status !== 503) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        listCount = tr("initializing");
        previewText = tr("upstreamInitializing", {
          current: attempt + 1,
          total: 15,
        });
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      if (!response || !response.ok) {
        throw new Error("geosite data not ready");
      }

      index = (await response.json()) as GeositeIndex;
      names = Object.keys(index).sort();

      if (names.length === 0) {
        previewText = tr("indexEmpty");
        selected = null;
        listCount = tr("listsCount", { count: 0 });
        return;
      }

      selected = names[0] ?? null;
      selectedFilter = NONE_FILTER;
      manualFilter = "";
      debouncedManualFilter = "";
      previewText = tr("switchedDatasetLoading", { name: selected });
      lastQueryKey = "";
      await loadRules(null, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      initError = message;
      listCount = tr("error");
      previewText = tr("failedLoad", { message });
    } finally {
      isIndexLoading = false;
    }
  }

  async function hydrateFullIndexIfNeeded() {
    if (isIndexHydrating || hasFullIndex || names.length === 0 || initError) {
      return;
    }

    isIndexHydrating = true;
    try {
      const response = await fetch("/geosite", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        return;
      }

      const fullIndex = (await response.json()) as GeositeIndex;
      if (Object.keys(fullIndex).length > Object.keys(index).length) {
        index = fullIndex;
      }
    } catch {
      // Keep current partial index when hydration fetch fails.
    } finally {
      isIndexHydrating = false;
    }
  }

  function onSelectDataset(name: string) {
    if (name === selected) {
      return;
    }
    selected = name;
    selectedFilter = NONE_FILTER;
    manualFilter = "";
    debouncedManualFilter = "";
    previewText = tr("switchedDatasetLoading", { name });
    lastQueryKey = "";
  }

  function onFilterChange(value: string) {
    selectedFilter = value;
    previewText = tr("filterSwitchLoading");
  }

  function onManualFilterInput(value: string) {
    manualFilter = value;
    previewText = tr("filterInputLoading");
  }

  function onSurgeRegexModeChange(mode: SurgeRegexMode) {
    if (mode === surgeRegexMode) return;
    surgeRegexMode = mode;
    previewText = tr("regexModeSwitchLoading");
    lastQueryKey = "";
  }

  function toClipboardUrl(href: string): string {
    try {
      return new URL(href, window.location.origin).toString();
    } catch {
      return href;
    }
  }

  async function onCopyLink(key: string, href: string) {
    if (!browser) {
      return;
    }

    try {
      await navigator.clipboard.writeText(toClipboardUrl(href));
      copiedLinkKey = key;

      if (copiedQuickLinkTimer) {
        clearTimeout(copiedQuickLinkTimer);
      }
      copiedQuickLinkTimer = setTimeout(() => {
        copiedLinkKey = null;
      }, 1200);
    } catch {
      copiedLinkKey = null;
    }
  }

  onMount(() => {
    const mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
    const onMediaChange = () => {
      if (themePreference === "system") {
        applyTheme("system");
      }
    };

    try {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "light" || storedTheme === "dark") {
        themePreference = storedTheme;
      } else {
        themePreference = "system";
      }
    } catch {
      themePreference = "system";
    }

    applyTheme(themePreference);

    mediaQuery.addEventListener("change", onMediaChange);

    if (names.length === 0 && !initError) {
      void initIndex();
    } else {
      void hydrateFullIndexIfNeeded();
    }

    return () => {
      if (manualDebounceTimer) {
        clearTimeout(manualDebounceTimer);
      }
      if (copiedQuickLinkTimer) {
        clearTimeout(copiedQuickLinkTimer);
      }
      mediaQuery.removeEventListener("change", onMediaChange);
    };
  });
</script>

<svelte:head>
  <title
    >{platform === "surge"
      ? "Surge Geosite Panel"
      : "Egern Geosite Panel"}</title
  >
  <meta
    name="description"
    content={locale === "zh"
      ? platform === "surge"
        ? "Surge Geosite 面板：按数据集和标签生成可直接使用的规则集。"
        : "Egern Geosite 面板：按数据集和标签生成可直接使用的规则集。"
      : platform === "surge"
        ? "Surge Geosite panel for generating ready-to-use rule sets by dataset and filter."
        : "Egern Geosite panel for generating ready-to-use rule sets by dataset and filter."}
  />
  <link rel="canonical" href={canonicalUrl} />
</svelte:head>

<main
  class="mx-auto flex min-h-dvh w-full max-w-350 flex-col gap-4 box-border px-4 py-4 lg:h-dvh lg:overflow-hidden lg:px-8"
>
  <section class="rounded-xl border bg-card text-card-foreground shadow-sm">
    <div class="space-y-4 p-6">
      <div
        class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
      >
        <div class="space-y-1">
          <p class="text-primary text-xs font-semibold tracking-[0.2em]">
            {#if platform === "surge"}
              {activeView === "geoip" ? "SURGE GEOIP" : "SURGE GEOSITE"}
            {:else}
              {activeView === "geoip" ? "EGERN GEOIP" : "EGERN GEOSITE"}
            {/if}
          </p>
          <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
            {#if platform === "surge"}
              {activeView === "geoip"
                ? tr("surgeGeoipAppTitle")
                : tr("surgeAppTitle")}
            {:else}
              {activeView === "geoip" ? tr("geoipAppTitle") : tr("appTitle")}
            {/if}
          </h1>
          <p class="text-muted-foreground text-sm">
            {#if platform === "surge"}
              {activeView === "geoip"
                ? tr("surgeGeoipAppSubTitle")
                : tr("surgeAppSubTitle")}
            {:else}
              {activeView === "geoip"
                ? tr("geoipAppSubTitle")
                : tr("appSubTitle")}
            {/if}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div class="inline-flex overflow-hidden rounded-md border">
            <button
              type="button"
              class={`px-3 py-1.5 text-sm font-medium transition-colors ${locale === "zh" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              onclick={() => switchLocale("zh")}
            >
              ZH
            </button>
            <button
              type="button"
              class={`border-l px-3 py-1.5 text-sm font-medium transition-colors ${locale === "en" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              onclick={() => switchLocale("en")}
            >
              EN
            </button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="h-9 px-3"
            aria-label={themeToggleAriaLabel}
            onclick={cycleThemePreference}
          >
            {#if resolvedTheme === "dark"}
              <Moon class="size-4" />
            {:else}
              <Sun class="size-4" />
            {/if}
            <span class="hidden sm:inline">{themeModeLabel}</span>
          </Button>
          <div class="inline-flex overflow-hidden rounded-md border">
            <button
              type="button"
              class={`px-3 py-1.5 text-sm font-medium transition-colors ${activeView === "geosite" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              onclick={() => switchView("geosite")}
            >
              {tr("pageGeosite")}
            </button>
            <button
              type="button"
              class={`border-l px-3 py-1.5 text-sm font-medium transition-colors ${activeView === "geoip" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              onclick={() => switchView("geoip")}
            >
              {tr("pageGeoip")}
            </button>
          </div>
          <a
            class="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent"
            href="https://github.com/Slinet6056/Egern-Geosite"
            rel="noreferrer"
            target="_blank"
          >
            {tr("github")}
          </a>
        </div>
      </div>
    </div>
  </section>

  {#if activeView === "geosite"}
    <section class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[18rem_1fr]">
      <Card class="flex min-h-0 flex-col">
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-muted-foreground text-xs tracking-[0.14em]"
              >{tr("datasets")}</CardTitle
            >
            <Badge variant="secondary">{listCount}</Badge>
          </div>
          <Input
            type="search"
            value={search}
            oninput={(event) =>
              (search = (event.currentTarget as HTMLInputElement).value)}
            placeholder={tr("searchPlaceholder")}
          />
        </CardHeader>
        <CardContent class="min-h-0 flex-1 pb-4">
          <div
            class="max-h-[38dvh] space-y-1 overflow-auto pr-2 lg:h-full lg:max-h-none"
          >
            {#if isIndexLoading && names.length === 0}
              <div class="space-y-2">
                <Skeleton class="h-9 w-full" />
                <Skeleton class="h-9 w-full" />
                <Skeleton class="h-9 w-full" />
              </div>
            {:else if filteredNames.length === 0}
              <p class="text-muted-foreground px-2 py-3 text-xs">
                {tr("noMatch")}
              </p>
            {:else}
              {#each displayNames as name (name)}
                <button
                  type="button"
                  onclick={() => onSelectDataset(name)}
                  class={`hover:border-border flex w-full items-center justify-between border px-3 py-2 text-left text-sm transition-colors ${
                    selected === name
                      ? "border-primary text-primary bg-accent"
                      : "border-transparent"
                  }`}
                >
                  <span class="font-mono">{name}</span>
                  <span class="text-muted-foreground font-mono text-xs">
                    @{index[name] ? (index[name]?.filters?.length ?? 0) : "-"}
                  </span>
                </button>
              {/each}
              {#if browser && !hasFullIndex}
                <p class="text-muted-foreground px-2 py-3 text-xs">
                  {tr("indexHydrating")}
                </p>
              {/if}
            {/if}
          </div>
        </CardContent>
      </Card>

      <Card class="flex min-h-0 flex-col">
        <CardHeader class="space-y-4">
          <div
            class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <div>
              <p
                class="text-muted-foreground text-xs font-semibold tracking-[0.14em]"
              >
                {tr("selectedDataset")}
              </p>
              <h2 class="mt-1 font-mono text-xl font-semibold">
                {selectedInfo?.name ?? selected ?? "-"}
              </h2>
            </div>

            {#if platform === "surge"}
              <div class="flex items-center gap-2">
                <span class="text-muted-foreground text-xs font-semibold"
                  >{tr("regexMode")}</span
                >
                <div class="inline-flex overflow-hidden rounded-md border">
                  {#each SURGE_REGEX_MODES as item}
                    <Button
                      type="button"
                      variant={surgeRegexMode === item.key
                        ? "default"
                        : "ghost"}
                      size="sm"
                      class="rounded-none border-r last:border-r-0"
                      onclick={() => onSurgeRegexModeChange(item.key)}
                    >
                      {tr(item.labelKey)}
                    </Button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <div class="grid gap-4 lg:grid-cols-[1fr_17rem]">
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1">
                <span class="text-muted-foreground block text-xs font-semibold"
                  >{tr("filterTag")}</span
                >
                <select
                  class="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={selectedFilter}
                  onchange={(event) =>
                    onFilterChange(
                      (event.currentTarget as HTMLSelectElement).value,
                    )}
                >
                  <option value={NONE_FILTER}>{tr("noneOption")}</option>
                  {#each availableFilters as item}
                    <option value={item}>{item}</option>
                  {/each}
                </select>
              </label>

              <label class="space-y-1">
                <span class="text-muted-foreground block text-xs font-semibold"
                  >{tr("manualTag")}</span
                >
                <Input
                  class="font-mono"
                  placeholder={tr("manualTagPlaceholder")}
                  value={manualFilter}
                  oninput={(event) =>
                    onManualFilterInput(
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              </label>
            </div>

            <div class="flex items-end">
              <Button
                class="w-full"
                onclick={() => loadRules(liveFilter, true)}
                disabled={!selected || isRulesLoading}
              >
                {tr("loadRules")}
              </Button>
            </div>
          </div>

          <div
            class="text-muted-foreground grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3"
          >
            <div>
              <span>{tr("upstreamEtag")} </span>
              <span class="font-mono">{etag}</span>
            </div>
            <div>
              <span>{tr("staleFallback")} </span>
              <span class="font-mono">{stale}</span>
            </div>
            <div>
              <span>{tr("rules")} </span>
              <span class="font-mono">{ruleLines}</span>
            </div>
          </div>
        </CardHeader>

        <CardContent
          class="grid min-h-0 flex-1 gap-4 pb-4 lg:grid-cols-[1fr_17rem]"
        >
          <section class="flex min-h-0 flex-col gap-2">
            <div class="flex items-center justify-between">
              <h3
                class="text-muted-foreground text-xs font-semibold tracking-[0.14em]"
              >
                {tr("rulePreview")}
              </h3>
              <a
                class="text-primary text-xs font-semibold hover:underline"
                href={rawLink}
                target="_blank"
                rel="noreferrer"
              >
                {tr("openRawUrl")}
              </a>
            </div>
            <pre
              class="border-input bg-muted/40 min-h-56 max-h-[42dvh] overflow-auto border p-3 font-mono text-[12px] leading-5 lg:min-h-0 lg:max-h-none lg:flex-1">{previewText}</pre>
          </section>

          <aside class="min-h-0 space-y-3 overflow-auto lg:border-l lg:pl-3">
            {#if initError}
              <Alert variant="destructive">
                <AlertTitle>{tr("error")}</AlertTitle>
                <AlertDescription>{initError}</AlertDescription>
              </Alert>
            {/if}

            <section>
              <h4
                class="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.14em]"
              >
                {tr("datasetInfo")}
              </h4>
              <div class="text-muted-foreground space-y-1 text-xs">
                <p>
                  <span>{tr("sourceFile")} </span>
                  <span class="font-mono"
                    >{selectedInfo?.sourceFile ?? "-"}</span
                  >
                </p>
                {#if availableFilters.length > 0}
                  <p>
                    <span>{tr("filterCount")} </span>
                    <span class="font-mono">{availableFilters.length}</span>
                  </p>
                {/if}
                {#if platform === "surge"}
                  {#if (surgeRuleTypeCounts?.domain ?? 0) > 0}
                    <p>
                      <span>{tr("domainMatchRules")} </span>
                      <span class="font-mono"
                        >{surgeRuleTypeCounts?.domain}</span
                      >
                    </p>
                  {/if}
                  {#if (surgeRuleTypeCounts?.keyword ?? 0) > 0}
                    <p>
                      <span>{tr("keywordMatchRules")} </span>
                      <span class="font-mono"
                        >{surgeRuleTypeCounts?.keyword}</span
                      >
                    </p>
                  {/if}
                  {#if (surgeRuleTypeCounts?.suffix ?? 0) > 0}
                    <p>
                      <span>{tr("suffixMatchRules")} </span>
                      <span class="font-mono"
                        >{surgeRuleTypeCounts?.suffix}</span
                      >
                    </p>
                  {/if}
                  {#if (surgeRuleTypeCounts?.urlRegex ?? 0) > 0}
                    <p>
                      <span>{tr("urlRegexMatchRules")} </span>
                      <span class="font-mono"
                        >{surgeRuleTypeCounts?.urlRegex}</span
                      >
                    </p>
                  {/if}
                {:else}
                  {#if (ruleTypeCounts?.exact ?? 0) > 0}
                    <p>
                      <span>{tr("exactMatchRules")} </span>
                      <span class="font-mono">{ruleTypeCounts?.exact}</span>
                    </p>
                  {/if}
                  {#if (ruleTypeCounts?.keyword ?? 0) > 0}
                    <p>
                      <span>{tr("keywordMatchRules")} </span>
                      <span class="font-mono">{ruleTypeCounts?.keyword}</span>
                    </p>
                  {/if}
                  {#if (ruleTypeCounts?.suffix ?? 0) > 0}
                    <p>
                      <span>{tr("suffixMatchRules")} </span>
                      <span class="font-mono">{ruleTypeCounts?.suffix}</span>
                    </p>
                  {/if}
                  {#if (ruleTypeCounts?.regexp ?? 0) > 0}
                    <p>
                      <span>{tr("regexMatchRules")} </span>
                      <span class="font-mono">{ruleTypeCounts?.regexp}</span>
                    </p>
                  {/if}
                  {#if (ruleTypeCounts?.wildcard ?? 0) > 0}
                    <p>
                      <span>{tr("wildcardMatchRules")} </span>
                      <span class="font-mono">{ruleTypeCounts?.wildcard}</span>
                    </p>
                  {/if}
                {/if}
              </div>
            </section>

            <Separator />

            <section>
              <h4
                class="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.14em]"
              >
                {tr("quickLinks")}
              </h4>
              <div class="space-y-1 text-xs">
                {#if quickLinks.length === 0}
                  <p class="text-muted-foreground">-</p>
                {:else}
                  {#each quickLinks as item}
                    <div
                      class="flex items-center justify-between border px-2 py-1"
                    >
                      <span class="font-mono">{item.label}</span>
                      <div class="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          class="h-6 w-6"
                          aria-label={`${copiedLinkKey === `quick:${item.key}` ? tr("quickCopied") : tr("quickCopy")} ${item.label}`}
                          onclick={() =>
                            onCopyLink(`quick:${item.key}`, item.href)}
                        >
                          {#if copiedLinkKey === `quick:${item.key}`}
                            <Check class="size-3.5" />
                          {:else}
                            <Copy class="size-3.5" />
                          {/if}
                        </Button>
                        <Button
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          size="icon-sm"
                          variant="outline"
                          class="h-6 w-6"
                          aria-label={`${tr("quickOpen")} ${item.label}`}
                        >
                          <ExternalLink class="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>
            </section>
          </aside>
        </CardContent>
      </Card>
    </section>
  {:else}
    <GeoipPanel data={data.geoipData} />
  {/if}
</main>
