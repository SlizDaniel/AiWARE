---
name: MAGAZYNIER
description: Calm operator screen for a voice warehouse agent; grey for normal, colour plus shape only for a deviation or a decision awaiting a human.
colors:
  act: "oklch(0.52 0.135 240)"
  act-ink: "oklch(0.43 0.12 242)"
  act-soft: "oklch(0.95 0.022 240)"
  warn: "oklch(0.72 0.15 62)"
  warn-ink: "oklch(0.49 0.115 55)"
  warn-soft: "oklch(0.96 0.035 75)"
  alarm: "oklch(0.56 0.19 27)"
  alarm-ink: "oklch(0.47 0.16 27)"
  alarm-soft: "oklch(0.96 0.022 25)"
  ok: "oklch(0.56 0.1 160)"
  ok-ink: "oklch(0.43 0.085 160)"
  ok-soft: "oklch(0.955 0.025 160)"
  ground: "oklch(0.962 0.003 250)"
  sheet: "oklch(0.994 0.001 250)"
  rail: "oklch(0.93 0.005 250)"
  line: "oklch(0.89 0.006 250)"
  line-strong: "oklch(0.79 0.008 250)"
  track: "oklch(0.912 0.005 250)"
  band: "oklch(0.845 0.008 250)"
  norm: "oklch(0.68 0.012 255)"
  ink: "oklch(0.235 0.012 255)"
  ink-2: "oklch(0.42 0.012 255)"
  mute: "oklch(0.49 0.011 255)"
typography:
  headline:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.375
  headword:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.375
  readout:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
    fontFeature: "'tnum'"
  body:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  mark:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  caption:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  label:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.71875rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.07em"
    fontVariation: "'wdth' 82"
  data:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 85"
  wordmark:
    fontFamily: "Archivo, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    letterSpacing: "0.12em"
    fontVariation: "'wdth' 112"
rounded:
  segment: "5px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  "0.5": "2px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
  button-action:
    backgroundColor: "{colors.act}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-action-hover:
    backgroundColor: "{colors.act-ink}"
  button-action-lg:
    backgroundColor: "{colors.act}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 24px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.ground}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.alarm-ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-danger-hover:
    backgroundColor: "{colors.alarm-soft}"
  input-field:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  input-field-disabled:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.mute}"
  panel:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
  nav-rail:
    backgroundColor: "{colors.rail}"
    width: "256px"
  nav-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  nav-item-active:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
  segment-group:
    backgroundColor: "{colors.rail}"
    rounded: "{rounded.md}"
    padding: "2px"
  segment:
    textColor: "{colors.ink-2}"
    typography: "{typography.mark}"
    rounded: "{rounded.segment}"
    padding: "0 12px"
    height: "32px"
  segment-active:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
  state-chip:
    backgroundColor: "{colors.sheet}"
    typography: "{typography.mark}"
    rounded: "{rounded.full}"
    padding: "0 12px"
    height: "32px"
  notice-info:
    backgroundColor: "{colors.act-soft}"
    textColor: "{colors.act-ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  notice-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn-ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  notice-alarm:
    backgroundColor: "{colors.alarm-soft}"
    textColor: "{colors.alarm-ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  notice-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok-ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  change-card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
  command-buffer:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  command-buffer-hearing:
    backgroundColor: "{colors.act-soft}"
  range-track:
    backgroundColor: "{colors.track}"
    rounded: "{rounded.full}"
    height: "8px"
  range-fill:
    backgroundColor: "{colors.norm}"
  range-fill-below:
    backgroundColor: "{colors.warn}"
  range-fill-empty:
    backgroundColor: "{colors.alarm}"
  range-fill-proposed:
    backgroundColor: "{colors.act}"
  range-tick:
    backgroundColor: "{colors.ink}"
    width: "2px"
    height: "16px"
  zone-slot:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "88px"
  zone-slot-selected:
    backgroundColor: "{colors.act-soft}"
---

# Design System: MAGAZYNIER

## Overview

**Creative North Star: "The Calm Operator Screen"**

