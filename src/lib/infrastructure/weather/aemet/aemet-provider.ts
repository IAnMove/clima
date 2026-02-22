import type { Municipality, ProvinceMunicipalities } from '$lib/domain/municipality';
import type {
	MunicipalityResolution,
	ResolveMunicipalityInput,
	WeatherProvider
} from '$lib/domain/ports/weather-provider';
import type { DailyWeather, HourlyWeather, WeatherCondition, WeatherImage, WeatherReport } from '$lib/domain/weather';
import { normalizeSearchValue } from '$lib/utils/text';
import { AemetClient } from './aemet-client';

type UnknownRecord = Record<string, unknown>;

const CACHE_TTL_MUNICIPALITIES_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_IMAGE_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_WEATHER_MS = 8 * 60 * 1000;
const MAX_WEATHER_CACHE_ENTRIES = 200;

export class AemetWeatherProvider implements WeatherProvider {
	readonly id = 'aemet';

	private municipalitiesCache:
		| {
				expiresAt: number;
				items: Municipality[];
		  }
		| undefined;

	private readonly imageCache = new Map<
		string,
		{
			expiresAt: number;
			image: WeatherImage | null;
		}
	>();
	private readonly weatherCache = new Map<
		string,
		{
			expiresAt: number;
			report: WeatherReport;
		}
	>();
	private readonly weatherInFlight = new Map<string, Promise<WeatherReport>>();

	constructor(private readonly client: AemetClient = new AemetClient()) {}

	async resolveMunicipality(input: ResolveMunicipalityInput): Promise<MunicipalityResolution> {
		const municipalities = await this.getMunicipalities();

		if (input.code) {
			const requestedCode = normalizeMunicipalityCode(input.code);
			if (requestedCode) {
				const found = municipalities.find((item) => item.code === requestedCode);
				if (found) {
					return { kind: 'resolved', municipality: found };
				}
			}
		}

		const normalizedQuery = normalizeSearchValue(input.query);
		if (!normalizedQuery) {
			return {
				kind: 'not_found',
				query: input.query,
				suggestions: [],
				provinceSuggestions: []
			};
		}

		const provinceFilter = normalizeSearchValue(input.province ?? '');
		const filteredPool = provinceFilter
			? municipalities.filter((item) =>
					normalizeSearchValue(item.province ?? '').includes(provinceFilter)
				)
			: municipalities;

		const exact = filteredPool.filter(
			(item) => normalizeSearchValue(item.name) === normalizedQuery
		);

		if (exact.length === 1) {
			return { kind: 'resolved', municipality: exact[0] };
		}

		if (exact.length > 1) {
			return {
				kind: 'ambiguous',
				candidates: exact.slice(0, 20)
			};
		}

		const startsWith = filteredPool.filter((item) =>
			normalizeSearchValue(item.name).startsWith(normalizedQuery)
		);
		const contains = filteredPool.filter((item) =>
			normalizeSearchValue(item.name).includes(normalizedQuery)
		);

		const ranked = dedupeMunicipalities([...startsWith, ...contains]);

		if (ranked.length === 1) {
			return { kind: 'resolved', municipality: ranked[0] };
		}

		if (ranked.length > 1) {
			return {
				kind: 'ambiguous',
				candidates: ranked.slice(0, 20)
			};
		}

		const suggestions = dedupeMunicipalities([
			...municipalities.filter((item) =>
				normalizeSearchValue(item.name).startsWith(normalizedQuery.slice(0, 3))
			),
			...municipalities.filter((item) =>
				normalizeSearchValue(item.name).includes(normalizedQuery)
			)
		]).slice(0, 20);

		return {
			kind: 'not_found',
			query: input.query,
			suggestions,
			provinceSuggestions: this.buildProvinceSuggestions(municipalities, normalizedQuery)
		};
	}

