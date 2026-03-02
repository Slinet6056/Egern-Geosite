import { buildRulesPublicPath } from '$lib/panel/api';
import { t } from '$lib/panel/i18n';
import { countRuleLines } from '$lib/panel/utils';

import type { GeositeIndex, PanelLocale, PanelMode } from '$lib/panel/types';
import type { PageServerLoad } from './$types';

const DEFAULT_MODE: PanelMode = 'balanced';

export const load: PageServerLoad = async ({ params, fetch }) => {
	const locale = params.lang as PanelLocale;
	const tr = (key: string, vars: Record<string, string | number> = {}) => t(locale, key, vars);

	let index: GeositeIndex = {};
	let names: string[] = [];
	let selected: string | null = null;
	let previewText = tr('selectDataset');
	let etag = '-';
	let stale = '-';
	let ruleLines = '-';
	let rawLink = '#';
	let initError: string | null = null;

	try {
		const indexResponse = await fetch('/geosite', {
			headers: {
				accept: 'application/json'
			}
		});
		if (!indexResponse.ok) {
			throw new Error(`${indexResponse.status} ${indexResponse.statusText}`);
		}
		index = (await indexResponse.json()) as GeositeIndex;
		names = Object.keys(index).sort();

		if (names.length === 0) {
			previewText = tr('indexEmpty');
		} else {
			selected = names[0];
			rawLink = buildRulesPublicPath(DEFAULT_MODE, selected, null);
			const rulesResponse = await fetch(`/geosite/${DEFAULT_MODE}/${encodeURIComponent(selected)}`, {
				headers: {
					accept: 'text/plain'
				}
			});
			const rulesText = await rulesResponse.text();

			etag = rulesResponse.headers.get('x-upstream-etag') ?? '-';
			stale = rulesResponse.headers.get('x-stale') === '1' ? tr('yes') : tr('no');
			if (!rulesResponse.ok) {
				previewText = `${rulesResponse.status} ${rulesResponse.statusText}\n${rulesText}`.trim();
			} else {
				previewText = rulesText.length === 0 ? tr('emptyResult') : rulesText;
				ruleLines = String(countRuleLines(rulesText));
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		previewText = tr('failedLoad', { message });
		initError = message;
	}

	return {
		locale,
		index,
		names,
		selected,
		mode: DEFAULT_MODE,
		previewText,
		etag,
		stale,
		ruleLines,
		rawLink,
		initError
	};
};
