---
version: 2
name: agenttrail-design
description: >
  Visual system for agenttrail. Light-first: grey page plane, white cards
  with real elevation, one brand accent for identity and selection, and five
  fixed category colors for tool activity. Charts are a first-class part of
  the app, not an afterthought.

  v1 copied Linear's marketing spec too literally (near-black #010102, all
  monochrome, no color coding) and ended up as a flat grey wall of text.
  That spec is written for a marketing page carrying big screenshots, not
  for a dense reading tool. v2 keeps the parts that worked (surface ladder,
  hairlines, restrained type, scarce accent) and adds the color and charts
  the app needs.

colors:
  brand: "#5b5bd6"          # light; dark #7c7cf0
  brand-text: "#4a4ac4"     # light; dark #9494f5

  light-page: "#f5f6f8"
  light-card: "#ffffff"
  light-card-2: "#fbfbfc"
  light-sunken: "#eef0f3"
  light-line: "#e4e6ea"
  light-line-strong: "#d3d7dd"
  light-ink: "#101114"
  light-ink-2: "#4a505a"
  light-ink-3: "#858c97"

  dark-page: "#141517"
  dark-card: "#1c1d21"
  dark-card-2: "#212227"
  dark-sunken: "#26272c"
  dark-line: "#2f3138"
  dark-line-strong: "#3d4048"
  dark-ink: "#eceef2"
  dark-ink-2: "#a8aeba"
  dark-ink-3: "#757b86"

categorical:
  # tool categories - fixed slot order, never cycled
  edit:    { light: "#2a78d6", dark: "#3987e5" }
  command: { light: "#eb6834", dark: "#d95926" }
  read:    { light: "#1baf7a", dark: "#199e70" }
  search:  { light: "#eda100", dark: "#c98500" }
  task:    { light: "#e87ba4", dark: "#d55181" }

sequential:
  # blue ramp, heatmap magnitude
  light: ["#eef0f3", "#9ec5f4", "#5598e7", "#2a78d6", "#184f95"]
  dark:  ["#26272c", "#184f95", "#256abf", "#3987e5", "#86b6ef"]

status:
  danger: { light: "#d03b3b", dark: "#e66767" }
  good:   { light: "#0ca30c", dark: "#3ec13e" }

typography:
  display: { family: Inter, size: 26px, weight: 600, tracking: -0.8px }
  h1:      { family: Inter, size: 22px, weight: 600, tracking: -0.5px }
  h2:      { family: Inter, size: 13px, weight: 600 }
  body:    { family: Inter, size: 14px, weight: 400, tracking: -0.05px }
  small:   { family: Inter, size: 13px, weight: 400 }
  caption: { family: Inter, size: 12px, weight: 400 }
  eyebrow: { family: Inter, size: 11px, weight: 600, tracking: 0.4px, transform: uppercase }
  mono:    { family: JetBrains Mono, size: 12px, weight: 400 }

rounded: { sm: 6px, md: 8px, lg: 12px, xl: 16px, pill: 9999px }
spacing: { xxs: 4px, xs: 8px, sm: 12px, md: 16px, lg: 24px }
---

## Shape of the app

Three surfaces, in the order a person hits them:

1. **Overview**: the landing screen. Stat tiles, activity heatmap, tool mix,
   most-changed files, busiest projects, recent sessions. A dashboard, not a
   splash screen.
2. **Session**: header card with the session's activity strip and stat row,
   then tool mix, files touched, and the transcript.
3. **Transcript**: a timeline on a spine, not a stack of paragraphs.

## Color

### Brand: identity and selection only

`brand` marks where you are: the logo, the selected sidebar row, the active
search result, your own turns in the transcript, focus rings. It never
encodes data. It's a violet on purpose, distinct from every categorical
slot, so a selected row can never be mistaken for a series.

### Categorical: tool activity

Five slots, fixed order, from the validated reference palette. This is the
color language of the whole app: a `command` is the same orange in the
sidebar fingerprint, the overview mix bar, the session strip, and the tool
row in the transcript.

Validated with the palette script against this app's real chart surfaces:

