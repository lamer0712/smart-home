import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  createSessionToken,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuredPassword = process.env.APP_PASSWORD;
  if (!configuredPassword) {
    return Response.json({ error: "APP_PASSWORD is not configured." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (body.password !== configuredPassword) {
    return Response.json({ error: "비밀번호가 맞지 않습니다." }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  const cookieParts = [
    `${AUTH_COOKIE_NAME}=${await createSessionToken(configuredPassword)}`,
    "Path=/",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isHttpsRequest(request)) {
    cookieParts.push("Secure");
  }

  response.headers.append("Set-Cookie", cookieParts.join("; "));

  return response;
}

function isHttpsRequest(request: Request) {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}
