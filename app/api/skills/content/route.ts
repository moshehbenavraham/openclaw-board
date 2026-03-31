import { NextResponse } from "next/server";
import { getOpenclawSkillContent } from "@/lib/openclaw-skills";

const SKILL_SOURCE_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		const source = (searchParams.get("source") || "").trim();
		const id = (searchParams.get("id") || "").trim();

		if (!source || !id) {
			return NextResponse.json(
				{ error: "Missing source or id" },
				{ status: 400 },
			);
		}

		if (!SKILL_SOURCE_PATTERN.test(source) || !SKILL_ID_PATTERN.test(id)) {
			return NextResponse.json(
				{ error: "Invalid source or id" },
				{ status: 400 },
			);
		}

		const result = await getOpenclawSkillContent(source, id);
		if (!result) {
			return NextResponse.json({ error: "Skill not found" }, { status: 404 });
		}

		return NextResponse.json({
			id: result.skill.id,
			name: result.skill.name,
			source: result.skill.source,
			content: result.content,
		});
	} catch (error: unknown) {
		console.error("[skills/content] failed", error);
		return NextResponse.json(
			{ error: "Skill content unavailable" },
			{ status: 500 },
		);
	}
}