	async getWeatherByMunicipalityCode(code: string): Promise<WeatherReport> {
		const municipalityCode = normalizeMunicipalityCode(code);
		if (!municipalityCode) {
			throw new Error('Código de municipio inválido');
		}

		const now = Date.now();
		const cached = this.weatherCache.get(municipalityCode);
		if (cached && cached.expiresAt > now) {
			return cached.report;
		}

		const inFlight = this.weatherInFlight.get(municipalityCode);
		if (inFlight) {
			return inFlight;
		}

		const request = this.fetchWeatherReport(municipalityCode)
			.then((report) => {
				this.weatherCache.set(municipalityCode, {
					expiresAt: Date.now() + CACHE_TTL_WEATHER_MS,
					report
				});
				this.pruneWeatherCache();
				return report;
			})
			.finally(() => {
				this.weatherInFlight.delete(municipalityCode);
			});

		this.weatherInFlight.set(municipalityCode, request);
		return request;
	}

	private async fetchWeatherReport(municipalityCode: string): Promise<WeatherReport> {
		const [hourlyRaw, dailyRaw] = await Promise.all([
			this.client.getHourlyForecastRaw(municipalityCode),
			this.client.getDailyForecastRaw(municipalityCode)
		]);

		const location = this.extractLocation(municipalityCode, dailyRaw, hourlyRaw);
		const hourly = parseHourlyWeather(hourlyRaw);
		const daily = parseDailyWeather(dailyRaw);
		const current = pickCurrentHour(hourly);
		const backgroundImage = await this.getCityImage(location.name, location.province);

		return {
			source: this.id,
			generatedAtIso: new Date().toISOString(),
			location,
			current,
			hourly,
			daily,
			backgroundImage
		};
	}

	private pruneWeatherCache(): void {
		const now = Date.now();

		for (const [cacheKey, entry] of this.weatherCache.entries()) {
			if (entry.expiresAt <= now) {
				this.weatherCache.delete(cacheKey);
			}
		}

		if (this.weatherCache.size <= MAX_WEATHER_CACHE_ENTRIES) {
			return;
		}

		const overflow = this.weatherCache.size - MAX_WEATHER_CACHE_ENTRIES;
		const keys = [...this.weatherCache.keys()];
		for (let index = 0; index < overflow; index += 1) {
			const key = keys[index];
			if (key) {
				this.weatherCache.delete(key);
			}
		}
	}

	async listProvinces(): Promise<string[]> {
		const municipalities = await this.getMunicipalities();
		return [...new Set(municipalities.map((item) => item.province).filter(Boolean) as string[])]
			.sort((a, b) => a.localeCompare(b, 'es'));
	}

	async listMunicipalitiesByProvince(province: string): Promise<Municipality[]> {
		const normalizedProvince = normalizeSearchValue(province);
		const municipalities = await this.getMunicipalities();
		return municipalities.filter((item) =>
			normalizeSearchValue(item.province ?? '').includes(normalizedProvince)
		);
	}

	private async getMunicipalities(): Promise<Municipality[]> {
		const now = Date.now();
		if (this.municipalitiesCache && this.municipalitiesCache.expiresAt > now) {
			return this.municipalitiesCache.items;
		}

		const raw = await this.client.getMunicipalitiesRaw();
		const mapped = raw
			.map((item) => mapMunicipality(item))
			.filter((item): item is Municipality => item !== null)
			.sort((a, b) => {
				const provinceCompare = (a.province ?? '').localeCompare(b.province ?? '', 'es');
				if (provinceCompare !== 0) {
					return provinceCompare;
				}

				return a.name.localeCompare(b.name, 'es');
			});

		this.municipalitiesCache = {
			expiresAt: now + CACHE_TTL_MUNICIPALITIES_MS,
			items: mapped
		};

		return mapped;
	}

	private buildProvinceSuggestions(
		municipalities: Municipality[],
		normalizedQuery: string
	): ProvinceMunicipalities[] {
		if (!normalizedQuery) {
			return [];
		}

		const byProvince = new Map<string, Municipality[]>();

		for (const municipality of municipalities) {
			if (!municipality.province) {
				continue;
			}

			if (!byProvince.has(municipality.province)) {
				byProvince.set(municipality.province, []);
			}

			byProvince.get(municipality.province)?.push(municipality);
		}

		const matchedProvinces = [...byProvince.entries()]
			.filter(([province]) => normalizeSearchValue(province).includes(normalizedQuery))
			.sort(([a], [b]) => a.localeCompare(b, 'es'))
			.slice(0, 5);

		return matchedProvinces.map(([province, items]) => ({
			province,
			totalMunicipalities: items.length,
			municipalities: [...items]
				.sort((a, b) => a.name.localeCompare(b.name, 'es'))
				.slice(0, 30)
		}));
	}

