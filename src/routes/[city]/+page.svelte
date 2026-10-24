<script lang="ts">
	import '$lib/ui/cv-a.css';
	import '$lib/ui/cv-b.css';
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

	// --- rediseño v2 it1
	let cvScrolled = $state(false);
	let cvDisplayTemp = $state<number | null>(null);

	function onCvScroll(): void {
		cvScrolled = window.scrollY > 24;
	}

	const cvTempValue = $derived(
		typeof report?.current?.temperatureC === 'number' && Number.isFinite(report.current.temperatureC)
			? Math.round(report.current.temperatureC)
			: null
	);
	const cvShownTemp = $derived(cvDisplayTemp ?? cvTempValue);

	$effect(() => {
		const target = cvTempValue;
		if (!visualsReady || prefersReducedMotion || target === null) {
			cvDisplayTemp = null;
			return;
		}
		const start = performance.now();
		const duration = 700;
		let raf = 0;
		const step = (t: number) => {
			const p = Math.min(1, (t - start) / duration);
			const eased = 1 - Math.pow(1 - p, 3);
			cvDisplayTemp = Math.round(target * eased);
			if (p < 1) {
				raf = requestAnimationFrame(step);
			} else {
				cvDisplayTemp = null;
			}
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

	const cvHours = $derived(hourly.slice(0, 24));
	const cvWeekRange = $derived.by(() => {
		const mins = daily.map((d) => d.minTemperatureC).filter((v) => typeof v === 'number' && Number.isFinite(v));
		const maxs = daily.map((d) => d.maxTemperatureC).filter((v) => typeof v === 'number' && Number.isFinite(v));
		if (!mins.length || !maxs.length) return null;
		const lo = Math.min(...mins);
		const hi = Math.max(...maxs);
		return { lo, hi: hi > lo ? hi : lo + 1 };
	});

	function cvRangeStyle(day: GenericPayload): string {
		const range = cvWeekRange;
		const lo = day.minTemperatureC;
		const hi = day.maxTemperatureC;
		if (!range || typeof lo !== 'number' || typeof hi !== 'number') return '--lo:0%;--hi:0%';
		const span = range.hi - range.lo;
		const loPct = clampUnit((lo - range.lo) / span) * 100;
		const hiPct = clampUnit((hi - range.lo) / span) * 100;
		return `--lo:${loPct.toFixed(1)}%;--hi:${Math.max(loPct, hiPct).toFixed(1)}%`;
	}

	function cvDayLabel(isoDate: unknown, index: number): string {
		if (index === 0) return 'Hoy';
		if (index === 1) return 'Mañana';
		if (typeof isoDate !== 'string') return '--';
		const parsed = new Date(isoDate);
		if (Number.isNaN(parsed.getTime())) return isoDate;
		return capitalize(parsed.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''));
	}

	function cvDayLong(isoDate: unknown): string {
		if (typeof isoDate !== 'string') return '';
		const parsed = new Date(isoDate);
		if (Number.isNaN(parsed.getTime())) return isoDate;
		return parsed.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
	}

	function cvHasPop(value: unknown): boolean {
		return typeof value === 'number' && Number.isFinite(value) && value > 0;
	}

	const cvWindDeg = $derived(
		typeof report?.current?.windDirectionDeg === 'number' && Number.isFinite(report.current.windDirectionDeg)
			? report.current.windDirectionDeg
			: null
	);
	const cvUpdated = $derived.by(() => {
		const raw = report?.current?.isoTime ?? report?.updatedAt ?? report?.generatedAt ?? hourly[0]?.isoTime;
		return typeof raw === 'string' ? formatTime(raw) : null;
	});
	const cvProvince = $derived(String(report?.location?.province ?? municipality?.province ?? 'España'));
	const cvCode = $derived(String(report?.location?.code ?? municipality?.code ?? ''));
	const cvModeIndex = $derived(Math.max(0, modeOptions.findIndex((o) => o.value === mode)));
	const cvToday = $derived(daily[0] ?? null);

	function onCvModesKeydown(event: KeyboardEvent): void {
		const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		const len = modeOptions.length;
		let next = cvModeIndex;
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (cvModeIndex + 1) % len;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (cvModeIndex - 1 + len) % len;
		else if (event.key === 'Home') next = 0;
		else next = len - 1;
		mode = modeOptions[next].value;
		const group = event.currentTarget as HTMLElement | null;
		requestAnimationFrame(() => group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus());
	}

	// --- rediseño v2 it2
	// --- rediseño v3
	const CV_TZ = 'Europe/Madrid';
	function cvHourInTz(d: Date): number {
		try {
			const parts = new Intl.DateTimeFormat('es-ES', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: CV_TZ }).formatToParts(d);
			const h = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
			const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
			return Number.isFinite(h) ? h + m / 60 : d.getHours() + d.getMinutes() / 60;
		} catch {
			return d.getHours() + d.getMinutes() / 60;
		}
	}
	function cvIsNightHour(h: number): boolean {
		return h < 7 || h >= 21;
	}
	const cvLocalHour = $derived(cvHourInTz(activeClock));
	const cvHeroNight = $derived(visualsReady && cvIsNightHour(cvLocalHour));
	function cvIsNightIso(iso: unknown): boolean {
		if (typeof iso !== 'string') return false;
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? false : cvIsNightHour(cvHourInTz(d));
	}
	function cvFinite(v: unknown): v is number {
		return typeof v === 'number' && Number.isFinite(v);
	}
	const cvHoursShown = $derived(cvHours.filter((h, i) => i === 0 || cvFinite(h.temperatureC)));
	const cvNowTemp = $derived.by(() => {
		if (cvShownTemp !== null) return cvShownTemp;
		const t = cvHours[0]?.temperatureC;
		return cvFinite(t) ? Math.round(t) : null;
	});
	const cvTodayMax = $derived.by(() => {
		const f = cvToday?.maxTemperatureC;
		if (cvFinite(f) && cvTempValue !== null) return Math.max(f, cvTempValue);
		return cvFinite(f) ? f : cvTempValue;
	});
	const cvNoPrecip = $derived(precipitationLevelLabel === 'sin precipitación');
	const cvIntensityLabel = $derived(cvNoPrecip ? 'Ninguna' : capitalize(precipitationLevelLabel));
	const cvBeaufort = $derived.by(() => {
		const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
		const idx = limits.findIndex((l) => currentWindKmh < l);
		return idx === -1 ? 12 : idx;
	});

	// --- rediseño v2 it3
	// --- rediseño v4
	const cvBaseCond = $derived.by<WeatherCondition>(() => {
		const cur = normalizeWeatherCondition(report?.current?.condition);
		if (cur !== 'unknown') return cur;
		const h = normalizeWeatherCondition(hourly[0]?.condition);
		if (h !== 'unknown') return h;
		return normalizeWeatherCondition(daily[0]?.condition);
	});
	const cvCond = $derived<WeatherCondition>(isDebugMode && forcedCondition ? forcedCondition : cvBaseCond);
	const cvCondText = $derived(
		String(report?.current?.description ?? hourly[0]?.description ?? daily[0]?.description ?? 'Sin descripción')
	);
	const cvPopNow = $derived(
		cvFinite(hourly[0]?.precipitationProbabilityPercent)
			? clampPercent(hourly[0].precipitationProbabilityPercent)
			: activePrecipitationProbability
	);
	const cvDry = $derived(cvNoPrecip && activePrecipitationProbability === 0);
	const CV_COL = 64;
	const cvSpark = $derived.by(() => {
		const temps = cvHoursShown.map((h, i) =>
			i === 0 && cvTempValue !== null ? cvTempValue : cvFinite(h.temperatureC) ? h.temperatureC : null
		);
		const valid = temps.filter((t): t is number => t !== null);
		if (valid.length < 2) return null;
		const lo = Math.min(...valid);
		const hi = Math.max(...valid);
		const span = hi - lo || 1;
		const pts = temps
			.map((t, i) => (t === null ? null : `${i * CV_COL + CV_COL / 2},${(34 - ((t - lo) / span) * 28).toFixed(1)}`))
			.filter(Boolean) as string[];
		const width = temps.length * CV_COL;
		return {
			width,
			line: `M${pts.join(' L')}`,
			area: `M${pts[0].split(',')[0]},40 L${pts.join(' L')} L${pts[pts.length - 1].split(',')[0]},40 Z`
		};
	});
	const cvWindFrom = $derived.by(() => {
		if (cvWindDeg === null) return null;
		const names = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
		return names[Math.round((((cvWindDeg % 360) + 360) % 360) / 45) % 8];
	});
</script>
<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} onscroll={onCvScroll} />

