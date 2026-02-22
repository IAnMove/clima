import { env } from '$env/dynamic/private';
import type { WeatherProvider } from '$lib/domain/ports/weather-provider';
import { AemetWeatherProvider } from '$lib/infrastructure/weather/aemet/aemet-provider';

let singleton: WeatherProvider | null = null;

export function getWeatherProvider(): WeatherProvider {
	if (singleton) {
		return singleton;
	}

	const providerId = (env.WEATHER_PROVIDER ?? 'aemet').trim().toLowerCase();

	switch (providerId) {
		case 'aemet':
			singleton = new AemetWeatherProvider();
			return singleton;
		default:
			throw new Error(`Proveedor meteorológico no soportado: ${providerId}`);
	}
}
