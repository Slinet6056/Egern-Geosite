import type { GeoipIndex, PanelLocale } from "$lib/panel/types";

export interface GeoipPanelData {
  locale: PanelLocale;
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
