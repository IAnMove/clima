import type { WeatherFxEngine, WeatherFxInput } from './types';
import { WeatherFxSimulation, sampleCloudPuff, sampleFogLobe } from './simulation';

const MAX_RENDER_DPR = 1.75;

export class Canvas2DWeatherFxEngine implements WeatherFxEngine {
	private readonly canvas: HTMLCanvasElement;
	private readonly context: CanvasRenderingContext2D;
	private readonly simulation = new WeatherFxSimulation();
	private animationHandle = 0;
	private lastTime = 0;
	private width = 1;
	private height = 1;

	constructor(canvas: HTMLCanvasElement, input: WeatherFxInput) {
		const context = canvas.getContext('2d', { alpha: true });
		if (!context) {
			throw new Error('No se pudo crear contexto 2D para el efecto meteorologico');
		}

		this.canvas = canvas;
		this.context = context;
		this.simulation.setInput(input);
		this.start();
	}

	setInput(input: WeatherFxInput): void {
		this.simulation.setInput(input);
	}

	resize(width: number, height: number): void {
		this.width = Math.max(1, Math.floor(width));
		this.height = Math.max(1, Math.floor(height));

		const dpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);
		this.canvas.width = Math.max(1, Math.floor(this.width * dpr));
		this.canvas.height = Math.max(1, Math.floor(this.height * dpr));
		this.canvas.style.width = `${this.width}px`;
		this.canvas.style.height = `${this.height}px`;
		this.context.setTransform(dpr, 0, 0, dpr, 0, 0);

