import type { WeatherCondition } from '$lib/domain/weather';
import type { WeatherFxInput } from './types';

export type PrecipitationLevel = 'none' | 'low' | 'medium' | 'high';
const PRECIPITATION_PARTICLE_MULTIPLIER = 2;

export interface RainParticle {
	x: number;
	y: number;
	vy: number;
	length: number;
	width: number;
	depth: number;
}

export interface SnowParticle {
	x: number;
	y: number;
	vy: number;
	radius: number;
	phase: number;
	depth: number;
}

export interface CloudParticle {
	x: number;
	y: number;
	baseY: number;
	vx: number;
	width: number;
	height: number;
	alpha: number;
	density: number;
	depth: number;
	puffCount: number;
	seed: number;
	swayPhase: number;
	swayAmplitude: number;
}

export interface FogParticle {
	x: number;
	y: number;
	vx: number;
	width: number;
	height: number;
	alpha: number;
	phase: number;
	depth: number;
}

export interface WindParticle {
	x: number;
	y: number;
	vx: number;
	length: number;
	alpha: number;
}

export interface SplashParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	size: number;
}

export interface CloudPuff {
	offsetX: number;
	offsetY: number;
	radiusX: number;
	radiusY: number;
	alpha: number;
}

export interface FogLobe {
	offsetX: number;
	offsetY: number;
	radiusX: number;
	radiusY: number;
	alpha: number;
}

const DEFAULT_INPUT: WeatherFxInput = {
	condition: 'unknown',
	windKmh: 0,
	precipitationProbabilityPercent: 0,
	active: true,
	qualityScale: 1
};

export class WeatherFxSimulation {
	private width = 1;
	private height = 1;
	private input: WeatherFxInput = DEFAULT_INPUT;
	private time = 0;
	private stormFlash = 0;
	private precipLevel: PrecipitationLevel = 'none';

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
		const windPxPerSecond = lerp(8, 310, windStrength);
		const precipStrength = clamp(this.input.precipitationProbabilityPercent / 100, 0, 1);
		const condition = this.input.active ? this.input.condition : 'unknown';
		const qualityScale = clamp(this.input.qualityScale ?? 1, 0.12, 1);
		const particleDensityScale = resolveParticleDensityScale(this.width, this.height) * qualityScale;
		const atmosphericDensityScale =
			lerp(0.66, 1, particleDensityScale) * lerp(0.8, 1, qualityScale);
		const cloudFactor =
			qualityScale < 0.2 ? 0.28 : qualityScale < 0.35 ? 0.46 : qualityScale < 0.5 ? 0.68 : 1;
		const fogFactor =
			qualityScale < 0.2 ? 0 : qualityScale < 0.35 ? 0.2 : qualityScale < 0.6 ? 0.42 : 1;

		this.precipLevel = resolvePrecipitationLevel(condition, precipStrength);
		const rainIntensity = getRainIntensity(condition, precipStrength, this.precipLevel);
		const snowIntensity = getSnowIntensity(condition, precipStrength, this.precipLevel);
		const cloudIntensity = getCloudIntensity(condition);
		const fogIntensity = getFogIntensity(condition);
		const windIntensity = clamp((windStrength - 0.05) / 0.95, 0, 1);

		const targetRain = Math.round(
			(this.input.active ? rainIntensity : 0) *
				340 *
				PRECIPITATION_PARTICLE_MULTIPLIER *
				particleDensityScale
		);
		const targetSnow = Math.round(
			(this.input.active ? snowIntensity : 0) *
				210 *
				PRECIPITATION_PARTICLE_MULTIPLIER *
				particleDensityScale
		);
		const targetCloud = Math.round(
			(this.input.active ? cloudIntensity : 0) * 14 * atmosphericDensityScale * cloudFactor
		);
		const targetFog = Math.round(
			(this.input.active ? fogIntensity : 0) * 20 * atmosphericDensityScale * fogFactor
		);
		const targetWind = Math.round((this.input.active ? windIntensity : 0) * 58 * particleDensityScale);

		this.syncRain(targetRain, windPxPerSecond, rainIntensity);
		this.syncSnow(targetSnow);
		this.syncClouds(targetCloud, windPxPerSecond, condition);
		this.syncFog(targetFog, windPxPerSecond, condition);
		this.syncWind(targetWind, windPxPerSecond);

		this.updateRain(dt, windPxPerSecond, rainIntensity);
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

