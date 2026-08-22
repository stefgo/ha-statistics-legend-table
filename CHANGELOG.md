# Changelog

All notable changes to this card are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). A release is built from
its `v*` tag by the release workflow, which attaches the bundle to the GitHub release — that
asset is what HACS installs.

## [1.0.0] — unreleased

The card is renamed in this release, and both the card type and the event protocol change with
it. See **Breaking changes** below before updating.

### Breaking changes

- **Renamed to `statistics-legend-table`.** Dashboards need `type: custom:statistics-legend-table`
  instead of `custom:energy-custom-legend-card`, and the resource URL becomes
  `/hacsfiles/ha-statistics-legend-table/statistics-legend-table.js`. The old name described a
  wrapper around the energy cards, which this card has not been since 0.1.0. The repository moved
  to `stefgo/ha-statistics-legend-table` along with it.
- **The event protocol is renamed** to `statistics-legend-table:toggle` and
  `statistics-legend-table:state`. Third-party listeners and user JavaScript built on
  `energy-custom-legend:*` must be updated.
- **`link.target` is removed.** It took a CSS selector resolved against the whole document, which
  made the search for the linked chart both broader and far more frequent than it needed to be.
  The chart link now addresses the `card:` block. A `target:` left in an existing configuration is
  ignored rather than rejected, so nothing stops rendering.
- The deploy script's environment prefix changed from `ENERGYLEGEND_` to `STATSTABLE_`; a local
  `.env` needs renaming (see `.env.example`).

### Added

- **Follow a period selected in an embedded graph** (`timespan.follow_selection`, on by default).
  Clicking a bucket in a `custom-graph-card` placed in the `card:` block makes the legend show all
  of its values for that period — every column, calculated rows and both total modes. The values
  are refetched rather than derived, so a selection finer than `aggregation.period` is answered
  correctly. The listener is filtered to the wrapped card, so a second graph on the same view
  never moves this legend.
- **`legend.min_name_width`** (default 120) decides how short a name may get before a row stacks
  its values below it instead of truncating. `0` stacks only once the values themselves no longer
  fit.
- **Card version in the console**, reported as `<semver>` for a release and `<semver>+build.<n>`
  for a bundle built by `builddeploy.sh` — a reloaded dashboard still printing the old number is
  serving a cached bundle.
- **`builddeploy.sh`** builds the bundle and copies it to a Home Assistant instance configured
  through `.env` (template in `.env.example`).
- `aria-pressed` on legend rows, so a screen reader can tell a hidden row from a visible one.
  Previously the state was encoded in opacity alone.

### Changed

- `getGridOptions()` reports `rows: "auto"` for a legend without a `card:` block, letting the
  browser measure what a height estimate could only model. With a `card:` block the rows stay a
  number, because the embedded card needs a definite height to size to.
- Rows decide whether to stack their values from the room the row actually needs — the swatch, the
  gaps, the value columns and `min_name_width` — computed per group, since `legend.groups[]` may
  override `columns`.
- README and card metadata are in English throughout.

### Fixed

- **Statistic names follow Home Assistant.** The entity's name now takes precedence over the
  recorder metadata, matching HA's own `getStatisticLabel()`. An entity renamed in HA kept its old
  name in the recorder metadata and therefore in the legend.
- **Units appeared again.** The metadata reader looked for `display_unit_of_measurement` and
  `unit_of_measurement`, neither of which `recorder/get_statistics_metadata` returns — Home
  Assistant sends `statistics_unit_of_measurement`. A unit only ever showed where one had been
  written into the YAML by hand.
- **Linked chart rows could never grey out.** With a compare series present, the two toggle calls
  undid each other; series ids are now mapped onto their controlling legend id and deduplicated.
  The mirrored hidden set is also re-read wholesale rather than patched incrementally, since the
  chart changes it without firing an event.
