export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog' | 'unknown';

export interface HourlyWeather {
	isoTime: string;
	temperatureC: number | null;
	humidityPercent: number | null;
	precipitationProbabilityPercent: number | null;
	windKmh: number | null;
	description: string | null;
	condition: WeatherCondition;
}

export interface DailyWeather {
	isoDate: string;
	minTemperatureC: number | null;
	maxTemperatureC: number | null;
	precipitationProbabilityPercent: number | null;
	description: string | null;
	condition: WeatherCondition;
}

export interface WeatherImage {
	url: string;
	attributionText: string | null;
	attributionUrl: string | null;
}

export interface WeatherLocation {
	code: string;
	name: string;
	province: string | null;
	latitude: number | null;
	longitude: number | null;
}

export interface WeatherReport {
	source: string;
	generatedAtIso: string;
	location: WeatherLocation;
	current: HourlyWeather | null;
	hourly: HourlyWeather[];
	daily: DailyWeather[];
	backgroundImage: WeatherImage | null;
}