	private extractLocation(
		code: string,
		dailyRaw: unknown,
		hourlyRaw: unknown
	): {
		code: string;
		name: string;
		province: string | null;
		latitude: number | null;
		longitude: number | null;
	} {
		const dailyRoot = extractForecastRoot(dailyRaw);
		const hourlyRoot = extractForecastRoot(hourlyRaw);
		const source = dailyRoot ?? hourlyRoot ?? {};

		const latitude =
			toNumber(source.latitud) ??
			toNumber(source.latitud_dec) ??
			toNumber(source.latitudDecimal) ??
			null;
		const longitude =
			toNumber(source.longitud) ??
			toNumber(source.longitud_dec) ??
			toNumber(source.longitudDecimal) ??
			null;

		return {
			code,
			name: getString(source.nombre) ?? 'Municipio',
			province: getString(source.provincia),
			latitude,
			longitude
		};
	}

	private async getCityImage(name: string, province: string | null): Promise<WeatherImage | null> {
		const cacheKey = normalizeSearchValue(`${name} ${province ?? ''}`);
		const cacheHit = this.imageCache.get(cacheKey);
		const now = Date.now();

		if (cacheHit && cacheHit.expiresAt > now) {
			return cacheHit.image;
		}

		const searchQueries = buildLandscapeQueries(name, province);

		for (const query of searchQueries) {
			const landscapeImage = await fetchFlickrLandscapeImage(query);
			if (landscapeImage) {
				this.imageCache.set(cacheKey, {
					expiresAt: now + CACHE_TTL_IMAGE_MS,
					image: landscapeImage
				});
				return landscapeImage;
			}
		}

		const candidates = buildWikipediaTitleCandidates(name, province);
		const languages = ['es', 'en'];
		for (const language of languages) {
			for (const title of candidates) {
				const fallbackImage = await fetchWikipediaImage(language, title);
				if (fallbackImage) {
					this.imageCache.set(cacheKey, {
						expiresAt: now + CACHE_TTL_IMAGE_MS,
						image: fallbackImage
					});
					return fallbackImage;
				}
			}
		}

		this.imageCache.set(cacheKey, {
			expiresAt: now + CACHE_TTL_IMAGE_MS,
			image: null
		});
		return null;
	}
}

function mapMunicipality(input: unknown): Municipality | null {
	const record = asRecord(input);
	if (!record) {
		return null;
	}

	const code = findMunicipalityCode(record);
	const name = findFirstString(record, ['nombre', 'municipio', 'nombre_municipio']);
	const province = findFirstString(record, ['provincia', 'nombre_provincia', 'provincia_nombre']);

	if (!code || !name) {
		return null;
	}

	const latitude =
		toNumber(record.latitud_dec) ??
		toNumber(record.latitud) ??
		toNumber(record.latitud_decimal) ??
		null;
	const longitude =
		toNumber(record.longitud_dec) ??
		toNumber(record.longitud) ??
		toNumber(record.longitud_decimal) ??
		null;

	return {
		code,
		name,
		province,
		latitude,
		longitude
	};
}

function findMunicipalityCode(record: UnknownRecord): string | null {
	const candidates = [
		record.id,
		record.idMunicipio,
		record.idmunicipio,
		record.cod_ine,
		record.codigo,
		record.ine
	];

	for (const candidate of candidates) {
		const asString = getString(candidate);
		const code = normalizeMunicipalityCode(asString);
		if (code) {
			return code;
		}
	}

	for (const value of Object.values(record)) {
		const asString = getString(value);
		const code = normalizeMunicipalityCode(asString);
		if (code) {
			return code;
		}
	}

	return null;
}

