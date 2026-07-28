/**
 * Link adapter that toggles a Home Assistant entity, typically an
 * `input_boolean` helper.
 *
 * This is the universal escape hatch: it makes no assumption whatsoever about
 * the other card. Anything that can react to an entity state — a `conditional`
 * card, a template, `card_mod`, an automation — can be driven from a legend
 * click, which is how cards without any toggle API of their own (such as
 * `power-flow-card-plus`) are covered.
 *
 * It is also the only adapter whose state survives a reload, since the entity,
 * not the card, holds it.
 */

import type { HomeAssistant } from "custom-card-helpers";

import type { LinkAdapter, LinkContext } from "./types";

const DEFAULT_SERVICE = "homeassistant.toggle";
const DEFAULT_HIDDEN_STATE = "off";

export class EntityLinkAdapter implements LinkAdapter {
  private _service: string;
  private _hiddenState: string;
  private _hass?: HomeAssistant;

  constructor(service?: string, hiddenState?: string) {
    this._service = service || DEFAULT_SERVICE;
    this._hiddenState = hiddenState || DEFAULT_HIDDEN_STATE;
  }

  public attach(context: LinkContext): void {
    // `hass` is replaced wholesale on every state change, so re-reading it here
    // (the card re-attaches on update) is what keeps `isHidden()` current — no
    // separate subscription is needed.
    this._hass = context.hass;
  }

  public detach(): void {
    this._hass = undefined;
  }

  /**
   * The configured service is typically `homeassistant.toggle`, i.e. it flips
   * the entity — so a call is skipped when the entity already reports the
   * requested state. Otherwise a row linking several entities would toggle one
   * of them back out of sync.
   */
  public toggle(target: string, hidden: boolean): void {
    const hass = this._hass;
    if (!hass || !target.includes(".")) {
      return;
    }
    if (this.isHidden(target) === hidden) {
      return;
    }
    const [domain, service] = this._service.split(".");
    if (!domain || !service) {
      return;
    }
    void hass.callService(domain, service, { entity_id: target });
  }

  public isHidden(target: string): boolean | undefined {
    const state = this._hass?.states?.[target]?.state;
    if (state === undefined || state === "unavailable" || state === "unknown") {
      return undefined;
    }
    return state === this._hiddenState;
  }
}
