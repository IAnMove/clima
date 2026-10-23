import { slugToQuery, toSlug } from './utils/text';

export const SITE_ORIGIN = 'https://clima.iaen.es';

export interface PageSeo {
	title: string;
	description: string;
	canonical: string;
	robots: 'index,follow' | 'noindex,follow';
}

export const homeSeo: PageSeo = {
	title: 'Tiempo por municipio en España | Clima Visual',
	description:
		'Consulta el tiempo en los municipios de España: temperatura, probabilidad de lluvia, viento y previsión por horas y días. Datos de AEMET.',
	canonical: `${SITE_ORIGIN}/`,
	robots: 'index,follow'
};

export function isPageSeo(value: unknown): value is PageSeo {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const record = value as Record<string, unknown>;
	return (
		typeof record.title === 'string' &&
		typeof record.description === 'string' &&
		typeof record.canonical === 'string' &&
		(record.robots === 'index,follow' || record.robots === 'noindex,follow')
	);
}

export function labelFromSlug(slug: string): string {
	const words = slugToQuery(slug).split(/\s+/).filter(Boolean);
	if (!words.length) {
		return 'España';
	}

	return words
		.map((word) => word.charAt(0).toLocaleUpperCase('es-ES') + word.slice(1))
		.join(' ');
}

export function fallbackSeo(pathname: string): PageSeo {
	if (pathname === '/' || pathname === '') {
		return homeSeo;
	}

	const slug = pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
	if (!slug || slug.includes('.')) {
		return homeSeo;
	}

	return buildCitySeo(slug, null, false);
}

export function buildCitySeo(citySlug: string, payload: unknown, isDebugMode: boolean): PageSeo {
	const label = labelFromSlug(citySlug);
	const record = asRecord(payload);
	const status = readString(record?.status);
	const report = asRecord(record?.report);
	const location = asRecord(report?.location);
	const municipality = asRecord(record?.municipality);
	const name = readString(location?.name) ?? readString(municipality?.name) ?? label;
	const province = readString(location?.province) ?? readString(municipality?.province);
	const place = province ? `${name} (${province})` : name;
	const canonicalPath = readString(record?.canonicalPath);
	const canonical =
		status === 'ok' && canonicalPath?.startsWith('/')
			? `${SITE_ORIGIN}${canonicalPath}`
			: `${SITE_ORIGIN}/${toSlug(citySlug) || encodeURIComponent(citySlug)}`;
	const noindex = isDebugMode || status === 'not_found' || status === 'ambiguous';
	const title =
		status === 'not_found'
			? `No encontramos ${label} | Clima Visual`
			: status === 'ambiguous'
				? `Varios municipios llamados ${label} | Clima Visual`
				: `Tiempo en ${place} | Clima Visual`;
	const description =
		status === 'not_found'
			? `No hay un municipio llamado ${label} en el listado de AEMET. Prueba con otro nombre o filtra por provincia.`
			: status === 'ambiguous'
				? `Hay varios municipios llamados ${label}. Elige la provincia para ver el tiempo.`
				: `Tiempo en ${place}: temperatura, probabilidad de lluvia, viento y previsión por horas y días. Datos de AEMET.`;

	return {
		title,
		description,
		canonical,
		robots: noindex ? 'noindex,follow' : 'index,follow'
	};
}

export function buildSitemapXml(municipalities: Array<{ name: string; code: string }>): string {
	const locs = new Set<string>([`${SITE_ORIGIN}/`]);

	for (const municipality of municipalities) {
		const loc = municipalityUrl(municipality.name, municipality.code);
		if (loc) {
			locs.add(loc);
		}
	}

	const urls = [...locs]
		.sort((a, b) => a.localeCompare(b, 'es'))
		.map((loc) => `  <url><loc>${escapeXml(loc)}</loc></url>`)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function municipalityUrl(name: string, code: string): string | null {
	const slug = toSlug(name);
	if (!slug || !/^\d{5}$/.test(code)) {
		return null;
	}

	return `${SITE_ORIGIN}/${slug}?code=${code}`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed || null;
}
