import { exec, execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const OPENCLAW_EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export type OpenclawJsonObject = Record<string, unknown>;

export type OpenclawJsonCommandErrorCode = "command_failed" | "invalid_output";

export class OpenclawJsonCommandError extends Error {
	readonly code: OpenclawJsonCommandErrorCode;
	readonly detail: string | null;

	constructor(
		code: OpenclawJsonCommandErrorCode,
		message: string,
		detail: string | null = null,
	) {
		super(message);
		this.name = "OpenclawJsonCommandError";
		this.code = code;
		this.detail = detail;
	}
}

function isOpenclawJsonObject(value: unknown): value is OpenclawJsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOpenclawDetail(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractOpenclawCommandDetail(error: unknown): string | null {
	if (!error || typeof error !== "object") {
		return error instanceof Error
			? normalizeOpenclawDetail(error.message)
			: null;
	}

	const err = error as {
		stderr?: unknown;
		stdout?: unknown;
		message?: unknown;
	};

	return (
		normalizeOpenclawDetail(err.stderr) ||
		normalizeOpenclawDetail(err.stdout) ||
		normalizeOpenclawDetail(err.message) ||
		null
	);
}

function toOpenclawJsonCommandError(
	error: unknown,
	commandFailureMessage: string,
): OpenclawJsonCommandError {
	if (error instanceof OpenclawJsonCommandError) {
		return error;
	}
	return new OpenclawJsonCommandError(
		"command_failed",
		commandFailureMessage,
		extractOpenclawCommandDetail(error),
	);
}

function quoteShellArg(arg: string): string {
	if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '""')}"`;
}

export async function execOpenclaw(
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	const env = { ...process.env, FORCE_COLOR: "0" };

	if (process.platform !== "win32") {
		return execFileAsync("openclaw", args, {
			maxBuffer: OPENCLAW_EXEC_MAX_BUFFER_BYTES,
			env,
		});
	}

	const command = `openclaw ${args.map(quoteShellArg).join(" ")}`;
	return execAsync(command, {
		maxBuffer: OPENCLAW_EXEC_MAX_BUFFER_BYTES,
		env,
		shell: "cmd.exe",
	});
}

export function parseJsonFromMixedOutput(output: string): any {
	for (let i = 0; i < output.length; i++) {
		if (output[i] !== "{") continue;
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let j = i; j < output.length; j++) {
			const ch = output[j];
			if (inString) {
				if (escaped) escaped = false;
				else if (ch === "\\") escaped = true;
				else if (ch === '"') inString = false;
				continue;
			}
			if (ch === '"') {
				inString = true;
				continue;
			}
			if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) {
					const candidate = output.slice(i, j + 1).trim();
					try {
						return JSON.parse(candidate);
					} catch {
						break;
					}
				}
			}
		}
	}
	return null;
}

export function parseOpenclawJsonOutput(stdout: string, stderr = ""): any {
	const trimmed = stdout.trim();
	if (trimmed) {
		try {
			return JSON.parse(trimmed);
		} catch {
			// Fallback below.
		}
	}
	return parseJsonFromMixedOutput(`${stdout}\n${stderr}`);
}

export function parseRequiredOpenclawJsonOutput(
	stdout: string,
	stderr = "",
	invalidOutputMessage = "Malformed OpenClaw JSON output",
): OpenclawJsonObject {
	const parsed = parseOpenclawJsonOutput(stdout, stderr);
	if (isOpenclawJsonObject(parsed)) {
		return parsed;
	}
	throw new OpenclawJsonCommandError("invalid_output", invalidOutputMessage);
}

function normalizeOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export interface OpenclawGatewayStatusResult {
	ok: boolean;
	error?: string;
}

export interface OpenclawProviderProbeResult {
	provider?: string;
	model?: string;
	mode?: string;
	status?: string;
	error?: string;
	latencyMs?: number;
}

function normalizeProviderProbeResult(
	value: unknown,
): OpenclawProviderProbeResult | null {
	if (!isOpenclawJsonObject(value)) return null;
	return {
		provider: normalizeOptionalString(value.provider),
		model: normalizeOptionalString(value.model),
		mode: normalizeOptionalString(value.mode),
		status: normalizeOptionalString(value.status),
		error: normalizeOptionalString(value.error),
		latencyMs: normalizeOptionalNumber(value.latencyMs),
	};
}

