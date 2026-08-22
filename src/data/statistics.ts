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

/**
 * Metadata as `recorder/get_statistics_metadata` actually returns it — mirrors
 * `StatisticsMetaData` in `frontend/src/data/recorder.ts`.
 *
 * Note that the unit field is `statistics_unit_of_measurement`. There is no
 * `unit_of_measurement` and no `display_unit_of_measurement` in this payload;
 * the latter existed in much older Home Assistant versions and is kept here as
 * an optional last resort only.
 */
export interface StatisticMetadata {
  statistic_id: string;
  source?: string;
  name?: string | null;
  statistics_unit_of_measurement?: string | null;
  unit_class?: string | null;
  has_sum?: boolean;
  /** Legacy, pre-2023 Home Assistant; never set on current versions */
  display_unit_of_measurement?: string | null;
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

/**
 * Unit of the values this card displays.
 *
 * `statistics_unit_of_measurement` comes first on purpose, and this is where it
 * differs from the frontend's `getDisplayUnit()`, which prefers the entity's
 * current `unit_of_measurement` attribute. That preference is only correct for
 * a caller that also passes `units:` to `recorder/statistics_during_period` and
 * has the recorder convert; without it the recorder answers in the statistic's
 * own unit, so labelling with the entity attribute would put a unit next to
 * numbers that are not in it. The entity attribute is used only when the
 * metadata carries no unit at all.
 *
 * Converting to the user's display unit is a separate change: the `units:`
 * parameter is keyed by unit *class*, not by statistic, so it cannot express
 * two statistics of the same class in different units.
 */
export function statisticUnit(
  hass: HomeAssistant | undefined,
  statisticId: string | undefined,
  metadata?: StatisticMetadata
): string {
  const fromMetadata =
    metadata?.statistics_unit_of_measurement || metadata?.display_unit_of_measurement;
  if (fromMetadata) {
    return fromMetadata;
  }

  const attribute = statisticId
    ? hass?.states?.[statisticId]?.attributes?.unit_of_measurement
    : undefined;
  return typeof attribute === "string" ? attribute : "";
}