MAGAZYNIER's web app is built as an ISA-101 high-performance HMI for a small warehouse: grey is the sound of nothing being wrong. The normal state is graphite ink on cool grey paper. Colour appears only where something deviates from the norm (amber below minimum, red empty or failed) or where something waits for a human (cyan-blue operator action). Every state carries a shape as well as a colour (square, triangle, diamond, circle), so the screen still reads in greyscale, on a washed-out demo projector, and for colour-blind operators.

The density is that of a control-room panel seen from a desk: laptop-first (1280 to 1920 px), three columns (navigation rail, work column, agent column), generous row heights and big tabular numbers. Structure comes from type and hairlines, not boxes: one sheet panel per block, hairline dividers inside it, one bold headword per row. Five borrowed devices give it its specifics. From the Solari board, numbers roll into place and changed rows flash (`RollingNumber`, `ChangeFlash`). From the vertical feed, the pending change card sits on top of the agent column, one decision at a time. From Metro, type does the work boxes usually do. From the lexicon, each row has one headword. From the factory catalog, every object carries its `#code` in condensed tabular figures.

The system refuses the KPI-tile SaaS dashboard: counts sit in sentences (`ReadoutLine`: "4 towary · ▲ 1 poniżej minimum · ◆ 1 oczekujący szkic") and on range indicators, never in big-number tiles. Panels carry no shadows, gradients or glass. All UI copy is Polish, with Polish typographic quotes („…”) and the middle dot (·) as the readout separator. Code comments in the source are Polish too. Tokens live in `src/app/globals.css` (`@theme`), and primitives live in `src/components/ui/`.

**Key Characteristics:**
- Cool achromatic field (hue 250–255, chroma 0.012 or less) with four functional hues, each in three steps: base, `-ink`, `-soft`.
- State is always colour plus shape (`StateShape`), never colour alone.
- The analog range indicator, with its minimum tick fixed at one third, is the signature data element.
- One typeface (Archivo). Its width axis provides the condensed caps labels and dense data.
- Flat panels with hairlines. Elevation means "floating over the work" or "pending decision".
- Motion only announces a change in place: roll, flash, arrive, breathe.

## Colors

A cool, nearly achromatic grey field with four functional hues. Each hue has a base step for shapes and fills, an `-ink` step for text and a `-soft` step for washes.

### Primary
- **Operator Cyan-Blue** (`act`): the colour of human action and decisions awaiting a human. It fills the confirm button (`buttonClass('action')`, "Zatwierdź"), the decision diamond, the listening dot, the active-nav icon, the selected zone tile border, the proposed increase on the range indicator and its "after" caret, the global focus outline, the text caret and `accent-color`.
- **Operator Blue Ink** (`act-ink`): any text in the decision state, such as "Czeka na decyzję", the pending "→ 9 szt" preview in a stock row, pending-draft chips, and clarify/info copy. It is also the action button's hover fill.
- **Operator Wash** (`act-soft`): the pending stock row (at 60%), the clarify block, the command buffer while hearing, the info `Notice`, the map's location banner, and the first frame of `ChangeFlash`.

### Secondary
The deviation pair.
- **Signal Amber** (`warn`): below minimum. Used for the filled triangle, the range-indicator fill when stock is below minimum, the dashed current-minimum line in `StockTrend`, and the voice-fallback border on the command field.
- **Amber Ink** (`warn-ink`): text and numbers below minimum (the stock quantity, `StateMark`, the "Nie rozumiem tej komendy" block).
- **Amber Wash** (`warn-soft`): the warn `Notice`, the unknown-command block, and the voice-fallback field background.
- **Alarm Red** (`alarm`): empty stock, errors and lost connection. Used for the filled square and the range-indicator fill at zero.
- **Alarm Ink** (`alarm-ink`): error text and the danger button label.
- **Alarm Wash** (`alarm-soft`): the alarm `Notice` / `LoadError` and the danger button's hover.

