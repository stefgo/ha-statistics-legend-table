/**
 * Owns the legend's visibility state and fans clicks out to the adapters.
 *
 * The card never talks to an adapter directly — it asks the controller whether a
 * row is hidden and tells it when one was clicked. Without any `link` block the
 * controller is simply local state, which is why a standalone legend still
 * greys out rows and still updates a `total: {mode: sum}` on click.
 */

import type { HomeAssistant } from "custom-card-helpers";

import type { LinkConfig } from "../config/types";
import { ChartLinkAdapter } from "./chart-adapter";
import { EntityLinkAdapter } from "./entity-adapter";
import { EventLinkAdapter } from "./event-adapter";
import type { LinkAdapter, LinkContext } from "./types";

function createAdapter(config: LinkConfig): LinkAdapter | undefined {
  switch (config.mode) {
    case "chart":
      return new ChartLinkAdapter(config.target);
    case "entity":
      return new EntityLinkAdapter(config.service, config.hidden_state);
    case "event":
      return new EventLinkAdapter(config.link_id);
    default:
      return undefined;
  }
}

export class LinkController {
  private _adapters: LinkAdapter[] = [];
  private _context?: LinkContext;
  /** Fallback state for rows no adapter has an opinion about */
  private _hidden = new Set<string>();
  private _notify: () => void;

  constructor(notify: () => void) {
    this._notify = notify;
  }

  /** Rebuilds the adapters after a config change */
  public configure(links: LinkConfig[], hiddenByDefault: string[]): void {
    this.detach();
    this._adapters = links
      .map(createAdapter)
      .filter((adapter): adapter is LinkAdapter => Boolean(adapter));
    this._hidden = new Set(hiddenByDefault);
  }

  /**
   * (Re-)resolves every adapter's target. Called on connect and after each
   * update, since the wrapped card may only have rendered its chart by then.
   */
  public attach(host: HTMLElement, wrappedCard: HTMLElement | undefined, hass: HomeAssistant | undefined): void {
    this._context = { host, wrappedCard, hass, notify: this._notify };
    this._adapters.forEach((adapter) => adapter.attach(this._context!));
  }

  public detach(): void {
    this._adapters.forEach((adapter) => adapter.detach());
    this._context = undefined;
  }

  /**
   * Whether a row is hidden. The first adapter with an opinion wins, so a chart
   * toggled directly (or an entity switched elsewhere) is reflected in the
   * legend; local state only fills in when nobody knows better.
   */
  public isHidden(target: string): boolean {
    for (const adapter of this._adapters) {
      const hidden = adapter.isHidden(target);
      if (hidden !== undefined) {
        return hidden;
      }
    }
    return this._hidden.has(target);
  }

  /** Handles a click on a legend row */
  public toggle(target: string): void {
    const hidden = !this.isHidden(target);

    if (hidden) {
      this._hidden.add(target);
    } else {
      this._hidden.delete(target);
    }

    this._adapters.forEach((adapter) => adapter.toggle(target, hidden));
    this._notify();
  }
}
