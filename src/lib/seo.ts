import { slugToQuery, toSlug } from './utils/text';

export const SITE_ORIGIN = 'https://clima.iaen.es';

export interface PageSeo {
	title: string;
	description: string;
	canonical: string;
	robots: 'index,follow' | 'noindex,follow';
	image?: string | null;
	jsonLd?: Record<string, unknown> | null;
}

const SITE_NAME = 'Clima Visual';
const HOME_DESCRIPTION =
	'Consulta el tiempo en los municipios de España: temperatura, probabilidad de lluvia, viento y previsión por horas y días. Datos de AEMET.';

export const homeSeo: PageSeo = {
	title: 'Tiempo por municipio en España | Clima Visual',
	description: HOME_DESCRIPTION,
	canonical: `${SITE_ORIGIN}/`,
	robots: 'index,follow',
	jsonLd: {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: SITE_NAME,
		url: `${SITE_ORIGIN}/`,
		inLanguage: 'es-ES',
		description: HOME_DESCRIPTION
	}
};

/** Serializa JSON-LD como <script>, escapando `<` para evitar inyección de HTML. */
export function jsonLdScript(data: Record<string, unknown>): string {
	const json = JSON.stringify(data).replace(/</g, '\\u003c');
	return `<script type="application/ld+json">${json}</script>`;
}

export function isPageSeo(value: unknown): value is PageSeo {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const record = value as Record<string, unknown>;
	return (
		typeof record.title === 'string' &&
		typeof record.description === 'string' &&
		typeof record.canonical === 'string' &&
		(record.robots === 'index,follow' || record.robots === 'noindex,follow') &&
		(record.image === undefined || record.image === null || typeof record.image === 'string') &&
		(record.jsonLd === undefined ||
			record.jsonLd === null ||
			(typeof record.jsonLd === 'object' && !Array.isArray(record.jsonLd)))
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
	// Cualquier estado distinto de 'ok' (not_found, ambiguous, error o desconocido) no se indexa.
	const noindex = isDebugMode || status !== 'ok';
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

	if (noindex) {
		return { title, description, canonical, robots: 'noindex,follow', image: null, jsonLd: null };
	}

	const latitude = readFirstNumber([location, municipality], ['latitude', 'lat']);
	const longitude = readFirstNumber([location, municipality], ['longitude', 'lon', 'lng']);
	const hasGeo =
		latitude !== null &&
		longitude !== null &&
		Math.abs(latitude) <= 90 &&
		Math.abs(longitude) <= 180;

	const placeNode: Record<string, unknown> = {
		'@type': 'Place',
		'@id': `${canonical}#place`,
		name,
		address: {
			'@type': 'PostalAddress',
			addressLocality: name,
			...(province ? { addressRegion: province } : {}),
			addressCountry: 'ES'
		},
		...(hasGeo ? { geo: { '@type': 'GeoCoordinates', latitude, longitude } } : {})
	};

	return {
		title,
		description,
		canonical,
		robots: 'index,follow',
		image: readHttpsUrl(asRecord(report?.backgroundImage)?.url),
		jsonLd: {
			'@context': 'https://schema.org',
			'@graph': [
				{
					'@type': 'WebPage',
					'@id': canonical,
					url: canonical,
					name: title,
					description,
					inLanguage: 'es-ES',
					isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_ORIGIN}/` },
					about: { '@id': `${canonical}#place` },
					breadcrumb: { '@id': `${canonical}#breadcrumb` }
				},
				placeNode,
				{
					'@type': 'BreadcrumbList',
					'@id': `${canonical}#breadcrumb`,
					itemListElement: [
						{ '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITE_ORIGIN}/` },
						{ '@type': 'ListItem', position: 2, name: place, item: canonical }
					]
				}
			]
		}
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

function readFirstNumber(
	records: Array<Record<string, unknown> | null>,
	keys: string[]
): number | null {
	for (const record of records) {
		for (const key of keys) {
			const value = record?.[key];
			if (typeof value === 'number' && Number.isFinite(value)) {
				return value;
			}
		}
	}
	return null;
}

function readHttpsUrl(value: unknown): string | null {
	const raw = readString(value);
	if (!raw) return null;
	try {
		const parsed = new URL(raw);
		return parsed.protocol === 'https:' ? parsed.href : null;
	} catch {
		return null;
	}
}

function readString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed || null;
}