### Tertiary
- **Ledger Green** (`ok`, `ok-ink`, `ok-soft`): saved or approved. It appears rarely: the filled circle for "Połączono z serwerem", the shape on a success toast, the "saved" line in settings, and the ok `Notice` after sign-up.

### Neutral
- **Ground** (`ground`): the page. It also forms inset wells inside a sheet (agent answer, command buffer, `EmptyNote`, map aisle, gate tab, delta pill) and row washes (`ground/50` hover, `ground/60` edit row and day-group band).
- **Sheet** (`sheet`): the raised working surface: panels, fields, the change card, chips, and the active nav item or segment. It is also the text colour on the graphite primary button and the toast.
- **Rail** (`rail`): recessed chrome. Used for the navigation rail, the segmented-control housing and skeleton rows.
- **Hairline** (`line`): panel borders, row and group dividers, and chip rings.
- **Strong Hairline** (`line-strong`): field and secondary-button borders, the map plan frame and zone slots, dashed empty-state borders, chart baselines and the scrollbar thumb.
- **Track** (`track`): the empty track of the range indicator.
- **Band** (`band`): the hatching of the below-minimum zone on the range indicator, plus the idle and paused status dots.
- **Norm Grey** (`norm`): the fill of a normal stock level on the range indicator, and the "before" segment of a proposed increase. It is deliberately lighter and calmer than any deviation fill.
- **Graphite** (`ink`): primary text, headwords, normal quantities, the primary button, the minimum tick, the toast and the avatar.
- **Graphite Two** (`ink-2`): secondary text, subtitles, units, inactive nav labels and chart series.
- **Mute** (`mute`): tertiary text, including `#codes`, placeholders, chart axis labels, the "before" value on the change card, "Bez lokalizacji" and idle shapes.

### Named Rules
**The Quiet Normal Rule.** A value in the normal range is set in `ink`, and its range fill is `norm`. Colour has to be earned, either by a deviation (`warn`, `alarm`) or by a decision awaiting a human (`act`). Nothing else gets a hue.

**The Three-Step Hue Rule.** Base steps paint shapes, fills and rings. Any text in a state uses the `-ink` step. Washes use `-soft`. Body text is never set in a base state colour (`StateMark` maps `COLOR` to the shape and `TEXT` to the label).

**The Colour-Plus-Shape Rule.** A state colour never appears alone. alarm = filled square, warn = filled triangle, near = hollow triangle, decision = diamond, ok = filled circle, idle = hollow circle (`StateShape`). Nav badges, header chips, legends, notices and toasts all carry the shape.

## Typography

**Display Font:** Archivo (Google variable font, `wdth` axis, latin + latin-ext), with 'Segoe UI Variable Text', 'Segoe UI', system-ui as fallbacks
**Body Font:** Archivo (the same family)
**Label/Mono Font:** Archivo at condensed width (`wdth` 82 for labels, 85 for dense data). Monospace appears only for real code identifiers (environment variable names on the login screen).

**Character:** A single industrial grotesque whose width axis does the job a second family usually does: wide and tracked for the wordmark, normal for reading, condensed caps for panel labels and condensed figures for codes and timestamps.

### Hierarchy
- **Headline** (600, 32px; 28px below 640px; 1.25; -0.015em): the page title, one per section, in the work-column header ("Stany magazynowe").
- **Title** (600, 18px, 1.375): block headings, including dashboard `Card`, settings groups, the agent column heading, "Rzut magazynu", procedure topics and reorder-draft names. A one-line `ink-2` 14px description follows.
- **Headword** (600, 15px, 1.375): the one bold name in a stock row. History and queue rows use 16–18px, but the headword is still the only bold element in its row.
- **Readout** (600, 18px, tabular): quantities in table rows. The `ReadoutLine` uses 16px. Large readouts are 32px for a reorder quantity and 44px for the change card's "after" value.
- **Body** (400, 14px, 20px): default UI text. Long prose (procedure text) runs at 15px with a 28px line height, capped at 70ch. Hints run at 13px/20px, capped at 68ch.
- **Mark** (600, 13px): `StateMark`, header state chips, small buttons and segments.
- **Caption** (400, 12px, 16px): legends, connection status, voice help and meta lines.
- **Label** (600, 11.5px, 16px, +0.07em, uppercase, `wdth` 82, `mute`): the `label-caps` utility.
- **Data** (`wdth` 85, tabular figures): the `narrow` utility, used for `#codes`, locations and timestamps.
- **Wordmark** (700, 15px, +0.12em, `wdth` 112): "MAGAZYNIER" in the rail and on session screens only.

