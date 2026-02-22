import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWeatherByCity } from '$lib/application/get-weather-by-city';
import { getWeatherProvider } from '$lib/infrastructure/weather/provider-factory';
import { toSlug } from '$lib/utils/text';

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
				{ status: 200 }
			);
		}

		if (result.status === 'ambiguous') {
			return json(
				{
					status: 'ambiguous',
					message: `Hay varios municipios llamados "${result.cityQuery}"`,
					candidates: result.candidates
				},
				{ status: 409 }
			);
		}

		return json(
			{
				status: 'not_found',
				message: `No se encontró el municipio "${result.cityQuery}"`,
				suggestions: result.suggestions,
				provinceSuggestions: result.provinceSuggestions
			},
			{ status: 404 }
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
