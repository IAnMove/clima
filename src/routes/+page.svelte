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

	// ===== Añadido: escena según la hora local (solo en cliente, evita desfase SSR) =====
	const CITIES = ['Oviedo', 'Sevilla', 'Bilbao', 'Valencia', 'Cádiz', 'Teruel', 'A Coruña', 'Madrid'];
	const QUICK = ['Madrid', 'Barcelona', 'Sevilla', 'Valencia', 'Bilbao', 'Oviedo'];
	// Añadido: región orientativa para las mini-tarjetas (solo decorativo)
	const REGION: Record<string, string> = {
		Madrid: 'Centro', Barcelona: 'Mediterráneo', Sevilla: 'Sur',
		Valencia: 'Levante', Bilbao: 'Cantábrico', Oviedo: 'Norte'
	};

	let hour = $state(13);
	let reduced = $state(true);
	let typed = $state('');

	const phase = $derived<'night' | 'dawn' | 'day' | 'dusk'>(
		hour < 6 || hour >= 21 ? 'night' : hour < 9 ? 'dawn' : hour < 18 ? 'day' : 'dusk'
	);
	const isNight = $derived(phase === 'night');
	const phaseLabel = $derived(
		{ night: 'Noche', dawn: 'Amanecer', day: 'Día', dusk: 'Atardecer' }[phase]
	);
	const skyStyle = $derived.by(() => {
		const sky = {
			night: ['#060a15', '#121a33', '#2a2b4d'],
			dawn: ['#3b4f8f', '#f3a07a', '#ffd6a8'],
			day: ['#3f7fde', '#8fbff2', '#ffe1bf'],
			dusk: ['#2b2556', '#c4587a', '#ff9a5c']
		}[phase];
		// Sol: arco de 6 a 21 h; luna: arco nocturno
		const t = isNight ? (((hour + 3) % 24) / 9) : (hour - 6) / 15;
		const x = 12 + Math.min(Math.max(t, 0), 1) * 76;
		const y = 52 - Math.sin(Math.min(Math.max(t, 0), 1) * Math.PI) * 36;
		return `--s1:${sky[0]};--s2:${sky[1]};--s3:${sky[2]};--cx:${x}%;--cy:${y}%;--cv-tone:${sky[1]}`;
	});

	$effect(() => {
		hour = new Date().getHours();
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		if (reduced) return;
		let ci = 0, len = 0, dir = 1, hold = 6;
		const timer = setInterval(() => {
			if (hold > 0) { hold--; return; }
			const word = CITIES[ci];
			len += dir;
			typed = word.slice(0, len);
			if (len >= word.length) { dir = -1; hold = 20; }
			else if (len <= 0) { dir = 1; ci = (ci + 1) % CITIES.length; hold = 4; }
		}, 85);
		return () => clearInterval(timer);
	});
</script>

<a class="cv-skip" href="#city-input">Saltar al buscador</a>

