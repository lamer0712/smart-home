import { NextResponse } from "next/server";
import {
  SMARTTHINGS_OAUTH_STATE_COOKIE,
  SmartThingsOAuthError,
  exchangeSmartThingsCode,
} from "@/lib/smartthings-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const storedState = readCookie(request.headers.get("cookie"), SMARTTHINGS_OAUTH_STATE_COOKIE);

  if (error) {
    return callbackError(errorDescription ?? error, 400);
  }

  if (!code || !state || !storedState || state !== storedState) {
    return callbackError("SmartThings OAuth state validation failed.", 400);
  }

  try {
    await exchangeSmartThingsCode(code);
  } catch (requestError) {
    if (requestError instanceof SmartThingsOAuthError) {
      return callbackError(requestError.message, requestError.status);
    }

    console.error(requestError);
    return callbackError("SmartThings OAuth 연결 중 알 수 없는 오류가 발생했습니다.", 500);
  }

  const response = NextResponse.redirect(new URL("/?smartthings=connected", request.url));
  response.cookies.set(SMARTTHINGS_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/api/smartthings",
    sameSite: "lax",
    secure: isHttpsRequest(request),
  });

  return response;
}

function callbackError(message: string, status: number) {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><title>SmartThings 연결 실패</title><body><h1>SmartThings 연결 실패</h1><p>${escapeHtml(message)}</p></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function readCookie(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isHttpsRequest(request: Request) {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}
