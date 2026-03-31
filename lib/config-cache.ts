export type ConfigCacheEntry<T = unknown> = {
	data: T;
	ts: number;
};

let configCache: ConfigCacheEntry | null = null;

function cloneConfigCacheData<T>(value: T): T {
	return structuredClone(value);
}

function cloneConfigCacheEntry<T>(
	entry: ConfigCacheEntry<T>,
): ConfigCacheEntry<T> {
	return {
		data: cloneConfigCacheData(entry.data),
		ts: entry.ts,
	};
}

export function getConfigCache<T = unknown>(): ConfigCacheEntry<T> | null {
	return configCache
		? cloneConfigCacheEntry(configCache as ConfigCacheEntry<T>)
		: null;
}

export function setConfigCache<T = unknown>(entry: ConfigCacheEntry<T>): void {
	configCache = cloneConfigCacheEntry(entry);
}

export function clearConfigCache(): void {
	configCache = null;
}
