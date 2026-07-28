# Energy Custom Legend

Eigenständige Home-Assistant-Lovelace-Karte, die eine Legende im Stil der Energie-Karten rendert:
eine Zeile je Statistik mit Farbindikator, Name und aggregierten Werten, klickbar, darunter
optional eine Summen- oder Autarkiezeile.

Die Karte holt ihre Daten **selbst** aus dem Recorder und ist damit von jeder anderen Karte
unabhängig. Sie kann trotzdem:

- eine **beliebige andere Lovelace-Karte** über sich darstellen (`card:`) — beide teilen sich
  dieselbe `ha-card`;
- beim Klick auf eine Legendenzeile eine **andere Komponente ein-/ausblenden** (`link:`) —
  über einen von drei austauschbaren Mechanismen.

```
┌──────────────────────────────────────┐
│ Energiefluss                         │
│  ▁▃▅█▅▃▁  (beliebige Karte)          │
│                                      │
│  ▬  Netzbezug              12,34 kWh │
│  ▬  PV-Erzeugung           45,67 kWh │
│  ▬  Batterie                8,90 kWh │
│  ────────────────────────────────────│
│     Autarkie                  78,7 % │
└──────────────────────────────────────┘
```

## Installation

1. Dieses Repository als „Custom Repository“ (Kategorie *Lovelace*) in HACS hinzufügen und
   installieren — oder `dist/energy-custom-legend.js` manuell nach
   `config/www/community/energy-custom-legend/` kopieren.
2. Resource eintragen:

```yaml
url: /hacsfiles/energy-custom-legend/energy-custom-legend.js
type: module
```

Es gibt **keine** Voraussetzung an andere Karten. `energy-custom-graph`, `power-flow-card-plus`
& Co. werden nur gebraucht, wenn man sie tatsächlich einbinden möchte.

## Minimalbeispiel

```yaml
type: custom:energy-custom-legend-card
title: Energiefluss
timespan:
  mode: energy
entities:
  - statistic_id: sensor.grid_import
    name: Netzbezug
    color: "#488fc2"
  - statistic_id: sensor.solar_production
    name: PV-Erzeugung
    color: "#ff9800"
legend:
  columns: [sum]
  total:
    name: Autarkie
    mode: ratio
    numerator: [sensor.solar_production]
    denominator: [sensor.solar_production, sensor.grid_import]
```

---

## Konfiguration

### Top-Level

| Option        | Typ    | Default | Beschreibung |
| ------------- | ------ | ------- | ------------ |
| `type`        | String | –       | `custom:energy-custom-legend-card` |
| `title`       | String | –       | Kartenüberschrift |
| `card`        | Objekt | –       | Beliebige Lovelace-Karte, oberhalb der Legende gerendert (siehe unten) |
| `timespan`    | Objekt | `{mode: energy}` | Zeitraum der Statistikabfrage |
| `aggregation` | Objekt | `{period: auto}` | Bucket-Größe der Statistikabfrage |
| `entities`    | Liste  | **Pflicht** | Die Zeilen der Legende |
| `legend`      | Objekt | –       | Darstellung der Legende |
| `link`        | Objekt / Liste | – | Kopplung an eine andere Komponente |

### `timespan`

| Option           | Typ    | Default  | Beschreibung |
| ---------------- | ------ | -------- | ------------ |
| `mode`           | String | `energy` | `energy`, `relative` oder `fixed` |
| `collection_key` | String | –        | Nur `energy`: identifiziert den Datepicker, wenn ein Dashboard mehrere hat |
| `period`         | String | `day`    | Nur `relative`, siehe unten |
| `offset`         | Zahl   | `0`      | Nur `relative`: verschiebt um ganze Perioden in die Vergangenheit |
| `start` / `end`  | String | –        | Nur `fixed`: ISO-8601-Zeitstempel |

**`mode: energy`** koppelt die Legende an den Energie-Datepicker des Dashboards. Das ist der
bequemste Weg, sie mit einer Nachbarkarte synchron zu halten: beide abonnieren denselben
Datepicker, ohne voneinander zu wissen. Steht auf dem Dashboard kein Energie-Datepicker, fällt
die Karte automatisch auf „heute“ zurück.

