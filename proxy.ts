import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, createSessionToken } from "@/lib/auth";

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/smartthings/callback",
  "/_next",
  "/favicon.ico",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const password = process.env.APP_PASSWORD;
  if (!password) {
    return deny(request, "APP_PASSWORD is not configured.");
  }

  const expectedSession = await createSessionToken(password);
  const session = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (session === expectedSession) {
    return NextResponse.next();
  }

  return deny(request, "Login required.");
}

function deny(request: NextRequest, message: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: message },
      {
        status: 401,
        headers: {
          "X-Smart-Home-Auth": "required",
        },
      },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
