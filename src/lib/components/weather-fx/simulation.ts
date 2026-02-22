import type { WeatherCondition } from '$lib/domain/weather';
import type { WeatherFxInput } from './types';

interface RainParticle {
	x: number;
	y: number;
	vy: number;
	length: number;
	depth: number;
}

interface SnowParticle {
	x: number;
	y: number;
	vy: number;
	radius: number;
	phase: number;
	depth: number;
}

interface CloudParticle {
	x: number;
	y: number;
	vx: number;
	radiusX: number;
	radiusY: number;
	alpha: number;
	depth: number;
}

interface FogParticle {
	x: number;
	y: number;
	vx: number;
	radius: number;
	alpha: number;
}

interface WindParticle {
	x: number;
	y: number;
	vx: number;
	length: number;
	alpha: number;
}

interface SplashParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	size: number;
}

const DEFAULT_INPUT: WeatherFxInput = {
	condition: 'unknown',
	windKmh: 0,
	precipitationProbabilityPercent: 0,
	active: true
};

export class WeatherFxSimulation {
	private width = 1;
	private height = 1;
	private input: WeatherFxInput = DEFAULT_INPUT;
	private time = 0;
	private stormFlash = 0;

	private readonly rainParticles: RainParticle[] = [];
	private readonly snowParticles: SnowParticle[] = [];
	private readonly cloudParticles: CloudParticle[] = [];
	private readonly fogParticles: FogParticle[] = [];
	private readonly windParticles: WindParticle[] = [];
	private readonly splashParticles: SplashParticle[] = [];

	setInput(nextInput: WeatherFxInput): void {
		this.input = nextInput;
	}

	resize(width: number, height: number): void {
		this.width = Math.max(1, Math.floor(width));
		this.height = Math.max(1, Math.floor(height));
	}

	step(dtSeconds: number): void {
		const dt = clamp(dtSeconds, 0, 0.05);
		this.time += dt;

		const windStrength = clamp(this.input.windKmh / 90, 0, 1);
		const windDirection = 1;
		const windPxPerSecond = lerp(10, 290, windStrength) * windDirection;
		const precipStrength = clamp(this.input.precipitationProbabilityPercent / 100, 0, 1);
		const condition = this.input.active ? this.input.condition : 'unknown';

		const rainIntensity = getRainIntensity(condition, precipStrength);
		const snowIntensity = condition === 'snow' ? lerp(0.45, 1, precipStrength) : 0;
		const fogIntensity = condition === 'fog' ? 1 : condition === 'cloudy' ? 0.32 : 0.12;
		const cloudIntensity =
			condition === 'clear'
				? 0.2
				: condition === 'fog'
					? 0.55
					: condition === 'unknown'
						? 0.5
						: 0.8;
		const windIntensity = clamp((windStrength - 0.08) / 0.92, 0, 1);

		const targetRain = Math.round((this.input.active ? rainIntensity : 0) * 260);
		const targetSnow = Math.round((this.input.active ? snowIntensity : 0) * 180);
		const targetCloud = Math.round((this.input.active ? cloudIntensity : 0) * 16);
		const targetFog = Math.round((this.input.active ? fogIntensity : 0) * 24);
		const targetWind = Math.round((this.input.active ? windIntensity : 0) * 54);

		this.syncRain(targetRain, windPxPerSecond, rainIntensity);
		this.syncSnow(targetSnow);
		this.syncClouds(targetCloud, windPxPerSecond, condition);
		this.syncFog(targetFog, windPxPerSecond, condition);
		this.syncWind(targetWind, windPxPerSecond);

		this.updateRain(dt, windPxPerSecond);
		this.updateSnow(dt, windPxPerSecond);
		this.updateClouds(dt, windPxPerSecond);
		this.updateFog(dt, windPxPerSecond);
		this.updateWind(dt, windPxPerSecond);
		this.updateSplashes(dt);

		this.updateStormFlash(dt, condition, rainIntensity);
	}

	getSunAmount(): number {
		if (!this.input.active) {
			return 0;
		}

		return this.input.condition === 'clear' ? 0.85 : this.input.condition === 'cloudy' ? 0.2 : 0;
	}

	getStormFlash(): number {
		return this.stormFlash;
	}

	getRainParticles(): readonly RainParticle[] {
		return this.rainParticles;
	}