### Named Rules
**The One Family Rule.** Archivo only. The `wdth` axis (82 / 85 / 112) replaces a second typeface. Don't add a display face or use monospace as costume.

**The Tabular Figures Rule.** Every quantity, minimum, count, delta, `#code` and timestamp uses `tabular-nums`. Codes and timestamps are also set `narrow`, and codes are prefixed `#` (`#142`, `Szkic #7`).

**The Caps-Are-Labels Rule.** Uppercase belongs only to `label-caps`: column headers, field labels, zone and aisle names on the map ("REGAŁY A", "CIĄG KOMUNIKACYJNY"), the history day-group band, readout labels ("TERAZ", "MINIMUM") and the command buffer status. Page and block headings stay sentence case.

## Layout

The layout has three columns, like an operator console. At 1280px and up (`xl`) the shell is: the navigation rail at 256px, the work column, and the agent column at 22rem (26rem at `2xl`). The agent column is sticky and full height, with a single hairline on its left edge and no corner radius. The viewport itself never scrolls (`lg:h-screen overflow-hidden`); only the main area does. The work column's content is capped at 1180px, with side gutters of 20px, 32px from 640px, and 48px at `2xl`. The section header (headline, subtitle, state chips) sits above a stack of blocks spaced 24px apart (`space-y-6`).

From 1024 to 1279px, the rail stays and the agent column becomes a bordered panel between the header and the section content. Below 1024px, the rail turns into a top band (brand plus connection status) with horizontally scrolling navigation. Narrow widths stay usable but are not the target.

Inner layouts respond to their container, not the window. Dashboard `Card`, `WarehouseMap` and `SettingsPanel` are `@container`s that re-flow at `@2xl` (672px) and `@4xl` (896px). Settings groups become a 1:2 description/field grid. The map gains a zone-list column.

Spacing uses Tailwind's 4px base. Spacing inside a group is tight: 6px from label to field, 8px between buttons, 12px between a field and its hint. Spacing between groups is generous: 24px between blocks and 48px between dl columns or settings columns. Rows have 16px of vertical padding and a 20px horizontal inset (24px in dashboard cards, 28px in settings from 640px). The stock table is `table-fixed` with a 37rem minimum, sized to fit roughly 600px beside the agent column.

### Named Rules
**The Agent-In-Reach Rule.** `CommandPanel` is mounted in every section, because hands-free listening runs everywhere. At `xl` it is a docked column. Below `xl` it is the first panel under the header. Never hide it behind a toggle.

**The One-Decision Rule.** Only one change card exists at a time. It stands at the top of the agent column, above the listening status and the command field. While it is pending, its stock row mirrors it in place.

## Elevation & Depth

The system is flat and uses tonal layering. `ground` (L 0.962) is the floor. `sheet` (L 0.994) is the working surface laid on it, with a 1px `line` hairline. `rail` (L 0.93) is recessed chrome. `ground` reappears as inset wells inside a sheet. Depth comes from lightness steps and hairlines, not from shadows. Shadow is reserved for things that float over the work or wait on a person.

### Shadow Vocabulary
- **Raise** (`box-shadow: 0 1px 2px oklch(0.2 0.01 255 / 0.06), 0 10px 28px -12px oklch(0.2 0.01 255 / 0.22)`, token `--shadow-raise`): the pending change card, the toast and the chart tooltip. Nothing else.
- **Select lift** (`box-shadow: 0 1px 2px oklch(0.2 0.01 255 / 0.12)`): the active segment of a segmented control and the active rail item. This small lift says "this one is pressed in".

