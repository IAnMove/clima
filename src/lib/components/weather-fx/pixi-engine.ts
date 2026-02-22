import type * as PIXIType from 'pixi.js';
import type { WeatherFxEngine, WeatherFxInput } from './types';
import { WeatherFxSimulation } from './simulation';

type PixiModule = typeof PIXIType;

export class PixiWeatherFxEngine implements WeatherFxEngine {
	private readonly app: PIXIType.Application;
	private readonly graphics: PIXIType.Graphics;
	private readonly simulation = new WeatherFxSimulation();
	private input: WeatherFxInput;
	private width = 1;
	private height = 1;

	constructor(PIXI: PixiModule, canvas: HTMLCanvasElement, input: WeatherFxInput) {
		this.input = input;
		this.simulation.setInput(input);

		this.app = new PIXI.Application({
			view: canvas,
			antialias: true,
			backgroundAlpha: 0,
			autoDensity: true,
			resolution: window.devicePixelRatio || 1
		});

		this.graphics = new PIXI.Graphics();
		this.app.stage.addChild(this.graphics);
		this.app.ticker.add(this.tick);
	}

	setInput(input: WeatherFxInput): void {
		this.input = input;
		this.simulation.setInput(input);
	}

	resize(width: number, height: number): void {
		this.width = Math.max(1, Math.floor(width));
		this.height = Math.max(1, Math.floor(height));
		this.app.renderer.resize(this.width, this.height);
		this.simulation.resize(this.width, this.height);
	}

	destroy(): void {
		this.app.ticker.remove(this.tick);
		this.app.destroy();
	}

	private readonly tick = (): void => {
		const dt = Math.max(0.001, this.app.ticker.deltaMS / 1000);
		this.simulation.step(dt);
		this.draw();
	};

	private draw(): void {
		const g = this.graphics;
		g.clear();

		this.drawSun(g);
		this.drawClouds(g);
		this.drawFog(g);
		this.drawWind(g);
		this.drawRain(g);
		this.drawSnow(g);
		this.drawSplashes(g);
		this.drawStormFlash(g);
	}

	private drawSun(g: PIXIType.Graphics): void {
		const amount = this.simulation.getSunAmount();
		if (amount <= 0) {
			return;
		}

		const x = this.width * 0.82;
		const y = this.height * 0.14;
		g.beginFill(0xffe1b1, 0.12 * amount);
		g.drawCircle(x, y, this.width * 0.34);
		g.endFill();
		g.beginFill(0xffd896, 0.24 * amount);
		g.drawCircle(x, y, this.width * 0.17);
		g.endFill();
	}

	private drawClouds(g: PIXIType.Graphics): void {
		for (const cloud of this.simulation.getCloudParticles()) {
			g.beginFill(0xc8dbec, cloud.alpha);
			g.drawEllipse(cloud.x, cloud.y, cloud.radiusX, cloud.radiusY);
			g.endFill();
		}
	}

	private drawFog(g: PIXIType.Graphics): void {
		for (const fog of this.simulation.getFogParticles()) {
			g.beginFill(0xd2e4f3, fog.alpha * 0.85);
			g.drawCircle(fog.x, fog.y, fog.radius);
			g.endFill();
		}
	}

	private drawWind(g: PIXIType.Graphics): void {
		for (const gust of this.simulation.getWindParticles()) {
			g.lineStyle(1.2, 0xcdeaff, gust.alpha);
			g.moveTo(gust.x - gust.length, gust.y);
			g.lineTo(gust.x, gust.y + 1.5);
		}
	}

	private drawRain(g: PIXIType.Graphics): void {
		for (const drop of this.simulation.getRainParticles()) {
			g.lineStyle(Math.max(0.8, drop.depth), 0xbbe2ff, 0.23 + drop.depth * 0.22);
			g.moveTo(drop.x, drop.y);
			g.lineTo(drop.x - drop.length * 0.24, drop.y - drop.length);
		}
	}

	private drawSnow(g: PIXIType.Graphics): void {
		for (const flake of this.simulation.getSnowParticles()) {
			g.beginFill(0xffffff, 0.36 + flake.depth * 0.32);
			g.drawCircle(flake.x, flake.y, flake.radius);
			g.endFill();
		}
	}

	private drawSplashes(g: PIXIType.Graphics): void {
		for (const splash of this.simulation.getSplashParticles()) {
			g.beginFill(0xcfedff, Math.max(0, splash.life * 2.4));
			g.drawCircle(splash.x, splash.y, splash.size);
			g.endFill();
		}
	}

	private drawStormFlash(g: PIXIType.Graphics): void {
		const flash = this.simulation.getStormFlash();
		if (flash <= 0) {
			return;
		}

		g.beginFill(0xe7f3ff, flash * 0.42);
		g.drawRect(0, 0, this.width, this.height);
		g.endFill();
	}
}

