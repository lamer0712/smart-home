import {
  SmartThingsApiError,
  SmartThingsConfigError,
  getAirConditionerStatus,
} from "@/lib/smartthings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function jsonResponse<T>(data: T, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });
}

export async function statusAfterCommand() {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return getAirConditionerStatus();
}

export function errorResponse(error: unknown) {
  if (error instanceof SmartThingsConfigError) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }

  if (error instanceof SmartThingsApiError) {
    return jsonResponse({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return jsonResponse({ error: "Unexpected server error." }, { status: 500 });
}
