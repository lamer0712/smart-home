import { setCoolingSetpoint, validateTemperature } from "@/lib/smartthings";
import { errorResponse, jsonResponse, statusAfterCommand } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { temperature?: unknown };
    const temperature = validateTemperature(body.temperature);

    await setCoolingSetpoint(temperature);
    const status = await statusAfterCommand();
    return jsonResponse({ status });
  } catch (error) {
    return errorResponse(error);
  }
}
