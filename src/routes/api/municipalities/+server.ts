import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWeatherProvider } from '$lib/infrastructure/weather/provider-factory';
import { normalizeSearchValue } from '$lib/utils/text';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const provider = getWeatherProvider();
		const province = url.searchParams.get('province')?.trim() ?? '';
		const query = normalizeSearchValue(url.searchParams.get('q') ?? '');

		if (!province) {
			const provinces = await provider.listProvinces();
			return json({ status: 'ok', provinces }, { status: 200 });
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
			{ status: 200 }
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error inesperado';
		return json({ status: 'error', message }, { status: 500 });
	}
};
