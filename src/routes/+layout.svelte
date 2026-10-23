<script lang="ts">
	import { page } from '$app/state';
	import { fallbackSeo, isPageSeo, type PageSeo } from '$lib/seo';
	import favicon from '../../assets/clima.ico';

	let { children } = $props();
	const buildCommit = __BUILD_COMMIT__;
	const seo = $derived<PageSeo>(
		isPageSeo(page.data.seo) ? page.data.seo : fallbackSeo(page.url.pathname)
	);
</script>

<svelte:head>
	<link rel="icon" type="image/x-icon" href={favicon} />
	<title>{seo.title}</title>
	<meta name="description" content={seo.description} />
	<link rel="canonical" href={seo.canonical} />
	<meta name="robots" content={seo.robots} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Clima Visual" />
	<meta property="og:locale" content="es_ES" />
	<meta property="og:title" content={seo.title} />
	<meta property="og:description" content={seo.description} />
	<meta property="og:url" content={seo.canonical} />
	<link rel="alternate" hreflang="es-ES" href={seo.canonical} />
	<link rel="alternate" hreflang="x-default" href={seo.canonical} />
</svelte:head>

{@render children()}
<div class="build-version" title={`build ${buildCommit}`} aria-hidden="true">b {buildCommit}</div>

<style>
	:global(:root) {
		--bg-base: #f0f7f8;
		--surface: rgba(6, 26, 34, 0.6);
		--surface-strong: rgba(6, 26, 34, 0.82);
		--text-strong: #f4fbff;
		--text-soft: #d4e9ef;
		--accent: #ffc44d;
		--accent-2: #3fd0d4;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		background: radial-gradient(circle at 5% 10%, #d5f4f7 0%, #e9f6ff 28%, #f8fcff 100%);
		font-family:
			'Space Grotesk',
			'Avenir Next',
			'Segoe UI',
			sans-serif;
		color: #0a2430;
	}

	:global(a) {
		color: inherit;
	}

	:global(button),
	:global(input),
	:global(select) {
		font: inherit;
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
</style>
