import {
  cancelPendingWindDownPowerOff,
  scheduleWindDownPowerOff,
} from "@/lib/scheduler";
import { setAirConditionerMode, setPower, validatePower } from "@/lib/smartthings";
import { errorResponse, jsonResponse, statusAfterCommand } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { power?: unknown };
    const power = validatePower(body.power);

    if (power === "off") {
      await setAirConditionerMode("wind");
      await scheduleWindDownPowerOff();
      const status = await statusAfterCommand();
      return jsonResponse({ status: { ...status, power: "off", mode: "wind" } });
    }

    await cancelPendingWindDownPowerOff();
    await setPower("on");
    return jsonResponse({ status: await statusAfterCommand() });
  } catch (error) {
    return errorResponse(error);
  }
}