### Named Rules
**The Hairline Rule.** A `panelClass` surface is `sheet` with a 1px `line` border and an 8px corner, and it has no shadow. Inside it, `divide-y divide-line` and type do the structuring. A panel never sits inside a panel; nested blocks go `bare` or use a `ground` well.

**The Lift-Means-Pending Rule.** `shadow-raise` marks a surface that floats (toast, tooltip) or the one decision awaiting a human (change card, which also gets a 1px `act` ring at 45%). If it neither floats nor waits for a person, it lies flat.

## Shapes

Corners follow role. Controls get 6px (`rounded-md`): buttons, fields, notices, zone slots, skeleton rows and the mascot frame. Surfaces get 8px (`rounded-lg`): panels, agent blocks, the change card, the toast, empty states and the map plan frame. Segments get 5px inside a housing inset by 2px. Pills get full rounding: state chips, the delta pill, hint chips, the range track, status dots and the avatar initial. The agent column drops its radius when it docks at `xl`.

State geometry is drawn on a 10×10 grid (`StateShape`):
- Square: rx 1, filled.
- Triangle: filled.
- Hollow triangle: 1.4 stroke.
- Diamond: filled.
- Circle: r 4.4, filled.
- Hollow circle: r 3.7, 1.4 stroke.

Icons are drawn with a single 1.6px stroke, round caps and joins, on a 20×20 grid (`icons.tsx`), at 16–18px in controls and nav. Hatching at 135° marks a zone rather than a value. On the range indicator, `band` hatching (1px every 4px) marks the below-minimum zone, and `act` hatching (1.5px every 4px) marks the portion a proposed change removes. A downward `act` caret points at the "after" value. The minimum is a 2px graphite tick that stands taller than the track.

**The Dashed-Means-Empty Rule.** A dashed border means "nothing here yet": the `EmptyState` box, empty map slots, the "Dodaj strefę" slot and the aisle centreline. A solid border means a real object.

## Components

### Buttons
Buttons are firm, flat and plain: a filled colour or a hairline outline, nothing else.
- **Shape:** gently squared corners (6px). Labels are semibold. Icons sit 8px from the label.
- **Sizes:** `sm` is 32px tall, 12px padding, 13px label. `md` is 40px, 16px padding, 14px label. `lg` is 48px, 24px padding, 16px label.
- **Primary** (`buttonClass('primary')`): a graphite (`ink`) fill with a `sheet` label, used for the main neutral action ("Wyślij", "Zaloguj"). Hover shifts the fill to `ink-2`.
- **Action** (`buttonClass('action')`): an `act` fill with a white label, used for writes: "Zatwierdź" on the change card (lg, with `CheckIcon`), approving a draft, confirming an undo, "Zapisz produkt", and the mic button while live. Hover shifts the fill to `act-ink`.
- **Secondary:** a `sheet` fill with a 1px `line-strong` border and an `ink` label. Hover darkens the border to `ink-2` and the fill to `ground`.
- **Ghost:** no fill, `ink-2` label. Hover adds a 6% `ink` wash and darkens the label to `ink`. Used for row edit buttons, "Wyloguj" and "Wyłącz nasłuch".
- **Danger:** a `sheet` fill with a 1px border in `alarm` at 35% and an `alarm-ink` label. Hover uses a full `alarm` border and an `alarm-soft` fill. Used for "Odrzuć" on drafts, retrying after an error and cancelling a zone proposal.
- **States:** colour transitions run 150ms. Disabled buttons drop to 40% opacity with a not-allowed cursor. Focus is the global 2px `act` outline offset 2px.

### Chips
- **State chips (alarm strip):** sit in the page header and show only what deviates. Each is a 32px pill with a `sheet` fill and a 1px `line` ring (`line-strong` on hover). It contains a 13px semibold label in the state's `-ink` colour, its `StateShape`, a tabular count and a Polish noun, and clicking it goes to the section that resolves it. When nothing deviates, a bare idle mark reads "Bez odchyleń" with no chip.
- **Delta pill:** on the change card, a `ground` pill with a 14px semibold signed delta ("-2 szt").
- **Hint chips:** in the unknown-command block, a `sheet` pill with a ring in `warn` at 30% and a 12px medium label.

