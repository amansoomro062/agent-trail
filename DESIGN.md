---
version: 1
name: agenttrail-design
description: >
  agenttrail's visual system, derived from Linear's design language
  (getdesign.md / VoltAgent/awesome-design-md -> design-md/linear.app).
  Near-black canvas, four-step surface ladder, hairline borders, Inter at
  400/500/600 with negative display tracking, and a single chromatic accent
  (Linear lavender-blue #5e6ad2) used only for the brand mark, focus rings
  and the active selection. agenttrail is a product surface, not a marketing
  page, so this adds what Linear's marketing spec omits: a light theme, and
  a two-color semantic set (error / success) for tool-call outcomes.

colors:
  # accent: the ONLY chromatic hue in the system
  accent: "#5e6ad2"          # brand mark, active rail, focus ring
  accent-hover: "#828fff"    # also: accent-as-text on dark
  accent-press: "#4d58c4"    # also: accent-as-text on light
  on-accent: "#ffffff"

  # dark theme (canonical)
  dark-canvas: "#010102"
  dark-surface-1: "#0f1011"
  dark-surface-2: "#141516"
  dark-surface-3: "#18191a"
  dark-hairline: "#23252a"
  dark-hairline-strong: "#34343a"
  dark-ink: "#f7f8f8"
  dark-ink-muted: "#d0d6e0"
  dark-ink-subtle: "#8a8f98"
  dark-ink-tertiary: "#62666d"
  dark-error: "#eb5757"
  dark-success: "#27a644"

  # light theme (derived; Linear's product light mode, not marketing)
  light-canvas: "#fcfcfd"
  light-surface-1: "#f7f8f9"
  light-surface-2: "#f1f2f4"
  light-surface-3: "#eaebee"
  light-hairline: "#e5e6e9"
  light-hairline-strong: "#d3d5da"
  light-ink: "#16171a"
  light-ink-muted: "#3c3f45"
  light-ink-subtle: "#6b6f76"
  light-ink-tertiary: "#8b8f96"
  light-error: "#d5333a"
  light-success: "#17803d"

typography:
  display:    { family: Inter, size: 28px, weight: 600, lineHeight: 1.20, tracking: -0.6px }
  title:      { family: Inter, size: 15px, weight: 600, lineHeight: 1.35, tracking: -0.2px }
  body:       { family: Inter, size: 14px, weight: 400, lineHeight: 1.60, tracking: -0.05px }
  body-strong:{ family: Inter, size: 14px, weight: 500, lineHeight: 1.60, tracking: -0.05px }
  body-sm:    { family: Inter, size: 13px, weight: 400, lineHeight: 1.55, tracking: 0 }
  caption:    { family: Inter, size: 12px, weight: 400, lineHeight: 1.40, tracking: 0 }
  eyebrow:    { family: Inter, size: 11px, weight: 500, lineHeight: 1.30, tracking: 0.4px, transform: uppercase }
  mono:       { family: JetBrains Mono, size: 12px, weight: 400, lineHeight: 1.50, tracking: 0 }
  mono-sm:    { family: JetBrains Mono, size: 11px, weight: 400, lineHeight: 1.50, tracking: 0 }

rounded:
  xs: 4px     # chips, status dots, tool glyphs
  sm: 6px     # inline tags
  md: 8px     # buttons, inputs
  lg: 12px    # cards, popovers

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
---

## Overview

agenttrail is a transcript reader. Its job is to let someone scan a dense
list and find one thing, so the chrome stays quiet and the data carries all
the contrast. Linear's system fits because it solves the same problem:
hierarchy comes from a surface ladder and hairlines, never from color,
shadow, or ornament.

The canvas is the whitespace. Panels separate by lifting one step up the
ladder, not by gaps or borders-plus-shadow.

## Colors

### The accent is scarce

`accent` (#5e6ad2) appears in exactly four places:

1. The `TrailMark` brand glyph in the top bar.
2. The 2px left rail marking the current selection: the active session row,
   and the keyboard cursor in the search palette. A surface step alone is
   too subtle to track while arrowing through a list, so selection gets the
   rail *and* the step.
3. Focus rings (`:focus-visible`).
4. Text selection tint.

It is never a card fill, never a section background, never a hover state,
and never used to categorize tool calls.

Accent as text needs a different value per theme so it stays legible:
`accent-hover` #828fff on dark (~7:1), `accent-press` #4d58c4 on light
(~6.5:1). Never render #5e6ad2 as small text on either canvas.

### Semantic colors

Two, and only two, beyond the accent. Both are reserved for tool-call
outcomes, which is real information the reader is scanning for:

- `error`: a tool call returned `is_error`. This is the one place a warm hue
  is allowed to interrupt the neutral field.
- `success`: reserved; currently unused in the UI.

### Tool categories are NOT color-coded

The old design tinted edits orange. Don't. Categories are distinguished by
surface level and ink weight instead:

| Category | Glyph chip | Tool name | Target text |
|---|---|---|---|
| Write / Edit / MultiEdit | `surface-3` + `hairline-strong` | `ink` 500 | `ink-muted` |
| Bash | `surface-2` + `hairline` | `ink-muted` 500 | mono, `ink-subtle` |
| Read / Grep / Glob / Web | `surface-1` + `hairline` | `ink-subtle` 500 | `ink-tertiary` |
| any, `isError` | `error` @ 10% + `error` @ 30% | `error` | `ink-muted` |

Mutating operations read brightest; reads recede. That's the hierarchy the
user wants, delivered without a second hue.

## Typography

Inter, not Inter Tight. The Linear spec names Inter at 500/600/700 as the
closest free substitute for Linear's proprietary display cut. Weights
loaded: 400, 500, 600. Never 700; Linear avoids heavy display weights.

JetBrains Mono 400/500 for file paths, shell commands, timestamps, token
counts, session ids, and tool results. Mono signals "this is literal data
from the transcript."

### Rules

- Negative tracking scales with size: -0.6px at 28px, -0.2px at 15px,
  -0.05px at 14px, 0 below.
- `eyebrow` is the only uppercase style, and it takes positive tracking
  (+0.4px) to mark itself as taxonomy against the negative-tracked rest.
  Panel headers only, roughly six places in the whole app.
- The old design set nearly every string in 10px/0.18em uppercase. That
  flattens hierarchy and hurts legibility at small sizes. Default to
  sentence case at 12-14px.
- `font-variant-numeric: tabular-nums` on every number that sits in a
  column (durations, counts, token totals, timestamps).

## Elevation

Depth is the ladder plus a hairline. No drop shadows on flat content.

| Level | Treatment | Use |
|---|---|---|
| 0 | canvas, no border | page background, timeline rows |
| 1 | `surface-1` + 1px `hairline` | sidebar, panel headers, tool result blocks |
| 2 | `surface-2` + 1px `hairline` | hovered rows, inputs, chips |
| 3 | `surface-3` + 1px `hairline-strong` | active input, selected row, popover's own active row |
| focus | 2px `accent` outline, 2px offset | any focusable element |

Popovers float, so they carry a soft shadow. That's the one exception to the
no-shadow rule. A popover body sits at level 2, not 3, so its highlighted
row still has a level to climb to. Whenever a container and its active child
both need a surface, the child must end up lighter on dark and darker on
light. Selection always reads as a step up the ladder.

## Motion

This is a tool for scanning, not a landing page. Motion budget:

- Allowed: 120-160ms `ease-out` on hover/active color transitions; a 120ms
  fade+2px rise on popover open.
- Banned: staggered list entrances, count-up number animations, blinking
  indicators, film grain, background grids, parallax.
- Everything collapses under `prefers-reduced-motion: reduce`.

## Language

No metaphor. The UI names what the data is:

| Never | Always |
|---|---|
| flight, flight roster | session, Sessions |
| CALLSIGN | Project |
| ROUTE | Path |
| DEP / ARR | Started / Ended |
| EVENTS | Messages |
| FUEL | Tokens |
| AIRCRAFT | Model |
| cargo manifest, CARGO | Files |
| maneuver | tool calls |
| crew / agent / sys | You / (model name) / tool |
| REC NO. | session id |
| "retrieving record" | "Loading…" |
| "end of record" | (nothing, just stop) |

## Do / Don't

**Do**
- Reserve #010102 as the dark anchor. The faint blue tint is intentional.
- Move up the surface ladder one step at a time; don't skip levels.
- Pair 600 display with 400 body.
- Put mono on anything quoted verbatim from a transcript.
- Keep the accent scarce enough that a focus ring is genuinely noticeable.

**Don't**
- Don't use `#000000` true black as the canvas.
- Don't introduce a third hue (orange, pink, teal) for any reason.
- Don't color-code tool categories.
- Don't pill-round buttons. 8px.
- Don't set body copy in uppercase.
- Don't add a texture, grain, or grid overlay to the canvas.

## Reference

Derived from `design-md/linear.app/DESIGN.md` in
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
(the free mirror of [getdesign.md](https://getdesign.md)). The light theme
and the tool-outcome semantics are agenttrail additions; Linear's published
spec documents dark-only marketing surfaces and notes that the in-product
palette carries its own richer tag colors.
