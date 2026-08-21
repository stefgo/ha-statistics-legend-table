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
import {
  buildRows,
  collectRatioTotals,
  collectStatTypes,
  collectStatisticIds,
} from "./data/aggregate";
import { findEnergyCollection, subscribeEnergyRange } from "./data/energy-collection";
import { Statistics, StatisticsMetadata, fetchStatistics } from "./data/statistics";
import {
  ResolvedTimespan,
  periodFor,
  periodForSelection,
  resolveTimespan,
} from "./data/timespan";
import {
  DEFAULT_PRECISION,
  buildLegendGroups,
  computeTotal,
  formatValue,
  isExcludedFromValues,
} from "./legend-stats";
import { legendStyles } from "./legend-styles";
import { LinkController } from "./link/controller";
import { GraphSelection, subscribeGraphSelection } from "./link/graph-selection";
import { LovelaceCardElement, createWrappedCard } from "./wrapped-card";

const COLUMN_LABELS: Record<LegendColumn, string> = {
  sum: "Σ",
  min: "Min",
  max: "Max",
  avg: "Ø",
};

/** How often a `relative` timespan is re-resolved and re-fetched */
const REFRESH_INTERVAL = 60_000;

/* Legend metrics, mirroring `legend-styles.ts`. Only used to estimate how much
   height the legend adds — see `_legendHeight()`. */

/** One legend line: 14px text at the inherited line-height of 1.6 */
const LEGEND_LINE_HEIGHT = 22;
/** `gap` of `.legend` and `.legend-group` */
const LEGEND_GAP = 16;
/** `.legend` margin-top plus its bottom padding */
const LEGEND_PADDING = 24;

/** `--ha-section-grid-row-gap` */
const GRID_ROW_GAP = 8;
/** One row of a Home Assistant section grid, including its gap
    (`--ha-section-grid-row-height` 56px + `GRID_ROW_GAP`). A card spanning n
    rows is given `n * GRID_ROW_HEIGHT - GRID_ROW_GAP` pixels — the trailing gap
    falls outside the card. */
const GRID_ROW_HEIGHT = 64;
/** Roughly one `getCardSize()` unit in a masonry view */
const MASONRY_UNIT = 50;

