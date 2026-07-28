"use client";

import {
  AlertCircle,
  CalendarClock,
  Loader2,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoginForm } from "./login/login-form";

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
  timer?: boolean;
  finalOffAt?: string;
  source?: "smartthings-rule";
};

type SchedulesPayload = {
  schedules: PowerSchedule[];
};

type PendingDesiredStatus = {
  patch: Partial<AcStatus>;
  expiresAt: number;
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
  const [targetFanMode, setTargetFanMode] = useState(FALLBACK_CONTROLS.fanModes[0]);
  const [scheduleOnTemperature, setScheduleOnTemperature] = useState(24);
  const [scheduleOnAt, setScheduleOnAt] = useState(() => toDatetimeLocal(30));
  const [scheduleOffAt, setScheduleOffAt] = useState(() => toDatetimeLocal(60));
  const [schedules, setSchedules] = useState<PowerSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>("status");
  const [awaitingDeviceSync, setAwaitingDeviceSync] = useState(false);
  const hasSyncedTemperature = useRef(false);
  const hasSyncedFanMode = useRef(false);
  const delayedRefreshTimers = useRef<number[]>([]);
  const climateCommandTimer = useRef<number | null>(null);
  const pendingDesiredStatus = useRef<PendingDesiredStatus | null>(null);

  const fetchStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setPendingAction("status");
    setError(null);
    if (!silent) {
      clearClimateCommandTimer();
      delayedRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
      delayedRefreshTimers.current = [];
      pendingDesiredStatus.current = null;
      setAwaitingDeviceSync(false);
    }

    try {
      const payload = await requestJson<StatusPayload>("/api/ac/status");
      setAuthRequired(false);
      const nextStatus = silent ? applyPendingDesiredStatus(payload.status) : payload.status;
      setStatus(nextStatus);
      const nextControls = payload.controls ?? controls;
      if (payload.controls) setControls(payload.controls);

      if (!hasSyncedTemperature.current || !silent) {
        const temperatureRange = nextControls.temperature;
        if (nextStatus.mode === "wind") {
          setTargetTemperature(getWindSliderValue(temperatureRange));
        } else if (typeof nextStatus.coolingSetpoint === "number") {
          setTargetTemperature(nextStatus.coolingSetpoint);
        }
        if (typeof nextStatus.coolingSetpoint === "number") {
          setScheduleOnTemperature(nextStatus.coolingSetpoint);
        }
        hasSyncedTemperature.current = true;
      }

      if ((!hasSyncedFanMode.current || !silent) && nextStatus.fanMode) {
        setTargetFanMode(nextStatus.fanMode);
        hasSyncedFanMode.current = true;
      }
    } catch (requestError) {
      handleRequestError(requestError);
    } finally {
      if (!silent) setPendingAction(null);
    }
  }, []);

  const fetchSchedules = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setPendingAction("schedules");
    setError(null);

    try {
      const payload = await requestJson<SchedulesPayload>("/api/ac/schedules");
      setAuthRequired(false);
      setSchedules(payload.schedules);
    } catch (requestError) {
      handleRequestError(requestError);
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

    return () => {
      window.clearInterval(interval);
      delayedRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
      if (climateCommandTimer.current) window.clearTimeout(climateCommandTimer.current);
    };
  }, [fetchSchedules, fetchStatus]);

  const powerOn = status?.power === "on";
  const windSliderValue = getWindSliderValue(controls.temperature);
  const targetIsWind = isWindSliderValue(targetTemperature, controls.temperature);
  const targetClimateLabel = targetIsWind ? "송풍" : `${targetTemperature}℃`;
  const roomTemperatureLabel =
    typeof status?.roomTemperature === "number"
      ? `${status.roomTemperature}${formatTemperatureUnit(status.roomTemperatureUnit)}`
      : "--";
  const targetFanModeIndex = Math.max(0, controls.fanModes.indexOf(targetFanMode));
  const targetFanModeLabel = FAN_MODE_LABELS[targetFanMode] ?? targetFanMode;
  const updatedAt = useMemo(() => {
    if (!status?.updatedAt) return "아직 동기화 전";
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(status.updatedAt));
  }, [status?.updatedAt]);
  const needsSmartThingsConnection = isSmartThingsConnectionError(error);

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
      setAuthRequired(false);
      const optimisticPatch = buildOptimisticStatusPatch(payload.status, action, body);
      if (Object.keys(optimisticPatch).length > 0) {
        pendingDesiredStatus.current = {
          patch: optimisticPatch,
          expiresAt: Date.now() + 15_000,
        };
        setAwaitingDeviceSync(true);
      }

      const optimisticStatus = applyStatusPatch(payload.status, optimisticPatch);
      setStatus(optimisticStatus);
      queueDelayedStatusRefresh();

      if (optimisticStatus.mode === "wind") {
        setTargetTemperature(getWindSliderValue(controls.temperature));
      } else if (typeof optimisticStatus.coolingSetpoint === "number") {
        setTargetTemperature(optimisticStatus.coolingSetpoint);
      }
      if (optimisticStatus.fanMode) {
        setTargetFanMode(optimisticStatus.fanMode);
      }
    } catch (requestError) {
      handleRequestError(requestError);
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
      setAuthRequired(false);
      setSchedules(payload.schedules);

      if (power === "on") {
        setScheduleOnAt(toDatetimeLocal(30));
      } else {
        setScheduleOffAt(toDatetimeLocal(60));
      }
    } catch (requestError) {
      handleRequestError(requestError);
    } finally {
      setPendingAction(null);
    }
  }

  async function togglePower() {
    clearClimateCommandTimer();
    await submitCommand("power-toggle", "/api/ac/power", { power: powerOn ? "off" : "on" });
  }

  function changeTargetTemperature(temperature: number) {
    setTargetTemperature(temperature);
    queueClimateCommand(temperature, targetFanMode);
  }

  function changeTargetFanMode(fanMode: string) {
    setTargetFanMode(fanMode);
    queueClimateCommand(targetTemperature, fanMode);
  }

  function queueClimateCommand(temperature: number, fanMode: string) {
    clearClimateCommandTimer();

    climateCommandTimer.current = window.setTimeout(() => {
      void submitCommand(
        "climate",
        "/api/ac/climate",
        buildClimateCommandBody(temperature, fanMode, controls.temperature),
      );
    }, 450);
  }

  function clearClimateCommandTimer() {
    if (!climateCommandTimer.current) return;
    window.clearTimeout(climateCommandTimer.current);
    climateCommandTimer.current = null;
  }

  function queueDelayedStatusRefresh() {
    delayedRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    delayedRefreshTimers.current = [4_000, 10_000, 16_000].map((delay) =>
      window.setTimeout(() => {
        fetchStatus({ silent: true });
      }, delay),
    );
  }

  function applyPendingDesiredStatus(nextStatus: AcStatus) {
    const pending = pendingDesiredStatus.current;
    if (!pending) return nextStatus;

    if (Date.now() > pending.expiresAt) {
      pendingDesiredStatus.current = null;
      setAwaitingDeviceSync(false);
      return nextStatus;
    }

    if (statusMatchesPatch(nextStatus, pending.patch)) {
      pendingDesiredStatus.current = null;
      setAwaitingDeviceSync(false);
      return nextStatus;
    }

    return applyStatusPatch(nextStatus, pending.patch);
  }

  async function cancelSchedule(id: string) {
    const action = `cancel-${id}`;
    setPendingAction(action);
    setError(null);

    try {
      const payload = await requestJson<SchedulesPayload>(`/api/ac/schedules/${id}`, {
        method: "DELETE",
      });
      setAuthRequired(false);
      setSchedules(payload.schedules);
    } catch (requestError) {
      handleRequestError(requestError);
    } finally {
      setPendingAction(null);
    }
  }

  function handleRequestError(requestError: unknown) {
    if (requestError instanceof AuthRequiredError) {
      clearClimateCommandTimer();
      delayedRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
      delayedRefreshTimers.current = [];
      pendingDesiredStatus.current = null;
      setAwaitingDeviceSync(false);
      setAuthRequired(true);
      setError(null);
      return;
    }

    setError(toErrorMessage(requestError));
  }

  function handleLoginSuccess() {
    setAuthRequired(false);
    void fetchStatus();
    void fetchSchedules({ silent: true });
  }

  const pendingSchedules = schedules
    .filter((schedule) => schedule.status === "pending")
    .sort((left, right) => new Date(left.runAt).getTime() - new Date(right.runAt).getTime());
  const recentSchedules = schedules
    .filter((schedule) => schedule.status !== "pending")
    .sort((left, right) => new Date(right.runAt).getTime() - new Date(left.runAt).getTime())
    .slice(0, 3);

  if (authRequired) {
    return <LoginForm passwordConfigured onSuccess={handleLoginSuccess} />;
  }

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
            className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
            {needsSmartThingsConnection ? (
              <a
                href="/api/smartthings/connect"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-red-700 px-4 text-sm font-bold text-white transition hover:bg-red-800"
              >
                SmartThings 연결
              </a>
            ) : null}
          </div>
        ) : null}

        <section>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-500">상태</p>
                <h2 className="mt-1 text-4xl font-bold text-slate-950">
                  {roomTemperatureLabel}
                </h2>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-right text-xs font-semibold text-slate-500">
                  동기화 {updatedAt}
                  {awaitingDeviceSync ? " · 반영 중" : ""}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={powerOn}
                  aria-label="전원"
                  onClick={togglePower}
                  disabled={pendingAction !== null}
                  className={`inline-flex h-9 w-16 items-center rounded-full p-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    powerOn ? "bg-sky-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm transition ${
                      powerOn ? "translate-x-7 text-sky-700" : "translate-x-0 text-slate-500"
                    }`}
                  >
                    {pendingAction === "power-toggle" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Power className="h-4 w-4" />
                    )}
                  </span>
                </button>
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-slate-800">희망온도</span>
                <span className="text-lg font-bold text-slate-950">{targetClimateLabel}</span>
              </div>
              <input
                type="range"
                min={controls.temperature.min}
                max={windSliderValue}
                step={controls.temperature.step}
                value={targetTemperature}
                onChange={(event) => changeTargetTemperature(Number(event.target.value))}
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

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-slate-800">바람세기</span>
                <span className="text-lg font-bold text-slate-950">{targetFanModeLabel}</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, controls.fanModes.length - 1)}
                step={1}
                value={targetFanModeIndex}
                onChange={(event) => {
                  const nextFanMode = controls.fanModes[Number(event.target.value)];
                  if (nextFanMode) changeTargetFanMode(nextFanMode);
                }}
                disabled={pendingAction !== null}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="바람세기"
              />
              <div className="mt-2 flex justify-between text-xs font-semibold text-slate-500">
                {controls.fanModes.map((fanMode) => (
                  <span key={fanMode}>{FAN_MODE_LABELS[fanMode] ?? fanMode}</span>
                ))}
              </div>
            </div>

            {pendingAction === "climate" ? (
              <div className="mt-6 inline-flex h-10 items-center gap-2 text-sm font-bold text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                전송 중
              </div>
            ) : null}
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
              <p className="text-sm font-bold text-slate-800">대기 중인 예약 / 타이머</p>
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
                새로고침
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
                대기 중인 예약이나 타이머가 없습니다.
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
                        {formatScheduleTitle(schedule)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {formatScheduleDetail(schedule)} ·{" "}
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
          예약 시간에 전원을 끕니다.
        </p>
      )}
      <div className="mt-3 min-w-0 overflow-hidden rounded-md">
        <input
          id={`schedule-${power}`}
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="schedule-datetime-input block h-11 w-full max-w-full min-w-0 appearance-none rounded-md border border-slate-300 bg-white px-3 py-0 text-base font-semibold leading-none text-slate-900 shadow-sm outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
        />
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
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        className={`mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
          power === "on"
            ? "bg-sky-600 text-white hover:bg-sky-700"
            : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
        }`}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
        예약
      </button>
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
          {formatScheduleTitle(schedule)}
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          {formatScheduleDetail(schedule)}
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

  if (response.status === 401 && response.headers.get("X-Smart-Home-Auth") === "required") {
    throw new AuthRequiredError();
  }

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}.`);
  }

  return payload as T;
}

class AuthRequiredError extends Error {
  constructor() {
    super("로그인이 필요합니다.");
    this.name = "AuthRequiredError";
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}

function isSmartThingsConnectionError(error: string | null) {
  return Boolean(
    error?.includes("SmartThings OAuth 연결") ||
      error?.includes("UPSTASH_REDIS_REST_URL") ||
      error?.includes("UPSTASH_REDIS_REST_TOKEN") ||
      error?.includes("KV_REST_API_URL") ||
      error?.includes("KV_REST_API_TOKEN"),
  );
}

function buildOptimisticStatusPatch(
  currentStatus: AcStatus,
  action: string,
  body: Record<string, unknown>,
): Partial<AcStatus> {
  const patch: Partial<AcStatus> = {};

  if (body.power === "on") {
    patch.power = "on";
  }

  if (body.power === "off") {
    patch.power = "off";
  }

  if (typeof body.fanMode === "string") {
    patch.fanMode = body.fanMode;
  }

  if (typeof body.mode === "string") {
    patch.mode = body.mode;
  }

  const temperature = Number(body.temperature);
  if (
    (action === "temperature" || body.mode === "cool") &&
    Number.isFinite(temperature)
  ) {
    patch.mode = body.mode === "cool" ? "cool" : patch.mode;
    patch.coolingSetpoint = temperature;
    patch.coolingSetpointUnit = currentStatus.coolingSetpointUnit ?? "C";
  }

  return patch;
}

function buildClimateCommandBody(
  temperature: number,
  fanMode: string,
  temperatureRange: Controls["temperature"],
) {
  if (isWindSliderValue(temperature, temperatureRange)) {
    return {
      mode: "wind",
      fanMode,
    };
  }

  return {
    mode: "cool",
    temperature,
    fanMode,
  };
}

function applyStatusPatch(status: AcStatus, patch: Partial<AcStatus>) {
  return {
    ...status,
    ...patch,
  };
}

function statusMatchesPatch(status: AcStatus, patch: Partial<AcStatus>) {
  return (Object.entries(patch) as Array<[keyof AcStatus, AcStatus[keyof AcStatus]]>).every(
    ([key, value]) => status[key] === value,
  );
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

function formatScheduleTitle(schedule: PowerSchedule) {
  if (schedule.power === "on") return "켜짐 예약";
  if (schedule.timer) return "꺼짐 타이머";
  return "꺼짐 예약";
}

function formatScheduleDetail(schedule: PowerSchedule) {
  if (schedule.power === "off") {
    const offAt = schedule.finalOffAt ?? schedule.runAt;
    if (schedule.timer) {
      return `전원 꺼짐 ${formatDateTime(offAt)}`;
    }

    if (schedule.windDown) {
      return `송풍 시작 ${formatDateTime(schedule.runAt)} · 전원 꺼짐 ${formatDateTime(offAt)}`;
    }

    return `전원 꺼짐 ${formatDateTime(schedule.runAt)}`;
  }
  if (schedule.mode !== "cool") return `전원 켜짐 ${formatDateTime(schedule.runAt)}`;

  const temperature =
    typeof schedule.coolingSetpoint === "number" ? `${schedule.coolingSetpoint}℃` : "온도 미확인";
  return `${formatDateTime(schedule.runAt)} · 냉방 · ${temperature}`;
}
