import { buildCitySeo } from '$lib/seo';
import type { PageLoad } from './$types';

export const prerender = false;

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

	let statusCode = 500;
	let payload: unknown = {
		status: 'error',
		message: 'No se pudo obtener la información meteorológica.'
	};

	try {
		const response = await fetch(
			`/api/weather/${encodeURIComponent(dataCity)}${query.size ? `?${query.toString()}` : ''}`
		);
		statusCode = response.status;
		payload = (await response.json()) as unknown;
	} catch {
		statusCode = 503;
	}

	return {
		citySlug: params.city,
		isDebugMode,
		statusCode,
		payload,
		province,
		code,
		seo: buildCitySeo(params.city, payload, isDebugMode)
	};
};
