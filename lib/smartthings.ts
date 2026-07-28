import "server-only";

import { getSmartThingsBearerToken, isSmartThingsOAuthConfigured } from "@/lib/smartthings-oauth";

export type PowerState = "on" | "off";
export type AirConditionerMode = "cool" | "wind";
export type AirConditionerFanMode = "auto" | "medium" | "high" | "turbo";

export type AirConditionerStatus = {
  power: PowerState | null;
  mode: string | null;
  fanMode: string | null;
  coolingSetpoint: number | null;
  coolingSetpointUnit: string | null;
  roomTemperature: number | null;
  roomTemperatureUnit: string | null;
  humidity: number | null;
  updatedAt: string;
};

type CapabilityState = {
  value?: unknown;
  unit?: string;
  timestamp?: string;
};

type DeviceStatusResponse = {
  components?: Record<string, Record<string, Record<string, CapabilityState>>>;
};

type DeviceCommand = {
  component: string;
  capability: string;
  command: string;
  arguments?: unknown[];
};

const DEFAULT_BASE_URL = "https://api.smartthings.com/v1";
const DEFAULT_COMPONENT = "main";
const DEFAULT_MODES: AirConditionerMode[] = ["cool", "wind"];
const DEFAULT_FAN_MODES: AirConditionerFanMode[] = ["auto", "medium", "high", "turbo"];

export class SmartThingsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartThingsConfigError";
  }
}

export class SmartThingsApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SmartThingsApiError";
    this.status = status;
  }
}

export function getTemperatureRange() {
  return {
    min: readNumber("SMARTTHINGS_TEMPERATURE_MIN", 16),
    max: readNumber("SMARTTHINGS_TEMPERATURE_MAX", 30),
    step: readNumber("SMARTTHINGS_TEMPERATURE_STEP", 1),
  };
}

export function getAllowedModes() {
  const rawModes = process.env.SMARTTHINGS_ALLOWED_MODES;
  if (!rawModes) return DEFAULT_MODES;

  return rawModes
    .split(",")
    .map((mode) => mode.trim())
    .filter(Boolean);
}

export function getAllowedFanModes() {
  const rawModes = process.env.SMARTTHINGS_ALLOWED_FAN_MODES;
  if (!rawModes) return DEFAULT_FAN_MODES;

  return rawModes
    .split(",")
    .map((mode) => mode.trim())
    .filter(Boolean);
}

export function validateMode(mode: unknown): string {
  if (typeof mode !== "string" || mode.trim().length === 0) {
    throw new SmartThingsApiError("mode must be a non-empty string.", 400);
  }

  const normalizedMode = mode.trim();
  const allowedModes = getAllowedModes();
  if (!allowedModes.includes(normalizedMode)) {
    throw new SmartThingsApiError(
      `Unsupported mode "${normalizedMode}". Allowed modes: ${allowedModes.join(", ")}.`,
      400,
    );
  }

  return normalizedMode;
}

export function validateFanMode(fanMode: unknown): string {
  if (typeof fanMode !== "string" || fanMode.trim().length === 0) {
    throw new SmartThingsApiError("fanMode must be a non-empty string.", 400);
  }

  const normalizedMode = fanMode.trim();
  const allowedModes = getAllowedFanModes();
  if (!allowedModes.includes(normalizedMode)) {
    throw new SmartThingsApiError(
      `Unsupported fanMode "${normalizedMode}". Allowed fan modes: ${allowedModes.join(", ")}.`,
      400,
    );
  }

  return normalizedMode;
}

export function validateTemperature(value: unknown): number {
  const temperature = typeof value === "number" ? value : Number(value);
  const { min, max, step } = getTemperatureRange();

  if (!Number.isFinite(temperature)) {
    throw new SmartThingsApiError("temperature must be a number.", 400);
  }

  if (temperature < min || temperature > max) {
    throw new SmartThingsApiError(`temperature must be between ${min} and ${max}.`, 400);
  }

  if (step > 0) {
    const scaled = (temperature - min) / step;
    if (Math.abs(scaled - Math.round(scaled)) > 0.000001) {
      throw new SmartThingsApiError(`temperature must align with step ${step}.`, 400);
    }
  }

  return temperature;
}

export function validatePower(value: unknown): PowerState {
  if (value !== "on" && value !== "off") {
    throw new SmartThingsApiError('power must be either "on" or "off".', 400);
  }

  return value;
}

