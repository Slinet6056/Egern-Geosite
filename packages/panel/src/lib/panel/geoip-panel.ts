import type { GeoipIndex, PanelLocale, PanelPlatform } from "$lib/panel/types";

export interface GeoipPanelData {
  locale: PanelLocale;
  platform: PanelPlatform;
  index: GeoipIndex;
  names: string[];
  selected: string | null;
  noResolve: boolean;
  previewText: string;
  etag: string;
  stale: string;
  ruleLines: string;
  rawLink: string;
  initError: string | null;
}