### Cards / Containers
- **Panel** (`panelClass`): 8px corners, `sheet` fill, 1px `line` border, no shadow (see Elevation & Depth). Internal padding is 20px for tables and lists and 24px for dashboard `Card`. The header is a Title plus a one-line `ink-2` description, with actions on the right. The `flush` variant runs tables edge to edge. The `bare` variant has no surface and is used for blocks inside a panel.
- **Wells:** `ground` fill at 6–8px radius (`EmptyNote`, the agent "Odpowiedź" block, the command buffer).
- **Empty state** (`EmptyState`): 8px corners, a dashed `line-strong` border, centred content with 48px vertical padding, a 16px semibold title and a 14px `ink-2` line that teaches the next step.
- **Loading** (`Skeleton`): 44px `rail` bars at 6px radius, pulsing, each 15% fainter than the last.

### Inputs / Fields
- **Style** (`fieldClass`): `sheet` fill, a 1px `line-strong` stroke, 6px corners, 8px × 12px padding, 14px text, full width. Selects and date inputs share it. The command field and login fields are 44px tall, and the command field uses 15px text. Search fields add an 18px `SearchIcon` inset left.
- **Hover / Focus:** hover darkens the border to `ink-2` at 60%. Focus turns the border `act` and adds a 2px `act` outline at 25% with no offset. The caret is `act`.
- **Labels and hints:** labels sit above the field, either `label-caps` or 14px medium `ink`, 6px apart. Hints are 13px `ink-2`, capped at 68ch. Checkboxes are 18px with `accent-color: act`.
- **Error / Disabled:** errors appear as an alarm `Notice` below the form, never as red field chrome. Disabled fields get a `ground` fill, `mute` text and a not-allowed cursor. The voice-fallback state tints the command field with a `warn` border and `warn-soft` fill.

### Navigation
- **Rail** (`Sidebar`): a `rail` column, 256px wide. At the top is the brand lockup: the 44px mascot in a 6px frame with a `line` ring, the wordmark and an `ink-2` caption. Nav items are 40px tall, 6px corners, 14px medium labels with an 18px icon. Inactive items have an `ink-2` label and `mute` icon, with a 60% `sheet` wash on hover. The active item gets a `sheet` fill, the select lift, an `ink` label and an `act` icon, plus `aria-current="page"`. Counts sit on the right as an 8px `StateShape` and a 12px semibold tabular number. The footer holds an account card (an `ink` initial avatar, name, role and a ghost "Wyloguj") and the connection status line.
- **Narrow screens:** below 1024px the rail becomes a top band with the compact brand and a horizontally scrolling row of the same items.
- **Segmented control** (`segmentGroupClass` + `segmentClass`): a `rail` housing inset by 2px, with 32px segments, 13px semibold labels and 5px corners. The active segment gets a `sheet` fill and the select lift. Used for the dashboard period, dashboard tabs, the queue filter, the login tabs and the shift window.

### Change Card (signature)
The change card is the centre of every interaction (`ChangeCard` in `CommandPanel.tsx`). It is a `sheet` surface with 8px corners, 20px padding, `shadow-raise` and a 1px `act` ring at 45%, and it enters with `animate-arrive`. Its parts, top to bottom:
- A decision `StateMark`: "◆ Karta zmiany · do zatwierdzenia".
- The item name in 20px semibold.
- The before→after readout: before in 28px semibold `mute`, a 20px `mute` arrow, after in 44px semibold at -0.02em, then the unit in 16px `ink-2` and the delta pill on the right. The after value is `ink`, or `warn-ink`/`alarm-ink` if the change pushes stock below minimum or to zero.
- A large `RangeIndicator` showing the effect.
- A minimum caption, plus a `StateMark` such as "Poniżej minimum po zmianie" when the change pushes stock below minimum.
- The heard sentence, quoted ("Usłyszałem: „…”"), with a reminder that nothing has been saved yet.
- A `1fr auto` action row: "Zatwierdź" (action, lg) and "Odrzuć" (secondary, lg).
- A 12px centred voice hint ("albo powiedz „zatwierdź” lub „odrzuć”").

