<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import WeatherFxLayer from '$lib/components/weather-fx-layer.svelte';
	import type { WeatherRenderer } from '$lib/components/weather-fx/types';
	import type { Municipality } from '$lib/domain/municipality';
	import type { WeatherCondition, WeatherImage } from '$lib/domain/weather';
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

	let mode = $state<'photo' | 'minimal' | 'all-info'>('photo');
	let hourlyPage = $state(0);
	let dailyPage = $state(0);
	let forcedCondition = $state<WeatherCondition | null>(null);
	let selectedRenderer = $state<WeatherRenderer>('canvas2d');
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
	let debugTimeOffsetMinutes = $state(0);
	let selectedProvince = $state('');
	let provinceMunicipalities = $state<Municipality[]>([]);
	let loadingProvinceMunicipalities = $state(false);
	let provinceMunicipalityError = $state<string | null>(null);
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

	const payload = $derived((data.payload ?? {}) as GenericPayload);
	const status = $derived(payload.status ?? 'error');
	const isDebugMode = $derived(Boolean(data.isDebugMode));
	const report = $derived(status === 'ok' ? (payload.report as GenericPayload) : null);
	const municipality = $derived(
		status === 'ok' ? (payload.municipality as GenericPayload | null) : null
	);
	const hourly = $derived((report?.hourly as GenericPayload[] | undefined) ?? []);
	const daily = $derived((report?.daily as GenericPayload[] | undefined) ?? []);

	const weatherCondition = $derived<WeatherCondition>(
		normalizeWeatherCondition(report?.current?.condition ?? daily[0]?.condition)
	);
	const activeWeatherCondition = $derived<WeatherCondition>(
		isDebugMode ? (forcedCondition ?? weatherCondition) : weatherCondition
	);
	const activeRenderer = $derived<WeatherRenderer>(isDebugMode ? selectedRenderer : 'canvas2d');
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
	const activePrecipitationProbability = $derived(
		isDebugMode
			? clampPercent(debugPrecipitationPercent)
			: clampPercent(currentPrecipitationProbability)
	);
	const precipitationLevelLabel = $derived(
		resolvePrecipitationLevelLabel(activeWeatherCondition, activePrecipitationProbability)
	);

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
		const timer = window.setInterval(() => {
			now = new Date();
		}, 1_000);

		return () => {
			window.clearInterval(timer);
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
	): 'baja' | 'media' | 'alta' | 'sin precipitacion' {
		if (condition !== 'rain' && condition !== 'snow' && condition !== 'storm') {
			return 'sin precipitacion';
		}

		if (precipitationProbabilityPercent < 30) {
			return 'baja';
		}
		if (precipitationProbabilityPercent < 70) {
			return 'media';
		}
		return 'alta';
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
				imageMenuError = 'No encontre otra imagen de esta ciudad ahora';
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
</script>

<main class="page">
	{#if status === 'ok' && report}
		<div
			class={`scene mode-${mode} condition-${activeWeatherCondition} ${compactMode ? 'compact' : ''}`}
			style={sceneToneStyle}
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
					active={mode !== 'all-info'}
					onRendererResolved={(resolved) => (resolvedRenderer = resolved)}
				/>
			</div>

			<div class={`content ${compactMode ? 'content-compact' : ''}`}>
				<header class="hero">
					<div>
						<p class="chip">Fuente: {payload.provider?.toUpperCase() ?? 'API'}</p>
						<h1>{report.location?.name ?? municipality?.name ?? 'Ciudad'}</h1>
						<p class="subtitle">
							{report.location?.province ?? municipality?.province ?? 'Espa\u00f1a'} &middot; c&oacute;digo
							{report.location?.code ?? municipality?.code}
						</p>
					</div>

					<div class="hero-controls">
						<div class="mode-switch" role="group" aria-label="Modo visual">
							<button class:active={mode === 'photo'} type="button" onclick={() => (mode = 'photo')}>
								Foto
							</button>
							<button
								class:active={mode === 'minimal'}
								type="button"
								onclick={() => (mode = 'minimal')}
							>
								Minimal
							</button>
							<button
								class:active={mode === 'all-info'}
								type="button"
								onclick={() => (mode = 'all-info')}
							>
								All info
							</button>
						</div>

						{#if mode === 'photo'}
							<div class="image-menu-wrap">
								<button class="image-menu-toggle" type="button" onclick={toggleImageMenu}>
									Cambiar imagen
								</button>
								{#if imageMenuOpen}
									<div class="image-menu">
										<button
											type="button"
											class="image-menu-action"
											onclick={() => void applyRandomImage()}
											disabled={loadingRandomImage}
										>
											{loadingRandomImage ? 'Buscando...' : 'Aleatoria de esta ciudad'}
										</button>
										<div class="image-menu-file">
											<label for="local-image-input">Imagen local (sin subir al server)</label>
											<input
												id="local-image-input"
												type="file"
												accept="image/*"
												onchange={onCustomImageFileChange}
											/>
										</div>
										<button type="button" class="image-menu-reset" onclick={restoreServerImage}>
											Volver a original
										</button>
										{#if imageMenuError}
											<p class="image-menu-error">{imageMenuError}</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}

						{#if isDebugMode}
							<section class="debug-panel">
								<p class="debug-title">Debug clima</p>
								<p class="debug-label">Renderer</p>
								<div class="renderer-buttons">
									{#each availableRenderers as rendererOption}
										<button
											type="button"
											class:selected={rendererOption === activeRenderer}
											onclick={() => (selectedRenderer = rendererOption)}
										>
											{rendererOption}
										</button>
									{/each}
								</div>
								<p class="debug-info">
									Activo: <strong>{resolvedRenderer}</strong>
									{#if isRendererFallback}
										<span>(fallback por incompatibilidad WebGL/Pixi)</span>
									{/if}
								</p>
								<p class="debug-label">Condici&oacute;n</p>
								<div class="debug-buttons">
									{#each availableConditions as condition}
										<button
											type="button"
											class:selected={condition === activeWeatherCondition}
											onclick={() => (forcedCondition = condition)}
										>
											{condition}
										</button>
									{/each}
								</div>
								<div class="debug-precipitation">
									<div class="debug-precipitation-head">
										<p class="debug-label">% precipitaci&oacute;n</p>
										<strong>{activePrecipitationProbability}%</strong>
									</div>
									<input
										class="debug-precipitation-range"
										type="range"
										min="0"
										max="100"
										step="1"
										value={activePrecipitationProbability}
										oninput={onDebugPrecipitationInput}
									/>
									<input
										class="debug-precipitation-number"
										type="number"
										min="0"
										max="100"
										step="1"
										value={activePrecipitationProbability}
										oninput={onDebugPrecipitationInput}
									/>
								</div>
								<div class="debug-time">
									<div class="debug-time-head">
										<p class="debug-label">Reloj minimal</p>
										<strong>{debugClockLabel}</strong>
									</div>
									<p class="debug-time-info">
										Real: {formatClockLabel(now)} &middot; offset: {debugOffsetLabel}
									</p>
									<input
										class="debug-time-number"
										type="number"
										min="-10080"
										max="10080"
										step="1"
										value={clampedDebugOffsetMinutes}
										oninput={onDebugTimeOffsetInput}
										aria-label="Offset en minutos para sol y luna"
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
					</div>
				</header>

				<section class="current">
					<div class="big-temp">{formatTemp(report.current?.temperatureC)}</div>
					<div class="meta">
						<p class="summary">{report.current?.description ?? 'Sin descripci\u00f3n'}</p>
						<p>Precipitaci&oacute;n: {formatPercent(activePrecipitationProbability)}</p>
						<p>Intensidad precipitaci&oacute;n: {precipitationLevelLabel}</p>
						<p>Humedad: {formatPercent(report.current?.humidityPercent)}</p>
						<p>Viento: {formatWind(report.current?.windKmh)}</p>
					</div>
				</section>

				{#if mode === 'all-info'}
					<section class="panel">
					<div class="panel-header">
						<h2>Por horas</h2>
						<div class="pager">
							<button type="button" onclick={() => (hourlyPage = Math.max(0, hourlyPage - 1))}>
								Anterior
							</button>
							<span>{hourlyChunks.length ? hourlyPage + 1 : 0}/{hourlyChunks.length}</span>
							<button
								type="button"
								onclick={() => (hourlyPage = Math.min(hourlyChunks.length - 1, hourlyPage + 1))}
							>
								Siguiente
							</button>
						</div>
					</div>

					{#if visibleHourly.length > 0}
						<div class="cards">
							{#each visibleHourly as hour}
								<article class="card">
									<p class="time">{formatTime(hour.isoTime)}</p>
									<p>{formatTemp(hour.temperatureC)}</p>
									<p class="soft">{hour.description ?? 'Sin dato'}</p>
									<p class="soft">{formatPercent(hour.precipitationProbabilityPercent)} lluvia</p>
								</article>
							{/each}
						</div>
					{:else}
						<p class="empty">No hay datos horarios disponibles.</p>
					{/if}
					</section>

					<section class="panel">
					<div class="panel-header">
						<h2>Pr&oacute;ximos d&iacute;as</h2>
						<div class="pager">
							<button type="button" onclick={() => (dailyPage = Math.max(0, dailyPage - 1))}>
								Anterior
							</button>
							<span>{dailyChunks.length ? dailyPage + 1 : 0}/{dailyChunks.length}</span>
							<button type="button" onclick={() => (dailyPage = Math.min(dailyChunks.length - 1, dailyPage + 1))}>
								Siguiente
							</button>
						</div>
					</div>

					{#if visibleDaily.length > 0}
						<div class="cards">
							{#each visibleDaily as day}
								<article class="card">
									<p class="time">{formatDate(day.isoDate)}</p>
									<p>{formatTemp(day.maxTemperatureC)} / {formatTemp(day.minTemperatureC)}</p>
									<p class="soft">{day.description ?? 'Sin dato'}</p>
									<p class="soft">{formatPercent(day.precipitationProbabilityPercent)} lluvia</p>
								</article>
							{/each}
						</div>
					{:else}
						<p class="empty">No hay datos diarios disponibles.</p>
					{/if}
					</section>
				{/if}

				{#if mode === 'photo' && activeImage?.attributionText}
					<p class="attribution">
						Imagen: {activeImage.attributionText}
						{#if activeImage.attributionUrl}
							&middot;
							<a href={activeImage.attributionUrl} target="_blank" rel="noreferrer">fuente</a>
						{/if}
					</p>
				{/if}
			</div>
		</div>
	{:else if status === 'ambiguous'}
		<section class="state">
			<h1>Hay varios municipios con ese nombre</h1>
			<p>{payload.message}</p>
			<div class="list">
				{#each (payload.candidates ?? []) as candidate}
					<button type="button" class="candidate" onclick={() => openCandidate(candidate)}>
						{candidate.name}{candidate.province ? `, ${candidate.province}` : ''} ({candidate.code})
					</button>
				{/each}
			</div>
		</section>
	{:else if status === 'not_found'}
		<section class="state">
			<h1>Municipio no encontrado</h1>
			<p>{payload.message}</p>

			{#if (payload.suggestions ?? []).length > 0}
				<h2>Sugerencias por nombre</h2>
				<div class="list">
					{#each payload.suggestions as suggestion}
						<button type="button" class="candidate" onclick={() => openCandidate(suggestion)}>
							{suggestion.name}{suggestion.province ? `, ${suggestion.province}` : ''} ({suggestion.code})
						</button>
					{/each}
				</div>
			{/if}

			{#if (payload.provinceSuggestions ?? []).length > 0}
				<h2>Provincias relacionadas</h2>
				<div class="province-list">
					{#each payload.provinceSuggestions as provinceSuggestion}
						<article class="province-card">
							<p class="province-title">
								{provinceSuggestion.province} &middot; {provinceSuggestion.totalMunicipalities} municipios
							</p>
							<div class="mini-list">
								{#each provinceSuggestion.municipalities as municipalityItem}
									<button
										type="button"
										class="mini-candidate"
										onclick={() => openCandidate(municipalityItem)}
									>
										{municipalityItem.name}
									</button>
								{/each}
							</div>
						</article>
					{/each}
				</div>
			{/if}

			<h2>Listar municipios por provincia</h2>
			<form class="province-form" onsubmit={searchProvince}>
				<input bind:value={selectedProvince} placeholder="Asturias" />
				<button type="submit" disabled={loadingProvinceMunicipalities}>
					{loadingProvinceMunicipalities ? 'Cargando...' : 'Listar'}
				</button>
			</form>

			{#if provinceMunicipalityError}
				<p class="error">{provinceMunicipalityError}</p>
			{/if}

			{#if provinceMunicipalities.length > 0}
				<div class="list">
					{#each provinceMunicipalities as municipalityItem}
						<button
							type="button"
							class="candidate"
							onclick={() => openCandidate(municipalityItem)}
						>
							{municipalityItem.name} ({municipalityItem.code})
						</button>
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<section class="state">
			<h1>Error cargando el clima</h1>
			<p>{payload.message ?? 'No se pudo obtener la informaci\u00f3n meteorol\u00f3gica.'}</p>
		</section>
	{/if}
</main>

<style>
	.page {
		min-height: 100svh;
		padding: 0;
	}

	.scene {
		position: relative;
		width: 100%;
		min-height: 100svh;
		margin: 0;
		border-radius: 0;
		overflow: hidden;
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
		box-shadow: none;
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
		transition: background 900ms linear, opacity 900ms linear;
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
		display: none;
	}

	.content {
		position: relative;
		z-index: 4;
		padding: clamp(1rem, 2.5vw, 1.5rem);
		color: var(--text-strong);
		display: grid;
		gap: 1rem;
		width: min(1220px, 100%);
	}

	.scene.compact {
		min-height: 100svh;
	}

	.content-compact {
		max-width: 760px;
	}

	.content-compact .current {
		background: var(--surface);
		padding: 1.15rem;
	}

	.content-compact .big-temp {
		font-size: clamp(2.8rem, 8vw, 4.8rem);
	}

	.content-compact .meta {
		gap: 0.28rem;
	}

	.hero {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
		justify-content: space-between;
		align-items: flex-start;
	}

	.hero-controls {
		display: grid;
		gap: 0.6rem;
		justify-items: end;
	}

	.chip {
		margin: 0 0 0.35rem;
		display: inline-block;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--chip-color);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.6rem, 4vw, 2.5rem);
		line-height: 1.05;
	}

	.subtitle {
		margin: 0.25rem 0 0;
		color: var(--text-soft);
	}

	.mode-switch {
		display: flex;
		gap: 0.45rem;
		padding: 0.28rem;
		border-radius: 999px;
		background: var(--control-bg);
		border: 1px solid var(--control-border);
	}

	.mode-switch button {
		border: 0;
		background: transparent;
		color: var(--text-soft);
		padding: 0.42rem 0.75rem;
		border-radius: 999px;
		cursor: pointer;
	}

	.mode-switch button.active {
		background: linear-gradient(110deg, var(--accent), #ffe099);
		color: #2f2810;
		font-weight: 700;
	}

	.image-menu-wrap {
		position: relative;
	}

	.image-menu-toggle {
		border: 1px solid var(--control-border);
		background: var(--control-bg-strong);
		color: var(--control-text);
		border-radius: 999px;
		padding: 0.28rem 0.62rem;
		font-size: 0.76rem;
		cursor: pointer;
	}

	.image-menu {
		position: absolute;
		top: calc(100% + 0.35rem);
		right: 0;
		width: min(300px, 90vw);
		background: var(--surface-strong);
		border: 1px solid var(--control-border);
		border-radius: 12px;
		padding: 0.5rem;
		display: grid;
		gap: 0.45rem;
		z-index: 3;
	}

	.image-menu-action,
	.image-menu-reset {
		border: 1px solid var(--control-border);
		background: var(--control-bg-strong);
		color: var(--control-text);
		border-radius: 9px;
		padding: 0.42rem 0.56rem;
		font-size: 0.78rem;
		cursor: pointer;
		text-align: left;
	}

	.image-menu-action:disabled {
		opacity: 0.68;
		cursor: progress;
	}

	.image-menu-file {
		display: grid;
		gap: 0.4rem;
	}

	.image-menu-file label {
		font-size: 0.74rem;
		color: var(--text-soft);
	}

	.image-menu-file input {
		border: 1px solid var(--control-border);
		background: var(--control-bg-strong);
		color: var(--control-text);
		border-radius: 8px;
		padding: 0.3rem 0.42rem;
		font-size: 0.75rem;
		min-width: 0;
	}

	.image-menu-error {
		margin: 0;
		color: #ffd4c7;
		font-size: 0.75rem;
	}

	.debug-panel {
		background: var(--surface-strong);
		border: 1px solid var(--control-border);
		border-radius: 14px;
		padding: 0.5rem;
		min-width: 260px;
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
		margin: 0 0 0.5rem;
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

	.debug-precipitation {
		margin-top: 0.55rem;
		display: grid;
		gap: 0.35rem;
	}

	.debug-precipitation-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.debug-precipitation-head .debug-label {
		margin: 0;
	}

	.debug-precipitation-head strong {
		color: var(--text-strong);
		font-size: 0.82rem;
	}

	.debug-precipitation-range {
		width: 100%;
		accent-color: var(--accent-2);
	}

	.debug-precipitation-number {
		width: 84px;
		border: 1px solid var(--control-border);
		background: var(--control-bg-strong);
		color: var(--control-text);
		border-radius: 8px;
		padding: 0.28rem 0.45rem;
		font-size: 0.8rem;
	}

	.debug-time {
		margin-top: 0.55rem;
		display: grid;
		gap: 0.35rem;
	}

	.debug-time-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.debug-time-head .debug-label {
		margin: 0;
	}

	.debug-time-head strong {
		color: var(--text-strong);
		font-size: 0.82rem;
	}

	.debug-time-info {
		margin: 0;
		font-size: 0.74rem;
		color: var(--text-soft);
	}

	.debug-time-number {
		width: 100%;
		border: 1px solid var(--control-border);
		background: var(--control-bg-strong);
		color: var(--control-text);
		border-radius: 8px;
		padding: 0.28rem 0.45rem;
		font-size: 0.8rem;
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

	.current {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		padding: 1rem;
		border-radius: 16px;
		background: var(--surface);
		backdrop-filter: blur(3px);
	}

	.big-temp {
		font-size: clamp(2.2rem, 6vw, 4rem);
		font-weight: 700;
		line-height: 1;
	}

	.meta {
		display: grid;
		gap: 0.2rem;
		align-content: center;
	}

	.meta p {
		margin: 0;
		color: var(--text-soft);
	}

	.summary {
		color: var(--text-strong);
		font-size: 1rem;
		font-weight: 600;
	}

	.panel {
		background: var(--surface-strong);
		border-radius: 16px;
		padding: 0.95rem;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.8rem;
		margin-bottom: 0.7rem;
	}

	h2 {
		margin: 0;
		font-size: 1.02rem;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.9rem;
		color: var(--text-soft);
	}

	.pager button {
		border: 1px solid var(--control-border);
		border-radius: 10px;
		background: var(--control-bg-strong);
		color: var(--text-strong);
		padding: 0.3rem 0.55rem;
		cursor: pointer;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 0.65rem;
	}

	.card {
		background: var(--surface);
		border-radius: 12px;
		padding: 0.65rem;
		border: 1px solid var(--control-border);
	}

	.card p {
		margin: 0;
	}

	.time {
		font-size: 0.82rem;
		color: var(--panel-heading);
		margin-bottom: 0.2rem;
	}

	.soft {
		font-size: 0.83rem;
		color: var(--text-soft);
	}

	.empty {
		margin: 0;
		color: var(--text-soft);
	}

	.attribution {
		margin: 0;
		color: var(--text-soft);
		font-size: 0.8rem;
	}

	.attribution a {
		color: var(--chip-color);
	}

	.state {
		max-width: 980px;
		margin: 0 auto;
		background: linear-gradient(160deg, rgba(9, 35, 48, 0.9), rgba(7, 27, 39, 0.94));
		color: var(--text-strong);
		border-radius: 22px;
		padding: 1.2rem;
	}

	.state p {
		color: var(--text-soft);
	}

	.list {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.65rem;
	}

	.candidate {
		text-align: left;
		border: 1px solid rgba(188, 224, 232, 0.25);
		background: rgba(10, 39, 50, 0.5);
		color: var(--text-strong);
		padding: 0.7rem;
		border-radius: 12px;
		cursor: pointer;
	}

	.province-list {
		display: grid;
		gap: 0.75rem;
	}

	.province-card {
		background: rgba(9, 38, 50, 0.45);
		border: 1px solid rgba(186, 225, 234, 0.2);
		border-radius: 12px;
		padding: 0.8rem;
	}

	.province-title {
		margin: 0 0 0.55rem;
		font-weight: 600;
	}

	.mini-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.42rem;
	}

	.mini-candidate {
		border: 1px solid rgba(183, 225, 235, 0.22);
		background: rgba(7, 31, 43, 0.65);
		color: #e5f5fb;
		border-radius: 999px;
		padding: 0.38rem 0.7rem;
		cursor: pointer;
	}

	.province-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.35rem;
	}

	.province-form input {
		padding: 0.65rem 0.8rem;
		border-radius: 10px;
		border: 1px solid rgba(185, 222, 232, 0.35);
		background: rgba(8, 34, 46, 0.6);
		color: #f1fbff;
		min-width: 180px;
	}

	.province-form button {
		border: 0;
		border-radius: 10px;
		padding: 0.66rem 0.9rem;
		background: linear-gradient(120deg, #44d5da, #86f4f4);
		color: #083538;
		font-weight: 700;
		cursor: pointer;
	}

	.error {
		color: #ffd2c7;
	}

	@media (max-width: 800px) {
		.hero-controls {
			width: 100%;
			justify-items: start;
		}

		.debug-panel {
			min-width: 0;
			width: 100%;
		}
	}
</style>



