<script lang="ts">
	import { goto } from '$app/navigation';
	import { navigating } from '$app/state';
	import { toSlug } from '$lib/utils/text';

	let city = $state('oviedo');
	let province = $state('');
	let provinces = $state<string[]>([]);
	let loadingProvinces = $state(false);
	let provinceError = $state<string | null>(null);
	let cityError = $state<string | null>(null);

	const isNavigating = $derived(Boolean(navigating.to));

	async function loadProvinces() {
		loadingProvinces = true;
		provinceError = null;

		try {
			const response = await fetch('/api/municipalities');
			const payload = (await response.json()) as { provinces?: string[]; message?: string };

			if (!response.ok || !payload.provinces) {
				provinceError = payload.message ?? 'No se pudieron cargar las provincias';
				return;
			}

			provinces = payload.provinces;
		} catch {
			provinceError = 'No se pudieron cargar las provincias';
		} finally {
			loadingProvinces = false;
		}
	}

	function searchCity(event: SubmitEvent): void {
		event.preventDefault();

		const slug = toSlug(city);
		if (!slug) {
			cityError = 'Escribe el nombre de un municipio.';
			return;
		}
		cityError = null;

		const params = new URLSearchParams();
		if (province.trim()) {
			params.set('province', province.trim());
		}

		const query = params.toString();
		void goto(query ? `/${slug}?${query}` : `/${slug}`);
	}
</script>

