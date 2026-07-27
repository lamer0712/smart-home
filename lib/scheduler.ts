import "server-only";

import {
  SmartThingsApiError,
  getSmartThingsConfig,
  getTemperatureRange,
  setAirConditionerMode,
  smartThingsFetch,
  validatePower,
  validateTemperature,
  type PowerState,
} from "@/lib/smartthings";

export type PowerScheduleStatus = "pending" | "executed";

export type PowerSchedule = {
  id: string;
  power: PowerState;
  runAt: string;
  createdAt: string;
  status: PowerScheduleStatus;
  executedAt?: string;
  mode?: "cool" | "wind";
  coolingSetpoint?: number;
  windDown?: boolean;
  timer?: boolean;
  finalOffAt?: string;
  source: "smartthings-rule";
};

type SmartThingsDevice = {
  locationId?: string;
};

type RuleOperand = {
  integer?: number;
  decimal?: number;
  string?: string;
};

type RuleInterval = {
  value?: RuleOperand;
  unit?: string;
};

type RuleSpecific = {
  timeZoneId?: string;
  year?: number;
  month?: number;
  day?: number;
  reference?: string;
  offset?: RuleInterval;
};

type RuleCommand = {
  component?: string;
  capability?: string;
  command?: string;
  arguments?: RuleOperand[];
};

type RuleAction = {
  every?: {
    specific?: RuleSpecific;
    actions?: RuleAction[];
    sequence?: {
      actions?: "Serial" | "Parallel";
    };
  };
  sleep?: {
    duration?: RuleInterval;
  };
  command?: {
    devices?: string[];
    commands?: RuleCommand[];
    sequence?: {
      commands?: "Serial" | "Parallel";
    };
  };
};

type Rule = {
  id: string;
  name: string;
  actions?: RuleAction[];
  timeZoneId?: string;
  dateCreated: string;
};

type RulesResponse = {
  items?: Rule[];
};

const RULE_NAME_PREFIX = "SmartThings AC Reservation";
const WIND_DOWN_RULE_MARKER = "WIND_DOWN";
const WIND_DOWN_TIMER_RULE_MARKER = `${WIND_DOWN_RULE_MARKER}_OFF`;
const WIND_DOWN_DURATION_HOURS = 1;

export async function ensureSchedulerStarted() {
  return;
}

export async function listPowerSchedules() {
  const { rules } = await listReservationRules();
  return rules
    .map(ruleToSchedule)
    .filter((schedule): schedule is PowerSchedule => schedule !== null)
    .sort((left, right) => new Date(left.runAt).getTime() - new Date(right.runAt).getTime());
}

