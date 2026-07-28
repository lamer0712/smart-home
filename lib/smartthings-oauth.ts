import "server-only";

import { Redis } from "@upstash/redis";

type SmartThingsOAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

type StoredSmartThingsTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  updatedAt: string;
};

type SmartThingsOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
};

const TOKEN_STORAGE_KEY = "smart-home:smartthings:oauth-tokens";
const DEFAULT_AUTHORIZE_URL = "https://api.smartthings.com/oauth/authorize";
const DEFAULT_TOKEN_URL = "https://api.smartthings.com/oauth/token";
const DEFAULT_SCOPES = ["r:devices:*", "x:devices:*", "r:rules:*", "w:rules:*"];
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60_000;

export const SMARTTHINGS_OAUTH_STATE_COOKIE = "smartthings_oauth_state";

export class SmartThingsOAuthError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "SmartThingsOAuthError";
    this.status = status;
  }
}

export function isSmartThingsOAuthConfigured() {
  return Boolean(
    process.env.SMARTTHINGS_CLIENT_ID &&
      process.env.SMARTTHINGS_CLIENT_SECRET &&
      process.env.SMARTTHINGS_REDIRECT_URI,
  );
}

export function buildSmartThingsAuthorizationUrl(state: string) {
  const config = getSmartThingsOAuthConfig();
  const url = new URL(config.authorizeUrl);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);

  return url;
}

export async function exchangeSmartThingsCode(code: string) {
  const config = getSmartThingsOAuthConfig();
  const tokens = await requestSmartThingsTokens(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
  });

  await saveStoredTokens(tokens);
  return tokens;
}

export async function getSmartThingsBearerToken(fallbackToken?: string) {
  if (!isSmartThingsOAuthConfigured()) {
    if (fallbackToken) return fallbackToken;
    throw new SmartThingsOAuthError(
      "SMARTTHINGS_TOKEN 또는 SmartThings OAuth 환경 변수가 설정되지 않았습니다.",
    );
  }

  const storedTokens = await getStoredTokens();
  if (!storedTokens) {
    throw new SmartThingsOAuthError(
      "SmartThings OAuth 연결이 필요합니다. SmartThings 연결 버튼을 눌러 계정을 승인해 주세요.",
      401,
    );
  }

  if (storedTokens.expiresAt > Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS) {
    return storedTokens.accessToken;
  }

  const refreshedTokens = await refreshSmartThingsTokens(storedTokens.refreshToken);
  await saveStoredTokens(refreshedTokens);
  return refreshedTokens.accessToken;
}

async function refreshSmartThingsTokens(refreshToken: string) {
  const config = getSmartThingsOAuthConfig();

  return requestSmartThingsTokens(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  });
}

function getSmartThingsOAuthConfig(): SmartThingsOAuthConfig {
  const clientId = process.env.SMARTTHINGS_CLIENT_ID;
  const clientSecret = process.env.SMARTTHINGS_CLIENT_SECRET;
  const redirectUri = process.env.SMARTTHINGS_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new SmartThingsOAuthError(
      "SMARTTHINGS_CLIENT_ID, SMARTTHINGS_CLIENT_SECRET, SMARTTHINGS_REDIRECT_URI가 필요합니다.",
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizeUrl: process.env.SMARTTHINGS_AUTHORIZATION_URL ?? DEFAULT_AUTHORIZE_URL,
    tokenUrl: process.env.SMARTTHINGS_TOKEN_URL ?? DEFAULT_TOKEN_URL,
    scopes: readScopes(),
  };
}

function readScopes() {
  const rawScopes = process.env.SMARTTHINGS_OAUTH_SCOPES;
  if (!rawScopes) return DEFAULT_SCOPES;

  return rawScopes
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function requestSmartThingsTokens(
  config: SmartThingsOAuthConfig,
  fields: Record<string, string>,
) {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(fields),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as SmartThingsOAuthTokenResponse & {
    error?: string;
    error_description?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new SmartThingsOAuthError(
      payload.error_description ??
        payload.message ??
        payload.error ??
        `SmartThings OAuth token request failed with status ${response.status}.`,
      response.status,
    );
  }

  if (!payload.access_token || !payload.refresh_token || !payload.expires_in) {
    throw new SmartThingsOAuthError("SmartThings OAuth token response is incomplete.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    scope: payload.scope,
    updatedAt: new Date().toISOString(),
  };
}

async function getStoredTokens() {
  const redis = getRedis();
  return redis.get<StoredSmartThingsTokens>(TOKEN_STORAGE_KEY);
}

async function saveStoredTokens(tokens: StoredSmartThingsTokens) {
  const redis = getRedis();
  await redis.set(TOKEN_STORAGE_KEY, tokens);
}

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new SmartThingsOAuthError(
      "UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN 또는 KV_REST_API_URL/KV_REST_API_TOKEN이 필요합니다. Vercel에 Upstash Redis를 연결해 주세요.",
    );
  }

  return new Redis({ url, token });
}
