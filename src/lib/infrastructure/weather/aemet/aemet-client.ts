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
			const body = await decodeResponseText(response);
			throw new Error(`AEMET ${response.status}: ${body.slice(0, 200)}`);
		}

		const text = await decodeResponseText(response);

		try {
			const parsed = JSON.parse(text) as T;
			return repairMojibakeDeep(parsed);
		} catch {
			throw new Error('Respuesta de AEMET no es JSON válido');
		}
	}
}

async function decodeResponseText(response: Response): Promise<string> {
	const buffer = await response.arrayBuffer();
	const contentType = response.headers.get('content-type') ?? '';
	const charset = parseCharset(contentType) ?? 'utf-8';

	try {
		return new TextDecoder(charset).decode(buffer);
	} catch {
		return new TextDecoder('utf-8').decode(buffer);
	}
}

function parseCharset(contentType: string): string | null {
	const match = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i);
	return match?.[1]?.trim().toLowerCase() ?? null;
}

function repairMojibakeDeep<T>(value: T): T {
	if (typeof value === 'string') {
		return repairPotentialMojibake(value) as T;
	}

	if (Array.isArray(value)) {
		return value.map((item) => repairMojibakeDeep(item)) as T;
	}

	if (!value || typeof value !== 'object') {
		return value;
	}

	const input = value as Record<string, unknown>;
	const output: Record<string, unknown> = {};

	for (const [key, nested] of Object.entries(input)) {
		output[key] = repairMojibakeDeep(nested);
	}

	return output as T;
}

function repairPotentialMojibake(input: string): string {
	if (!/[\u00c3\u00c2]/.test(input)) {
		return input;
	}

	try {
		const bytes = new Uint8Array(input.length);
		for (let index = 0; index < input.length; index += 1) {
			bytes[index] = input.charCodeAt(index) & 0xff;
		}
		const repaired = new TextDecoder('utf-8').decode(bytes);
		return mojibakeScore(repaired) < mojibakeScore(input) ? repaired : input;
	} catch {
		return input;
	}
}

function mojibakeScore(input: string): number {
	const matches = input.match(/[\u00c3\u00c2\ufffd]/g);
	return matches ? matches.length : 0;
}
