/**
 * Energy Custom Legend Card
 *
 * A standalone legend: one row per configured statistic with a color swatch,
 * a name and aggregated values, clickable, plus an optional total row.
 *
 * Nothing here knows about any particular other card. The values come from this
 * card's own recorder queries (`src/data/`), the optional neighbouring card is
 * created generically through Lovelace's card helpers (`wrapped-card.ts`), and
 * the click interaction goes through pluggable adapters (`src/link/`). Removing
 * the `card:` and `link:` blocks leaves a fully working legend.
 */

import { LitElement, PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant } from "custom-card-helpers";

import { ResolvedConfig, columnsFor, normalizeConfig } from "./config/normalize";
import {
  EnergyCustomLegendCardConfig,
  LegendColumn,
  LegendConfig,
  LegendGroupResult,
  LegendRow,
} from "./config/types";
import { isDarkMode } from "./colors";
import { buildRows, collectStatTypes, collectStatisticIds } from "./data/aggregate";
import { subscribeEnergyRange } from "./data/energy-collection";
import { Statistics, StatisticsMetadata, fetchStatistics } from "./data/statistics";
import { ResolvedTimespan, periodFor, resolveTimespan } from "./data/timespan";
import {
  DEFAULT_PRECISION,
  buildLegendGroups,
  computeTotal,
  formatValue,
  isExcludedFromValues,
} from "./legend-stats";
import { legendStyles } from "./legend-styles";
import { LinkController } from "./link/controller";
import { LovelaceCardElement, createWrappedCard } from "./wrapped-card";

const COLUMN_LABELS: Record<LegendColumn, string> = {
  sum: "Σ",
  min: "Min",
  max: "Max",
  avg: "Ø",
};

/** How often a `relative` timespan is re-resolved and re-fetched */
const REFRESH_INTERVAL = 60_000;

