import {
  createPowerSchedule,
  listPowerSchedules,
} from "@/lib/scheduler";
import { errorResponse, jsonResponse } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const schedules = await listPowerSchedules();
    return jsonResponse({ schedules });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      power?: unknown;
      runAt?: unknown;
      coolingSetpoint?: unknown;
    };
    const schedule = await createPowerSchedule(body.power, body.runAt, body.coolingSetpoint);
    const schedules = await listPowerSchedules();
    return jsonResponse({ schedule, schedules }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
