import { NextResponse } from "next/server";
import {
  SMARTTHINGS_OAUTH_STATE_COOKIE,
  buildSmartThingsAuthorizationUrl,
} from "@/lib/smartthings-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildSmartThingsAuthorizationUrl(state));

  response.cookies.set(SMARTTHINGS_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/api/smartthings",
    sameSite: "lax",
    secure: isHttpsRequest(request),
  });

  return response;
}

function isHttpsRequest(request: Request) {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}
