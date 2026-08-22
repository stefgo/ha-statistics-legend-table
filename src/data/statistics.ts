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

/** One metadata call, reduced to a lookup and never fatal */
async function fetchMetadata(
  hass: HomeAssistant,
  ids: string[]
): Promise<StatisticsMetadata> {
  const metadataList = await hass
    .callWS<StatisticMetadata[]>({
      type: "recorder/get_statistics_metadata",
      statistic_ids: ids,
    })
    .catch(() => [] as StatisticMetadata[]);

  const metadata: StatisticsMetadata = {};
  if (Array.isArray(metadataList)) {
    metadataList.forEach((entry) => {
      if (entry?.statistic_id) {
        metadata[entry.statistic_id] = entry;
      }
    });
  }
  return metadata;
}

/**
 * Remembers the metadata of one set of statistic ids.
 *
 * Metadata answers what a statistic is called and which unit it is stored in.
 * Neither changes while a dashboard is open, yet it was re-fetched with every
 * refresh — for `mode: relative` that is once a minute, for the lifetime of the
 * page, for an answer that is always the same.
 *
 * Keyed by the id set, so a config change reloads and nothing else does. An
 * in-flight call is shared rather than duplicated: two refreshes close together
 * would otherwise each ask.
 *
 * The staleness this accepts is deliberate. Since names are resolved from the
 * entity, cached metadata only decides the unit and the name of an *external*
 * statistic — neither of which changes without an integration being
 * reconfigured, which reloads the dashboard anyway.
 */
export class StatisticsMetadataCache {
  private _key = "";
  private _metadata?: StatisticsMetadata;
  private _pending?: Promise<StatisticsMetadata>;

  public async get(hass: HomeAssistant, ids: string[]): Promise<StatisticsMetadata> {
    const key = [...ids].sort().join("\u0000");

    if (key !== this._key) {
      this.clear();
      this._key = key;
    }
    if (this._metadata) {
      return this._metadata;
    }
    if (!this._pending) {
      this._pending = fetchMetadata(hass, ids).then((metadata) => {
        // A newer id set may have cleared the cache while this was in flight;
        // only the answer that still matches the key is worth keeping.
        if (key === this._key) {
          this._metadata = metadata;
          this._pending = undefined;
        }
        return metadata;
      });
    }
    return this._pending;
  }

  /** Drops what is remembered, e.g. on a config change */
  public clear(): void {
    this._key = "";
    this._metadata = undefined;
    this._pending = undefined;
  }
}

/**
 * Fetches statistics and metadata for the given ids.
 *
 * Both calls are made in parallel; a failing metadata call is not fatal, since
 * it only supplies fallback names and units. Passing a `cache` keeps the
 * metadata across refreshes — see `StatisticsMetadataCache`; without one every
 * call asks again, which is what the plain function does.
 */
export async function fetchStatistics(
  hass: HomeAssistant,
  statisticIds: string[],
  start: Date,
  end: Date,
  period: AggregationPeriod,
  statTypes: Set<StatType>,
  cache?: StatisticsMetadataCache
): Promise<StatisticsResult> {
  const ids = [...new Set(statisticIds)].filter(Boolean);
  if (!ids.length) {
    return { statistics: {}, metadata: {} };
  }

  const [statistics, metadata] = await Promise.all([
    hass.callWS<Statistics>({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: ids,
      period,
      types: requestedTypes(statTypes),
    }),
    cache ? cache.get(hass, ids) : fetchMetadata(hass, ids),
  ]);

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
 * Converting to the user's display unit is a separate change. It is done by
 * passing `units:` to `recorder/statistics_during_period`, which is keyed by
 * unit *class* — one target unit per class, everything of that class converges
 * on it, and classes with no key set keep their native unit. That is the design
 * of the parameter, not a limitation of it: Home Assistant's own
 * `hui-statistics-graph-card` builds its `units` exactly that way. Whatever
 * asks for a conversion has to make this function report the *requested* unit,
 * or the label and the numbers come apart again.
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
