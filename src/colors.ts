/**
 * Swatch colors.
 *
 * The legend no longer inherits colors from a chart, so it assigns them itself:
 * an explicit `entities[].color` if given, otherwise the next entry of the
 * palette below. Each swatch is drawn as a solid border plus a translucent fill
 * derived from the same color.
 */

/**
 * Default palette, matching the colors Home Assistant's own energy cards use
 * (`--energy-*-color` in the frontend theme) followed by the generic chart
 * colors, so a legend placed next to an energy card looks at home without
 * anyone configuring colors.
 */
import type { HomeAssistant } from "custom-card-helpers";

import type { ColorConfig } from "./config/types";

const PALETTE = [
  "#488fc2", // grid consumption
  "#ff9800", // solar
  "#4db6ac", // battery
  "#8353d1", // gas
  "#0f9d58", // water
  "#db4437", // grid return
  "#f4b400", // generic 1
  "#3f51b5", // generic 2
  "#e91e63", // generic 3
  "#009688", // generic 4
];

/** Fixed fill opacity applied to every swatch */
export const SWATCH_FILL_ALPHA = 0.5;

/**
 * Whether Home Assistant currently renders in dark mode. `darkMode` is not part
 * of the `custom-card-helpers` types, but is present on the real frontend
 * object at runtime; this reads it defensively so a rename degrades to "always
 * light" instead of throwing.
 */
export function isDarkMode(hass: HomeAssistant | undefined): boolean {
  return Boolean((hass?.themes as { darkMode?: boolean } | undefined)?.darkMode);
}

/** Palette color for the n-th row, wrapping around for long legends */
export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/**
 * Resolves a row's configured color for the current theme mode. A plain string
 * is used as-is; `{light, dark}` picks the side matching `darkMode`, falling
 * back to the other side if that one is unset. No configured color at all
 * falls back to the palette.
 */
export function resolveColor(
  color: ColorConfig | undefined,
  darkMode: boolean,
  index: number
): string {
  if (typeof color === "string") {
    return color;
  }
  if (color) {
    const picked = darkMode ? (color.dark ?? color.light) : (color.light ?? color.dark);
    if (picked) {
      return picked;
    }
  }
  return paletteColor(index);
}

const RGB_HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNC = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i;

/**
 * Applies an alpha to a concrete hex/rgb color, used to derive a swatch's fill
 * from its border color. Colors this cannot parse (named colors, `var(...)`,
 * modern color functions) are returned unchanged — the swatch then loses the
 * fill/border distinction but stays a valid, visible color instead of breaking.
 */
export function withAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();

  const hexMatch = RGB_HEX.exec(trimmed);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((char) => char + char)
        .join("");
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const rgbMatch = RGB_FUNC.exec(trimmed);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }

  return trimmed;
}
