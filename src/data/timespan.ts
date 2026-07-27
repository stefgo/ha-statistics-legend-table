/**
 * Resolves `timespan` + `aggregation` into the concrete `{start, end, period}`
 * the recorder query needs.
 *
 * `mode: energy` is not resolved here — its range comes from the dashboard's
 * energy date picker (see `energy-collection.ts`) and is only turned into a
 * period by `periodFor()`.
 *
 * Date arithmetic is done with plain `Date` methods rather than a date library:
 * the handful of operations needed here are not worth the bundle weight, and
 * local-time semantics (start of day/week/month in the user's timezone) is
 * exactly what the built-in setters give us.
 */

import type {
  AggregationPeriod,
  AggregationSetting,
  RelativePeriod,
  TimespanConfig,
} from "../config/types";

export interface ResolvedTimespan {
  start: Date;
  end: Date;
}

export interface StatisticsRange extends ResolvedTimespan {
  period: AggregationPeriod;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfHour(date: Date): Date {
  const result = new Date(date);
  result.setMinutes(0, 0, 0);
  return result;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/** Week starts on Monday, matching Home Assistant's default for energy ranges */
function startOfWeek(date: Date): Date {
  const result = startOfDay(date);
  const weekday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - weekday);
  return result;
}

function startOfMonth(date: Date): Date {
  const result = startOfDay(date);
  result.setDate(1);
  return result;
}

function startOfYear(date: Date): Date {
  const result = startOfMonth(date);
  result.setMonth(0);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  // Clamp to the last day of the target month so e.g. Jan 31 + 1 month lands on
  // Feb 28/29 instead of rolling over into March.
  const targetDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const daysInTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(targetDay, daysInTargetMonth));
  return result;
}

/**
 * Resolves a `relative` timespan. The `hour`/`day`/`week`/`month`/`year` periods
 * are calendar-aligned (the current hour, today, this week, …) and `offset`
 * shifts them by whole periods into the past; the `last_*` periods are rolling
 * windows ending now, where `offset` shifts by the window length.
 */
function resolveRelative(config: TimespanConfig, now: Date): ResolvedTimespan {
  const period: RelativePeriod = config.period ?? "day";
  const offset = typeof config.offset === "number" ? config.offset : 0;

  switch (period) {
    case "hour": {
      const start = startOfHour(new Date(now.getTime() + offset * HOUR));
      return { start, end: new Date(start.getTime() + HOUR) };
    }
    case "day": {
      const start = startOfDay(new Date(now.getTime() + offset * DAY));
      return { start, end: new Date(start.getTime() + DAY) };
    }
    case "week": {
      const start = startOfWeek(new Date(now.getTime() + offset * 7 * DAY));
      return { start, end: new Date(start.getTime() + 7 * DAY) };
    }
    case "month": {
      const start = startOfMonth(addMonths(now, offset));
      return { start, end: addMonths(start, 1) };
    }
    case "year": {
      const start = startOfYear(addMonths(now, offset * 12));
      return { start, end: addMonths(start, 12) };
    }
    case "last_60_minutes":
      return rollingWindow(now, 60 * MINUTE, offset);
    case "last_24_hours":
      return rollingWindow(now, DAY, offset);
    case "last_7_days":
      return rollingWindow(now, 7 * DAY, offset);
    case "last_30_days":
      return rollingWindow(now, 30 * DAY, offset);
    case "last_12_months": {
      const end = offset ? addMonths(now, offset * 12) : now;
      return { start: addMonths(end, -12), end };
    }
    default:
      return { start: startOfDay(now), end: new Date(startOfDay(now).getTime() + DAY) };
  }
}

function rollingWindow(now: Date, length: number, offset: number): ResolvedTimespan {
  const end = new Date(now.getTime() + offset * length);
  return { start: new Date(end.getTime() - length), end };
}

/** Resolves a `fixed` timespan, defaulting to today when unparseable */
function resolveFixed(config: TimespanConfig, now: Date): ResolvedTimespan {
  const parsed = config.start ? new Date(config.start) : undefined;
  const start = parsed && !Number.isNaN(parsed.getTime()) ? parsed : startOfDay(now);

  const parsedEnd = config.end ? new Date(config.end) : undefined;
  const end =
    parsedEnd && !Number.isNaN(parsedEnd.getTime())
      ? parsedEnd
      : new Date(startOfDay(start).getTime() + DAY);

  return { start, end };
}

/**
 * Resolves `relative` and `fixed` timespans. Returns `undefined` for
 * `mode: energy`, whose range is supplied by the energy collection instead.
 */
export function resolveTimespan(
  config: TimespanConfig | undefined,
  now: Date = new Date()
): ResolvedTimespan | undefined {
  const mode = config?.mode ?? "energy";
  if (mode === "energy") {
    return undefined;
  }
  return mode === "fixed" ? resolveFixed(config ?? {}, now) : resolveRelative(config ?? {}, now);
}

/**
 * Bucket size for a range. `auto` follows Home Assistant's own rule so that the
 * legend buckets the same way a neighbouring energy card does — which matters
 * because `min`/`max`/`avg` are per-bucket values.
 */
export function periodFor(
  setting: AggregationSetting | undefined,
  range: ResolvedTimespan
): AggregationPeriod {
  if (setting && setting !== "auto") {
    return setting;
  }

  const days = (range.end.getTime() - range.start.getTime()) / DAY;
  if (days > 35) {
    return "month";
  }
  if (days > 2) {
    return "day";
  }
  return "hour";
}
