import { NextResponse } from "next/server";
import { listOpenclawSkills } from "@/lib/openclaw-skills";

export async function GET() {
	try {
		return NextResponse.json(await listOpenclawSkills());
	} catch (error: unknown) {
		console.error("[skills] failed", error);
		return NextResponse.json(
			{ error: "Unable to load skills" },
			{ status: 500 },
		);
	}
}
