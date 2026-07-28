# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

`energy-custom-legend` is a standalone Home Assistant Lovelace card
(`custom:energy-custom-legend-card`) rendering a legend in the style of the built-in energy
cards: one row per statistic with a color swatch, name and aggregated values, clickable, plus an
optional total/ratio row.

**The defining constraint of this project: the card must not depend on any other card.** An
earlier version (kept at `/Users/stefan/Entwicklung/energy-custom-legend-old`) wrapped
`energy-custom-graph-card`, forwarded that card's config as its own, and read its TypeScript-
`private` fields for the values. That coupling is what this rewrite removes. Keep it removed:

- The card fetches its own statistics from the recorder (`src/data/`).
- Its config describes the legend and nothing else — no options are forwarded to another card.
- Everything card-specific lives behind an adapter in `src/link/`.

The look is a port of the legend in the sibling project
`/Users/stefan/Entwicklung/energy-graph-cards` (`energy-usage-graph-card.ts`, `.legend*` styles).

## Commands

```bash
npm run build      # Rollup → dist/energy-custom-legend.js
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
```

There is no test setup.

## Architecture

```
src/index.ts                     card registration (window.customCards)
src/energy-custom-legend-card.ts LitElement: config, data flow, rendering, click handling
src/config/types.ts              config and row types
src/config/normalize.ts          setConfig validation and defaults
src/data/timespan.ts             timespan modes -> {start, end} + bucket period
src/data/energy-collection.ts    subscription to the energy date picker
src/data/statistics.ts           recorder websocket calls
src/data/aggregate.ts            buckets -> LegendRow (sum/min/max/avg)
src/colors.ts                    palette + swatch fill derivation
src/legend-stats.ts              grouping, ordering, total row, number formatting
src/legend-styles.ts             legend CSS
src/wrapped-card.ts              creates the optional `card:` element
src/link/                        the three link adapters + controller
```

### Three independent axes

The card's design separates three concerns that the old version conflated. When adding a
feature, work out which axis it belongs on:

1. **Data** (`src/data/`) — what the legend shows. Driven only by `entities`, `timespan` and
   `aggregation`. Never reads anything outside the recorder API.
2. **Layout** (`wrapped-card.ts`) — the optional `card:` block, created through
   `loadCardHelpers().createCardElement()` so *any* Lovelace card works. Its config is passed
   through untouched; this card neither reads nor rewrites it.
3. **Interaction** (`src/link/`) — what a click does outside this card.

### Link adapters (the only card-aware code)

`LinkAdapter` (`src/link/types.ts`) is the entire contract. `LinkController` owns the visibility
state, asks adapters for their opinion (first one that has one wins) and falls back to local
state — which is why a legend with no `link` block still greys out rows and still updates a
`total: {mode: sum}`.

- `chart-adapter.ts` targets **`ha-chart-base`**, a Home Assistant *frontend* element, not any
  particular card. That is deliberate: one adapter covers `energy-custom-graph`, the built-in
  energy cards and everything else built on it. It calls `_handleDatasetToggle(id)` and listens
  for `dataset-hidden`/`dataset-unhidden`. These are frontend internals — every access is
  guarded, so a rename degrades to "the legend only tracks its own state" instead of throwing.
  `findDeep()` pierces shadow roots; the result is cached while it stays `isConnected`, because
  `attach()` runs after every render.
- `entity-adapter.ts` toggles an entity via a service call. This is the universal escape hatch:
  it assumes nothing about the other card, so cards without any toggle API
  (`power-flow-card-plus`) are covered through a `conditional` card. It is also the only adapter
  whose state survives a reload.
- `event-adapter.ts` implements the documented `energy-custom-legend:toggle` /
  `energy-custom-legend:state` protocol on `window` (not a bubbling DOM event — the target card
  is a sibling, not an ancestor). Changing this protocol is a breaking change; it is documented
  in the README for third parties.

### Data flow

`setConfig()` → `normalizeConfig()` → `_restartTimespan()` picks the range source
(energy collection subscription / 60 s re-resolve / one-off) → `_setRange()` → `_fetch()` →
`fetchStatistics()` → `buildRows()` → `buildLegendGroups()` → render.

`_fetchToken` guards against an out-of-order response overwriting a newer one. `mode: energy`
needs `hass` to subscribe, which may arrive after `setConfig()`, so `willUpdate()` restarts the
timespan when the first `hass` lands.

Raw statistics are kept in `_statistics` alongside the rows because `legend.total.mode: ratio`
deliberately bypasses rows entirely: it sums the named `statistic_id`s directly, so it also
covers statistics that never became a row, and row visibility has no effect on it. `mode: sum`
in contrast sums the *visible* rows.

`aggregation.period` is not just a performance knob — `min`/`max`/`avg` are computed per bucket,
so the period decides what those columns mean. `auto` mirrors Home Assistant's own rule.

### Config validation

`normalizeConfig()` throws only for configs that genuinely cannot render (no `entities`, an
entity without a statistic, an unknown enum value) — `setConfig()` runs on every keystroke in
the Lovelace editor. Everything else is silently defaulted.

## Conventions

- Keep new config options optional with sensible defaults; never break existing YAML.
- Prefer graceful fallbacks over hard failures — the card sits on a user dashboard.
- Do not fork or copy another card's source into this repo.
- Anything that knows about a specific foreign card belongs in `src/link/`, nowhere else.

## Not implemented yet

- GUI editor (`getConfigElement`) — YAML only.
- An expression tree for calculated rows. `entities[].calculation` (ordered terms, evaluated
  bucket-wise without operator precedence, same YAML as `energy-custom-graph`) covers the
  common cases instead.
- Compare period (`allow_compare`): values cover the main period only.
