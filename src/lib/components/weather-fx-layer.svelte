<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { WeatherCondition } from '$lib/domain/weather';
	import { Canvas2DWeatherFxEngine } from './weather-fx/canvas2d-engine';
	import type { WeatherFxEngine, WeatherFxInput, WeatherRenderer } from './weather-fx/types';

	let {
		condition = 'unknown',
		windKmh = 0,
		precipitationProbabilityPercent = 0,
		renderer = 'canvas2d',
		active = true,
		onRendererResolved
	} = $props<{
		condition?: WeatherCondition;
		windKmh?: number | null;
		precipitationProbabilityPercent?: number | null;
		renderer?: WeatherRenderer;
		active?: boolean;
		onRendererResolved?: (renderer: WeatherRenderer) => void;
	}>();

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let engine: WeatherFxEngine | null = null;
	let mounted = false;
	let resizeObserver: ResizeObserver | null = null;
	let currentRenderer: WeatherRenderer | null = null;
	let rendererBuildId = 0;
	let qualityScale = $state(1);
	let detachQualityTracking: (() => void) | null = null;

	onMount(() => {
		mounted = true;
		setupQualityTracking();
		observeContainer();
		if (active) {
			void ensureEngine();
		}

		return () => {
			teardownQualityTracking();
			destroyEngine();
			disconnectObserver();
			mounted = false;
		};
	});

	onDestroy(() => {
		teardownQualityTracking();
		destroyEngine();
		disconnectObserver();
	});

	$effect(() => {
		if (!mounted) {
			return;
		}
		if (!active) {
			destroyEngine();
			return;
		}
		void ensureEngine();
	});

	$effect(() => {
		if (!mounted || !engine || !active) {
			return;
		}

		engine.setInput(toEngineInput());
	});

	function observeContainer(): void {
		if (!canvasEl?.parentElement) {
			return;
		}

		disconnectObserver();
		resizeObserver = new ResizeObserver(() => {
			resizeEngine();
		});
		resizeObserver.observe(canvasEl.parentElement);
	}

	function disconnectObserver(): void {
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
	}

	async function ensureEngine(): Promise<void> {
		if (!canvasEl) {
			return;
		}

		if (engine && currentRenderer === renderer) {
			resizeEngine();
			engine.setInput(toEngineInput());
			onRendererResolved?.(currentRenderer);
			return;
		}

		if (engine && currentRenderer !== renderer) {
			// Release the previous renderer before switching.
			destroyEngine();
		}

		const buildId = ++rendererBuildId;
		const created = await createEngine(renderer, canvasEl, toEngineInput());
		if (!created) {
			return;
		}

		if (buildId !== rendererBuildId) {
			created.engine.destroy();
			return;
		}

		destroyEngine();
		engine = created.engine;
		currentRenderer = created.resolvedRenderer;
		resizeEngine();
		engine.setInput(toEngineInput());
		onRendererResolved?.(created.resolvedRenderer);
	}

	function resizeEngine(): void {
		if (!canvasEl || !engine) {
			return;
		}

		const host = canvasEl.parentElement;
		if (!host) {
			return;
		}

		const rect = host.getBoundingClientRect();
		engine.resize(rect.width, rect.height);
	}

	function destroyEngine(): void {
		if (engine) {
			engine.destroy();
			engine = null;
		}
		currentRenderer = null;
	}

	function toEngineInput(): WeatherFxInput {
		return {
			condition,
			windKmh: sanitizeNumber(windKmh),
			precipitationProbabilityPercent: sanitizeNumber(precipitationProbabilityPercent),
			active,
			qualityScale
		};
	}

	function setupQualityTracking(): void {
		if (typeof window === 'undefined') {
			return;
		}

		const refresh = () => {
			qualityScale = detectQualityScale();
		};

		const mediaQueries = [
			window.matchMedia('(max-width: 900px)'),
			window.matchMedia('(max-width: 520px)'),
			window.matchMedia('(pointer: coarse)'),
			window.matchMedia('(prefers-reduced-motion: reduce)')
		];

		for (const query of mediaQueries) {
			query.addEventListener('change', refresh);
		}
		window.addEventListener('resize', refresh, { passive: true });
		window.addEventListener('orientationchange', refresh);
		refresh();

		detachQualityTracking = () => {
			for (const query of mediaQueries) {
				query.removeEventListener('change', refresh);
			}
			window.removeEventListener('resize', refresh);
			window.removeEventListener('orientationchange', refresh);
		};
	}

	function teardownQualityTracking(): void {
		if (detachQualityTracking) {
			detachQualityTracking();
			detachQualityTracking = null;
		}
	}

	function detectQualityScale(): number {
		if (typeof window === 'undefined') {
			return 1;
		}

		let scale = 1;
		const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
		const isNarrow = window.matchMedia('(max-width: 900px)').matches;
		const isVeryNarrow = window.matchMedia('(max-width: 520px)').matches;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const nav = navigator as Navigator & { deviceMemory?: number };
		const cpuThreads = navigator.hardwareConcurrency ?? 8;

		if (isCoarsePointer || isNarrow) {
			scale = 0.42;
		}
		if (isVeryNarrow) {
			scale = 0.26;
		}
		if (reducedMotion) {
			scale = Math.min(scale, 0.18);
		}

		if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) {
			scale *= 0.72;
		}
		if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) {
			scale *= 0.62;
		}
		if (cpuThreads <= 4) {
			scale *= 0.8;
		}
		if (cpuThreads <= 2) {
			scale *= 0.72;
		}

		return clampQualityScale(scale);
	}

	function clampQualityScale(value: number): number {
		if (!Number.isFinite(value)) {
			return 1;
		}

		return Math.min(1, Math.max(0.12, value));
	}

	async function createEngine(
		targetRenderer: WeatherRenderer,
		canvas: HTMLCanvasElement,
		input: WeatherFxInput
	): Promise<{ engine: WeatherFxEngine; resolvedRenderer: WeatherRenderer } | null> {
		if (targetRenderer === 'canvas2d') {
			return {
				engine: new Canvas2DWeatherFxEngine(canvas, input),
				resolvedRenderer: 'canvas2d'
			};
		}

		try {
			const [{ PixiWeatherFxEngine }, PIXI] = await Promise.all([
				import('./weather-fx/pixi-engine'),
				import('pixi.js')
			]);
			return {
				engine: new PixiWeatherFxEngine(PIXI, canvas, input),
				resolvedRenderer: 'pixijs'
			};
		} catch (error) {
			console.warn('Pixi renderer unavailable, fallback to Canvas2D', error);
			// Fallback to Canvas 2D when WebGL / Pixi cannot initialize.
			return {
				engine: new Canvas2DWeatherFxEngine(canvas, input),
				resolvedRenderer: 'canvas2d'
			};
		}
	}

	function sanitizeNumber(value: number | null | undefined): number {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return 0;
		}

		return Math.max(0, value);
	}
</script>

<div class="fx-layer" aria-hidden="true">
	{#key renderer}
		<canvas bind:this={canvasEl} class="fx-canvas"></canvas>
	{/key}
</div>

<style>
	.fx-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 0;
	}

	.fx-canvas {
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
	}
</style>
