import { browser } from '$app/environment';
import { buildCitySeo } from '$lib/seo';
import type { PageLoad } from './$types';

export const prerender = false;

const CACHE_CONTROL_OK = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
const CACHE_CONTROL_LOOKUP = 'public, max-age=120, s-maxage=600, stale-while-revalidate=600';

function pageCacheControl(isDebugMode: boolean, statusCode: number): string {
	if (isDebugMode) return 'no-store';
	if (statusCode === 200) return CACHE_CONTROL_OK;
	if (statusCode === 404 || statusCode === 409) return CACHE_CONTROL_LOOKUP;
	return 'no-store';
}

export const load: PageLoad = async ({ fetch, params, url, setHeaders }) => {
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

	// setHeaders solo tiene efecto en SSR; en cliente se omite.
	if (!browser) {
		setHeaders({ 'cache-control': pageCacheControl(isDebugMode, statusCode) });
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