/**
 * A readable message for anything that can come out of a failed fetch.
 *
 * `hass.callWS()` does not reject with an `Error` but with a plain
 * `{code, message}` object, so the naive `String(err)` produced the useless
 * `[object Object]` in exactly the situation where the user needs to be told
 * what went wrong.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === "object") {
    const { message, code } = err as { message?: unknown; code?: unknown };
    if (typeof message === "string" && message) {
      return typeof code === "string" && code ? `${message} (${code})` : message;
    }
    if (typeof code === "string" && code) {
      return code;
    }
  }
  return typeof err === "string" && err ? err : "Could not load statistics";
}

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
  private _unsubscribeSelection?: () => void;
  private _refreshTimer?: number;
  /** Range currently displayed; for `mode: energy` it comes from the date picker */
  private _range?: ResolvedTimespan;
  /**
   * Period selected in a neighbouring `custom-graph-card`. While set it takes
   * the place of `_range` for every value the legend shows; clearing the
   * selection in the graph brings the configured range back.
   */
  private _selection?: ResolvedTimespan;
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
      this._config.entities
        .filter((entity) => entity.hiddenByDefault)
        .flatMap((entity) => entity.links)
    );

    this._selection = undefined;

    void this._setupWrappedCard(config);
    this._updateSelectionSubscription();
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
        () => this._startEnergyFallback()
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

  /**
   * Fallback for `mode: energy` when no energy collection can be found.
   *
   * Showing today once and then stopping left the legend frozen: no refresh, so
   * the values aged for as long as the dashboard stayed open, and past midnight
   * it showed the wrong day outright. It now behaves like `mode: relative` with
   * `period: day` — and re-checks for the collection on every tick, so a
   * dashboard whose energy card only appeared later is picked up instead of
   * being missed for the rest of the session.
   */
  private _startEnergyFallback(): void {
    const today = () => resolveTimespan({ mode: "relative", period: "day" })!;
    this._setRange(today());

    if (this._refreshTimer !== undefined) {
      return;
    }
    this._refreshTimer = window.setInterval(() => {
      const collectionKey = this._config?.raw.timespan?.collection_key;
      if (this.hass && findEnergyCollection(this.hass, collectionKey)) {
        // The real thing turned up — hand back over to the date picker.
        this._restartTimespan();
        return;
      }
      this._setRange(today());
    }, REFRESH_INTERVAL);
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
    // A selection outside the new range is stale — it points into the range
    // that was just left. The graph clears its own marker on a range switch
    // too, but the order of the two events is not guaranteed, so the legend
    // does not rely on it. A selection that still lies inside the new range is
    // kept, which is what makes a `relative` timespan usable: its window moves
    // on every refresh without dropping the selection each time.
    const selection = this._selection;
    if (
      selection &&
      (selection.start.getTime() < range.start.getTime() ||
        selection.start.getTime() >= range.end.getTime())
    ) {
      this._selection = undefined;
    }
    void this._fetch();
  }

  private async _fetch(): Promise<void> {
    const config = this._config;
    const range = this._selection ?? this._range;
    if (!config || !range || !this.hass) {
      return;
    }

    // Both the top-level total and any group override may be a ratio, and each
    // names its own operands — a group ratio whose statistics went unfetched
    // rendered a constant 0 %.
    const ratioTotals = collectRatioTotals(config.raw.legend);
    const statisticIds = collectStatisticIds(config.entities, ratioTotals);
    const statTypes = collectStatTypes(config.entities, ratioTotals);
    const period = this._selection
      ? periodForSelection(config.raw.aggregation?.period, range)
      : periodFor(config.raw.aggregation?.period, range);

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
      this._error = describeError(err);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Graph selection                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * (Un)subscribes to the `custom-graph-selection` event of the card in the
   * `card:` block, according to `timespan.follow_selection` (defaults to on).
   */
  private _updateSelectionSubscription(): void {
    const follow = this._config?.raw.timespan?.follow_selection !== false;
    if (!follow) {
      this._stopSelection();
      return;
    }
    if (this._unsubscribeSelection) {
      return;
    }
    // Bound to this element and to the wrapped card, so only the graph this
    // legend actually embeds can move its range.
    this._unsubscribeSelection = subscribeGraphSelection(
      this,
      () => this._wrappedCard,
      (selection) => this._applySelection(selection)
    );
  }

  private _stopSelection(): void {
    this._unsubscribeSelection?.();
    this._unsubscribeSelection = undefined;
  }

  /**
   * Takes over the period a graph reports, or falls back to the configured
   * range when the selection is cleared. The values are refetched for that
   * period rather than derived from the ones already held: the graph buckets
   * on its own axis, so the period may be finer than anything this card has
   * queried, and a fetch is the only answer that stays correct for `sum`,
   * `min`/`max`/`avg`, calculated rows and `total.mode: ratio` alike.
   */
  private _applySelection(selection: GraphSelection | undefined): void {
    const next = selection ? this._selectionRange(selection) : undefined;

    const same =
      next?.start.getTime() === this._selection?.start.getTime() &&
      next?.end.getTime() === this._selection?.end.getTime();
    if (same) {
      return;
    }

    this._selection = next;
    void this._fetch();
  }

  /**
   * The selected period as a closed range. An open-ended last bucket — the
   * graph reports no `end` for it — runs to the end of the configured range,
   * so the still-running bucket shows the values it has so far.
   */
  private _selectionRange(selection: GraphSelection): ResolvedTimespan | undefined {
    const fallbackEnd = this._range?.end ?? new Date();
    const end = selection.end ?? fallbackEnd;
    return end.getTime() > selection.start.getTime()
      ? { start: selection.start, end }
      : undefined;
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
      this._updateSelectionSubscription();
      this._restartTimespan();
    }
    this._links.attach(this, this._wrappedCard, this.hass);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTimespan();
    this._stopSelection();
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
    this._links.toggle(row.links);
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
    const visibleRows = group.rows.filter((row) => !this._links.isHidden(row.links));
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
    const hidden = this._links.isHidden(row.links);
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

  /**
   * Approximate height in pixels the legend adds on top of the wrapped card.
   *
   * Estimated rather than measured because both callers run before layout. The
   * previous estimate counted half a row per legend row, which assumed a
   * two-column layout — but `.legend-group` is `flex-direction: column`, so
   * every row is a line of its own. In a section that under-estimate clipped the
   * legend outright: a numeric `rows` puts Home Assistant's grid into
   * `fit-rows`, which pins the card to `rows * 64 - 8` pixels.
   *
   * Headings and column headers use a smaller font than the rows but are
   * counted as full lines. Over-estimating costs some whitespace;
   * under-estimating costs content.
   */
  private _legendHeight(): number {
    const groups = this._groups().filter((group) => group.rows.length);
    if (!groups.length) {
      return 0;
    }

    const lines = groups.reduce(
      (sum, group) =>
        sum +
        group.rows.length +
        (group.name ? 1 : 0) +
        (group.config.show_headers ? 1 : 0) +
        (group.config.total && group.config.total.mode !== "none" ? 1 : 0),
      0
    );

    // n lines carry n-1 gaps between them, plus one more between each pair of
    // groups (`.legend` and `.legend-group` share the same gap).
    const gaps = Math.max(0, lines - 1) + Math.max(0, groups.length - 1);
    return LEGEND_PADDING + lines * LEGEND_LINE_HEIGHT + gaps * LEGEND_GAP;
  }

  /** Grid rows the legend adds on top of whatever the wrapped card needs */
  private _extraRows(): number {
    const height = this._legendHeight();
    // n rows are worth `n * GRID_ROW_HEIGHT - GRID_ROW_GAP` pixels, so the gap
    // has to be added back before dividing — without it a legend lands one or
    // two pixels short of a row boundary and is clipped again.
    return height ? Math.ceil((height + GRID_ROW_GAP) / GRID_ROW_HEIGHT) : 0;
  }

  public async getCardSize(): Promise<number> {
    const innerSize = this._wrappedCard ? ((await this._wrappedCard.getCardSize?.()) ?? 6) : 0;
    const height = this._legendHeight();
    return innerSize + (height ? Math.ceil(height / MASONRY_UNIT) : 0);
  }

  public getGridOptions(): Record<string, unknown> {
    const innerOptions = this._wrappedCard?.getGridOptions?.() ?? {};
    const extra = this._extraRows();
    const base = this._wrappedCard ? 6 : 0;
    const rows = typeof innerOptions.rows === "number" ? innerOptions.rows : base;
    const minRows = typeof innerOptions.min_rows === "number" ? innerOptions.min_rows : base;
    // The wrapped card may cap itself at fewer rows than the legend now needs;
    // a `max_rows` below `rows` would clip the legend again.
    const maxRows =
      typeof innerOptions.max_rows === "number"
        ? Math.max(innerOptions.max_rows + extra, rows + extra)
        : undefined;

    return {
      ...innerOptions,
      rows: rows + extra,
      min_rows: minRows + extra,
      ...(maxRows === undefined ? {} : { max_rows: maxRows }),
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
