/**
 * Recorder access.
 *
 * This is the card's own data source and replaces the old approach of reading a
 * neighbouring card's private fields. Everything is plain, documented Home
 * Assistant websocket API: `recorder/statistics_during_period` and
 * `recorder/get_statistics_metadata`.
 */

import type { HomeAssistant } from "custom-card-helpers";

import type { AggregationPeriod, StatType } from "../config/types";

/** One bucket of a statistic, as returned by the recorder */
export interface StatisticValue {
  start: number;
  end?: number;
  change?: number | null;
  sum?: number | null;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
  state?: number | null;
}

/** Buckets keyed by `statistic_id` */
export type Statistics = Record<string, StatisticValue[]>;

export interface StatisticMetadata {
  statistic_id: string;
  name?: string | null;
  unit_of_measurement?: string | null;
  display_unit_of_measurement?: string | null;
  has_sum?: boolean;
  has_mean?: boolean;
}

export type StatisticsMetadata = Record<string, StatisticMetadata>;

export interface StatisticsResult {
  statistics: Statistics;
  metadata: StatisticsMetadata;
}

/**
 * The recorder wants the value kinds it should compute. `change` implies `sum`
 * (it is derived from consecutive sums), so it is requested alongside — asking
 * for `change` alone returns nothing on some Home Assistant versions.
 */
function requestedTypes(statTypes: Set<StatType>): string[] {
  const types = new Set<string>(statTypes);
  if (types.has("change")) {
    types.add("sum");
  }
  return [...types];
}

/**
 * Fetches statistics and metadata for the given ids.
 *
 * Both calls are made in parallel; a failing metadata call is not fatal, since
 * it only supplies fallback names and units.
 */
export async function fetchStatistics(
  hass: HomeAssistant,
  statisticIds: string[],
  start: Date,
  end: Date,
  period: AggregationPeriod,
  statTypes: Set<StatType>
): Promise<StatisticsResult> {
  const ids = [...new Set(statisticIds)].filter(Boolean);
  if (!ids.length) {
    return { statistics: {}, metadata: {} };
  }

  const [statistics, metadataList] = await Promise.all([
    hass.callWS<Statistics>({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: ids,
      period,
      types: requestedTypes(statTypes),
    }),
    hass
      .callWS<StatisticMetadata[]>({
        type: "recorder/get_statistics_metadata",
        statistic_ids: ids,
      })
      .catch(() => [] as StatisticMetadata[]),
  ]);

  const metadata: StatisticsMetadata = {};
  if (Array.isArray(metadataList)) {
    metadataList.forEach((entry) => {
      if (entry?.statistic_id) {
        metadata[entry.statistic_id] = entry;
      }
    });
  }

  return { statistics: statistics ?? {}, metadata };
}

/**
 * Display name of a statistic: its recorder metadata name, else the entity's
 * friendly name, else a readable form of the id itself.
 *
 * Ported from `energy-graph-cards/utils/recorder.ts`.
 */
export function statisticLabel(
  hass: HomeAssistant | undefined,
  statisticId: string,
  metadata?: StatisticMetadata
): string {
  if (metadata?.name) {
    return metadata.name;
  }

  const friendlyName = hass?.states?.[statisticId]?.attributes?.friendly_name;
  if (typeof friendlyName === "string" && friendlyName) {
    return friendlyName;
  }

  return statisticId.split(".")[1]?.replace(/_/g, " ") || statisticId;
}

/** Unit of a statistic, preferring the unit the user sees in the UI */
export function statisticUnit(metadata?: StatisticMetadata): string {
  return metadata?.display_unit_of_measurement || metadata?.unit_of_measurement || "";
}
