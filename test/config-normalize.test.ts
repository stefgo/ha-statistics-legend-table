/**
 * First tests of the card — the scaffold the suite grows from.
 *
 * `normalizeConfig` is the entry point of every dashboard: Lovelace calls it
 * from `setConfig()` on every keystroke in the editor. It is pure and needs no
 * DOM, which is what makes it the natural place to start testing.
 */
import { describe, expect, it } from "vitest";

import { columnsFor, normalizeConfig } from "../src/config/normalize";
import type { StatisticsLegendTableCardConfig } from "../src/config/types";

const config = (
  overrides: Partial<StatisticsLegendTableCardConfig> = {}
): StatisticsLegendTableCardConfig =>
  ({
    type: "custom:statistics-legend-table",
    entities: [{ statistic_id: "sensor.energy" }],
    ...overrides,
  }) as StatisticsLegendTableCardConfig;

describe("normalizeConfig", () => {
  it("accepts a minimal configuration", () => {
    const resolved = normalizeConfig(config());
    expect(resolved.entities).toHaveLength(1);
  });

  it("requires at least one entity", () => {
    expect(() => normalizeConfig(config({ entities: [] }))).toThrow(/entities/);
  });

  it("rejects duplicate entity keys", () => {
    expect(() =>
      normalizeConfig(
        config({
          entities: [
            { statistic_id: "sensor.energy" },
            { statistic_id: "sensor.energy" },
          ],
        })
      )
    ).toThrow(/Duplicate entity key/);
  });

  it("rejects an unknown enum value", () => {
    expect(() =>
      normalizeConfig(config({ timespan: { mode: "nonsense" as never } }))
    ).toThrow(/timespan.mode/);
  });
});

describe("columnsFor", () => {
  it("falls back to sum", () => {
    expect(columnsFor(undefined)).toEqual(["sum"]);
    expect(columnsFor([])).toEqual(["sum"]);
    expect(columnsFor(["nonsense" as never])).toEqual(["sum"]);
  });

  it("keeps the configured columns", () => {
    expect(columnsFor(["avg", "max"])).toEqual(["avg", "max"]);
  });
});
