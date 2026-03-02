export function countRuleLines(text: string): number {
	return text.split(/\r?\n/).filter((line) => line.length > 0).length;
}

export function normalizeEtag(value: string | null): string {
	if (!value) {
		return '-';
	}

	const compact = value.replace(/^W\//, '').replaceAll('"', '');
	return compact.slice(0, 7) || '-';
}
