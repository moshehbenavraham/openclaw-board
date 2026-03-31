import type { NextRequest } from "next/server";
import { proxy as runProxy } from "./lib/security/proxy";

export function proxy(request: NextRequest) {
	return runProxy(request);
}

export const config = {
	matcher: [
		// Apply security headers broadly; static/public assets skip rate limiting in-code.
		"/((?!_next/static|_next/image|favicon.ico|icon.png).*)",
	],
};