While the card is pending, its stock row mirrors it in place:
- The row gets an `act-soft` wash at 60%.
- An `act-ink` line "→ 9 szt" sits under the quantity.
- The row's range indicator shows the proposed value with its caret.
- The status column reads "◆ Czeka na decyzję".

### Range Indicator (signature)
`RangeIndicator` is an analog gauge for stock against its minimum (`role="meter"` with a full Polish `aria-valuetext`).
- **Scale:** the scale is always 3 × minimum, so the minimum tick stands at exactly one third in every row and a column of them reads at a glance.
- **Track and tick:** the track is `track`, fully rounded, and 6/8/12px tall at sm/md/lg. The minimum tick is a 2px `ink` bar, 14/16/24px tall. The below-minimum zone is hatched in `band`.
- **Fill:** the fill is `norm` when stock is normal, `warn` below minimum and `alarm` when empty. Its width transitions over 500ms.
- **Proposed change:** an increase draws `act` beyond the `norm` "before" segment. A decrease draws the after-level fill plus an `act`-hatched removed segment. Either way, an `act` caret marks the after value.
- **Over scale:** values beyond the scale are clipped, with a 4px `sheet` cap at the right end.
- **In the stock table:** a "min. N" caption in `narrow` 13px sits centred under the tick, and a legend row closes the table.

### State Mark
`StateMark` is a 10px `StateShape` plus a 13px semibold label in the state's `-ink` colour, 6px apart. `stateTextClass(kind)` colours numbers outside the mark. Stock levels map through `STOCK_LEVEL`: empty is "Brak towaru" (alarm), below is "Poniżej minimum" (warn), near is "Ostatnia szansa" (near, up to 1.5 × minimum) and ok is "OK" (idle).

### Agent Column
`CommandPanel` stacks the following, top to bottom:
1. A Title ("Powiedz Magazynierowi, co robisz") with a 13px promise line ("nic nie zapiszę bez zatwierdzenia") and an agent-mode select.
2. The change card.
3. The listening status: a ringed row with a 10px breathing `act` dot.
4. The command buffer: a `ground` well that turns `act-soft` while hearing. It has a `label-caps` status with an 8px dot and the live transcript in 20px medium.
5. The command form: "Mów" (secondary, or action while live), the 44px field and "Wyślij" (primary).
6. Response blocks, which arrive with `animate-arrive`:
   - Answer: a `ground` well with a "Odpowiedź" label.
   - Clarify: an `act-soft` wash with a decision mark.
   - Unknown command: a `warn-soft` wash with hint chips.
   - Error: an alarm `Notice`.

### Feedback
- **Notice** (`Notice`, `LoadError`): a 6px rounded wash in the tone's `-soft` with `-ink` text, a leading `StateShape`, an optional semibold title and actions 12px below. There is no coloured edge stripe.
- **Toast:** an inverted `ink` bar with `sheet` text at 14px medium, 8px corners and `shadow-raise`, anchored bottom-left past the rail. It carries an ok or alarm shape, enters with `animate-arrive`, and stays 4s (6s for errors).
- **Rolling number / change flash:** a changed value slides in from above (`animate-roll`, 420ms). Its cells wash from `act-soft` to transparent (`animate-flash`, 1600ms). The first render never animates.
- **Motion vocabulary:** state transitions run 150ms on colour only. `--ease-out-expo` (`cubic-bezier(0.16, 1, 0.3, 1)`) drives roll, flash and arrive (260ms, 6px rise). `breathe` (1800ms opacity pulse) means "listening or working". `prefers-reduced-motion` collapses every animation and transition to 1ms.

