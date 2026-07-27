import {
  SmartThingsApiError,
  setAirConditionerMode,
  setCoolingSetpoint,
  validateMode,
  validateTemperature,
} from "@/lib/smartthings";
import { errorResponse, jsonResponse, statusAfterCommand } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mode?: unknown; temperature?: unknown };
    const mode = validateMode(body.mode);

    if (mode === "wind") {
      await setAirConditionerMode(mode);
    } else if (mode === "cool") {
      const temperature = validateTemperature(body.temperature);
      await setAirConditionerMode(mode);
      await setCoolingSetpoint(temperature);
    } else {
      throw new SmartThingsApiError('mode must be either "cool" or "wind".', 400);
    }

    const status = await statusAfterCommand();
    return jsonResponse({ status });
  } catch (error) {
    return errorResponse(error);
  }
}
