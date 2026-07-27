/**
 * Turns recorder buckets into legend rows.
 *
 * `sum` is the aggregate over the whole timespan; `min`/`max`/`avg` are computed
 * across the *buckets*, so they mean "the smallest/largest/average hour" (or
 * day, month, …) depending on `aggregation.period`.
 */

import type { HomeAssistant } from "custom-card-helpers";

import { paletteColor, withAlpha, SWATCH_FILL_ALPHA } from "../colors";
import type { ResolvedEntity } from "../config/normalize";
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

/**
 * Combines the buckets of one row's statistics into a single value series.
 *
 * With several `statistic_ids` the buckets are added up per bucket start, so
 * two meters covering the same period become one row. Buckets one statistic has
 * and another lacks are treated as zero on the missing side rather than
 * dropping the bucket — the alternative would silently lose energy from the sum.
 */
function combineValues(
  statistics: Statistics,
  statisticIds: string[],
  statType: StatType
): number[] {
  if (statisticIds.length === 1) {
    const buckets = statistics[statisticIds[0]] ?? [];
    const values: number[] = [];
    buckets.forEach((bucket) => {
      const value = bucketValue(bucket, statType);
      if (value !== undefined) {
        values.push(value);
      }
    });
    return values;
  }

  const byStart = new Map<number, number>();
  statisticIds.forEach((id) => {
    (statistics[id] ?? []).forEach((bucket) => {
      const value = bucketValue(bucket, statType);
      if (value === undefined) {
        return;
      }
      byStart.set(bucket.start, (byStart.get(bucket.start) ?? 0) + value);
    });
  });

  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
}

/** Builds one legend row per configured entity, in configuration order */
export function buildRows(
  entities: ResolvedEntity[],
  statistics: Statistics,
  metadata: StatisticsMetadata,
  hass: HomeAssistant | undefined
): LegendRow[] {
  return entities.map((entity, index) => {
    const firstId = entity.statisticIds[0];
    const firstMeta = metadata[firstId];

    const raw = combineValues(statistics, entity.statisticIds, entity.statType);
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
    const color = entity.color ?? paletteColor(index);

    return {
      id: entity.key,
      name: entity.name ?? statisticLabel(hass, firstId, firstMeta),
      color,
      fillColor: withAlpha(color, SWATCH_FILL_ALPHA),
      unit: entity.unit ?? statisticUnit(firstMeta),
      sum,
      min: count ? min : 0,
      max: count ? max : 0,
      avg: count ? sum / count : 0,
      count,
      link: entity.link,
    };
  });
}

/** Every statistic type any row (or the ratio total) asks for */
export function collectStatTypes(entities: ResolvedEntity[], totalStatType?: StatType): Set<StatType> {
  const types = new Set<StatType>();
  entities.forEach((entity) => types.add(entity.statType));
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
