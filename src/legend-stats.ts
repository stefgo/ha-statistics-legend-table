/**
 * Grouping, ordering and the closing total row.
 *
 * Hidden rows are excluded from the `sum` total, mirroring the behaviour of the
 * legend in Home Assistant's own energy cards. The `ratio` total is computed
 * from raw statistics instead (see `computeTotal()`) and is therefore unaffected
 * by which rows are currently hidden.
 */

import { DEFAULT_PRECISION } from "./config/normalize";
import type {
  LegendConfig,
  LegendGroupOverrides,
  LegendGroupResult,
  LegendRow,
  LegendTotal,
  LegendTotalConfig,
  StatType,
} from "./config/types";
import type { Statistics } from "./data/statistics";

export { DEFAULT_PRECISION };

function filterHideZero(rows: LegendRow[], config: LegendConfig): LegendRow[] {
  return config.hide_zero ? rows.filter((row) => !(row.count === 0 || row.sum === 0)) : rows;
}

/**
 * Reorders rows per `config.order`. Rows matching an earlier selector come
 * first; rows matching none keep their relative order and are appended last.
 */
function applyOrder(rows: LegendRow[], config: LegendConfig): LegendRow[] {
  const order = config.order;
  if (!order?.length) {
    return rows;
  }
  const orderIndex = (row: LegendRow): number => {
    const index = order.findIndex((selector) => matchesSelector(row, selector));
    return index === -1 ? order.length : index;
  };
  return [...rows].sort((a, b) => orderIndex(a) - orderIndex(b));
}

function finalizeRows(rows: LegendRow[], config: LegendConfig): LegendRow[] {
  return applyOrder(filterHideZero(rows, config), config);
}

function resolveGroupConfig(
  base: LegendConfig,
  override: LegendGroupOverrides & { no_values?: string[] }
): LegendConfig {
  return {
    columns: override.columns ?? base.columns,
    precision: override.precision ?? base.precision,
    show_unit: override.show_unit ?? base.show_unit,
    hide_zero: override.hide_zero ?? base.hide_zero,
    show_headers: override.show_headers ?? base.show_headers,
    total: override.total ?? base.total,
    no_values: [...(base.no_values ?? []), ...(override.no_values ?? [])],
    order: override.order ?? base.order,
  };
}

/**
 * Splits rows into groups per `legend.groups`. Without groups this returns a
 * single unnamed group holding every row. Rows claimed by an earlier group are
 * unavailable to later ones (first match wins); rows matched by no group land in
 * a trailing, unnamed group using the top-level config — nothing is ever lost,
 * even when `groups` does not cover every entity.
 */
export function buildLegendGroups(allRows: LegendRow[], config: LegendConfig): LegendGroupResult[] {
  const groupConfigs = config.groups ?? [];

  if (!groupConfigs.length) {
    return [{ config, rows: finalizeRows(allRows, config) }];
  }

  const claimed = new Set<string>();
  const results: LegendGroupResult[] = groupConfigs.map((group) => {
    const selectors = group.entities ?? [];
    const matched = allRows.filter((row) => {
      if (claimed.has(row.id)) {
        return false;
      }
      const isMatch = selectors.some((selector) => matchesSelector(row, selector));
      if (isMatch) {
        claimed.add(row.id);
      }
      return isMatch;
    });
    const resolvedConfig = resolveGroupConfig(config, group);
    return { name: group.name, config: resolvedConfig, rows: finalizeRows(matched, resolvedConfig) };
  });

  const remainder = allRows.filter((row) => !claimed.has(row.id));
  results.push({ config, rows: finalizeRows(remainder, config) });

  return results;
}

/**
 * Matches a user supplied selector against a row.
 *
 * A selector matches the row's `key` or its displayed `name`, so a config can
 * refer to rows by whichever is more readable.
 */
export function matchesSelector(row: LegendRow, selector: string): boolean {
  const needle = selector.trim();
  if (!needle) {
    return false;
  }
  return row.id === needle || row.name === needle;
}

/** True when a row renders without value columns and is excluded from totals */
export function isExcludedFromValues(row: LegendRow, config: LegendConfig): boolean {
  const selectors = config.no_values ?? [];
  return selectors.some((selector) => matchesSelector(row, selector));
}

/** Sums one statistic's raw buckets for the given type, ignoring gaps */
function sumRawStatistic(statistics: Statistics, statisticId: string, statType: StatType): number {
  const buckets = statistics[statisticId.trim()];
  if (!Array.isArray(buckets)) {
    return 0;
  }
  return buckets.reduce((total, bucket) => {
    const value = bucket?.[statType];
    return typeof value === "number" && Number.isFinite(value) ? total + value : total;
  }, 0);
}

function sumRawStatistics(
  statistics: Statistics,
  statisticIds: string[],
  statType: StatType
): number {
  return statisticIds.reduce((total, id) => total + sumRawStatistic(statistics, id, statType), 0);
}

/**
 * Computes the closing total row.
 *
 * `mode: "sum"` sums the *visible* rows passed in. `mode: "ratio"` sums the raw
 * statistics of `total.numerator`/`total.denominator` directly — these name
 * `statistic_id`s, not legend rows, so a ratio also works for statistics that
 * never became a row of their own, and row visibility has no effect on it.
 *
 * Returns `undefined` when no total row should be rendered.
 */
export function computeTotal(
  visibleRows: LegendRow[],
  config: LegendConfig,
  statistics: Statistics,
  localize: (key: string, fallback: string) => string
): LegendTotal | undefined {
  const total: LegendTotalConfig | undefined = config.total;
  if (!total || total.mode === "none") {
    return undefined;
  }

  if (total.mode === "ratio") {
    const statType = total.stat_type ?? "change";
    const numerator = sumRawStatistics(statistics, total.numerator ?? [], statType);
    const denominator = sumRawStatistics(statistics, total.denominator ?? [], statType);

    return {
      name:
        total.name ??
        localize("ui.panel.lovelace.cards.energy.energy_usage_graph.autarky", "Autarkie"),
      value: denominator === 0 ? 0 : (numerator / denominator) * 100,
      unit: total.unit ?? "%",
      precision: total.precision ?? 1,
    };
  }

  // mode "sum" (default)
  const rows = visibleRows.filter((row) => !isExcludedFromValues(row, config));
  const precision = config.precision ?? DEFAULT_PRECISION;
  const value = rows.reduce((sum, row) => sum + row.sum, 0);
  const units = new Set(rows.map((row) => row.unit).filter((unit) => unit));

  return {
    name: total.name ?? localize("ui.panel.lovelace.cards.energy.energy_usage_graph.total", "Gesamt"),
    // A mixed-unit sum is meaningless; the unit is dropped in that case.
    unit: total.unit ?? (units.size === 1 ? [...units][0] : ""),
    value,
    precision: total.precision ?? precision,
  };
}

/** Formats a number using the Home Assistant locale */
export function formatValue(
  value: number,
  precision: number,
  language: string | undefined
): string {
  try {
    return new Intl.NumberFormat(language || undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(value);
  } catch (_err) {
    return value.toFixed(precision);
  }
}