<main id="contenido" class="home" tabindex="-1">
	<div class="sky" aria-hidden="true">
		<span class="orb orb-sun"></span>
		<span class="orb orb-sea"></span>
	</div>

	<section class="hero" aria-labelledby="home-title">
		<div class="hero-head">
			<span class="logo" aria-hidden="true">
				<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="4.5" />
					<path d="M12 3v1.5M3 12h1.5M5.6 5.6l1.1 1.1M18.4 5.6l-1.1 1.1" />
					<path
						class="logo-cloud"
						d="M11 27h11.5a5 5 0 0 0 .8-9.94A7 7 0 0 0 10 18.3 4.4 4.4 0 0 0 11 27z"
					/>
				</svg>
			</span>
			<p class="eyebrow">Clima Visual</p>
		</div>

		<h1 id="home-title">Tiempo por municipio en España</h1>
		<p class="lead">
			Consulta la temperatura, la lluvia y el viento de cualquier municipio. Los datos proceden de
			AEMET. Si el nombre existe en varias provincias, puedes acotar la búsqueda.
		</p>

		<form class="search" onsubmit={searchCity} aria-label="Buscar el tiempo de un municipio">
			<div class="field">
				<label for="city-input">Ciudad</label>
				<div class="control">
					<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
						<circle cx="12" cy="9.5" r="2.5" />
					</svg>
					<input
						id="city-input"
						bind:value={city}
						oninput={() => (cityError = null)}
						placeholder="Oviedo"
						required
						autocomplete="off"
						autocapitalize="words"
						spellcheck="false"
						enterkeyhint="search"
						aria-invalid={cityError ? 'true' : undefined}
						aria-describedby={cityError ? 'city-error' : undefined}
					/>
				</div>
				{#if cityError}
					<p id="city-error" class="field-error" role="alert">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
							<circle cx="12" cy="12" r="9" />
							<path d="M12 7.5v5.5M12 16.5h.01" />
						</svg>
						{cityError}
					</p>
				{/if}
			</div>

			<div class="field">
				<div class="label-row">
					<label for="province-input">Provincia <span class="optional">(opcional)</span></label>
					<button
						type="button"
						class="link-button"
						onclick={() => void loadProvinces()}
						disabled={loadingProvinces}
						aria-busy={loadingProvinces}
					>
						{#if loadingProvinces}
							<span class="spinner" aria-hidden="true"></span>
							Cargando provincias…
						{:else}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
							</svg>
							Cargar provincias
						{/if}
					</button>
				</div>
				<div class="control">
					<svg class="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z" />
						<path d="M9 4v13.5M15 6.5V20" />
					</svg>
					<input
						id="province-input"
						bind:value={province}
						list="province-list"
						placeholder="Asturias"
						autocomplete="off"
						autocapitalize="words"
						aria-describedby="province-hint"
					/>
				</div>
				<p id="province-hint" class="hint" aria-live="polite">
					{#if provinces.length > 0}
						{provinces.length} provincias disponibles: empieza a escribir para ver sugerencias.
					{:else}
						Útil cuando el mismo nombre existe en varias provincias.
					{/if}
				</p>
				{#if provinceError}
					<p class="field-error" role="alert">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
							<circle cx="12" cy="12" r="9" />
							<path d="M12 7.5v5.5M12 16.5h.01" />
						</svg>
						{provinceError}
					</p>
				{/if}
			</div>

			<button type="submit" class="primary" disabled={isNavigating} aria-busy={isNavigating}>
				{#if isNavigating}
					<span class="spinner" aria-hidden="true"></span>
					Cargando…
				{:else}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<circle cx="11" cy="11" r="6.5" />
						<path d="M20 20l-4.2-4.2" />
					</svg>
					Ver clima
				{/if}
			</button>
		</form>

		{#if provinces.length > 0}
			<datalist id="province-list">
				{#each provinces as provinceName}
					<option value={provinceName}></option>
				{/each}
			</datalist>
		{/if}

		<ul class="facts" aria-label="Qué puedes consultar">
			<li>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z" />
				</svg>
				Temperatura
			</li>
			<li>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z" />
				</svg>
				Lluvia
			</li>
			<li>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5M3 12h15.5a2.5 2.5 0 1 1-2.5 2.5M3 16h7" />
				</svg>
				Viento
			</li>
			<li class="source">Datos oficiales de AEMET</li>
		</ul>
	</section>
</main>

<style>
	.home {
		position: relative;
		isolation: isolate;
		min-height: 100vh;
		min-height: 100svh;
		display: grid;
		place-items: center;
		padding: clamp(1rem, 4vw, 2.5rem);
		overflow: hidden;
	}

	.home:focus {
		outline: none;
	}

	.sky {
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
	}

	.orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(70px);
		opacity: 0.5;
	}

	.orb-sun {
		width: 44vmax;
		height: 44vmax;
		top: -16vmax;
		right: -12vmax;
		background: radial-gradient(circle, #ffd27a 0%, transparent 65%);
	}

	.orb-sea {
		width: 52vmax;
		height: 52vmax;
		bottom: -24vmax;
		left: -18vmax;
		background: radial-gradient(circle, #7fdbe0 0%, transparent 65%);
	}

	.hero {
		width: min(640px, 100%);
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--card-border);
		border-radius: 28px;
		padding: clamp(1.5rem, 5vw, 2.75rem);
		box-shadow: var(--card-shadow);
	}

	.hero-head {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.logo {
		width: 42px;
		height: 42px;
		display: grid;
		place-items: center;
		border-radius: 13px;
		background: linear-gradient(140deg, #0f5f6e, #0a2d39);
		color: #ffc44d;
		box-shadow: 0 6px 16px -6px rgba(10, 45, 57, 0.6);
	}

	.logo svg {
		width: 28px;
		height: 28px;
	}

	.logo-cloud {
		stroke: #e8f6fa;
		fill: #0d4553;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--brand);
	}

	h1 {
		margin: 1.2rem 0 0.65rem;
		font-size: clamp(1.9rem, 5.2vw, 2.65rem);
		line-height: 1.07;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}

	.lead {
		margin: 0;
		max-width: 56ch;
		color: var(--ink-muted);
		font-size: 1.02rem;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.search {
		margin-top: 1.8rem;
		display: grid;
		gap: 1.15rem;
	}

	.field {
		display: grid;
		gap: 0.45rem;
	}

	label {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--ink);
	}

	.optional {
		font-weight: 400;
		color: var(--ink-muted);
	}

	.label-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 0.75rem;
	}

	.control {
		position: relative;
	}

	.control-icon {
		position: absolute;
		left: 0.9rem;
		top: 50%;
		width: 1.15rem;
		height: 1.15rem;
		transform: translateY(-50%);
		color: var(--ink-muted);
		pointer-events: none;
	}

	input {
		width: 100%;
		min-height: 3rem;
		padding: 0.75rem 0.95rem 0.75rem 2.7rem;
		border-radius: 14px;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--ink);
		font-size: 1rem;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	input::placeholder {
		color: var(--ink-subtle);
		opacity: 1;
	}

	input:hover {
		border-color: var(--field-border-hover);
	}

	input:focus-visible {
		outline: 2px solid transparent;
		border-color: var(--focus);
		box-shadow: 0 0 0 4px var(--focus-ring);
	}

	input[aria-invalid='true'] {
		border-color: var(--danger);
	}

	.hint {
		margin: 0;
		font-size: 0.84rem;
		color: var(--ink-muted);
	}

	.field-error {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.7rem;
		border-radius: 10px;
		background: var(--danger-bg);
		color: var(--danger);
		font-size: 0.86rem;
		font-weight: 500;
	}

	.field-error svg {
		width: 1.05rem;
		height: 1.05rem;
		flex: none;
	}

	.link-button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2rem;
		padding: 0.3rem 0.6rem;
		margin: -0.3rem -0.6rem;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--brand);
		font-size: 0.86rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.link-button svg {
		width: 1rem;
		height: 1rem;
	}

	.link-button:hover:not(:disabled) {
		background: var(--brand-soft);
	}

	.link-button:disabled {
		cursor: progress;
		opacity: 0.8;
	}

	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		min-height: 3.15rem;
		margin-top: 0.3rem;
		padding: 0.8rem 1.2rem;
		border: 0;
		border-radius: 14px;
		background: linear-gradient(120deg, #ffbd3a, #ffd978);
		color: var(--accent-ink);
		font-size: 1.02rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow:
			0 10px 24px -10px rgba(245, 165, 36, 0.75),
			inset 0 -2px 0 rgba(0, 0, 0, 0.08);
		transition:
			transform 0.15s ease,
			filter 0.15s ease;
	}

	.primary svg {
		width: 1.15rem;
		height: 1.15rem;
	}

	.primary:hover:not(:disabled) {
		filter: brightness(1.04);
		transform: translateY(-1px);
	}

	.primary:active:not(:disabled) {
		transform: translateY(0);
	}

	.primary:disabled {
		cursor: progress;
		opacity: 0.85;
	}

	.facts {
		list-style: none;
		margin: 1.8rem 0 0;
		padding: 1.2rem 0 0;
		border-top: 1px solid var(--card-border);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1.25rem;
		font-size: 0.86rem;
		color: var(--ink-muted);
	}

	.facts li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.facts svg {
		width: 1.05rem;
		height: 1.05rem;
		color: var(--brand);
	}

	.facts .source {
		margin-left: auto;
		font-size: 0.8rem;
	}

	@media (max-width: 520px) {
		.hero {
			border-radius: 22px;
		}

		.facts .source {
			margin-left: 0;
			width: 100%;
		}
	}

	@media (prefers-color-scheme: dark) {
		.orb {
			opacity: 0.2;
		}
	}
</style>