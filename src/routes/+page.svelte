<script lang="ts">
	import { goto } from '$app/navigation';
	import { toSlug } from '$lib/utils/text';

	let city = $state('oviedo');
	let province = $state('');
	let provinces = $state<string[]>([]);
	let loadingProvinces = $state(false);
	let provinceError = $state<string | null>(null);

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
			return;
		}

		const params = new URLSearchParams();
		if (province.trim()) {
			params.set('province', province.trim());
		}

		const query = params.toString();
		void goto(query ? `/${slug}?${query}` : `/${slug}`);
	}
</script>

<main class="home">
	<section class="hero">
		<p class="eyebrow">Clima Visual Experimental</p>
		<h1>Clima por ciudad con fondo híbrido</h1>
		<p class="lead">
			Escribe una ciudad en la URL (`/oviedo`) o usa el formulario. Se prioriza AEMET y puedes filtrar
			por provincia cuando haya ambigüedad.
		</p>

		<form class="search" onsubmit={searchCity}>
			<label>
				Ciudad
				<input bind:value={city} placeholder="Oviedo" required />
			</label>

			<label>
				Provincia (opcional)
				<input bind:value={province} list="province-list" placeholder="Asturias" />
			</label>

			<button type="submit">Ver clima</button>
		</form>

		<div class="tools">
			<button type="button" class="ghost" onclick={() => void loadProvinces()} disabled={loadingProvinces}>
				{loadingProvinces ? 'Cargando provincias...' : 'Cargar provincias'}
			</button>
			{#if provinceError}
				<p class="error">{provinceError}</p>
			{/if}
		</div>

		{#if provinces.length > 0}
			<datalist id="province-list">
				{#each provinces as provinceName}
					<option value={provinceName}></option>
				{/each}
			</datalist>
		{/if}
	</section>
</main>

<style>
	.home {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 1.5rem;
	}

	.hero {
		width: min(760px, 100%);
		background: linear-gradient(160deg, rgba(7, 34, 45, 0.88), rgba(13, 53, 63, 0.9));
		color: var(--text-strong);
		border-radius: 24px;
		padding: clamp(1.5rem, 4vw, 2.75rem);
		box-shadow:
			0 10px 28px rgba(4, 18, 24, 0.22),
			inset 0 0 0 1px rgba(200, 235, 245, 0.15);
	}

	.eyebrow {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		font-size: 0.76rem;
		color: var(--accent);
	}

	h1 {
		margin: 0.6rem 0 0.7rem;
		font-size: clamp(1.6rem, 3vw, 2.5rem);
		line-height: 1.1;
	}

	.lead {
		margin: 0;
		color: var(--text-soft);
		max-width: 58ch;
	}

	.search {
		margin-top: 1.3rem;
		display: grid;
		gap: 0.9rem;
	}

	label {
		display: grid;
		gap: 0.42rem;
		font-size: 0.92rem;
		color: var(--text-soft);
	}

	input {
		padding: 0.72rem 0.84rem;
		border-radius: 12px;
		border: 1px solid rgba(186, 226, 235, 0.45);
		background: rgba(9, 39, 48, 0.72);
		color: var(--text-strong);
	}

	button {
		border: none;
		border-radius: 12px;
		padding: 0.76rem 0.95rem;
		font-weight: 700;
		cursor: pointer;
		background: linear-gradient(120deg, var(--accent), #ffe08f);
		color: #24210f;
	}

	button:disabled {
		opacity: 0.75;
		cursor: wait;
	}

	.ghost {
		background: rgba(8, 43, 55, 0.3);
		color: var(--text-strong);
		border: 1px solid rgba(197, 232, 241, 0.25);
	}

	.tools {
		margin-top: 0.9rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.error {
		margin: 0;
		font-size: 0.92rem;
		color: #ffd3cd;
	}
</style>
