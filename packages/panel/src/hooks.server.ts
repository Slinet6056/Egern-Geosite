import type { Handle } from '@sveltejs/kit';

type Locale = 'zh' | 'en';

function detectLangFromAcceptLanguage(acceptLanguage: string | null): Locale {
	if (!acceptLanguage) {
		return 'zh';
	}

	return acceptLanguage.toLowerCase().includes('zh') ? 'zh' : 'en';
}

function detectLangFromPath(pathname: string): Locale | null {
	if (pathname === '/zh' || pathname.startsWith('/zh/')) {
		return 'zh';
	}

	if (pathname === '/en' || pathname.startsWith('/en/')) {
		return 'en';
	}

	return null;
}

export const handle: Handle = async ({ event, resolve }) => {
	const lang =
		detectLangFromPath(event.url.pathname) ??
		detectLangFromAcceptLanguage(event.request.headers.get('accept-language'));

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', lang)
	});
};
