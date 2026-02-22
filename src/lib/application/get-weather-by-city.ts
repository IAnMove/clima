import type { Municipality, ProvinceMunicipalities } from '$lib/domain/municipality';
import type { WeatherProvider } from '$lib/domain/ports/weather-provider';
import type { WeatherReport } from '$lib/domain/weather';
import { slugToQuery } from '$lib/utils/text';

export interface GetWeatherByCityInput {
	citySlug: string;
	code?: string | null;
	province?: string | null;
}

export type GetWeatherByCityResult =
	| {
			status: 'ok';
			municipality: Municipality;
			report: WeatherReport;
	  }
	| {
			status: 'ambiguous';
			cityQuery: string;
			candidates: Municipality[];
	  }
	| {
			status: 'not_found';
			cityQuery: string;
			suggestions: Municipality[];
			provinceSuggestions: ProvinceMunicipalities[];
	  };

export async function getWeatherByCity(
	provider: WeatherProvider,
	input: GetWeatherByCityInput
): Promise<GetWeatherByCityResult> {
	const cityQuery = slugToQuery(input.citySlug);
	const resolution = await provider.resolveMunicipality({
		query: cityQuery,
		code: input.code,
		province: input.province
	});

	if (resolution.kind === 'ambiguous') {
		return {
			status: 'ambiguous',
			cityQuery,
			candidates: resolution.candidates
		};
	}

	if (resolution.kind === 'not_found') {
		return {
			status: 'not_found',
			cityQuery,
			suggestions: resolution.suggestions,
			provinceSuggestions: resolution.provinceSuggestions
		};
	}

	const report = await provider.getWeatherByMunicipalityCode(resolution.municipality.code);

	return {
		status: 'ok',
		municipality: resolution.municipality,
		report
	};
}