**`mode: relative`** — `period` ist entweder kalendarisch ausgerichtet (`hour`, `day`, `week`,
`month`, `year` = die aktuelle Stunde / heute / diese Woche / …) oder ein gleitendes Fenster
bis jetzt (`last_60_minutes`, `last_24_hours`, `last_7_days`, `last_30_days`, `last_12_months`).
Der Zeitraum wird jede Minute neu aufgelöst.

### `aggregation`

| Option   | Typ    | Default | Beschreibung |
| -------- | ------ | ------- | ------------ |
| `period` | String | `auto`  | `auto`, `5minute`, `hour`, `day`, `week`, `month` |

Die Bucket-Größe ist nicht nur eine Performance-Frage: `min`/`max`/`avg` werden **je Bucket**
berechnet. Bei `period: day` ist `Max` also der stärkste Tag, bei `period: hour` die stärkste
Stunde. `Σ` ist davon unberührt. `auto` folgt der Regel von Home Assistant (> 35 Tage → `month`,
> 2 Tage → `day`, sonst `hour`).

### `entities`

| Option              | Typ    | Default | Beschreibung |
| ------------------- | ------ | ------- | ------------ |
| `statistic_id`      | String | –       | Statistik-Entität dieser Zeile |
| `calculation`       | Objekt | –       | Zeile aus mehreren Statistiken/Konstanten berechnen, siehe unten |
| `key`               | String | `statistic_id` | Stabile ID der Zeile, von `legend`-Selektoren und `link` verwendet |
| `name`              | String | Statistik-Name | Beschriftung |
| `color`             | String / Objekt | Palette | Farbe des Indikators, siehe unten |
| `stat_type`         | String | `change` | `change`, `sum`, `mean`, `min`, `max`, `state` |
| `unit`              | String | Metadaten | Einheit hinter den Werten |
| `multiply` / `add`  | Zahl   | `1` / `0` | Lineare Umrechnung je Bucket (`wert * multiply + add`) |
| `hidden_by_default` | bool   | `false` | Zeile (und ihr Link-Ziel) startet ausgeblendet |
| `link`              | String / Liste | `key` | Ziel(e) in der gekoppelten Komponente, siehe `link` |
| `no_values`         | bool   | `false` | Zeile ohne Wertanzeige; fließt nicht in `total: {mode: sum}` ein |

`color` akzeptiert entweder eine einzelne Farbe oder `{light: ..., dark: ...}`, um für den
hellen und dunklen Modus des Dashboards unterschiedliche Farben zu verwenden. Fehlt eine der
beiden Seiten, wird die andere für beide Modi verwendet:

```yaml
entities:
  - statistic_id: sensor.grid_import
    name: Netzbezug
    color:
      light: "#488fc2"
      dark: "#7fb2de"
```

Die Reihenfolge der Zeilen ergibt sich aus der Reihenfolge der Einträge in `entities`.

#### Berechnete Zeilen

Jede Zeile braucht `statistic_id` **oder** `calculation`. Mit `calculation` wird der Wert der
Zeile aus mehreren Statistiken und Konstanten berechnet.

| Option          | Typ    | Default | Beschreibung |
| --------------- | ------ | ------- | ------------ |
| `terms`         | Liste  | –       | Geordnete Rechenschritte, mindestens einer |
| `initial_value` | Zahl   | `0`     | Startwert vor dem ersten Term |
| `unit`          | String | Metadaten der ersten Statistik | Einheit des Ergebnisses |

Jeder Term:

| Option       | Typ    | Default | Beschreibung |
| ------------ | ------ | ------- | ------------ |
| `statistic_id` | String | –     | Statistik dieses Terms; ohne sie zählt `constant` |
| `constant`   | Zahl   | `0`     | Konstanter Operand, alternativ zu `statistic_id` |
| `operation`  | String | `add`   | `add`, `subtract`, `multiply`, `divide` |
| `stat_type`  | String | `stat_type` der Zeile | `change`, `sum`, `mean`, `min`, `max`, `state` |
| `multiply` / `add` | Zahl | `1` / `0` | Lineare Umrechnung des Term-Werts |
| `clip_min` / `clip_max` | Zahl | – | Begrenzung des Term-Werts nach `multiply`/`add` |

Die Terme werden **in Konfigurationsreihenfolge** angewendet, es gilt keine Punkt-vor-Strich-Regel.
Gerechnet wird **je Bucket** über die Vereinigung aller Bucket-Zeitpunkte, `Min`/`Max`/`Ø`
bedeuten also weiterhin „schwächster/stärkster/durchschnittlicher Bucket". Fehlt einer Statistik
der Wert für einen Bucket, zählt sie dort 0; eine Division durch 0 lässt den betroffenen Bucket
entfallen. Besteht eine Berechnung nur aus Konstanten, ergibt sie genau einen Wert.
`entities[].multiply` und `entities[].add` wirken anschließend auf das Ergebnis jedes Buckets.

```yaml
entities:
  - key: self_consumption
    name: Eigenverbrauch
    calculation:
      unit: kWh
      terms:
        - statistic_id: sensor.pv_produktion
        - statistic_id: sensor.netzeinspeisung
          operation: subtract
        - statistic_id: sensor.batterie_ladung
          operation: subtract
```

### `legend`

| Option         | Typ    | Default | Beschreibung |
| -------------- | ------ | ------- | ------------ |
| `columns`      | Liste  | `[sum]` | Wertspalten je Zeile, Kombination aus `sum`, `min`, `max`, `avg` |
| `precision`    | Zahl   | `2`     | Nachkommastellen |
| `show_unit`    | bool   | `true`  | Einheit hinter dem Wert anzeigen |
| `hide_zero`    | bool   | `false` | Zeilen ohne Werte bzw. mit Summe 0 ausblenden |
| `show_headers` | bool   | `false` | Spaltenüberschriften (`Σ`, `Min`, `Max`, `Ø`) |
| `total`        | Objekt | –       | Abschlusszeile, siehe unten |
| `groups`       | Liste  | –       | Unterteilung in benannte Abschnitte, siehe unten |

`no_values` steht bei der Zeile selbst in `entities[].no_values`, siehe oben.

**Selektoren** in `groups[].entities` treffen den `key` einer Zeile oder ihren angezeigten
`name`.

#### `legend.total`

| Option        | Typ    | Default               | Beschreibung |
| ------------- | ------ | --------------------- | ------------ |
| `mode`        | String | `sum`                 | `sum`, `ratio` oder `none` |
| `name`        | String | `Gesamt` / `Autarkie` | Beschriftung |
| `numerator`   | Liste  | –                     | Nur `ratio`: `statistic_id`s im Zähler |
| `denominator` | Liste  | –                     | Nur `ratio`: `statistic_id`s im Nenner |
| `stat_type`   | String | `change`              | Nur `ratio` |
| `precision`   | Zahl   | `legend.precision` (bei `ratio`: `1`) | Nachkommastellen |
| `unit`        | String | Zeileneinheit / `%`   | Einheit hinter dem Wert |

**`mode: sum`** summiert die *sichtbaren* Zeilen — ausgeblendete zählen nicht mit.

**`mode: ratio`** rechnet direkt mit den rohen Statistikwerten der genannten `statistic_id`s,
unabhängig von `entities`. Das funktioniert deshalb auch für Entitäten, die gar keine eigene
Zeile haben, und ist unabhängig davon, welche Zeilen gerade ausgeblendet sind.

#### `legend.groups`

```yaml
legend:
  columns: [sum]
  groups:
    - name: Erzeugung
      entities: [sensor.solar_production, battery_discharge]
    - name: Verbrauch
      entities: [sensor.grid_import]
      columns: [sum, avg]
      total:
        mode: sum
```

