import {
  SmartThingsApiError,
  SmartThingsConfigError,
  getAirConditionerStatus,
} from "@/lib/smartthings";
import { SmartThingsOAuthError } from "@/lib/smartthings-oauth";

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
    if (error.status === 401 || error.status === 403) {
      return jsonResponse(
        {
          error:
            `SmartThings 인증 오류입니다. OAuth 연결 상태 또는 SmartThings 권한을 확인해 주세요. (${error.message})`,
        },
        { status: error.status },
      );
    }

    return jsonResponse({ error: error.message }, { status: error.status });
  }

  if (error instanceof SmartThingsOAuthError) {
    return jsonResponse({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return jsonResponse({ error: "Unexpected server error." }, { status: 500 });
}
