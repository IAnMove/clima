import type { WeatherCondition } from '$lib/domain/weather';

export type WeatherRenderer = 'canvas2d' | 'pixijs';

export interface WeatherFxInput {
	condition: WeatherCondition;
	windKmh: number;
	precipitationProbabilityPercent: number;
	active: boolean;
	qualityScale?: number;
}

export interface WeatherFxEngine {
	setInput(input: WeatherFxInput): void;
	resize(width: number, height: number): void;
	destroy(): void;
}
