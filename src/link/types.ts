/**
 * The contract every link adapter implements.
 *
 * An adapter is the entire knowledge this card has about the component it
 * controls. The legend itself only ever deals with its own row keys and the
 * `link` target string configured for them — swapping in a different adapter is
 * what makes the card work with a chart card, an `input_boolean`, or anything
 * listening on the event bus, without a line of card-specific code elsewhere.
 */

import type { HomeAssistant } from "custom-card-helpers";

export interface LinkContext {
  /** The legend card itself, used to walk the DOM towards the target */
  host: HTMLElement;
  /** The element rendered from the `card:` block, when there is one */
  wrappedCard?: HTMLElement;
  hass?: HomeAssistant;
  /** Asks the card to re-read adapter state and re-render */
  notify: () => void;
}

export interface LinkAdapter {
  /** Called once the card is connected, and again whenever the target may have changed */
  attach(context: LinkContext): void;
  /**
   * Cheap refresh, called on updates the card decides not to render. An adapter
   * may re-read state it mirrors, but must not search the DOM as a matter of
   * course — that is what `attach()` is for. Replacing a target that has left
   * the document is the exception: the wrapped card renders without this one.
   */
  sync?(context: LinkContext): void;
  /** Called on disconnect; must remove every listener it registered */
  detach(): void;
  /**
   * User clicked a legend row. `target` is one of the row's resolved `link`
   * values, `hidden` the state it should end up in — adapters must drive the
   * target to that state rather than flipping it, since a row with several
   * targets would otherwise leave them out of sync.
   */
  toggle(target: string, hidden: boolean): void;
  /**
   * Visibility this adapter reports for a target, or `undefined` when it has no
   * opinion (target unknown, chart not rendered yet, entity unavailable). The
   * card then keeps its own state for that row.
   */
  isHidden(target: string): boolean | undefined;
}