function normalizeMunicipalityCode(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}

	const match = value.match(/\d{5}/);
	return match ? match[0] : null;
}

function dedupeMunicipalities(municipalities: Municipality[]): Municipality[] {
	const seen = new Set<string>();
	const deduped: Municipality[] = [];

	for (const municipality of municipalities) {
		if (seen.has(municipality.code)) {
			continue;
		}
		seen.add(municipality.code);
		deduped.push(municipality);
	}

	return deduped;
}

function asRecord(value: unknown): UnknownRecord | null {
	return value && typeof value === 'object' ? (value as UnknownRecord) : null;
}

function asArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

function getString(value: unknown): string | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : null;
	}

	if (Array.isArray(value) && value.length > 0) {
		return getString(value[0]);
	}

	return null;
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}

	const asString = getString(value);
	if (!asString) {
		return null;
	}

	const cleaned = asString.replace(',', '.');
	const parsed = Number(cleaned);
	return Number.isFinite(parsed) ? parsed : null;
}

function findFirstString(record: UnknownRecord, keys: string[]): string | null {
	for (const key of keys) {
		if (key in record) {
			const value = getString(record[key]);
			if (value) {
				return value;
			}
		}
	}
	return null;
}

function extractForecastRoot(raw: unknown): UnknownRecord | null {
	if (Array.isArray(raw) && raw.length > 0) {
		return asRecord(raw[0]);
	}
	return asRecord(raw);
}

function parseDailyWeather(raw: unknown): DailyWeather[] {
	const root = extractForecastRoot(raw);
	if (!root) {
		return [];
	}

	const prediction = asRecord(root.prediccion);
	const days = asArray<unknown>(prediction?.dia);

	const daily = days
		.map((day) => parseDailyEntry(day))
		.filter((item): item is DailyWeather => item !== null)
		.sort((a, b) => a.isoDate.localeCompare(b.isoDate));

	return daily;
}

function parseDailyEntry(rawDay: unknown): DailyWeather | null {
	const day = asRecord(rawDay);
	if (!day) {
		return null;
	}

	const isoDate = extractIsoDate(day.fecha);
	if (!isoDate) {
		return null;
	}

	const temperature = asRecord(day.temperatura);
	const minTemperatureC = toNumber(temperature?.minima);
	const maxTemperatureC = toNumber(temperature?.maxima);

	const precipitationProbabilityPercent = extractMaxValue(day.probPrecipitacion);
	const description = extractDescription(day.estadoCielo);

	return {
		isoDate,
		minTemperatureC,
		maxTemperatureC,
		precipitationProbabilityPercent,
		description,
		condition: inferCondition(description, precipitationProbabilityPercent)
	};
}

