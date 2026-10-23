import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWeatherProvider } from '$lib/infrastructure/weather/provider-factory';
import { normalizeSearchValue } from '$lib/utils/text';

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const provider = getWeatherProvider();
		const province = url.searchParams.get('province')?.trim() ?? '';
		const query = normalizeSearchValue(url.searchParams.get('q') ?? '');

		if (!province) {
			const provinces = await provider.listProvinces();
			return json(
				{ status: 'ok', provinces },
				{ status: 200, headers: { 'cache-control': CACHE_CONTROL } }
			);
		}

		let municipalities = await provider.listMunicipalitiesByProvince(province);
		if (query) {
			municipalities = municipalities.filter((item) =>
				normalizeSearchValue(item.name).includes(query)
			);
		}

		return json(
			{
				status: 'ok',
				province,
				total: municipalities.length,
				municipalities
			},
			{ status: 200, headers: { 'cache-control': CACHE_CONTROL } }
		);
	} catch (error) {
		console.error('Error listando municipios', error);
		return json(
			{ status: 'error', message: 'No se pudo obtener el listado de municipios.' },
			{ status: 500, headers: { 'cache-control': 'no-store' } }
		);
	}
};