<main id="contenido" class="cv-home" class:is-night={isNight} tabindex="-1" style={skyStyle}>
	<section class="cv-stage" aria-labelledby="home-title">
		<div class="cv-scene" aria-hidden="true">
			<div class="cv-sky"></div>
			{#if isNight}<div class="cv-stars"></div>{/if}
			<span class="cv-orb" class:cv-orb--moon={isNight}></span>
			<svg class="cv-skyline cv-skyline--far" viewBox="0 0 1200 200" preserveAspectRatio="none">
				<path d="M0 200V130l80-30 60 25 90-50 70 35 60-20 90 45 70-55 80 40 70-25 100 40 80-30 90 25 70-35 80 30 110-15v100z" />
			</svg>
			<svg class="cv-skyline" viewBox="0 0 1200 200" preserveAspectRatio="none">
				<path d="M0 200V120l60-20 40 30 70-60 60 40 50-30 80 50 60-70 70 60 60-30 90 50 70-40 80 30 70-50 60 40 90-30 90 40 100-20v130z" />
			</svg>
			<div class="cv-scrim"></div>
		</div>

		<div class="cv-stage-inner">
			<header class="cv-home-head cv-reveal" style="--i:0">
				<span class="cv-logo" aria-hidden="true">
					<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="9" cy="9" r="3.5" />
						<path d="M9 2v1.5M2 9h1.5M4 4l1 1M14 4l-1 1" />
						<path d="M9 20h8.5a3.7 3.7 0 0 0 .6-7.36A5.2 5.2 0 0 0 8.2 13.6 3.2 3.2 0 0 0 9 20z" />
					</svg>
				</span>
				<p class="cv-brand">Clima Visual</p>
				<p class="cv-eyebrow">
					<span>AEMET</span><span class="cv-dot" aria-hidden="true">·</span><span>{phaseLabel}</span>
				</p>
			</header>

			<h1 id="home-title" class="cv-home-title cv-reveal" style="--i:1">
				<span class="cv-t1">¿Qué tiempo hace</span>
				<span class="cv-sr">en…?</span>
				<span class="cv-typed" aria-hidden="true">
					{#if reduced || !typed}en…?{:else}en <span class="cv-word">{typed}</span>?{/if}
				</span>
			</h1>
			<p class="cv-home-lead cv-reveal" style="--i:2">
				Tiempo por municipio en España: temperatura, lluvia y viento sobre una foto o ilustración
				del lugar.
			</p>

			<form class="cv-search-form cv-reveal" style="--i:3" onsubmit={searchCity} aria-label="Buscar el tiempo de un municipio">
				<label for="city-input" class="cv-sr">Ciudad</label>
				<div class="cv-search">
					<div class="cv-field">
						<svg class="cv-icon cv-icon--md cv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
							<circle cx="12" cy="9.5" r="2.5" />
						</svg>
						<input
							id="city-input"
							bind:value={city}
							oninput={() => (cityError = null)}
							placeholder="Escribe un municipio"
							required
							list="city-suggest"
							autocomplete="off"
							autocapitalize="words"
							spellcheck="false"
							enterkeyhint="search"
							aria-invalid={cityError ? 'true' : undefined}
							aria-describedby={cityError ? 'city-error' : undefined}
						/>
					</div>
					<button type="submit" class="cv-cta" disabled={isNavigating} aria-busy={isNavigating}>
						{#if isNavigating}
							<span class="cv-spinner" aria-hidden="true"></span> Cargando…
						{:else}
							Ver clima
							<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M5 12h14M13 6l6 6-6 6" />
							</svg>
						{/if}
					</button>
				</div>
				<datalist id="city-suggest">
					{#each CITIES as c}<option value={c}></option>{/each}
				</datalist>
				{#if cityError}
					<p id="city-error" class="cv-error" role="alert">{cityError}</p>
				{/if}

				<div class="cv-row">
					<button
						type="button"
						class="cv-chip"
						class:is-on={provinceOpen}
						aria-expanded={provinceOpen}
						aria-controls="cv-prov"
						onclick={() => (showProvince = !provinceOpen)}
					>
						<svg class="cv-icon cv-chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
							<path d="M12 5v14M5 12h14" />
						</svg>
						{provinceOpen ? 'Ocultar provincia' : 'Acotar por provincia'}
					</button>
				</div>

				<div id="cv-prov" class="cv-search-prov" hidden={!provinceOpen}>
					<div class="cv-prov-row">
						<label for="province-input" class="cv-label">Provincia <span class="cv-muted">(opcional)</span></label>
						<button
							type="button"
							class="cv-chip cv-chip--sm"
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
			</form>

			{#if provinces.length > 0}
				<datalist id="province-list">
					{#each provinces as provinceName}
						<option value={provinceName}></option>
					{/each}
				</datalist>
			{/if}
		</div>
	</section>

	<section class="cv-sheet cv-reveal" style="--i:4" aria-labelledby="quick-title">
		<span class="cv-handle" aria-hidden="true"></span>
		<nav aria-labelledby="quick-title">
			<h2 id="quick-title" class="cv-section-title">Ir directamente a</h2>
			<ul class="cv-cards">
				{#each QUICK as q}
					<li>
						<a href={`/${toSlug(q)}`} class="cv-card">
							<span class="cv-card-ico" aria-hidden="true">
								<svg class="cv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="9" cy="9" r="3.2" /><path d="M9 3v1M3 9h1M4.8 4.8l.7.7" />
									<path d="M9 20h8.5a3.7 3.7 0 0 0 .6-7.36A5.2 5.2 0 0 0 8.2 13.6 3.2 3.2 0 0 0 9 20z" />
								</svg>
							</span>
							<span class="cv-card-txt">
								<strong>{q}</strong>
								<small>{REGION[q]}</small>
							</span>
							<svg class="cv-icon cv-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		<footer class="cv-home-foot">
			<p>Datos oficiales de AEMET</p>
		</footer>
	</section>
</main>

<style>
	.cv-home {
		--r-sm: 10px; --r-md: 18px; --r-lg: 28px; --r-pill: 999px;
		--bg: color-mix(in srgb, #f6f5f2 92%, var(--cv-tone, #8aa0c0));
		--surface: #fff; --surface-2: color-mix(in srgb, #f6f5f2 85%, var(--cv-tone, #8aa0c0));
		--ink: #11141b; --muted: #4f5664; --line: color-mix(in srgb, #11141b 11%, transparent);
		--accent: #f05a1a; --accent-text: #c2410c; --accent-ink: #fff; --danger: #b4232a;
		--ease: cubic-bezier(.2, .8, .2, 1); --ease-out: cubic-bezier(.16, 1, .3, 1);
		--shadow: 0 1px 2px rgb(20 22 26 / .05), 0 8px 24px rgb(20 22 26 / .06);
		position: relative; isolation: isolate;
		min-height: 100vh; min-height: 100dvh;
		background: var(--bg); color: var(--ink);
		font-family: var(--font-display, var(--font-sans, system-ui)), system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		line-height: 1.5; -webkit-font-smoothing: antialiased;
		overflow-x: clip; color-scheme: light dark;
	}
	@media (prefers-color-scheme: dark) {
		.cv-home {
			--bg: color-mix(in srgb, #0c111c 90%, var(--cv-tone, #8aa0c0));
			--surface: color-mix(in srgb, #151c2b 92%, var(--cv-tone, #8aa0c0));
			--surface-2: color-mix(in srgb, #1a2233 90%, var(--cv-tone, #8aa0c0));
			--ink: #f2f4f8; --muted: #a7b0c0; --line: rgb(255 255 255 / .09);
			--accent: #ff7a45; --accent-text: #ff8a5c; --accent-ink: #14161a; --danger: #ff8a8f;
			--shadow: 0 1px 2px rgb(0 0 0 / .3), 0 8px 24px rgb(0 0 0 / .25);
		}
	}
	.cv-home *, .cv-home *::before, .cv-home *::after { box-sizing: border-box; }
	.cv-home :where(h1, h2, p, ul) { margin: 0; }
	.cv-home:focus { outline: none; }
	.cv-home :focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: var(--r-sm); }

	.cv-skip {
		position: fixed; top: 10px; left: 10px; z-index: 50;
		padding: 12px 18px; min-height: 44px; border-radius: var(--r-sm, 10px);
		background: #f05a1a; color: #fff; font-weight: 700; text-decoration: none;
		transform: translateY(-160%); transition: transform .2s;
	}
	.cv-skip:focus { transform: none; }
	.cv-sr {
		position: absolute; width: 1px; height: 1px; overflow: hidden;
		clip-path: inset(50%); white-space: nowrap;
	}
	.cv-icon { width: 20px; height: 20px; flex: none; }
	.cv-icon--md { width: 26px; height: 26px; }

	/* ===== Escena ===== */
	.cv-stage {
		position: relative; isolation: isolate;
		min-height: 88svh; display: grid; align-content: end;
		padding: 1.25rem 1.25rem calc(var(--r-lg) + 2.5rem);
		color: #fff; overflow: hidden;
		background: var(--s2, #8fbff2);
	}
	.cv-scene { position: absolute; inset: 0; z-index: -1; overflow: hidden; }
	.cv-sky {
		position: absolute; inset: 0;
		background: linear-gradient(180deg, var(--s1) 0%, var(--s2) 55%, var(--s3) 100%);
		animation: cv-ken 18s var(--ease-out) both;
	}
	.cv-stars {
		position: absolute; inset: 0 0 45%;
		background-image:
			radial-gradient(1.5px 1.5px at 12% 18%, #fff9, #0000),
			radial-gradient(1px 1px at 28% 32%, #fff8, #0000),
			radial-gradient(1.5px 1.5px at 46% 12%, #fffa, #0000),
			radial-gradient(1px 1px at 63% 26%, #fff7, #0000),
			radial-gradient(1.5px 1.5px at 78% 9%, #fff9, #0000),
			radial-gradient(1px 1px at 92% 30%, #fff6, #0000);
		animation: cv-twinkle 6s ease-in-out infinite alternate;
	}
	.cv-orb {
		position: absolute; left: var(--cx); top: var(--cy);
		width: clamp(56px, 11vw, 120px); aspect-ratio: 1; border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle, #fff6d6 0 38%, #ffd36b 60%, #ffb24a00 72%);
		box-shadow: 0 0 120px 40px #ffc56a3a;
		animation: cv-rise 1.6s var(--ease-out) both;
	}
	.cv-orb--moon {
		width: clamp(36px, 6vw, 64px);
		background: radial-gradient(circle at 38% 38%, #fbfbff, #d9dcec 60%, #b9bdd4);
		box-shadow: 0 0 60px 14px #c9d2ff30;
	}
	.cv-skyline { position: absolute; inset: auto 0 0; width: 100%; height: 24%; fill: #141b2c; }
	.cv-skyline--far { height: 32%; opacity: .45; }
	.is-night .cv-skyline { fill: #05070e; }
	.cv-scrim {
		position: absolute; inset: 0;
		background:
			radial-gradient(130% 85% at 0% 100%, rgb(0 0 0 / .55) 0%, rgb(0 0 0 / .3) 40%, transparent 72%),
			linear-gradient(to bottom, rgb(0 0 0 / .28), transparent 16%);
	}

	.cv-stage-inner { width: min(880px, 100%); max-width: 100%; text-shadow: 0 1px 12px rgb(0 0 0 / .4); }
	.cv-home-head { display: flex; align-items: center; flex-wrap: wrap; gap: .65rem; }
	.cv-logo {
		display: grid; place-items: center; width: 40px; height: 40px;
		border-radius: var(--r-sm); background: var(--accent); color: var(--accent-ink);
		box-shadow: 0 8px 24px -6px rgb(240 90 26 / .6);
	}
	.cv-brand { font-size: .8rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
	.cv-eyebrow {
		display: inline-flex; align-items: center; margin-left: auto;
		padding: .3rem .8rem; border-radius: var(--r-pill);
		background: rgb(0 0 0 / .35); border: 1px solid rgb(255 255 255 / .16);
		-webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
		font-size: .72rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
		color: rgb(255 255 255 / .9); text-shadow: none;
	}
	.cv-dot { margin-inline: .45rem; color: #ff8a5c; }

	.cv-home-title {
		margin: 1.5rem 0 1.5rem; max-width: 100%;
		font-size: clamp(2.6rem, 13vw, 6rem);
		font-weight: 800; line-height: .92; letter-spacing: -.055em;
		overflow-wrap: anywhere; text-shadow: 0 2px 24px rgb(0 0 0 / .4);
	}
	.cv-t1 { display: block; }
	.cv-typed { display: block; min-height: 1em; color: #ff8a5c; white-space: nowrap; }
	.cv-word { display: inline; }
	.cv-word::after {
		content: ''; display: inline-block; width: .07em; height: .78em;
		margin-left: .04em; vertical-align: -.04em; background: currentColor;
		animation: cv-blink 1s steps(1) infinite;
	}
	.cv-home-lead { max-width: 44ch; color: rgb(255 255 255 / .9); font-size: clamp(1rem, 2.2vw, 1.2rem); }

	/* Buscador */
	.cv-search-form { margin-top: 1.5rem; display: grid; gap: .75rem; width: 100%; max-width: 720px; text-shadow: none; }
	.cv-search {
		display: flex; align-items: center; gap: .35rem; width: 100%;
		min-height: 64px; padding: 6px; border-radius: var(--r-md);
		background: var(--surface); color: var(--ink);
		border: 2px solid transparent; box-shadow: 0 18px 48px -12px rgb(0 0 0 / .5);
		transition: border-color .2s, box-shadow .2s;
	}
	.cv-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px rgb(240 90 26 / .25), 0 18px 48px -12px rgb(0 0 0 / .5); }
	.cv-field { flex: 1; min-width: 0; display: flex; align-items: center; height: 48px; }
	.cv-search-icon { margin-left: .6rem; color: var(--accent-text); }
	.cv-search input {
		flex: 1; min-width: 0; height: 100%; padding: 0 .5rem;
		border: 0; background: transparent; color: var(--ink);
		font: 700 1.2rem/1 inherit; font-family: inherit; letter-spacing: -.01em;
	}
	.cv-search input:focus-visible { outline: none; }
	.cv-search input::placeholder { color: var(--muted); font-weight: 500; opacity: 1; }
	.cv-cta {
		display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
		height: 50px; padding: 0 1.15rem; flex: none;
		border: 0; border-radius: calc(var(--r-md) - 6px);
		background: var(--accent); color: var(--accent-ink);
		font: 800 1rem inherit; font-family: inherit; cursor: pointer; white-space: nowrap;
		transition: transform .15s var(--ease), filter .15s;
	}
	.cv-cta:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
	.cv-cta:disabled { cursor: progress; opacity: .8; }
	@media (max-width: 479px) {
		.cv-search { flex-direction: column; align-items: stretch; }
		.cv-cta { width: 100%; }
	}

	.cv-row { display: flex; flex-wrap: wrap; gap: .5rem; }
	.cv-chip {
		display: inline-flex; align-items: center; gap: .45rem;
		min-height: 44px; padding: 0 1rem; border-radius: var(--r-pill);
		border: 1px solid rgb(255 255 255 / .2); background: rgb(0 0 0 / .35);
		-webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
		color: #fff; font: 700 .9rem inherit; font-family: inherit; cursor: pointer;
		transition: background .2s, border-color .2s;
	}
	.cv-chip:hover:not(:disabled) { background: rgb(0 0 0 / .5); border-color: rgb(255 255 255 / .4); }
	.cv-chip-ico { width: 16px; height: 16px; color: #ff8a5c; transition: transform .25s var(--ease); }
	.cv-chip.is-on .cv-chip-ico { transform: rotate(45deg); }
	.cv-chip:disabled { cursor: progress; opacity: .75; }
	.cv-chip--sm {
		min-height: 40px; background: var(--surface-2); color: var(--ink); border-color: var(--line);
		-webkit-backdrop-filter: none; backdrop-filter: none; font-size: .85rem;
	}
	.cv-chip--sm:hover:not(:disabled) { background: var(--surface-2); border-color: var(--accent); }

	.cv-search-prov {
		display: grid; gap: .5rem; padding: 1rem;
		border-radius: var(--r-md); background: var(--surface); color: var(--ink);
		border: 1px solid var(--line); box-shadow: var(--shadow);
		animation: cv-in .3s var(--ease) both;
	}
	.cv-search-prov[hidden] { display: none; }
	.cv-prov-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: .5rem; }
	.cv-label { font-size: .75rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
	.cv-muted { color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; }
	.cv-prov-input {
		width: 100%; min-height: 48px; padding: 0 1rem; border-radius: var(--r-sm);
		border: 1px solid var(--line); background: var(--surface-2); color: var(--ink);
		font: 500 1rem inherit; font-family: inherit;
	}
	.cv-prov-input:focus-visible { border-color: var(--accent); }
	.cv-hint { font-size: .85rem; color: var(--muted); }
	.cv-error {
		padding: .55rem .8rem; border-radius: var(--r-sm);
		border-left: 4px solid var(--danger); background: var(--surface);
		color: var(--danger); font-weight: 600; font-size: .9rem;
	}
	.cv-spinner {
		display: inline-block; width: 1em; height: 1em; border-radius: 50%;
		border: 2px solid currentColor; border-right-color: transparent;
		animation: cv-spin .8s linear infinite;
	}

	/* ===== Hoja ===== */
	.cv-sheet {
		position: relative; z-index: 1;
		margin-top: calc(var(--r-lg) * -1);
		padding: 1.5rem 1.25rem 2rem;
		border-radius: var(--r-lg) var(--r-lg) 0 0;
		background: var(--bg); color: var(--ink);
	}
	.cv-handle {
		display: block; width: 36px; height: 4px; margin: -.5rem auto 1.25rem;
		border-radius: var(--r-pill); background: var(--line);
	}
	.cv-sheet > * { max-width: 880px; margin-inline: auto; }
	.cv-section-title {
		display: flex; align-items: center; gap: .75rem; margin-bottom: 1rem;
		font-size: .75rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
		color: var(--muted);
	}
	.cv-section-title::after {
		content: ''; flex: 1; height: 1px;
		background: color-mix(in srgb, currentColor 25%, transparent);
	}
	.cv-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; padding: 0; list-style: none; }
	@media (min-width: 720px) { .cv-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	.cv-card {
		display: flex; align-items: center; gap: .65rem;
		min-height: 64px; padding: .65rem .75rem; border-radius: var(--r-md);
		background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow);
		color: var(--ink); text-decoration: none;
		transition: transform .2s var(--ease), border-color .2s;
	}
	.cv-card:hover { transform: translateY(-2px); border-color: var(--accent); }
	.cv-card-ico {
		display: grid; place-items: center; width: 38px; height: 38px; flex: none;
		border-radius: var(--r-sm); color: var(--accent-text);
		background: color-mix(in srgb, var(--accent) 15%, transparent);
	}
	.cv-card-txt { display: grid; min-width: 0; line-height: 1.2; }
	.cv-card-txt strong { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.cv-card-txt small { font-size: .78rem; color: var(--muted); }
	.cv-card-arrow { margin-left: auto; width: 16px; height: 16px; color: var(--accent-text); transition: transform .2s var(--ease); }
	.cv-card:hover .cv-card-arrow { transform: translate(2px, -2px); }

	.cv-home-foot {
		margin-top: 2rem; padding-top: 1rem;
		border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		font-size: .85rem; font-weight: 600; color: var(--muted);
	}

	@media (min-width: 1024px) {
		.cv-stage { padding: 3rem 3rem calc(var(--r-lg) + 3rem); min-height: 82svh; }
		.cv-sheet { padding: 2rem 3rem 2.5rem; }
	}

	.cv-reveal {
		animation: cv-in 640ms var(--ease-out) both;
		animation-delay: calc(var(--i, 0) * 80ms + 120ms);
	}
	@keyframes cv-in { from { opacity: 0; transform: translateY(18px); } }
	@keyframes cv-ken { from { transform: scale(1.12); } to { transform: scale(1.02); } }
	@keyframes cv-rise { from { opacity: 0; transform: translate(-50%, -20%); } }
	@keyframes cv-twinkle { from { opacity: .55; } to { opacity: 1; } }
	@keyframes cv-blink { 50% { opacity: 0; } }
	@keyframes cv-spin { to { transform: rotate(360deg); } }

	@media (prefers-reduced-motion: reduce) {
		.cv-home *, .cv-home *::after, .cv-skip {
			animation: none !important; transition-duration: .01ms !important;
		}
		.cv-spinner { border-right-color: currentColor; opacity: .6; }
	}
</style>