export async function getAirConditionerStatus(): Promise<AirConditionerStatus> {
  const config = getSmartThingsConfig();
  const response = await smartThingsFetch<DeviceStatusResponse>(
    `/devices/${config.deviceId}/status`,
    {
      method: "GET",
      cache: "no-store",
    },
    config,
  );
  const component = response.components?.[config.component] ?? {};

  const power = readString(component.switch?.switch);
  const coolingSetpoint = readNumberState(
    component.thermostatCoolingSetpoint?.coolingSetpoint ??
      component[config.temperatureCapability]?.[config.temperatureAttribute],
  );
  const mode = readString(
    component.airConditionerMode?.airConditionerMode ??
      component[config.modeCapability]?.[config.modeAttribute],
  );
  const fanMode = readString(
    component.airConditionerFanMode?.fanMode ??
      component[config.fanModeCapability]?.[config.fanModeAttribute],
  );
  const roomTemperature = readNumberState(component.temperatureMeasurement?.temperature);
  const humidity = readNumberState(component.relativeHumidityMeasurement?.humidity);

  return {
    power: power === "on" || power === "off" ? power : null,
    mode,
    fanMode,
    coolingSetpoint,
    coolingSetpointUnit: readUnit(
      component.thermostatCoolingSetpoint?.coolingSetpoint ??
        component[config.temperatureCapability]?.[config.temperatureAttribute],
    ),
    roomTemperature,
    roomTemperatureUnit: readUnit(component.temperatureMeasurement?.temperature),
    humidity,
    updatedAt: new Date().toISOString(),
  };
}

export async function setPower(power: PowerState) {
  await executeCommand({
    capability: "switch",
    command: power,
  });
}

export async function setCoolingSetpoint(temperature: number) {
  const config = getSmartThingsConfig();
  await executeCommand({
    capability: config.temperatureCapability,
    command: process.env.SMARTTHINGS_TEMPERATURE_COMMAND ?? "setCoolingSetpoint",
    arguments: [temperature],
  });
}

export async function setAirConditionerMode(mode: string) {
  const config = getSmartThingsConfig();
  await executeCommand({
    capability: config.modeCapability,
    command: process.env.SMARTTHINGS_MODE_COMMAND ?? "setAirConditionerMode",
    arguments: [mode],
  });
}

export async function setAirConditionerFanMode(fanMode: string) {
  const config = getSmartThingsConfig();
  await executeCommand({
    capability: config.fanModeCapability,
    command: process.env.SMARTTHINGS_FAN_MODE_COMMAND ?? "setFanMode",
    arguments: [fanMode],
  });
}

async function executeCommand(command: Omit<DeviceCommand, "component">) {
  const config = getSmartThingsConfig();

  await smartThingsFetch(
    `/devices/${config.deviceId}/commands`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        commands: [
          {
            component: config.component,
            ...command,
          },
        ],
      }),
    },
    config,
  );
}

export function getSmartThingsConfig() {
  const token = process.env.SMARTTHINGS_TOKEN;
  const deviceId = process.env.SMARTTHINGS_DEVICE_ID;

  if (!token && !isSmartThingsOAuthConfigured()) {
    throw new SmartThingsConfigError(
      "SMARTTHINGS_TOKEN 또는 SmartThings OAuth 환경 변수가 설정되지 않았습니다.",
    );
  }

  if (!deviceId) {
    throw new SmartThingsConfigError("SMARTTHINGS_DEVICE_ID is not configured.");
  }

  return {
    token,
    deviceId,
    baseUrl: process.env.SMARTTHINGS_API_BASE_URL ?? DEFAULT_BASE_URL,
    requestTimeoutMs: readNumber("SMARTTHINGS_REQUEST_TIMEOUT_MS", 10_000),
    component: process.env.SMARTTHINGS_COMPONENT ?? DEFAULT_COMPONENT,
    modeCapability: process.env.SMARTTHINGS_MODE_CAPABILITY ?? "airConditionerMode",
    modeAttribute: process.env.SMARTTHINGS_MODE_ATTRIBUTE ?? "airConditionerMode",
    fanModeCapability: process.env.SMARTTHINGS_FAN_MODE_CAPABILITY ?? "airConditionerFanMode",
    fanModeAttribute: process.env.SMARTTHINGS_FAN_MODE_ATTRIBUTE ?? "fanMode",
    temperatureCapability:
      process.env.SMARTTHINGS_TEMPERATURE_CAPABILITY ?? "thermostatCoolingSetpoint",
    temperatureAttribute: process.env.SMARTTHINGS_TEMPERATURE_ATTRIBUTE ?? "coolingSetpoint",
  };
}

export async function smartThingsFetch<T = unknown>(
  path: string,
  init: RequestInit,
  config: ReturnType<typeof getSmartThingsConfig>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const token = await getSmartThingsBearerToken(config.token);
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SmartThingsApiError("SmartThings API request timed out.", 504);
    }

    throw new SmartThingsApiError("Failed to reach SmartThings API.", 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = await readSmartThingsError(response);
    throw new SmartThingsApiError(message, response.status);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

async function readSmartThingsError(response: Response) {
  const fallback = `SmartThings API request failed with status ${response.status}.`;

  try {
    const payload = (await response.json()) as {
      error?: { message?: string; details?: Array<{ message?: string }> };
      message?: string;
    };
    return (
      payload.error?.details?.find((detail) => detail.message)?.message ??
      payload.error?.message ??
      payload.message ??
      fallback
    );
  } catch {
    return fallback;
  }
}

function readString(state: CapabilityState | undefined): string | null {
  return typeof state?.value === "string" ? state.value : null;
}

function readNumberState(state: CapabilityState | undefined): number | null {
  return typeof state?.value === "number" ? state.value : null;
}

function readUnit(state: CapabilityState | undefined): string | null {
  return typeof state?.unit === "string" ? state.unit : null;
}

function readNumber(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  return parsed;
}