{#snippet icon(name: IconName)}
	<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#if name === 'arrow-left'}
			<path d="M19 12H5M11 18l-6-6 6-6" />
		{:else if name === 'photo'}
			<rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" />
		{:else if name === 'city'}
			<path d="M3 21h18M5 21V10l4-2v13M9 21V5l6 3v13M15 21v-9l4 2v7" />
		{:else if name === 'list'}
			<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
		{:else if name === 'image'}
			<rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
		{:else if name === 'droplet'}
			<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z" />
		{:else if name === 'umbrella'}
			<path d="M3 12a9 9 0 0 1 18 0H3z" /><path d="M12 12v6a2 2 0 0 1-4 0" />
		{:else if name === 'humidity'}
			<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z" /><path d="M8.5 14.5c1.2.8 2.3.8 3.5 0s2.3-.8 3.5 0" />
		{:else if name === 'wind'}
			<path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5M3 12h15.5a2.5 2.5 0 1 1-2.5 2.5M3 16h7" />
		{:else if name === 'pin'}
			<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
		{:else if name === 'chevron-left'}
			<path d="M15 18l-6-6 6-6" />
		{:else if name === 'chevron-right'}
			<path d="M9 18l6-6-6-6" />
		{:else if name === 'refresh'}
			<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
		{:else if name === 'alert'}
			<circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
		{:else if name === 'search'}
			<circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" />
		{:else if name === 'shuffle'}
			<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
		{:else if name === 'upload'}
			<path d="M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
		{:else if name === 'undo'}
			<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
		{:else if name === 'clock'}
			<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
		{:else if name === 'calendar'}
			<rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" />
		{:else if name === 'home'}
			<path d="M3 11l9-7 9 7M5 10v10h14V10" />
		{:else if name === 'external'}
			<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
		{/if}
	</svg>
{/snippet}

{#snippet weatherIcon(condition: WeatherCondition, night: boolean, size: string)}
	<svg class={`cv-icon cv-wi cv-wi--${condition} ${size}`} viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#if condition === 'clear' && night}
			<path d="M36 29.5A13 13 0 1 1 18.5 12a10.5 10.5 0 0 0 17.5 17.5z" />
			<path d="M35 9v4M33 11h4M40 18v2M39 19h2" />
		{:else if condition === 'clear'}
			<circle cx="24" cy="24" r="8" />
			<path d="M24 6v4M24 38v4M6 24h4M38 24h4M11.3 11.3l2.8 2.8M33.9 33.9l2.8 2.8M11.3 36.7l2.8-2.8M33.9 14.1l2.8-2.8" />
		{:else if condition === 'cloudy'}
			<path d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" />
		{:else if condition === 'rain'}
			<g transform="translate(0 -6)"><path d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" /></g>
			<path class="cv-wi-rain" d="M18 35l-2 6M26 35l-2 6M34 35l-2 6" />
		{:else if condition === 'snow'}
			<g transform="translate(0 -6)"><path d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" /></g>
			<circle cx="17" cy="38" r="1.8" /><circle cx="25" cy="42" r="1.8" /><circle cx="33" cy="38" r="1.8" />
		{:else if condition === 'storm'}
			<g transform="translate(0 -6)"><path d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" /></g>
			<path class="cv-wi-bolt" d="M26 30l-5 8h6l-4 7" />
		{:else if condition === 'fog'}
			<g transform="translate(0 -7)"><path d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" /></g>
			<path d="M9 35h30M13 41h22" />
		{:else}
			<circle cx="16" cy="16" r="5.5" />
			<path d="M16 5v2.5M5 16h2.5M8.2 8.2l1.8 1.8M23.8 8.2 22 10" />
			<g transform="translate(4 2)"><path d="M15 36h19a8 8 0 0 0 1.2-15.9A11 11 0 0 0 14 22.2 7 7 0 0 0 15 36z" /></g>
		{/if}
	</svg>
{/snippet}

{#snippet skyline()}
	<div class={`cv-illu ${isDaytime ? 'cv-illu--day' : 'cv-illu--night'}`}>
		<div class={`cv-celestial ${isDaytime ? 'cv-celestial--sun' : 'cv-celestial--moon'}`} style={celestialStyle}></div>
		<svg class="cv-illu-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
			<ellipse class="cv-illu-haze" cx="800" cy="695" rx="760" ry="142"></ellipse>
			<path class="cv-illu-back" d="M0 675 L48 675 L48 612 L98 612 L98 675 L156 675 L156 544 L190 544 L206 518 L222 544 L262 544 L262 675 L324 675 L324 585 L372 585 L372 675 L430 675 L430 520 L472 520 L472 675 L548 675 L548 560 L588 560 L606 534 L624 560 L672 560 L672 675 L740 675 L740 598 L798 598 L798 675 L872 675 L872 540 L918 540 L918 675 L994 675 L994 575 L1042 575 L1042 675 L1116 675 L1116 548 L1154 548 L1174 508 L1194 548 L1246 548 L1246 675 L1320 675 L1320 594 L1378 594 L1378 675 L1450 675 L1450 534 L1496 534 L1496 675 L1600 675 L1600 900 L0 900 Z"></path>
			<path class="cv-illu-mid" d="M0 760 L70 760 L70 646 L124 646 L124 760 L186 760 L186 606 L254 606 L254 760 L332 760 L332 636 L384 636 L384 760 L468 760 L468 590 L522 590 L522 760 L602 760 L602 624 L660 624 L660 760 L742 760 L742 566 L798 566 L798 760 L876 760 L876 622 L936 622 L936 760 L1012 760 L1012 586 L1070 586 L1070 760 L1148 760 L1148 630 L1212 630 L1212 760 L1286 760 L1286 596 L1348 596 L1348 760 L1424 760 L1424 642 L1488 642 L1488 760 L1600 760 L1600 900 L0 900 Z"></path>
			<path class="cv-illu-front" d="M0 900 L0 835 L84 835 L84 728 L146 728 L146 835 L230 835 L230 690 L300 690 L300 835 L384 835 L384 702 L440 702 L470 668 L500 702 L560 702 L560 835 L644 835 L644 648 L724 648 L724 835 L806 835 L806 712 L868 712 L868 835 L956 835 L956 666 L1032 666 L1032 835 L1118 835 L1118 718 L1186 718 L1186 835 L1274 835 L1274 680 L1352 680 L1352 835 L1442 835 L1442 736 L1512 736 L1512 835 L1600 835 L1600 900 Z"></path>
			<g class="cv-illu-windows">
				<rect x="102" y="776" width="9" height="12"></rect><rect x="248" y="744" width="9" height="12"></rect>
				<rect x="408" y="756" width="9" height="12"></rect><rect x="676" y="726" width="9" height="12"></rect>
				<rect x="982" y="718" width="9" height="12"></rect><rect x="1306" y="734" width="9" height="12"></rect>
				<rect x="494" y="660" width="8" height="10"></rect><rect x="766" y="646" width="8" height="10"></rect>
				<rect x="1038" y="664" width="8" height="10"></rect><rect x="1318" y="662" width="8" height="10"></rect>
			</g>
			<path class="cv-illu-road" d="M0 815 C220 802 456 832 688 818 C986 798 1276 832 1600 816 L1600 900 L0 900 Z"></path>
		</svg>
	</div>
{/snippet}

{#snippet stateBackdrop()}
	<div class="cv-state-backdrop" aria-hidden="true" style={visualsReady ? sceneToneStyle : undefined}>
		{@render skyline()}
		<div class="cv-scrim cv-scrim--radial"></div>
	</div>
{/snippet}

{#snippet stateBack()}
	<a class="cv-back cv-back--state" href="/">{@render icon('arrow-left')}<span>Volver al inicio</span></a>
{/snippet}

{#snippet candidateButton(item: Municipality, showPin: boolean, sub: string)}
	<button type="button" class="cv-candidate" onclick={() => openCandidate(item)}>
		{#if showPin}<span class="cv-candidate-icon">{@render icon('pin')}</span>{/if}
		<span class="cv-candidate-text">
			<strong>{item.name}</strong>
			<span>{sub}</span>
		</span>
		<span class="cv-candidate-chevron">{@render icon('chevron-right')}</span>
	</button>
{/snippet}

{#snippet creditBody()}
	Imagen: {activeImage?.attributionText}
	{#if activeImage?.attributionUrl}
		{' · '}<a href={activeImage.attributionUrl} target="_blank" rel="noreferrer">fuente<span class="cv-sr"> (se abre en una pestaña nueva)</span></a>
	{/if}
{/snippet}

{#snippet meterTicks()}
	<span class="cv-meter-ticks" aria-hidden="true"><i style="left:25%"></i><i style="left:50%"></i><i style="left:75%"></i></span>
{/snippet}

<a class="cv-skip" href="#cv-forecast">Saltar a la previsión</a>

<main id="contenido" class={`cv-page cv-page--${status}`} tabindex="-1">
	{#if status === 'ok' && report}
		<div
			class={`cv-layout cv-mode--${mode} cv-cond--${cvCond} ${cvHeroNight ? 'cv-is-night' : 'cv-is-day'} ${prefersReducedMotion ? 'cv-reduced' : ''}`}
			style={visualsReady ? sceneToneStyle : undefined}
		>
			<div class="cv-stage">
				<div class="cv-stage-media" aria-hidden="true">
					{#if mode !== 'minimal' && activeImage?.url}
						<div class="cv-photo" style={`background-image:url('${toBackgroundImageCss(activeImage.url)}')`}></div>
					{:else}
						{@render skyline()}
					{/if}
				</div>

				<div class="cv-fx">
					<WeatherFxLayer
						condition={cvCond}
						windKmh={currentWindKmh}
						precipitationProbabilityPercent={activePrecipitationProbability}
						renderer={activeRenderer}
						active={fxActive}
						onRendererResolved={(resolved) => (resolvedRenderer = resolved)}
					/>
				</div>
				<div class="cv-scrim cv-scrim--radial" aria-hidden="true"></div>

				<a class="cv-back cv-back--stage" href="/">
					{@render icon('arrow-left')}
					<span>Clima Visual</span>
				</a>

				<section class="cv-hero" aria-labelledby="cv-title">
					<p class="cv-eyebrow cv-reveal" style="--i:0">
						<span class="cv-eyebrow-src">{String(payload.provider ?? 'AEMET').toUpperCase()}</span>
						{#if cvUpdated}
							<span class="cv-eyebrow-dot" aria-hidden="true">·</span>
							<span class="cv-eyebrow-time">Actualizado a las {cvUpdated}</span>
						{/if}
					</p>
					<p
						class="cv-temp cv-reveal"
						style="--i:1"
						aria-label={cvTempValue !== null ? `${cvTempValue} grados` : 'Temperatura no disponible'}
					>
						<span class="cv-temp-num" aria-hidden="true">{cvShownTemp ?? '--'}</span><span class="cv-temp-deg" aria-hidden="true"></span>
					</p>
					<h1 id="cv-title" class="cv-city cv-reveal" style="--i:2">
						<span class="cv-city-pre">Tiempo en </span><span class="cv-city-name">{placeName}</span>
					</h1>
					<p class="cv-place cv-reveal" style="--i:3">
						{@render icon('pin')}
						<span>{cvProvince}</span>
					</p>
					<div class="cv-hero-row cv-glass cv-reveal" style="--i:4">
						<p class="cv-cond">
							{@render weatherIcon(cvCond, cvHeroNight, 'cv-icon--md')}
							<span>{cvCondText}</span>
						</p>
						{#if cvToday}
							<span class="cv-hero-sep" aria-hidden="true"></span>
							<p class="cv-minmax">
								<span class="cv-minmax-hi"><span class="cv-minmax-arrow cv-warm" aria-hidden="true">↑</span><span class="cv-sr">Máxima </span>{formatTemp(cvTodayMax)}</span>
								<span class="cv-minmax-lo"><span class="cv-minmax-arrow cv-cold" aria-hidden="true">↓</span><span class="cv-sr">Mínima </span>{formatTemp(cvToday.minTemperatureC)}</span>
							</p>
						{/if}
					</div>
				</section>

				{#if mode === 'photo' && activeImage?.attributionText}
					<p class="cv-credit cv-credit--stage" title={activeImage.attributionText}>{@render creditBody()}</p>
				{/if}
			</div>

			<div id="cv-forecast" class="cv-panel cv-sheet cv-panel-reveal" tabindex="-1">
				<span class="cv-sheet-handle" aria-hidden="true"></span>
				<header class={`cv-panel-head ${cvScrolled ? 'cv-panel-head--solid' : ''}`}>
					<div
						class="cv-modes"
						role="radiogroup"
						aria-label="Modo visual"
						style={`--cv-mode-index:${cvModeIndex};--cv-mode-count:${modeOptions.length}`}
						tabindex="-1"
						onkeydown={onCvModesKeydown}
					>
						<span class="cv-mode-thumb" aria-hidden="true"></span>
						{#each modeOptions as option (option.value)}
							<button
								type="button"
								class={`cv-mode ${mode === option.value ? 'cv-mode--active' : ''}`}
								role="radio"
								aria-checked={mode === option.value}
								aria-label={option.label}
								title={option.label}
								tabindex={mode === option.value ? 0 : -1}
								onclick={() => (mode = option.value)}
							>
								{@render icon(option.icon)}
								<span class="cv-mode-label" aria-hidden="true">{option.label}</span>
							</button>
						{/each}
					</div>

					{#if mode === 'photo'}
						<div class="cv-imgmenu-wrap" bind:this={imageMenuWrap}>
							<button
								class="cv-imgbtn"
								type="button"
								onclick={toggleImageMenu}
								aria-expanded={imageMenuOpen}
								aria-controls="cv-image-menu"
								aria-label="Cambiar imagen"
								title="Cambiar imagen"
								bind:this={imageMenuToggleEl}
							>
								{@render icon('image')}
							</button>
							{#if imageMenuOpen}
								<div id="cv-image-menu" class="cv-imgmenu" role="group" aria-label="Opciones de imagen de fondo">
									<button type="button" class="cv-imgmenu-item" onclick={() => void applyRandomImage()} disabled={loadingRandomImage} aria-busy={loadingRandomImage}>
										{#if loadingRandomImage}
											<span class="cv-spinner" aria-hidden="true"></span>
											<span class="cv-imgmenu-title">Buscando…</span>
										{:else}
											{@render icon('shuffle')}
											<span class="cv-imgmenu-title">Aleatoria de esta ciudad</span>
										{/if}
									</button>
									<label class="cv-imgmenu-item cv-imgmenu-file">
										{@render icon('upload')}
										<span class="cv-imgmenu-text">
											<span class="cv-imgmenu-title">Imagen de tu dispositivo</span>
											<span class="cv-imgmenu-note">No se sube al servidor</span>
										</span>
										<input class="cv-sr" type="file" accept="image/*" onchange={onCustomImageFileChange} />
									</label>
									<button type="button" class="cv-imgmenu-item" onclick={restoreServerImage} disabled={!customImage}>
										{@render icon('undo')}
										<span class="cv-imgmenu-title">Volver a la original</span>
									</button>
									{#if imageMenuError}
										<p class="cv-imgmenu-error" role="alert">{@render icon('alert')} {imageMenuError}</p>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</header>

				{#if isDebugMode}
					<section class="cv-debug" aria-label="Panel de depuración">
						<p class="cv-sectitle">Debug clima</p>
						<p class="cv-debug-label">Renderer</p>
						<div class="cv-debug-buttons">
							{#each availableRenderers as rendererOption}
								<button type="button" class="cv-chip" aria-pressed={rendererOption === activeRenderer} onclick={() => (selectedRenderer = rendererOption)}>{rendererOption}</button>
							{/each}
						</div>
						<p class="cv-debug-info">
							Activo: <strong>{resolvedRenderer}</strong>
							{#if isRendererFallback}<span>(alternativa por incompatibilidad WebGL/Pixi)</span>{/if}
						</p>
						<p class="cv-debug-label">Condición</p>
						<div class="cv-debug-buttons">
							{#each availableConditions as condition}
								<button type="button" class="cv-chip" aria-pressed={condition === cvCond} onclick={() => (forcedCondition = condition)}>{condition}</button>
							{/each}
						</div>
						<div class="cv-debug-row">
							<p class="cv-debug-label">% precipitación <strong>{activePrecipitationProbability}%</strong></p>
							<input class="cv-debug-range" type="range" min="0" max="100" step="1" value={activePrecipitationProbability} oninput={onDebugPrecipitationInput} aria-label="Porcentaje de precipitación" />
							<input class="cv-debug-number" type="number" min="0" max="100" step="1" value={activePrecipitationProbability} oninput={onDebugPrecipitationInput} aria-label="Porcentaje de precipitación (número)" />
						</div>
						<div class="cv-debug-row">
							<p class="cv-debug-label">Reloj ilustración <strong>{visualsReady ? debugClockLabel : '--:--'}</strong></p>
							<p class="cv-debug-info">Real: {visualsReady ? formatClockLabel(now) : '--:--'} · desfase: {debugOffsetLabel}</p>
							<input class="cv-debug-number" type="number" min="-10080" max="10080" step="1" value={clampedDebugOffsetMinutes} oninput={onDebugTimeOffsetInput} aria-label="Desfase en minutos para sol y luna" />
							<div class="cv-debug-buttons">
								<button type="button" class="cv-chip" onclick={() => shiftDebugTimeOffset(-60)}>-60m</button>
								<button type="button" class="cv-chip" onclick={() => shiftDebugTimeOffset(-15)}>-15m</button>
								<button type="button" class="cv-chip" onclick={() => shiftDebugTimeOffset(15)}>+15m</button>
								<button type="button" class="cv-chip" onclick={() => shiftDebugTimeOffset(60)}>+60m</button>
								<button type="button" class="cv-chip" onclick={() => (debugTimeOffsetMinutes = 0)}>Ahora</button>
							</div>
						</div>
					</section>
				{/if}

				<section class="cv-band cv-band--hours cv-reveal" style="--i:6" aria-labelledby="cv-hours-title">
					<h2 id="cv-hours-title" class="cv-sectitle">{@render icon('clock')} Próximas horas</h2>
					{#if cvHoursShown.length > 0}
						<div class="cv-hours-scroller" tabindex="0" role="region" aria-label="Previsión por horas, desplazable">
							{#if cvSpark}
								<svg class="cv-spark" width={cvSpark.width} height="40" viewBox={`0 0 ${cvSpark.width} 40`} preserveAspectRatio="none" aria-hidden="true">
									<path class="cv-spark-area" d={cvSpark.area} />
									<path class="cv-spark-line" d={cvSpark.line} fill="none" />
								</svg>
							{/if}
							<ol class="cv-hours">
								{#each cvHoursShown as hour, index}
									{#if index === 0}
										<li class="cv-hour cv-hour--now">
											<span class="cv-hour-time">Ahora</span>
											{@render weatherIcon(cvCond, cvHeroNight, 'cv-icon--lg')}
											<span class="cv-sr">{cvCondText}</span>
											<span class="cv-hour-pop">
												{#if cvPopNow > 0}{cvPopNow}%<span class="cv-sr"> de probabilidad de lluvia</span>{/if}
											</span>
											<span class="cv-hour-temp">{cvNowTemp !== null ? `${cvNowTemp}°` : formatTemp(hour.temperatureC)}</span>
										</li>
									{:else}
										<li class="cv-hour">
											<span class="cv-hour-time">{formatTime(hour.isoTime)}</span>
											{@render weatherIcon(normalizeWeatherCondition(hour.condition), visualsReady && cvIsNightIso(hour.isoTime), 'cv-icon--lg')}
											<span class="cv-sr">{hour.description ?? ''}</span>
											<span class="cv-hour-pop">
												{#if cvHasPop(hour.precipitationProbabilityPercent)}{formatPercent(hour.precipitationProbabilityPercent)}<span class="cv-sr"> de probabilidad de lluvia</span>{/if}
											</span>
											<span class="cv-hour-temp">{formatTemp(hour.temperatureC)}</span>
										</li>
									{/if}
								{/each}
							</ol>
						</div>
					{:else}
						<p class="cv-empty">No hay datos horarios disponibles.</p>
					{/if}
				</section>

				<section class="cv-band cv-band--days cv-reveal" style="--i:7" aria-labelledby="cv-days-title">
					<h2 id="cv-days-title" class="cv-sectitle">{@render icon('calendar')} Próximos días</h2>
					{#if daily.length > 0}
						<ol class="cv-days">
							{#each daily as day, index}
								<li class={`cv-day ${index === 0 ? 'cv-day--today' : ''}`}>
									<span class="cv-day-name">
										<span aria-hidden="true">{cvDayLabel(day.isoDate, index)}</span>
										<span class="cv-sr">{index < 2 ? cvDayLabel(day.isoDate, index) + ', ' : ''}{cvDayLong(day.isoDate)}</span>
									</span>
									<span class="cv-day-icon">
										{@render weatherIcon(normalizeWeatherCondition(day.condition), false, 'cv-icon--md')}
										<span class="cv-sr">{day.description ?? ''}</span>
									</span>
									<span class="cv-day-pop">
										{#if cvHasPop(day.precipitationProbabilityPercent)}
											{formatPercent(day.precipitationProbabilityPercent)}<span class="cv-sr"> de probabilidad de lluvia</span>
										{/if}
									</span>
									<span class="cv-day-min"><span class="cv-sr">Mínima </span>{formatTemp(day.minTemperatureC)}</span>
									<span class="cv-range" aria-hidden="true"><span class="cv-range-fill" style={cvRangeStyle(day)}></span></span>
									<span class="cv-day-max"><span class="cv-sr">Máxima </span>{formatTemp(index === 0 ? cvTodayMax : day.maxTemperatureC)}</span>
								</li>
							{/each}
						</ol>
					{:else}
						<p class="cv-empty">No hay datos diarios disponibles.</p>
					{/if}
				</section>

				<section class="cv-band cv-band--metrics cv-reveal" style="--i:8" aria-labelledby="cv-metrics-title">
					<h2 id="cv-metrics-title" class="cv-sectitle">{@render icon('list')} Detalles</h2>
					<dl class={`cv-metrics ${mode === 'all-info' ? 'cv-metrics--full' : ''}`}>
						{#if cvDry}
							<div class="cv-metric cv-metric--dry">
								<dt>{@render icon('umbrella')} Lluvia</dt>
								<dd><span class="cv-metric-value cv-metric-value--text">Sin lluvia</span></dd>
							</div>
						{:else}
							<div class="cv-metric">
								<dt>{@render icon('droplet')} <span aria-hidden="true">Lluvia</span><span class="cv-sr">Probabilidad de precipitación</span></dt>
								<dd>
									<span class="cv-metric-value">{activePrecipitationProbability}<small>%</small></span>
									<span class="cv-meter cv-meter--rain" aria-hidden="true">{@render meterTicks()}<span style={`width:${activePrecipitationProbability}%`}></span></span>
								</dd>
							</div>
							<div class="cv-metric">
								<dt>{@render icon('umbrella')} Intensidad</dt>
								<dd>
									<span class="cv-metric-value cv-metric-value--text">{cvIntensityLabel}</span>
									<span class="cv-meter cv-meter--steps" aria-hidden="true">{@render meterTicks()}<span style={`width:${cvNoPrecip ? 0 : precipitationLevelLabel === 'baja' ? 33 : precipitationLevelLabel === 'media' ? 66 : 100}%`}></span></span>
								</dd>
							</div>
						{/if}
						<div class="cv-metric">
							<dt>{@render icon('humidity')} Humedad</dt>
							<dd>
								<span class="cv-metric-value">{currentHumidity ?? '--'}<small>%</small></span>
								<span class="cv-meter cv-meter--humidity" aria-hidden="true">{@render meterTicks()}<span style={`width:${currentHumidity ?? 0}%`}></span></span>
							</dd>
						</div>
						<div class="cv-metric cv-metric--wind">
							<dt>{@render icon('wind')} Viento</dt>
							<dd class="cv-wind">
								<span class={`cv-compass ${cvWindDeg === null ? 'cv-compass--muted' : ''}`} aria-hidden="true">
									<span class="cv-compass-n">N</span><span class="cv-compass-e">E</span><span class="cv-compass-s">S</span><span class="cv-compass-o">O</span>
									<span class="cv-compass-needle" style={`transform:rotate(${(cvWindDeg ?? 0) + 180}deg)`}>
										<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M7 10l5-5 5 5" /></svg>
									</span>
								</span>
								<span class="cv-wind-text">
									<span class="cv-metric-value">{Number.isFinite(report.current?.windKmh) ? Math.round(report.current.windKmh) : '--'}<small> km/h</small></span>
									<span class="cv-wind-dir" aria-hidden="true">{cvWindFrom ? `del ${cvWindFrom}` : 'Sin dirección'} · F{cvBeaufort}</span>
								</span>
								<span class="cv-sr">Fuerza {cvBeaufort} en la escala Beaufort{#if cvWindFrom}, viento del {cvWindFrom}{/if}</span>
							</dd>
						</div>
						{#if mode === 'all-info'}
							<div class="cv-metric">
								<dt>{@render icon('clock')} Hora local</dt>
								<dd><span class="cv-metric-value">{visualsReady ? formatClockLabel(activeClock) : '--:--'}</span></dd>
							</div>
							<div class="cv-metric">
								<dt>{@render icon('calendar')} Hoy</dt>
								<dd><span class="cv-metric-value cv-metric-value--text">{cvToday ? formatDate(cvToday.isoDate) : '--'}</span></dd>
							</div>
							<div class="cv-metric">
								<dt>{@render icon('pin')} Código INE</dt>
								<dd><span class="cv-metric-value">{cvCode || '--'}</span></dd>
							</div>
							<div class="cv-metric">
								<dt>{@render icon('external')} Fuente</dt>
								<dd><span class="cv-metric-value cv-metric-value--text">{String(payload.provider ?? 'AEMET').toUpperCase()}</span></dd>
							</div>
						{/if}
					</dl>
				</section>

				<footer class="cv-panel-foot">
					{#if mode === 'photo' && activeImage?.attributionText}
						<p class="cv-credit cv-credit--foot">
							{@render icon('photo')}
							<span>{@render creditBody()}</span>
						</p>
					{/if}
					<p class="cv-credit">Datos oficiales de AEMET</p>
				</footer>
			</div>
		</div>
	{:else if status === 'ambiguous'}
		<div class="cv-state">
			{@render stateBackdrop()}
			<section class="cv-state-card" aria-labelledby="state-title">
				{@render stateBack()}
				<span class="cv-state-icon">{@render icon('pin')}</span>
				<h1 id="state-title" class="cv-state-title">Hay varios municipios llamados {placeName}</h1>
				{#if payload.message}<p class="cv-state-lead">{payload.message}</p>{/if}
				<ul class="cv-list">
					{#each payload.candidates ?? [] as candidate}
						<li>{@render candidateButton(candidate, true, `${candidate.province ? candidate.province : 'Provincia desconocida'} · código ${candidate.code}`)}</li>
					{/each}
				</ul>
			</section>
		</div>
	{:else if status === 'not_found'}
		<div class="cv-state">
			{@render stateBackdrop()}
			<section class="cv-state-card" aria-labelledby="state-title">
				{@render stateBack()}
				<span class="cv-state-icon">{@render icon('search')}</span>
				<h1 id="state-title" class="cv-state-title">No encontramos el municipio {placeName}</h1>
				{#if payload.message}<p class="cv-state-lead">{payload.message}</p>{/if}

				{#if (payload.suggestions ?? []).length > 0}
					<h2 class="cv-sectitle">Sugerencias por nombre</h2>
					<ul class="cv-list">
						{#each payload.suggestions as suggestion}
							<li>{@render candidateButton(suggestion, true, `${suggestion.province ? suggestion.province : 'Provincia desconocida'} · código ${suggestion.code}`)}</li>
						{/each}
					</ul>
				{/if}

				{#if (payload.provinceSuggestions ?? []).length > 0}
					<h2 class="cv-sectitle">Provincias relacionadas</h2>
					<div class="cv-provinces">
						{#each payload.provinceSuggestions as provinceSuggestion}
							<article class="cv-province">
								<h3 class="cv-province-title">
									{provinceSuggestion.province}
									<span>{provinceSuggestion.totalMunicipalities} municipios</span>
								</h3>
								<ul class="cv-chips">
									{#each provinceSuggestion.municipalities as municipalityItem}
										<li><button type="button" class="cv-chip" onclick={() => openCandidate(municipalityItem)}>{municipalityItem.name}</button></li>
									{/each}
								</ul>
							</article>
						{/each}
					</div>
				{/if}

				<h2 class="cv-sectitle">Listar municipios por provincia</h2>
				<form class="cv-search cv-search--inline" onsubmit={searchProvince}>
					<label for="province-search" class="cv-sr">Provincia</label>
					<span class="cv-search-icon">{@render icon('search')}</span>
					<input id="province-search" class="cv-search-input" bind:value={selectedProvince} placeholder="Asturias" autocomplete="off" autocapitalize="words" />
					<button type="submit" class="cv-cta" disabled={loadingProvinceMunicipalities} aria-busy={loadingProvinceMunicipalities}>
						{#if loadingProvinceMunicipalities}
							<span class="cv-spinner" aria-hidden="true"></span> Cargando…
						{:else}
							{@render icon('list')} Listar
						{/if}
					</button>
				</form>

				{#if provinceMunicipalityError}
					<p class="cv-error" role="alert">{@render icon('alert')} {provinceMunicipalityError}</p>
				{/if}
				<p class="cv-sr" aria-live="polite">
					{provinceMunicipalities.length > 0 ? `${provinceMunicipalities.length} municipios encontrados` : ''}
				</p>

				{#if provinceMunicipalities.length > 0}
					<ul class="cv-list cv-list--compact">
						{#each provinceMunicipalities as municipalityItem}
							<li>{@render candidateButton(municipalityItem, false, `código ${municipalityItem.code}`)}</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	{:else}
		<div class="cv-state">
			{@render stateBackdrop()}
			<section class="cv-state-card cv-state-card--error" aria-labelledby="state-title" aria-busy={retrying}>
				<span class="cv-state-icon">{@render icon('alert')}</span>
				<h1 id="state-title" class="cv-state-title">Tiempo en {placeName}</h1>
				<p class="cv-state-lead" role="alert">
					{payload.message ?? 'No se pudo obtener la información meteorológica.'}
				</p>
				<p class="cv-sr" aria-live="polite">{retrying ? 'Cargando de nuevo los datos…' : ''}</p>
				<div class="cv-state-actions">
					<button type="button" class="cv-cta" onclick={() => void retryLoad()} disabled={retrying} aria-busy={retrying}>
						{#if retrying}
							<span class="cv-spinner" aria-hidden="true"></span> Reintentando…
						{:else}
							{@render icon('refresh')} Reintentar
						{/if}
					</button>
					<a class="cv-cta cv-cta--ghost" href="/">{@render icon('home')} Volver al inicio</a>
				</div>
			</section>
		</div>
	{/if}
</main>