`name` ist die Überschrift (ohne `name` keine Überschrift), `entities` listet die Selektoren der
Gruppe. `columns`, `precision`, `show_unit`, `hide_zero`, `show_headers` und `total`
überschreiben die gleichnamige Top-Level-Option nur für diese Gruppe. Zeilen, die zu keiner
Gruppe passen, landen in einer unbenannten Restgruppe am Ende — es geht nichts verloren.

---

## Andere Karte einbinden: `card`

`card` nimmt eine **beliebige** Lovelace-Kartenkonfiguration und rendert sie oberhalb der
Legende innerhalb derselben `ha-card`. Die Karte wird über die Lovelace-Helper erzeugt, es gibt
also keine Liste unterstützter Karten:

```yaml
type: custom:energy-custom-legend-card
title: Energiefluss
card:
  type: custom:energy-custom-graph-card
  hide_legend: true
  timespan:
    mode: energy
  series:
    - statistic_id: sensor.grid_import
      chart_type: bar
entities:
  - statistic_id: sensor.grid_import
    name: Netzbezug
```

Die Konfiguration der inneren Karte wird **unverändert** durchgereicht — Optionen wie
`hide_legend`, `chart_height` oder `y_axes` stehen dort, wo sie hingehören, nämlich im `card:`-
Block. Die eigene `ha-card` der inneren Karte wird optisch neutralisiert, damit Graph und
Legende auf einer Fläche sitzen.

`card` ist optional. Ohne den Block ist dies eine reine Legendenkarte, die man frei in einem
`vertical-stack` oder Grid platzieren kann.

---

## Kopplung: `link`

`link` legt fest, was ein Klick auf eine Legendenzeile außerhalb der Karte bewirkt. `link` darf
ein einzelner Block oder eine Liste sein; bei einer Liste feuern alle Mechanismen gleichzeitig.
Ohne `link` blendet die Legende nur ihre eigene Zeile aus (was auch `total: {mode: sum}`
beeinflusst).

| Option         | Typ    | Default                | Beschreibung |
| -------------- | ------ | ---------------------- | ------------ |
| `mode`         | String | `none`                 | `chart`, `entity`, `event` oder `none` |
| `target`       | String | `card`                 | Nur `chart`: `card` oder ein CSS-Selektor |
| `service`      | String | `homeassistant.toggle` | Nur `entity` |
| `hidden_state` | String | `off`                  | Nur `entity`: welcher Zustand als „ausgeblendet“ gilt |
| `link_id`      | String | –                      | Nur `event`: identifiziert diese Legende in den Events |

Welche Zeile welches Ziel anspricht, steht bei der Zeile selbst in `entities[].link`
(Default: der `key` der Zeile). `entities[].link` darf auch eine **Liste** sein — dann steuert
eine Legendenzeile mehrere Ziele gleichzeitig:

```yaml
entities:
  - key: pv
    name: PV gesamt
    statistic_id: sensor.pv_produktion
    link:
      - calculation_0
      - sensor.pv_ueberschuss
```

Ein Klick setzt alle Ziele auf **denselben** Zustand. Ausgegraut wird die Zeile erst, wenn alle
Ziele ausgeblendet sind; ist nur ein Teil ausgeblendet (weil jemand direkt im Chart geklickt
hat), gilt die Zeile als sichtbar und der nächste Klick blendet den Rest mit aus.

### `mode: chart`

Steuert Karten, die den Chart über Home Assistants eigenes `ha-chart-base` rendern — also
`energy-custom-graph`, die eingebauten Energie-Karten und alles andere darauf Aufbauende. Die
Kopplung läuft in beide Richtungen: ein Klick in der Legende blendet die Serie im Graphen aus,
und eine im Graphen ausgeblendete Serie wird in der Legende ausgegraut.

```yaml
card:
  type: custom:energy-custom-graph-card
  hide_legend: true
  series:
    - statistic_id: sensor.grid_import
      chart_type: bar
link:
  mode: chart
  target: card
entities:
  - statistic_id: sensor.grid_import
    name: Netzbezug
    # link: optional — nötig nur, wenn der key nicht auf die Serien-ID passt
```

