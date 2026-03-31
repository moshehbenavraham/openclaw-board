import { type Dirent, promises as fs, type Stats } from "node:fs";

export type OpenclawReadPathErrorCode = "entry_limit" | "file_too_large";

export class OpenclawReadPathError extends Error {
	readonly code: OpenclawReadPathErrorCode;

	constructor(code: OpenclawReadPathErrorCode, message: string) {
		super(message);
		this.name = "OpenclawReadPathError";
		this.code = code;
	}
}

interface DirectoryOptions {
	allowMissing?: boolean;
	filter?: (entry: Dirent) => boolean;
	maxEntries: number;
}

interface ReadTextOptions {
	allowMissing?: boolean;
	maxBytes: number;
}

interface CacheOptions<T> {
	load: () => Promise<T>;
	ttlMs: number;
}

interface CacheEntry {
	expiresAt: number;
	touchedAt: number;
	value: unknown;
}

const computedValueCache = new Map<string, CacheEntry>();
const inFlightComputations = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 32;

function isMissingError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

function pruneExpiredCache(now: number): void {
	for (const [key, entry] of computedValueCache.entries()) {
		if (entry.expiresAt <= now) {
			computedValueCache.delete(key);
		}
	}

	if (computedValueCache.size <= MAX_CACHE_ENTRIES) {
		return;
	}

	const oldestEntries = [...computedValueCache.entries()].sort(
		(a, b) => a[1].touchedAt - b[1].touchedAt,
	);

	for (const [key] of oldestEntries) {
		if (computedValueCache.size <= MAX_CACHE_ENTRIES) {
			break;
		}
		computedValueCache.delete(key);
	}
}

export async function listBoundedDirectory(
	dirPath: string,
	options: DirectoryOptions,
): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dirPath, { withFileTypes: true });
	} catch (error) {
		if (options.allowMissing && isMissingError(error)) {
			return [];
		}
		throw error;
	}

	const filteredEntries = options.filter
		? entries.filter(options.filter)
		: entries.slice();
	const names = filteredEntries.map((entry) => entry.name).sort();

	if (names.length > options.maxEntries) {
		throw new OpenclawReadPathError(
			"entry_limit",
			"Directory scan exceeded configured limit",
		);
	}

	return names;
}

export async function readBoundedTextFile(
	filePath: string,
	options: ReadTextOptions,
): Promise<string | null> {
	let stats: Stats;
	try {
		stats = await fs.stat(filePath);
	} catch (error) {
		if (options.allowMissing && isMissingError(error)) {
			return null;
		}
		throw error;
	}

	if (stats.size > options.maxBytes) {
		throw new OpenclawReadPathError(
			"file_too_large",
			"Runtime file exceeded configured size limit",
		);
	}

	let content: string;
	try {
		content = await fs.readFile(filePath, "utf-8");
	} catch (error) {
		if (options.allowMissing && isMissingError(error)) {
			return null;
		}
		throw error;
	}

	if (Buffer.byteLength(content, "utf8") > options.maxBytes) {
		throw new OpenclawReadPathError(
			"file_too_large",
			"Runtime file exceeded configured size limit",
		);
	}

	return content;
}

export async function getCachedComputation<T>(
	key: string,
	options: CacheOptions<T>,
): Promise<T> {
	const now = Date.now();
	pruneExpiredCache(now);

	const cached = computedValueCache.get(key);
	if (cached && cached.expiresAt > now) {
		cached.touchedAt = now;
		return cached.value as T;
	}

	const inFlight = inFlightComputations.get(key);
	if (inFlight) {
		return inFlight as Promise<T>;
	}

	const promise = (async () => {
		const value = await options.load();
		const touchedAt = Date.now();
		computedValueCache.set(key, {
			value,
			touchedAt,
			expiresAt: touchedAt + options.ttlMs,
		});
		return value;
	})().finally(() => {
		inFlightComputations.delete(key);
		pruneExpiredCache(Date.now());
	});

	inFlightComputations.set(key, promise);
	return promise;
}

export function resetOpenclawReadPathState(): void {
	computedValueCache.clear();
	inFlightComputations.clear();
}