	getSnowParticles(): readonly SnowParticle[] {
		return this.snowParticles;
	}

	getCloudParticles(): readonly CloudParticle[] {
		return this.cloudParticles;
	}

	getFogParticles(): readonly FogParticle[] {
		return this.fogParticles;
	}

	getWindParticles(): readonly WindParticle[] {
		return this.windParticles;
	}

	getSplashParticles(): readonly SplashParticle[] {
		return this.splashParticles;
	}

	private syncRain(target: number, windPxPerSecond: number, intensity: number): void {
		while (this.rainParticles.length < target) {
			this.rainParticles.push(this.createRainParticle(windPxPerSecond, intensity, true));
		}

		if (this.rainParticles.length > target) {
			this.rainParticles.length = target;
		}
	}

	private syncSnow(target: number): void {
		while (this.snowParticles.length < target) {
			this.snowParticles.push(this.createSnowParticle(true));
		}

		if (this.snowParticles.length > target) {
			this.snowParticles.length = target;
		}
	}

	private syncClouds(target: number, windPxPerSecond: number, condition: WeatherCondition): void {
		while (this.cloudParticles.length < target) {
			this.cloudParticles.push(this.createCloudParticle(windPxPerSecond, condition, true));
		}

		if (this.cloudParticles.length > target) {
			this.cloudParticles.length = target;
		}
	}

	private syncFog(target: number, windPxPerSecond: number, condition: WeatherCondition): void {
		while (this.fogParticles.length < target) {
			this.fogParticles.push(this.createFogParticle(windPxPerSecond, condition, true));
		}

		if (this.fogParticles.length > target) {
			this.fogParticles.length = target;
		}
	}

	private syncWind(target: number, windPxPerSecond: number): void {
		while (this.windParticles.length < target) {
			this.windParticles.push(this.createWindParticle(windPxPerSecond, true));
		}

		if (this.windParticles.length > target) {
			this.windParticles.length = target;
		}
	}

