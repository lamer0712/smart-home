export const AUTH_COOKIE_NAME = "smart_home_session";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function createSessionToken(password: string) {
  const data = new TextEncoder().encode(`smart-home-session:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function isValidSession(cookieValue: string | undefined, password: string) {
  if (!cookieValue) return false;

  return cookieValue === (await createSessionToken(password));
}

export function isValidApiKeyRequest(headers: Headers, apiKey: string | undefined) {
  if (!apiKey) return false;

  const authorization = headers.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerApiKey = headers.get("x-smart-home-api-key");
  const submittedApiKey = bearerToken ?? headerApiKey;

  return submittedApiKey === apiKey;
}
