import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/health", () => {
	it("returns a healthy status", async () => {
		process.env = {
			...ORIGINAL_ENV,
			DASHBOARD_DEPLOYMENT_ENV: "production",
		};
		const response = await GET();
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.deploymentEnvironment).toBe("production");
		expect(body.status).toBe("healthy");
		expect(body.timestamp).toBeDefined();
	});

	it("returns a valid ISO timestamp", async () => {
		process.env = {
			...ORIGINAL_ENV,
			DASHBOARD_DEPLOYMENT_ENV: "staging",
		};
		const response = await GET();
		const body = await response.json();
		const parsed = new Date(body.timestamp);
		expect(parsed.toISOString()).toBe(body.timestamp);
	});

	it("falls back to NODE_ENV when deployment env is unset", async () => {
		process.env = {
			...ORIGINAL_ENV,
			NODE_ENV: "production",
		};
		delete process.env.DASHBOARD_DEPLOYMENT_ENV;

		const response = await GET();
		const body = await response.json();

		expect(body.deploymentEnvironment).toBe("production");
	});

	it("stays healthy when deployment env is invalid", async () => {
		process.env = {
			...ORIGINAL_ENV,
			NODE_ENV: "production",
			DASHBOARD_DEPLOYMENT_ENV: "prod",
		};

		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.deploymentEnvironment).toBe("production");
		expect(body.deploymentEnvironmentWarning).toContain(
			"DASHBOARD_DEPLOYMENT_ENV",
		);
		expect(body.status).toBe("healthy");
	});
});
