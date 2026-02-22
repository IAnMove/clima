import type { Municipality, ProvinceMunicipalities } from '$lib/domain/municipality';
import type { WeatherReport } from '$lib/domain/weather';

export type MunicipalityResolution =
	| {
			kind: 'resolved';
			municipality: Municipality;
	  }
	| {
			kind: 'ambiguous';
			candidates: Municipality[];
	  }
	| {
			kind: 'not_found';
			query: string;
			suggestions: Municipality[];
			provinceSuggestions: ProvinceMunicipalities[];
	  };

export interface ResolveMunicipalityInput {
	query: string;
	code?: string | null;
	province?: string | null;
}

export interface WeatherProvider {
	readonly id: string;
	resolveMunicipality(input: ResolveMunicipalityInput): Promise<MunicipalityResolution>;
	getWeatherByMunicipalityCode(code: string): Promise<WeatherReport>;
	listProvinces(): Promise<string[]>;
	listMunicipalitiesByProvince(province: string): Promise<Municipality[]>;
}
