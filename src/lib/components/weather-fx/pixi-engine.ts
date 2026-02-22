import type * as PIXIType from 'pixi.js';
import type { WeatherFxEngine, WeatherFxInput } from './types';
import { WeatherFxSimulation, sampleCloudPuff, sampleFogLobe } from './simulation';

type PixiModule = typeof PIXIType;
const MAX_RENDER_DPR = 1.75;

export class PixiWeatherFxEngine implements WeatherFxEngine {
	private readonly app: PIXIType.Application;
	private readonly sunLayer: PIXIType.Graphics;
	private readonly atmosphereLayer: PIXIType.Graphics;
	private readonly windLayer: PIXIType.Graphics;
	private readonly precipLayer: PIXIType.Graphics;
	private readonly splashLayer: PIXIType.Graphics;
	private readonly flashLayer: PIXIType.Graphics;
	private readonly simulation = new WeatherFxSimulation();
	private width = 1;
	private height = 1;

	constructor(PIXI: PixiModule, canvas: HTMLCanvasElement, input: WeatherFxInput) {
		this.simulation.setInput(input);

		this.app = new PIXI.Application({
			view: canvas,
			antialias: true,
			backgroundAlpha: 0,
			autoDensity: true,
			resolution: Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR)
		});

		this.sunLayer = new PIXI.Graphics();
		this.atmosphereLayer = new PIXI.Graphics();
		this.windLayer = new PIXI.Graphics();
		this.precipLayer = new PIXI.Graphics();
		this.splashLayer = new PIXI.Graphics();
		this.flashLayer = new PIXI.Graphics();

		this.app.stage.addChild(this.sunLayer);
		this.app.stage.addChild(this.atmosphereLayer);
		this.app.stage.addChild(this.windLayer);
		this.app.stage.addChild(this.precipLayer);
		this.app.stage.addChild(this.splashLayer);
		this.app.stage.addChild(this.flashLayer);

		this.precipLayer.blendMode = PIXI.BLEND_MODES.SCREEN;
		this.windLayer.blendMode = PIXI.BLEND_MODES.SCREEN;
		this.flashLayer.blendMode = PIXI.BLEND_MODES.SCREEN;

		const atmosphereBlur = new PIXI.BlurFilter(8.2, 3);
		this.atmosphereLayer.filters = [atmosphereBlur];

		this.app.ticker.add(this.tick);
	}

	setInput(input: WeatherFxInput): void {
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
		this.sunLayer.clear();
		this.atmosphereLayer.clear();
		this.windLayer.clear();
		this.precipLayer.clear();
		this.splashLayer.clear();
		this.flashLayer.clear();

		this.drawSun(this.sunLayer);
		this.drawCloudsAndFog(this.atmosphereLayer);
		this.drawWind(this.windLayer);
		this.drawRain(this.precipLayer);
		this.drawSnow(this.precipLayer);
		this.drawSplashes(this.splashLayer);
		this.drawStormFlash(this.flashLayer);
	}

	private drawSun(g: PIXIType.Graphics): void {
		const amount = this.simulation.getSunAmount();
		if (amount <= 0) {
			return;
		}

		const x = this.width * 0.82;
		const y = this.height * 0.14;
		g.beginFill(0xffdfa5, 0.14 * amount);
		g.drawCircle(x, y, this.width * 0.34);
		g.endFill();
		g.beginFill(0xffcf7a, 0.22 * amount);
		g.drawCircle(x, y, this.width * 0.2);
		g.endFill();
	}

	private drawCloudsAndFog(g: PIXIType.Graphics): void {
		for (const cloud of this.simulation.getCloudParticles()) {
			g.beginFill(0x384a61, cloud.alpha * 0.42);
			g.drawEllipse(
				cloud.x,
				cloud.y + cloud.height * 0.15,
				cloud.width * 0.58,
				cloud.height * 0.42
			);
			g.endFill();

			g.beginFill(0xc7d5e6, cloud.alpha * 0.22);
			g.drawEllipse(
				cloud.x,
				cloud.y - cloud.height * 0.06,
				cloud.width * 0.64,
				cloud.height * 0.5
			);
			g.endFill();

			for (let puffIndex = 0; puffIndex < cloud.puffCount; puffIndex += 1) {
				const puff = sampleCloudPuff(cloud, puffIndex);
				g.beginFill(0xd8e6f4, puff.alpha);
				g.drawEllipse(
					cloud.x + puff.offsetX,
					cloud.y + puff.offsetY - puff.radiusY * 0.08,
					puff.radiusX,
					puff.radiusY
				);
				g.endFill();

				g.beginFill(0x7e94ad, puff.alpha * 0.28);
				g.drawEllipse(
					cloud.x + puff.offsetX + puff.radiusX * 0.08,
					cloud.y + puff.offsetY + puff.radiusY * 0.12,
					puff.radiusX * 0.9,
					puff.radiusY * 0.78
				);
				g.endFill();
			}
		}

		for (const fog of this.simulation.getFogParticles()) {
			g.beginFill(0xd3e2f0, fog.alpha * 0.22);
			g.drawEllipse(fog.x, fog.y, fog.width * 0.54, fog.height * 0.44);
			g.endFill();

			for (let lobeIndex = 0; lobeIndex < 4; lobeIndex += 1) {
				const lobe = sampleFogLobe(fog, lobeIndex);
				g.beginFill(0xd4e4f2, lobe.alpha * 0.88);
				g.drawEllipse(
					fog.x + lobe.offsetX,
					fog.y + lobe.offsetY,
					lobe.radiusX,
					lobe.radiusY
				);
				g.endFill();
			}
		}
	}

	private drawWind(g: PIXIType.Graphics): void {
		for (const gust of this.simulation.getWindParticles()) {
			g.lineStyle(1.15, 0xcfe9ff, gust.alpha);
			g.moveTo(gust.x - gust.length, gust.y);
			g.lineTo(gust.x, gust.y + 1.3);
		}
	}

	private drawRain(g: PIXIType.Graphics): void {
		for (const drop of this.simulation.getRainParticles()) {
			g.lineStyle(Math.max(0.8, drop.width), 0xbde6ff, 0.22 + drop.depth * 0.22);
			g.moveTo(drop.x, drop.y);
			g.lineTo(drop.x - drop.length * 0.24, drop.y - drop.length);
		}
	}

	private drawSnow(g: PIXIType.Graphics): void {
		for (const flake of this.simulation.getSnowParticles()) {
			g.beginFill(0xffffff, 0.34 + flake.depth * 0.32);
			g.drawCircle(flake.x, flake.y, flake.radius);
			g.endFill();
		}
	}

	private drawSplashes(g: PIXIType.Graphics): void {
		for (const splash of this.simulation.getSplashParticles()) {
			g.beginFill(0xd4f1ff, Math.max(0, splash.life * 2.5));
			g.drawCircle(splash.x, splash.y, splash.size);
			g.endFill();
		}
	}

	private drawStormFlash(g: PIXIType.Graphics): void {
		const flash = this.simulation.getStormFlash();
		if (flash <= 0) {
			return;
		}

		g.beginFill(0xe8f4ff, flash * 0.44);
		g.drawRect(0, 0, this.width, this.height);
		g.endFill();
	}
}