function parseHourlyWeather(raw: unknown): HourlyWeather[] {
	const root = extractForecastRoot(raw);
	if (!root) {
		return [];
	}

	const prediction = asRecord(root.prediccion);
	const days = asArray<unknown>(prediction?.dia);
	const results: HourlyWeather[] = [];

	for (const rawDay of days) {
		const day = asRecord(rawDay);
		if (!day) {
			continue;
		}

		const isoDate = extractIsoDate(day.fecha);
		if (!isoDate) {
			continue;
		}

		const slots = new Map<
			string,
			{
				temperatureC: number | null;
				humidityPercent: number | null;
				precipitationProbabilityPercent: number | null;
				windKmh: number | null;
				description: string | null;
			}
		>();

		const setSlot = (
			hour: string,
			updater: (
				current: {
					temperatureC: number | null;
					humidityPercent: number | null;
					precipitationProbabilityPercent: number | null;
					windKmh: number | null;
					description: string | null;
				}
			) => void
		): void => {
			if (!slots.has(hour)) {
				slots.set(hour, {
					temperatureC: null,
					humidityPercent: null,
					precipitationProbabilityPercent: null,
					windKmh: null,
					description: null
				});
			}

			const current = slots.get(hour);
			if (!current) {
				return;
			}

			updater(current);
		};

		const temperatureEntries = getSeriesEntries(day.temperatura);
		for (const entry of temperatureEntries) {
			const hours = extractHoursFromValue(entry.hora ?? entry.periodo);
			if (!hours.length) {
				continue;
			}

			const value = toNumber(entry.value ?? entry.valor ?? entry.dato);
			for (const hour of hours) {
				setSlot(hour, (slot) => {
					slot.temperatureC = value;
				});
			}
		}

		const humidityEntries = getSeriesEntries(day.humedadRelativa);
		for (const entry of humidityEntries) {
			const hours = extractHoursFromValue(entry.hora ?? entry.periodo);
			if (!hours.length) {
				continue;
			}

			const value = toNumber(entry.value ?? entry.valor ?? entry.dato);
			for (const hour of hours) {
				setSlot(hour, (slot) => {
					slot.humidityPercent = value;
				});
			}
		}

		const precipEntries = getSeriesEntries(day.probPrecipitacion);
		for (const entry of precipEntries) {
			const hours = extractHoursFromValue(entry.hora ?? entry.periodo);
			if (!hours.length) {
				continue;
			}

			const value = toNumber(entry.value ?? entry.valor ?? entry.dato);
			for (const hour of hours) {
				setSlot(hour, (slot) => {
					slot.precipitationProbabilityPercent =
						slot.precipitationProbabilityPercent === null
							? value
							: Math.max(slot.precipitationProbabilityPercent, value ?? 0);
				});
			}
		}

		const skyEntries = getSeriesEntries(day.estadoCielo);
		for (const entry of skyEntries) {
			const hours = extractHoursFromValue(entry.hora ?? entry.periodo);
			if (!hours.length) {
				continue;
			}

			const description = getString(entry.descripcion) ?? getString(entry.value);
			for (const hour of hours) {
				setSlot(hour, (slot) => {
					if (!slot.description && description) {
						slot.description = description;
					}
				});
			}
		}

		const windEntries = [...getSeriesEntries(day.viento), ...getSeriesEntries(day.vientoAndRachaMax)];
		for (const entry of windEntries) {
			const speedFromVelocity = toNumber(entry.velocidad);
			const speedFallback = toNumber(entry.value ?? entry.valor);
			const speed = speedFromVelocity ?? speedFallback;
			if (speed === null) {
				continue;
			}

			const hours = extractHoursFromValue(entry.hora ?? entry.periodo);
			if (!hours.length) {
				continue;
			}

			for (const hour of hours) {
				setSlot(hour, (slot) => {
					// Prefer explicit wind speed over fallback values from mixed series.
					if (speedFromVelocity !== null || slot.windKmh === null) {
						slot.windKmh = speed;
					}
				});
			}
		}

		for (const [hour, slot] of slots) {
			const isoTime = `${isoDate}T${hour}:00:00`;
			const condition = inferCondition(slot.description, slot.precipitationProbabilityPercent);

			results.push({
				isoTime,
				temperatureC: slot.temperatureC,
				humidityPercent: slot.humidityPercent,
				precipitationProbabilityPercent: slot.precipitationProbabilityPercent,
				windKmh: slot.windKmh,
				description: slot.description,
				condition
			});
		}
	}

	return results.sort((a, b) => a.isoTime.localeCompare(b.isoTime)).slice(0, 72);
}

function pickCurrentHour(hourly: HourlyWeather[]): HourlyWeather | null {
	if (!hourly.length) {
		return null;
	}

	const now = Date.now();
	let winner = hourly[0];
	let bestDiff = Number.POSITIVE_INFINITY;

	for (const hour of hourly) {
		const date = Date.parse(hour.isoTime);
		if (Number.isNaN(date)) {
			continue;
		}

		const diff = Math.abs(date - now);
		if (diff < bestDiff) {
			bestDiff = diff;
			winner = hour;
		}
	}

	return winner;
}

function extractIsoDate(value: unknown): string | null {
	const raw = getString(value);
	if (!raw) {
		return null;
	}

	const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) {
		return null;
	}

	return `${match[1]}-${match[2]}-${match[3]}`;
}

