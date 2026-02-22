import type { WeatherFxEngine, WeatherFxInput } from './types';
import { WeatherFxSimulation } from './simulation';

export class Canvas2DWeatherFxEngine implements WeatherFxEngine {
	private readonly canvas: HTMLCanvasElement;
	private readonly context: CanvasRenderingContext2D;
	private readonly simulation = new WeatherFxSimulation();
	private input: WeatherFxInput;
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
		this.input = input;
		this.simulation.setInput(input);
		this.start();
	}

	setInput(input: WeatherFxInput): void {
		this.input = input;
		this.simulation.setInput(input);
	}

	resize(width: number, height: number): void {
		this.width = Math.max(1, Math.floor(width));
		this.height = Math.max(1, Math.floor(height));

		const dpr = window.devicePixelRatio || 1;
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
		gradient.addColorStop(0, `rgba(255, 226, 166, ${0.5 * amount})`);
		gradient.addColorStop(0.4, `rgba(255, 210, 130, ${0.2 * amount})`);
		gradient.addColorStop(1, 'rgba(255, 210, 130, 0)');

		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, this.width, this.height);
	}

	private drawClouds(ctx: CanvasRenderingContext2D): void {
		const clouds = this.simulation.getCloudParticles();
		for (const cloud of clouds) {
			ctx.beginPath();
			ctx.ellipse(cloud.x, cloud.y, cloud.radiusX, cloud.radiusY, 0, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(200, 219, 236, ${cloud.alpha})`;
			ctx.fill();
		}
	}

	private drawFog(ctx: CanvasRenderingContext2D): void {
		const fogParticles = this.simulation.getFogParticles();
		for (const fog of fogParticles) {
			const gradient = ctx.createRadialGradient(fog.x, fog.y, 0, fog.x, fog.y, fog.radius);
			gradient.addColorStop(0, `rgba(211, 228, 244, ${fog.alpha})`);
			gradient.addColorStop(1, 'rgba(211, 228, 244, 0)');

			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(fog.x, fog.y, fog.radius, 0, Math.PI * 2);
			ctx.fill();
		}
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
			ctx.lineWidth = 1.2;
			ctx.moveTo(gust.x - gust.length, gust.y);
			ctx.lineTo(gust.x, gust.y + 1.5);
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
			ctx.strokeStyle = `rgba(186, 227, 255, ${0.22 + drop.depth * 0.25})`;
			ctx.lineWidth = Math.max(0.7, drop.depth);
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
			ctx.fillStyle = `rgba(250, 253, 255, ${0.35 + flake.depth * 0.34})`;
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

		ctx.fillStyle = `rgba(225, 240, 255, ${flash * 0.45})`;
		ctx.fillRect(0, 0, this.width, this.height);
	}
}

