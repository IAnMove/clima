import { getWeatherProvider } from '$lib/infrastructure/weather/provider-factory';
import { buildSitemapXml } from '$lib/seo';
import type { RequestHandler } from './$types';

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400';
const MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_SECONDS = '300';

let memo: { xml: string; at: number } | null = null;
let inflight: Promise<string> | null = null;

function refreshSitemap(): Promise<string> {
	inflight ??= (async () => {
		const municipalities = await getWeatherProvider().listMunicipalities();
		if (!municipalities.length) {
			throw new Error('No hay municipios para el sitemap');
		}
		const xml = buildSitemapXml(municipalities);
		memo = { xml, at: Date.now() };
		return xml;
	})().finally(() => {
		inflight = null;
	});
	return inflight;
}

export const GET: RequestHandler = async () => {
	if (memo) {
		if (Date.now() - memo.at > MEMO_TTL_MS) {
			// Stale-while-revalidate: se sirve la copia actual y se regenera en segundo plano.
			refreshSitemap().catch((cause: unknown) => {
				console.error('No se pudo regenerar el sitemap', cause);
			});
		}
		return xmlResponse(memo.xml);
	}

	try {
		return xmlResponse(await refreshSitemap());
	} catch (cause) {
		console.error('No se pudo generar el sitemap', cause);
		return unavailable();
	}
};

function xmlResponse(xml: string): Response {
	return new Response(xml, {
		status: 200,
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': CACHE_CONTROL
		}
	});
}

function unavailable(): Response {
	return new Response('Sitemap no disponible temporalmente', {
		status: 503,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
			'retry-after': RETRY_AFTER_SECONDS
		}
	});
}
