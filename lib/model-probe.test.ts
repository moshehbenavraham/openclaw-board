import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseModelRef } from "@/lib/model-probe";

const mockReadJsonFileSync = vi.fn();
const mockDnsLookup = vi.fn();
const mockResolveOpenclawAgentModelsFile = vi.fn();
const mockProbeOpenclawProviderStatus = vi.fn();

vi.mock("@/lib/json", () => ({
	readJsonFileSync: (...args: any[]) => mockReadJsonFileSync(...args),
}));

vi.mock("@/lib/openclaw-paths", () => ({
	resolveOpenclawAgentModelsFile: (...args: any[]) =>
		mockResolveOpenclawAgentModelsFile(...args),
}));

vi.mock("@/lib/openclaw-cli", () => ({
	probeOpenclawProviderStatus: (...args: any[]) =>
		mockProbeOpenclawProviderStatus(...args),
	sanitizeOpenclawError: (error: unknown, fallback: string) =>
		error instanceof Error && error.message ? error.message : fallback,
}));

vi.mock("node:dns/promises", () => ({
	default: {
		lookup: (...args: any[]) => mockDnsLookup(...args),
	},
}));

describe("parseModelRef", () => {
	it("splits provider/model format", () => {
		expect(parseModelRef("anthropic/claude-3-opus")).toEqual({
			providerId: "anthropic",
			modelId: "claude-3-opus",
		});
	});

	it("handles model IDs with slashes", () => {
		expect(parseModelRef("openai/gpt-4/turbo")).toEqual({
			providerId: "openai",
			modelId: "gpt-4/turbo",
		});
	});

	it("handles a plain model name without slash", () => {
		expect(parseModelRef("gpt-4")).toEqual({
			providerId: "gpt-4",
			modelId: "gpt-4",
		});
	});

	it("handles empty string", () => {
		expect(parseModelRef("")).toEqual({
			providerId: "",
			modelId: "",
		});
	});

	it("falls back to providerId when model part is empty after slash", () => {
		expect(parseModelRef("provider/")).toEqual({
			providerId: "provider",
			modelId: "provider",
		});
	});
});

