/**
 * Link adapter for cards that render a chart through Home Assistant's own
 * `ha-chart-base` element — `energy-custom-graph`, the built-in energy cards,
 * `history-chart` and anything else built on the frontend's chart wrapper.
 *
 * This deliberately targets `ha-chart-base` rather than any particular card:
 * it is a Home Assistant frontend element, so one adapter covers every card
 * built on it, and the cards themselves stay entirely unknown to us.
 *
 * Series visibility is *not* driven by ECharts' own legend selection — the HA
 * cards build their legend with `type: "custom", show: false`, so ECharts'
 * native `legendToggleSelect` action has no effect. `ha-chart-base` implements
 * its own toggle instead, tracked in a `_hiddenDatasets` set and applied via
 * `_handleDatasetToggle(id)` — the same method its own built-in legend calls on
 * a click, and which already resolves linked/secondary ids itself. It announces
 * every change with `dataset-hidden` / `dataset-unhidden` events, which is how
 * a toggle made *in the chart* finds its way back into the legend.
 *
 * Every access is optional-chained and guarded: if a future frontend version
 * renames these, `isHidden()` returns `undefined` and `toggle()` no-ops, leaving
 * the legend working on its own state instead of throwing on a dashboard.
 */

import type { LinkAdapter, LinkContext } from "./types";

type AnyRecord = Record<string, any>;

const CHART_TAG = "ha-chart-base";

/**
 * Depth-first search for an element, descending into shadow roots.
 *
 * Cards nest their chart several shadow roots deep, so a plain `querySelector`
 * from the outside never finds it. The depth limit keeps a pathological tree
 * (or a cycle introduced by a slotted element) from freezing the dashboard.
 */
function findDeep(root: ParentNode | null | undefined, selector: string, depth = 0): Element | undefined {
  if (!root || depth > 12) {
    return undefined;
  }

  // `root` itself may be a custom element whose content lives entirely in its
  // own shadow root (e.g. the `card:` element on the very first call) — its
  // light DOM is empty, so the checks below would never look inside it.
  const ownShadow = (root as unknown as HTMLElement).shadowRoot;
  if (ownShadow) {
    const found = findDeep(ownShadow, selector, depth + 1);
    if (found) {
      return found;
    }
  }

  const direct = root.querySelector?.(selector);
  if (direct) {
    return direct;
  }

  for (const element of Array.from(root.querySelectorAll?.("*") ?? [])) {
    const shadow = (element as HTMLElement).shadowRoot;
    if (shadow) {
      const found = findDeep(shadow, selector, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

/**
 * Locates the card the chart lives in.
 *
 * `target: card` (the default) uses the card rendered from our own `card:`
 * block. Any other value is a CSS selector resolved against the document —
 * that is the standalone case, where the legend and the chart card are separate
 * cards in a stack and the user points us at the other one.
 */
function resolveScope(context: LinkContext, target: string | undefined): ParentNode | undefined {
  if (!target || target === "card") {
    return context.wrappedCard;
  }
  return findDeep(document, target) ?? undefined;
}

export class ChartLinkAdapter implements LinkAdapter {
  private _target?: string;
  private _chartBase?: AnyRecord & EventTarget;
  private _context?: LinkContext;
  /** Mirrors the chart's hidden set, kept current through its own events */
  private _hidden = new Set<string>();

  constructor(target?: string) {
    this._target = target;
  }

  public attach(context: LinkContext): void {
    this._context = context;

    // `attach()` runs after every render of the legend, but the deep search is
    // expensive (it walks shadow roots). While the chart we already found is
    // still in the document, there is nothing to re-resolve.
    if (this._chartBase?.isConnected) {
      return;
    }

    const scope = resolveScope(context, this._target);
    const chartBase = scope ? (findDeep(scope, CHART_TAG) as unknown as AnyRecord & EventTarget) : undefined;

    if (chartBase === this._chartBase) {
      return;
    }

    this.detach();
    if (!chartBase) {
      return;
    }

    this._chartBase = chartBase;
    chartBase.addEventListener("dataset-hidden", this._onHidden);
    chartBase.addEventListener("dataset-unhidden", this._onUnhidden);
    this._syncHidden();
  }

  public detach(): void {
    this._chartBase?.removeEventListener("dataset-hidden", this._onHidden);
    this._chartBase?.removeEventListener("dataset-unhidden", this._onUnhidden);
    this._chartBase = undefined;
    this._hidden.clear();
  }

  /**
   * `_handleDatasetToggle()` flips a series, so it is only called for series not
   * already in the requested state. That keeps the series behind one legend row
   * in sync, and stops a click from re-hiding a series that was toggled in the
   * chart itself.
   */
  public toggle(target: string, hidden: boolean): void {
    const chartBase = this._chartBase;
    if (!chartBase || typeof chartBase._handleDatasetToggle !== "function") {
      return;
    }
    this._resolveSeriesIds(target).forEach((seriesId) => {
      if (this._hidden.has(seriesId) !== hidden) {
        chartBase._handleDatasetToggle(seriesId);
      }
    });
  }

  /**
   * With several matching series the target counts as hidden only once all of
   * them are, mirroring how the controller treats a row with several targets.
   */
  public isHidden(target: string): boolean | undefined {
    if (!this._chartBase) {
      return undefined;
    }
    const seriesIds = this._resolveSeriesIds(target);
    return seriesIds.length
      ? seriesIds.every((seriesId) => this._hidden.has(seriesId))
      : undefined;
  }

  /**
   * Maps a configured link target onto the actual series ids of the chart.
   *
   * Cards build ids in their own shapes — `energy-custom-graph` uses
   * `<statistic_id>:<stat_type>:<chart_type>:<index>` (and `calculation_<index>`
   * in place of the statistic for a calculated series), the built-in energy
   * cards mostly use the plain `statistic_id`. Users should not have to spell
   * either out, so an exact match wins, otherwise *every* id the target is a
   * segment prefix of matches: a legend row stands for a statistic, not for
   * whichever series of it happens to come first. Narrowing down to one series
   * is a matter of naming more segments (`sensor.x:mean`).
   *
   * With nothing matched the target is passed through unchanged as a best
   * effort — the chart may not have rendered its datasets yet.
   */
  private _resolveSeriesIds(target: string): string[] {
    const ids = this._seriesIds();
    if (!ids.length) {
      return [target];
    }
    if (ids.includes(target)) {
      return [target];
    }
    const matches = ids.filter((id) => id.startsWith(`${target}:`));
    return matches.length ? matches : [target];
  }

  /** Series ids currently rendered, read defensively from the chart's datasets */
  private _seriesIds(): string[] {
    const data = this._chartBase?.data;
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((series: AnyRecord) => series?.id)
      .filter((id: unknown): id is string => typeof id === "string");
  }

  /** Adopts the chart's current hidden set, e.g. after it re-rendered */
  private _syncHidden(): void {
    const hidden = this._chartBase?._hiddenDatasets;
    if (hidden instanceof Set) {
      this._hidden = new Set([...hidden].filter((id): id is string => typeof id === "string"));
    }
  }

  private _onHidden = (event: Event): void => {
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (id) {
      this._hidden.add(id);
      this._context?.notify();
    }
  };

  private _onUnhidden = (event: Event): void => {
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (id) {
      this._hidden.delete(id);
      this._context?.notify();
    }
  };
}
