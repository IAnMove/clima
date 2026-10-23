export interface SwrCacheOptions<V> {
	/** Tiempo (ms) que un valor se considera fresco. Puede depender del valor. */
	ttlMs: number | ((value: V) => number);
	/** Ventana extra (ms) en la que se sirve el valor caducado mientras se revalida o si el origen falla. */
	staleMs: number;
	/** Tiempo (ms) que se recuerda un fallo para no martillear el origen (0 = no se recuerda). */
	errorTtlMs?: number;
	/** Número máximo de entradas (LRU). */
	maxEntries?: number;
}

interface CacheEntry<V> {
	value: V;
	freshUntil: number;
	staleUntil: number;
}

interface FailureEntry {
	until: number;
	error: unknown;
}

/**
 * Caché en memoria con TTL, stale-while-revalidate, dedupe de peticiones en vuelo,
 * caché negativa de errores y expulsión LRU.
 */
export class SwrCache<V> {
	private readonly entries = new Map<string, CacheEntry<V>>();
	private readonly inFlight = new Map<string, Promise<V>>();
	private readonly failures = new Map<string, FailureEntry>();
	private readonly maxEntries: number;

	constructor(private readonly options: SwrCacheOptions<V>) {
		this.maxEntries = Math.max(1, options.maxEntries ?? 500);
	}

	get(key: string, loader: () => Promise<V>): Promise<V> {
		const now = Date.now();
		const entry = this.entries.get(key);

		if (entry) {
			if (entry.freshUntil > now) {
				this.touch(key, entry);
				return Promise.resolve(entry.value);
			}

			if (entry.staleUntil > now) {
				this.touch(key, entry);
				// Revalidación en segundo plano; si falla seguimos sirviendo el dato stale.
				this.load(key, loader).catch(() => undefined);
				return Promise.resolve(entry.value);
			}

			this.entries.delete(key);
		}

		return this.load(key, loader);
	}

	/** Devuelve el valor (fresco o stale) sin disparar cargas. */
	peek(key: string): V | undefined {
		const entry = this.entries.get(key);
		return entry && entry.staleUntil > Date.now() ? entry.value : undefined;
	}

	private load(key: string, loader: () => Promise<V>): Promise<V> {
		const pending = this.inFlight.get(key);
		if (pending) {
			return pending;
		}

		const failure = this.failures.get(key);
		if (failure) {
			if (failure.until > Date.now()) {
				return Promise.reject(failure.error);
			}
			this.failures.delete(key);
		}

		const request = Promise.resolve()
			.then(loader)
			.then(
				(value) => {
					this.store(key, value);
					this.failures.delete(key);
					return value;
				},
				(error: unknown) => {
					this.recordFailure(key, error);
					throw error;
				}
			)
			.finally(() => {
				this.inFlight.delete(key);
			});

		this.inFlight.set(key, request);
		return request;
	}

	private store(key: string, value: V): void {
		const now = Date.now();
		const ttlOption = this.options.ttlMs;
		const ttl = typeof ttlOption === 'function' ? ttlOption(value) : ttlOption;

		this.entries.delete(key);
		this.entries.set(key, {
			value,
			freshUntil: now + ttl,
			staleUntil: now + ttl + this.options.staleMs
		});

		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next();
			if (oldest.done) {
				break;
			}
			this.entries.delete(oldest.value);
		}
	}

	private recordFailure(key: string, error: unknown): void {
		const errorTtl = this.options.errorTtlMs ?? 0;
		if (errorTtl <= 0) {
			return;
		}

		this.failures.delete(key);
		this.failures.set(key, { until: Date.now() + errorTtl, error });

		while (this.failures.size > this.maxEntries) {
			const oldest = this.failures.keys().next();
			if (oldest.done) {
				break;
			}
			this.failures.delete(oldest.value);
		}
	}

	private touch(key: string, entry: CacheEntry<V>): void {
		this.entries.delete(key);
		this.entries.set(key, entry);
	}
}

/** Resuelve con `fallback` si la promesa tarda más de `ms` o falla. La promesa original sigue su curso. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => resolve(fallback), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(fallback);
			}
		);
	});
}