export async function execOpenclawJsonCommand<T extends OpenclawJsonObject>(
	args: string[],
	options?: {
		commandFailureMessage?: string;
		invalidOutputMessage?: string;
	},
): Promise<T> {
	const commandFailureMessage =
		options?.commandFailureMessage || "OpenClaw command failed";
	const invalidOutputMessage =
		options?.invalidOutputMessage || "Malformed OpenClaw JSON output";

	try {
		const { stdout, stderr } = await execOpenclaw(args);
		return parseRequiredOpenclawJsonOutput(
			stdout,
			stderr,
			invalidOutputMessage,
		) as T;
	} catch (error) {
		throw toOpenclawJsonCommandError(error, commandFailureMessage);
	}
}

export async function getOpenclawVersion(): Promise<string | undefined> {
	try {
		const { stdout } = await execOpenclaw(["--version"]);
		return stdout.trim().split(/\s+/)[0] || undefined;
	} catch {
		return undefined;
	}
}

export async function probeOpenclawGatewayStatus(
	token: string,
	timeoutMs = 5000,
): Promise<OpenclawGatewayStatusResult> {
	const args = ["gateway", "status", "--json", "--timeout", String(timeoutMs)];
	if (token) args.push("--token", token);

	try {
		const parsed = await execOpenclawJsonCommand(args, {
			commandFailureMessage: "Gateway status probe failed",
			invalidOutputMessage:
				"Gateway status probe returned malformed OpenClaw output",
		});
		const rpc = isOpenclawJsonObject(parsed.rpc) ? parsed.rpc : null;
		const ok = rpc?.ok === true;
		return {
			ok,
			error: normalizeOptionalString(rpc?.error),
		};
	} catch (error) {
		return {
			ok: false,
			error: sanitizeOpenclawError(error, "Gateway status probe failed"),
		};
	}
}

export async function probeOpenclawProviderStatus(
	providerId: string,
	timeoutMs: number,
): Promise<OpenclawProviderProbeResult[]> {
	const parsed = await execOpenclawJsonCommand(
		[
			"models",
			"status",
			"--probe",
			"--json",
			"--probe-timeout",
			String(timeoutMs),
			"--probe-provider",
			providerId,
		],
		{
			commandFailureMessage: "Provider probe command failed",
			invalidOutputMessage: "Provider probe returned malformed OpenClaw output",
		},
	);

	const auth = isOpenclawJsonObject(parsed.auth) ? parsed.auth : null;
	const probes = auth && isOpenclawJsonObject(auth.probes) ? auth.probes : null;
	const results = Array.isArray(probes?.results) ? probes.results : [];

	return results
		.map((result) => normalizeProviderProbeResult(result))
		.filter((result): result is OpenclawProviderProbeResult => result !== null);
}

export function sanitizeOpenclawError(
	error: unknown,
	fallbackMessage: string,
): string {
	if (error instanceof OpenclawJsonCommandError) {
		return error.message;
	}
	return fallbackMessage;
}

export function resolveConfigSnapshotHash(
	snapshot: { hash?: string; raw?: string | null } | null | undefined,
): string | null {
	const hash = snapshot?.hash;
	if (typeof hash === "string" && hash.trim()) return hash.trim();
	if (typeof snapshot?.raw !== "string") return null;
	return crypto.createHash("sha256").update(snapshot.raw).digest("hex");
}

export async function callOpenclawGateway(
	method: string,
	params: Record<string, unknown> = {},
	timeoutMs = 10000,
): Promise<any> {
	try {
		return await execOpenclawJsonCommand(
			[
				"gateway",
				"call",
				method,
				"--json",
				"--timeout",
				String(timeoutMs),
				"--params",
				JSON.stringify(params),
			],
			{
				commandFailureMessage: `Gateway call failed: ${method}`,
				invalidOutputMessage: `Failed to parse Gateway response for ${method}`,
			},
		);
	} catch (error) {
		const detail =
			error instanceof OpenclawJsonCommandError ? error.detail : null;
		throw new Error(
			detail || sanitizeOpenclawError(error, `Gateway call failed: ${method}`),
		);
	}
}
