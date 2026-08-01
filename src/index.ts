declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

import "./energy-custom-legend-card";
import { CARD_NAME, CARD_VERSION } from "./version";

console.info(
  `%c  ${CARD_NAME.toUpperCase()}  \n%c  Version ${CARD_VERSION}  `,
  "color: #03a9f4; font-weight: bold; background: #1c1c1c",
  "color: #1c1c1c; font-weight: bold; background: #03a9f4",
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_NAME,
  name: "Energy Custom Legend",
  description:
    "Standalone legend with color, name and statistic values per row — optionally wrapped around any other card and linked to it.",
  documentationURL: "https://github.com/Thyraz/energy-custom-legend",
});