function getSeriesEntries(value: unknown): UnknownRecord[] {
	const fromArray = asArray<unknown>(value)
		.map((item) => asRecord(item))
		.filter((item): item is UnknownRecord => item !== null);

	if (fromArray.length > 0) {
		return fromArray;
	}

	const record = asRecord(value);
	if (!record) {
		return [];
	}

	return asArray<unknown>(record.dato)
		.map((item) => asRecord(item))
		.filter((item): item is UnknownRecord => item !== null);
}

function extractHoursFromValue(value: unknown): string[] {
	const raw = getString(value);
	if (!raw) {
		return [];
	}

	return expandPeriodToHours(raw);
}

function expandPeriodToHours(period: string): string[] {
	const normalized = period.replace(/\s+/g, '').trim();
	if (!normalized) {
		return [];
	}

	const singleHour = normalized.match(/^(\d{1,2})$/);
	if (singleHour) {
		const hour = Number(singleHour[1]);
		return Number.isFinite(hour) ? [toHourString(hour)] : [];
	}

	const withDash = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
	if (withDash) {
		return expandHourRange(Number(withDash[1]), Number(withDash[2]));
	}

	const compactRange = normalized.match(/^(\d{2})(\d{2})$/);
	if (compactRange) {
		return expandHourRange(Number(compactRange[1]), Number(compactRange[2]));
	}

	return [];
}

function expandHourRange(startRaw: number, endRaw: number): string[] {
	if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) {
		return [];
	}

	const start = ((startRaw % 24) + 24) % 24;
	const endNormalized = endRaw === 24 ? 24 : ((endRaw % 24) + 24) % 24;

	if (endNormalized === start) {
		return [toHourString(start)];
	}

	if (endNormalized === 24 && start < 24) {
		const hours: string[] = [];
		for (let hour = start; hour < 24; hour += 1) {
			hours.push(toHourString(hour));
		}
		return hours;
	}

	if (endNormalized > start) {
		const hours: string[] = [];
		for (let hour = start; hour < endNormalized; hour += 1) {
			hours.push(toHourString(hour));
		}
		return hours;
	}

	const wrappedHours: string[] = [];
	for (let hour = start; hour < 24; hour += 1) {
		wrappedHours.push(toHourString(hour));
	}
	for (let hour = 0; hour < endNormalized; hour += 1) {
		wrappedHours.push(toHourString(hour));
	}
	return wrappedHours;
}

function toHourString(value: number): string {
	const hour = ((value % 24) + 24) % 24;
	return hour.toString().padStart(2, '0');
}

function extractMaxValue(value: unknown): number | null {
	const items = asArray<unknown>(value);
	let maxValue: number | null = null;

	for (const entry of items) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}

		const candidate = toNumber(record.value ?? record.valor ?? record.dato);
		if (candidate === null) {
			continue;
		}

		maxValue = maxValue === null ? candidate : Math.max(maxValue, candidate);
	}

	return maxValue;
}

function extractDescription(value: unknown): string | null {
	const entries = asArray<unknown>(value);
	for (const entry of entries) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}

		const description = getString(record.descripcion) ?? getString(record.value);
		if (description) {
			return description;
		}
	}

	return null;
}

function inferCondition(
	description: string | null,
	precipitationProbabilityPercent: number | null
): WeatherCondition {
	const text = normalizeSearchValue(description ?? '');

	if (text.includes('torment')) {
		return 'storm';
	}
	if (text.includes('nieve') || text.includes('granizo')) {
		return 'snow';
	}
	if (
		text.includes('lluv') ||
		text.includes('chubasc') ||
		text.includes('precipit') ||
		(precipitationProbabilityPercent !== null && precipitationProbabilityPercent >= 60)
	) {
		return 'rain';
	}
	if (text.includes('niebla') || text.includes('bruma') || text.includes('calima')) {
		return 'fog';
	}
	if (text.includes('despej') || text.includes('solead')) {
		return 'clear';
	}
	if (text.includes('nub') || text.includes('cubierto')) {
		return 'cloudy';
	}

	return 'unknown';
}

