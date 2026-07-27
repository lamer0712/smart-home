import {
  getAirConditionerStatus,
  getAllowedFanModes,
  getAllowedModes,
  getTemperatureRange,
} from "@/lib/smartthings";
import { errorResponse, jsonResponse } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getAirConditionerStatus();
    return jsonResponse({
      status,
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
