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
 * The part of a statistic id after the domain, as a readable phrase.
 *
 * Empty for an external statistic (`domain:id`, which has no dot), so that such
 * an id is never prettified: its second half is a recorder key, not a name.
 */
function readableId(statisticId: string): string {
  const dot = statisticId.indexOf(".");
  return dot === -1 ? "" : statisticId.slice(dot + 1).replace(/_/g, " ");
}

/**
 * Display name of a statistic, resolved the way Home Assistant resolves it.
 *
 * The order is the one of `getStatisticLabel()` (`frontend/src/data/recorder.ts`):
 * an existing entity names the statistic, and only a statistic *without* an
 * entity — an external one, `domain:id` — falls back to the recorder metadata.
 * This card used to prefer the metadata name, which is the same lookup with the
 * two sources swapped. That is not a cosmetic difference: an entity renamed in
 * Home Assistant keeps its old name in the recorder metadata, so the legend
 * showed a different name for the very statistic a neighbouring energy card
 * showed under its new one.
 *
 * The entity branch mirrors `computeStateName()`, including its distinction
 * between an absent `friendly_name` (derive a name from the id) and one set to
 * an empty value (HA renders nothing).
 *
 * Two deliberate departures remain, both in cases where HA ends up with no
 * usable name and this card would rather show something than an empty or raw
 * row: an empty `friendly_name` continues to the metadata name instead of
 * rendering blank, and a statistic that neither an entity nor the metadata names
 * is shown as its readable id rather than the id itself. Neither can disagree
 * with a neighbouring card about a name, because in both cases the other card
 * has no name to show either.
 */
export function statisticLabel(
  hass: HomeAssistant | undefined,
  statisticId: string,
  metadata?: StatisticMetadata
): string {
  const entity = hass?.states?.[statisticId];
  if (entity) {
    const friendlyName = entity.attributes?.friendly_name;
    // `undefined` means the entity carries no name and HA derives one from the
    // id; any other value is the name, and `null` collapses to empty just as
    // `computeStateName()`'s `?? ""` does — both empty results fall through.
    const name =
      friendlyName === undefined ? readableId(statisticId) : String(friendlyName ?? "");
    if (name) {
      return name;
    }
  }

  return metadata?.name || readableId(statisticId) || statisticId;
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
