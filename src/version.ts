// Replaced at build time by rollup (@rollup/plugin-replace) with the version
// from package.json. The fallback keeps `tsc --noEmit` and unbundled use happy.
declare const __CARD_VERSION__: string;

export const CARD_NAME = "energy-custom-legend-card";

export const CARD_VERSION =
  typeof __CARD_VERSION__ === "string" ? __CARD_VERSION__ : "dev";