- **`total: {mode: ratio}` inside `legend.groups[]`** never had its operands fetched and rendered
  a constant 0 %, despite being documented.
- **The legend was clipped** in the sections layout: the height estimate assumed a two-column
  layout, ignored the `title:` heading and the error banner, counted one gap too many per group,
  missed that a stacking row is `1 + columns` lines tall, and rounded every line constant down.
- **The narrow layout fired on the wrong cards.** It sat behind `@media (max-width: 400px)`, which
  measures the viewport — on a phone it stacked every card however wide, while a narrow card in a
  wide sections layout never triggered it.
- **`:host { display: block }`.** A custom element is `display: inline` by default and Lovelace
  does not set it from outside; a non-replaced inline element reports a content box of 0×0, so the
  `ResizeObserver` measurement never landed and the card stayed pinned to its stacked fallback.
- **`mode: energy` without an energy collection** showed today once and then froze — no refresh,
  no retry, and the wrong day past midnight. It now runs the same 60 s cycle as `mode: relative`
  and hands back over to the date picker if a collection appears.
- Recorder errors read `[object Object]` in the error banner, because `hass.callWS()` rejects with
  a plain `{code, message}` rather than an `Error`.
- Two quick `setConfig()` calls — one per keystroke in the Lovelace editor — could resolve out of
  order and leave the older config's `card:` element standing.
- A rejection from `loadCardHelpers()` escaped as an unhandled rejection and the `card:` block
  vanished with no error anywhere but the console.
- `getStubConfig()` returned `entities: []`, which the config validation rejects by design, so
  adding the card from the picker showed an error where a preview belongs. It now picks an entity
  with a `state_class`, since only those have long-term statistics.
- `entities[].color` went unchecked into a `style` attribute; it is written through `styleMap` now
  and falls back to the palette for anything the browser would not recognise as a color.

### Performance

- **Renders are skipped when a `hass` update cannot change anything.** Home Assistant replaces
  `hass` on every state change in the house, and the legend's values come from the recorder on a
  timer. The card now re-renders only when the theme mode, the locale, or the state of an entity
  a link targets actually differ.
- **The shadow DOM is no longer walked on every update.** The chart adapter listens for the
  chart's own bubbling, composed events and takes its element reference from `composedPath()[0]`;
  the recursive search runs only after a render, when the DOM can actually have changed.
- **Statistics metadata is cached.** It answers what a statistic is called and which unit it is
  stored in, neither of which changes while a dashboard is open, yet it was refetched with every
  refresh — once a minute for `mode: relative`, for the lifetime of the page. The cache is keyed
  to the id set and shares an in-flight call.

## [0.1.0] — 2026-08-01

First release: a standalone legend card that depends on no other card.

### Added

- **Own data.** The card queries the recorder itself (`src/data/`), subscribes to the energy date
  picker, and resolves its own timespan and aggregation — replacing the previous version's reads
  of another card's TypeScript-`private` fields.
- **Link adapters** (`src/link/`) behind one interface, the only card-aware code in the project:
  `chart` (targets `ha-chart-base`, so it covers the built-in energy cards too), `entity` (a
  service call, the universal escape hatch) and `event` (a documented `CustomEvent` protocol on
  `window`).
- **Optional `card:` block**, created through `loadCardHelpers().createCardElement()`, so any
  Lovelace card can share the legend's `ha-card`. Its config is passed through untouched.
- Legend rendering with grouping, ordering, and a total row in `sum` or `ratio` mode.
- Calculated rows: `entities[].calculation` with ordered terms, evaluated per bucket.
- Theme-aware colors — a swatch color may be given per light/dark mode.
- Several link targets per legend row.
- A release workflow that builds on a `v*` tag and attaches the bundle to the GitHub release, so
  HACS can install the card without `dist/` being committed.

[1.0.0]: https://github.com/stefgo/ha-statistics-legend-table/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stefgo/ha-statistics-legend-table/releases/tag/v0.1.0
