import { setAirConditionerFanMode, validateFanMode } from "@/lib/smartthings";
import { errorResponse, jsonResponse, statusAfterCommand } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { fanMode?: unknown };
    const fanMode = validateFanMode(body.fanMode);

    await setAirConditionerFanMode(fanMode);
    const status = await statusAfterCommand();
    return jsonResponse({ status });
  } catch (error) {
    return errorResponse(error);
  }
}
