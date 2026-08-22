/**
 * Subscription to Home Assistant's energy date picker.
 *
 * `timespan.mode: energy` makes the legend follow the dashboard's date picker.
 * The picker's state lives in a collection cached on the websocket connection
 * (`hass.connection._energy_<panelUrl>`, historically `_energy`), which every
 * energy card subscribes to. Subscribing to the same collection is what keeps
 * the legend in sync with a neighbouring card *without* either knowing about
 * the other — the shared date picker is the only contact point.
 *
 * Ported from `energy-graph-cards/utils/energy-data.ts`, reduced to the range:
 * this card fetches its own statistics, so only `start`/`end` are of interest.
 */

import type { HomeAssistant } from "custom-card-helpers";

export interface EnergyRange {
  start: Date;
  end: Date;
}

type AnyRecord = Record<string, any>;

/**
 * Resolves the collection key. Home Assistant derives it from the panel url
 * (`_energy_<panelUrl>`); an explicit `collection_key` — the same option the
 * energy cards use to run several independent date pickers on one dashboard —
 * takes precedence.
 */
function collectionKeys(hass: HomeAssistant, configuredKey?: string): string[] {
  const keys: string[] = [];

  if (configuredKey) {
    keys.push(configuredKey.startsWith("energy_") ? `_${configuredKey}` : `_energy_${configuredKey}`);
  }

  const panelUrl = (hass as unknown as AnyRecord).panelUrl;
  if (typeof panelUrl === "string" && panelUrl) {
    keys.push(`_energy_${panelUrl}`);
  }

  keys.push("_energy_dashboard", "_energy");
  return keys;
}

/**
 * One synchronous look for the collection, without waiting.
 *
 * Used by the caller's fallback path to notice a collection that only appeared
 * later — an energy card added to the view, or a dashboard that took longer to
 * build than `waitForCollection()` was willing to wait.
 */
export function findEnergyCollection(
  hass: HomeAssistant,
  configuredKey?: string
): boolean {
  return collectionKeys(hass, configuredKey).some(
    (key) => (hass.connection as unknown as AnyRecord)[key]?.subscribe
  );
}

/**
 * Waits for the collection to appear on the connection. On a fresh page load the
 * energy card that creates it may not have rendered yet, so this retries with a
 * capped exponential backoff instead of giving up on the first miss.
 */
async function waitForCollection(
  hass: HomeAssistant,
  configuredKey: string | undefined,
  maxAttempts = 6
): Promise<AnyRecord | undefined> {
  const keys = collectionKeys(hass, configuredKey);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const key of keys) {
      const collection = (hass.connection as unknown as AnyRecord)[key];
      if (collection?.subscribe) {
        return collection;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(100 * 2 ** attempt, 2000)));
  }

  return undefined;
}

/**
 * Subscribes to the energy date picker and reports its range.
 *
 * Returns an unsubscribe function. When no collection turns up (the legend sits
 * on a dashboard without an energy card), `onMissing` is called once so the
 * caller can fall back to its own range — the legend then still shows data
 * instead of staying empty forever.
 */
export function subscribeEnergyRange(
  hass: HomeAssistant,
  configuredKey: string | undefined,
  onRange: (range: EnergyRange) => void,
  onMissing: () => void
): () => void {
  let active = true;
  let unsubscribe: (() => void) | undefined;

  void (async () => {
    const collection = await waitForCollection(hass, configuredKey);
    if (!active) {
      return;
    }

    if (!collection) {
      onMissing();
      return;
    }

    try {
      unsubscribe = collection.subscribe((data: AnyRecord) => {
        if (!active || !data?.start) {
          return;
        }
        const start = new Date(data.start);
        // The picker leaves `end` unset for "today"; the range then runs to now.
        const end = data.end ? new Date(data.end) : new Date();
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
          onRange({ start, end });
        }
      });
    } catch (_err) {
      onMissing();
    }
  })();

  return () => {
    active = false;
    unsubscribe?.();
  };
}