### Data Rows
Rows sit in a panel separated by hairlines, with 16px of vertical padding. Each row has one headword in `ink` semibold. Subordinate lines are 13px `ink-2`. Codes are `narrow` `mute` `#N`. Numbers are right-aligned and tabular. Header cells use `label-caps`. Hover washes the row with `ground` at 50%. History groups entries under a `label-caps` day band on `ground` at 60%. Undone entries recede to `mute` with strike-through and keep their `#codes` ("cofa wpis #11").

### Warehouse Map
`WarehouseMap` is a schematic plan, not a picture:
- **Frame:** a `sheet` frame with 8px corners and a `line-strong` border. A `label-caps` gate tab ("BRAMA / PRZYJĘCIE") hangs from the top edge.
- **Rack columns:** two columns ("REGAŁY A/B") flank a `ground` aisle with a dashed centreline and a vertical `label-caps` name.
- **Zone slots:** at least 88px tall, 6px corners, `line-strong` border and `sheet` fill. They show the name in 16–17px semibold, a tabular item count and a deviation `StateMark`. The selected slot turns `act-soft` with an `act` border and ring.
- **Empty and add slots:** empty slots are dashed. The add slot is dashed and turns `act` on hover.
- **Caption:** a 12px `mute` line states that the layout is schematic.

### Charts
Charts are hand-written SVG with no chart library, and their data is also exposed as a table for screen readers.
- **Axes:** gridlines are `line`, the baseline is `line-strong`, and axis text is 11px tabular `mute`.
- **Daily operations:** mirrored bars from a zero line. Receipts go up in `ink-2` at 42% and withdrawals go down in solid `ink-2`. Undo events are `act` diamonds, since an undo is a human decision.
- **Minimum:** drawn as a dashed `warn` line (6/4) with a `warn-ink` label over a hatched low zone.
- **Interaction:** hover adds a 4.5% `ink` column wash and a `sheet` tooltip with 6px corners, a `line` ring and `shadow-raise`.

## Do's and Don'ts

### Do:
- **Do** set every normal value in `ink` and fill every normal range with `norm`. Reserve `act`, `warn`, `alarm` and `ok` for their states.
- **Do** pair every state colour with its `StateShape`, using `StateMark` for labelled states and `stateTextClass` for bare numbers.
- **Do** show stock against minimum with `RangeIndicator`. The scale is 3 × minimum, so the 2px tick stands at one third in every row.
- **Do** keep one pending decision on top of the agent column and mirror it in its stock row: an `act-soft` row, a "→ after" line, the caret, and "Czeka na decyzję".
- **Do** announce a changed value in place with `RollingNumber` and `ChangeFlash`. New agent blocks may `animate-arrive`, and nothing else gets entrance choreography.
- **Do** build controls from `buttonClass`, `fieldClass`, `panelClass`, `segmentGroupClass` and `segmentClass`.
- **Do** set quantities, counts, deltas, `#codes` and timestamps in tabular figures. Set codes and timestamps `narrow` too.
- **Do** write UI copy in Polish with „…” quotes and · separators. Empty states should teach the next step.
- **Do** keep `prefers-reduced-motion` honoured, as the global rule in `globals.css` does.

### Don't:
- **Don't** build KPI tiles (a big number over a small label, repeated in a uniform grid). Counts go in a `ReadoutLine` sentence or a labelled readout row without boxes.
- **Don't** put a shadow on a `panelClass` surface. `shadow-raise` belongs to the pending change card, the toast and the chart tooltip only.
- **Don't** nest a panel inside a panel. Use `bare`, hairlines or a `ground` well.
- **Don't** signal state with colour alone, and don't add coloured edge stripes to notices or rows.
- **Don't** use raw hex, `rgb()` or Tailwind palette colours (`slate-*`, `amber-*`). Use only the `@theme` tokens.
- **Don't** add a second typeface or use monospace for decoration.
- **Don't** use emoji or unicode glyphs as icons. Icons are 1.6px single-stroke SVG on a 20×20 grid. An arrow inside a readout (`11 → 9`) is notation, not an icon.
- **Don't** put a caps line above a heading as an eyebrow. `label-caps` names fields, columns, zones and readouts, and nothing else.
