import { AUTH_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = Response.json({ ok: true });
  const cookieParts = [`${AUTH_COOKIE_NAME}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
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
