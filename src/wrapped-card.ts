/**
 * Creates the element for the optional `card:` block.
 *
 * This uses Lovelace's own `loadCardHelpers().createCardElement()`, so *any*
 * card works — built-in, HACS, or one written tomorrow. The card is created from
 * its own untouched configuration: this card neither reads nor rewrites it, and
 * a card that fails to configure reports its error through Lovelace's own
 * `hui-error-card` exactly as it would anywhere else.
 */

import type { HomeAssistant, LovelaceCardConfig } from "custom-card-helpers";

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}

interface CardHelpers {
  createCardElement(config: LovelaceCardConfig): Promise<LovelaceCardElement> | LovelaceCardElement;
  createErrorCardElement?(error: string, config: unknown): LovelaceCardElement;
}

/** The parts of a Lovelace card element this card makes use of */
export interface LovelaceCardElement extends HTMLElement {
  hass?: HomeAssistant;
  layout?: string;
  setConfig?(config: LovelaceCardConfig): void;
  getCardSize?(): number | Promise<number>;
  getGridOptions?(): Record<string, unknown>;
}

/**
 * Builds the card element. Errors are turned into an error card rather than
 * being thrown, so a broken inner card never takes the legend down with it.
 *
 * The `await` on `loadCardHelpers()` is inside the `try` on purpose. It is a
 * frontend function this card does not own, and a rejecting one used to escape
 * as an unhandled rejection — the `card:` block then vanished from the legend
 * with no error anywhere on the dashboard, only in the console. It is the one
 * failure here that cannot be turned into an error card, because building one
 * needs the very helpers that failed to load; `undefined` at least renders the
 * legend rather than nothing.
 */
export async function createWrappedCard(
  config: LovelaceCardConfig
): Promise<LovelaceCardElement | undefined> {
  let helpers: CardHelpers | undefined;
  try {
    helpers = await window.loadCardHelpers?.();
  } catch (_err) {
    return undefined;
  }
  if (!helpers) {
    return undefined;
  }

  try {
    const element = await helpers.createCardElement(config);
    element.classList.add("wrapped-card");
    return element;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      return helpers.createErrorCardElement?.(message, config);
    } catch (_err) {
      return undefined;
    }
  }
}
