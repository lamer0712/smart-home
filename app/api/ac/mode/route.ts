import { setAirConditionerMode, validateMode } from "@/lib/smartthings";
import { errorResponse, jsonResponse, statusAfterCommand } from "../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mode?: unknown };
    const mode = validateMode(body.mode);

    await setAirConditionerMode(mode);
    const status = await statusAfterCommand();
    return jsonResponse({ status });
  } catch (error) {
    return errorResponse(error);
  }
}
