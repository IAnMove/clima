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

	// Añadido: pliegue de provincia (abierto si ya hay valor)
	let showProvince = $state(false);
	const provinceOpen = $derived(showProvince || province.trim().length > 0);

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

<a class="cv-skip" href="#city-input">Saltar al buscador</a>

<main id="contenido" class="cv-home" tabindex="-1">
	<div class="cv-home-bg" aria-hidden="true">
		<div class="cv-tile cv-tile--day"><span class="cv-sun"></span></div>
		<div class="cv-tile cv-tile--night"><span class="cv-moon"></span></div>
		<div class="cv-tile cv-tile--dusk"><span class="cv-sun cv-sun--low"></span></div>
		<svg class="cv-skyline" viewBox="0 0 1200 200" preserveAspectRatio="none">
			<path d="M0 200V120l60-20 40 30 70-60 60 40 50-30 80 50 60-70 70 60 60-30 90 50 70-40 80 30 70-50 60 40 90-30 90 40 100-20v130z" />
		</svg>
	</div>

	<section class="cv-home-inner" aria-labelledby="home-title">
		<header class="cv-home-head cv-reveal" style="--i:0">
			<span class="cv-logo" aria-hidden="true">
				<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="9" cy="9" r="3.5" />
					<path d="M9 2v1.5M2 9h1.5M4 4l1 1M14 4l-1 1" />
					<path d="M9 20h8.5a3.7 3.7 0 0 0 .6-7.36A5.2 5.2 0 0 0 8.2 13.6 3.2 3.2 0 0 0 9 20z" />
				</svg>
			</span>
			<p class="cv-label">Clima Visual</p>
		</header>

		<h1 id="home-title" class="cv-home-title cv-reveal" style="--i:1">
			¿Qué tiempo hace <span class="cv-accent">en…?</span>
		</h1>
		<p class="cv-home-lead cv-reveal" style="--i:2">
			Tiempo por municipio en España: temperatura, lluvia y viento sobre una foto o ilustración del
			lugar.
		</p>

		<form class="cv-search-form cv-reveal" style="--i:3" onsubmit={searchCity} aria-label="Buscar el tiempo de un municipio">
			<label for="city-input" class="cv-sr">Ciudad</label>
			<div class="cv-search">
				<svg class="cv-icon cv-icon--lg cv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
					<circle cx="12" cy="9.5" r="2.5" />
				</svg>
				<input
					id="city-input"
					bind:value={city}
					oninput={() => (cityError = null)}
					placeholder="Escribe un municipio"
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
				<p id="city-error" class="cv-error" role="alert">{cityError}</p>
			{/if}

			<button
				type="button"
				class="cv-toggle"
				aria-expanded={provinceOpen}
				aria-controls="cv-prov"
				onclick={() => (showProvince = !provinceOpen)}
			>
				{provinceOpen ? '− Ocultar provincia' : '+ Acotar por provincia'}
			</button>

			<div id="cv-prov" class="cv-search-prov" hidden={!provinceOpen}>
				<div class="cv-prov-row">
					<label for="province-input" class="cv-label">Provincia <span class="cv-muted">(opcional)</span></label>
					<button
						type="button"
						class="cv-link"
						onclick={() => void loadProvinces()}
						disabled={loadingProvinces}
						aria-busy={loadingProvinces}
					>
						{#if loadingProvinces}
							<span class="cv-spinner" aria-hidden="true"></span> Cargando provincias…
						{:else}
							Cargar provincias
						{/if}
					</button>
				</div>
				<input
					id="province-input"
					class="cv-prov-input"
					bind:value={province}
					list="province-list"
					placeholder="Asturias"
					autocomplete="off"
					autocapitalize="words"
					aria-describedby="province-hint"
				/>
				<p id="province-hint" class="cv-hint" aria-live="polite">
					{#if provinces.length > 0}
						{provinces.length} provincias disponibles: empieza a escribir para ver sugerencias.
					{:else}
						Útil cuando el mismo nombre existe en varias provincias.
					{/if}
				</p>
				{#if provinceError}
					<p class="cv-error" role="alert">{provinceError}</p>
				{/if}
			</div>

			<button type="submit" class="cv-cta" disabled={isNavigating} aria-busy={isNavigating}>
				{#if isNavigating}
					<span class="cv-spinner" aria-hidden="true"></span> Cargando…
				{:else}
					Ver clima
					<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M5 12h14M13 6l6 6-6 6" />
					</svg>
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

		<footer class="cv-home-foot cv-reveal" style="--i:4">
			<ul aria-label="Qué puedes consultar">
				<li>Temperatura</li>
				<li>Lluvia</li>
				<li>Viento</li>
			</ul>
			<p>Datos oficiales de AEMET</p>
		</footer>
	</section>
</main>

<style>
	.cv-home {
		--bg: #f4efe6; --surface: #fffdf8; --ink: #14161a; --muted: #5e6470; --line: #e2dacb;
		--accent: #ff5a1f; --accent-ink: #fff; --danger: #c0262d;
		--ease: cubic-bezier(.2, .8, .2, 1);
		position: relative;
		isolation: isolate;
		min-height: 100vh;
		min-height: 100svh;
		display: grid;
		align-items: center;
		padding: clamp(1.25rem, 5vw, 4rem);
		background: var(--bg);
		color: var(--ink);
		font-family: var(--font-display, var(--font-sans, system-ui)), system-ui, sans-serif;
		line-height: 1.5;
		overflow: hidden;
	}
	@media (prefers-color-scheme: dark) {
		.cv-home {
			--bg: #0b0f17; --surface: #121826; --ink: #f2f4f8; --muted: #9aa3b5; --line: #232b3b;
			--accent: #ffb21f; --accent-ink: #14161a; --danger: #ff8a8f;
		}
	}
	.cv-home:focus { outline: none; }
	.cv-home :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

	.cv-skip {
		position: fixed; top: 10px; left: 10px; z-index: 50;
		padding: 12px 18px; min-height: 44px; border-radius: 12px;
		background: #ff5a1f; color: #fff; font-weight: 700; text-decoration: none;
		transform: translateY(-160%); transition: transform .2s;
	}
	.cv-skip:focus { transform: none; }

	.cv-sr {
		position: absolute; width: 1px; height: 1px; overflow: hidden;
		clip-path: inset(50%); white-space: nowrap;
	}

	/* Collage */
	.cv-home-bg {
		position: absolute; inset: 0; z-index: -1;
		display: grid; grid-template-columns: repeat(3, 1fr);
		opacity: .35; filter: blur(28px) saturate(1.2);
		transform: scale(1.1);
		animation: cv-ken 1.2s var(--ease) both;
	}
	.cv-tile { position: relative; }
	.cv-tile--day { background: linear-gradient(180deg, #5d9cf0, #ffd9b0); }
	.cv-tile--night { background: linear-gradient(180deg, #070b16, #2a2b4d); }
	.cv-tile--dusk { background: linear-gradient(180deg, #ff8a5c, #6b3d7a); }
	.cv-sun, .cv-moon {
		position: absolute; top: 25%; left: 50%;
		width: 30%; aspect-ratio: 1; border-radius: 50%;
	}
	.cv-sun { background: #ffd36b; }
	.cv-sun--low { top: 60%; background: #ffb24a; }
	.cv-moon { background: #e8e9f2; }
	.cv-skyline {
		position: absolute; inset: auto 0 0; width: 100%; height: 30%; fill: #1d263b;
	}
	@media (prefers-color-scheme: dark) { .cv-home-bg { opacity: .28; } }

	.cv-home-inner { width: min(980px, 100%); margin: 0 auto; }

	.cv-home-head { display: flex; align-items: center; gap: .65rem; }
	.cv-logo {
		display: grid; place-items: center; width: 44px; height: 44px;
		border-radius: 14px; background: var(--accent); color: var(--accent-ink);
	}
	.cv-icon { width: 20px; height: 20px; flex: none; }
	.cv-icon--lg { width: 28px; height: 28px; }
	.cv-label {
		font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
	}
	.cv-muted { color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; }

	.cv-home-title {
		margin: 1.5rem 0 1rem;
		font-size: clamp(3rem, 10vw, 7rem);
		font-weight: 800; line-height: .9; letter-spacing: -0.05em;
		text-wrap: balance;
	}
	.cv-accent { color: var(--accent); }
	.cv-home-lead { max-width: 48ch; margin: 0; color: var(--muted); font-size: 1.1rem; }

	.cv-search-form { margin-top: 2.25rem; display: grid; gap: .85rem; max-width: 720px; }
	.cv-search {
		position: relative; display: flex; align-items: center;
		height: 64px; border-radius: 20px;
		background: var(--surface); border: 2px solid var(--line);
		box-shadow: 0 10px 40px -12px #14161a33;
		transition: border-color .2s;
	}
	.cv-search:focus-within { border-color: var(--accent); }
	.cv-search-icon { margin-left: 1rem; color: var(--accent); }
	.cv-search input {
		flex: 1; min-width: 0; height: 100%; padding: 0 1rem .1rem .75rem;
		border: 0; background: transparent; color: var(--ink);
		font: 700 1.35rem/1 inherit; font-family: inherit; letter-spacing: -0.01em;
	}
	.cv-search input:focus-visible { outline: none; }
	.cv-search input::placeholder { color: var(--muted); font-weight: 500; opacity: 1; }

	.cv-toggle, .cv-link {
		justify-self: start; display: inline-flex; align-items: center; gap: .4rem;
		min-height: 44px; padding: 0 .25rem;
		border: 0; background: none; color: var(--ink);
		font: 600 .95rem inherit; font-family: inherit; cursor: pointer;
		text-decoration: underline; text-decoration-color: var(--accent);
		text-decoration-thickness: 2px; text-underline-offset: 4px;
	}
	.cv-link:disabled { cursor: progress; opacity: .7; }

	.cv-search-prov {
		display: grid; gap: .5rem; padding: 1rem;
		border-radius: 20px; background: var(--surface); border: 1px solid var(--line);
		animation: cv-in .3s var(--ease) both;
	}
	.cv-search-prov[hidden] { display: none; }
	.cv-prov-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .5rem; }
	.cv-prov-input {
		width: 100%; min-height: 48px; padding: 0 1rem; border-radius: 14px;
		border: 1px solid var(--line); background: var(--bg); color: var(--ink);
		font: 500 1rem inherit; font-family: inherit;
	}
	.cv-prov-input:focus-visible { border-color: var(--accent); }
	.cv-hint { margin: 0; font-size: .85rem; color: var(--muted); }
	.cv-error {
		margin: 0; padding: .55rem .8rem; border-radius: 12px;
		border-left: 4px solid var(--danger); background: var(--surface);
		color: var(--danger); font-weight: 600; font-size: .9rem;
	}

	.cv-cta {
		display: inline-flex; align-items: center; justify-content: center; gap: .6rem;
		width: 100%; min-height: 56px; padding: 0 1.75rem;
		border: 0; border-radius: 20px;
		background: var(--accent); color: var(--accent-ink);
		font: 800 1.1rem inherit; font-family: inherit; cursor: pointer;
		transition: transform .15s var(--ease), filter .15s;
	}
	.cv-cta:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.05); }
	.cv-cta:disabled { cursor: progress; opacity: .8; }

	.cv-spinner {
		width: 1em; height: 1em; border-radius: 50%;
		border: 2px solid currentColor; border-right-color: transparent;
		animation: cv-spin .8s linear infinite;
	}

	.cv-home-foot {
		margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
		display: flex; flex-wrap: wrap; justify-content: space-between; gap: .75rem;
		font-size: .85rem; color: var(--muted);
	}
	.cv-home-foot ul { display: flex; gap: 1.25rem; margin: 0; padding: 0; list-style: none; }
	.cv-home-foot li::before { content: '●'; color: var(--accent); margin-right: .4rem; font-size: .6em; vertical-align: middle; }
	.cv-home-foot p { margin: 0; font-weight: 600; }

	@media (min-width: 768px) {
		.cv-search-form { grid-template-columns: 1fr auto; align-items: start; }
		.cv-search, .cv-error, .cv-toggle, .cv-search-prov { grid-column: 1; }
		.cv-cta { grid-column: 2; grid-row: 1; width: auto; height: 64px; }
	}

	.cv-reveal { animation: cv-in 480ms var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms); }
	@keyframes cv-in { from { opacity: 0; transform: translateY(16px); } }
	@keyframes cv-ken { from { transform: scale(1.16); } }
	@keyframes cv-spin { to { transform: rotate(360deg); } }

	@media (prefers-reduced-motion: reduce) {
		.cv-home *, .cv-home-bg, .cv-skip {
			animation-duration: .01ms !important; animation-iteration-count: 1 !important;
			transition-duration: .01ms !important;
		}
		.cv-spinner { animation: none; border-right-color: currentColor; opacity: .6; }
	}
</style>