		return this.input.condition === 'clear' ? 0.86 : this.input.condition === 'cloudy' ? 0.18 : 0;
	}

	getStormFlash(): number {
		return this.stormFlash;
	}

	getPrecipitationLevel(): PrecipitationLevel {
		return this.precipLevel;
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

	private updateRain(dt: number, windPxPerSecond: number, intensity: number): void {
		for (let index = 0; index < this.rainParticles.length; index += 1) {
			const particle = this.rainParticles[index];
			particle.x += (windPxPerSecond * 0.24 + 8 * particle.depth) * dt;
			particle.y += particle.vy * dt;

			if (particle.y > this.height + particle.length) {
				this.spawnSplash(particle.x, this.height - 2, windPxPerSecond, intensity);
				this.rainParticles[index] = this.createRainParticle(windPxPerSecond, intensity, false);
			}

			if (particle.x > this.width + 120) {
				particle.x = -120;
			}
		}
	}

	private updateSnow(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.snowParticles.length; index += 1) {
			const particle = this.snowParticles[index];
			const drift = Math.sin(this.time * 0.92 + particle.phase) * 30 * (1.4 - particle.depth);
			particle.x += (windPxPerSecond * 0.07 + drift) * dt;
			particle.y += particle.vy * dt;

			if (particle.y > this.height + 24) {
				this.snowParticles[index] = this.createSnowParticle(false);
			}

			if (particle.x > this.width + 40) {
				particle.x = -40;
			}
			if (particle.x < -50) {
				particle.x = this.width + 50;
			}
		}
	}

	private updateClouds(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.cloudParticles.length; index += 1) {
			const cloud = this.cloudParticles[index];
			cloud.x += (cloud.vx + windPxPerSecond * 0.015) * dt;
			cloud.y = cloud.baseY + Math.sin(this.time * 0.12 + cloud.swayPhase) * cloud.swayAmplitude;

			if (cloud.x - cloud.width > this.width + 140) {
				const nextCloud = this.createCloudParticle(windPxPerSecond, this.input.condition, false);
				nextCloud.x = -nextCloud.width - rand(40, 220);
				this.cloudParticles[index] = nextCloud;
			}
		}
	}

	private updateFog(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.fogParticles.length; index += 1) {
			const fog = this.fogParticles[index];
			const wave = Math.sin(this.time * 0.22 + fog.phase) * 18;
			fog.x += (fog.vx + windPxPerSecond * 0.01 + wave * 0.03) * dt;

			if (fog.x - fog.width > this.width + 180) {
				fog.x = -fog.width - rand(80, 220);
			}
		}
	}

	private updateWind(dt: number, windPxPerSecond: number): void {
		for (let index = 0; index < this.windParticles.length; index += 1) {
			const gust = this.windParticles[index];
			gust.x += (gust.vx + windPxPerSecond * 0.4) * dt;

			if (gust.x - gust.length > this.width + 60) {
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

		const qualityScale = clamp(this.input.qualityScale ?? 1, 0.12, 1);
		const splashLimit = Math.round(
			340 *
				PRECIPITATION_PARTICLE_MULTIPLIER *
				resolveParticleDensityScale(this.width, this.height) *
				qualityScale
		);
		if (this.splashParticles.length > splashLimit) {
			this.splashParticles.splice(0, this.splashParticles.length - splashLimit);
		}
	}

	private updateStormFlash(dt: number, condition: WeatherCondition, rainIntensity: number): void {
		if (condition === 'storm' && rainIntensity > 0) {
			if (Math.random() < dt * (0.42 + rainIntensity)) {
				this.stormFlash = rand(0.4, 0.94);
			}
		}

		if (this.stormFlash > 0) {
			this.stormFlash = Math.max(0, this.stormFlash - dt * 1.55);
		}
	}

	private createRainParticle(
		windPxPerSecond: number,
		intensity: number,
		randomY: boolean
	): RainParticle {
		const depth = rand(0.58, 1.4);
		const speedMultiplier = lerp(0.82, 1.2, intensity);
		return {
			x: rand(-60, this.width + 60),
			y: randomY ? rand(-this.height, this.height) : rand(-this.height * 0.25, -8),
			vy: rand(620, 1280) * depth * speedMultiplier,
			length: rand(8, 24) * depth,
			width: rand(0.75, 1.7) * depth,
			depth
		};
	}

	private createSnowParticle(randomY: boolean): SnowParticle {
		const depth = rand(0.5, 1.24);
		return {
			x: rand(-36, this.width + 36),
			y: randomY ? rand(-this.height, this.height) : rand(-this.height * 0.18, -6),
			vy: rand(24, 92) * depth,
			radius: rand(1.1, 3.5) * depth,
			phase: rand(0, Math.PI * 2),
			depth
		};
	}

	private createCloudParticle(
		windPxPerSecond: number,
		condition: WeatherCondition,
		randomX: boolean
	): CloudParticle {
		const qualityScale = clamp(this.input.qualityScale ?? 1, 0.12, 1);
		const depth = rand(0.52, 1.28);
		const topBand =
			condition === 'fog' ? rand(0.06, 0.42) : condition === 'clear' ? rand(0.04, 0.24) : rand(0.05, 0.36);
		const width = rand(240, 620) * depth;
		const height = width * rand(0.19, 0.33);
		const baseY = this.height * topBand;
		const density = rand(0.72, 1.22);
		const puffCount =
			qualityScale < 0.2
				? randInt(3, 5)
				: qualityScale < 0.35
					? randInt(4, 7)
					: qualityScale < 0.5
						? randInt(5, 9)
						: condition === 'clear'
							? randInt(7, 11)
							: condition === 'storm'
								? randInt(11, 16)
								: randInt(9, 14);

		return {
			x: randomX ? rand(-width, this.width + width) : -width - rand(40, 120),
			y: baseY,
			baseY,
			vx: rand(7, 24) * depth + windPxPerSecond * 0.015,
			width,
			height,
			alpha: rand(0.08, 0.2),
			density,
			depth,
			puffCount,
			seed: rand(0, 10_000),
			swayPhase: rand(0, Math.PI * 2),
			swayAmplitude: rand(3, 16) * depth
		};
	}

	private createFogParticle(
		windPxPerSecond: number,
		condition: WeatherCondition,
		randomX: boolean
	): FogParticle {
		const depth = rand(0.55, 1.18);
		const width = rand(280, 760) * depth;
		const height = width * rand(0.16, 0.34);
		const lowBandMin = condition === 'fog' ? 0.32 : 0.5;
		const lowBandMax = condition === 'fog' ? 0.95 : 0.9;

		return {
			x: randomX ? rand(-width, this.width + width) : -width - rand(50, 180),
			y: this.height * rand(lowBandMin, lowBandMax),
			vx: rand(4, 14) + windPxPerSecond * 0.008,
			width,
			height,
			alpha: rand(condition === 'fog' ? 0.028 : 0.012, condition === 'fog' ? 0.11 : 0.045),
			phase: rand(0, Math.PI * 2),
			depth
		};
	}

	private createWindParticle(windPxPerSecond: number, randomX: boolean): WindParticle {
		return {
			x: randomX ? rand(-220, this.width + 220) : -rand(80, 180),
			y: rand(this.height * 0.14, this.height * 0.82),
			vx: rand(120, 380) + windPxPerSecond * 0.52,
			length: rand(30, 104),
			alpha: rand(0.1, 0.34)
		};
	}

	private spawnSplash(x: number, y: number, windPxPerSecond: number, intensity: number): void {
		const particles = randInt(1, intensity >= 0.7 ? 4 : 2);
		for (let index = 0; index < particles; index += 1) {
			this.splashParticles.push({
				x: x + rand(-5, 5),
				y: y + rand(-2, 2),
				vx: rand(-20, 20) + windPxPerSecond * 0.035,
				vy: rand(-95, -32),
				life: rand(0.12, 0.32),
				size: rand(0.7, 2.2)
			});
		}
	}
}

export function sampleCloudPuff(cloud: CloudParticle, index: number): CloudPuff {
	const seedBase = cloud.seed + index * 17.11;
	const normalizedIndex = cloud.puffCount <= 1 ? 0.5 : index / (cloud.puffCount - 1);
	const spine = normalizedIndex * 2 - 1;
	const arch = 1 - spine * spine;
	const xJitter = Math.sin(seedBase * 0.13) * cloud.width * 0.04;
	const yJitter = Math.cos(seedBase * 0.18) * cloud.height * 0.05;
	const xRatio = spine * randFromSeed(seedBase + 1.3, 0.3, 0.52);
	const yRatio = -arch * randFromSeed(seedBase + 5.7, 0.1, 0.32) + randFromSeed(seedBase + 6.1, -0.12, 0.06);
	const shapeFactor = 0.68 + arch * 0.52;
	const radiusX = cloud.width * randFromSeed(seedBase + 11.8, 0.12, 0.24) * shapeFactor;
	const radiusY = cloud.height * randFromSeed(seedBase + 21.4, 0.34, 0.56) * (0.78 + arch * 0.36);
	const alpha = cloud.alpha * cloud.density * randFromSeed(seedBase + 33.9, 0.62, 1.08) * (0.75 + arch * 0.42);

	return {
		offsetX: cloud.width * xRatio + xJitter,
		offsetY: cloud.height * yRatio + yJitter,
		radiusX,
		radiusY,
		alpha
	};
}

export function sampleFogLobe(fog: FogParticle, index: number): FogLobe {
	const seedBase = fog.phase * 31.2 + index * 9.17;
	return {
		offsetX: fog.width * randFromSeed(seedBase + 1, -0.35, 0.35),
		offsetY: fog.height * randFromSeed(seedBase + 2, -0.14, 0.14),
		radiusX: fog.width * randFromSeed(seedBase + 3, 0.36, 0.56),
		radiusY: fog.height * randFromSeed(seedBase + 4, 0.52, 0.82),
		alpha: fog.alpha * randFromSeed(seedBase + 5, 0.76, 1.14)
	};
}

function resolvePrecipitationLevel(
	condition: WeatherCondition,
	precipitationStrength: number
): PrecipitationLevel {
	if (condition !== 'rain' && condition !== 'snow' && condition !== 'storm') {
		return 'none';
	}

	const value = clamp(precipitationStrength, 0, 1);
	if (value <= 0) {
		return 'none';
	}
	if (value < 0.3) {
		return 'low';
	}
	if (value < 0.7) {
		return 'medium';
	}
	return 'high';
}

function getRainIntensity(
	condition: WeatherCondition,
	precipitationStrength: number,
	level: PrecipitationLevel
): number {
	if (condition !== 'rain' && condition !== 'storm') {
		return 0;
	}

	const byLevel: Record<Exclude<PrecipitationLevel, 'none'>, number> = {
		low: condition === 'storm' ? 0.22 : 0.14,
		medium: condition === 'storm' ? 0.46 : 0.34,
		high: condition === 'storm' ? 0.7 : 0.58
	};

	if (level === 'none') {
		return 0;
	}

	return clamp(
		byLevel[level] +
			precipitationStrength * (condition === 'storm' ? 0.42 : 0.36) +
			Math.pow(precipitationStrength, 1.35) * (condition === 'storm' ? 0.22 : 0.15),
		0,
		condition === 'storm' ? 1 : 0.97
	);
}

function getSnowIntensity(
	condition: WeatherCondition,
	precipitationStrength: number,
	level: PrecipitationLevel
): number {
	if (condition !== 'snow') {
		return 0;
	}

	const byLevel: Record<Exclude<PrecipitationLevel, 'none'>, number> = {
		low: 0.22,
		medium: 0.44,
		high: 0.66
	};

	if (level === 'none') {
		return 0;
	}

	return clamp(byLevel[level] + precipitationStrength * 0.44 + Math.pow(precipitationStrength, 1.2) * 0.2, 0, 0.98);
}

function getCloudIntensity(condition: WeatherCondition): number {
	if (condition === 'clear') {
		return 0.24;
	}
	if (condition === 'fog') {
		return 0.62;
	}
	if (condition === 'unknown') {
		return 0.5;
	}
	return 0.82;
}

function getFogIntensity(condition: WeatherCondition): number {
	if (condition === 'fog') {
		return 1;
	}
	if (condition === 'cloudy') {
		return 0.3;
	}
	return 0.12;
}

function randFromSeed(seed: number, min: number, max: number): number {
	const value = fract(Math.sin(seed) * 43758.5453123);
	return min + value * (max - min);
}

function fract(value: number): number {
	return value - Math.floor(value);
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

function resolveParticleDensityScale(width: number, height: number): number {
	const safeWidth = Math.max(1, width);
	const safeHeight = Math.max(1, height);
	const viewportArea = safeWidth * safeHeight;
	const baselineArea = 1366 * 768;
	const ratio = viewportArea / baselineArea;

	return clamp(Math.pow(ratio, 0.55), 0.38, 1.18);
}
