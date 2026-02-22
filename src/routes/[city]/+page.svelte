<script lang="ts">
	import { goto } from '$app/navigation';
	import WeatherFxLayer from '$lib/components/weather-fx-layer.svelte';
	import type { WeatherRenderer } from '$lib/components/weather-fx/types';
	import type { Municipality } from '$lib/domain/municipality';
	import type { WeatherCondition } from '$lib/domain/weather';
	import { toSlug } from '$lib/utils/text';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();

	type GenericPayload = Record<string, any>;

	let mode = $state<'photo' | 'minimal' | 'all-info'>('photo');
	let hourlyPage = $state(0);
	let dailyPage = $state(0);
	let forcedCondition = $state<WeatherCondition | null>(null);
	let selectedRenderer = $state<WeatherRenderer>('canvas2d');
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

	const hourlyChunks = $derived(chunk(hourly, 12));
	const dailyChunks = $derived(chunk(daily, 5));
	const visibleHourly = $derived(hourlyChunks[hourlyPage] ?? []);
	const visibleDaily = $derived(dailyChunks[dailyPage] ?? []);
	const compactMode = $derived(mode !== 'all-info');

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
		if (!isDebugMode) {
			selectedRenderer = 'canvas2d';
		}
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

	function formatTemp(value: unknown): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '--';
		}
		return `${Math.round(value)}°`;
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
		<div class={`scene mode-${mode} condition-${activeWeatherCondition} ${compactMode ? 'compact' : ''}`}>
			{#if mode === 'photo' && report.backgroundImage?.url}
				<div class="photo" style={`background-image:url('${report.backgroundImage.url}')`}></div>
			{/if}

			<div class="gradient"></div>
			<div class="fx-host">
				<WeatherFxLayer
					condition={activeWeatherCondition}
					windKmh={currentWindKmh}
					precipitationProbabilityPercent={currentPrecipitationProbability}
					renderer={activeRenderer}
					active={mode !== 'all-info'}
				/>
			</div>

			<div class={`content ${compactMode ? 'content-compact' : ''}`}>
				<header class="hero">
					<div>
						<p class="chip">Fuente: {payload.provider?.toUpperCase() ?? 'API'}</p>
						<h1>{report.location?.name ?? municipality?.name ?? 'Ciudad'}</h1>
						<p class="subtitle">
							{report.location?.province ?? municipality?.province ?? 'España'} · código
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
								<p class="debug-label">Condicion</p>
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
							</section>
						{/if}
					</div>
				</header>

				<section class="current">
					<div class="big-temp">{formatTemp(report.current?.temperatureC)}</div>
					<div class="meta">
						<p class="summary">{report.current?.description ?? 'Sin descripción'}</p>
						<p>Precipitación: {formatPercent(report.current?.precipitationProbabilityPercent)}</p>
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
						<h2>Próximos días</h2>
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

				{#if mode === 'photo' && report.backgroundImage?.attributionText}
					<p class="attribution">
						Imagen: {report.backgroundImage.attributionText}
						{#if report.backgroundImage.attributionUrl}
							·
							<a href={report.backgroundImage.attributionUrl} target="_blank" rel="noreferrer">fuente</a>
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
								{provinceSuggestion.province} · {provinceSuggestion.totalMunicipalities} municipios
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
			<p>{payload.message ?? 'No se pudo obtener la información meteorológica.'}</p>
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
		background: linear-gradient(160deg, #10384a, #0d2734);
		box-shadow: none;
	}

	.photo,
	.gradient,
	.fx-host {
		position: absolute;
		inset: 0;
	}

	.fx-host {
		pointer-events: none;
		z-index: 0;
	}

	.photo {
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		filter: saturate(1.1) contrast(1.05);
	}

	.gradient {
		background:
			radial-gradient(circle at 20% 0%, rgba(255, 219, 145, 0.42), transparent 40%),
			linear-gradient(
				180deg,
				rgba(7, 24, 34, 0.16) 0%,
				rgba(6, 21, 30, 0.75) 56%,
				rgba(5, 18, 26, 0.96) 100%
			);
	}

	.mode-minimal .photo {
		display: none;
	}

	.mode-minimal .gradient {
		background:
			radial-gradient(circle at 18% -8%, rgba(255, 190, 96, 0.3), transparent 40%),
			radial-gradient(circle at 90% 110%, rgba(67, 228, 228, 0.26), transparent 35%),
			linear-gradient(180deg, rgba(12, 45, 61, 0.78), rgba(6, 20, 30, 0.95));
	}

	.mode-all-info .photo {
		display: none;
	}

	.mode-all-info .gradient {
		background:
			radial-gradient(circle at 12% 0%, rgba(79, 191, 213, 0.14), transparent 35%),
			radial-gradient(circle at 100% 120%, rgba(255, 199, 112, 0.11), transparent 40%),
			linear-gradient(180deg, rgba(5, 24, 35, 0.85), rgba(4, 18, 27, 0.96));
	}

	.mode-all-info .fx-host {
		display: none;
	}

	.content {
		position: relative;
		z-index: 1;
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
		background: rgba(8, 33, 46, 0.76);
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
		color: #ffd88b;
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
		background: rgba(8, 29, 41, 0.66);
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

	.debug-panel {
		background: rgba(6, 27, 38, 0.72);
		border: 1px solid rgba(169, 214, 224, 0.35);
		border-radius: 14px;
		padding: 0.5rem;
		min-width: 260px;
	}

	.debug-title {
		margin: 0 0 0.35rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: #9cd7e4;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.debug-label {
		margin: 0 0 0.25rem;
		font-size: 0.72rem;
		letter-spacing: 0.05em;
		color: #9bc0ca;
		text-transform: uppercase;
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

	.renderer-buttons button,
	.debug-buttons button {
		border: 1px solid rgba(169, 215, 225, 0.28);
		background: rgba(8, 33, 45, 0.66);
		color: #e2f4f9;
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
		border: 1px solid rgba(196, 227, 234, 0.3);
		border-radius: 10px;
		background: rgba(8, 37, 48, 0.5);
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
		background: rgba(6, 27, 37, 0.75);
		border-radius: 12px;
		padding: 0.65rem;
		border: 1px solid rgba(177, 223, 234, 0.2);
	}

	.card p {
		margin: 0;
	}

	.time {
		font-size: 0.82rem;
		color: #9edbe8;
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
		color: #cde7ef;
		font-size: 0.8rem;
	}

	.attribution a {
		color: #f2d57f;
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

