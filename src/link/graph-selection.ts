/**
 * Following the selection of a `custom-graph-card` (`ha-custom-graph`).
 *
 * That card reports every change of its click marker as a
 * `custom-graph-selection` event carrying the period the selected bucket
 * covers. The event bubbles *and* is composed, so it leaves the graph's shadow
 * root and travels up through whatever contains it.
 *
 * Only the graph embedded in this legend's own `card:` block is followed: the
 * listener sits on the legend element, so nothing a sibling card on the same
 * view emits can ever reach it. Without a `card:` block containing a
 * `custom-graph-card` there is no selection to follow.
 *
 * This is card-aware code, so it lives in `src/link/` like the adapters. Unlike
 * them it does not toggle visibility: it hands the legend a range, and the
 * legend then fetches and shows its values for exactly that period. Everything
 * downstream — calculations, units, the total row — stays unchanged.
 *
 * The payload is treated as untrusted: anything unparseable, or a `start` of
 * `null` (the card clearing its selection), reports "no selection" rather than
 * throwing.
 */

/** Event name as defined by `ha-custom-graph` (`SELECTION_EVENT` in its card.ts) */
export const GRAPH_SELECTION_EVENT = "custom-graph-selection";

/** Payload of {@link GRAPH_SELECTION_EVENT} */
export interface GraphSelectionDetail {
  /** Start of the selected bucket in epoch milliseconds, `null` when cleared */
  start?: number | null;
  /** End of the bucket (exclusive); `null` for an open-ended last bucket */
  end?: number | null;
  startTime?: string | null;
  endTime?: string | null;
}

/** A selected period; `end` is undefined for an open-ended last bucket */
export interface GraphSelection {
  start: Date;
  end?: Date;
}

function toTimestamp(value: unknown, iso: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof iso === "string") {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Reads one event payload. Returns `undefined` for a cleared or unusable
 * selection, which is the signal to fall back to the configured timespan.
 */
export function parseGraphSelection(detail: unknown): GraphSelection | undefined {
  if (!detail || typeof detail !== "object") {
    return undefined;
  }

  const { start, end, startTime, endTime } = detail as GraphSelectionDetail;
  const startMs = toTimestamp(start, startTime);
  if (startMs === undefined) {
    return undefined;
  }

  const endMs = toTimestamp(end, endTime);
  return {
    start: new Date(startMs),
    end: endMs !== undefined && endMs > startMs ? new Date(endMs) : undefined,
  };
}

/**
 * Listens for the selections of the graph inside `target` until the returned
 * function is called.
 *
 * `target` is the legend element itself, which bounds what is heard: the event
 * only passes it on its way up from a card rendered inside it. `origin()`
 * narrows that further to the wrapped card, so a graph that some other embedded
 * card brings along of its own does not drive the legend either.
 */
export function subscribeGraphSelection(
  target: EventTarget,
  origin: () => EventTarget | undefined,
  handler: (selection: GraphSelection | undefined) => void
): () => void {
  const listener = (event: Event): void => {
    const wrapped = origin();
    if (!wrapped || !event.composedPath().includes(wrapped)) {
      return;
    }
    handler(parseGraphSelection((event as CustomEvent).detail));
  };

  target.addEventListener(GRAPH_SELECTION_EVENT, listener);
  return () => target.removeEventListener(GRAPH_SELECTION_EVENT, listener);
}
