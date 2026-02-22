import { env } from '$env/dynamic/private';

interface AemetEnvelope {
	estado?: number;
	descripcion?: string;
	datos?: string;
	metadatos?: string;
}

const AEMET_BASE_URL = 'https://opendata.aemet.es/opendata/api';

export class AemetClient {
	private readonly apiKey: string;

	constructor(apiKey = env.AEMET_API_KEY ?? '') {
		this.apiKey = apiKey.trim();

		if (!this.apiKey) {
			throw new Error('AEMET_API_KEY no está configurada');
		}
	}

	async getMunicipalitiesRaw(): Promise<unknown[]> {
		const data = await this.fetchDataset<unknown>('/maestro/municipios');
		return Array.isArray(data) ? data : [];
	}

	async getDailyForecastRaw(municipalityCode: string): Promise<unknown> {
		return this.fetchDataset<unknown>(
			`/prediccion/especifica/municipio/diaria/${encodeURIComponent(municipalityCode)}`
		);
	}

	async getHourlyForecastRaw(municipalityCode: string): Promise<unknown> {
		return this.fetchDataset<unknown>(
			`/prediccion/especifica/municipio/horaria/${encodeURIComponent(municipalityCode)}`
		);
	}

	private async fetchDataset<T>(path: string): Promise<T> {
		const envelope = await this.fetchJson<AemetEnvelope>(`${AEMET_BASE_URL}${path}`);

		if (!envelope?.datos) {
			const message = envelope?.descripcion ?? 'AEMET no devolvió URL de datos';
			throw new Error(message);
		}

		return this.fetchJson<T>(envelope.datos, false);
	}

	private async fetchJson<T>(url: string, includeApiKey = true): Promise<T> {
		const response = await fetch(url, {
			method: 'GET',
			headers: includeApiKey
				? {
						api_key: this.apiKey,
						accept: 'application/json'
					}
				: {
						accept: 'application/json'
					},
			signal: AbortSignal.timeout(12_000)
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`AEMET ${response.status}: ${body.slice(0, 200)}`);
		}

		const text = await response.text();

		try {
			return JSON.parse(text) as T;
		} catch {
			throw new Error('Respuesta de AEMET no es JSON válido');
		}
	}
}
