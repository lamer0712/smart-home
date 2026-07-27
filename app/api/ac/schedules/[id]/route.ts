import { cancelPowerSchedule, listPowerSchedules } from "@/lib/scheduler";
import { errorResponse, jsonResponse } from "../../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const schedule = await cancelPowerSchedule(id);

    if (!schedule) {
      return jsonResponse({ error: "Schedule not found." }, { status: 404 });
    }

    const schedules = await listPowerSchedules();
    return jsonResponse({ schedule, schedules });
  } catch (error) {
    return errorResponse(error);
  }
}
