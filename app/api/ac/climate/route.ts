import {
  SmartThingsApiError,
  setAirConditionerMode,
  setAirConditionerFanMode,
  setCoolingSetpoint,
  validateFanMode,
  validateMode,
  validateTemperature,
} from "@/lib/smartthings";
import { errorResponse, jsonResponse, statusAfterCommand } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      temperature?: unknown;
      fanMode?: unknown;
    };
    const mode = validateMode(body.mode);
    const fanMode = body.fanMode === undefined ? null : validateFanMode(body.fanMode);

    if (mode === "wind") {
      await setAirConditionerMode(mode);
    } else if (mode === "cool") {
      const temperature = validateTemperature(body.temperature);
      await setAirConditionerMode(mode);
      await setCoolingSetpoint(temperature);
    } else {
      throw new SmartThingsApiError('mode must be either "cool" or "wind".', 400);
    }

    if (fanMode) {
      await setAirConditionerFanMode(fanMode);
    }

    const status = await statusAfterCommand();
    return jsonResponse({ status });
  } catch (error) {
    return errorResponse(error);
  }
}
