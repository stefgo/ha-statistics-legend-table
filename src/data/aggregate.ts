/**
 * Turns recorder buckets into legend rows.
 *
 * `sum` is the aggregate over the whole timespan; `min`/`max`/`avg` are computed
 * across the *buckets*, so they mean "the smallest/largest/average hour" (or
 * day, month, …) depending on `aggregation.period`.
 */

import type { HomeAssistant } from "custom-card-helpers";

import { isDarkMode, resolveColor, withAlpha, SWATCH_FILL_ALPHA } from "../colors";
import type { ResolvedCalculation, ResolvedEntity } from "../config/normalize";
import type { LegendRow, StatType } from "../config/types";
import {
  Statistics,
  StatisticsMetadata,
  StatisticValue,
  statisticLabel,
  statisticUnit,
} from "./statistics";

/** Reads one bucket's value for the requested statistic type */
function bucketValue(bucket: StatisticValue, statType: StatType): number | undefined {
  const value = bucket?.[statType];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The buckets of a single statistic as a plain value series */
function plainValues(
  statistics: Statistics,
  statisticId: string,
  statType: StatType
): number[] {
  const values: number[] = [];
  (statistics[statisticId] ?? []).forEach((bucket) => {
    const value = bucketValue(bucket, statType);
    if (value !== undefined) {
      values.push(value);
    }
  });
  return values;
}

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (min !== undefined && result < min) {
    result = min;
  }
  if (max !== undefined && result > max) {
    result = max;
  }
  return result;
}

/**
 * Evaluates a calculated row into a value series.
 *
 * The calculation runs *per bucket*, over the union of all bucket starts of the
 * statistics involved, so `min`/`max`/`avg` keep meaning "the smallest/largest/
 * average bucket" just like for a plain statistic row. Terms are applied in
 * configuration order, without operator precedence.
 *
 * A statistic that has no value for a bucket contributes 0 rather than dropping
 * the bucket — with `subtract` terms the alternative would silently lose whole
 * buckets from the sum. A division by zero does drop its bucket, since there is
 * no meaningful value to show for it.
 *
 * A calculation made of constants alone has no buckets to iterate; it yields a
 * single value, so the row still has a defined sum/min/max/avg.
 */
export function evaluateCalculation(
  statistics: Statistics,
  calculation: ResolvedCalculation,
  fallbackStatType: StatType
): number[] {
  const termValues = calculation.terms.map((term) => {
    if (!term.statisticId) {
      return clamp(term.constant * term.multiply + term.add, term.clipMin, term.clipMax);
    }

    const statType = term.statType ?? fallbackStatType;
    const byStart = new Map<number, number>();
    (statistics[term.statisticId] ?? []).forEach((bucket) => {
      const value = bucketValue(bucket, statType);
      if (value !== undefined) {
        byStart.set(bucket.start, clamp(value * term.multiply + term.add, term.clipMin, term.clipMax));
      }
    });
    return byStart;
  });

  const starts = new Set<number>();
  termValues.forEach((values) => {
    if (values instanceof Map) {
      values.forEach((_value, start) => starts.add(start));
    }
  });

  const evaluate = (start?: number): number | undefined => {
    let result = calculation.initialValue;
    for (let index = 0; index < calculation.terms.length; index += 1) {
      const values = termValues[index];
      const value =
        values instanceof Map ? (start !== undefined ? values.get(start) ?? 0 : 0) : values;

      switch (calculation.terms[index].operation) {
        case "subtract":
          result -= value;
          break;
        case "multiply":
          result *= value;
          break;
        case "divide":
          if (value === 0) {
            return undefined;
          }
          result /= value;
          break;
        default:
          result += value;
          break;
      }
    }
    return Number.isFinite(result) ? result : undefined;
  };

  if (!starts.size) {
    // Constants only: a legitimate row with exactly one value. A calculation
    // that does reference statistics but got no data is an empty row instead,
    // like any other row whose statistic returned nothing.
    if (calculation.terms.some((term) => term.statisticId)) {
      return [];
    }
    const value = evaluate();
    return value === undefined ? [] : [value];
  }

  const values: number[] = [];
  [...starts]
    .sort((a, b) => a - b)
    .forEach((start) => {
      const value = evaluate(start);
      if (value !== undefined) {
        values.push(value);
      }
    });
  return values;
}

/** Builds one legend row per configured entity, in configuration order */
export function buildRows(
  entities: ResolvedEntity[],
  statistics: Statistics,
  metadata: StatisticsMetadata,
  hass: HomeAssistant | undefined
): LegendRow[] {
  const darkMode = isDarkMode(hass);

  return entities.map((entity, index) => {
    const firstId: string | undefined = entity.statisticIds[0];
    const firstMeta = firstId ? metadata[firstId] : undefined;

    const raw = entity.calculation
      ? evaluateCalculation(statistics, entity.calculation, entity.statType)
      : firstId
        ? plainValues(statistics, firstId, entity.statType)
        : [];
    const values =
      entity.multiply === 1 && entity.add === 0
        ? raw
        : raw.map((value) => value * entity.multiply + entity.add);

    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    values.forEach((value) => {
      sum += value;
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    });

    const count = values.length;
    const color = resolveColor(entity.color, darkMode, index);

    return {
      id: entity.key,
      name: entity.name ?? (firstId ? statisticLabel(hass, firstId, firstMeta) : entity.key),
      color,
      fillColor: withAlpha(color, SWATCH_FILL_ALPHA),
      unit: entity.calculation?.unit ?? entity.unit ?? statisticUnit(hass, firstId, firstMeta),
      sum,
      min: count ? min : 0,
      max: count ? max : 0,
      avg: count ? sum / count : 0,
      count,
      links: entity.links,
      noValues: entity.noValues,
    };
  });
}

/** Every statistic type any row (or the ratio total) asks for */
export function collectStatTypes(entities: ResolvedEntity[], totalStatType?: StatType): Set<StatType> {
  const types = new Set<StatType>();
  entities.forEach((entity) => {
    types.add(entity.statType);
    entity.calculation?.terms.forEach((term) => {
      if (term.statisticId && term.statType) {
        types.add(term.statType);
      }
    });
  });
  if (totalStatType) {
    types.add(totalStatType);
  }
  if (!types.size) {
    types.add("change");
  }
  return types;
}

/** Every statistic id that needs fetching, including the ratio total's operands */
export function collectStatisticIds(
  entities: ResolvedEntity[],
  numerator: string[] = [],
  denominator: string[] = []
): string[] {
  const ids = new Set<string>();
  entities.forEach((entity) => entity.statisticIds.forEach((id) => ids.add(id)));
  [...numerator, ...denominator].forEach((id) => {
    if (typeof id === "string" && id.trim()) {
      ids.add(id.trim());
    }
  });
  return [...ids];
}
