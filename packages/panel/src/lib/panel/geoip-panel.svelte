<svelte:options runes={false} />

<script lang="ts">
  import { browser } from "$app/environment";
  import { Check, Copy, ExternalLink } from "@lucide/svelte";

  import { buildGeoipApiPath, buildGeoipPublicPath } from "$lib/panel/api";
  import { t } from "$lib/panel/i18n";
  import type { GeoipPanelData } from "$lib/panel/geoip-panel";
  import type { GeoipIndex, PanelLocale } from "$lib/panel/types";
  import { countRuleLines, normalizeEtag } from "$lib/panel/utils";

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

  const GEOIP_MODES = [
    { key: "resolve", noResolve: false, labelKey: "geoipModeResolve" },
    { key: "no_resolve", noResolve: true, labelKey: "geoipModeNoResolve" },
  ] as const;

  export let data: GeoipPanelData;

  let locale: PanelLocale;
  let index: GeoipIndex;
  let names: string[];
  let selected: string | null;
  let noResolve: boolean;
  let search: string;
  let listCount: string;
  let previewText: string;
  let etag: string;
  let stale: string;
  let ruleLines: string;
  let rawLink: string;
  let initError: string | null;
  let isIndexLoading: boolean;
  let isRulesLoading: boolean;

  let loadToken = 0;
  let lastQueryKey = "";
  let copiedLinkKey: string | null = null;
  let copiedQuickLinkTimer: ReturnType<typeof setTimeout> | null = null;

  let tr: (key: string, vars?: Record<string, string | number>) => string = (
    key,
    vars = {},
  ) => t(locale, key, vars);

  $: tr = (key, vars = {}) => t(locale, key, vars);

  function applyServerData(next: GeoipPanelData) {
    const nextLocale = next.locale;
    locale = nextLocale;
    index = next.index ?? {};
    names = next.names ?? [];
    selected = next.selected ?? null;
    noResolve = next.noResolve ?? false;
    search = "";
    previewText = next.previewText ?? t(nextLocale, "geoipSelectDataset");
    etag = next.etag ?? "-";
    stale = next.stale ?? "-";
    ruleLines = next.ruleLines ?? "-";
    rawLink = next.rawLink ?? "#";
    isIndexLoading = false;
    isRulesLoading = false;
    initError = next.initError ?? null;
    listCount = next.initError
      ? t(nextLocale, "error")
      : t(nextLocale, "listsCount", { count: names.length });
    lastQueryKey = selected ? `${selected}|${noResolve ? 1 : 0}` : "";
  }

  applyServerData(data);
  $: applyServerData(data);

  $: selectedInfo = selected ? index[selected] : undefined;
  $: filteredNames = (() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return names;
    }
    return names.filter((name) => name.includes(query));
  })();
  $: quickLinks = (() => {
    if (!selected) {
      return [] as Array<{ mode: string; href: string }>;
    }

    const selectedName = selected;

    return GEOIP_MODES.map((item) => ({
      mode: item.key,
      href: buildGeoipPublicPath(selectedName, item.noResolve),
    }));
  })();
  $: modeLabel = noResolve ? tr("geoipModeNoResolve") : tr("geoipModeResolve");

  $: if (initError) {
    listCount = tr("error");
  } else {
    listCount = tr("listsCount", { count: names.length });
  }

  $: if (selected) {
    const queryKey = `${selected}|${noResolve ? 1 : 0}`;
    if (queryKey !== lastQueryKey) {
      void loadRules();
    }
  } else {
    rawLink = "#";
  }

  function resetMeta() {
    etag = "-";
    stale = "-";
    ruleLines = "-";
  }

  async function loadRules(force = false) {
    if (!selected) {
      return;
    }

    const queryKey = `${selected}|${noResolve ? 1 : 0}`;
    if (!force && queryKey === lastQueryKey) {
      return;
    }

    lastQueryKey = queryKey;
    const token = ++loadToken;
    isRulesLoading = true;
    previewText = tr("loading");
    resetMeta();
    rawLink = buildGeoipPublicPath(selected, noResolve);

    try {
      const response = await fetch(buildGeoipApiPath(selected, noResolve), {
        headers: { accept: "application/yaml, text/plain;q=0.8, */*;q=0.1" },
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
      ruleLines = String(countRuleLines(body));
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
        response = await fetch("/geoip", {
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
        throw new Error("geoip data not ready");
      }

      index = (await response.json()) as GeoipIndex;
      names = Object.keys(index).sort();

      if (names.length === 0) {
        previewText = tr("geoipIndexEmpty");
        selected = null;
        listCount = tr("listsCount", { count: 0 });
        return;
      }

      selected = names[0] ?? null;
      previewText = tr("switchedDatasetLoading", { name: selected });
      lastQueryKey = "";
      await loadRules(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      initError = message;
      listCount = tr("error");
      previewText = tr("geoipFailedLoad", { message });
    } finally {
      isIndexLoading = false;
    }
  }

  function onSelectDataset(name: string) {
    if (name === selected) {
      return;
    }

    selected = name;
    previewText = tr("switchedDatasetLoading", { name });
    lastQueryKey = "";
  }

  function onNoResolveChange(nextNoResolve: boolean) {
    if (nextNoResolve === noResolve) {
      return;
    }

    noResolve = nextNoResolve;
    previewText = tr("geoipModeSwitchLoading", {
      mode: nextNoResolve ? tr("geoipModeNoResolve") : tr("geoipModeResolve"),
    });
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
</script>

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
        placeholder={tr("geoipSearchPlaceholder")}
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
          {#each filteredNames as name (name)}
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
              <span class="text-muted-foreground font-mono text-xs"
                >{index[name]?.ipv4Count ?? 0}/{index[name]?.ipv6Count ??
                  0}</span
              >
            </button>
          {/each}
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

        <div class="inline-flex overflow-hidden rounded-md border">
          {#each GEOIP_MODES as item}
            <Button
              type="button"
              variant={noResolve === item.noResolve ? "default" : "ghost"}
              size="sm"
              class="rounded-none border-r last:border-r-0"
              onclick={() => onNoResolveChange(item.noResolve)}
            >
              {tr(item.labelKey)}
            </Button>
          {/each}
        </div>
      </div>

      <div
        class="text-muted-foreground grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"
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
          <span>{tr("mode")} </span>
          <span class="font-mono">{modeLabel}</span>
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
              <span class="font-mono">{selectedInfo?.sourceFile ?? "-"}</span>
            </p>
            <p>
              <span>{tr("geoipIpv4Count")} </span>
              <span class="font-mono">{selectedInfo?.ipv4Count ?? 0}</span>
            </p>
            <p>
              <span>{tr("geoipIpv6Count")} </span>
              <span class="font-mono">{selectedInfo?.ipv6Count ?? 0}</span>
            </p>
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
                <div class="flex items-center justify-between border px-2 py-1">
                  <span class="font-mono">{item.mode}</span>

                  <div class="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      class="h-6 w-6"
                      onclick={() =>
                        onCopyLink(`quick:${item.mode}`, item.href)}
                      aria-label={`${copiedLinkKey === `quick:${item.mode}` ? tr("quickCopied") : tr("quickCopy")} ${item.mode}`}
                    >
                      {#if copiedLinkKey === `quick:${item.mode}`}
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
                      aria-label={`${tr("quickOpen")} ${item.mode}`}
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
