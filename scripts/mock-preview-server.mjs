import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const NEXT_HOST = "127.0.0.1";
const NEXT_PORT = 3100;
const PROXY_HOST = "0.0.0.0";
const PROXY_PORT = 3000;
const PREVIEW_PASSWORD = "preview_password";
const PREVIEW_API_KEY = "preview_key";

const sessionCookie = createHash("sha256")
  .update(`smart-home-session:${PREVIEW_PASSWORD}`)
  .digest("hex");

const mockState = {
  power: "on",
  mode: "cool",
  fanMode: "auto",
  coolingSetpoint: 26,
  coolingSetpointUnit: "C",
  roomTemperature: 25,
  roomTemperatureUnit: "C",
  humidity: 48,
};
const schedules = [];
let nextProcess;
let proxyServer;

async function main() {
  await runCommand("npm", ["run", "build"]);
  nextProcess = spawn("npm", ["run", "start", "--", "--hostname", NEXT_HOST, "--port", String(NEXT_PORT)], {
    env: {
      ...process.env,
      APP_PASSWORD: PREVIEW_PASSWORD,
      SMART_HOME_API_KEY: PREVIEW_API_KEY,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  await waitForHttp(`http://${NEXT_HOST}:${NEXT_PORT}`, 15_000);
  proxyServer = createProxyServer();

  await new Promise((resolve, reject) => {
    proxyServer.once("error", reject);
    proxyServer.listen(PROXY_PORT, PROXY_HOST, resolve);
  });

  console.log("");
  console.log(`Mock preview: http://127.0.0.1:${PROXY_PORT}`);
  console.log("Network preview: http://100.68.200.22:3000 or http://192.168.0.37:3000");
  console.log("Login is bypassed. All /api/ac/* requests are mocked.");
}

function createProxyServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${PROXY_PORT}`);

    if (url.pathname === "/login") {
      response.writeHead(302, { Location: "/" });
      response.end();
      return;
    }

    if (url.pathname.startsWith("/api/ac/")) {
      await handleMockApi(request, response, url);
      return;
    }

    proxyRequest(request, response);
  });

  server.on("upgrade", (request, socket, head) => {
    const upstream = net.connect(NEXT_PORT, NEXT_HOST, () => {
      upstream.write(`GET ${request.url} HTTP/1.1\r\n`);
      for (const [key, value] of Object.entries(request.headers)) {
        if (key.toLowerCase() === "cookie") continue;
        upstream.write(`${key}: ${value}\r\n`);
      }
      upstream.write(`cookie: ${sessionCookieHeader()}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
  });

  return server;
}

async function handleMockApi(request, response, url) {
  if (url.pathname === "/api/ac/status" && request.method === "GET") {
    sendJson(response, 200, statusPayload());
    return;
  }

  if (url.pathname === "/api/ac/power" && request.method === "POST") {
    const body = await readBody(request);
    mockState.power = body.power === "off" ? "off" : "on";
    if (mockState.power === "off") mockState.mode = "wind";
    sendJson(response, 200, { status: currentStatus() });
    return;
  }

  if (url.pathname === "/api/ac/climate" && request.method === "POST") {
    const body = await readBody(request);
    if (typeof body.mode === "string") mockState.mode = body.mode;
    if (typeof body.temperature === "number") mockState.coolingSetpoint = body.temperature;
    if (typeof body.fanMode === "string") mockState.fanMode = body.fanMode;
    mockState.power = "on";
    sendJson(response, 200, { status: currentStatus() });
    return;
  }

  if (url.pathname === "/api/ac/fan-mode" && request.method === "POST") {
    const body = await readBody(request);
    if (typeof body.fanMode === "string") mockState.fanMode = body.fanMode;
    sendJson(response, 200, { status: currentStatus() });
    return;
  }

  if (url.pathname === "/api/ac/temperature" && request.method === "POST") {
    const body = await readBody(request);
    if (typeof body.temperature === "number") mockState.coolingSetpoint = body.temperature;
    sendJson(response, 200, { status: currentStatus() });
    return;
  }

  if (url.pathname === "/api/ac/mode" && request.method === "POST") {
    const body = await readBody(request);
    if (typeof body.mode === "string") mockState.mode = body.mode;
    sendJson(response, 200, { status: currentStatus() });
    return;
  }

  if (url.pathname === "/api/ac/schedules" && request.method === "GET") {
    sendJson(response, 200, { schedules });
    return;
  }

  if (url.pathname === "/api/ac/schedules" && request.method === "POST") {
    const body = await readBody(request);
    const schedule = {
      id: `mock-${Date.now()}`,
      power: body.power ?? "on",
      runAt: body.runAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      status: "pending",
      mode: "cool",
      coolingSetpoint: body.coolingSetpoint ?? 26,
      source: "smartthings-rule",
    };
    schedules.push(schedule);
    sendJson(response, 201, { schedule, schedules });
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/ac\/schedules\/([^/]+)$/);
  if (cancelMatch && request.method === "DELETE") {
    const index = schedules.findIndex((schedule) => schedule.id === cancelMatch[1]);
    const schedule = index >= 0 ? schedules.splice(index, 1)[0] : null;
    if (!schedule) {
      sendJson(response, 404, { error: "Schedule not found." });
      return;
    }
    sendJson(response, 200, { schedule, schedules });
    return;
  }

  sendJson(response, 404, { error: "Mock endpoint not found." });
}

function proxyRequest(request, response) {
  const cookie = request.headers.cookie
    ? `${request.headers.cookie}; ${sessionCookieHeader()}`
    : sessionCookieHeader();
  const proxy = http.request(
    {
      hostname: NEXT_HOST,
      port: NEXT_PORT,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: `${NEXT_HOST}:${NEXT_PORT}`,
        cookie,
      },
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 500, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );

  proxy.on("error", (error) => {
    sendJson(response, 502, { error: error.message });
  });
  request.pipe(proxy);
}

function statusPayload() {
  return {
    status: currentStatus(),
    controls: {
      temperature: { min: 16, max: 30, step: 1 },
      modes: ["cool", "wind"],
      fanModes: ["auto", "medium", "high", "turbo"],
    },
  };
}

function currentStatus() {
  return {
    ...mockState,
    updatedAt: new Date().toISOString(),
  };
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sessionCookieHeader() {
  return `smart_home_session=${sessionCookie}`;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function canConnect(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function shutdown() {
  proxyServer?.close();
  nextProcess?.kill("SIGINT");
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

main().catch((error) => {
  console.error(error);
  shutdown();
  process.exit(1);
});
