"use client";

import {
  AlertCircle,
  CalendarClock,
  Droplets,
  Fan,
  Loader2,
  Power,
  RefreshCw,
  Snowflake,
  Thermometer,
  Trash2,
  Wind,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PowerState = "on" | "off";

type AcStatus = {
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

type Controls = {
  temperature: {
    min: number;
    max: number;
    step: number;
  };
  modes: string[];
  fanModes: string[];
};

type StatusPayload = {
  status: AcStatus;
  controls?: Controls;
};

type PowerScheduleStatus = "pending" | "executed" | "failed" | "cancelled";

type PowerSchedule = {
  id: string;
  power: PowerState;
  runAt: string;
  createdAt: string;
  status: PowerScheduleStatus;
  executedAt?: string;
  cancelledAt?: string;
  error?: string;
  mode?: "cool";
  coolingSetpoint?: number;
  windDown?: boolean;
  finalOffAt?: string;
  source?: "smartthings-rule";
};

type SchedulesPayload = {
  schedules: PowerSchedule[];
};

const FALLBACK_CONTROLS: Controls = {
  temperature: {
    min: 16,
    max: 30,
    step: 1,
  },
  modes: ["cool", "wind"],
  fanModes: ["auto", "medium", "high", "turbo"],
};

const MODE_LABELS: Record<string, string> = {
  cool: "냉방",
  wind: "송풍",
};

const FAN_MODE_LABELS: Record<string, string> = {
  auto: "자동",
  medium: "중간",
  high: "강함",
  turbo: "터보",
};

const CLIENT_REQUEST_TIMEOUT_MS = 12_000;

export function AirConditionerDashboard() {
  const [status, setStatus] = useState<AcStatus | null>(null);
  const [controls, setControls] = useState<Controls>(FALLBACK_CONTROLS);
  const [targetTemperature, setTargetTemperature] = useState(24);
  const [scheduleOnTemperature, setScheduleOnTemperature] = useState(24);
  const [scheduleOnAt, setScheduleOnAt] = useState(() => toDatetimeLocal(30));
  const [scheduleOffAt, setScheduleOffAt] = useState(() => toDatetimeLocal(60));
  const [schedules, setSchedules] = useState<PowerSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>("status");
  const hasSyncedTemperature = useRef(false);

  const fetchStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setPendingAction("status");
    setError(null);

    try {
      const payload = await requestJson<StatusPayload>("/api/ac/status");
      setStatus(payload.status);
      if (payload.controls) setControls(payload.controls);

      if (!hasSyncedTemperature.current) {
        const temperatureRange = payload.controls?.temperature ?? FALLBACK_CONTROLS.temperature;
        if (payload.status.mode === "wind") {
          setTargetTemperature(getWindSliderValue(temperatureRange));
        } else if (typeof payload.status.coolingSetpoint === "number") {
          setTargetTemperature(payload.status.coolingSetpoint);
        }
        if (typeof payload.status.coolingSetpoint === "number") {
          setScheduleOnTemperature(payload.status.coolingSetpoint);
        }
        hasSyncedTemperature.current = true;
      }
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      if (!silent) setPendingAction(null);
    }
  }, []);

  const fetchSchedules = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setPendingAction("schedules");
    setError(null);

    try {
      const payload = await requestJson<SchedulesPayload>("/api/ac/schedules");
      setSchedules(payload.schedules);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      if (!silent) setPendingAction(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchSchedules({ silent: true });
    const interval = window.setInterval(() => {
      fetchStatus({ silent: true });
      fetchSchedules({ silent: true });
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [fetchSchedules, fetchStatus]);

  const powerOn = status?.power === "on";
  const windSliderValue = getWindSliderValue(controls.temperature);
  const targetIsWind = isWindSliderValue(targetTemperature, controls.temperature);
  const targetClimateLabel = targetIsWind ? "송풍" : `${targetTemperature}℃`;
  const updatedAt = useMemo(() => {
    if (!status?.updatedAt) return "아직 동기화 전";
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(status.updatedAt));
  }, [status?.updatedAt]);

  async function submitCommand<TBody extends Record<string, unknown>>(
    action: string,
    url: string,
    body: TBody,
  ) {
    setPendingAction(action);
    setError(null);

    try {
      const payload = await requestJson<{ status: AcStatus }>(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      setStatus(payload.status);
      if (payload.status.mode === "wind") {
        setTargetTemperature(getWindSliderValue(controls.temperature));
      } else if (typeof payload.status.coolingSetpoint === "number") {
        setTargetTemperature(payload.status.coolingSetpoint);
      }
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setPendingAction(null);
    }
  }

  async function createSchedule(
    power: PowerState,
    localRunAt: string,
    coolingSetpoint?: number,
  ) {
    const action = `schedule-${power}`;
    setPendingAction(action);
    setError(null);

    try {
      const payload = await requestJson<SchedulesPayload>("/api/ac/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          power,
          runAt: new Date(localRunAt).toISOString(),
          ...(power === "on" ? { coolingSetpoint } : {}),
        }),
      });
      setSchedules(payload.schedules);

      if (power === "on") {
        setScheduleOnAt(toDatetimeLocal(30));
      } else {
        setScheduleOffAt(toDatetimeLocal(60));
      }
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setPendingAction(null);
    }
  }

  async function applyClimateSelection() {
    if (targetIsWind) {
      await submitCommand("climate", "/api/ac/climate", { mode: "wind" });
      return;
    }

    await submitCommand("climate", "/api/ac/climate", {
      mode: "cool",
      temperature: targetTemperature,
    });
  }

  async function cancelSchedule(id: string) {
    const action = `cancel-${id}`;
    setPendingAction(action);
    setError(null);

    try {
      const payload = await requestJson<SchedulesPayload>(`/api/ac/schedules/${id}`, {
        method: "DELETE",
      });
      setSchedules(payload.schedules);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setPendingAction(null);
    }
  }

  const pendingSchedules = schedules
    .filter((schedule) => schedule.status === "pending")
    .sort((left, right) => new Date(left.runAt).getTime() - new Date(right.runAt).getTime());
  const recentSchedules = schedules
    .filter((schedule) => schedule.status !== "pending")
    .sort((left, right) => new Date(right.runAt).getTime() - new Date(left.runAt).getTime())
    .slice(0, 3);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-sky-700">Samsung SmartThings</p>
            <h1 className="mt-1 text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
              에어컨 대시보드
            </h1>
          </div>
          <button
            type="button"
            onClick={() => fetchStatus()}
            disabled={pendingAction !== null}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingAction === "status" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            새로고침
          </button>
        </header>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-500">현재 상태</p>
                  <p className="mt-2 text-5xl font-bold tracking-normal text-slate-950">
                    {powerOn ? "ON" : status?.power === "off" ? "OFF" : "--"}
                  </p>
                </div>
                <div className="shrink-0 pt-1 text-right text-xs font-semibold text-slate-500">
                  <span className="block whitespace-nowrap">동기화 {updatedAt}</span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => submitCommand("power-on", "/api/ac/power", { power: "on" })}
                  disabled={pendingAction !== null}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingAction === "power-on" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                  켜기
                </button>
                <button
                  type="button"
                  onClick={() => submitCommand("power-off", "/api/ac/power", { power: "off" })}
                  disabled={pendingAction !== null}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingAction === "power-off" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                송풍 후 끄기
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-slate-200 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <StatusMetric
                icon={Thermometer}
                label="실내 온도"
                value={formatNumber(status?.roomTemperature)}
                unit={formatTemperatureUnit(status?.roomTemperatureUnit)}
              />
              <StatusMetric
                icon={Droplets}
                label="습도"
                value={formatNumber(status?.humidity)}
                unit="%"
              />
              <StatusMetric
                icon={Snowflake}
                label="희망 온도"
                value={formatNumber(status?.coolingSetpoint)}
                unit={formatTemperatureUnit(status?.coolingSetpointUnit)}
              />
              <StatusMetric
                icon={Fan}
                label="바람세기"
                value={status?.fanMode ? (FAN_MODE_LABELS[status.fanMode] ?? status.fanMode) : "--"}
                unit=""
              />
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-500">바람세기</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">
                  {status?.fanMode
                    ? (FAN_MODE_LABELS[status.fanMode] ?? status.fanMode)
                    : "--"}
                </h2>
              </div>
              <Fan className="h-7 w-7 text-sky-700" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              {controls.fanModes.map((fanMode) => {
                const selected = status?.fanMode === fanMode;
                const action = `fan-${fanMode}`;

                return (
                  <button
                    key={fanMode}
                    type="button"
                    onClick={() => submitCommand(action, "/api/ac/fan-mode", { fanMode })}
                    disabled={pendingAction !== null}
                    className={`inline-flex h-12 items-center justify-center gap-2 rounded-md border px-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected
                        ? "border-sky-600 bg-sky-50 text-sky-800"
                        : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                    }`}
                    aria-pressed={selected}
                  >
                    {pendingAction === action ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Fan className="h-4 w-4" />
                    )}
                    {FAN_MODE_LABELS[fanMode] ?? fanMode}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-500">냉방 / 송풍 설정</p>
                <h2 className="mt-1 text-4xl font-bold text-slate-950">
                  {targetClimateLabel}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  현재 {status?.mode ? (MODE_LABELS[status.mode] ?? status.mode) : "--"}
                </p>
              </div>
              {targetIsWind ? (
                <Wind className="h-8 w-8 text-sky-700" />
              ) : (
                <Thermometer className="h-8 w-8 text-sky-700" />
              )}
            </div>

            <div className="mt-6">
              <input
                type="range"
                min={controls.temperature.min}
                max={windSliderValue}
                step={controls.temperature.step}
                value={targetTemperature}
                onChange={(event) => setTargetTemperature(Number(event.target.value))}
                disabled={pendingAction !== null}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="희망 온도"
              />
              <div className="mt-2 flex justify-between text-xs font-semibold text-slate-500">
                <span>{controls.temperature.min}℃</span>
                <span>{controls.temperature.max}℃</span>
                <span>송풍</span>
              </div>
            </div>

            <button
              type="button"
              onClick={applyClimateSelection}
              disabled={pendingAction !== null}
              className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendingAction === "climate" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : targetIsWind ? (
                <Wind className="h-4 w-4" />
              ) : (
                <Thermometer className="h-4 w-4" />
              )}
              {targetIsWind ? "송풍 적용" : "냉방 적용"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-500">전원 예약</p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">켜짐 / 꺼짐 예약</h2>
            </div>
            <CalendarClock className="h-7 w-7 text-sky-700" />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <ScheduleForm
              power="on"
              label="켜짐 예약"
              value={scheduleOnAt}
              onChange={setScheduleOnAt}
              onSubmit={() => createSchedule("on", scheduleOnAt, scheduleOnTemperature)}
              loading={pendingAction === "schedule-on"}
              disabled={pendingAction !== null}
              temperature={scheduleOnTemperature}
              temperatureRange={controls.temperature}
              onTemperatureChange={setScheduleOnTemperature}
            />
            <ScheduleForm
              power="off"
              label="꺼짐 예약"
              value={scheduleOffAt}
              onChange={setScheduleOffAt}
              onSubmit={() => createSchedule("off", scheduleOffAt)}
              loading={pendingAction === "schedule-off"}
              disabled={pendingAction !== null}
            />
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-800">대기 중인 예약</p>
              <button
                type="button"
                onClick={() => fetchSchedules()}
                disabled={pendingAction !== null}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === "schedules" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                예약 새로고침
              </button>
            </div>

            {pendingSchedules.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {pendingSchedules.map((schedule) => (
                  <ScheduleRow
                    key={schedule.id}
                    schedule={schedule}
                    pendingAction={pendingAction}
                    onCancel={() => cancelSchedule(schedule.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-md bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
                대기 중인 예약이 없습니다.
              </p>
            )}
          </div>

          {recentSchedules.length > 0 ? (
            <div className="mt-5">
              <p className="text-sm font-bold text-slate-800">최근 처리</p>
              <div className="mt-3 grid gap-2">
                {recentSchedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        {schedule.power === "on" ? "켜짐" : "꺼짐"} 예약
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {formatDateTime(schedule.runAt)} · {formatScheduleSummary(schedule)} ·{" "}
                        {formatScheduleStatus(schedule)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function ScheduleForm({
  power,
  label,
  value,
  onChange,
  onSubmit,
  loading,
  disabled,
  temperature,
  temperatureRange,
  onTemperatureChange,
}: {
  power: PowerState;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  disabled: boolean;
  temperature?: number;
  temperatureRange?: Controls["temperature"];
  onTemperatureChange?: (value: number) => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <label className="text-sm font-bold text-slate-800" htmlFor={`schedule-${power}`}>
        {label}
      </label>
      {power === "on" ? (
        <p className="mt-1 text-xs font-semibold text-slate-500">
          냉방 모드로 켜고 선택한 희망 온도를 적용합니다.
        </p>
      ) : (
        <p className="mt-1 text-xs font-semibold text-slate-500">
          예약 시간부터 송풍으로 1시간 운전한 뒤 전원을 끕니다.
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          id={`schedule-${power}`}
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-11 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            power === "on"
              ? "bg-sky-600 text-white hover:bg-sky-700"
              : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
          }`}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
          예약
        </button>
      </div>
      {power === "on" && temperatureRange && typeof temperature === "number" && onTemperatureChange ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-800">희망 온도</span>
            <span className="text-lg font-bold text-slate-950">{temperature}℃</span>
          </div>
          <input
            type="range"
            min={temperatureRange.min}
            max={temperatureRange.max}
            step={temperatureRange.step}
            value={temperature}
            onChange={(event) => onTemperatureChange(Number(event.target.value))}
            disabled={disabled}
            className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="켜짐 예약 희망 온도"
          />
          <div className="mt-2 flex justify-between text-xs font-semibold text-slate-500">
            <span>{temperatureRange.min}℃</span>
            <span>냉방 고정</span>
            <span>{temperatureRange.max}℃</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleRow({
  schedule,
  pendingAction,
  onCancel,
}: {
  schedule: PowerSchedule;
  pendingAction: string | null;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3">
      <div>
        <p className="text-sm font-bold text-slate-950">
          {schedule.power === "on" ? "켜짐" : "꺼짐"} 예약
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          {formatDateTime(schedule.runAt)} · {formatScheduleSummary(schedule)}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={pendingAction !== null}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label="예약 취소"
      >
        {pendingAction === `cancel-${schedule.id}` ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function StatusMetric({
  icon: Icon,
  label,
  value,
  unit,
  compact = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit: string;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0">
      <Icon className="h-5 w-5 text-sky-700" />
      <p className="mt-3 text-sm font-semibold text-slate-500">{label}</p>
      <p
        className={`mt-1 font-bold tracking-normal text-slate-950 ${
          compact ? "text-lg" : "text-2xl"
        }`}
      >
        {value}
        {unit ? <span className="ml-1 text-base text-slate-500">{unit}</span> : null}
      </p>
    </div>
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CLIENT_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("요청 시간이 초과되었습니다. 서버가 실행 중인지 확인해 주세요.");
    }

    throw new Error("서버에 연결할 수 없습니다. Tailscale 주소와 서버 실행 상태를 확인해 주세요.");
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  if (response.status === 401) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
    throw new Error("로그인이 필요합니다.");
  }

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}.`);
  }

  return payload as T;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? String(value) : "--";
}

function formatTemperatureUnit(unit: string | null | undefined) {
  return unit === "C" || !unit ? "℃" : unit;
}

function getWindSliderValue(temperatureRange: Controls["temperature"]) {
  return temperatureRange.max + temperatureRange.step;
}

function isWindSliderValue(value: number, temperatureRange: Controls["temperature"]) {
  return value > temperatureRange.max;
}

function toDatetimeLocal(offsetMinutes: number) {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  date.setSeconds(0, 0);

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatScheduleStatus(schedule: PowerSchedule) {
  if (schedule.status === "executed") return "실행 완료";
  if (schedule.status === "failed") return schedule.error ? `실패: ${schedule.error}` : "실패";
  if (schedule.status === "cancelled") return "취소됨";
  return "대기 중";
}

function formatScheduleSummary(schedule: PowerSchedule) {
  if (schedule.power === "off") {
    if (schedule.windDown && schedule.finalOffAt) {
      return `송풍 1시간 후 끄기 (${formatDateTime(schedule.finalOffAt)})`;
    }

    return "송풍 1시간 후 끄기";
  }
  if (schedule.mode !== "cool") return "전원 켜기";

  const temperature =
    typeof schedule.coolingSetpoint === "number" ? `${schedule.coolingSetpoint}℃` : "온도 미확인";
  return `냉방 · ${temperature}`;
}
