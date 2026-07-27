declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

import "./energy-custom-legend-card";

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-custom-legend-card",
  name: "Energy Custom Legend",
  description:
    "Eigenständige Legende mit Farbe, Name und Statistikwerten je Zeile — optional um eine beliebige andere Karte gelegt und mit ihr verknüpft.",
  documentationURL: "https://github.com/Thyraz/energy-custom-legend",
});
