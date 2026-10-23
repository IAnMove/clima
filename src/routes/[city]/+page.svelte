<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import WeatherFxLayer from '$lib/components/weather-fx-layer.svelte';
	import type { WeatherRenderer } from '$lib/components/weather-fx/types';
	import type { Municipality } from '$lib/domain/municipality';
	import type { WeatherCondition, WeatherImage } from '$lib/domain/weather';
	import { labelFromSlug } from '$lib/seo';
	import { toSlug } from '$lib/utils/text';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();

	type GenericPayload = Record<string, any>;
	type FlickrFeedItem = {
		title?: string;
		link?: string;
		author?: string;
		tags?: string;
		media?: {
			m?: string;
		};
	};
	type FlickrFeedResponse = {
		items?: FlickrFeedItem[];
	};
	type ViewMode = 'photo' | 'minimal' | 'all-info';
	type IconName =
		| 'arrow-left'
		| 'photo'
		| 'city'
		| 'list'
		| 'image'
		| 'droplet'
		| 'umbrella'
		| 'humidity'
		| 'wind'
		| 'pin'
		| 'chevron-left'
		| 'chevron-right'
		| 'refresh'
		| 'alert'
		| 'search'
		| 'shuffle'
		| 'upload'
		| 'undo'
		| 'clock'
		| 'calendar'
		| 'home'
		| 'external';

	let mode = $state<ViewMode>('photo');
	let hourlyPage = $state(0);
	let dailyPage = $state(0);
	let forcedCondition = $state<WeatherCondition | null>(null);
	let selectedRenderer = $state<WeatherRenderer>('canvas2d');
	let autoRenderer = $state<WeatherRenderer>('canvas2d');
	let resolvedRenderer = $state<WeatherRenderer>('canvas2d');
	let debugPrecipitationPercent = $state(0);
	let debugPrecipitationSeed = $state('');
	let imageMenuOpen = $state(false);
	let customImage = $state<WeatherImage | null>(null);
	let imageMenuError = $state<string | null>(null);
	let loadingRandomImage = $state(false);
	let customObjectUrl = $state<string | null>(null);
	let imageSeed = $state('');
	let now = $state(new Date());
	let visualsReady = $state(false);
	let debugTimeOffsetMinutes = $state(0);
	let selectedProvince = $state('');
	let provinceMunicipalities = $state<Municipality[]>([]);
	let loadingProvinceMunicipalities = $state(false);
	let provinceMunicipalityError = $state<string | null>(null);
	let prefersReducedMotion = $state(false);
	let retrying = $state(false);
	let imageMenuWrap = $state<HTMLDivElement | null>(null);
	let imageMenuToggleEl = $state<HTMLButtonElement | null>(null);

	const availableConditions: WeatherCondition[] = [
		'clear',
		'cloudy',
		'rain',
		'snow',
		'storm',
		'fog',
		'unknown'
	];
	const conditionSet = new Set<WeatherCondition>(availableConditions);
	const availableRenderers: WeatherRenderer[] = ['canvas2d', 'pixijs'];
	const modeOptions: Array<{ value: ViewMode; label: string; icon: IconName }> = [
		{ value: 'photo', label: 'Foto', icon: 'photo' },
		{ value: 'minimal', label: 'Ilustración', icon: 'city' },
		{ value: 'all-info', label: 'Detalle', icon: 'list' }
	];

	const payload = $derived((data.payload ?? {}) as GenericPayload);
	const status = $derived(payload.status ?? 'error');
	const isDebugMode = $derived(Boolean(data.isDebugMode));
	const report = $derived(status === 'ok' ? (payload.report as GenericPayload) : null);
	const municipality = $derived(
		status === 'ok' ? (payload.municipality as GenericPayload | null) : null
	);
	const placeName = $derived.by(() => {
		const fromReport = report?.location?.name;
		const fromMunicipality = municipality?.name;
		if (typeof fromReport === 'string' && fromReport.trim()) {
			return fromReport.trim();
		}
		if (typeof fromMunicipality === 'string' && fromMunicipality.trim()) {
			return fromMunicipality.trim();
		}
		return labelFromSlug(String(data.citySlug ?? ''));
	});
	const hourly = $derived((report?.hourly as GenericPayload[] | undefined) ?? []);
	const daily = $derived((report?.daily as GenericPayload[] | undefined) ?? []);

	const weatherCondition = $derived<WeatherCondition>(
		normalizeWeatherCondition(report?.current?.condition ?? daily[0]?.condition)
	);
	const activeWeatherCondition = $derived<WeatherCondition>(
		isDebugMode ? (forcedCondition ?? weatherCondition) : weatherCondition
	);
	const activeRenderer = $derived<WeatherRenderer>(isDebugMode ? selectedRenderer : autoRenderer);
	const isRendererFallback = $derived(
		isDebugMode && activeRenderer === 'pixijs' && resolvedRenderer === 'canvas2d'
	);
	const currentWindKmh = $derived(
		typeof report?.current?.windKmh === 'number' && Number.isFinite(report.current.windKmh)
			? report.current.windKmh
			: 0
	);
	const currentPrecipitationProbability = $derived(
		typeof report?.current?.precipitationProbabilityPercent === 'number' &&
			Number.isFinite(report.current.precipitationProbabilityPercent)
			? report.current.precipitationProbabilityPercent
			: 0
	);
	const currentHumidity = $derived(
		typeof report?.current?.humidityPercent === 'number' &&
			Number.isFinite(report.current.humidityPercent)
			? clampPercent(report.current.humidityPercent)
			: null
	);
	const activePrecipitationProbability = $derived(
		isDebugMode
			? clampPercent(debugPrecipitationPercent)
			: clampPercent(currentPrecipitationProbability)
	);
	const precipitationLevelLabel = $derived(
		resolvePrecipitationLevelLabel(activeWeatherCondition, activePrecipitationProbability)
	);
	const fxActive = $derived(mode !== 'all-info' && (isDebugMode || !prefersReducedMotion));

	const hourlyChunks = $derived(chunk(hourly, 12));
	const dailyChunks = $derived(chunk(daily, 5));
	const visibleHourly = $derived(hourlyChunks[hourlyPage] ?? []);
	const visibleDaily = $derived(dailyChunks[dailyPage] ?? []);
	const compactMode = $derived(mode !== 'all-info');
	const serverImage = $derived((report?.backgroundImage as WeatherImage | null) ?? null);
	const activeImage = $derived(customImage ?? serverImage);
	const activeClock = $derived(
		isDebugMode
			? new Date(now.getTime() + clampDebugTimeOffset(debugTimeOffsetMinutes) * 60_000)
			: now
	);
	const currentHourDecimal = $derived(activeClock.getHours() + activeClock.getMinutes() / 60);
	const isDaytime = $derived(currentHourDecimal >= 6 && currentHourDecimal < 18);
	const showNightIcon = $derived(visualsReady && !isDaytime);
	const daylightStrength = $derived(resolveDaylightStrength(currentHourDecimal));
	const celestialProgress = $derived(resolveCelestialProgress(currentHourDecimal, isDaytime));
	const celestialXPercent = $derived(8 + 84 * celestialProgress);
	const celestialYPercent = $derived(68 - Math.sin(Math.PI * celestialProgress) * 46);
	const celestialStyle = $derived(
		`left:${celestialXPercent.toFixed(2)}%; top:${celestialYPercent.toFixed(2)}%;`
	);
	const sceneToneStyle = $derived(buildSceneToneStyle(daylightStrength));
	const debugClockLabel = $derived(formatClockLabel(activeClock));
	const debugOffsetLabel = $derived(formatOffsetLabel(clampDebugTimeOffset(debugTimeOffsetMinutes)));
	const clampedDebugOffsetMinutes = $derived(clampDebugTimeOffset(debugTimeOffsetMinutes));

	onMount(() => {
		visualsReady = true;
		autoRenderer = detectPreferredRenderer();

		const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const syncReducedMotion = () => {
			prefersReducedMotion = reducedMotionQuery.matches;
		};
		syncReducedMotion();
		reducedMotionQuery.addEventListener('change', syncReducedMotion);

		const tickMs = isDebugMode ? 1_000 : 60_000;
		const timer = window.setInterval(() => {
			now = new Date();
		}, tickMs);

		return () => {
			window.clearInterval(timer);
			reducedMotionQuery.removeEventListener('change', syncReducedMotion);
		};
	});

	$effect(() => {
		const maxHourlyPage = Math.max(0, hourlyChunks.length - 1);
		if (hourlyPage > maxHourlyPage) {
			hourlyPage = maxHourlyPage;
		}
	});

	$effect(() => {
		const maxDailyPage = Math.max(0, dailyChunks.length - 1);
		if (dailyPage > maxDailyPage) {
			dailyPage = maxDailyPage;
		}
	});

	$effect(() => {
		selectedProvince = data.province;
		provinceMunicipalities = [];
		provinceMunicipalityError = null;
		imageMenuOpen = false;
		if (!isDebugMode) {
			selectedRenderer = 'canvas2d';
			resolvedRenderer = 'canvas2d';
			debugPrecipitationPercent = clampPercent(currentPrecipitationProbability);
			debugPrecipitationSeed = '';
			debugTimeOffsetMinutes = 0;
		}
	});

	$effect(() => {
		const nextSeed = String(report?.location?.code ?? data.citySlug ?? '');
		if (!nextSeed || nextSeed === imageSeed) {
			return;
		}

		imageSeed = nextSeed;
		imageMenuOpen = false;
		revokeCustomObjectUrl();
		customImage = null;
		imageMenuError = null;
		loadingRandomImage = false;
	});

	onDestroy(() => {
		revokeCustomObjectUrl();
	});

	$effect(() => {
		if (!isDebugMode) {
			return;
		}

		const seed = String(report?.location?.code ?? data.citySlug ?? '');
		if (!seed || seed === debugPrecipitationSeed) {
			return;
		}

		debugPrecipitationPercent = clampPercent(currentPrecipitationProbability);
		debugPrecipitationSeed = seed;
	});

	function chunk<T>(items: T[], size: number): T[][] {
		if (!items.length || size <= 0) {
			return [];
		}

		const output: T[][] = [];
		for (let index = 0; index < items.length; index += size) {
			output.push(items.slice(index, index + size));
		}
		return output;
	}

	function normalizeWeatherCondition(value: unknown): WeatherCondition {
		if (typeof value !== 'string') {
			return 'unknown';
		}

		const normalized = value.trim().toLowerCase();
		return conditionSet.has(normalized as WeatherCondition)
			? (normalized as WeatherCondition)
			: 'unknown';
	}

	function resolvePrecipitationLevelLabel(
		condition: WeatherCondition,
		precipitationProbabilityPercent: number
	): 'baja' | 'media' | 'alta' | 'sin precipitación' {
		if (condition !== 'rain' && condition !== 'snow' && condition !== 'storm') {
			return 'sin precipitación';
		}

		if (precipitationProbabilityPercent < 30) {
			return 'baja';
		}
		if (precipitationProbabilityPercent < 70) {
			return 'media';
		}
		return 'alta';
	}

	function capitalize(value: string): string {
		return value ? value.charAt(0).toLocaleUpperCase('es-ES') + value.slice(1) : value;
	}

	function formatTemp(value: unknown): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '--';
		}
		return `${Math.round(value)}\u00b0`;
	}

	function formatPercent(value: unknown): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '--';
		}
		return `${Math.round(value)}%`;
	}

	function formatWind(value: unknown): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '--';
		}
		return `${Math.round(value)} km/h`;
	}

	function clampPercent(value: number): number {
		if (!Number.isFinite(value)) {
			return 0;
		}

		return Math.min(100, Math.max(0, Math.round(value)));
	}

	function detectPreferredRenderer(): WeatherRenderer {
		if (typeof window === 'undefined') {
			return 'canvas2d';
		}

		const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
		const isNarrow = window.matchMedia('(max-width: 900px)').matches;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		return (isCoarsePointer || isNarrow) && !reducedMotion ? 'pixijs' : 'canvas2d';
	}

	function clampDebugTimeOffset(value: number): number {
		if (!Number.isFinite(value)) {
			return 0;
		}

		return Math.min(10_080, Math.max(-10_080, Math.round(value)));
	}

	function resolveCelestialProgress(hourDecimal: number, daylight: boolean): number {
		const safeHour = Number.isFinite(hourDecimal) ? hourDecimal : 12;
		if (daylight) {
			return clampUnit((safeHour - 6) / 12);
		}

		const wrappedHour = safeHour >= 18 ? safeHour : safeHour + 24;
		return clampUnit((wrappedHour - 18) / 12);
	}

	function clampUnit(value: number): number {
		return Math.min(1, Math.max(0, value));
	}

	function smoothstepUnit(value: number): number {
		const clamped = clampUnit(value);
		return clamped * clamped * (3 - 2 * clamped);
	}

	function resolveDaylightStrength(hourDecimal: number): number {
		const safeHour = Number.isFinite(hourDecimal) ? ((hourDecimal % 24) + 24) % 24 : 12;
		const dawnStart = 4.5;
		const sunrise = 7;
		const noon = 12;
		const lateAfternoon = 18.5;
		const duskEnd = 21.5;

		if (safeHour < dawnStart || safeHour >= duskEnd) {
			return 0;
		}

		if (safeHour < sunrise) {
			return smoothstepUnit((safeHour - dawnStart) / (sunrise - dawnStart)) * 0.55;
		}

		if (safeHour <= noon) {
			return 0.55 + smoothstepUnit((safeHour - sunrise) / (noon - sunrise)) * 0.45;
		}

		if (safeHour <= lateAfternoon) {
			return 0.55 + smoothstepUnit((lateAfternoon - safeHour) / (lateAfternoon - noon)) * 0.45;
		}

		return smoothstepUnit((duskEnd - safeHour) / (duskEnd - lateAfternoon)) * 0.55;
	}

	function mixChannel(start: number, end: number, amount: number): number {
		return Math.round(start + (end - start) * clampUnit(amount));
	}

	function mixAlpha(start: number, end: number, amount: number): number {
		return start + (end - start) * clampUnit(amount);
	}

	function mixRgb(
		start: [number, number, number],
		end: [number, number, number],
		amount: number
	): string {
		return `rgb(${mixChannel(start[0], end[0], amount)}, ${mixChannel(start[1], end[1], amount)}, ${mixChannel(
			start[2],
			end[2],
			amount
		)})`;
	}

	function mixRgba(
		start: [number, number, number, number],
		end: [number, number, number, number],
		amount: number
	): string {
		return `rgba(${mixChannel(start[0], end[0], amount)}, ${mixChannel(start[1], end[1], amount)}, ${mixChannel(
			start[2],
			end[2],
			amount
		)}, ${mixAlpha(start[3], end[3], amount).toFixed(3)})`;
	}

	function buildSceneToneStyle(daylight: number): string {
		const day = clampUnit(daylight);
		const night = 1 - day;

		return [
			`--daylight:${day.toFixed(3)}`,
			`--night:${night.toFixed(3)}`,
			`--scene-bg-top:${mixRgb([12, 45, 63], [137, 199, 227], day)}`,
			`--scene-bg-bottom:${mixRgb([6, 21, 32], [54, 126, 162], day)}`,
			`--sky-sun-glow:${mixRgba([255, 188, 106, 0.28], [255, 226, 168, 0.58], day)}`,
			`--sky-cyan-glow:${mixRgba([63, 161, 192, 0.12], [130, 222, 239, 0.36], day)}`,
			`--overlay-top:${mixRgba([8, 25, 35, 0.25], [14, 49, 69, 0.06], day)}`,
			`--overlay-mid:${mixRgba([7, 22, 32, 0.78], [22, 76, 102, 0.38], day)}`,
			`--overlay-bottom:${mixRgba([5, 18, 27, 0.98], [20, 67, 92, 0.54], day)}`,
			`--surface:${mixRgba([6, 26, 34, 0.74], [14, 57, 80, 0.46], day)}`,
			`--surface-strong:${mixRgba([6, 26, 34, 0.86], [13, 53, 74, 0.6], day)}`,
			`--text-strong:${mixRgb([235, 247, 252], [247, 252, 255], day)}`,
			`--text-soft:${mixRgb([189, 217, 228], [218, 237, 245], day)}`,
			`--chip-color:${mixRgb([255, 214, 130], [255, 201, 108], day)}`,
			`--control-bg:${mixRgba([8, 29, 41, 0.72], [19, 73, 97, 0.56], day)}`,
			`--control-bg-strong:${mixRgba([8, 33, 45, 0.68], [24, 82, 108, 0.58], day)}`,
			`--control-border:${mixRgba([170, 214, 224, 0.3], [196, 230, 238, 0.5], day)}`,
			`--control-text:${mixRgb([225, 243, 250], [236, 249, 253], day)}`,
			`--panel-heading:${mixRgb([154, 214, 228], [126, 197, 217], day)}`,
			`--city-haze:${mixRgba([173, 226, 240, 0.21], [206, 239, 248, 0.3], day)}`,
			`--city-ridge-back:${mixRgba([181, 219, 231, 0.18], [231, 246, 251, 0.35], day)}`,
			`--city-ridge-mid:${mixRgba([167, 212, 226, 0.22], [225, 244, 250, 0.4], day)}`,
			`--city-ridge-front:${mixRgba([193, 233, 241, 0.16], [238, 251, 255, 0.44], day)}`,
			`--city-facade:${mixRgba([10, 38, 56, 0.56], [41, 108, 138, 0.42], day)}`,
			`--city-facade-front:${mixRgba([7, 26, 39, 0.86], [24, 87, 116, 0.62], day)}`,
			`--city-waterline:${mixRgba([73, 155, 180, 0.1], [150, 221, 236, 0.24], day)}`,
			`--city-road:${mixRgba([4, 19, 29, 0.74], [18, 77, 104, 0.44], day)}`,
			`--city-window:${mixRgba([255, 226, 154, 0.84], [255, 248, 201, 0.7], day)}`
		].join(';');
	}

	function onDebugPrecipitationInput(event: Event): void {
		const target = event.currentTarget as HTMLInputElement | null;
		if (!target) {
			return;
		}

		debugPrecipitationPercent = clampPercent(Number(target.value));
	}

	function onDebugTimeOffsetInput(event: Event): void {
		const target = event.currentTarget as HTMLInputElement | null;
		if (!target) {
			return;
		}

		debugTimeOffsetMinutes = clampDebugTimeOffset(Number(target.value));
	}

	function shiftDebugTimeOffset(minutesDelta: number): void {
		debugTimeOffsetMinutes = clampDebugTimeOffset(debugTimeOffsetMinutes + minutesDelta);
	}

	function formatClockLabel(value: Date): string {
		const hours = String(value.getHours()).padStart(2, '0');
		const minutes = String(value.getMinutes()).padStart(2, '0');
		return `${hours}:${minutes}`;
	}

	function formatOffsetLabel(offsetMinutes: number): string {
		if (offsetMinutes === 0) {
			return 'sin desfase';
		}

		const sign = offsetMinutes > 0 ? '+' : '-';
		const absOffset = Math.abs(offsetMinutes);
		const hours = Math.floor(absOffset / 60);
		const minutes = absOffset % 60;
		return `${sign}${hours}h ${String(minutes).padStart(2, '0')}m`;
	}

	function toggleImageMenu(): void {
		imageMenuOpen = !imageMenuOpen;
		if (imageMenuOpen) {
			imageMenuError = null;
		}
	}

	function onWindowPointerDown(event: PointerEvent): void {
		if (!imageMenuOpen || !imageMenuWrap) {
			return;
		}
		if (event.target instanceof Node && !imageMenuWrap.contains(event.target)) {
			imageMenuOpen = false;
		}
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && imageMenuOpen) {
			imageMenuOpen = false;
			imageMenuToggleEl?.focus();
		}
	}

	async function applyRandomImage(): Promise<void> {
		if (loadingRandomImage) {
			return;
		}

		const cityName = String(report?.location?.name ?? municipality?.name ?? data.citySlug ?? '').trim();
		if (!cityName) {
			imageMenuError = 'No hay ciudad para buscar imagen';
			return;
		}

		loadingRandomImage = true;
		imageMenuError = null;

		try {
			const provinceName = String(report?.location?.province ?? municipality?.province ?? '').trim();
			const currentUrl = activeImage?.url ?? '';
			const flickrCandidates = await fetchFlickrCityImages(cityName, provinceName || null);
			const fallbackCandidates = buildCityScopedFallbackCandidates(cityName, provinceName || null);
			const candidates = dedupeImages([...flickrCandidates, ...fallbackCandidates]).filter(
				(item) => item.url !== currentUrl
			);

			if (!candidates.length) {
				imageMenuError = 'No encontré otra imagen de esta ciudad ahora mismo';
				return;
			}

			revokeCustomObjectUrl();
			customImage = candidates[Math.floor(Math.random() * candidates.length)];
			imageMenuOpen = false;
		} catch {
			imageMenuError = 'No se pudo cargar otra imagen de esta ciudad';
		} finally {
			loadingRandomImage = false;
		}
	}

	function onCustomImageFileChange(event: Event): void {
		const target = event.currentTarget as HTMLInputElement | null;
		if (!target) {
			return;
		}

		const file = target.files?.[0];
		target.value = '';

		if (!file) {
			return;
		}

		if (!file.type.startsWith('image/')) {
			imageMenuError = 'El archivo debe ser una imagen';
			return;
		}

		revokeCustomObjectUrl();
		const objectUrl = URL.createObjectURL(file);
		customObjectUrl = objectUrl;
		customImage = {
			url: objectUrl,
			attributionText: `Archivo local - ${file.name}`,
			attributionUrl: null
		};
		imageMenuError = null;
		imageMenuOpen = false;
	}

	function restoreServerImage(): void {
		revokeCustomObjectUrl();
		customImage = null;
		imageMenuError = null;
		imageMenuOpen = false;
	}

	function buildCityScopedFallbackCandidates(cityName: string, provinceName: string | null): WeatherImage[] {
		const query = `${cityName} ${provinceName ?? ''} city landscape`.trim();
		const nonce = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;

		return [
			{
				url: `https://source.unsplash.com/1920x1080/?${encodeURIComponent(query)}&sig=${encodeURIComponent(nonce)}`,
				attributionText: `Aleatoria de ${cityName} · Unsplash Source`,
				attributionUrl: 'https://source.unsplash.com'
			},
			{
				url: `https://loremflickr.com/1920/1080/${encodeURIComponent(
					`${cityName},${provinceName ?? ''},city,landscape`
				)}?lock=${encodeURIComponent(nonce)}`,
				attributionText: `Aleatoria de ${cityName} · LoremFlickr`,
				attributionUrl: 'https://loremflickr.com'
			}
		];
	}

	async function fetchFlickrCityImages(cityName: string, provinceName: string | null): Promise<WeatherImage[]> {
		const queryVariants = [
			`${cityName} ${provinceName ?? ''} city landscape`,
			`${cityName} skyline`,
			`${cityName} old town`
		];

		const results: WeatherImage[] = [];
		for (const query of queryVariants) {
			const tags = query
				.toLowerCase()
				.split(/\s+/)
				.map((word) => word.trim())
				.filter((word) => word.length >= 2)
				.slice(0, 8)
				.join(',');

			if (!tags) {
				continue;
			}

			const url = `https://www.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&lang=en-us&tagmode=all&tags=${encodeURIComponent(tags)}`;
			try {
				const response = await fetch(url);
				if (!response.ok) {
					continue;
				}

				const payload = (await response.json()) as FlickrFeedResponse;
				const items = Array.isArray(payload.items) ? payload.items : [];
				for (const item of items) {
					const imageUrl = item.media?.m?.trim();
					if (!imageUrl) {
						continue;
					}

					const metadata = `${item.title ?? ''} ${item.tags ?? ''}`.toLowerCase();
					if (
						metadata.includes('logo') ||
						metadata.includes('escudo') ||
						metadata.includes('bandera') ||
						metadata.includes('flag') ||
						metadata.includes('map')
					) {
						continue;
					}

					results.push({
						url: imageUrl.replace(/_m\.(jpg|jpeg|png)$/i, '_z.$1'),
						attributionText: [item.title, 'Flickr'].filter(Boolean).join(' · '),
						attributionUrl: item.link ?? null
					});
				}
			} catch {
				continue;
			}
		}

		return dedupeImages(results);
	}

	function dedupeImages(images: WeatherImage[]): WeatherImage[] {
		const seen = new Set<string>();
		const deduped: WeatherImage[] = [];
		for (const item of images) {
			if (!item.url || seen.has(item.url)) {
				continue;
			}
			seen.add(item.url);
			deduped.push(item);
		}
		return deduped;
	}

	function revokeCustomObjectUrl(): void {
		if (!customObjectUrl) {
			return;
		}

		URL.revokeObjectURL(customObjectUrl);
		customObjectUrl = null;
	}

	function toBackgroundImageCss(url: string): string {
		return url.replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
	}

	function formatDate(isoDate: unknown): string {
		if (typeof isoDate !== 'string') {
			return '--';
		}
		const parsed = new Date(isoDate);
		if (Number.isNaN(parsed.getTime())) {
			return isoDate;
		}
		return parsed.toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	}

	function formatTime(isoTime: unknown): string {
		if (typeof isoTime !== 'string') {
			return '--:--';
		}

		const parsed = new Date(isoTime);
		if (Number.isNaN(parsed.getTime())) {
			return isoTime;
		}
		return parsed.toLocaleTimeString('es-ES', {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function openCandidate(candidate: Municipality): void {
		const query = new URLSearchParams();
		query.set('code', candidate.code);
		if (candidate.province) {
			query.set('province', candidate.province);
		}
		void goto(`/${toSlug(candidate.name)}?${query.toString()}`);
	}

	async function loadProvinceMunicipalities() {
		if (!selectedProvince.trim()) {
			return;
		}

		loadingProvinceMunicipalities = true;
		provinceMunicipalityError = null;

		try {
			const response = await fetch(
				`/api/municipalities?province=${encodeURIComponent(selectedProvince.trim())}`
			);
			const responsePayload = (await response.json()) as {
				municipalities?: Municipality[];
				message?: string;
			};

			if (!response.ok || !responsePayload.municipalities) {
				provinceMunicipalityError =
					responsePayload.message ?? 'No se pudieron cargar municipios de la provincia';
				provinceMunicipalities = [];
				return;
			}

			provinceMunicipalities = responsePayload.municipalities;
		} catch {
			provinceMunicipalityError = 'No se pudieron cargar municipios de la provincia';
			provinceMunicipalities = [];
		} finally {
			loadingProvinceMunicipalities = false;
		}
	}

	function searchProvince(event: SubmitEvent): void {
		event.preventDefault();
		void loadProvinceMunicipalities();
	}

	async function retryLoad(): Promise<void> {
		if (retrying) {
			return;
		}
		retrying = true;
		try {
			await invalidateAll();
		} finally {
			retrying = false;
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

{#snippet icon(name: IconName)}
	<svg
		class="ico"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if name === 'arrow-left'}
			<path d="M19 12H5M11 18l-6-6 6-6" />
		{:else if name === 'photo'}
			<rect x="3" y="5" width="18" height="14" rx="2.5" />
			<circle cx="9" cy="10" r="1.6" />
			<path d="M21 16l-5-5-8 8" />
		{:else if name === 'city'}
			<path d="M3 21h18M5 21V10l4-2v13M9 21V5l6 3v13M15 21v-9l4 2v7" />
		{:else if name === 'list'}
			<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
		{:else if name === 'image'}
			<rect x="3" y="3" width="18" height="18" rx="3" />
			<circle cx="8.5" cy="8.5" r="1.5" />
			<path d="M21 15l-5-5L5 21" />
		{:else if name === 'droplet'}
			<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z" />
		{:else if name === 'umbrella'}
			<path d="M3 12a9 9 0 0 1 18 0H3z" />
			<path d="M12 12v6a2 2 0 0 1-4 0" />
		{:else if name === 'humidity'}
			<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z" />
			<path d="M8.5 14.5c1.2.8 2.3.8 3.5 0s2.3-.8 3.5 0" />
		{:else if name === 'wind'}
			<path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5M3 12h15.5a2.5 2.5 0 1 1-2.5 2.5M3 16h7" />
		{:else if name === 'pin'}
			<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
			<circle cx="12" cy="9.5" r="2.5" />
		{:else if name === 'chevron-left'}
			<path d="M15 18l-6-6 6-6" />
		{:else if name === 'chevron-right'}
			<path d="M9 18l6-6-6-6" />
		{:else if name === 'refresh'}
			<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
		{:else if name === 'alert'}
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7.5v5.5M12 16.5h.01" />
		{:else if name === 'search'}
			<circle cx="11" cy="11" r="6.5" />
			<path d="M20 20l-4.2-4.2" />
		{:else if name === 'shuffle'}
			<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
		{:else if name === 'upload'}
			<path d="M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
		{:else if name === 'undo'}
			<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
		{:else if name === 'clock'}
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7v5l3 2" />
		{:else if name === 'calendar'}
			<rect x="3.5" y="5" width="17" height="15" rx="2.5" />
			<path d="M3.5 10h17M8 3v4M16 3v4" />
		{:else if name === 'home'}
			<path d="M3 11l9-7 9 7M5 10v10h14V10" />
		{:else if name === 'external'}
			<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
		{/if}
	</svg>
{/snippet}

{#snippet weatherIcon(condition: WeatherCondition, night: boolean)}
	<svg
		class="wi"
		viewBox="0 0 48 48"
		fill="none"
		stroke="currentColor"
		stroke-width="2.4"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if condition === 'clear' && night}
			<path class="wi-moon" d="M36 29.5A13 13 0 1 1 18.5 12a10.5 10.5 0 0 0 17.5 17.5z" />
			<path class="wi-star" d="M35 9v4M33 11h4M40 18v2M39 19h2" />
		{:else if condition === 'clear'}
			<circle class="wi-sun-core" cx="24" cy="24" r="8" />
			<path
				class="wi-sun"
				d="M24 6v4M24 38v4M6 24h4M38 24h4M11.3 11.3l2.8 2.8M33.9 33.9l2.8 2.8M11.3 36.7l2.8-2.8M33.9 14.1l2.8-2.8"
			/>
		{:else if condition === 'cloudy'}
			<path class="wi-cloud" d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" />
		{:else if condition === 'rain'}
			<g transform="translate(0 -6)">
				<path class="wi-cloud" d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" />
			</g>
			<path class="wi-rain" d="M18 35l-2 6M26 35l-2 6M34 35l-2 6" />
		{:else if condition === 'snow'}
			<g transform="translate(0 -6)">
				<path class="wi-cloud" d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" />
			</g>
			<circle class="wi-snow" cx="17" cy="38" r="1.8" />
			<circle class="wi-snow" cx="25" cy="42" r="1.8" />
			<circle class="wi-snow" cx="33" cy="38" r="1.8" />
		{:else if condition === 'storm'}
			<g transform="translate(0 -6)">
				<path class="wi-cloud" d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" />
			</g>
			<path class="wi-bolt" d="M26 30l-5 8h6l-4 7" />
		{:else if condition === 'fog'}
			<g transform="translate(0 -7)">
				<path class="wi-cloud" d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" />
			</g>
			<path class="wi-fog" d="M9 35h30M13 41h22" />
		{:else}
			<circle class="wi-sun-core" cx="16" cy="16" r="5.5" />
			<path class="wi-sun" d="M16 5v2.5M5 16h2.5M8.2 8.2l1.8 1.8M23.8 8.2 22 10" />
			<g transform="translate(4 2)">
				<path class="wi-cloud" d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" />
			</g>
		{/if}
	</svg>
{/snippet}

<main id="contenido" class="page" tabindex="-1">
	{#if status === 'ok' && report}
		<div
			class={`scene mode-${mode} condition-${activeWeatherCondition} ${compactMode ? 'compact' : ''}`}
			style={visualsReady ? sceneToneStyle : undefined}
		>
			{#if mode === 'photo' && activeImage?.url}
				<div class="photo" style={`background-image:url('${toBackgroundImageCss(activeImage.url)}')`}></div>
			{/if}

			<div class="gradient"></div>
			{#if mode === 'minimal'}
				<div class={`minimal-city-layer ${isDaytime ? 'day' : 'night'}`}>
					<div
						class={`celestial-body ${isDaytime ? 'sun' : 'moon'}`}
						style={celestialStyle}
						aria-hidden="true"
					></div>
					<svg class="minimal-city-svg" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
						<defs>
							<linearGradient id="city-backdrop" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color="rgba(152, 214, 233, 0.2)" />
								<stop offset="100%" stop-color="rgba(15, 34, 48, 0.02)" />
							</linearGradient>
							<linearGradient id="skyline-back-fill" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color="rgba(52, 96, 123, 0.56)" />
								<stop offset="100%" stop-color="rgba(27, 59, 80, 0.72)" />
							</linearGradient>
							<linearGradient id="skyline-mid-fill" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color="rgba(33, 74, 99, 0.72)" />
								<stop offset="100%" stop-color="rgba(16, 46, 66, 0.84)" />
							</linearGradient>
							<linearGradient id="skyline-front-fill" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color="rgba(17, 48, 68, 0.94)" />
								<stop offset="100%" stop-color="rgba(8, 28, 42, 0.98)" />
							</linearGradient>
							<linearGradient id="city-ground-fill" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color="rgba(10, 37, 53, 0.84)" />
								<stop offset="100%" stop-color="rgba(4, 21, 32, 1)" />
							</linearGradient>
						</defs>
						<rect x="0" y="0" width="1600" height="900" fill="url(#city-backdrop)" />
						<ellipse class="city-haze" cx="800" cy="695" rx="760" ry="142"></ellipse>

						<g class="skyline skyline-back">
							<path
								class="skyline-fill-back"
								d="M0 675 L48 675 L48 612 L98 612 L98 675 L156 675 L156 544 L190 544 L206 518 L222 544 L262 544 L262 675 L324 675 L324 585 L372 585 L372 675 L430 675 L430 520 L472 520 L472 675 L548 675 L548 560 L588 560 L606 534 L624 560 L672 560 L672 675 L740 675 L740 598 L798 598 L798 675 L872 675 L872 540 L918 540 L918 675 L994 675 L994 575 L1042 575 L1042 675 L1116 675 L1116 548 L1154 548 L1174 508 L1194 548 L1246 548 L1246 675 L1320 675 L1320 594 L1378 594 L1378 675 L1450 675 L1450 534 L1496 534 L1496 675 L1600 675 L1600 900 L0 900 Z"
							></path>
							<path
								class="skyline-ridge skyline-ridge-back"
								d="M0 675 L48 675 L48 612 L98 612 L98 675 L156 675 L156 544 L190 544 L206 518 L222 544 L262 544 L262 675 L324 675 L324 585 L372 585 L372 675 L430 675 L430 520 L472 520 L472 675 L548 675 L548 560 L588 560 L606 534 L624 560 L672 560 L672 675 L740 675 L740 598 L798 598 L798 675 L872 675 L872 540 L918 540 L918 675 L994 675 L994 575 L1042 575 L1042 675 L1116 675 L1116 548 L1154 548 L1174 508 L1194 548 L1246 548 L1246 675 L1320 675 L1320 594 L1378 594 L1378 675 L1450 675 L1450 534 L1496 534 L1496 675 L1600 675"
							></path>
						</g>

						<g class="skyline skyline-mid">
							<path
								class="skyline-fill-mid"
								d="M0 760 L70 760 L70 646 L124 646 L124 760 L186 760 L186 606 L254 606 L254 760 L332 760 L332 636 L384 636 L384 760 L468 760 L468 590 L522 590 L522 760 L602 760 L602 624 L660 624 L660 760 L742 760 L742 566 L798 566 L798 760 L876 760 L876 622 L936 622 L936 760 L1012 760 L1012 586 L1070 586 L1070 760 L1148 760 L1148 630 L1212 630 L1212 760 L1286 760 L1286 596 L1348 596 L1348 760 L1424 760 L1424 642 L1488 642 L1488 760 L1600 760 L1600 900 L0 900 Z"
							></path>
							<path
								class="skyline-ridge skyline-ridge-mid"
								d="M0 760 L70 760 L70 646 L124 646 L124 760 L186 760 L186 606 L254 606 L254 760 L332 760 L332 636 L384 636 L384 760 L468 760 L468 590 L522 590 L522 760 L602 760 L602 624 L660 624 L660 760 L742 760 L742 566 L798 566 L798 760 L876 760 L876 622 L936 622 L936 760 L1012 760 L1012 586 L1070 586 L1070 760 L1148 760 L1148 630 L1212 630 L1212 760 L1286 760 L1286 596 L1348 596 L1348 760 L1424 760 L1424 642 L1488 642 L1488 760 L1600 760"
							></path>
							<rect class="skyline-facade skyline-facade-mid" x="220" y="628" width="28" height="132"></rect>
							<rect class="skyline-facade skyline-facade-mid" x="492" y="610" width="22" height="150"></rect>
							<rect class="skyline-facade skyline-facade-mid" x="764" y="588" width="24" height="172"></rect>
							<rect class="skyline-facade skyline-facade-mid" x="1038" y="602" width="26" height="158"></rect>
							<rect class="skyline-facade skyline-facade-mid" x="1316" y="618" width="24" height="142"></rect>
						</g>

						<g class="skyline skyline-front">
							<path
								class="skyline-fill-front"
								d="M0 900 L0 835 L84 835 L84 728 L146 728 L146 835 L230 835 L230 690 L300 690 L300 835 L384 835 L384 702 L440 702 L470 668 L500 702 L560 702 L560 835 L644 835 L644 648 L724 648 L724 835 L806 835 L806 712 L868 712 L868 835 L956 835 L956 666 L1032 666 L1032 835 L1118 835 L1118 718 L1186 718 L1186 835 L1274 835 L1274 680 L1352 680 L1352 835 L1442 835 L1442 736 L1512 736 L1512 835 L1600 835 L1600 900 Z"
							></path>
							<path
								class="skyline-ridge skyline-ridge-front"
								d="M0 835 L84 835 L84 728 L146 728 L146 835 L230 835 L230 690 L300 690 L300 835 L384 835 L384 702 L440 702 L470 668 L500 702 L560 702 L560 835 L644 835 L644 648 L724 648 L724 835 L806 835 L806 712 L868 712 L868 835 L956 835 L956 666 L1032 666 L1032 835 L1118 835 L1118 718 L1186 718 L1186 835 L1274 835 L1274 680 L1352 680 L1352 835 L1442 835 L1442 736 L1512 736 L1512 835 L1600 835"
							></path>
							<path
								class="skyline-facade skyline-facade-front"
								d="M938 835 L938 642 L968 642 L968 614 L982 590 L996 614 L996 642 L1026 642 L1026 835 Z"
							></path>
							<path
								class="skyline-facade skyline-facade-front"
								d="M658 835 L658 662 L678 662 L678 632 L694 612 L710 632 L710 662 L730 662 L730 835 Z"
							></path>
						</g>

						<path class="skyline-waterline" d="M0 760 C230 742 420 782 650 766 C885 748 1060 784 1290 770 C1410 762 1514 762 1600 772 L1600 820 L0 820 Z"></path>
						<rect class="skyline-ground" x="0" y="790" width="1600" height="110"></rect>
						<path class="skyline-road" d="M0 815 C220 802 456 832 688 818 C986 798 1276 832 1600 816 L1600 900 L0 900 Z"></path>

						<g class="skyline-windows skyline-windows-back">
							<rect class="skyline-window" x="176" y="574" width="8" height="10"></rect>
							<rect class="skyline-window" x="342" y="612" width="7" height="9"></rect>
							<rect class="skyline-window" x="438" y="552" width="8" height="10"></rect>
							<rect class="skyline-window" x="582" y="596" width="7" height="9"></rect>
							<rect class="skyline-window" x="748" y="620" width="8" height="10"></rect>
							<rect class="skyline-window" x="896" y="572" width="8" height="10"></rect>
							<rect class="skyline-window" x="1030" y="608" width="7" height="9"></rect>
							<rect class="skyline-window" x="1162" y="566" width="8" height="10"></rect>
							<rect class="skyline-window" x="1332" y="626" width="7" height="9"></rect>
							<rect class="skyline-window" x="1468" y="566" width="8" height="10"></rect>
						</g>

						<g class="skyline-windows skyline-windows-mid">
							<rect class="skyline-window" x="92" y="696" width="8" height="10"></rect>
							<rect class="skyline-window" x="220" y="672" width="8" height="10"></rect>
							<rect class="skyline-window" x="342" y="686" width="8" height="10"></rect>
							<rect class="skyline-window" x="494" y="660" width="8" height="10"></rect>
							<rect class="skyline-window" x="618" y="688" width="8" height="10"></rect>
							<rect class="skyline-window" x="766" y="646" width="8" height="10"></rect>
							<rect class="skyline-window" x="892" y="684" width="8" height="10"></rect>
							<rect class="skyline-window" x="1038" y="664" width="8" height="10"></rect>
							<rect class="skyline-window" x="1168" y="692" width="8" height="10"></rect>
							<rect class="skyline-window" x="1318" y="662" width="8" height="10"></rect>
							<rect class="skyline-window" x="1454" y="698" width="8" height="10"></rect>
						</g>

						<g class="skyline-windows skyline-windows-front">
							<rect class="skyline-window" x="102" y="776" width="9" height="12"></rect>
							<rect class="skyline-window" x="248" y="744" width="9" height="12"></rect>
							<rect class="skyline-window" x="408" y="756" width="9" height="12"></rect>
							<rect class="skyline-window" x="518" y="742" width="9" height="12"></rect>
							<rect class="skyline-window" x="676" y="726" width="9" height="12"></rect>
							<rect class="skyline-window" x="832" y="764" width="9" height="12"></rect>
							<rect class="skyline-window" x="982" y="718" width="9" height="12"></rect>
							<rect class="skyline-window" x="1142" y="770" width="9" height="12"></rect>
							<rect class="skyline-window" x="1306" y="734" width="9" height="12"></rect>
							<rect class="skyline-window" x="1462" y="776" width="9" height="12"></rect>
						</g>
					</svg>
				</div>
			{/if}
			<div class="fx-host">
				<WeatherFxLayer
					condition={activeWeatherCondition}
					windKmh={currentWindKmh}
					precipitationProbabilityPercent={activePrecipitationProbability}
					renderer={activeRenderer}
					active={fxActive}
					onRendererResolved={(resolved) => (resolvedRenderer = resolved)}
				/>
			</div>

			<div class={`content ${compactMode ? 'content-compact' : ''}`}>
				<header class="topbar">
					<a class="home-link" href="/">
						{@render icon('arrow-left')}
						<span>Clima Visual</span>
					</a>

					<div class="hero-controls">
						<div class="mode-switch" role="group" aria-label="Modo visual">
							{#each modeOptions as option (option.value)}
								<button
									type="button"
									aria-pressed={mode === option.value}
									onclick={() => (mode = option.value)}
								>
									{@render icon(option.icon)}
									<span>{option.label}</span>
								</button>
							{/each}
						</div>

						{#if mode === 'photo'}
							<div class="image-menu-wrap" bind:this={imageMenuWrap}>
								<button
									class="image-menu-toggle"
									type="button"
									onclick={toggleImageMenu}
									aria-expanded={imageMenuOpen}
									aria-controls="image-menu"
									bind:this={imageMenuToggleEl}
								>
									{@render icon('image')}
									<span>Cambiar imagen</span>
								</button>
								{#if imageMenuOpen}
									<div id="image-menu" class="image-menu" role="group" aria-label="Opciones de imagen de fondo">
										<button
											type="button"
											class="menu-item"
											onclick={() => void applyRandomImage()}
											disabled={loadingRandomImage}
											aria-busy={loadingRandomImage}
										>
											{#if loadingRandomImage}
												<span class="spinner menu-spinner" aria-hidden="true"></span>
												<span class="menu-title">Buscando…</span>
											{:else}
												{@render icon('shuffle')}
												<span class="menu-title">Aleatoria de esta ciudad</span>
											{/if}
										</button>
										<label class="menu-item menu-file">
											{@render icon('upload')}
											<span class="menu-text">
												<span class="menu-title">Imagen de tu dispositivo</span>
												<span class="menu-note">No se sube al servidor</span>
											</span>
											<input
												class="visually-hidden"
												type="file"
												accept="image/*"
												onchange={onCustomImageFileChange}
											/>
										</label>
										<button
											type="button"
											class="menu-item"
											onclick={restoreServerImage}
											disabled={!customImage}
										>
											{@render icon('undo')}
											<span class="menu-title">Volver a la original</span>
										</button>
										{#if imageMenuError}
											<p class="image-menu-error" role="alert">
												{@render icon('alert')}
												{imageMenuError}
											</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</header>

				<div class="title-block">
					<p class="chip">Fuente: {payload.provider?.toUpperCase() ?? 'API'}</p>
					<h1>Tiempo en {placeName}</h1>
					<p class="subtitle">
						{@render icon('pin')}
						<span>
							{report.location?.province ?? municipality?.province ?? 'Espa\u00f1a'} &middot; c&oacute;digo
							{report.location?.code ?? municipality?.code}
						</span>
					</p>
				</div>

				{#if isDebugMode}
					<section class="debug-panel" aria-label="Panel de depuración">
						<p class="debug-title">Debug clima</p>
						<p class="debug-label">Renderer</p>
						<div class="renderer-buttons">
							{#each availableRenderers as rendererOption}
								<button
									type="button"
									class:selected={rendererOption === activeRenderer}
									aria-pressed={rendererOption === activeRenderer}
									onclick={() => (selectedRenderer = rendererOption)}
								>
									{rendererOption}
								</button>
							{/each}
						</div>
						<p class="debug-info">
							Activo: <strong>{resolvedRenderer}</strong>
							{#if isRendererFallback}
								<span>(alternativa por incompatibilidad WebGL/Pixi)</span>
							{/if}
						</p>
						<p class="debug-label">Condici&oacute;n</p>
						<div class="debug-buttons">
							{#each availableConditions as condition}
								<button
									type="button"
									class:selected={condition === activeWeatherCondition}
									aria-pressed={condition === activeWeatherCondition}
									onclick={() => (forcedCondition = condition)}
								>
									{condition}
								</button>
							{/each}
						</div>
						<div class="debug-precipitation">
							<div class="debug-head">
								<p class="debug-label">% precipitaci&oacute;n</p>
								<strong>{activePrecipitationProbability}%</strong>
							</div>
							<input
								class="debug-range"
								type="range"
								min="0"
								max="100"
								step="1"
								value={activePrecipitationProbability}
								oninput={onDebugPrecipitationInput}
								aria-label="Porcentaje de precipitación"
							/>
							<input
								class="debug-number debug-number-short"
								type="number"
								min="0"
								max="100"
								step="1"
								value={activePrecipitationProbability}
								oninput={onDebugPrecipitationInput}
								aria-label="Porcentaje de precipitación (número)"
							/>
						</div>
						<div class="debug-time">
							<div class="debug-head">
								<p class="debug-label">Reloj ilustración</p>
								<strong>{visualsReady ? debugClockLabel : '--:--'}</strong>
							</div>
							<p class="debug-info">
								Real: {visualsReady ? formatClockLabel(now) : '--:--'} &middot; desfase: {debugOffsetLabel}
							</p>
							<input
								class="debug-number"
								type="number"
								min="-10080"
								max="10080"
								step="1"
								value={clampedDebugOffsetMinutes}
								oninput={onDebugTimeOffsetInput}
								aria-label="Desfase en minutos para sol y luna"
							/>
							<div class="debug-time-buttons">
								<button type="button" onclick={() => shiftDebugTimeOffset(-60)}>-60m</button>
								<button type="button" onclick={() => shiftDebugTimeOffset(-15)}>-15m</button>
								<button type="button" onclick={() => shiftDebugTimeOffset(15)}>+15m</button>
								<button type="button" onclick={() => shiftDebugTimeOffset(60)}>+60m</button>
								<button type="button" onclick={() => (debugTimeOffsetMinutes = 0)}>Ahora</button>
							</div>
						</div>
					</section>
				{/if}

				<section class="current" aria-labelledby="current-heading">
					<h2 id="current-heading" class="visually-hidden">Tiempo actual</h2>
					<div class="current-main">
						<span class="current-icon">{@render weatherIcon(activeWeatherCondition, showNightIcon)}</span>
						<p class="big-temp">{formatTemp(report.current?.temperatureC)}</p>
						<p class="summary">{report.current?.description ?? 'Sin descripci\u00f3n'}</p>
					</div>

					<dl class="metrics">
						<div class="metric">
							<dt>{@render icon('droplet')} Precipitaci&oacute;n</dt>
							<dd>
								<span>{formatPercent(activePrecipitationProbability)}</span>
								<span class="meter" aria-hidden="true">
									<span style={`width:${activePrecipitationProbability}%`}></span>
								</span>
							</dd>
						</div>
						<div class="metric">
							<dt>{@render icon('umbrella')} Intensidad</dt>
							<dd><span>{capitalize(precipitationLevelLabel)}</span></dd>
						</div>
						<div class="metric">
							<dt>{@render icon('humidity')} Humedad</dt>
							<dd>
								<span>{formatPercent(report.current?.humidityPercent)}</span>
								{#if currentHumidity !== null}
									<span class="meter meter-humidity" aria-hidden="true">
										<span style={`width:${currentHumidity}%`}></span>
									</span>
								{/if}
							</dd>
						</div>
						<div class="metric">
							<dt>{@render icon('wind')} Viento</dt>
							<dd><span>{formatWind(report.current?.windKmh)}</span></dd>
						</div>
					</dl>
				</section>

				{#if mode === 'all-info'}
					<section class="panel" aria-labelledby="hourly-heading">
						<div class="panel-header">
							<h2 id="hourly-heading">{@render icon('clock')} Por horas</h2>
							{#if hourlyChunks.length > 1}
								<div class="pager">
									<button
										type="button"
										aria-label="Horas anteriores"
										disabled={hourlyPage <= 0}
										onclick={() => (hourlyPage = Math.max(0, hourlyPage - 1))}
									>
										{@render icon('chevron-left')}
									</button>
									<span aria-live="polite">
										<span class="visually-hidden">Página </span>{hourlyPage + 1}<span aria-hidden="true">/</span><span class="visually-hidden"> de </span>{hourlyChunks.length}
									</span>
									<button
										type="button"
										aria-label="Horas siguientes"
										disabled={hourlyPage >= hourlyChunks.length - 1}
										onclick={() => (hourlyPage = Math.min(hourlyChunks.length - 1, hourlyPage + 1))}
									>
										{@render icon('chevron-right')}
									</button>
								</div>
							{/if}
						</div>

						{#if visibleHourly.length > 0}
							<ol class="cards">
								{#each visibleHourly as hour}
									<li class="card">
										<p class="time">{formatTime(hour.isoTime)}</p>
										<span class="card-icon">
											{@render weatherIcon(normalizeWeatherCondition(hour.condition), false)}
										</span>
										<p class="card-temp">{formatTemp(hour.temperatureC)}</p>
										<p class="soft">{hour.description ?? 'Sin dato'}</p>
										<p class="rain">
											{@render icon('droplet')}
											{formatPercent(hour.precipitationProbabilityPercent)}
											<span class="visually-hidden">de probabilidad de lluvia</span>
										</p>
									</li>
								{/each}
							</ol>
						{:else}
							<p class="empty">No hay datos horarios disponibles.</p>
						{/if}
					</section>

					<section class="panel" aria-labelledby="daily-heading">
						<div class="panel-header">
							<h2 id="daily-heading">{@render icon('calendar')} Pr&oacute;ximos d&iacute;as</h2>
							{#if dailyChunks.length > 1}
								<div class="pager">
									<button
										type="button"
										aria-label="Días anteriores"
										disabled={dailyPage <= 0}
										onclick={() => (dailyPage = Math.max(0, dailyPage - 1))}
									>
										{@render icon('chevron-left')}
									</button>
									<span aria-live="polite">
										<span class="visually-hidden">Página </span>{dailyPage + 1}<span aria-hidden="true">/</span><span class="visually-hidden"> de </span>{dailyChunks.length}
									</span>
									<button
										type="button"
										aria-label="Días siguientes"
										disabled={dailyPage >= dailyChunks.length - 1}
										onclick={() => (dailyPage = Math.min(dailyChunks.length - 1, dailyPage + 1))}
									>
										{@render icon('chevron-right')}
									</button>
								</div>
							{/if}
						</div>

						{#if visibleDaily.length > 0}
							<ol class="cards cards-daily">
								{#each visibleDaily as day}
									<li class="card">
										<p class="time">{formatDate(day.isoDate)}</p>
										<span class="card-icon">
											{@render weatherIcon(normalizeWeatherCondition(day.condition), false)}
										</span>
										<p class="card-temp">
											<span class="visually-hidden">Máxima </span>{formatTemp(day.maxTemperatureC)}
											<span class="min"><span class="visually-hidden">, mínima </span>{formatTemp(day.minTemperatureC)}</span>
										</p>
										<p class="soft">{day.description ?? 'Sin dato'}</p>
										<p class="rain">
											{@render icon('droplet')}
											{formatPercent(day.precipitationProbabilityPercent)}
											<span class="visually-hidden">de probabilidad de lluvia</span>
										</p>
									</li>
								{/each}
							</ol>
						{:else}
							<p class="empty">No hay datos diarios disponibles.</p>
						{/if}
					</section>
				{/if}

				{#if mode === 'photo' && activeImage?.attributionText}
					<p class="attribution">
						{@render icon('photo')}
						<span>
							Imagen: {activeImage.attributionText}
							{#if activeImage.attributionUrl}
								&middot;
								<a href={activeImage.attributionUrl} target="_blank" rel="noreferrer">
									fuente<span class="visually-hidden"> (se abre en una pestaña nueva)</span>
								</a>
							{/if}
						</span>
					</p>
				{/if}
			</div>
		</div>
	{:else if status === 'ambiguous'}
		<div class="state-wrap">
			<section class="state" aria-labelledby="state-title">
				<a class="back-link" href="/">{@render icon('arrow-left')} Volver al inicio</a>
				<span class="state-icon">{@render icon('pin')}</span>
				<h1 id="state-title">Hay varios municipios llamados {placeName}</h1>
				{#if payload.message}
					<p class="state-lead">{payload.message}</p>
				{/if}
				<ul class="list">
					{#each (payload.candidates ?? []) as candidate}
						<li>
							<button type="button" class="candidate" onclick={() => openCandidate(candidate)}>
								<span class="candidate-icon">{@render icon('pin')}</span>
								<span class="candidate-text">
									<strong>{candidate.name}</strong>
									<span>{candidate.province ? candidate.province : 'Provincia desconocida'} · código {candidate.code}</span>
								</span>
								<span class="candidate-chevron">{@render icon('chevron-right')}</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	{:else if status === 'not_found'}
		<div class="state-wrap">
			<section class="state" aria-labelledby="state-title">
				<a class="back-link" href="/">{@render icon('arrow-left')} Volver al inicio</a>
				<span class="state-icon">{@render icon('search')}</span>
				<h1 id="state-title">No encontramos el municipio {placeName}</h1>
				{#if payload.message}
					<p class="state-lead">{payload.message}</p>
				{/if}

				{#if (payload.suggestions ?? []).length > 0}
					<h2>Sugerencias por nombre</h2>
					<ul class="list">
						{#each payload.suggestions as suggestion}
							<li>
								<button type="button" class="candidate" onclick={() => openCandidate(suggestion)}>
									<span class="candidate-icon">{@render icon('pin')}</span>
									<span class="candidate-text">
										<strong>{suggestion.name}</strong>
										<span>{suggestion.province ? suggestion.province : 'Provincia desconocida'} · código {suggestion.code}</span>
									</span>
									<span class="candidate-chevron">{@render icon('chevron-right')}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				{#if (payload.provinceSuggestions ?? []).length > 0}
					<h2>Provincias relacionadas</h2>
					<div class="province-list">
						{#each payload.provinceSuggestions as provinceSuggestion}
							<article class="province-card">
								<h3 class="province-title">
									{provinceSuggestion.province}
									<span>{provinceSuggestion.totalMunicipalities} municipios</span>
								</h3>
								<ul class="mini-list">
									{#each provinceSuggestion.municipalities as municipalityItem}
										<li>
											<button
												type="button"
												class="mini-candidate"
												onclick={() => openCandidate(municipalityItem)}
											>
												{municipalityItem.name}
											</button>
										</li>
									{/each}
								</ul>
							</article>
						{/each}
					</div>
				{/if}

				<h2>Listar municipios por provincia</h2>
				<form class="province-form" onsubmit={searchProvince}>
					<label for="province-search" class="visually-hidden">Provincia</label>
					<div class="control">
						<span class="control-icon">{@render icon('search')}</span>
						<input
							id="province-search"
							bind:value={selectedProvince}
							placeholder="Asturias"
							autocomplete="off"
							autocapitalize="words"
						/>
					</div>
					<button
						type="submit"
						class="btn-primary"
						disabled={loadingProvinceMunicipalities}
						aria-busy={loadingProvinceMunicipalities}
					>
						{#if loadingProvinceMunicipalities}
							<span class="spinner" aria-hidden="true"></span>
							Cargando…
						{:else}
							{@render icon('list')}
							Listar
						{/if}
					</button>
				</form>

				{#if provinceMunicipalityError}
					<p class="error" role="alert">{@render icon('alert')} {provinceMunicipalityError}</p>
				{/if}

				<p class="visually-hidden" aria-live="polite">
					{provinceMunicipalities.length > 0 ? `${provinceMunicipalities.length} municipios encontrados` : ''}
				</p>

				{#if provinceMunicipalities.length > 0}
					<ul class="list list-compact">
						{#each provinceMunicipalities as municipalityItem}
							<li>
								<button
									type="button"
									class="candidate"
									onclick={() => openCandidate(municipalityItem)}
								>
									<span class="candidate-text">
										<strong>{municipalityItem.name}</strong>
										<span>código {municipalityItem.code}</span>
									</span>
									<span class="candidate-chevron">{@render icon('chevron-right')}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	{:else}
		<div class="state-wrap">
			<section class="state state-error" aria-labelledby="state-title">
				<span class="state-icon">{@render icon('alert')}</span>
				<h1 id="state-title">Tiempo en {placeName}</h1>
				<p class="state-lead" role="alert">
					{payload.message ?? 'No se pudo obtener la informaci\u00f3n meteorol\u00f3gica.'}
				</p>
				<div class="state-actions">
					<button
						type="button"
						class="btn-primary"
						onclick={() => void retryLoad()}
						disabled={retrying}
						aria-busy={retrying}
					>
						{#if retrying}
							<span class="spinner" aria-hidden="true"></span>
							Reintentando…
						{:else}
							{@render icon('refresh')}
							Reintentar
						{/if}
					</button>
					<a class="btn-secondary" href="/">{@render icon('home')} Volver al inicio</a>
				</div>
			</section>
		</div>
	{/if}
</main>

<style>
	.page {
		min-height: 100vh;
		min-height: 100svh;
		padding: 0;
	}

	.page:focus {
		outline: none;
	}

	.ico {
		width: 1.1em;
		height: 1.1em;
		flex: none;
	}

	.wi {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.wi-sun {
		stroke: #ffc44d;
	}

	.wi-sun-core {
		stroke: #ffc44d;
		fill: rgba(255, 196, 77, 0.28);
	}

	.wi-moon {
		stroke: #e6eef7;
		fill: rgba(230, 238, 247, 0.18);
	}

	.wi-star {
		stroke: #ffe3a1;
		stroke-width: 1.8;
	}

	.wi-cloud {
		fill: rgba(232, 244, 248, 0.16);
	}

	.wi-rain {
		stroke: #7fd8ec;
	}

	.wi-snow {
		fill: #e8f4f8;
		stroke: none;
	}

	.wi-bolt {
		stroke: #ffc44d;
		fill: rgba(255, 196, 77, 0.3);
	}

	.wi-fog {
		stroke: #b8d4dd;
	}

	/* ---------- Escena ---------- */

	.scene {
		position: relative;
		width: 100%;
		min-height: 100vh;
		min-height: 100svh;
		margin: 0;
		overflow: hidden;
		color-scheme: dark;
		--focus: #ffd36b;
		--daylight: 0;
		--night: 1;
		--scene-bg-top: #10384a;
		--scene-bg-bottom: #0d2734;
		--sky-sun-glow: rgba(255, 188, 106, 0.28);
		--sky-cyan-glow: rgba(63, 161, 192, 0.12);
		--overlay-top: rgba(8, 25, 35, 0.25);
		--overlay-mid: rgba(7, 22, 32, 0.78);
		--overlay-bottom: rgba(5, 18, 27, 0.98);
		--chip-color: #ffd88b;
		--control-bg: rgba(8, 29, 41, 0.72);
		--control-bg-strong: rgba(8, 33, 45, 0.68);
		--control-border: rgba(170, 214, 224, 0.3);
		--control-text: #e3f3f8;
		--panel-heading: #9cd7e4;
		--city-haze: rgba(173, 226, 240, 0.21);
		--city-ridge-back: rgba(181, 219, 231, 0.18);
		--city-ridge-mid: rgba(167, 212, 226, 0.22);
		--city-ridge-front: rgba(193, 233, 241, 0.16);
		--city-facade: rgba(10, 38, 56, 0.56);
		--city-facade-front: rgba(7, 26, 39, 0.86);
		--city-waterline: rgba(73, 155, 180, 0.1);
		--city-road: rgba(4, 19, 29, 0.74);
		--city-window: rgba(255, 226, 154, 0.84);
		background: linear-gradient(180deg, var(--scene-bg-top), var(--scene-bg-bottom));
		transition: background 900ms linear;
	}

	.photo,
	.gradient,
	.minimal-city-layer,
	.fx-host {
		position: absolute;
		inset: 0;
	}

	.fx-host {
		pointer-events: none;
		z-index: 3;
	}

	.photo {
		z-index: 0;
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		filter:
			saturate(calc(0.92 + var(--daylight) * 0.28))
			contrast(calc(0.95 + var(--daylight) * 0.12))
			brightness(calc(0.72 + var(--daylight) * 0.34));
		transition: filter 900ms linear;
	}

	.gradient {
		z-index: 1;
		background:
			radial-gradient(circle at 20% 0%, var(--sky-sun-glow), transparent 42%),
			radial-gradient(circle at 90% 110%, var(--sky-cyan-glow), transparent 38%),
			linear-gradient(
				180deg,
				var(--overlay-top) 0%,
				var(--overlay-mid) 56%,
				var(--overlay-bottom) 100%
			);
		transition:
			background 900ms linear,
			opacity 900ms linear;
	}

	.mode-photo .gradient {
		background:
			linear-gradient(180deg, rgba(4, 16, 24, 0.55) 0%, rgba(4, 16, 24, 0) 28%),
			radial-gradient(circle at 20% 0%, var(--sky-sun-glow), transparent 42%),
			linear-gradient(
				180deg,
				var(--overlay-top) 0%,
				var(--overlay-mid) 56%,
				var(--overlay-bottom) 100%
			);
	}

	.minimal-city-layer {
		z-index: 2;
		pointer-events: none;
		filter:
			brightness(calc(0.72 + var(--daylight) * 0.46))
			saturate(calc(0.72 + var(--daylight) * 0.4));
		transition: filter 900ms linear;
	}

	.minimal-city-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.celestial-body {
		position: absolute;
		width: clamp(34px, 4vw, 62px);
		aspect-ratio: 1 / 1;
		transform: translate(-50%, -50%);
		border-radius: 999px;
	}

	.celestial-body.sun {
		background: radial-gradient(circle at 35% 30%, #fffbe5 0%, #ffd478 45%, #f59d32 100%);
		box-shadow:
			0 0 22px rgba(255, 208, 128, 0.8),
			0 0 65px rgba(255, 184, 102, 0.42);
	}

	.celestial-body.moon {
		background: radial-gradient(circle at 35% 28%, #fefefe 0%, #dbe6f2 50%, #aabed0 100%);
		box-shadow:
			0 0 20px rgba(201, 220, 238, 0.66),
			0 0 58px rgba(157, 191, 221, 0.32);
	}

	.celestial-body.moon::after {
		content: '';
		position: absolute;
		inset: 10% 0 0 28%;
		background: rgba(8, 28, 40, 0.6);
		border-radius: 999px;
	}

	.skyline {
		vector-effect: non-scaling-stroke;
	}

	.city-haze {
		fill: var(--city-haze);
		filter: blur(16px);
	}

	.skyline-fill-back {
		fill: url(#skyline-back-fill);
	}

	.skyline-fill-mid {
		fill: url(#skyline-mid-fill);
	}

	.skyline-fill-front {
		fill: url(#skyline-front-fill);
	}

	.skyline-ridge {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}

	.skyline-ridge-back {
		stroke: var(--city-ridge-back);
		stroke-width: 1.6px;
	}

	.skyline-ridge-mid {
		stroke: var(--city-ridge-mid);
		stroke-width: 1.8px;
	}

	.skyline-ridge-front {
		stroke: var(--city-ridge-front);
		stroke-width: 2px;
	}

	.skyline-facade {
		fill: var(--city-facade);
	}

	.skyline-facade-mid {
		opacity: 0.5;
	}

	.skyline-facade-front {
		fill: var(--city-facade-front);
	}

	.skyline-ground {
		fill: url(#city-ground-fill);
	}

	.skyline-waterline {
		fill: var(--city-waterline);
		filter: blur(1px);
	}

	.skyline-road {
		fill: var(--city-road);
	}

	.skyline-windows-back .skyline-window {
		opacity: calc(0.12 + var(--night) * 0.34);
	}

	.skyline-windows-mid .skyline-window {
		opacity: calc(0.18 + var(--night) * 0.42);
	}

	.skyline-windows-front .skyline-window {
		opacity: calc(0.24 + var(--night) * 0.54);
	}

	.skyline-window {
		fill: var(--city-window);
	}

	.mode-minimal .photo {
		display: none;
	}

	.mode-minimal .gradient {
		opacity: 1;
	}

	.mode-all-info .photo {
		display: none;
	}

	.mode-all-info .gradient {
		opacity: 0.9;
	}

	.mode-all-info .fx-host {
		opacity: 0;
		visibility: hidden;
	}

	/* ---------- Utilidades ---------- */

	.visually-hidden {
		position: absolute !important;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.spinner {
		display: inline-block;
		width: 1em;
		height: 1em;
		flex: none;
		border-radius: 999px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.scene :focus-visible,
	.state-wrap :focus-visible {
		outline: 2px solid var(--focus, #ffd36b);
		outline-offset: 2px;
	}

	/* ---------- Contenido ---------- */

	.content {
		position: relative;
		z-index: 4;
		padding: clamp(1rem, 2.5vw, 1.5rem);
		color: var(--text-strong);
		display: grid;
		gap: 1rem;
		width: min(1220px, 100%);
		margin: 0 auto;
	}

	.scene.compact {
		min-height: 100vh;
		min-height: 100svh;
	}

	.content-compact {
		max-width: 760px;
		margin: 0;
	}

	.topbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: space-between;
		align-items: center;
	}

	.home-link {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.5rem;
		padding: 0.35rem 0.8rem 0.35rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--control-border);
		background: var(--control-bg);
		color: var(--control-text);
		text-decoration: none;
		font-weight: 600;
		font-size: 0.9rem;
		backdrop-filter: blur(6px);
		transition: background 160ms ease, border-color 160ms ease;
	}

	.home-link:hover {
		background: var(--control-bg-strong);
		border-color: rgba(255, 255, 255, 0.5);
	}

	.hero-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: flex-end;
	}

	.mode-switch {
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 999px;
		background: var(--control-bg);
		border: 1px solid var(--control-border);
		backdrop-filter: blur(6px);
	}

	.mode-switch button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.25rem;
		border: 0;
		background: transparent;
		color: var(--text-soft);
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.86rem;
		cursor: pointer;
		transition: background 160ms ease, color 160ms ease;
	}

	.mode-switch button:hover {
		color: var(--text-strong);
		background: rgba(255, 255, 255, 0.08);
	}

	.mode-switch button[aria-pressed='true'] {
		background: linear-gradient(110deg, var(--accent, #ffc44d), #ffe099);
		color: #2f2810;
		font-weight: 700;
	}

	.image-menu-wrap {
		position: relative;
	}

	.image-menu-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.5rem;
		border: 1px solid var(--control-border);
		background: var(--control-bg-strong);
		color: var(--control-text);
		border-radius: 999px;
		padding: 0.35rem 0.85rem;
		font: inherit;
		font-size: 0.86rem;
		cursor: pointer;
		backdrop-filter: blur(6px);
		transition: background 160ms ease, border-color 160ms ease;
	}

	.image-menu-toggle:hover,
	.image-menu-toggle[aria-expanded='true'] {
		border-color: rgba(255, 255, 255, 0.55);
		background: var(--control-bg);
	}

	.image-menu {
		position: absolute;
		top: calc(100% + 0.4rem);
		right: 0;
		width: min(300px, 90vw);
		background: var(--surface-strong, rgba(6, 26, 34, 0.9));
		border: 1px solid var(--control-border);
		border-radius: 14px;
		padding: 0.4rem;
		display: grid;
		gap: 0.25rem;
		z-index: 10;
		backdrop-filter: blur(14px);
		box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-height: 2.6rem;
		border: 0;
		background: transparent;
		color: var(--control-text);
		border-radius: 10px;
		padding: 0.5rem 0.65rem;
		font: inherit;
		font-size: 0.86rem;
		text-align: left;
		cursor: pointer;
		transition: background 140ms ease;
	}

	.menu-item:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
	}

	.menu-item:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.menu-item[aria-busy='true'] {
		cursor: progress;
	}

	.menu-file:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.menu-text {
		display: grid;
		gap: 0.1rem;
	}

	.menu-title {
		font-weight: 600;
	}

	.menu-note {
		font-size: 0.74rem;
		color: var(--text-soft);
	}

	.menu-spinner {
		width: 1.1em;
		height: 1.1em;
	}

	.image-menu-error {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0.2rem 0.4rem 0.3rem;
		color: #ffd4c7;
		font-size: 0.8rem;
	}

	.title-block {
		display: grid;
		gap: 0.3rem;
		padding-top: clamp(0.5rem, 3vh, 2rem);
	}

	.chip {
		margin: 0;
		display: inline-block;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--chip-color);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.8rem, 5vw, 3rem);
		line-height: 1.05;
		text-wrap: balance;
		text-shadow: 0 2px 18px rgba(0, 0, 0, 0.35);
	}

	.subtitle {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		color: var(--text-soft);
	}

	/* ---------- Debug ---------- */

	.debug-panel {
		background: var(--surface-strong);
		border: 1px dashed var(--control-border);
		border-radius: 14px;
		padding: 0.75rem;
		display: grid;
		gap: 0.2rem;
		max-width: 520px;
	}

	.debug-title {
		margin: 0 0 0.35rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--panel-heading);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.debug-label {
		margin: 0 0 0.25rem;
		font-size: 0.72rem;
		letter-spacing: 0.05em;
		color: var(--text-soft);
		text-transform: uppercase;
	}

	.debug-info {
		margin: 0 0 0.4rem;
		font-size: 0.76rem;
		color: var(--text-soft);
	}

	.debug-info strong {
		color: var(--text-strong);
	}

	.debug-info span {
		color: #f7c17c;
	}

	.renderer-buttons {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.45rem;
	}

	.debug-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.debug-precipitation,
	.debug-time {
		margin-top: 0.55rem;
		display: grid;
		gap: 0.35rem;
	}

	.debug-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.debug-head .debug-label {
		margin: 0;
	}

	.debug-head strong {
		color: var(--text-strong);
		font-size: 0.82rem;
	}

	.debug-range {
		width: 100%;
		accent-color: var(--accent-2, #7de6ef);
	}

	.debug-number {
		width: 100%;
		border: 1px solid var(--control-border);
		background: var(--control-bg-strong);
		color: var(--control-text);
		border-radius: 8px;
		padding: 0.3rem 0.45rem;
		font: inherit;
		font-size: 0.8rem;
	}

	.debug-number-short {
		width: 84px;
	}

	.debug-time-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.renderer-buttons button,
	.debug-buttons button,
	.debug-time-buttons button {
		border: 1px solid var(--control-border);
		background: var(--control-bg-strong);
		color: var(--control-text);
		padding: 0.28rem 0.6rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.78rem;
		text-transform: capitalize;
		cursor: pointer;
	}

	.renderer-buttons button.selected,
	.debug-buttons button.selected {
		background: linear-gradient(110deg, #7de6ef, #f9d789);
		border-color: transparent;
		color: #163840;
		font-weight: 700;
	}

	/* ---------- Tiempo actual ---------- */

	.current {
		display: grid;
		grid-template-columns: minmax(0, auto) minmax(0, 1fr);
		gap: 1.25rem;
		align-items: center;
		padding: clamp(1rem, 2.5vw, 1.4rem);
		border-radius: 20px;
		background: var(--surface);
		border: 1px solid rgba(255, 255, 255, 0.08);
		backdrop-filter: blur(8px);
	}

	.current-main {
		display: grid;
		grid-template-columns: auto auto;
		grid-template-areas:
			'icon temp'
			'summary summary';
		align-items: center;
		column-gap: 0.75rem;
		row-gap: 0.35rem;
	}

	.current-icon {
		grid-area: icon;
		display: block;
		width: clamp(3.2rem, 9vw, 4.6rem);
		height: clamp(3.2rem, 9vw, 4.6rem);
		color: var(--text-strong);
	}

	.big-temp {
		grid-area: temp;
		margin: 0;
		font-size: clamp(3rem, 9vw, 5rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}

	.summary {
		grid-area: summary;
		margin: 0;
		color: var(--text-strong);
		font-size: 1.05rem;
		font-weight: 600;
	}

	.metrics {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.metric {
		display: grid;
		gap: 0.3rem;
		padding: 0.6rem 0.75rem;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.metric dt {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-soft);
	}

	.metric dd {
		margin: 0;
		display: grid;
		gap: 0.35rem;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--text-strong);
		font-variant-numeric: tabular-nums;
	}

	.meter {
		display: block;
		height: 4px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.14);
		overflow: hidden;
	}

	.meter > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, #7fd8ec, #4fb6e0);
		transition: width 400ms ease;
	}

	.meter-humidity > span {
		background: linear-gradient(90deg, #a6e3cf, #64c7b0);
	}

	.content-compact .current {
		background: var(--surface);
	}

	/* ---------- Paneles ---------- */

	.panel {
		background: var(--surface-strong);
		border-radius: 20px;
		padding: clamp(0.9rem, 2vw, 1.2rem);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.8rem;
		margin-bottom: 0.8rem;
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0;
		font-size: 1.05rem;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.88rem;
		color: var(--text-soft);
		font-variant-numeric: tabular-nums;
	}

	.pager button {
		display: inline-grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 1px solid var(--control-border);
		border-radius: 999px;
		background: var(--control-bg-strong);
		color: var(--text-strong);
		cursor: pointer;
		transition: background 140ms ease, opacity 140ms ease;
	}

	.pager button:hover:not(:disabled) {
		background: var(--control-bg);
	}

	.pager button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.6rem;
	}

	.cards-daily {
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	}

	.card {
		display: grid;
		justify-items: center;
		text-align: center;
		gap: 0.25rem;
		background: var(--surface);
		border-radius: 14px;
		padding: 0.75rem 0.6rem;
		border: 1px solid var(--control-border);
	}

	.card p {
		margin: 0;
	}

	.time {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--panel-heading);
		text-transform: capitalize;
	}

	.card-icon {
		display: block;
		width: 2.2rem;
		height: 2.2rem;
		color: var(--text-strong);
	}

	.card-temp {
		font-size: 1.15rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.card-temp .min {
		margin-left: 0.3rem;
		font-weight: 500;
		color: var(--text-soft);
	}

	.soft {
		font-size: 0.8rem;
		color: var(--text-soft);
		line-height: 1.3;
	}

	.rain {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: #9fe2f2;
		font-variant-numeric: tabular-nums;
	}

	.empty {
		margin: 0;
		color: var(--text-soft);
	}

	.attribution {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin: 0;
		color: var(--text-soft);
		font-size: 0.78rem;
	}

	.attribution .ico {
		margin-top: 0.1em;
	}

	.attribution a {
		color: var(--chip-color);
	}

	/* ---------- Estados ---------- */

	.state-wrap {
		--text-strong: #eef8fc;
		--text-soft: #bcd8e3;
		--focus: #ffd36b;
		color-scheme: dark;
		min-height: 100vh;
		min-height: 100svh;
		display: grid;
		place-items: start center;
		padding: clamp(1rem, 4vw, 3rem) clamp(0.75rem, 3vw, 1.5rem);
		background:
			radial-gradient(circle at 15% 0%, rgba(255, 196, 110, 0.14), transparent 45%),
			linear-gradient(180deg, #10384a, #071a25);
	}

	.state {
		width: min(760px, 100%);
		display: grid;
		gap: 0.75rem;
		background: linear-gradient(160deg, rgba(9, 35, 48, 0.92), rgba(7, 27, 39, 0.96));
		color: var(--text-strong);
		border: 1px solid rgba(188, 224, 232, 0.14);
		border-radius: 24px;
		padding: clamp(1.1rem, 3vw, 1.8rem);
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
	}

	.state h1 {
		font-size: clamp(1.5rem, 4vw, 2.2rem);
		text-shadow: none;
	}

	.state h2 {
		margin-top: 0.75rem;
		font-size: 1rem;
		color: #9cd7e4;
	}

	.state p {
		color: var(--text-soft);
	}

	.back-link {
		justify-self: start;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--text-soft);
		text-decoration: none;
		font-size: 0.88rem;
		padding: 0.25rem 0;
	}

	.back-link:hover {
		color: var(--text-strong);
	}

	.state-icon {
		display: inline-grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		border-radius: 999px;
		background: rgba(125, 216, 236, 0.12);
		color: #9fe2f2;
		font-size: 1.4rem;
	}

	.state-error .state-icon {
		background: rgba(255, 180, 150, 0.12);
		color: #ffc2ad;
	}

	.state-lead {
		margin: 0;
		font-size: 1rem;
		line-height: 1.5;
	}

	.state-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.5rem;
	}

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 2.75rem;
		padding: 0.6rem 1rem;
		border-radius: 12px;
		font: inherit;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
		transition: filter 140ms ease, background 140ms ease, opacity 140ms ease;
	}

	.btn-primary {
		border: 0;
		background: linear-gradient(120deg, #44d5da, #86f4f4);
		color: #083538;
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.06);
	}

	.btn-primary:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	.btn-secondary {
		border: 1px solid rgba(188, 224, 232, 0.3);
		background: rgba(10, 39, 50, 0.5);
		color: var(--text-strong);
	}

	.btn-secondary:hover {
		background: rgba(14, 52, 66, 0.7);
	}

	.list {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.list-compact {
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.4rem;
	}

	.candidate {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		min-height: 3rem;
		text-align: left;
		border: 1px solid rgba(188, 224, 232, 0.2);
		background: rgba(10, 39, 50, 0.5);
		color: var(--text-strong);
		padding: 0.65rem 0.8rem;
		border-radius: 14px;
		font: inherit;
		cursor: pointer;
		transition: background 140ms ease, border-color 140ms ease;
	}

	.candidate:hover {
		background: rgba(16, 56, 72, 0.7);
		border-color: rgba(188, 224, 232, 0.4);
	}

	.candidate-icon {
		display: inline-grid;
		place-items: center;
		color: #9fe2f2;
	}

	.candidate-text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.1rem;
	}

	.candidate-text span {
		font-size: 0.82rem;
		color: var(--text-soft);
	}

	.candidate-chevron {
		display: inline-grid;
		place-items: center;
		color: var(--text-soft);
		transition: transform 140ms ease;
	}

	.candidate:hover .candidate-chevron {
		transform: translateX(2px);
	}

	.province-list {
		display: grid;
		gap: 0.75rem;
	}

	.province-card {
		background: rgba(9, 38, 50, 0.45);
		border: 1px solid rgba(186, 225, 234, 0.16);
		border-radius: 14px;
		padding: 0.85rem;
	}

	.province-title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0 0 0.6rem;
		font-size: 0.98rem;
		font-weight: 600;
	}

	.province-title span {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--text-soft);
	}

	.mini-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.42rem;
	}

	.mini-candidate {
		min-height: 2.25rem;
		border: 1px solid rgba(183, 225, 235, 0.22);
		background: rgba(7, 31, 43, 0.65);
		color: #e5f5fb;
		border-radius: 999px;
		padding: 0.38rem 0.8rem;
		font: inherit;
		font-size: 0.86rem;
		cursor: pointer;
		transition: background 140ms ease;
	}

	.mini-candidate:hover {
		background: rgba(16, 56, 72, 0.8);
	}

	.province-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.control {
		position: relative;
		flex: 1 1 220px;
		display: flex;
		align-items: center;
	}

	.control-icon {
		position: absolute;
		left: 0.75rem;
		display: inline-grid;
		place-items: center;
		color: var(--text-soft);
		pointer-events: none;
	}

	.control input {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.6rem 0.8rem 0.6rem 2.3rem;
		border-radius: 12px;
		border: 1px solid rgba(185, 222, 232, 0.35);
		background: rgba(8, 34, 46, 0.6);
		color: #f1fbff;
		font: inherit;
	}

	.control input::placeholder {
		color: rgba(188, 216, 227, 0.6);
	}

	.control input:focus-visible {
		border-color: var(--focus);
	}

	.error {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		color: #ffd2c7 !important;
	}

	/* ---------- Responsive ---------- */

	@media (max-width: 800px) {
		.scene,
		.photo,
		.gradient,
		.minimal-city-layer {
			transition: none;
		}

		.current,
		.home-link,
		.mode-switch,
		.image-menu-toggle {
			backdrop-filter: none;
		}

		.city-haze,
		.skyline-waterline {
			filter: none;
		}

		.celestial-body.sun {
			box-shadow:
				0 0 14px rgba(255, 208, 128, 0.72),
				0 0 34px rgba(255, 184, 102, 0.34);
		}

		.celestial-body.moon {
			box-shadow:
				0 0 12px rgba(201, 220, 238, 0.58),
				0 0 30px rgba(157, 191, 221, 0.26);
		}

		.hero-controls {
			width: 100%;
			justify-content: space-between;
		}

		.current {
			grid-template-columns: 1fr;
		}

		.image-menu {
			right: auto;
			left: 0;
		}
	}

	@media (max-width: 520px) {
		.mode-switch {
			flex: 1 1 100%;
		}

		.mode-switch button {
			flex: 1;
			justify-content: center;
			padding: 0.4rem 0.5rem;
		}

		.image-menu-wrap {
			flex: 1 1 100%;
		}

		.image-menu-toggle {
			width: 100%;
			justify-content: center;
		}

		.image-menu {
			width: 100%;
		}

		.metrics {
			grid-template-columns: 1fr 1fr;
			gap: 0.45rem;
		}

		.cards {
			grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		}

		.panel-header {
			flex-wrap: wrap;
		}

		.btn-primary,
		.btn-secondary {
			flex: 1 1 auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.scene,
		.photo,
		.gradient,
		.minimal-city-layer,
		.meter > span,
		.candidate-chevron {
			transition: none;
		}

		.spinner {
			animation-duration: 2.4s;
		}
	}
</style>