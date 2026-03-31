import dns from "node:dns/promises";
import net from "node:net";
import { readJsonFileSync } from "@/lib/json";
import {
	probeOpenclawProviderStatus,
	sanitizeOpenclawError,
} from "@/lib/openclaw-cli";
import { resolveOpenclawAgentModelsFile } from "@/lib/openclaw-paths";

export const DEFAULT_MODEL_PROBE_TIMEOUT_MS = 15000;
const DIRECT_PROBE_RETRY_DELAYS_MS = [250];

type ProviderApiType = "anthropic-messages" | "openai-completions" | string;

interface ProviderConfig {
	baseUrl?: string;
	apiKey?: string;
	api?: ProviderApiType;
	authHeader?: boolean | string;
	headers?: Record<string, string>;
}

interface ProbeResult {
	provider?: string;
	model?: string;
	mode?: "api_key" | "oauth" | string;
	status?: "ok" | "error" | "unknown" | string;
	error?: string;
	latencyMs?: number;
}

interface DirectProbeResult {
	ok: boolean;
	elapsed: number;
	status: string;
	error?: string;
	mode: "api_key";
	source: "direct_model_probe";
	precision: "model";
	text?: string;
}

export interface ModelProbeOutcome {
	ok: boolean;
	elapsed: number;
	model: string;
	mode: "api_key" | "oauth" | "unknown" | string;
	status: string;
	error?: string;
	text?: string;
	source: "direct_model_probe" | "openclaw_provider_probe";
	precision: "model" | "provider";
}

interface ProbeModelParams {
	providerId: string;
	modelId: string;
	timeoutMs?: number;
}

function loadProviderConfig(providerId: string): {
	providerConfig: ProviderConfig | null;
	error?: string;
} {
	const modelsPath = resolveOpenclawAgentModelsFile("main");
	if (!modelsPath) {
		return {
			providerConfig: null,
			error: "OpenClaw runtime models path is invalid",
		};
	}

	try {
		const parsed = readJsonFileSync<any>(modelsPath);
		const providers = parsed?.providers;
		if (!providers || typeof providers !== "object") {
			return { providerConfig: null };
		}
		const exact = providers[providerId];
		if (exact && typeof exact === "object") {
			return { providerConfig: exact as ProviderConfig };
		}
		const normalizedTarget = providerId.toLowerCase();
		for (const [key, value] of Object.entries(providers)) {
			if (
				key.toLowerCase() === normalizedTarget &&
				value &&
				typeof value === "object"
			) {
				return { providerConfig: value as ProviderConfig };
			}
		}
		return { providerConfig: null };
	} catch {
		return { providerConfig: null };
	}
}

function pickAuthHeader(
	providerCfg: ProviderConfig,
	apiKey: string,
): Record<string, string> {
	const out: Record<string, string> = {};
	const authHeader = providerCfg.authHeader;
	const api = providerCfg.api;

	if (typeof authHeader === "string" && authHeader.trim()) {
		out[authHeader.trim()] = apiKey;
		return out;
	}

	if (authHeader === false) {
		out["x-api-key"] = apiKey;
		return out;
	}

	if (api === "anthropic-messages") {
		out["x-api-key"] = apiKey;
		out.Authorization = `Bearer ${apiKey}`;
		return out;
	}

	out.Authorization = `Bearer ${apiKey}`;
	return out;
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			...init,
			signal: controller.signal,
			cache: "no-store",
		});
	} finally {
		clearTimeout(timer);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUnsafeIpv4(host: string): boolean {
	const parts = host.split(".").map((segment) => Number(segment));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
		return true;
	}

	const [a, b] = parts;
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	return false;
}

function isUnsafeIpv6(host: string): boolean {
	const normalized = host.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("fe80:")) return true;
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
	return false;
}

function isUnsafeIpAddress(host: string): boolean {
	const ipType = net.isIP(host);
	if (ipType === 4) return isUnsafeIpv4(host);
	if (ipType === 6) return isUnsafeIpv6(host);
	return false;
}

async function resolveSafeBaseUrl(baseUrl: string): Promise<string | null> {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return null;
	}

	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		return null;
	}
	if (!parsed.hostname || parsed.username || parsed.password) {
		return null;
	}

	const hostname = parsed.hostname.toLowerCase();
	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		isUnsafeIpAddress(hostname)
	) {
		return null;
	}

	try {
		const records = await dns.lookup(hostname, { all: true });
		if (
			records.length === 0 ||
			records.some((record) => isUnsafeIpAddress(record.address))
		) {
			return null;
		}
	} catch {
		return null;
	}

	return parsed.toString().replace(/\/+$/, "");
}