describe("probeModel", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.resetModules();
		mockReadJsonFileSync.mockReset();
		mockDnsLookup
			.mockReset()
			.mockResolvedValue([{ address: "104.18.33.45", family: 4 }]);
		mockResolveOpenclawAgentModelsFile
			.mockReset()
			.mockReturnValue("/tmp/openclaw-home/agents/main/agent/models.json");
		mockProbeOpenclawProviderStatus
			.mockReset()
			.mockRejectedValue(new Error("Provider probe command failed"));
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns direct probe result for anthropic-messages API", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				anthropic: {
					baseUrl: "https://api.anthropic.com",
					api: "anthropic-messages",
					apiKey: "sk-test-key",
				},
			},
		});

		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ content: [{ text: "OK" }] }), {
				status: 200,
			}),
		);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "anthropic",
			modelId: "claude-3-opus",
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(true);
		expect(result.model).toBe("anthropic/claude-3-opus");
		expect(result.source).toBe("direct_model_probe");
		expect(result.precision).toBe("model");
		expect(result.mode).toBe("api_key");
	});

	it("returns direct probe result for openai-completions API", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				openai: {
					baseUrl: "https://api.openai.com",
					api: "openai-completions",
					apiKey: "sk-test-key",
				},
			},
		});

		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
				{
					status: 200,
				},
			),
		);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "openai",
			modelId: "gpt-4",
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(true);
		expect(result.source).toBe("direct_model_probe");
	});

	it("handles API error response for anthropic-messages", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				anthropic: {
					baseUrl: "https://api.anthropic.com",
					api: "anthropic-messages",
					apiKey: "sk-test-key",
				},
			},
		});

		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ error: { message: "Invalid API key" } }),
					{ status: 401 },
				),
			);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "anthropic",
			modelId: "claude-3",
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("auth");
		expect(result.error).toContain("Invalid API key");
	});

	it("handles API error response for openai-completions", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				openai: {
					baseUrl: "https://api.openai.com",
					api: "openai-completions",
					apiKey: "sk-test-key",
				},
			},
		});

		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ error: { message: "Rate limit exceeded" } }),
					{ status: 429 },
				),
			);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "openai",
			modelId: "gpt-4",
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("rate_limit");
	});

	it("handles network error for anthropic API", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				anthropic: {
					baseUrl: "https://api.anthropic.com",
					api: "anthropic-messages",
					apiKey: "sk-test-key",
				},
			},
		});

		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "anthropic",
			modelId: "claude-3",
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("network");
	});

	it("handles network error for openai API", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				openai: {
					baseUrl: "https://api.openai.com",
					api: "openai-completions",
					apiKey: "sk-test-key",
				},
			},
		});

		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "openai",
			modelId: "gpt-4",
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("network");
	});

	it("handles timeout (AbortError) for anthropic API", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				anthropic: {
					baseUrl: "https://api.anthropic.com",
					api: "anthropic-messages",
					apiKey: "sk-test-key",
				},
			},
		});

		const abortError = new Error("AbortError");
		abortError.name = "AbortError";
		globalThis.fetch = vi.fn().mockRejectedValue(abortError);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "anthropic",
			modelId: "claude-3",
			timeoutMs: 100,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("timeout");
	});

	it("handles timeout (AbortError) for openai API", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				openai: {
					baseUrl: "https://api.openai.com",
					api: "openai-completions",
					apiKey: "sk-test-key",
				},
			},
		});

		const abortError = new Error("AbortError");
		abortError.name = "AbortError";
		globalThis.fetch = vi.fn().mockRejectedValue(abortError);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "openai",
			modelId: "gpt-4",
			timeoutMs: 100,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("timeout");
	});

	it("fails closed to the CLI fallback when the direct probe target is loopback", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				custom: {
					baseUrl: "http://127.0.0.1:11434",
					api: "openai-completions",
					apiKey: "key",
				},
			},
		});

		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy;

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "custom",
			modelId: "model-1",
			timeoutMs: 5000,
		});
		expect(result).toMatchObject({
			ok: false,
			error: "Provider probe command failed",
			source: "openclaw_provider_probe",
			precision: "provider",
		});
		expect(mockProbeOpenclawProviderStatus).toHaveBeenCalledWith(
			"custom",
			5000,
		);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("retries a transient direct probe failure once before succeeding", async () => {
		vi.useFakeTimers();
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				openai: {
					baseUrl: "https://api.openai.com",
					api: "openai-completions",
					apiKey: "sk-test-key",
				},
			},
		});

		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ error: { message: "Rate limit exceeded" } }),
					{ status: 429 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
					{ status: 200 },
				),
			);
		globalThis.fetch = fetchSpy;

		const { probeModel } = await import("@/lib/model-probe");
		const resultPromise = probeModel({
			providerId: "openai",
			modelId: "gpt-4.1",
			timeoutMs: 5000,
		});
		await vi.advanceTimersByTimeAsync(250);
		const result = await resultPromise;
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(result.ok).toBe(true);
		vi.useRealTimers();
	});

	it("falls back to CLI probe when provider config has no baseUrl", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				custom: { api: "openai-completions", apiKey: "key" },
			},
		});

		const { probeModel } = await import("@/lib/model-probe");
		await expect(
			probeModel({ providerId: "custom", modelId: "model-1", timeoutMs: 5000 }),
		).resolves.toMatchObject({
			ok: false,
			error: "Provider probe command failed",
			source: "openclaw_provider_probe",
		});
		expect(mockProbeOpenclawProviderStatus).toHaveBeenCalledWith(
			"custom",
			5000,
		);
	});

	it("falls back to CLI probe when provider config is missing", async () => {
		mockReadJsonFileSync.mockReturnValue({ providers: {} });

		const { probeModel } = await import("@/lib/model-probe");
		await expect(
			probeModel({
				providerId: "nonexistent",
				modelId: "model-1",
				timeoutMs: 5000,
			}),
		).resolves.toMatchObject({
			ok: false,
			error: "Provider probe command failed",
			source: "openclaw_provider_probe",
		});
		expect(mockProbeOpenclawProviderStatus).toHaveBeenCalledWith(
			"nonexistent",
			5000,
		);
	});

	it("falls back to CLI probe when models.json is missing", async () => {
		mockReadJsonFileSync.mockImplementation(() => {
			throw new Error("File not found");
		});

		const { probeModel } = await import("@/lib/model-probe");
		await expect(
			probeModel({ providerId: "test", modelId: "model", timeoutMs: 5000 }),
		).resolves.toMatchObject({
			ok: false,
			error: "Provider probe command failed",
			source: "openclaw_provider_probe",
		});
		expect(mockProbeOpenclawProviderStatus).toHaveBeenCalledWith("test", 5000);
	});

	it("fails closed when the shared models path resolver rejects the runtime path", async () => {
		mockResolveOpenclawAgentModelsFile.mockReturnValueOnce(null);
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy;

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "test",
			modelId: "model",
			timeoutMs: 5000,
		});

		expect(result).toMatchObject({
			ok: false,
			error: "OpenClaw runtime models path is invalid",
			source: "openclaw_provider_probe",
		});
		expect(mockProbeOpenclawProviderStatus).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("falls back to CLI probe for unsupported API types", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				custom: {
					baseUrl: "https://custom.api.com",
					api: "custom-api",
					apiKey: "key",
				},
			},
		});

		const { probeModel } = await import("@/lib/model-probe");
		await expect(
			probeModel({ providerId: "custom", modelId: "model-1", timeoutMs: 5000 }),
		).resolves.toMatchObject({
			ok: false,
			error: "Provider probe command failed",
			source: "openclaw_provider_probe",
		});
		expect(mockProbeOpenclawProviderStatus).toHaveBeenCalledWith(
			"custom",
			5000,
		);
	});

	it("returns a stable failure when the shared provider probe helper reports malformed output", async () => {
		mockReadJsonFileSync.mockReturnValue({ providers: {} });
		mockProbeOpenclawProviderStatus.mockRejectedValueOnce(
			new Error("Provider probe returned malformed OpenClaw output"),
		);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "custom",
			modelId: "model-1",
			timeoutMs: 5000,
		});

		expect(result).toMatchObject({
			ok: false,
			error: "Provider probe returned malformed OpenClaw output",
			source: "openclaw_provider_probe",
			status: "unknown",
		});
	});

	it("fails closed when the shared provider probe helper returns no matching result", async () => {
		mockReadJsonFileSync.mockReturnValue({ providers: {} });
		mockProbeOpenclawProviderStatus.mockResolvedValueOnce([
			{
				provider: "other",
				model: "other/model",
				status: "ok",
			},
		]);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "custom",
			modelId: "model-1",
			timeoutMs: 5000,
		});

		expect(result).toMatchObject({
			ok: false,
			error: "No probe result for provider custom",
			source: "openclaw_provider_probe",
			status: "unknown",
			precision: "provider",
		});
	});

	it("uses custom authHeader when specified as string", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				custom: {
					baseUrl: "https://api.custom.com",
					api: "openai-completions",
					apiKey: "my-key",
					authHeader: "X-Custom-Auth",
				},
			},
		});

		const fetchSpy = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
		globalThis.fetch = fetchSpy;

		const { probeModel } = await import("@/lib/model-probe");
		await probeModel({
			providerId: "custom",
			modelId: "model",
			timeoutMs: 5000,
		});

		const calledHeaders = fetchSpy.mock.calls[0]?.[1]?.headers;
		expect(calledHeaders?.["X-Custom-Auth"]).toBe("my-key");
	});

	it("uses x-api-key when authHeader is false", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				custom: {
					baseUrl: "https://api.custom.com",
					api: "openai-completions",
					apiKey: "my-key",
					authHeader: false,
				},
			},
		});

		const fetchSpy = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
		globalThis.fetch = fetchSpy;

		const { probeModel } = await import("@/lib/model-probe");
		await probeModel({
			providerId: "custom",
			modelId: "model",
			timeoutMs: 5000,
		});

		const calledHeaders = fetchSpy.mock.calls[0]?.[1]?.headers;
		expect(calledHeaders?.["x-api-key"]).toBe("my-key");
	});

	it("classifies billing errors", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				openai: {
					baseUrl: "https://api.openai.com",
					api: "openai-completions",
					apiKey: "sk-test",
				},
			},
		});

		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "billing issue" } }), {
				status: 402,
			}),
		);

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "openai",
			modelId: "gpt-4",
			timeoutMs: 5000,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("billing");
	});

	it("sets temperature=1 for kimi-coding provider", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				"kimi-coding": {
					baseUrl: "https://api.kimi.com",
					api: "openai-completions",
					apiKey: "key",
				},
			},
		});

		const fetchSpy = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
		globalThis.fetch = fetchSpy;

		const { probeModel } = await import("@/lib/model-probe");
		await probeModel({
			providerId: "kimi-coding",
			modelId: "model",
			timeoutMs: 5000,
		});

		const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body);
		expect(body.temperature).toBe(1);
	});

	it("includes extra headers from provider config", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				custom: {
					baseUrl: "https://api.custom.com",
					api: "openai-completions",
					apiKey: "key",
					headers: { "X-Extra": "value" },
				},
			},
		});

		const fetchSpy = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
		globalThis.fetch = fetchSpy;

		const { probeModel } = await import("@/lib/model-probe");
		await probeModel({
			providerId: "custom",
			modelId: "model",
			timeoutMs: 5000,
		});

		const calledHeaders = fetchSpy.mock.calls[0]?.[1]?.headers;
		expect(calledHeaders?.["X-Extra"]).toBe("value");
	});

	it("case-insensitive provider lookup", async () => {
		mockReadJsonFileSync.mockReturnValue({
			providers: {
				Anthropic: {
					baseUrl: "https://api.anthropic.com",
					api: "anthropic-messages",
					apiKey: "key",
				},
			},
		});

		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

		const { probeModel } = await import("@/lib/model-probe");
		const result = await probeModel({
			providerId: "anthropic",
			modelId: "claude-3",
			timeoutMs: 5000,
		});

		expect(result.source).toBe("direct_model_probe");
	});
});
