import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
	const dir = path.join(process.cwd(), "public", "assets", "pixel-office");
	try {
		const files = fs.readdirSync(dir);
		const tracks = files
			.filter((f) => f.toLowerCase().endsWith(".mp3"))
			.map((f) => `/assets/pixel-office/${f}`);
		return NextResponse.json({ tracks });
	} catch {
		return NextResponse.json({ tracks: [] });
	}
}
