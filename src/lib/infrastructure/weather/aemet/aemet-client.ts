import { env } from '$env/dynamic/private';

interface AemetEnvelope {
	estado?: number;
	descripcion?: string;
	datos?: string;
	metadatos?: string;
}

const AEMET_BASE_URL = 'https://opendata.aemet.es/opendata/api';
/** Plazo total (sobre + datos) para un dataset de previsión. */
const AEMET_DATASET_TIMEOUT_MS = 10_000;
/** El maestro de municipios es grande y se refresca en segundo plano. */
const AEMET_MASTER_TIMEOUT_MS = 20_000;
const AEMET_MAX_CONCURRENCY = 6;
const AEMET_MAX_QUEUE = 200;
const AEMET_RATE_LIMIT_COOLDOWN_MS = 30_000;

// Estado compartido por proceso: limita la presión sobre AEMET bajo mucho tráfico.
let activeAemetRequests = 0;
const aemetWaiters: Array<() => void> = [];
let aemetCooldownUntil = 0;

function tripRateLimit(): void {
	aemetCooldownUntil = Date.now() + AEMET_RATE_LIMIT_COOLDOWN_MS;
}

async function acquireAemetSlot(signal: AbortSignal): Promise<void> {
	if (activeAemetRequests < AEMET_MAX_CONCURRENCY) {
		activeAemetRequests += 1;
		return;
	}

	if (aemetWaiters.length >= AEMET_MAX_QUEUE) {
		throw new Error('AEMET saturado: demasiadas peticiones en cola');
	}

	if (signal.aborted) {
		throw new Error('Timeout esperando turno para AEMET');
	}

	await new Promise<void>((resolve, reject) => {
		const grant = (): void => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		};
		const onAbort = (): void => {
			const index = aemetWaiters.indexOf(grant);
			if (index >= 0) {
				aemetWaiters.splice(index, 1);
			}
			reject(new Error('Timeout esperando turno para AEMET'));
		};
		signal.addEventListener('abort', onAbort, { once: true });
		aemetWaiters.push(grant);
	});
}

function releaseAemetSlot(): void {
	const next = aemetWaiters.shift();
	if (next) {
		// El hueco pasa directamente al siguiente en cola.
		next();
		return;
	}

	activeAemetRequests = Math.max(0, activeAemetRequests - 1);
}

export class AemetClient {
	private readonly apiKey: string;

	constructor(apiKey = env.AEMET_API_KEY ?? '') {
		this.apiKey = apiKey.trim();

		if (!this.apiKey) {
			throw new Error('AEMET_API_KEY no está configurada');
		}
	}

	async getMunicipalitiesRaw(): Promise<unknown[]> {
		const data = await this.fetchDataset<unknown>('/maestro/municipios', AEMET_MASTER_TIMEOUT_MS);
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

	private async fetchDataset<T>(path: string, timeoutMs = AEMET_DATASET_TIMEOUT_MS): Promise<T> {
		if (Date.now() < aemetCooldownUntil) {
			throw new Error('AEMET está limitando peticiones (429); se reintentará en breve');
		}

		// Un único plazo para la cola, el sobre y la descarga de datos.
		const signal = AbortSignal.timeout(timeoutMs);
		await acquireAemetSlot(signal);

		try {
			const envelope = await this.fetchJson<AemetEnvelope>(`${AEMET_BASE_URL}${path}`, true, signal);

			if (envelope?.estado === 429) {
				tripRateLimit();
			}

			if (!envelope?.datos) {
				const message = envelope?.descripcion ?? 'AEMET no devolvió URL de datos';
				throw new Error(message);
			}

			return await this.fetchJson<T>(envelope.datos, false, signal);
		} finally {
			releaseAemetSlot();
		}
	}

	private async fetchJson<T>(url: string, includeApiKey: boolean, signal: AbortSignal): Promise<T> {
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
			signal
		});

		if (response.status === 429) {
			tripRateLimit();
		}

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
