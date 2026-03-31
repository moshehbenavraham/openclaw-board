import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	callOpenclawGateway,
	execOpenclawJsonCommand,
	getOpenclawVersion,
	OpenclawJsonCommandError,
	parseJsonFromMixedOutput,
	parseOpenclawJsonOutput,
	parseRequiredOpenclawJsonOutput,
	probeOpenclawGatewayStatus,
	probeOpenclawProviderStatus,
	resolveConfigSnapshotHash,
} from "@/lib/openclaw-cli";

const { execFilePromiseMock, execPromiseMock } = vi.hoisted(() => ({
	execFilePromiseMock: vi.fn(),
	execPromiseMock: vi.fn(),
}));

vi.mock("node:child_process", () => {
	const execFileMock = vi.fn(
		(
			_cmd: string,
			_args: string[],
			_opts: unknown,
			cb?: (...args: any[]) => void,
		) => {
			if (typeof cb === "function") {
				cb(null, "openclaw 1.2.3\n", "");
			}
			return { on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } };
		},
	);
	const execMock = vi.fn(
		(_cmd: string, _opts: unknown, cb?: (...args: any[]) => void) => {
			if (typeof cb === "function") {
				cb(null, "openclaw 1.2.3\n", "");
			}
			return { on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } };
		},
	);
	Object.defineProperty(
		execFileMock,
		Symbol.for("nodejs.util.promisify.custom"),
		{
			value: execFilePromiseMock,
		},
	);
	Object.defineProperty(execMock, Symbol.for("nodejs.util.promisify.custom"), {
		value: execPromiseMock,
	});
	return {
		execFile: execFileMock,
		exec: execMock,
		default: {
			execFile: execFileMock,
			exec: execMock,
		},
	};
});

beforeEach(() => {
	execFilePromiseMock.mockReset();
	execPromiseMock.mockReset();
	execFilePromiseMock.mockResolvedValue({
		stdout: "openclaw 1.2.3\n",
		stderr: "",
	});
	execPromiseMock.mockResolvedValue({
		stdout: "openclaw 1.2.3\n",
		stderr: "",
	});
});

describe("parseJsonFromMixedOutput", () => {
	it("extracts JSON from clean output", () => {
		expect(parseJsonFromMixedOutput('{"status":"ok"}')).toEqual({
			status: "ok",
		});
	});

	it("extracts JSON surrounded by non-JSON text", () => {
		expect(
			parseJsonFromMixedOutput('Loading config\n{"result":42}\nDone'),
		).toEqual({ result: 42 });
	});

	it("handles nested objects and quoted braces", () => {
		expect(
			parseJsonFromMixedOutput('prefix {"a":{"text":"{ok}","b":1}} suffix'),
		).toEqual({ a: { text: "{ok}", b: 1 } });
	});

	it("returns null when no valid JSON object is present", () => {
		expect(parseJsonFromMixedOutput("{bad json} trailing")).toBeNull();
		expect(parseJsonFromMixedOutput("")).toBeNull();
	});
});

describe("parseOpenclawJsonOutput", () => {
	it("parses clean JSON stdout", () => {
		expect(parseOpenclawJsonOutput('{"ok":true}')).toEqual({ ok: true });
	});

	it("falls back to mixed stdout and stderr parsing", () => {
		expect(
			parseOpenclawJsonOutput("warning only", 'stderr\n{"error":"fail"}'),
		).toEqual({ error: "fail" });
	});

	it("returns null when no JSON object exists", () => {
		expect(parseOpenclawJsonOutput("warning", "still warning")).toBeNull();
	});
});

describe("parseRequiredOpenclawJsonOutput", () => {
	it("returns the parsed JSON object when one is present", () => {
		expect(
			parseRequiredOpenclawJsonOutput(
				"warning\n",
				'{"status":"ok","rpc":{"ok":true}}',
			),
		).toEqual({
			status: "ok",
			rpc: { ok: true },
		});
	});

	it("throws a typed invalid-output error when parsing fails", () => {
		expect(() =>
			parseRequiredOpenclawJsonOutput(
				"warning only",
				"still not json",
				"Malformed runtime output",
			),
		).toThrowError(
			expect.objectContaining({
				message: "Malformed runtime output",
				code: "invalid_output",
			}),
		);
	});
});

