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
 * a click. It announces every change with `dataset-hidden` / `dataset-unhidden`
 * events, which is how a toggle made *in the chart* finds its way back into the
 * legend.
 *
 * Two properties of that API shape this adapter, both of them verified against
 * `frontend/src/components/chart/ha-chart-base.ts` rather than assumed:
 *
 * - `_handleDatasetToggle(id)` resolves a legend item's `secondaryIds` itself,
 *   so it must be called with *legend* ids only. Passing it a primary and one of
 *   its own secondaries toggles twice and lands back where it started.
 * - The events carry only the primary id, while the chart hides every linked
 *   one — and `_updateHiddenStatsFromOptions()` changes the set without any
 *   event at all. An incrementally patched mirror therefore drifts; the set is
 *   re-read wholesale instead.
 *
 * Every access is optional-chained and guarded: if a future frontend version
 * renames these, `isHidden()` returns `undefined` and `toggle()` no-ops, leaving
 * the legend working on its own state instead of throwing on a dashboard.
 *
 * The chart is looked for inside the card's own `card:` block and nowhere else.
 * An earlier `target:` option took a CSS selector resolved against the whole
 * document, which made the search both broader and far more frequent than it
 * ever needed to be.
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

export class ChartLinkAdapter implements LinkAdapter {
  private _chartBase?: AnyRecord & EventTarget;
  private _context?: LinkContext;
  /** Element the listeners sit on, so `detach()` can remove them again */
  private _listeningOn?: EventTarget;
  /** Mirrors the chart's hidden set, kept current through its own events */
  private _hidden = new Set<string>();

  /**
   * Resolves the chart and keeps the listeners in place.
   *
   * Called only where the DOM may actually have changed — from the card's
   * `updated()`, i.e. after a render. The frequent, cheap path is `sync()`.
   */
  public attach(context: LinkContext): void {
    this._context = context;
    this._listen(context.host);
    const replaced = this._resolve();
    if (this._syncHidden() || replaced) {
      context.notify();
    }
  }

  /**
   * Re-reads the chart's hidden set without touching the DOM.
   *
   * This exists because not every change to that set announces itself:
   * `ha-chart-base` fills `_hiddenDatasets` from `legend.selected` in
   * `_updateHiddenStatsFromOptions()` on every options update, entirely without
   * an event ("No known need to remove items at this time", as the frontend puts
   * it). Reading a Set of a handful of strings is cheap enough to do on every
   * update of the card; walking the shadow DOM for it was not.
   *
   * The one exception is a chart that has left the document. The wrapped card
   * renders on its own schedule — a graph swaps its chart for a "loading"
   * placeholder and builds a new element afterwards — so the DOM does change
   * without this card rendering. A reference kept past that point reads and
   * toggles an element nobody sees. It is dropped here, with a single walk for
   * its successor; while there is no chart at all nothing is searched.
   */
  public sync(context: LinkContext): void {
    this._context = context;
    const replaced = this._isStale() ? this._resolve() : false;
    if (this._syncHidden() || replaced) {
      context.notify();
    }
  }

  public detach(): void {
    this._unlisten();
    this._chartBase = undefined;
    this._context = undefined;
    this._hidden.clear();
  }

  /**
   * Listens on the legend element itself rather than on the chart.
   *
   * `fireEvent` defaults to `bubbles: true, composed: true`
   * (`frontend/src/common/dom/fire_event.ts:78`) and `ha-chart-base` uses those
   * defaults, so the events cross every shadow boundary on their way up and
   * reach this card without a reference to their source. Binding here instead of
   * to the chart means a chart that appears late, is replaced, or is never found
   * at all costs nothing — and it mirrors what `graph-selection.ts` already does.
   *
   * The host bounds what is heard to cards rendered inside this one;
   * `_isOurs()` narrows that to the `card:` element.
   */
  private _listen(host: EventTarget): void {
    if (this._listeningOn === host) {
      return;
    }
    this._unlisten();
    host.addEventListener("dataset-hidden", this._onHidden);
    host.addEventListener("dataset-unhidden", this._onUnhidden);
    this._listeningOn = host;
  }

  private _unlisten(): void {
    this._listeningOn?.removeEventListener("dataset-hidden", this._onHidden);
    this._listeningOn?.removeEventListener("dataset-unhidden", this._onUnhidden);
    this._listeningOn = undefined;
  }

  /**
   * Locates the chart, but only while there is none.
   *
   * `toggle()` needs the element itself — `_handleDatasetToggle()` is the only
   * toggle API — and so does reading `_hiddenDatasets`. The search stays a
   * shadow-DOM walk because shadow DOM has no global query; what changed is how
   * often it runs. It used to run on every `hass` update whenever the chart had
   * not been found, which on a busy installation was several full walks per
   * second, for a DOM that had not changed in between.
   *
   * Returns whether a mirrored hidden state was discarded along with the chart
   * it belonged to — the legend has rendered that state and must hear about it,
   * which the comparison in `_syncHidden()` cannot tell once the mirror is empty.
   */
  private _resolve(): boolean {
    if (this._chartBase?.isConnected) {
      return false;
    }
    const scope = this._context?.wrappedCard;
    const found = scope
      ? (findDeep(scope, CHART_TAG) as unknown as AnyRecord & EventTarget | undefined)
      : undefined;
    if (found === this._chartBase) {
      return false;
    }
    this._chartBase = found;
    const discarded = this._hidden.size > 0;
    this._hidden.clear();
    return discarded;
  }

