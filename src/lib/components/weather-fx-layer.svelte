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

	onMount(() => {
		mounted = true;
		observeContainer();
		void ensureEngine();

		return () => {
			destroyEngine();
			disconnectObserver();
			mounted = false;
		};
	});

	onDestroy(() => {
		destroyEngine();
		disconnectObserver();
	});

	$effect(() => {
		if (!mounted) {
			return;
		}
		void ensureEngine();
	});

	$effect(() => {
		if (!mounted || !engine) {
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
			active
		};
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