@customElement("energy-custom-legend-card")
export class EnergyCustomLegendCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  /** Set by Home Assistant in section layouts, forwarded to the wrapped card */
  @property({ attribute: false }) public layout?: string;

  @state() private _config?: ResolvedConfig;
  @state() private _rows: LegendRow[] = [];
  @state() private _error?: string;

  /** Raw buckets kept for `legend.total.mode: ratio`, which bypasses the rows */
  private _statistics: Statistics = {};
  /** Kept alongside `_statistics` so rows can be rebuilt without refetching */
  private _metadata: StatisticsMetadata = {};
  /** Tracked so a system-triggered theme flip can rebuild rows without a fetch */
  private _darkMode = false;
  private _wrappedCard?: LovelaceCardElement;
  private _links = new LinkController(() => this.requestUpdate());

  private _unsubscribeEnergy?: () => void;
  private _refreshTimer?: number;
  /** Range currently displayed; for `mode: energy` it comes from the date picker */
  private _range?: ResolvedTimespan;
  /** Guards against an out-of-order fetch overwriting a newer one */
  private _fetchToken = 0;

  public static getStubConfig(): EnergyCustomLegendCardConfig {
    return {
      type: "custom:energy-custom-legend-card",
      entities: [],
      legend: { columns: ["sum"] },
    } as EnergyCustomLegendCardConfig;
  }

  public setConfig(config: EnergyCustomLegendCardConfig): void {
    // Throws on genuinely unrenderable configs; the message surfaces in the
    // Lovelace editor.
    this._config = normalizeConfig(config);
    this._error = undefined;
    this._rows = [];
    this._statistics = {};
    this._metadata = {};

    this._links.configure(
      this._config.links,
      this._config.entities.filter((entity) => entity.hiddenByDefault).map((entity) => entity.link)
    );

    void this._setupWrappedCard(config);
    this._restartTimespan();
  }

  /* ---------------------------------------------------------------------- */
  /* Wrapped card                                                            */
  /* ---------------------------------------------------------------------- */

  private async _setupWrappedCard(config: EnergyCustomLegendCardConfig): Promise<void> {
    if (!config.card) {
      this._wrappedCard = undefined;
      this.requestUpdate();
      return;
    }

    this._wrappedCard = await createWrappedCard(config.card);
    if (this._wrappedCard) {
      if (this.hass) {
        this._wrappedCard.hass = this.hass;
      }
      if (this.layout !== undefined) {
        this._wrappedCard.layout = this.layout;
      }
    }
    this.requestUpdate();
  }

  /* ---------------------------------------------------------------------- */
  /* Timespan and data                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Restarts whatever drives the displayed range: a subscription to the energy
   * date picker for `mode: energy`, a periodic re-resolve for `mode: relative`,
   * or a one-off resolve for `mode: fixed`.
   */
  private _restartTimespan(): void {
    this._stopTimespan();

    const timespan = this._config?.raw.timespan;
    const mode = timespan?.mode ?? "energy";

    if (mode === "energy") {
      if (!this.hass) {
        return; // retried from willUpdate() once hass arrives
      }
      this._unsubscribeEnergy = subscribeEnergyRange(
        this.hass,
        timespan?.collection_key,
        (range) => this._setRange(range),
        // No energy dashboard on this view: fall back to today so the legend
        // shows data rather than staying empty forever.
        () => this._setRange(resolveTimespan({ mode: "relative", period: "day" })!)
      );
      return;
    }

    const range = resolveTimespan(timespan);
    if (range) {
      this._setRange(range);
    }

    if (mode === "relative") {
      this._refreshTimer = window.setInterval(() => {
        const next = resolveTimespan(this._config?.raw.timespan);
        if (next) {
          this._setRange(next);
        }
      }, REFRESH_INTERVAL);
    }
  }

  private _stopTimespan(): void {
    this._unsubscribeEnergy?.();
    this._unsubscribeEnergy = undefined;
    if (this._refreshTimer !== undefined) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  private _setRange(range: ResolvedTimespan): void {
    this._range = range;
    void this._fetch();
  }

  private async _fetch(): Promise<void> {
    const config = this._config;
    const range = this._range;
    if (!config || !range || !this.hass) {
      return;
    }

    const total = config.raw.legend?.total;
    const ratio = total?.mode === "ratio";
    const statisticIds = collectStatisticIds(
      config.entities,
      ratio ? total?.numerator : [],
      ratio ? total?.denominator : []
    );
    const statTypes = collectStatTypes(config.entities, ratio ? total?.stat_type ?? "change" : undefined);
    const period = periodFor(config.raw.aggregation?.period, range);

    const token = ++this._fetchToken;
    try {
      const result = await fetchStatistics(
        this.hass,
        statisticIds,
        range.start,
        range.end,
        period,
        statTypes
      );
      if (token !== this._fetchToken) {
        return; // a newer fetch already landed
      }
      this._statistics = result.statistics;
      this._metadata = result.metadata;
      this._rows = buildRows(config.entities, result.statistics, result.metadata, this.hass);
      this._error = undefined;
    } catch (err) {
      if (token !== this._fetchToken) {
        return;
      }
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                               */
  /* ---------------------------------------------------------------------- */

  protected willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has("hass")) {
      if (this._wrappedCard && this.hass) {
        this._wrappedCard.hass = this.hass;
      }
      // `mode: energy` needs `hass` to subscribe, which may only arrive after
      // setConfig(); the first hass sets everything in motion.
      const previous = changedProps.get("hass") as HomeAssistant | undefined;
      if (!previous && this.hass) {
        this._restartTimespan();
      }

      // Swatch colors may differ per theme mode (`color: {light, dark}`); a
      // system-triggered flip changes `hass.themes.darkMode` without any other
      // config change, so rows are rebuilt in place instead of refetched.
      const darkMode = isDarkMode(this.hass);
      if (darkMode !== this._darkMode) {
        this._darkMode = darkMode;
        if (this._config && this._rows.length) {
          this._rows = buildRows(this._config.entities, this._statistics, this._metadata, this.hass);
        }
      }
    }
    if (changedProps.has("layout") && this._wrappedCard) {
      this._wrappedCard.layout = this.layout;
    }
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    // Re-resolved on every update: the wrapped card may only have rendered its
    // chart by now, and Home Assistant can recreate it across view switches.
    this._links.attach(this, this._wrappedCard, this.hass);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (this._config) {
      this._restartTimespan();
    }
    this._links.attach(this, this._wrappedCard, this.hass);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTimespan();
    this._links.detach();
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering                                                               */
  /* ---------------------------------------------------------------------- */

  private get _legendConfig(): LegendConfig {
    return this._config?.raw.legend ?? {};
  }

  private _groups(): LegendGroupResult[] {
    return buildLegendGroups(this._rows, this._legendConfig);
  }

  private _localize = (key: string, fallback: string): string =>
    (this.hass as unknown as { localize?: (key: string) => string })?.localize?.(key) || fallback;

  private _format(value: number, precision: number): string {
    return formatValue(value, precision, this.hass?.locale?.language);
  }

  private _handleLegendClick(row: LegendRow): void {
    this._links.toggle(row.link);
  }

  protected render() {
    if (!this._config) {
      return nothing;
    }

    const groups = this._groups();

    return html`
      <ha-card>
        ${this._config.raw.title
          ? html`<h1 class="card-header">${this._config.raw.title}</h1>`
          : nothing}
        ${this._wrappedCard
          ? html`<div class="card-slot">${this._wrappedCard}</div>`
          : nothing}
        ${this._error ? html`<div class="notice">${this._error}</div>` : nothing}
        ${groups.some((group) => group.rows.length)
          ? html`<div class="legend">${groups.map((group) => this._renderGroup(group))}</div>`
          : nothing}
      </ha-card>
    `;
  }

  private _renderGroup(group: LegendGroupResult) {
    if (!group.rows.length) {
      return nothing;
    }

    const columns = columnsFor(group.config.columns);
    // 52px color cell + flexible name + one column per value
    const gridColumns = `52px 1fr ${columns.map(() => "auto").join(" ")}`;
    const visibleRows = group.rows.filter((row) => !this._links.isHidden(row.link));
    const total = computeTotal(visibleRows, group.config, this._statistics, this._localize);

    return html`
      <div class="legend-group">
        ${group.name ? html`<div class="legend-group-title">${group.name}</div>` : nothing}
        ${group.config.show_headers
          ? html`
              <div class="legend-headers" style="--ecl-columns: ${gridColumns}">
                <span></span>
                <span></span>
                ${columns.map(
                  (column) => html`<span class="legend-value">${COLUMN_LABELS[column]}</span>`
                )}
              </div>
            `
          : nothing}
        ${group.rows.map((row) => this._renderRow(row, group.config, columns, gridColumns))}
        ${total
          ? html`
              <div class="legend-total">
                <span class="legend-name">${total.name}</span>
                <span class="legend-value">
                  ${this._format(total.value, total.precision)}${total.unit ? ` ${total.unit}` : ""}
                </span>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderRow(
    row: LegendRow,
    config: LegendConfig,
    columns: LegendColumn[],
    gridColumns: string
  ) {
    const hidden = this._links.isHidden(row.link);
    const precision = config.precision ?? DEFAULT_PRECISION;
    const showUnit = config.show_unit !== false;
    const unit = showUnit && row.unit ? ` ${row.unit}` : "";
    const noValues = isExcludedFromValues(row);

    return html`
      <div
        class="legend-item ${hidden ? "hidden" : ""}"
        style="--ecl-columns: ${gridColumns}"
        role="button"
        tabindex="0"
        @click=${() => this._handleLegendClick(row)}
        @keydown=${(ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            this._handleLegendClick(row);
          }
        }}
      >
        <span
          class="legend-icon"
          style="background-color: ${hidden
            ? "transparent"
            : row.fillColor}; border-color: ${row.color}"
        ></span>
        <span class="legend-name">${row.name}</span>
        ${noValues
          ? columns.map(() => html`<span class="legend-value"></span>`)
          : columns.map(
              (column) => html`<span class="legend-value"
                >${this._format(row[column], precision)}${unit}</span
              >`
            )}
      </div>
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* Sizing                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Rows the legend adds on top of whatever the wrapped card needs */
  private _extraRows(): number {
    return this._groups().reduce((sum, group) => {
      if (!group.rows.length) {
        return sum;
      }
      const rowLines = Math.max(1, Math.ceil(group.rows.length / 2));
      const heading = group.name ? 1 : 0;
      const totalRow = group.config.total && group.config.total.mode !== "none" ? 1 : 0;
      return sum + rowLines + heading + totalRow;
    }, 0);
  }

  public async getCardSize(): Promise<number> {
    const innerSize = this._wrappedCard ? ((await this._wrappedCard.getCardSize?.()) ?? 6) : 0;
    return innerSize + this._extraRows();
  }

  public getGridOptions(): Record<string, unknown> {
    const innerOptions = this._wrappedCard?.getGridOptions?.() ?? {};
    const extra = this._extraRows();
    const base = this._wrappedCard ? 6 : 0;
    const rows = typeof innerOptions.rows === "number" ? innerOptions.rows : base;
    const minRows = typeof innerOptions.min_rows === "number" ? innerOptions.min_rows : base;

    return {
      ...innerOptions,
      rows: rows + extra,
      min_rows: minRows + extra,
    };
  }

  static styles = [
    legendStyles,
    css`
      /* The wrapped card brings its own <ha-card>; neutralize it so it and the
         legend share this card's surface. */
      .wrapped-card {
        display: block;
        --ha-card-background: transparent;
        --ha-card-box-shadow: none;
        --ha-card-border-width: 0;
        --ha-card-border-radius: 0;
        --card-background-color: transparent;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "energy-custom-legend-card": EnergyCustomLegendCard;
  }
}