describe("execOpenclawJsonCommand", () => {
	it("parses mixed stdout and stderr through the shared helper", async () => {
		execFilePromiseMock.mockResolvedValueOnce({
			stdout: "warning: deprecated flag\n",
			stderr: '{"rpc":{"ok":true}}',
		});

		await expect(
			execOpenclawJsonCommand(["gateway", "status", "--json"]),
		).resolves.toEqual({
			rpc: { ok: true },
		});
	});

	it("wraps command failures in a typed shared error", async () => {
		execFilePromiseMock.mockRejectedValueOnce({
			stderr: "spawn openclaw ENOENT",
		});

		await expect(
			execOpenclawJsonCommand(["gateway", "status"], {
				commandFailureMessage: "Gateway status probe failed",
			}),
		).rejects.toMatchObject({
			name: "OpenclawJsonCommandError",
			code: "command_failed",
			message: "Gateway status probe failed",
			detail: "spawn openclaw ENOENT",
		});
	});
});

describe("getOpenclawVersion", () => {
	it("returns the parsed version token", async () => {
		execFilePromiseMock.mockResolvedValueOnce({
			stdout: "2026.3.1 release\n",
			stderr: "",
		});

		await expect(getOpenclawVersion()).resolves.toBe("2026.3.1");
	});

	it("returns undefined when the command fails", async () => {
		execFilePromiseMock.mockRejectedValueOnce(new Error("command failed"));
		await expect(getOpenclawVersion()).resolves.toBeUndefined();
	});
});

describe("probeOpenclawGatewayStatus", () => {
	it("returns the shared gateway status shape", async () => {
		execFilePromiseMock.mockResolvedValueOnce({
			stdout: '{"rpc":{"ok":false,"error":"Gateway down"}}',
			stderr: "",
		});

		await expect(probeOpenclawGatewayStatus("secret", 5000)).resolves.toEqual({
			ok: false,
			error: "Gateway down",
		});
	});

	it("sanitizes malformed runtime output", async () => {
		execFilePromiseMock.mockResolvedValueOnce({
			stdout: "warning only",
			stderr: "not json",
		});

		await expect(probeOpenclawGatewayStatus("", 5000)).resolves.toEqual({
			ok: false,
			error: "Gateway status probe returned malformed OpenClaw output",
		});
	});
});

describe("probeOpenclawProviderStatus", () => {
	it("returns normalized probe results", async () => {
		execFilePromiseMock.mockResolvedValueOnce({
			stdout: JSON.stringify({
				auth: {
					probes: {
						results: [
							{
								provider: "anthropic",
								model: "anthropic/claude-3-opus",
								mode: "api_key",
								status: "ok",
								latencyMs: 42,
							},
							"ignore-me",
						],
					},
				},
			}),
			stderr: "",
		});

		await expect(
			probeOpenclawProviderStatus("anthropic", 5000),
		).resolves.toEqual([
			{
				provider: "anthropic",
				model: "anthropic/claude-3-opus",
				mode: "api_key",
				status: "ok",
				latencyMs: 42,
			},
		]);
	});

	it("throws a typed malformed-output error for bad probe payloads", async () => {
		execFilePromiseMock.mockResolvedValueOnce({
			stdout: "warning only",
			stderr: "still bad",
		});

		await expect(
			probeOpenclawProviderStatus("anthropic", 5000),
		).rejects.toMatchObject({
			name: "OpenclawJsonCommandError",
			code: "invalid_output",
			message: "Provider probe returned malformed OpenClaw output",
		});
	});
});

describe("resolveConfigSnapshotHash", () => {
	it("returns the trimmed hash when present", () => {
		expect(resolveConfigSnapshotHash({ hash: "  abc123  " })).toBe("abc123");
	});

	it("computes sha256 from raw when hash is absent", () => {
		const raw = "some config content";
		expect(resolveConfigSnapshotHash({ raw })).toBe(
			crypto.createHash("sha256").update(raw).digest("hex"),
		);
	});

	it("returns null when hash and raw are both unusable", () => {
		expect(resolveConfigSnapshotHash({ hash: " ", raw: null })).toBeNull();
		expect(resolveConfigSnapshotHash(null)).toBeNull();
	});
});

describe("callOpenclawGateway", () => {
	it("returns the parsed gateway payload from the shared helper", async () => {
		execFilePromiseMock.mockResolvedValueOnce({
			stdout: '{"ok":true,"result":{"value":1}}',
			stderr: "",
		});

		await expect(callOpenclawGateway("config.get")).resolves.toEqual({
			ok: true,
			result: { value: 1 },
		});
	});

	it("keeps command detail available for higher-level callers", async () => {
		execFilePromiseMock.mockRejectedValueOnce(
			new OpenclawJsonCommandError(
				"command_failed",
				"Gateway call failed: config.get",
				"permission denied",
			),
		);

		await expect(callOpenclawGateway("config.get")).rejects.toThrow(
			"permission denied",
		);
	});
});
