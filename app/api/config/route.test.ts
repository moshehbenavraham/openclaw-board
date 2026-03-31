import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe("GET /api/config", () => {
	const originalEnv = { ...process.env };
	let tempHome = "";

	beforeEach(() => {
		vi.resetModules();
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "krox-config-"));
		process.env = { ...originalEnv, OPENCLAW_HOME: tempHome };
	});

	afterEach(async () => {
		const cache = await import("@/lib/config-cache");
		cache.clearConfigCache();
		vi.restoreAllMocks();
		process.env = { ...originalEnv };
		if (tempHome) {
			fs.rmSync(tempHome, { recursive: true, force: true });
		}
	});

	it("returns a token-free gateway contract and sanitized launch metadata", async () => {
		writeJson(path.join(tempHome, "openclaw.json"), {
			gateway: {
				port: 19999,
				host: "gateway.internal",
				auth: { token: "super-secret-token" },
			},
			agents: {
				defaults: { model: "provider/default", fallbacks: [] },
				list: [
					{
						id: "main",
						name: "Main",
						identity: { emoji: "M" },
						model: "provider/default",
					},
					{
						id: "helper",
						name: "Helper",
						identity: { emoji: "H" },
						model: "provider/helper",
					},
				],
			},
			channels: {
				discord: {
					enabled: true,
					dm: { allowFrom: ["fallback-user"] },
				},
				feishu: {
					enabled: true,
					accounts: {
						helper: { appId: "feishu-helper-app" },
					},
				},
			},
			bindings: [
				{ agentId: "main", match: { channel: "discord" } },
				{
					agentId: "helper",
					match: { channel: "feishu", accountId: "helper" },
				},
			],
			models: {
				providers: {
					provider: {
						models: [{ id: "default", name: "Default" }],
					},
				},
			},
		});
		writeJson(path.join(tempHome, "agents/main/sessions/sessions.json"), {
			"agent:main:discord:direct:123456": { updatedAt: 2 },
			"agent:main:main": { updatedAt: 1 },
		});
		writeJson(path.join(tempHome, "agents/helper/sessions/sessions.json"), {});

		const { GET } = await import("./route");
		const response = await GET();
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.gateway).toEqual({ launchPath: "/gateway/chat" });
		expect(body.gateway.token).toBeUndefined();
		expect(body.gateway.port).toBeUndefined();
		expect(body.gateway.host).toBeUndefined();

		const mainAgent = body.agents.find((agent: any) => agent.id === "main");
		expect(mainAgent.launchPath).toMatch(/^\/gateway\/chat\?launch=/);

		const discordPlatform = mainAgent.platforms.find(
			(platform: any) => platform.name === "discord",
		);
		expect(discordPlatform.launchPath).toMatch(/^\/gateway\/chat\?launch=/);
		expect(discordPlatform.botUserId).toBeUndefined();
		expect(discordPlatform.botOpenId).toBeUndefined();
		expect(discordPlatform.appId).toBeUndefined();

		const helperAgent = body.agents.find((agent: any) => agent.id === "helper");
		const helperFeishu = helperAgent.platforms.find(
			(platform: any) => platform.name === "feishu",
		);
		expect(helperFeishu.accountId).toBe("helper");
		expect(helperFeishu.launchPath).toBeUndefined();
		expect(helperFeishu.appId).toBeUndefined();
	});

	it("serves an isolated cached snapshot on cache hits", async () => {
		const cache = await import("@/lib/config-cache");
		const cachedData = {
			agents: [{ id: "main", name: "Main", emoji: "M", platforms: [] }],
			providers: [],
			defaults: { model: "provider/default", fallbacks: [] },
			gateway: { launchPath: "/gateway/chat" },
			groupChats: [],
		};
		cache.setConfigCache({ data: cachedData, ts: Date.now() });
		cachedData.agents[0].name = "Mutated";

		const { GET } = await import("./route");
		const response = await GET();
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			agents: [{ id: "main", name: "Main" }],
		});
	});

	it("returns a sanitized error when the runtime root is invalid", async () => {
		vi.resetModules();
		process.env = { ...originalEnv, OPENCLAW_HOME: "relative/openclaw-home" };

		const { GET } = await import("./route");
		const response = await GET();
		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: "Configuration unavailable",
		});
	});

	it("returns a sanitized error when runtime config reads fail unexpectedly", async () => {
		const configPath = path.join(tempHome, "openclaw.json");
		writeJson(configPath, {
			agents: {
				defaults: { model: "provider/default", fallbacks: [] },
			},
		});
		const originalReadFileSync = fs.readFileSync.bind(fs);
		vi.spyOn(fs, "readFileSync").mockImplementation(((
			filePath: fs.PathOrFileDescriptor,
			options?: any,
		) => {
			if (String(filePath) === configPath) {
				throw new Error("EACCES: /tmp/secret/runtime/openclaw.json");
			}
			return originalReadFileSync(filePath, options);
		}) as typeof fs.readFileSync);

		const { GET } = await import("./route");
		const response = await GET();
		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: "Configuration unavailable",
		});
	});
});