`entities[].link` wird gegen die Serien-IDs des Charts aufgelöst: exakte Übereinstimmung zuerst,
sonst **alle** IDs, deren Segmente mit dem Target beginnen. Damit genügt in aller Regel die
`statistic_id`, auch wenn `energy-custom-graph` intern IDs der Form
`<statistic_id>:<stat_type>:<chart_type>:<index>` verwendet.

Kommt dieselbe `statistic_id` mehrfach im Chart vor, erfasst `link: sensor.x` **alle** diese
Serien auf einmal; sie werden gemeinsam geschaltet, und die Legendenzeile wird ausgegraut,
sobald alle ausgeblendet sind. Um gezielt eine davon anzusprechen, nennt man weitere Segmente:

```yaml
entities:
  - statistic_id: sensor.battery_soc
    name: Ladestand Ø
    stat_type: mean
    link: sensor.battery_soc:mean         # nur die mean-Serie
  - statistic_id: sensor.battery_soc
    name: Ladestand Max
    stat_type: max
    link: sensor.battery_soc:max:line:3   # bis hin zur vollständigen ID
```

Die tatsächlichen IDs lassen sich im DevTools-Inspector nachsehen: `ha-chart-base` auswählen und
`$0.data.map(s => s.id)` ausführen.

Berechnete Serien (`calculation:` in `energy-custom-graph`) haben keine `statistic_id`; sie
heißen dort `calculation_<index>`, wobei `<index>` die **Position der Serie in der `series:`
-Liste** ist (nullbasiert, über alle Serien gezählt). Für die erste Serie also
`link: calculation_0`.

Steht die Zielkarte nicht in `card:`, sondern als eigene Karte daneben, zeigt `target` per
CSS-Selektor darauf (die Suche geht durch Shadow-Roots):

```yaml
link:
  mode: chart
  target: "energy-custom-graph-card"
```

### `mode: entity`

Der Klick schaltet eine Entität — üblicherweise ein `input_boolean`. Damit lässt sich **jede**
Karte steuern, auch solche ganz ohne Toggle-API wie `power-flow-card-plus`, indem man sie in
eine `conditional`-Karte legt. Der Zustand liegt in der Entität und übersteht damit einen
Reload.

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
  - type: custom:energy-custom-legend-card
    link:
      mode: entity
    entities:
      - statistic_id: sensor.solar_production
        name: PV-Erzeugung
        link: input_boolean.show_solar
```

Eine Zeile gilt als ausgeblendet, solange ihre Entität im Zustand `hidden_state` (Default `off`)
ist. Wird die Entität woanders geschaltet, folgt die Legende.

### `mode: event`

Sendet ein CustomEvent auf `window` und hört auf ein Gegen-Event. Gedacht für Karten, die die
Legende künftig nativ unterstützen, und für eigenes JavaScript.

```yaml
link:
  mode: event
  link_id: energiefluss
```

**Gesendet** bei jedem Klick:

```js
window.addEventListener("energy-custom-legend:toggle", (ev) => {
  ev.detail; // { link_id: "energiefluss", target: "sensor.grid_import", hidden: true }
});
```

**Empfangen**, um der Legende einen von außen bestimmten Zustand mitzuteilen:

```js
// einzelnes Ziel
window.dispatchEvent(new CustomEvent("energy-custom-legend:state", {
  detail: { link_id: "energiefluss", target: "sensor.grid_import", hidden: true },
}));

// oder die komplette Menge ausgeblendeter Ziele
window.dispatchEvent(new CustomEvent("energy-custom-legend:state", {
  detail: { link_id: "energiefluss", hidden: ["sensor.grid_import"] },
}));
```

`link_id` muss übereinstimmen, damit mehrere Legenden auf einem Dashboard nebeneinander
funktionieren.

---

## Entwicklung

```bash
npm install
npm run build     # → dist/energy-custom-legend.js
npm run watch     # Rebuild bei Änderungen
npm run typecheck
```

## Lizenz

MIT
