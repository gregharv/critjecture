import "server-only";

import { type WorkflowScheduleV1 } from "@/lib/workflow-types";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_MAP: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Fri: 5,
  Mon: 1,
  Sat: 6,
  Sun: 0,
  Thu: 4,
  Tue: 2,
  Wed: 3,
};

type ZonedDateParts = {
  day: number;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

type LocalDate = {
  day: number;
  month: number;
  year: number;
};

const formatterByTimeZone = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string) {
  const cached = formatterByTimeZone.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    weekday: "short",
    year: "numeric",
  });

  formatterByTimeZone.set(timeZone, formatter);
  return formatter;
}

function getPartValue(partsByType: Map<string, string>, key: string) {
  const value = partsByType.get(key);

  if (!value) {
    throw new Error(`Missing timezone part: ${key}`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid timezone part value for ${key}: ${value}`);
  }

  return parsed;
}

function getZonedDateParts(timestamp: number, timeZone: string): ZonedDateParts {
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = getFormatter(timeZone).formatToParts(new Date(timestamp));
  } catch {
    throw new Error(`Invalid workflow schedule timezone: ${timeZone}`);
  }

  const partsByType = new Map<string, string>();

  for (const part of parts) {
    if (part.type === "literal") {
      continue;
    }

    partsByType.set(part.type, part.value);
  }

  const weekday = partsByType.get("weekday") ?? "";
  const dayOfWeek = WEEKDAY_MAP[weekday];

  if (typeof dayOfWeek === "undefined") {
    throw new Error(`Unable to resolve weekday for timezone conversion: ${weekday}`);
  }

  return {
    day: getPartValue(partsByType, "day"),
    dayOfWeek,
    hour: getPartValue(partsByType, "hour"),
    minute: getPartValue(partsByType, "minute"),
    month: getPartValue(partsByType, "month"),
    second: getPartValue(partsByType, "second"),
    year: getPartValue(partsByType, "year"),
  };
}

function getLocalDateFromUtcDate(value: Date): LocalDate {
  return {
    day: value.getUTCDate(),
    month: value.getUTCMonth() + 1,
    year: value.getUTCFullYear(),
  };
}

function addDaysToLocalDate(localDate: LocalDate, days: number): LocalDate {
  const base = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day));
  base.setUTCDate(base.getUTCDate() + days);
  return getLocalDateFromUtcDate(base);
}

function addMonthsToLocalDate(localDate: { month: number; year: number }, months: number): {
  month: number;
  year: number;
} {
  const base = new Date(Date.UTC(localDate.year, localDate.month - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + months);

  return {
    month: base.getUTCMonth() + 1,
    year: base.getUTCFullYear(),
  };
}

function getTimeZoneOffsetMs(timestamp: number, timeZone: string) {
  const zoned = getZonedDateParts(timestamp, timeZone);
  const asUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
    0,
  );
  const roundedTimestamp = Math.floor(timestamp / 1000) * 1000;

  return asUtc - roundedTimestamp;
}

function toUtcTimestampFromZonedDateTime(input: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  timeZone: string;
  year: number;
}) {
  const baseUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0);
  const firstOffset = getTimeZoneOffsetMs(baseUtc, input.timeZone);
  let candidate = baseUtc - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(candidate, input.timeZone);

  if (secondOffset !== firstOffset) {
    candidate = baseUtc - secondOffset;
  }

  return candidate;
}

function hasScheduledTimePassed(local: ZonedDateParts, targetHour: number, targetMinute: number) {
  if (local.hour > targetHour) {
    return true;
  }

  if (local.hour < targetHour) {
    return false;
  }

  return local.minute >= targetMinute;
}

function computeNextWeeklyRunAt(schedule: Extract<WorkflowScheduleV1, { kind: "recurring" }>, afterAt: number) {
  const local = getZonedDateParts(afterAt, schedule.timezone);
  const cadence = schedule.cadence;

  if (cadence.kind !== "weekly") {
    throw new Error("Expected weekly cadence.");
  }

  let daysToAdd = (cadence.day_of_week - local.dayOfWeek + 7) % 7;

  if (daysToAdd === 0 && hasScheduledTimePassed(local, cadence.hour, cadence.minute)) {
    daysToAdd = 7;
  }

  let date = addDaysToLocalDate(
    {
      day: local.day,
      month: local.month,
      year: local.year,
    },
    daysToAdd,
  );
  let candidate = toUtcTimestampFromZonedDateTime({
    day: date.day,
    hour: cadence.hour,
    minute: cadence.minute,
    month: date.month,
    timeZone: schedule.timezone,
    year: date.year,
  });

  if (candidate <= afterAt) {
    date = addDaysToLocalDate(date, 7);
    candidate = toUtcTimestampFromZonedDateTime({
      day: date.day,
      hour: cadence.hour,
      minute: cadence.minute,
      month: date.month,
      timeZone: schedule.timezone,
      year: date.year,
    });
  }

  return candidate;
}

function computeNextMonthlyRunAt(
  schedule: Extract<WorkflowScheduleV1, { kind: "recurring" }>,
  afterAt: number,
) {
  const local = getZonedDateParts(afterAt, schedule.timezone);
  const cadence = schedule.cadence;

  if (cadence.kind !== "monthly") {
    throw new Error("Expected monthly cadence.");
  }

  const timeHasPassed = hasScheduledTimePassed(local, cadence.hour, cadence.minute);
  const monthOffset =
    local.day > cadence.day_of_month || (local.day === cadence.day_of_month && timeHasPassed)
      ? 1
      : 0;
  let monthYear = addMonthsToLocalDate(
    {
      month: local.month,
      year: local.year,
    },
    monthOffset,
  );
  let candidate = toUtcTimestampFromZonedDateTime({
    day: cadence.day_of_month,
    hour: cadence.hour,
    minute: cadence.minute,
    month: monthYear.month,
    timeZone: schedule.timezone,
    year: monthYear.year,
  });

  if (candidate <= afterAt) {
    monthYear = addMonthsToLocalDate(monthYear, 1);
    candidate = toUtcTimestampFromZonedDateTime({
      day: cadence.day_of_month,
      hour: cadence.hour,
      minute: cadence.minute,
      month: monthYear.month,
      timeZone: schedule.timezone,
      year: monthYear.year,
    });
  }

  return candidate;
}

export function computeNextScheduledRunAt(schedule: WorkflowScheduleV1, afterAt: number) {
  if (schedule.kind !== "recurring") {
    return null;
  }

  if (schedule.cadence.kind === "weekly") {
    return computeNextWeeklyRunAt(schedule, afterAt);
  }

  return computeNextMonthlyRunAt(schedule, afterAt);
}

export function buildScheduledWindowKey(input: {
  windowEndAt: number;
  windowStartAt: number;
  workflowId: string;
  workflowVersionId: string;
}) {
  return `scheduled:v1:${input.workflowId}:${input.workflowVersionId}:${input.windowStartAt}:${input.windowEndAt}`;
}

export function isRecurringSchedule(schedule: WorkflowScheduleV1): schedule is Extract<
  WorkflowScheduleV1,
  { kind: "recurring" }
> {
  return schedule.kind === "recurring";
}

export const WORKFLOW_SCHEDULER_DEFAULT_TICK_LIMIT = 25;
export const WORKFLOW_SCHEDULER_DEFAULT_MAX_WINDOWS_PER_WORKFLOW = 24;
export const WORKFLOW_SCHEDULER_DEFAULT_QUEUE_BACKPRESSURE_LIMIT = 100;
export const WORKFLOW_SCHEDULER_RECOVERY_REQUEUE_DELAY_MS = 15 * 60 * 1000;

export function clampSchedulerLimit(limit: number | undefined | null, fallback: number) {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }

  return Math.max(1, Math.trunc(limit));
}

function parsePositiveIntegerEnv(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function getWorkflowSchedulerSettings() {
  const maxWorkflowsPerTick = clampSchedulerLimit(
    parsePositiveIntegerEnv(process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WORKFLOWS_PER_TICK),
    WORKFLOW_SCHEDULER_DEFAULT_TICK_LIMIT,
  );
  const maxWindowsPerWorkflow = clampSchedulerLimit(
    parsePositiveIntegerEnv(process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WINDOWS_PER_WORKFLOW),
    WORKFLOW_SCHEDULER_DEFAULT_MAX_WINDOWS_PER_WORKFLOW,
  );
  const queueBackpressureLimit = clampSchedulerLimit(
    parsePositiveIntegerEnv(process.env.CRITJECTURE_WORKFLOW_SCHEDULER_QUEUE_BACKPRESSURE_LIMIT),
    WORKFLOW_SCHEDULER_DEFAULT_QUEUE_BACKPRESSURE_LIMIT,
  );

  return {
    maxWindowsPerWorkflow,
    maxWorkflowsPerTick,
    queueBackpressureLimit,
  };
}

export function addSchedulerRecoveryDelay(now: number) {
  return now + WORKFLOW_SCHEDULER_RECOVERY_REQUEUE_DELAY_MS;
}

export function addOneDay(timestamp: number) {
  return timestamp + DAY_MS;
}
