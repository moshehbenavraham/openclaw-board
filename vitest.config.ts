import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		include: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
		exclude: ["node_modules", ".next", "tests/**/*"],
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./"),
		},
	},
});