		this.simulation.resize(this.width, this.height);
	}

	destroy(): void {
		if (this.animationHandle) {
			cancelAnimationFrame(this.animationHandle);
			this.animationHandle = 0;
		}
	}

	private start(): void {
		this.lastTime = performance.now();
		this.animationHandle = requestAnimationFrame(this.tick);
	}

	private readonly tick = (now: number): void => {
		const dt = Math.max(0.001, (now - this.lastTime) / 1000);
		this.lastTime = now;

		this.simulation.step(dt);
		this.draw();

		this.animationHandle = requestAnimationFrame(this.tick);
	};

	private draw(): void {
		const ctx = this.context;
		ctx.clearRect(0, 0, this.width, this.height);

		this.drawSun(ctx);
		this.drawClouds(ctx);
		this.drawFog(ctx);
		this.drawWind(ctx);
		this.drawRain(ctx);
		this.drawSnow(ctx);
		this.drawSplash(ctx);
		this.drawStormFlash(ctx);
	}

	private drawSun(ctx: CanvasRenderingContext2D): void {
		const amount = this.simulation.getSunAmount();
		if (amount <= 0) {
			return;
		}

		const gradient = ctx.createRadialGradient(
			this.width * 0.82,
			this.height * 0.14,
			8,
			this.width * 0.82,
			this.height * 0.14,
			this.width * 0.36
		);
		gradient.addColorStop(0, `rgba(255, 226, 166, ${0.58 * amount})`);
		gradient.addColorStop(0.4, `rgba(255, 210, 130, ${0.24 * amount})`);
		gradient.addColorStop(1, 'rgba(255, 210, 130, 0)');

		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, this.width, this.height);
	}

	private drawClouds(ctx: CanvasRenderingContext2D): void {
		const clouds = this.simulation.getCloudParticles();
		if (!clouds.length) {
			return;
		}

		ctx.save();
		ctx.globalCompositeOperation = 'source-over';
		ctx.filter = 'blur(1.4px)';

		for (const cloud of clouds) {
			this.drawEllipticalRadialGradient(
				ctx,
				cloud.x,
				cloud.y + cloud.height * 0.16,
				cloud.width * 0.58,
				cloud.height * 0.42,
				`rgba(57, 74, 95, ${cloud.alpha * 0.44})`,
				'rgba(57, 74, 95, 0)'
			);

			this.drawEllipticalRadialGradient(
				ctx,
				cloud.x,
				cloud.y - cloud.height * 0.04,
				cloud.width * 0.64,
				cloud.height * 0.5,
				`rgba(215, 228, 241, ${cloud.alpha * 0.22})`,
				'rgba(215, 228, 241, 0)'
			);

			for (let puffIndex = 0; puffIndex < cloud.puffCount; puffIndex += 1) {
				const puff = sampleCloudPuff(cloud, puffIndex);
				const x = cloud.x + puff.offsetX;
				const y = cloud.y + puff.offsetY;
				this.drawEllipticalRadialGradient(
					ctx,
					x,
					y - puff.radiusY * 0.08,
					puff.radiusX,
					puff.radiusY,
					`rgba(212, 226, 240, ${puff.alpha})`,
					'rgba(212, 226, 240, 0)'
				);

				this.drawEllipticalRadialGradient(
					ctx,
					x + puff.radiusX * 0.08,
					y + puff.radiusY * 0.14,
					puff.radiusX * 0.9,
					puff.radiusY * 0.78,
					`rgba(123, 143, 165, ${puff.alpha * 0.3})`,
					'rgba(123, 143, 165, 0)'
				);
			}
		}

		ctx.restore();
	}

	private drawFog(ctx: CanvasRenderingContext2D): void {
		const fogParticles = this.simulation.getFogParticles();
		if (!fogParticles.length) {
			return;
		}

		ctx.save();
		ctx.globalCompositeOperation = 'screen';

		for (const fog of fogParticles) {
			for (let lobeIndex = 0; lobeIndex < 4; lobeIndex += 1) {
				const lobe = sampleFogLobe(fog, lobeIndex);
				this.drawEllipticalRadialGradient(
					ctx,
					fog.x + lobe.offsetX,
					fog.y + lobe.offsetY,
					lobe.radiusX,
					lobe.radiusY,
					`rgba(214, 229, 243, ${lobe.alpha})`,
					'rgba(214, 229, 243, 0)'
				);
			}
		}

		ctx.restore();
	}

	private drawWind(ctx: CanvasRenderingContext2D): void {
		const windParticles = this.simulation.getWindParticles();
		if (!windParticles.length) {
			return;
		}

		ctx.lineCap = 'round';
		for (const gust of windParticles) {
			ctx.beginPath();
			ctx.strokeStyle = `rgba(205, 234, 255, ${gust.alpha})`;
			ctx.lineWidth = 1.1;
			ctx.moveTo(gust.x - gust.length, gust.y);
			ctx.lineTo(gust.x, gust.y + 1.3);
			ctx.stroke();
		}
	}

	private drawRain(ctx: CanvasRenderingContext2D): void {
		const rainParticles = this.simulation.getRainParticles();
		if (!rainParticles.length) {
			return;
		}

		ctx.lineCap = 'round';
		for (const drop of rainParticles) {
			ctx.beginPath();
			ctx.strokeStyle = `rgba(185, 227, 255, ${0.2 + drop.depth * 0.24})`;
			ctx.lineWidth = drop.width;
			ctx.moveTo(drop.x, drop.y);
			ctx.lineTo(drop.x - drop.length * 0.24, drop.y - drop.length);
			ctx.stroke();
		}
	}

	private drawSnow(ctx: CanvasRenderingContext2D): void {
		const snowParticles = this.simulation.getSnowParticles();
		if (!snowParticles.length) {
			return;
		}

		for (const flake of snowParticles) {
			ctx.beginPath();
			ctx.fillStyle = `rgba(250, 253, 255, ${0.32 + flake.depth * 0.34})`;
			ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private drawSplash(ctx: CanvasRenderingContext2D): void {
		const splashes = this.simulation.getSplashParticles();
		if (!splashes.length) {
			return;
		}

		for (const splash of splashes) {
			ctx.beginPath();
			ctx.fillStyle = `rgba(204, 236, 255, ${Math.max(0, splash.life * 2.4)})`;
			ctx.arc(splash.x, splash.y, splash.size, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private drawStormFlash(ctx: CanvasRenderingContext2D): void {
		const flash = this.simulation.getStormFlash();
		if (flash <= 0) {
			return;
		}

		ctx.fillStyle = `rgba(225, 240, 255, ${flash * 0.48})`;
		ctx.fillRect(0, 0, this.width, this.height);
	}

	private drawEllipticalRadialGradient(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		radiusX: number,
		radiusY: number,
		startColor: string,
		endColor: string
	): void {
		const safeRadiusY = Math.max(8, radiusY);
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(radiusX / safeRadiusY, 1);
		const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, safeRadiusY);
		gradient.addColorStop(0, startColor);
		gradient.addColorStop(0.55, startColor);
		gradient.addColorStop(1, endColor);
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(0, 0, safeRadiusY, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}
}