function shouldRetryDirectProbeResponse(response: Response): boolean {
	return response.status === 429 || response.status >= 500;
}

function shouldRetryDirectProbeError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.toLowerCase().includes("fetch failed") ||
			error.message.toLowerCase().includes("econn") ||
			error.message.toLowerCase().includes("timeout"))
	);
}

async function fetchWithTimeoutAndRetry(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	for (
		let attempt = 0;
		attempt <= DIRECT_PROBE_RETRY_DELAYS_MS.length;
		attempt++
	) {
		try {
			const response = await fetchWithTimeout(url, init, timeoutMs);
			if (
				shouldRetryDirectProbeResponse(response) &&
				attempt < DIRECT_PROBE_RETRY_DELAYS_MS.length
			) {
				await sleep(DIRECT_PROBE_RETRY_DELAYS_MS[attempt]);
				continue;
			}
			return response;
		} catch (error) {
			if (
				!shouldRetryDirectProbeError(error) ||
				attempt >= DIRECT_PROBE_RETRY_DELAYS_MS.length
			) {
				throw error;
			}
			await sleep(DIRECT_PROBE_RETRY_DELAYS_MS[attempt]);
		}
	}

	throw new Error("Direct probe retry budget exhausted");
}

function classifyErrorStatus(httpStatus: number, errorText: string): string {
	const normalized = errorText.toLowerCase();
	if (normalized.includes("timed out")) return "timeout";
	if (normalized.includes("model_not_supported")) return "model_not_supported";
	if (
		httpStatus === 401 ||
		httpStatus === 403 ||
		normalized.includes("unauthorized")
	)
		return "auth";
	if (httpStatus === 429 || normalized.includes("rate limit"))
		return "rate_limit";
	if (httpStatus === 402 || normalized.includes("billing")) return "billing";
	return "error";
}

function extractErrorMessage(payload: any, fallback: string): string {
	const direct = payload?.error?.message || payload?.message || payload?.error;
	if (typeof direct === "string" && direct.trim()) return direct.trim();
	return fallback;
}

async function probeModelDirect(
	params: ProbeModelParams,
): Promise<{ result: DirectProbeResult | null; error?: string }> {
	const { providerConfig, error } = loadProviderConfig(params.providerId);
	if (error) {
		return { result: null, error };
	}
	if (
		!providerConfig?.baseUrl ||
		!providerConfig.api ||
		!providerConfig.apiKey
	) {
		return { result: null };
	}
	const safeBaseUrl = await resolveSafeBaseUrl(providerConfig.baseUrl);
	if (!safeBaseUrl) return { result: null };

	const timeoutMs = params.timeoutMs ?? DEFAULT_MODEL_PROBE_TIMEOUT_MS;
	// Kimi providers require temperature=1
	const isKimiProvider =
		params.providerId === "kimi-coding" || params.providerId === "moonshot";
	const temperature = isKimiProvider ? 1 : 0;

	const headers: Record<string, string> = {
		"content-type": "application/json",
		...(providerConfig.headers || {}),
		...pickAuthHeader(providerConfig, providerConfig.apiKey),
	};

	if (providerConfig.api === "anthropic-messages") {
		if (!headers["anthropic-version"])
			headers["anthropic-version"] = "2023-06-01";
		const url = `${safeBaseUrl}/v1/messages`;
		const body = {
			model: params.modelId,
			max_tokens: 8,
			messages: [{ role: "user", content: "Reply with OK." }],
			temperature,
		};
		const start = Date.now();
		try {
			const resp = await fetchWithTimeoutAndRetry(
				url,
				{ method: "POST", headers, body: JSON.stringify(body) },
				timeoutMs,
			);
			const elapsed = Date.now() - start;
			if (resp.ok) {
				return {
					result: {
						ok: true,
						elapsed,
						status: "ok",
						mode: "api_key",
						source: "direct_model_probe",
						precision: "model",
						text: "OK (direct model probe)",
					},
				};
			}
			let payload: any = null;
			try {
				payload = await resp.json();
			} catch {}
			const error = extractErrorMessage(payload, `HTTP ${resp.status}`);
			return {
				result: {
					ok: false,
					elapsed,
					status: classifyErrorStatus(resp.status, error),
					error,
					mode: "api_key",
					source: "direct_model_probe",
					precision: "model",
				},
			};
		} catch (err: any) {
			const elapsed = Date.now() - start;
			const isTimeout = err?.name === "AbortError";
			return {
				result: {
					ok: false,
					elapsed,
					status: isTimeout ? "timeout" : "network",
					error: isTimeout
						? "LLM request timed out."
						: err?.message || "Network error",
					mode: "api_key",
					source: "direct_model_probe",
					precision: "model",
				},
			};
		}
	}

	if (providerConfig.api === "openai-completions") {
		const url = `${safeBaseUrl}/chat/completions`;
		const body = {
			model: params.modelId,
			messages: [{ role: "user", content: "Reply with OK." }],
			max_tokens: 8,
			temperature,
		};
		const start = Date.now();
		try {
			const resp = await fetchWithTimeoutAndRetry(
				url,
				{ method: "POST", headers, body: JSON.stringify(body) },
				timeoutMs,
			);
			const elapsed = Date.now() - start;
			if (resp.ok) {
				return {
					result: {
						ok: true,
						elapsed,
						status: "ok",
						mode: "api_key",
						source: "direct_model_probe",
						precision: "model",
						text: "OK (direct model probe)",
					},
				};
			}
			let payload: any = null;
			try {
				payload = await resp.json();
			} catch {}
			const error = extractErrorMessage(payload, `HTTP ${resp.status}`);
			return {
				result: {
					ok: false,
					elapsed,
					status: classifyErrorStatus(resp.status, error),
					error,
					mode: "api_key",
					source: "direct_model_probe",
					precision: "model",
				},
			};
		} catch (err: any) {
			const elapsed = Date.now() - start;
			const isTimeout = err?.name === "AbortError";
			return {
				result: {
					ok: false,
					elapsed,
					status: isTimeout ? "timeout" : "network",
					error: isTimeout
						? "LLM request timed out."
						: err?.message || "Network error",
					mode: "api_key",
					source: "direct_model_probe",
					precision: "model",
				},
			};
		}
	}

	return { result: null };
}

