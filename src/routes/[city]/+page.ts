import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params, url }) => {
	const province = url.searchParams.get('province') ?? '';
	const code = url.searchParams.get('code') ?? '';
	const query = new URLSearchParams();

	if (province) {
		query.set('province', province);
	}

	if (code) {
		query.set('code', code);
	}

	const response = await fetch(
		`/api/weather/${encodeURIComponent(params.city)}${query.size ? `?${query.toString()}` : ''}`
	);
	const payload = (await response.json()) as unknown;

	return {
		citySlug: params.city,
		statusCode: response.status,
		payload,
		province,
		code
	};
};
