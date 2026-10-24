<script lang="ts">
	import { navigating, page } from '$app/state';
	import { fallbackSeo, isPageSeo, jsonLdScript, type PageSeo } from '$lib/seo';
	import favicon from '../../assets/clima.ico';

	let { children } = $props();
	const buildCommit = __BUILD_COMMIT__;
	const seo = $derived<PageSeo>(
		isPageSeo(page.data.seo) ? page.data.seo : fallbackSeo(page.url.pathname)
	);
	const isErrorPage = $derived(page.status >= 400 || page.error !== null);
	const robots = $derived<PageSeo['robots']>(isErrorPage ? 'noindex,follow' : seo.robots);
	const jsonLd = $derived(!isErrorPage && seo.jsonLd ? jsonLdScript(seo.jsonLd) : '');
	const image = $derived(!isErrorPage ? (seo.image ?? null) : null);
	const isNavigating = $derived(Boolean(navigating.to));
</script>

<svelte:head>
	<link rel="icon" type="image/x-icon" href={favicon} />
	<title>{seo.title}</title>
	<meta name="description" content={seo.description} />
	<link rel="canonical" href={seo.canonical} />
	<meta name="robots" content={robots} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Clima Visual" />
	<meta property="og:locale" content="es_ES" />
	<meta property="og:title" content={seo.title} />
	<meta property="og:description" content={seo.description} />
	<meta property="og:url" content={seo.canonical} />
	{#if image}
		<meta property="og:image" content={image} />
		<meta name="twitter:card" content="summary_large_image" />
	{/if}
	{#if jsonLd}
		{@html jsonLd}
	{/if}
	<link rel="alternate" hreflang="es-ES" href={seo.canonical} />
	<link rel="alternate" hreflang="x-default" href={seo.canonical} />
</svelte:head>

<a class="skip-link" href="#contenido">Saltar al contenido</a>

{#if isNavigating}
	<div class="nav-progress" role="status">
		<span class="visually-hidden">Cargando…</span>
	</div>
{/if}

{@render children()}
<div class="build-version" title={`build ${buildCommit}`} aria-hidden="true">b {buildCommit}</div>

<style>
	:global(:root) {
		color-scheme: light dark;

		/* Tokens de tema (claro por defecto) */
		--bg-base: #eef6f8;
		--bg-gradient:
			radial-gradient(110% 80% at 0% 0%, #d2f0f4 0%, rgba(210, 240, 244, 0) 55%),
			radial-gradient(90% 70% at 100% 100%, #fdebc8 0%, rgba(253, 235, 200, 0) 55%),
			linear-gradient(180deg, #f5fafc 0%, #eaf3f7 100%);
		--ink: #0b2530;
		--ink-muted: #48626e;
		--ink-subtle: #5d7782;
		--card: #ffffff;
		--card-border: rgba(11, 37, 48, 0.09);
		--card-shadow:
			0 1px 2px rgba(11, 37, 48, 0.06),
			0 24px 60px -20px rgba(11, 37, 48, 0.22);
		--field-bg: #f4f8fa;
		--field-border: #c5d6dc;
		--field-border-hover: #94afb9;
		--brand: #0a6f7b;
		--brand-soft: rgba(10, 111, 123, 0.09);
		--brand-ink: #ffffff;
		--accent-ink: #2a2006;
		--danger: #b42318;
		--danger-bg: #fef1ef;
		--success: #106b45;
		--focus: #0a6f7b;
		--focus-ring: rgba(10, 111, 123, 0.22);

		/* Tokens de la escena meteorológica (siempre oscura) */
		--surface: rgba(6, 26, 34, 0.6);
		--surface-strong: rgba(6, 26, 34, 0.82);
		--text-strong: #f4fbff;
		--text-soft: #d4e9ef;
		--accent: #ffc44d;
		--accent-2: #3fd0d4;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--bg-base: #071820;
			--bg-gradient:
				radial-gradient(110% 80% at 0% 0%, #0d3340 0%, rgba(13, 51, 64, 0) 55%),
				radial-gradient(90% 70% at 100% 100%, #2a2412 0%, rgba(42, 36, 18, 0) 55%),
				linear-gradient(180deg, #081c25 0%, #061319 100%);
			--ink: #e8f4f8;
			--ink-muted: #a8c2cb;
			--ink-subtle: #8aa6b0;
			--card: #0d2430;
			--card-border: rgba(190, 230, 242, 0.1);
			--card-shadow:
				0 1px 2px rgba(0, 0, 0, 0.3),
				0 24px 60px -20px rgba(0, 0, 0, 0.6);
			--field-bg: #091c25;
			--field-border: #2a4753;
			--field-border-hover: #3f6573;
			--brand: #63d5da;
			--brand-soft: rgba(99, 213, 218, 0.12);
			--brand-ink: #062126;
			--danger: #ffb4a8;
			--danger-bg: rgba(255, 120, 100, 0.1);
			--success: #82e3b4;
			--focus: #ffd36b;
			--focus-ring: rgba(255, 211, 107, 0.25);
		}
	}

	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	:global(html) {
		-webkit-text-size-adjust: 100%;
		text-size-adjust: 100%;
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		min-height: 100svh;
		background: var(--bg-gradient);
		background-color: var(--bg-base);
		background-attachment: fixed;
		font-family:
			'Space Grotesk',
			'Avenir Next',
			'Segoe UI',
			system-ui,
			sans-serif;
		color: var(--ink);
		line-height: 1.45;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	:global(a) {
		color: inherit;
	}

	:global(button),
	:global(input),
	:global(select) {
		font: inherit;
	}

	:global(:focus-visible) {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}

	:global(.visually-hidden) {
		position: absolute !important;
		width: 1px !important;
		height: 1px !important;
		padding: 0 !important;
		margin: -1px !important;
		overflow: hidden !important;
		clip: rect(0 0 0 0) !important;
		white-space: nowrap !important;
		border: 0 !important;
	}

	:global(.spinner) {
		display: inline-block;
		width: 1em;
		height: 1em;
		flex: none;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.75s linear infinite;
	}

	@keyframes -global-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.skip-link {
		position: fixed;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 10000;
		padding: 0.6rem 1rem;
		border-radius: 10px;
		background: #0b2530;
		color: #ffffff;
		font-weight: 700;
		text-decoration: none;
		transform: translateY(-160%);
		transition: transform 0.15s ease;
	}

	.skip-link:focus-visible,
	.skip-link:focus {
		transform: translateY(0);
		outline: 3px solid #ffd36b;
	}

	.nav-progress {
		position: fixed;
		inset: 0 0 auto 0;
		z-index: 9998;
		height: 3px;
		overflow: hidden;
		background: rgba(255, 196, 77, 0.2);
	}

	.nav-progress::before {
		content: '';
		position: absolute;
		inset: 0;
		width: 40%;
		background: linear-gradient(90deg, #3fd0d4, #ffc44d);
		animation: nav-progress 1.1s ease-in-out infinite;
	}

	@keyframes nav-progress {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(260%);
		}
	}

	.build-version {
		position: fixed;
		right: 0.45rem;
		bottom: 0.32rem;
		z-index: 9999;
		font-size: 0.55rem;
		letter-spacing: 0.06em;
		color: rgba(208, 228, 236, 0.26);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.42);
		user-select: none;
		pointer-events: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(*),
		:global(*::before),
		:global(*::after) {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: 0.01ms !important;
			scroll-behavior: auto !important;
		}

		.nav-progress::before {
			width: 100%;
			animation: none;
		}
	}
</style>