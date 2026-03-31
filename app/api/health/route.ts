import { NextResponse } from "next/server";
import { resolveDashboardDeploymentEnvironment } from "@/lib/security/dashboard-env";

export async function GET() {
	const deployment = resolveDashboardDeploymentEnvironment();

	return NextResponse.json({
		deploymentEnvironment: deployment.value,
		...(deployment.warning
			? { deploymentEnvironmentWarning: deployment.warning }
			: {}),
		status: "healthy",
		timestamp: new Date().toISOString(),
	});
}
