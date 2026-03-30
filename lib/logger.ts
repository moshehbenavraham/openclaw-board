import fs from "fs";
import path from "path";
import pino from "pino";

const logsDir = path.join(process.cwd(), "logs");

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
	fs.mkdirSync(logsDir, { recursive: true });
}

const writeLastError = (errorObj: any, msg: string) => {
	try {
		const timestamp = new Date().toISOString();
		const filename = `last_error_${timestamp.replace(/[:.]/g, "-")}.json`;
		const filepath = path.join(logsDir, filename);

		const errorData = {
			timestamp,
			level: "error",
			msg,
			error: errorObj
				? {
						type: errorObj.name || "Error",
						message: errorObj.message || String(errorObj),
						stack: errorObj.stack || "",
					}
				: null,
			context: {},
		};

		fs.writeFileSync(filepath, JSON.stringify(errorData, null, 2));
	} catch (err) {
		console.error("Failed to write last_error.json", err);
	}
};

export const logger = pino({
	level: process.env.LOG_LEVEL || "info",
	hooks: {
		logMethod(inputArgs, method, level) {
			if (level >= 50) {
				// error level or higher
				const errorObj = inputArgs.find(
					(arg) =>
						arg instanceof Error ||
						(arg && typeof arg === "object" && "message" in arg),
				);
				const msgArg = inputArgs.find((arg) => typeof arg === "string");
				const msg = msgArg || "Error logged";

				writeLastError(errorObj, msg);
			}
			return method.apply(this, inputArgs as [any, ...any[]]);
		},
	},
});
