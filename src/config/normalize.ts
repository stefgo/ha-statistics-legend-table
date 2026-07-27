/**
 * Validation and defaulting of the raw YAML config.
 *
 * `setConfig()` runs in the Lovelace editor on every keystroke, so this throws
 * only for mistakes the card genuinely cannot render (no `entities`, an entity
 * without a statistic, an unknown enum value). Everything else is silently
 * defaulted — a card on a dashboard should degrade, not blow up.
 */

import {
  ALL_AGGREGATION_PERIODS,
  ALL_LEGEND_COLUMNS,
  ALL_RELATIVE_PERIODS,
  ALL_STAT_TYPES,
  AggregationSetting,
  EnergyCustomLegendCardConfig,
  EntityConfig,
  LegendColumn,
  LinkConfig,
  LinkMode,
  RelativePeriod,
  StatType,
  TimespanMode,
} from "./types";

const TIMESPAN_MODES: TimespanMode[] = ["energy", "relative", "fixed"];
const LINK_MODES: LinkMode[] = ["chart", "entity", "event", "none"];

export const DEFAULT_PRECISION = 2;

/** One entity row with everything resolved that does not need `hass` */
export interface ResolvedEntity {
  key: string;
  /** Always at least one id; several are summed bucket by bucket */
  statisticIds: string[];
  name?: string;
  color?: string;
  statType: StatType;
  unit?: string;
  multiply: number;
  add: number;
  hiddenByDefault: boolean;
  link: string;
}

export interface ResolvedConfig {
  raw: EnergyCustomLegendCardConfig;
  entities: ResolvedEntity[];
  links: LinkConfig[];
}

function fail(message: string): never {
  throw new Error(message);
}

function oneOf<T extends string>(value: unknown, allowed: T[], field: string): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`\`${field}\` must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function numberOr(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`\`${field}\` must be a number`);
  }
  return value;
}

/**
 * Normalizes one entity row. `statistic_id` and `statistic_ids` are folded into
 * a single list so everything downstream only deals with the list form.
 */
function resolveEntity(entity: EntityConfig, index: number): ResolvedEntity {
  if (!entity || typeof entity !== "object") {
    fail(`\`entities[${index}]\` must be an object`);
  }

  const ids: string[] = [];
  if (typeof entity.statistic_id === "string" && entity.statistic_id.trim()) {
    ids.push(entity.statistic_id.trim());
  }
  if (Array.isArray(entity.statistic_ids)) {
    entity.statistic_ids.forEach((id) => {
      if (typeof id === "string" && id.trim()) {
        ids.push(id.trim());
      }
    });
  }
  if (!ids.length) {
    fail(`\`entities[${index}]\` needs a \`statistic_id\` or \`statistic_ids\``);
  }

  const key = typeof entity.key === "string" && entity.key.trim() ? entity.key.trim() : ids[0];

  return {
    key,
    statisticIds: ids,
    name: typeof entity.name === "string" ? entity.name : undefined,
    color: typeof entity.color === "string" ? entity.color : undefined,
    statType: oneOf(entity.stat_type, ALL_STAT_TYPES, `entities[${index}].stat_type`) ?? "change",
    unit: typeof entity.unit === "string" ? entity.unit : undefined,
    multiply: numberOr(entity.multiply, 1, `entities[${index}].multiply`),
    add: numberOr(entity.add, 0, `entities[${index}].add`),
    hiddenByDefault: entity.hidden_by_default === true,
    link: typeof entity.link === "string" && entity.link.trim() ? entity.link.trim() : key,
  };
}

/** `link` accepts a single block or a list; both become a list here */
function resolveLinks(config: EnergyCustomLegendCardConfig): LinkConfig[] {
  const raw = config.link;
  if (!raw) {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((link, index) => {
      if (!link || typeof link !== "object") {
        fail(`\`link[${index}]\` must be an object`);
      }
      const mode = oneOf(link.mode, LINK_MODES, `link[${index}].mode`) ?? "none";
      return { ...link, mode };
    })
    .filter((link) => link.mode !== "none");
}

export function normalizeConfig(config: EnergyCustomLegendCardConfig): ResolvedConfig {
  if (!config || typeof config !== "object") {
    fail("Invalid configuration");
  }
  if (!Array.isArray(config.entities) || !config.entities.length) {
    fail("`entities` is required and must list at least one statistic");
  }
  if (config.card !== undefined && (typeof config.card !== "object" || !config.card?.type)) {
    fail("`card` must be a card configuration with a `type`");
  }

  const entities = config.entities.map(resolveEntity);

  const duplicate = entities.find(
    (entity, index) => entities.findIndex((other) => other.key === entity.key) !== index
  );
  if (duplicate) {
    fail(`Duplicate entity key \`${duplicate.key}\` — set an explicit \`key\` to disambiguate`);
  }

  // Validated for their error messages; the values themselves are read lazily
  // from `config` by the modules that need them.
  oneOf(config.timespan?.mode, TIMESPAN_MODES, "timespan.mode");
  oneOf<RelativePeriod>(config.timespan?.period, ALL_RELATIVE_PERIODS, "timespan.period");
  oneOf<AggregationSetting>(
    config.aggregation?.period,
    [...ALL_AGGREGATION_PERIODS, "auto"],
    "aggregation.period"
  );
  oneOf(config.legend?.total?.stat_type, ALL_STAT_TYPES, "legend.total.stat_type");

  return { raw: config, entities, links: resolveLinks(config) };
}

/** Value columns of a legend/group config, falling back to `["sum"]` */
export function columnsFor(columns: LegendColumn[] | undefined): LegendColumn[] {
  if (!columns?.length) {
    return ["sum"];
  }
  const valid = columns.filter((column) => ALL_LEGEND_COLUMNS.includes(column));
  return valid.length ? valid : ["sum"];
}
