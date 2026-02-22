import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params, url }) => {
	const isDebugMode = params.city.toLowerCase() === 'debug-test';
	const dataCity = isDebugMode ? 'oviedo' : params.city;
	const province = url.searchParams.get('province') ?? '';
	const code = url.searchParams.get('code') ?? '';
	const query = new URLSearchParams();

	if (!isDebugMode && province) {
		query.set('province', province);
	}

	if (!isDebugMode && code) {
		query.set('code', code);
	}

	const response = await fetch(
		`/api/weather/${encodeURIComponent(dataCity)}${query.size ? `?${query.toString()}` : ''}`
	);
	const payload = (await response.json()) as unknown;

	return {
		citySlug: params.city,
		isDebugMode,
		statusCode: response.status,
		payload,
		province,
		code
	};
};
