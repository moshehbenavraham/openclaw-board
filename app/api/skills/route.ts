import { NextResponse } from "next/server";
import { listOpenclawSkills } from "@/lib/openclaw-skills";

export async function GET() {
	try {
		return NextResponse.json(listOpenclawSkills());
	} catch (err: unknown) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
}
