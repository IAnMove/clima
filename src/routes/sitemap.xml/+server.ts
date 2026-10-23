import { getWeatherProvider } from '$lib/infrastructure/weather/provider-factory';
import { buildSitemapXml } from '$lib/seo';
import type { RequestHandler } from './$types';

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=21600';

export const GET: RequestHandler = async () => {
	try {
		const municipalities = await getWeatherProvider().listMunicipalities();
		if (!municipalities.length) {
			return text('No hay municipios para el sitemap', 503);
		}

		return new Response(buildSitemapXml(municipalities), {
			status: 200,
			headers: {
				'content-type': 'application/xml; charset=utf-8',
				'cache-control': CACHE_CONTROL
			}
		});
	} catch (cause) {
		console.error('No se pudo generar el sitemap', cause);
		return text('No se pudo generar el sitemap', 503);
	}
};

function text(message: string, status: number): Response {
	return new Response(message, {
		status,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
}
