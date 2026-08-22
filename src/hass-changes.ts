/**
 * Deciding whether a `hass` update can change what the legend renders.
 *
 * Home Assistant replaces `hass` on every state change in the whole house.
 * Almost none of them reach this card: the values come from the recorder on a
 * timer, not from entity state. What is left is a short, explicit list — and
 * keeping it here, free of `lit`, is what makes it checkable without a DOM.
 */

import { isDarkMode } from "./colors";
import type { HomeAssistant } from "custom-card-helpers";

/** The part of Lit's `PropertyValues` this decision needs */
export interface ChangedProperties {
  readonly size: number;
  has(key: string): boolean;
}

/**
 * Whether `hass` is the *only* thing that changed.
 *
 * The negative case is the important one. A bare `requestUpdate()` — which the
 * resize observer and the link controller both use — leaves `changedProps`
 * empty, and an empty set must render. Filtering on "nothing relevant changed"
 * instead would swallow exactly those two callers and pin the legend to the
 * layout it last measured.
 */
export function onlyHassChanged(changedProps: ChangedProperties): boolean {
  return changedProps.size === 1 && changedProps.has("hass");
}

/**
 * Whether the parts of `hass` the legend reads differ between two updates.
 *
 * `watchedEntities` are the link targets of the configured entities, and only
 * when an `entity` link is in play — that adapter is the only one deriving a
 * row's appearance from entity state. Pass an empty list otherwise: no state in
 * the house can then reach a row.
 */
export function hassAffectsRender(
  previous: HomeAssistant,
  next: HomeAssistant,
  watchedEntities: readonly string[]
): boolean {
  // Swatch colors may be given per theme mode, so a flip rebuilds the rows.
  if (isDarkMode(previous) !== isDarkMode(next)) {
    return true;
  }
  // Number formatting, and the fallback names of the total row.
  if (previous.locale?.language !== next.locale?.language) {
    return true;
  }
  if (previous.localize !== next.localize) {
    return true;
  }

  return watchedEntities.some(
    (entityId) => previous.states?.[entityId] !== next.states?.[entityId]
  );
}