function createProviderProbeFailure(
	params: ProbeModelParams,
	startedAt: number,
	error: string,
): ModelProbeOutcome {
	return {
		ok: false,
		elapsed: Date.now() - startedAt,
		model: `${params.providerId}/${params.modelId}`,
		mode: "unknown",
		status: "unknown",
		error,
		precision: "provider",
		source: "openclaw_provider_probe",
	};
}

async function probeProviderViaOpenclaw(
	params: ProbeModelParams,
): Promise<ModelProbeOutcome> {
	const timeoutMs = params.timeoutMs ?? DEFAULT_MODEL_PROBE_TIMEOUT_MS;
	const startedAt = Date.now();
	let results: ProbeResult[];
	try {
		results = await probeOpenclawProviderStatus(params.providerId, timeoutMs);
	} catch (error) {
		return createProviderProbeFailure(
			params,
			startedAt,
			sanitizeOpenclawError(error, "Provider probe failed"),
		);
	}
	const fullModel = `${params.providerId}/${params.modelId}`;

	const exact =
		results.find(
			(r) => r.provider === params.providerId && r.model === fullModel,
		) ||
		results.find(
			(r) =>
				r.provider === params.providerId &&
				typeof r.model === "string" &&
				r.model.endsWith(`/${params.modelId}`),
		);
	const matched =
		exact || results.find((r) => r.provider === params.providerId);

	if (!matched) {
		return {
			ok: false,
			elapsed: Date.now() - startedAt,
			model: fullModel,
			mode: "unknown",
			status: "unknown",
			error: `No probe result for provider ${params.providerId}`,
			precision: "provider",
			source: "openclaw_provider_probe",
		};
	}

	const ok = matched.status === "ok";
	return {
		ok,
		elapsed: matched.latencyMs ?? Date.now() - startedAt,
		model: matched.model || fullModel,
		mode: matched.mode || "unknown",
		status: matched.status || "unknown",
		error: ok
			? undefined
			: matched.error || `Probe status: ${matched.status || "unknown"}`,
		precision: exact ? "model" : "provider",
		source: "openclaw_provider_probe",
		text: ok
			? `OK (${exact ? "model-level" : "provider-level"} openclaw probe)`
			: undefined,
	};
}

export function parseModelRef(modelStr: string): {
	providerId: string;
	modelId: string;
} {
	const [providerId, ...rest] = modelStr.split("/");
	return {
		providerId: providerId || "",
		modelId: rest.join("/") || providerId || "",
	};
}

export async function probeModel(
	params: ProbeModelParams,
): Promise<ModelProbeOutcome> {
	const startedAt = Date.now();
	const direct = await probeModelDirect(params);
	if (direct.result) {
		return {
			...direct.result,
			model: `${params.providerId}/${params.modelId}`,
		};
	}
	if (direct.error) {
		return createProviderProbeFailure(params, startedAt, direct.error);
	}
	return probeProviderViaOpenclaw(params);
}