function buildLandscapeQueries(name: string, province: string | null): string[] {
	const base = name.trim();
	const provinceText = province?.trim();
	const queries = [
		`city landscape ${base}`,
		`${base} city landscape`,
		`${base} city skyline`,
		`${base} old town`,
		`${base} urban architecture`,
		`${base} spain city landscape`,
		provinceText ? `${base} ${provinceText} city landscape` : null
	].filter((item): item is string => Boolean(item));

	return [...new Set(queries.map((item) => item.replace(/\s+/g, ' ').trim()))];
}

interface FlickrPublicFeedItem {
	title?: string;
	link?: string;
	author?: string;
	tags?: string;
	media?: {
		m?: string;
	};
}

interface FlickrPublicFeedResponse {
	items?: FlickrPublicFeedItem[];
}

async function fetchFlickrLandscapeImage(query: string): Promise<WeatherImage | null> {
	const tags = query
		.toLowerCase()
		.split(/\s+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 2)
		.slice(0, 8)
		.join(',');

	if (!tags) {
		return null;
	}

	const url = `https://www.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&lang=en-us&tagmode=all&tags=${encodeURIComponent(tags)}`;

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				accept: 'application/json'
			},
			signal: AbortSignal.timeout(6_000)
		});

		if (!response.ok) {
			return null;
		}

		const body = (await response.json()) as FlickrPublicFeedResponse;
		const items = asArray<FlickrPublicFeedItem>(body.items);

		for (const item of items) {
			const imageUrl = getString(item.media?.m);
			if (!imageUrl) {
				continue;
			}

			const title = getString(item.title);
			const tagsText = getString(item.tags);
			if (looksLikeNonLandscapeImage(title, tagsText, imageUrl)) {
				continue;
			}

			const authorName = extractFlickrAuthorName(getString(item.author));
			const highResUrl = imageUrl.replace(/_m\.(jpg|jpeg|png)$/i, '_z.$1');
			const attributionText = [title, authorName, 'Flickr'].filter(Boolean).join(' · ');

			return {
				url: highResUrl,
				attributionText: attributionText || 'Flickr',
				attributionUrl: getString(item.link)
			};
		}
	} catch {
		return null;
	}

	return null;
}

function looksLikeNonLandscapeImage(
	title: string | null,
	tags: string | null,
	imageUrl: string
): boolean {
	const haystack = normalizeSearchValue(`${title ?? ''} ${tags ?? ''} ${imageUrl}`);
	const blockedTerms = [
		'logo',
		'escudo',
		'coat of arms',
		'emblem',
		'flag',
		'bandera',
		'seal',
		'shield',
		'icon',
		'mapa',
		'map',
		'vector',
		'illustration',
		'clipart'
	];

	return blockedTerms.some((term) => haystack.includes(normalizeSearchValue(term)));
}

function extractFlickrAuthorName(raw: string | null): string | null {
	if (!raw) {
		return null;
	}

	const match = raw.match(/"([^"]+)"/);
	if (match?.[1]) {
		return match[1];
	}

	return raw.replace(/nobody@flickr\.com\s*/i, '').trim() || null;
}

function buildWikipediaTitleCandidates(name: string, province: string | null): string[] {
	const candidates = [name, `${name} (Spain)`];
	if (province) {
		candidates.push(`${name}, ${province}`);
	}

	return [...new Set(candidates)];
}

interface WikipediaSummaryResponse {
	title?: string;
	thumbnail?: {
		source?: string;
	};
	originalimage?: {
		source?: string;
	};
	content_urls?: {
		desktop?: {
			page?: string;
		};
	};
}

async function fetchWikipediaImage(
	language: string,
	title: string
): Promise<WeatherImage | null> {
	const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				accept: 'application/json'
			},
			signal: AbortSignal.timeout(6_000)
		});

		if (!response.ok) {
			return null;
		}

		const body = (await response.json()) as WikipediaSummaryResponse;
		const imageUrl = body.originalimage?.source ?? body.thumbnail?.source;
		if (!imageUrl) {
			return null;
		}

		return {
			url: imageUrl,
			attributionText: body.title ? `${body.title} · Wikipedia` : 'Wikipedia',
			attributionUrl: body.content_urls?.desktop?.page ?? null
		};
	} catch {
		return null;
	}
}

