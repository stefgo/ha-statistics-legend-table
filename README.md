# Statistics Table and Legend Card for Home Assistant

[![Release](https://img.shields.io/github/v/release/stefgo/ha-statistics-legend-table?style=flat-square)](https://github.com/stefgo/ha-statistics-legend-table/releases)
[![HACS: custom](https://img.shields.io/badge/HACS-custom-41BDF5?style=flat-square)](https://hacs.xyz/)
[![Home Assistant 2025.2+](https://img.shields.io/badge/Home%20Assistant-2025.2%2B-41BDF5?style=flat-square)](https://www.home-assistant.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

Standalone Home Assistant Lovelace card that renders a legend in the style of the built-in energy
cards: one row per statistic with a color indicator, name and aggregated values, clickable, plus an
optional total or self-sufficiency row underneath.

The card fetches its data from the recorder **itself** and is therefore independent of any other
card. It can nevertheless:

- render **any other Lovelace card** above itself (`card:`) — both share the same `ha-card`;
- **show/hide another component** when a legend row is clicked (`link:`) — through one of three
  interchangeable mechanisms.

![One ha-card combining Statistics Extended Graph and Statistics Table and Legend: a stacked energy chart on top, five legend rows with their sums underneath, closed by a self-sufficiency total row](https://raw.githubusercontent.com/stefgo/ha-statistics-legend-table/main/screenshots/statistics-legend-with-custom-graph.png)

*Both cards combined in one `ha-card`: a
[Statistics Extended Graph](https://github.com/stefgo/ha-statistics-extended-graph) chart embedded
via `card:`, with this card's five statistics and their sums plus a `total` row in `ratio` mode
underneath.*

## Installation

1. Add this repository to HACS as a “custom repository” (category *Lovelace*) and install it — or
   copy `dist/statistics-legend-table.js` manually to
   `config/www/community/ha-statistics-legend-table/`.
2. Register the resource:

```yaml
url: /hacsfiles/ha-statistics-legend-table/statistics-legend-table.js
type: module
```

There is **no** requirement on any other card. `statistics-extended-graph`, `power-flow-card-plus`
& co. are only needed if you actually want to embed them.

## Minimal example

```yaml
type: custom:statistics-legend-table
title: Energy flow
timespan:
  mode: energy
entities:
  - statistic_id: sensor.grid_import
    name: Grid import
    color: "#488fc2"
  - statistic_id: sensor.solar_production
    name: Solar production
    color: "#ff9800"
legend:
  columns: [sum]
  total:
    name: Self-sufficiency
    mode: ratio
    numerator: [sensor.solar_production]
    denominator: [sensor.solar_production, sensor.grid_import]
```

---

## Configuration

### Top level

| Option        | Type   | Default | Description |
| ------------- | ------ | ------- | ----------- |
| `type`        | string | –       | `custom:statistics-legend-table` |
| `title`       | string | –       | Card heading |
| `card`        | object | –       | Any Lovelace card, rendered above the legend (see below) |
| `timespan`    | object | `{mode: energy}` | Time range of the statistics query |
| `aggregation` | object | `{period: auto}` | Bucket size of the statistics query |
| `entities`    | list   | **required** | The rows of the legend |
| `legend`      | object | –       | Presentation of the legend |
| `link`        | object / list | – | Coupling to another component |

### `timespan`

| Option           | Type   | Default  | Description |
| ---------------- | ------ | -------- | ----------- |
| `mode`           | string | `energy` | `energy`, `relative` or `fixed` |
| `collection_key` | string | –        | `energy` only: identifies the date picker when a dashboard has several |
| `period`         | string | `day`    | `relative` only, see below |
| `offset`         | number | `0`      | `relative` only: shifts by whole periods into the past |
| `start` / `end`  | string | –        | `fixed` only: ISO 8601 timestamps |
| `follow_selection` | boolean | `true` | Follow a period selected in the `statistics-extended-graph` card embedded via `card:` |

**`mode: energy`** couples the legend to the dashboard's energy date picker. That is the most
convenient way to keep it in sync with a neighbouring card: both subscribe to the same date
picker without knowing about each other. If the dashboard has no energy date picker, the card
automatically falls back to “today”.

**`mode: relative`** — `period` is either calendar aligned (`hour`, `day`, `week`, `month`,
`year` = the current hour / today / this week / …) or a sliding window up to now
(`last_60_minutes`, `last_24_hours`, `last_7_days`, `last_30_days`, `last_12_months`).
The range is re-resolved every minute.

**`follow_selection`** — clicking a bucket in a
[Statistics Extended Graph](https://github.com/stefgo/ha-statistics-extended-graph) makes that
card report the selected period as a selection event. The legend follows that event **only from
the graph inside its own `card:` block** — the listener sits on the legend element, so a graph
placed elsewhere on the view never moves this legend — and then shows **all** of its values for
that period: every column, calculated rows, the total row and
`total.mode: ratio` alike. The values are fetched for the selected period rather than derived
from the ones already displayed, so a selection finer than `aggregation.period` is answered
correctly; the requested bucket size is capped at the length of the selection.

Clicking the same bucket again, or switching the time range, clears the selection in the graph
and returns the legend to its configured timespan. Set `follow_selection: false` for a legend
that must always show the full range.

### `aggregation`

| Option   | Type   | Default | Description |
| -------- | ------ | ------- | ----------- |
| `period` | string | `auto`  | `auto`, `5minute`, `hour`, `day`, `week`, `month` |

The bucket size is not only a performance question: `min`/`max`/`avg` are computed **per bucket**.
With `period: day`, `Max` is therefore the strongest day; with `period: hour` the strongest
hour. `Σ` is unaffected by this. `auto` follows Home Assistant's own rule (> 35 days → `month`,
> 2 days → `day`, otherwise `hour`).

### `entities`

| Option              | Type   | Default | Description |
| ------------------- | ------ | ------- | ----------- |
| `statistic_id`      | string | –       | Statistic entity of this row |
| `calculation`       | object | –       | Compute the row from several statistics/constants, see below |
| `key`               | string | `statistic_id` | Stable ID of the row, used by `legend` selectors and `link` |
| `name`              | string | statistic name | Label |
| `color`             | string / object | palette | Color of the indicator, see below |
| `stat_type`         | string | `change` | `change`, `sum`, `mean`, `min`, `max`, `state` |
| `unit`              | string | metadata | Unit shown after the values |
| `multiply` / `add`  | number | `1` / `0` | Linear conversion per bucket (`value * multiply + add`) |
| `hidden_by_default` | bool   | `false` | Row (and its link target) starts hidden |
| `link`              | string / list | `key` | Target(s) in the coupled component, see `link` |
| `no_values`         | bool   | `false` | Row without value display; does not feed into `total: {mode: sum}` |

`color` accepts either a single color or `{light: ..., dark: ...}`, to use different colors for
the dashboard's light and dark mode. If one of the two sides is missing, the other is used for
both modes:

```yaml
entities:
  - statistic_id: sensor.grid_import
    name: Grid import
    color:
      light: "#488fc2"
      dark: "#7fb2de"
```

The order of the rows follows the order of the entries in `entities`.

#### Calculated rows

Every row needs `statistic_id` **or** `calculation`. With `calculation`, the value of the row is
computed from several statistics and constants.

| Option          | Type   | Default | Description |
| --------------- | ------ | ------- | ----------- |
| `terms`         | list   | –       | Ordered calculation steps, at least one |
| `initial_value` | number | `0`     | Starting value before the first term |
| `unit`          | string | metadata of the first statistic | Unit of the result |

Each term:

| Option       | Type   | Default | Description |
| ------------ | ------ | ------- | ----------- |
| `statistic_id` | string | –     | Statistic of this term; without it, `constant` counts |
| `constant`   | number | `0`     | Constant operand, as an alternative to `statistic_id` |
| `operation`  | string | `add`   | `add`, `subtract`, `multiply`, `divide` |
| `stat_type`  | string | the row's `stat_type` | `change`, `sum`, `mean`, `min`, `max`, `state` |
| `multiply` / `add` | number | `1` / `0` | Linear conversion of the term value |
| `clip_min` / `clip_max` | number | – | Clamping of the term value after `multiply`/`add` |

The terms are applied **in configuration order**; there is no operator precedence.
Calculation happens **per bucket** over the union of all bucket timestamps, so `Min`/`Max`/`Ø`
still mean “weakest/strongest/average bucket”. If a statistic has no value for a bucket, it
counts as 0 there; a division by 0 drops the affected bucket. If a calculation consists only of
constants, it yields exactly one value. `entities[].multiply` and `entities[].add` are then
applied to the result of each bucket.

```yaml
entities:
  - key: self_consumption
    name: Self-consumption
    calculation:
      unit: kWh
      terms:
        - statistic_id: sensor.pv_production
        - statistic_id: sensor.grid_export
          operation: subtract
        - statistic_id: sensor.battery_charge
          operation: subtract
```

### `legend`

| Option         | Type   | Default | Description |
| -------------- | ------ | ------- | ----------- |
| `columns`      | list   | `[sum]` | Value columns per row, any combination of `sum`, `min`, `max`, `avg` |
| `precision`    | number | `2`     | Decimal places |
| `show_unit`    | bool   | `true`  | Show the unit after the value |
| `hide_zero`    | bool   | `false` | Hide rows without values or with a sum of 0 |
| `show_headers` | bool   | `false` | Column headers (`Σ`, `Min`, `Max`, `Ø`) |
| `min_name_width` | number | `120` | Pixels the name keeps before the values stack below it, see below |
| `total`        | object | –       | Closing row, see below |
| `groups`       | list   | –       | Split into named sections, see below |

`no_values` is set on the row itself in `entities[].no_values`, see above.

**`min_name_width`** decides when a row runs out of horizontal room. When the
name would be squeezed below this width, the values move onto a line of their
own beneath it. How much room that takes depends on how many value columns a
row has, so the threshold is computed rather than fixed — with the default it
falls at about 316px of card width for a single column and 616px for all four.
The decision is made per group, so groups with different `columns` behave
independently.

Two values are worth knowing:

- `0` stacks only once the *values* themselves no longer fit; the name is
  truncated with an ellipsis instead.
- A large value stacks always.

**Selectors** in `groups[].entities` match a row's `key` or its displayed `name`.

#### `legend.total`

| Option        | Type   | Default                          | Description |
| ------------- | ------ | -------------------------------- | ----------- |
| `mode`        | string | `sum`                            | `sum`, `ratio` or `none` |
| `name`        | string | localized “Total” / “Self-sufficiency” | Label |
| `numerator`   | list   | –                                | `ratio` only: `statistic_id`s in the numerator |
| `denominator` | list   | –                                | `ratio` only: `statistic_id`s in the denominator |
| `stat_type`   | string | `change`                         | `ratio` only |
| `precision`   | number | `legend.precision` (`1` for `ratio`) | Decimal places |
| `unit`        | string | row unit / `%`                   | Unit shown after the value |

**`mode: sum`** sums the *visible* rows — hidden ones do not count.

**`mode: ratio`** computes directly from the raw statistic values of the named `statistic_id`s,
independently of `entities`. That is why it also works for entities that have no row of their
own, and why it is unaffected by which rows are currently hidden.

#### `legend.groups`

```yaml
legend:
  columns: [sum]
  groups:
    - name: Production
      entities: [sensor.solar_production, battery_discharge]
    - name: Consumption
      entities: [sensor.grid_import]
      columns: [sum, avg]
      total:
        mode: sum
```

`name` is the heading (no `name` means no heading), `entities` lists the group's selectors.
`columns`, `precision`, `show_unit`, `hide_zero`, `show_headers`, `min_name_width` and `total` override the
top-level option of the same name for this group only. Rows that match no group end up in an
unnamed remainder group at the end — nothing is lost.

---

## Embedding another card: `card`

`card` takes **any** Lovelace card configuration and renders it above the legend inside the same
`ha-card`. The card is created through the Lovelace helpers, so there is no list of supported
cards:

```yaml
type: custom:statistics-legend-table
title: Energy flow
card:
  type: custom:statistics-extended-graph
  hide_legend: true
  timespan:
    mode: energy
  series:
    - statistic_id: sensor.grid_import
      chart_type: bar
entities:
  - statistic_id: sensor.grid_import
    name: Grid import
```

The inner card's configuration is passed through **untouched** — options such as `hide_legend`,
`chart_height` or `y_axes` belong where they belong, namely in the `card:` block. The inner
card's own `ha-card` is visually neutralized so that graph and legend sit on one surface.

`card` is optional. Without that block this is a pure legend card that you can place freely in a
`vertical-stack` or grid.

---

## Coupling: `link`

`link` defines what a click on a legend row does outside the card. `link` may be a single block
or a list; with a list, all mechanisms fire at once. Without `link`, the legend only hides its
own row (which also affects `total: {mode: sum}`).

| Option         | Type   | Default                | Description |
| -------------- | ------ | ---------------------- | ----------- |
| `mode`         | string | `none`                 | `chart`, `entity`, `event` or `none` |
| `service`      | string | `homeassistant.toggle` | `entity` only |
| `hidden_state` | string | `off`                  | `entity` only: which state counts as “hidden” |
| `link_id`      | string | –                      | `event` only: identifies this legend in the events |

Which row addresses which target is set on the row itself in `entities[].link`
(default: the row's `key`). `entities[].link` may also be a **list** — one legend row then
controls several targets at once:

```yaml
entities:
  - key: pv
    name: PV total
    statistic_id: sensor.pv_production
    link:
      - calculation_0
      - sensor.pv_surplus
```

A click sets all targets to the **same** state. The row is greyed out only once all targets are
hidden; if only some are hidden (because someone clicked directly in the chart), the row counts
as visible and the next click hides the rest as well.

### `mode: chart`

Controls cards that render their chart through Home Assistant's own `ha-chart-base` — that is,
`statistics-extended-graph`, the built-in energy cards and everything else built on top of it. The
coupling works in both directions: a click in the legend hides the series in the graph, and a
series hidden in the graph is greyed out in the legend.

```yaml
card:
  type: custom:statistics-extended-graph
  hide_legend: true
  series:
    - statistic_id: sensor.grid_import
      chart_type: bar
link:
  mode: chart
entities:
  - statistic_id: sensor.grid_import
    name: Grid import
    # link: optional — only needed if the key does not match the series ID
```

`entities[].link` is resolved against the chart's series IDs: exact match first, otherwise
**all** IDs whose segments start with the target. In most cases the `statistic_id` is therefore
enough, even though `statistics-extended-graph` internally uses IDs of the form
`<statistic_id>:<stat_type>:<chart_type>:<index>`.

If the same `statistic_id` appears several times in the chart, `link: sensor.x` captures **all**
of those series at once; they are toggled together, and the legend row is greyed out as soon as
all of them are hidden. To address one of them specifically, name further segments:

```yaml
entities:
  - statistic_id: sensor.battery_soc
    name: State of charge Ø
    stat_type: mean
    link: sensor.battery_soc:mean         # only the mean series
  - statistic_id: sensor.battery_soc
    name: State of charge max
    stat_type: max
    link: sensor.battery_soc:max:line:3   # up to the complete ID
```

The actual IDs can be looked up in the DevTools inspector: select `ha-chart-base` and run
`$0.data.map(s => s.id)`.

Calculated series (`calculation:` in `statistics-extended-graph`) have no `statistic_id`; there they
are called `calculation_<index>`, where `<index>` is the **position of the series in the
`series:` list** (zero-based, counted across all series). So for the first series,
`link: calculation_0`.

`mode: chart` addresses the chart inside the card's own `card:` block, and only that one. A chart
card standing next to the legend as a card of its own is not reachable this way — put it in
`card:`, or drive it through `mode: entity` and a `conditional` card.

### `mode: entity`

The click toggles an entity — usually an `input_boolean`. This lets you control **any** card,
even ones with no toggle API at all such as `power-flow-card-plus`, by putting them inside a
`conditional` card. The state lives in the entity and therefore survives a reload.

```yaml
type: vertical-stack
cards:
  - type: conditional
    conditions:
      - entity: input_boolean.show_solar
        state: "on"
    card:
      type: custom:power-flow-card-plus
      # ...
  - type: custom:statistics-legend-table
    link:
      mode: entity
    entities:
      - statistic_id: sensor.solar_production
        name: Solar production
        link: input_boolean.show_solar
```

A row counts as hidden as long as its entity is in state `hidden_state` (default `off`). If the
entity is toggled elsewhere, the legend follows.

### `mode: event`

Dispatches a CustomEvent on `window` and listens for a counterpart event. Intended for cards that
support the legend natively in the future, and for your own JavaScript.

```yaml
link:
  mode: event
  link_id: energyflow
```

**Dispatched** on every click:

```js
window.addEventListener("statistics-legend-table:toggle", (ev) => {
  ev.detail; // { link_id: "energyflow", target: "sensor.grid_import", hidden: true }
});
```

**Received**, to tell the legend a state determined from outside:

```js
// single target
window.dispatchEvent(new CustomEvent("statistics-legend-table:state", {
  detail: { link_id: "energyflow", target: "sensor.grid_import", hidden: true },
}));

// or the complete set of hidden targets
window.dispatchEvent(new CustomEvent("statistics-legend-table:state", {
  detail: { link_id: "energyflow", hidden: ["sensor.grid_import"] },
}));
```

`link_id` has to match so that several legends can work side by side on one dashboard.

---

## Development

```bash
npm install
npm run build     # → dist/statistics-legend-table.js
npm run watch     # rebuild on change
npm run typecheck
```

Released versions are documented in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
