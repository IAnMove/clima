export function normalizeSearchValue(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function slugToQuery(value: string): string {
	return decodeURIComponent(value).replace(/-/g, ' ').trim();
}

export function toSlug(value: string): string {
	return normalizeSearchValue(value).replace(/\s+/g, '-');
}