	private updateRain(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.rainParticles.length; index += 1) {
			const particle = this.rainParticles[index];
			particle.x += (windPxPerSecond * 0.22 + 10 * particle.depth) * dt;
			particle.y += particle.vy * dt;

			if (particle.y > this.height + particle.length) {
				this.spawnSplash(particle.x, this.height - 2, windPxPerSecond);
				this.rainParticles[index] = this.createRainParticle(windPxPerSecond, 0.6, false);
			}

			if (particle.x > this.width + 80) {
				particle.x = -80;
			}
		}
	}

	private updateSnow(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.snowParticles.length; index += 1) {
			const particle = this.snowParticles[index];
			const drift = Math.sin(this.time * 1.1 + particle.phase) * 25 * (1.5 - particle.depth);
			particle.x += (windPxPerSecond * 0.06 + drift) * dt;
			particle.y += particle.vy * dt;

			if (particle.y > this.height + 20) {
				this.snowParticles[index] = this.createSnowParticle(false);
			}

			if (particle.x > this.width + 30) {
				particle.x = -30;
			}
			if (particle.x < -40) {
				particle.x = this.width + 40;
			}
		}
	}

	private updateClouds(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.cloudParticles.length; index += 1) {
			const cloud = this.cloudParticles[index];
			cloud.x += (cloud.vx + windPxPerSecond * 0.02) * dt;

			if (cloud.x - cloud.radiusX > this.width + 40) {
				cloud.x = -cloud.radiusX - rand(20, 140);
			}
		}
	}

	private updateFog(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.fogParticles.length; index += 1) {
			const fog = this.fogParticles[index];
			fog.x += (fog.vx + windPxPerSecond * 0.015) * dt;

			if (fog.x - fog.radius > this.width + 100) {
				fog.x = -fog.radius - rand(40, 180);
			}
		}
	}

	private updateWind(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.windParticles.length; index += 1) {
			const gust = this.windParticles[index];
			gust.x += (gust.vx + windPxPerSecond * 0.35) * dt;

			if (gust.x - gust.length > this.width + 40) {
				this.windParticles[index] = this.createWindParticle(windPxPerSecond, false);
			}
		}
	}

	private updateSplashes(dt: number): void {
		for (let index = this.splashParticles.length - 1; index >= 0; index -= 1) {
			const splash = this.splashParticles[index];
			splash.x += splash.vx * dt;
			splash.y += splash.vy * dt;
			splash.vy += 360 * dt;
			splash.life -= dt;

			if (splash.life <= 0) {
				this.splashParticles.splice(index, 1);
			}
		}

		if (this.splashParticles.length > 240) {
			this.splashParticles.splice(0, this.splashParticles.length - 240);
		}
	}

	private updateStormFlash(dt: number, condition: WeatherCondition, rainIntensity: number): void {
		if (condition === 'storm') {
			if (Math.random() < dt * (0.45 + rainIntensity * 0.9)) {
				this.stormFlash = rand(0.35, 0.85);
			}
		}

		if (this.stormFlash > 0) {
			this.stormFlash = Math.max(0, this.stormFlash - dt * 1.7);
		}
	}

	private createRainParticle(
		windPxPerSecond: number,
		intensity: number,
		randomY: boolean
	): RainParticle {
		const depth = rand(0.6, 1.35);
		return {
			x: rand(-40, this.width + 40),
			y: randomY ? rand(-this.height, this.height) : rand(-this.height * 0.25, -8),
			vy: rand(620, 1220) * depth * lerp(0.82, 1.12, intensity),
			length: rand(8, 22) * depth,
			depth
		};
	}

	private createSnowParticle(randomY: boolean): SnowParticle {
		const depth = rand(0.55, 1.2);
		return {
			x: rand(-30, this.width + 30),
			y: randomY ? rand(-this.height, this.height) : rand(-this.height * 0.2, -6),
			vy: rand(28, 94) * depth,
			radius: rand(1.2, 3.4) * depth,
			phase: rand(0, Math.PI * 2),
			depth
		};
	}

	private createCloudParticle(
		windPxPerSecond: number,
		condition: WeatherCondition,
		randomX: boolean
	): CloudParticle {
		const depth = rand(0.45, 1.2);
		const cloudTopBand =
			condition === 'fog' ? rand(0.04, 0.45) : condition === 'clear' ? rand(0.05, 0.28) : rand(0.04, 0.4);
		return {
			x: randomX ? rand(-180, this.width + 180) : -rand(120, 260),
			y: this.height * cloudTopBand,
			vx: rand(8, 28) * depth + windPxPerSecond * 0.02,
			radiusX: rand(72, 220) * depth,
			radiusY: rand(24, 72) * depth,
			alpha: rand(0.08, 0.2),
			depth
		};
	}

	private createFogParticle(
		windPxPerSecond: number,
		condition: WeatherCondition,
		randomX: boolean
	): FogParticle {
		return {
			x: randomX ? rand(-240, this.width + 240) : -rand(120, 260),
			y: this.height * rand(condition === 'fog' ? 0.3 : 0.45, 0.96),
			vx: rand(6, 18) + windPxPerSecond * 0.01,
			radius: rand(120, 360),
			alpha: rand(condition === 'fog' ? 0.04 : 0.015, condition === 'fog' ? 0.12 : 0.05)
		};
	}

	private createWindParticle(windPxPerSecond: number, randomX: boolean): WindParticle {
		return {
			x: randomX ? rand(-200, this.width + 200) : -rand(80, 180),
			y: rand(this.height * 0.14, this.height * 0.82),
			vx: rand(120, 340) + windPxPerSecond * 0.55,
			length: rand(30, 96),
			alpha: rand(0.12, 0.34)
		};
	}

	private spawnSplash(x: number, y: number, windPxPerSecond: number): void {
		const particles = randInt(1, 3);
		for (let index = 0; index < particles; index += 1) {
			this.splashParticles.push({
				x: x + rand(-4, 4),
				y: y + rand(-2, 1),
				vx: rand(-18, 20) + windPxPerSecond * 0.03,
				vy: rand(-80, -26),
				life: rand(0.14, 0.34),
				size: rand(0.8, 1.9)
			});
		}
	}
}

function getRainIntensity(condition: WeatherCondition, precipitationStrength: number): number {
	if (condition === 'storm') {
		return lerp(0.68, 1, precipitationStrength || 0.85);
	}

	if (condition === 'rain') {
		return lerp(0.45, 0.88, precipitationStrength || 0.65);
	}

	if (condition === 'fog') {
		return 0.04;
	}

	return 0;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, t: number): number {
	return from + (to - from) * clamp(t, 0, 1);
}

function rand(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
	return Math.floor(rand(min, max + 1));
}