| mode | surface | worst adjacent CVD ΔE | normal-vision ΔE | contrast |
|---|---|---|---|---|
| light | `#ffffff` | 9.1 | 19.6 | 3 slots < 3:1 |
| dark | `#1c1d21` | 8.4 | 19.3 | all ≥ 3:1 |

The three light slots under 3:1 (`read`, `search`, `task`) are why the
relief rule exists: every colored mark in this UI sits beside a visible text
label carrying its value. Legends always show `swatch + label + number`.
Never ship a mark whose only identity is its hue.

Five is the ceiling. A sixth tool type folds into `task`, it does not get a
new hue. See `TOOL_CATEGORIES` in `src/types.ts`.

### Sequential: magnitude

One hue, light to dark, for the activity heatmap. The zero step is the
`sunken` surface so empty days recede. No rainbows.

### Status: reserved

`danger` and `good` are never series colors. `danger` always ships with a
word (`failed`, `Tool error`), never as color alone.

## Charts

Rules for every chart in `components/charts.tsx`:

- 2px surface gap between adjacent stacked fills, so segments never bleed
  together.
- Hover is mandatory. An HTML chart is interactive; magnitude is read on
  hover, not estimated off an axis. The only exception is a bare stat tile.
- Legends carry values, not just labels.
- Text uses ink tokens, never the series color. A swatch beside the label
  carries identity; the label itself stays `ink-2`.
- One axis, ever. No dual-scale charts.
- Standalone figures (stat tiles) use proportional numerals; anything in a
  vertical column uses `.num` (tabular).

### Cache tokens are not "tokens"

Cache reads are an order of magnitude larger than real input and billed at a
fraction of the rate. Summing them into a headline made the corpus read as
"5.4B tokens". The headline figure is `input + output`; cache read and
creation appear in the tooltip, labelled and excluded.

## Elevation

Depth is a real ladder, not just hairlines. This is an app, not a page.

| Level | Treatment | Use |
|---|---|---|
| 0 | `page` | the plane everything sits on |
| 1 | `.card`: `card` bg, 1px `line`, 12px radius, `shadow-sm` | every panel |
| 2 | `card-2` | hovered rows inside a card |
| 3 | `sunken` | inputs, chart tracks, code blocks, expanded results |
| float | `card` + `shadow-lg` | search palette, tooltips |

`sunken` is below the card, not above it. Chart tracks and inputs read as
recessed wells. When a container and its active child both need a surface,
the child must contrast against the container; a popover body therefore sits
at `card` so its highlighted row can move to `sunken`.

## Type

**Inter** 400/500/600/700, **JetBrains Mono** 400/500 for anything quoted
verbatim from a transcript: paths, commands, timestamps, ids, tool output.

- `eyebrow` is the only uppercase style, and takes positive tracking.
  Stat-tile labels and panel headers only.
- Negative tracking scales with size; zero below 14px.
- Never set body copy uppercase.

## Motion

- 120-150ms `ease-out` on hover/color transitions.
- Charts animate in once: bars grow on the x-axis, staggered ~40-55ms per
  mark.
- Nothing loops. No blinking, no count-ups, no grain, no parallax.
- Everything collapses under `prefers-reduced-motion: reduce`.

## Language

No metaphor. Sessions are sessions, files are files, tool calls are tool
calls. Never "flight", "callsign", "cargo", "manifest", "maneuver", "fuel",
"aircraft".

## Do / Don't

**Do**
- Default to light. Dark is opt-in and is a charcoal, never near-black.
- Keep the five categorical slots consistent across every surface.
- Give every chart a hover layer and a labelled legend.
- Put mono on anything quoted from a transcript.
- Let the brand violet mean "here you are", nothing else.

**Don't**
- Don't add a sixth categorical hue.
- Don't use a status color as a series color.
- Don't render a colored mark without an adjacent label.
- Don't put cache tokens in a headline number.
- Don't use `#010102`, or any near-black, as a canvas.

## Reference

The categorical, sequential and status palettes come from a validated
reference palette; the layout language is a product-UI reading of Linear's
system via [getdesign.md](https://getdesign.md). Re-run the validator
(`scripts/validate_palette.js`) against both surfaces before changing any
chart color.
