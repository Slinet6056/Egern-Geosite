export type PanelLocale = 'zh' | 'en';
export type PanelMode = 'strict' | 'balanced' | 'full';

export interface GeositeIndexItem {
	name?: string;
	sourceFile?: string;
	filters?: string[];
}

export type GeositeIndex = Record<string, GeositeIndexItem>;

export interface RulesMeta {
	etag: string;
	stale: boolean;
	ruleLines: number;
}