export async function createPowerSchedule(
  powerValue: unknown,
  runAtValue: unknown,
  coolingSetpointValue?: unknown,
) {
  const power = validatePower(powerValue);
  const runAt = validateRunAt(runAtValue);
  const coolingSetpoint =
    power === "on" ? validateTemperature(coolingSetpointValue ?? getDefaultCoolingSetpoint()) : undefined;
  const config = getSmartThingsConfig();
  const locationId = await getLocationId();
  const timeZoneId = getTimeZoneId();
  const body = createRuleRequest(power, runAt, {
    deviceId: config.deviceId,
    component: config.component,
    locationId,
    timeZoneId,
    coolingSetpoint,
    modeCapability: config.modeCapability,
    temperatureCapability: config.temperatureCapability,
  });

  const rule = await smartThingsFetch<Rule>(
    `/rules?locationId=${encodeURIComponent(locationId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    config,
  );
  const schedule = ruleToSchedule(rule);

  if (!schedule) {
    throw new SmartThingsApiError("SmartThings Rule was created but could not be parsed.", 502);
  }

  return schedule;
}

export async function startWindDownNow() {
  await setAirConditionerMode("wind");

  return createFinalOffSchedule(new Date(Date.now() + WIND_DOWN_DURATION_HOURS * 60 * 60_000));
}

export async function cancelPowerSchedule(id: string) {
  const config = getSmartThingsConfig();
  const locationId = await getLocationId();
  const schedules = await listPowerSchedules();
  const schedule = schedules.find((item) => item.id === id);

  if (!schedule) {
    return null;
  }

  await smartThingsFetch<Rule>(
    `/rules/${encodeURIComponent(id)}?locationId=${encodeURIComponent(locationId)}`,
    {
      method: "DELETE",
    },
    config,
  );

  return schedule;
}

async function createFinalOffSchedule(runAt: Date) {
  const config = getSmartThingsConfig();
  const locationId = await getLocationId();
  const timeZoneId = getTimeZoneId();
  const dateTime = getDateTimeParts(runAt, timeZoneId);
  const body = {
    name: `${RULE_NAME_PREFIX} ${WIND_DOWN_RULE_MARKER}_OFF ${runAt.toISOString()}`,
    timeZoneId,
    actions: [
      {
        every: {
          specific: {
            locationId,
            timeZoneId,
            year: dateTime.year,
            month: dateTime.month,
            day: dateTime.day,
            reference: "Midnight",
            offset: {
              value: {
                integer: dateTime.hour * 60 + dateTime.minute,
              },
              unit: "Minute",
            },
          },
          actions: [
            createCommandAction(config.deviceId, [
              {
                component: config.component,
                capability: "switch",
                command: "off",
              },
            ]),
          ],
        },
      },
    ],
  };

  const rule = await smartThingsFetch<Rule>(
    `/rules?locationId=${encodeURIComponent(locationId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    config,
  );
  const schedule = ruleToSchedule(rule);

  if (!schedule) {
    throw new SmartThingsApiError("SmartThings wind-down Rule was created but could not be parsed.", 502);
  }

  return schedule;
}

async function listReservationRules() {
  const config = getSmartThingsConfig();
  const locationId = await getLocationId();
  const payload = await smartThingsFetch<Rule[] | RulesResponse>(
    `/rules?locationId=${encodeURIComponent(locationId)}`,
    {
      method: "GET",
      cache: "no-store",
    },
    config,
  );
  const rules = Array.isArray(payload) ? payload : payload.items ?? [];

  return {
    locationId,
    rules: rules.filter((rule) => rule.name.startsWith(RULE_NAME_PREFIX)),
  };
}

async function getLocationId() {
  const config = getSmartThingsConfig();
  const locationId = process.env.SMARTTHINGS_LOCATION_ID;
  if (locationId) return locationId;

  const device = await smartThingsFetch<SmartThingsDevice>(
    `/devices/${config.deviceId}`,
    {
      method: "GET",
      cache: "no-store",
    },
    config,
  );

  if (!device.locationId) {
    throw new SmartThingsApiError("Could not resolve SmartThings locationId.", 500);
  }

  return device.locationId;
}

function createRuleRequest(
  power: PowerState,
  runAt: Date,
  {
    deviceId,
    component,
    locationId,
    timeZoneId,
    coolingSetpoint,
    modeCapability,
    temperatureCapability,
  }: {
    deviceId: string;
    component: string;
    locationId: string;
    timeZoneId: string;
    coolingSetpoint?: number;
    modeCapability: string;
    temperatureCapability: string;
  },
) {
  const dateTime = getDateTimeParts(runAt, timeZoneId);
  let everyActions: RuleAction[] = [
    createCommandAction(deviceId, [
      {
        component,
        capability: "switch",
        command: power,
      },
    ]),
  ];

  if (power === "on") {
    everyActions = [
      createCommandAction(deviceId, [
        {
          component,
          capability: "switch",
          command: "on",
        },
        {
          component,
          capability: modeCapability,
          command: process.env.SMARTTHINGS_MODE_COMMAND ?? "setAirConditionerMode",
          arguments: [{ string: "cool" }],
        },
        {
          component,
          capability: temperatureCapability,
          command: process.env.SMARTTHINGS_TEMPERATURE_COMMAND ?? "setCoolingSetpoint",
          arguments: [numberOperand(coolingSetpoint ?? getDefaultCoolingSetpoint())],
        },
      ]),
    ];
  } else {
    everyActions = [
      createCommandAction(deviceId, [
        {
          component,
          capability: modeCapability,
          command: process.env.SMARTTHINGS_MODE_COMMAND ?? "setAirConditionerMode",
          arguments: [{ string: "wind" }],
        },
      ]),
      {
        sleep: {
          duration: {
            value: {
              integer: WIND_DOWN_DURATION_HOURS,
            },
            unit: "Hour",
          },
        },
      },
      createCommandAction(deviceId, [
        {
          component,
          capability: "switch",
          command: "off",
        },
      ]),
    ];
  }

  return {
    name: `${RULE_NAME_PREFIX} ${
      power === "off" ? WIND_DOWN_RULE_MARKER : power.toUpperCase()
    } ${runAt.toISOString()}`,
    timeZoneId,
    actions: [
      {
        every: {
          specific: {
            locationId,
            timeZoneId,
            year: dateTime.year,
            month: dateTime.month,
            day: dateTime.day,
            reference: "Midnight",
            offset: {
              value: {
                integer: dateTime.hour * 60 + dateTime.minute,
              },
              unit: "Minute",
            },
          },
          actions: everyActions,
          sequence: {
            actions: "Serial",
          },
        },
      },
    ],
  };
}

function createCommandAction(deviceId: string, commands: RuleCommand[]): RuleAction {
  return {
    command: {
      devices: [deviceId],
      commands,
      sequence: {
        commands: "Serial",
      },
    },
  };
}

function ruleToSchedule(rule: Rule): PowerSchedule | null {
  const everyAction = rule.actions?.find((action) => action.every)?.every;
  const specific = everyAction?.specific;
  const commandActions = everyAction?.actions
    ?.map((action) => action.command)
    .filter((command): command is NonNullable<RuleAction["command"]> => Boolean(command));
  const commands = commandActions?.flatMap((commandAction) => commandAction.commands ?? []);
  const power = commands?.find((command) => command.capability === "switch")?.command;
  const modeCommand = commands?.find(
    (command) => command.command === (process.env.SMARTTHINGS_MODE_COMMAND ?? "setAirConditionerMode"),
  );
  const coolingSetpointCommand = commands?.find(
    (command) => command.command === (process.env.SMARTTHINGS_TEMPERATURE_COMMAND ?? "setCoolingSetpoint"),
  );
  const sleepDurationMs = readSleepDurationMs(everyAction?.actions);
  const windDown = rule.name.includes(WIND_DOWN_RULE_MARKER);
  const timer = rule.name.includes(WIND_DOWN_TIMER_RULE_MARKER);

  if (!specific || (power !== "on" && power !== "off")) {
    return null;
  }

  const runAt = specificToIso(specific, rule.timeZoneId ?? getTimeZoneId());
  if (!runAt) {
    return null;
  }

  const runAtMs = new Date(runAt).getTime();
  const finalOffAt =
    power === "off"
      ? new Date(runAtMs + (sleepDurationMs ?? 0)).toISOString()
      : undefined;
  const completedAtMs = finalOffAt ? new Date(finalOffAt).getTime() : runAtMs;
  const mode = readStringArgument(modeCommand);

  return {
    id: rule.id,
    power,
    runAt,
    createdAt: rule.dateCreated,
    status: completedAtMs > Date.now() ? "pending" : "executed",
    executedAt: completedAtMs <= Date.now() ? new Date(completedAtMs).toISOString() : undefined,
    mode: mode === "cool" || mode === "wind" ? mode : undefined,
    coolingSetpoint: readNumberArgument(coolingSetpointCommand),
    windDown,
    timer,
    finalOffAt,
    source: "smartthings-rule",
  };
}

function specificToIso(specific: RuleSpecific, timeZoneId: string) {
  if (!specific.year || !specific.month || !specific.day) return null;

  const offsetMinutes =
    typeof specific.offset?.value?.integer === "number"
      ? specific.offset.value.integer
      : typeof specific.offset?.value?.decimal === "number"
        ? specific.offset.value.decimal
        : 0;
  const hour = Math.floor(offsetMinutes / 60);
  const minute = Math.floor(offsetMinutes % 60);

  return zonedDateTimeToIso({
    year: specific.year,
    month: specific.month,
    day: specific.day,
    hour,
    minute,
    timeZoneId: specific.timeZoneId ?? timeZoneId,
  });
}

function validateRunAt(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SmartThingsApiError("runAt must be a non-empty ISO date string.", 400);
  }

  const runAt = new Date(value);
  if (Number.isNaN(runAt.getTime())) {
    throw new SmartThingsApiError("runAt must be a valid date.", 400);
  }

  if (runAt.getTime() <= Date.now()) {
    throw new SmartThingsApiError("예약 시간은 현재보다 이후여야 합니다.", 400);
  }

  return runAt;
}

function getTimeZoneId() {
  return process.env.SMARTTHINGS_TIME_ZONE_ID ?? "Asia/Seoul";
}

function getDefaultCoolingSetpoint() {
  const { min, max } = getTemperatureRange();
  return Math.min(Math.max(24, min), max);
}

function numberOperand(value: number): RuleOperand {
  return Number.isInteger(value) ? { integer: value } : { decimal: value };
}

function readStringArgument(command: RuleCommand | undefined) {
  const value = command?.arguments?.[0]?.string;
  return typeof value === "string" ? value : null;
}

function readNumberArgument(command: RuleCommand | undefined) {
  const value = command?.arguments?.[0];
  if (typeof value?.integer === "number") return value.integer;
  if (typeof value?.decimal === "number") return value.decimal;
  return undefined;
}

function readSleepDurationMs(actions: RuleAction[] | undefined) {
  const duration = actions?.find((action) => action.sleep)?.sleep?.duration;
  const value = duration?.value;
  const amount =
    typeof value?.integer === "number"
      ? value.integer
      : typeof value?.decimal === "number"
        ? value.decimal
        : undefined;

  if (typeof amount !== "number" || !duration?.unit) return undefined;
  if (duration.unit === "Hour") return amount * 60 * 60_000;
  if (duration.unit === "Minute") return amount * 60_000;
  if (duration.unit === "Second") return amount * 1_000;
  return undefined;
}

function getDateTimeParts(date: Date, timeZoneId: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZoneId,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);

  return {
    year: readPart(parts, "year"),
    month: readPart(parts, "month"),
    day: readPart(parts, "day"),
    hour: readPart(parts, "hour"),
    minute: readPart(parts, "minute"),
  };
}

function zonedDateTimeToIso({
  year,
  month,
  day,
  hour,
  minute,
  timeZoneId,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZoneId: string;
}) {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute);

  for (let index = 0; index < 3; index += 1) {
    const parts = getDateTimeParts(new Date(utcGuess), timeZoneId);
    const renderedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    utcGuess -= renderedAsUtc - Date.UTC(year, month - 1, day, hour, minute);
  }

  return new Date(utcGuess).toISOString();
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const part = parts.find((item) => item.type === type);
  if (!part) {
    throw new SmartThingsApiError(`Could not read ${type} from formatted date.`, 500);
  }

  return Number(part.value);
}
