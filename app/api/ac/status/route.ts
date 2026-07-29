import {
  getAirConditionerStatus,
  getAllowedFanModes,
  getAllowedModes,
  getTemperatureRange,
} from "@/lib/smartthings";
import { getActiveWindDownPowerOff } from "@/lib/scheduler";
import { errorResponse, jsonResponse } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getAirConditionerStatus();
    const activeWindDown = await getActiveWindDownPowerOff();

    return jsonResponse({
      status: activeWindDown ? { ...status, power: "off", mode: "wind" } : status,
      controls: {
        temperature: getTemperatureRange(),
        modes: getAllowedModes(),
        fanModes: getAllowedFanModes(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