  /** Whether the chart held is one the wrapped card has since replaced */
  private _isStale(): boolean {
    return Boolean(this._chartBase) && !this._chartBase!.isConnected;
  }

  /**
   * Whether an event came from the card rendered from our own `card:` block.
   *
   * A second chart elsewhere on the view is not ours to control, and a card that
   * embeds a chart of its own would otherwise drive this legend too.
   */
  private _isOurs(event: Event): boolean {
    const wrapped = this._context?.wrappedCard;
    return Boolean(wrapped && event.composedPath().includes(wrapped));
  }

  /**
   * Takes the chart reference straight out of an event.
   *
   * The event starts at the `ha-chart-base` itself, so `composedPath()[0]` is
   * the element the walk would have looked for. Once the user has interacted
   * with the chart once, no search is needed at all — and a chart the walk could
   * not reach is picked up here anyway.
   */
  private _adoptFromEvent(event: Event): void {
    if (this._chartBase?.isConnected) {
      return;
    }
    const source = event.composedPath()[0] as (AnyRecord & EventTarget) | undefined;
    if ((source as unknown as Element)?.localName === CHART_TAG) {
      this._chartBase = source;
    }
  }

  /**
   * `_handleDatasetToggle()` flips a series, so it is only called for series not
   * already in the requested state. That keeps the series behind one legend row
   * in sync, and stops a click from re-hiding a series that was toggled in the
   * chart itself.
   *
   * Only *legend* ids are passed to it, never raw series ids: the method resolves
   * an item's `secondaryIds` itself, so handing it both a primary and one of its
   * secondaries would make the second call undo the first. That is exactly what
   * happens with a compare series (`<id>--compare` is a segment-prefix match for
   * the same target), which left the row permanently un-greyable.
   *
   * The chart is resolved again first. A click is rare enough to afford the
   * walk, and it is the one moment a stale or missing reference shows: the row
   * greyed out while the series stayed on screen, and only the second click —
   * after the render the first one caused had found the real chart — hid it.
   */
  public toggle(target: string, hidden: boolean): void {
    this._resolve();
    this._syncHidden();
    const chartBase = this._chartBase;
    if (!chartBase || typeof chartBase._handleDatasetToggle !== "function") {
      return;
    }
    this._legendIdsFor(target).forEach((legendId) => {
      if (this._hidden.has(legendId) !== hidden) {
        chartBase._handleDatasetToggle(legendId);
      }
    });
    // The events only carry the primary id while the chart hides every linked
    // one, so the mirror is re-read wholesale rather than patched.
    this._syncHidden();
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

  /**
   * The chart's custom legend items, each of which controls one primary id plus
   * any number of `secondaryIds`. `legend` may be a single object or a list
   * (`ha-chart-base` reads `ensureArray(options.legend)[0]`), and only a legend
   * of `type: "custom"` links ids at all — everything else yields no items, and
   * every series then stands for itself.
   */
  private _legendItems(): { id: string; secondaryIds: string[] }[] {
    const legend = this._chartBase?.options?.legend;
    const first = Array.isArray(legend) ? legend[0] : legend;
    if (!first || first.type !== "custom" || !Array.isArray(first.data)) {
      return [];
    }
    return first.data
      .filter((item: AnyRecord) => item && typeof item.id === "string")
      .map((item: AnyRecord) => ({
        id: item.id as string,
        secondaryIds: Array.isArray(item.secondaryIds)
          ? item.secondaryIds.filter((id: unknown): id is string => typeof id === "string")
          : [],
      }));
  }

  /**
   * The legend ids that control a target, deduplicated.
   *
   * A series may be a legend item's primary id or one of its secondaries; either
   * way the id that must be handed to `_handleDatasetToggle()` is the primary
   * one. Without a custom legend each series controls itself, which is the
   * behaviour of the built-in cards that build a plain legend.
   */
  private _legendIdsFor(target: string): string[] {
    const items = this._legendItems();
    const legendIds = this._resolveSeriesIds(target).map((seriesId) => {
      const owner = items.find(
        (item) => item.id === seriesId || item.secondaryIds.includes(seriesId)
      );
      return owner ? owner.id : seriesId;
    });
    return [...new Set(legendIds)];
  }

  /**
   * Adopts the chart's current hidden set wholesale. Returns whether anything
   * changed, and `false` too when the set could not be read at all — a renamed
   * internal then leaves the previous mirror standing instead of wiping it.
   */
  private _syncHidden(): boolean {
    const hidden = this._chartBase?._hiddenDatasets;
    if (!(hidden instanceof Set)) {
      return false;
    }
    const next = new Set([...hidden].filter((id): id is string => typeof id === "string"));
    if (next.size === this._hidden.size && [...next].every((id) => this._hidden.has(id))) {
      return false;
    }
    this._hidden = next;
    return true;
  }

  /**
   * Both events are handled the same way: re-read the whole set rather than
   * patch it with the single id the event carries, since the chart hides every
   * linked id but announces only the primary one. The incremental fallback keeps
   * the adapter working if `_hiddenDatasets` ever disappears.
   */
  private _onDatasetToggled = (event: Event, hidden: boolean): void => {
    if (!this._isOurs(event)) {
      return;
    }
    this._adoptFromEvent(event);

    if (!this._syncHidden()) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) {
        return;
      }
      if (hidden) {
        this._hidden.add(id);
      } else {
        this._hidden.delete(id);
      }
    }
    this._context?.notify();
  };

  private _onHidden = (event: Event): void => this._onDatasetToggled(event, true);

  private _onUnhidden = (event: Event): void => this._onDatasetToggled(event, false);
}
