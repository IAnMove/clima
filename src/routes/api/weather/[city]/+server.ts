import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWeatherByCity } from '$lib/application/get-weather-by-city';
import { getWeatherProvider } from '$lib/infrastructure/weather/provider-factory';
import { toSlug } from '$lib/utils/text';

const CACHE_CONTROL_OK = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
const CACHE_CONTROL_LOOKUP = 'public, max-age=120, s-maxage=600, stale-while-revalidate=600';

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const provider = getWeatherProvider();
		const code = url.searchParams.get('code');
		const province = url.searchParams.get('province');

		const result = await getWeatherByCity(provider, {
			citySlug: params.city,
			code,
			province
		});

		if (result.status === 'ok') {
			return json(
				{
					status: 'ok',
					provider: provider.id,
					municipality: result.municipality,
					canonicalPath: `/${toSlug(result.municipality.name)}?code=${result.municipality.code}`,
					report: result.report
				},
				{
					status: 200,
					headers: {
						'cache-control': CACHE_CONTROL_OK
					}
				}
			);
		}

		if (result.status === 'ambiguous') {
			return json(
				{
					status: 'ambiguous',
					message: `Hay varios municipios llamados "${result.cityQuery}"`,
					candidates: result.candidates
				},
				{
					status: 409,
					headers: {
						'cache-control': CACHE_CONTROL_LOOKUP
					}
				}
			);
		}

		return json(
			{
				status: 'not_found',
				message: `No se encontr\u00f3 el municipio "${result.cityQuery}"`,
				suggestions: result.suggestions,
				provinceSuggestions: result.provinceSuggestions
			},
			{
				status: 404,
				headers: {
					'cache-control': CACHE_CONTROL_LOOKUP
				}
			}
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error inesperado';
		return json(
			{
				status: 'error',
				message
			},
			{ status: 500 }
		);
	}
};
