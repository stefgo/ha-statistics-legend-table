declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

import "./energy-custom-legend-card";
import { CARD_NAME, CARD_VERSION } from "./version";

console.info(
  "%c ENERGY-CUSTOM-LEGEND-CARD %c " + CARD_VERSION + " ",
  "background-color: #000000; color: #4CAF50; font-weight: bold;",
  "background-color: #666666; color: #FFFFFF; font-weight: bold;",
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_NAME,
  name: "Energy Custom Legend",
  description:
    "Standalone legend with color, name and statistic values per row — optionally wrapped around any other card and linked to it.",
  documentationURL: "https://github.com/Thyraz/energy-custom-legend",
});
