# ocgt v3 — Frontend Design Direction

> **Status**: Production-ready design spec
> **Stack**: React 19 · Vite 6 · Tailwind CSS 3.4 · Recharts 2.15 · Lucide React
> **Platform**: Wails desktop app (Windows / macOS / Linux)
> **Last updated**: 2025-06-21

---

## Table of Contents

1. [Overall Visual Language](#1-overall-visual-language)
2. [Color System](#2-color-system)
3. [Typography Hierarchy](#3-typography-hierarchy)
4. [Spacing & Layout System](#4-spacing--layout-system)
5. [Component Styling Direction](#5-component-styling-direction)
6. [Page-by-Page Design Notes](#6-page-by-page-design-notes)
7. [Motion & Interaction](#7-motion--interaction)
8. [Implementation Reference](#8-implementation-reference)

---

## 1. Overall Visual Language

### Design DNA

ocgt should feel like it belongs in the same conversation as **Linear**, **Raycast**, and the **Vercel Dashboard** — a professional developer tool that is calm, precise, and quietly confident. It is not a consumer app; it is a cockpit.

| Reference | What we borrow |
|---|---|
| **Linear** | Constraint. Tight density. Minimal chrome. Every pixel earns its place. Section headers with colored bar accents. Data-first card layout. |
| **Raycast** | Glass surfaces with backdrop-blur. Accent glow on focus/hover. Keyboard-first navigation feel. Icon weight consistency. |
| **Vercel Dashboard** | Monospace numerics for data. Clean stat cards. Muted secondary text. Tables that breathe. |
| **Arc Browser** | Subtle gradients in surfaces. Smooth-but-fast transitions (200ms sweet spot). |

### Core Principles

1. **Dark-first, never dark-only.** The dark theme is the hero. The light theme is a first-class mirror — same layout, inverted depth. Never ship a component that only looks good in one mode.

2. **Glass, not glassmorphism theater.** One layer of `backdrop-blur(12px)` on elevated surfaces. No nested frosted panels — depth is created by background opacity tiers (`bg-1` → `bg-2` → `bg-3`), not by stacking blurs.

3. **Accent as signal, not decoration.** The user-selected accent color (teal by default, HSL-rotatable) appears on: active nav item, primary buttons, focus rings, chart primary series, and the section-title bar. It does **not** appear on backgrounds, borders, or body text. Accent restraint is what makes it feel premium.

4. **Data deserves monospace.** Every number — token counts, costs, latency, counts — uses `font-mono` (JetBrains Mono). This creates visual rhythm and instant scannability, the same way Vercel and GitHub treat metrics.

5. **Borders are whispers.** `rgba(255,255,255,0.06)` in dark mode — barely there until you hover. The hover state (`0.12`) is the real border. This creates the "borderless until interactive" feel of Linear.

6. **Motion is 200ms.** Everything interactive animates in 150–200ms with `ease-out`. No bouncing, no spring physics, no durations above 300ms. The app should feel snappy, not playful.

### Window Chrome (Wails Frameless)

- **Window radius**: `10px` outer corners (Windows 11/12 snapping compatible)
- **Drag region**: The top `32px` of the sidebar brand + header area acts as the drag handle
- **Traffic light / caption buttons**: Positioned in the top-right of the header, `28px × 28px` hit targets, ghost-styled (no background until hover)
- **Window shadow**: Native OS-managed; do not apply CSS shadow to the root container

---

## 2. Color System

### Surface Tiers (already in `globals.css` — refined usage rules)

| Token | Dark | Light | Usage |
|---|---|---|---|
| `--bg-0` | `#05080c` (near-black, blue-shifted) | `#f8f9fb` | App background. The void behind everything. |
| `--bg-1` | `rgba(14,21,30,0.7)` | `#ffffff` | Sidebar, header, top-level cards. The glass layer. |
| `--bg-2` | `rgba(23,29,40,0.8)` | `#edf0f4` | Nested surfaces: table headers, dropdown menus, modal bodies. |
| `--bg-3` | `rgba(30,37,51,0.9)` | `#e2e6ec` | Elevated overlays: popovers, tooltips, toast backgrounds. |

**Rule**: Never skip a tier. A card inside the main content sits on `bg-1`. A dropdown opened from that card sits on `bg-3` (skipping `bg-2` intentionally for elevation contrast). A table header inside a card sits on `bg-2`.

### Text Tiers

| Token | Dark | Light | Usage |
|---|---|---|---|
| `--text-0` | `#f1f5f9` | `#111827` | Primary text: page titles, card values, body copy, table data |
| `--text-1` | `#94a3b8` | `#6b7280` | Secondary text: card labels, subtitles, table secondary columns |
| `--text-2` | `#64748b` | `#9ca3af` | Tertiary text: captions, timestamps, helper text, placeholder |
| `--text-3` | `#475569` | `#d1d5db` | Muted: disabled states, skeleton shimmer base, footer text |

### Accent System

The accent is HSL-driven via `--accent-h`, `--accent-s`, `--accent-l`, allowing runtime hue rotation. The Tailwind config already maps these to `accent`, `accent-dim`, `accent-soft`, `accent-glow`.

| Token | Usage | Where to apply |
|---|---|---|
| `accent` (full) | Solid fills, active states | Primary buttons, active nav indicator, focus ring border, toggle-on track, section-title bar |
| `accent-dim` (75% S, 45% L) | Text accents on dark backgrounds | Links, inline model names in body text, chart hover tooltip accent |
| `accent-soft` (10% alpha) | Subtle backgrounds | Primary button hover, active chip background, selected row tint |
| `accent-glow` (25% alpha) | Glow effects | Box-shadow on focus rings, active nav glow, chart line area fill |

**Default accent**: Teal `H:174 S:85% L:55%` → `#14b8a6` / `hsl(174 85% 55%)`

#### Accent Usage Rules

- **Maximum 2 accent-colored elements per viewport quadrant.** If the dashboard has an active nav item AND a primary button AND a focus ring all glowing teal in the same area, it's too much. Primary buttons should use accent fill; focus rings should use accent at 40% opacity.
- **Never use accent for body text** except for inline model IDs and clickable links. Body text is always `text-0` or `text-1`.
- **Charts use a 5-color palette** derived from the accent: rotate hue by ±30° and ±60° from the accent hue. This creates a harmonious family that shifts with the user's accent choice.

```
Chart palette (derived from accent hue H):
  Series 1: hsl(H, 85%, 55%)      — accent itself
  Series 2: hsl(H+30, 75%, 60%)   — warmer shift
  Series 3: hsl(H-30, 70%, 50%)   — cooler shift
  Series 4: hsl(H+60, 65%, 65%)   — light warm
  Series 5: hsl(H-60, 60%, 45%)   — deep cool
```

#### Should we add gradient accents?

**Yes, selectively.** Gradients should reinforce the accent, not replace it. Use a 2-stop linear gradient from `accent` to `accent-dim` (`135deg`) in exactly these places:

1. **Primary button hover state** — `bg-gradient-to-br from-accent to-accent-dim` on hover only
2. **Active nav item left-edge glow** — a `3px` wide gradient bar that fades from `accent` (top) to `transparent` (bottom)
3. **Empty state icon background** — radial gradient `from-accent-soft to-transparent` behind the icon
4. **Loading spinner** — conic gradient using accent for the visible arc

**Do not** use gradients on: card backgrounds, large surface areas, text, or borders. Gradients are accents, not surfaces.

### Status Colors (Semantic)

Status colors are **fixed across themes** (they don't rotate with the accent) but shift lightness for contrast:

| Status | Dark | Light | Tailwind | Usage |
|---|---|---|---|---|
| Success / Online | `#34d399` | `#059669` | `success` / `text-success` | Active integration dot, "configured" badge, HTTP 2xx |
| Warning | `#fbbf24` | `#d97706` | `warning` / `text-warning` | Quota > 80%, degraded status, HTTP 4xx |
| Danger / Error | `#f87171` | `#dc2626` | `danger` / `text-danger` | Remove buttons, HTTP 5xx, quota exceeded |
| Info / Neutral | `#60a5fa` | `#2563eb` | `info` / `text-info` | Informational badges, "recommended" tag, external links |

#### Status Badge Pattern

Badges use a tinted background (8% alpha) + full-color text:

```
/* Success badge */
background: color-mix(in srgb, var(--green) 12%, transparent);
color: var(--green);
border: 1px solid color-mix(in srgb, var(--green) 25%, transparent);
border-radius: 6px;
padding: 2px 8px;
font-size: 11px;
font-weight: 600;
```

**Tailwind equivalent**: `inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border` with `bg-success/10 text-success border-success/25`.

#### Status Dot Pattern

| State | Appearance |
|---|---|
| Active/Online | `8px` circle, `success` fill, `0 0 0 3px success/15` ring, soft pulse animation (opacity 1→0.5 over 2s) |
| Inactive/Offline | `8px` circle, `text-3` fill (muted gray), no ring, no animation |
| Warning | `8px` circle, `warning` fill, `0 0 0 3px warning/15` ring, no animation |
| Error | `8px` circle, `danger` fill, `0 0 0 3px danger/15` ring, no animation |

---

## 3. Typography Hierarchy

### Font Stack

- **Sans (UI)**: `Inter` — loaded via `@fontsource/inter` or system fallback. Weights: 400 (body), 500 (labels), 600 (emphasis), 700 (titles).
- **Mono (Data)**: `JetBrains Mono` — loaded via `@fontsource/jetbrains-mono`. Weights: 400 (inline code), 600 (stat values), 700 (hero numbers).

### Scale

| Role | Size | Weight | Font | Color | Tailwind |
|---|---|---|---|---|---|
| **Page title** | `20px` | 700 | Inter | `text-0` | `text-xl font-bold text-content-primary` |
| **Page subtitle** | `13px` | 400 | Inter | `text-1` | `text-[13px] text-content-secondary` |
| **Section title** | `14px` | 700 | Inter | `text-0` | `text-sm font-bold text-content-primary` (with accent bar prefix) |
| **Card title** | `14px` | 600 | Inter | `text-0` | `text-sm font-semibold text-content-primary` |
| **Card description** | `12px` | 400 | Inter | `text-1` | `text-xs text-content-secondary` |
| **Stat value (hero)** | `28px` | 700 | JetBrains Mono | `text-0` | `text-[28px] font-bold font-mono tracking-tight text-content-primary` |
| **Stat value (standard)** | `24px` | 700 | JetBrains Mono | `text-0` | `text-2xl font-bold font-mono tracking-tight` |
| **Stat value (compact)** | `18px` | 600 | JetBrains Mono | `text-0` | `text-lg font-semibold font-mono` |
| **Stat label** | `11px` | 500 | Inter | `text-1` | `text-[11px] font-medium text-content-secondary uppercase tracking-wide` |
| **Body text** | `13px` | 400 | Inter | `text-0` | `text-[13px] text-content-primary` |
| **Secondary body** | `13px` | 400 | Inter | `text-1` | `text-[13px] text-content-secondary` |
| **Caption / helper** | `11px` | 400 | Inter | `text-2` | `text-[11px] text-content-tertiary` |
| **Label (form)** | `12px` | 500 | Inter | `text-1` | `text-xs font-medium text-content-secondary` |
| **Button text** | `13px` | 600 | Inter | context | `text-[13px] font-semibold` |
| **Badge text** | `11px` | 600 | Inter | context | `text-[11px] font-semibold` |
| **Table header** | `11px` | 600 | Inter | `text-2` | `text-[11px] font-semibold text-content-tertiary uppercase tracking-wide` |
| **Table cell** | `13px` | 400 | Inter/Mono | `text-0` | `text-[13px]` (mono for numbers) |
| **Nav item label** | `13px` | 500 | Inter | `text-1` → `text-0` (active) | `text-[13px] font-medium` |
| **Keyboard shortcut** | `10px` | 500 | JetBrains Mono | `text-3` | `text-[10px] font-mono text-content-muted` |

### Letter Spacing

- Headings and labels: `tracking-tight` (`-0.01em`) for titles, `tracking-wide` (`0.05em`) for uppercase labels
- Monospace values: `tracking-tight` (`-0.02em`) — tightens large numbers so they don't feel loose
- Never apply letter-spacing to body paragraphs

### Line Height

- Headings: `leading-tight` (1.25)
- Body: `leading-relaxed` (1.625) for descriptions, `leading-normal` (1.5) for form labels
- Single-line UI elements (badges, buttons, nav): `leading-none` (1)

---

## 4. Spacing & Layout System

### App Shell

```
┌──────────────────────────────────────────────────────┐
│  Sidebar (240px)  │     Main Content (flex-1)        │
│                   │                                   │
│  ┌─────────────┐  │  ┌─────────────────────────────┐ │
│  │   Brand     │  │  │      Header (56px)          │ │
│  ├─────────────┤  │  ├─────────────────────────────┤ │
│  │   Nav       │  │  │                             │ │
│  │   Items     │  │  │      Content Area           │ │
│  │             │  │  │      (scroll, padding: 24px) │ │
│  │             │  │  │                             │ │
│  ├─────────────┤  │  │                             │ │
│  │   Status    │  │  ├─────────────────────────────┤ │
│  │   Footer    │  │  │      Footer (28px)          │ │
│  └─────────────┘  │  └─────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Sidebar

- **Width**: `240px` (`--sidebar-w`). Fixed, non-collapsible. A desktop dashboard tool needs the labels visible at all times — icon-only mode hurts discoverability for a 7-page app.
- **Background**: `var(--bg-1)` with `backdrop-blur(12px)`
- **Right border**: `1px solid var(--border)`
- **Internal padding**: `12px` top/bottom, `8px` left/right
- **Brand area**: `56px` tall, `8px` padding, logo `28px × 28px`, title `15px font-bold`
- **Nav item**: `36px` tall, `8px` padding-x, `6px` gap between icon and label, icon `18px`, `border-radius: 8px`
- **Nav item margin-bottom**: `2px` (tight stack, Linear-style)
- **Nav sections**: Group with a `10px` margin-top + `8px` padding-left section label (`10px`, uppercase, `text-3`, `font-semibold`). Suggested groups: "Monitor" (Dashboard, Traffic, Detail), "Manage" (Settings, Quick Connect), "Sync" (Hub, Sessions)
- **Status footer**: Pinned to bottom, `8px` gap from last nav item, status pill + prefs button

### Header

- **Height**: `56px` (fixed, non-scrolling)
- **Padding**: `0 24px`
- **Background**: `var(--bg-1)` with `backdrop-blur(12px)`
- **Bottom border**: `1px solid var(--border)`
- **Layout**: Flexbox, space-between
  - **Left**: Page title (`20px font-bold`) + subtitle (`13px text-1`) stacked with `2px` gap
  - **Right**: Last-updated indicator (`11px text-2`, clock icon `14px`) + status badge

### Content Area

- **Padding**: `24px` on all sides
- **Max width**: None (fills available space). But internal grids use `max-width: 1200px` centered for very wide screens to avoid line-length explosion.
- **Scroll**: Vertical only, `overflow-y: auto`, custom scrollbar (`6px` width)
- **Background**: `var(--bg-0)`

### Card Grid (Dashboard-style pages)

- **Grid gap**: `16px` between cards
- **Section gap**: `24px` between grid sections (stat grid → chart grid → table section)
- **Grid template**: Use CSS Grid with `auto-fill` / `minmax()`:
  - Stat cards: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
  - Wide stat cards (2-col span): same grid, items with `grid-column: span 2`
  - Chart row: `grid-template-columns: 2fr 1fr` for main+side layout, collapses to `1fr` below `900px` content width

### Card Internal Spacing

| Element | Value |
|---|---|
| Card padding | `20px` (`p-5`) |
| Card header gap (icon ↔ titles) | `12px` |
| Card title ↔ description gap | `2px` |
| Card header ↔ body gap | `16px` |
| Field row gap (within card) | `12px` |
| Field row internal gap (label ↔ input) | `6px` |

### Footer Bar

- **Height**: `28px`
- **Background**: `var(--bg-1)`, no blur
- **Top border**: `1px solid var(--border)`
- **Padding**: `0 16px`
- **Text**: `11px text-3`, left-aligned status text

### Responsive Behavior

This is a desktop app, so "responsive" means window resize, not mobile breakpoints. The key thresholds:

| Window width | Behavior |
|---|---|
| **≥ 1200px** | Full layout. Dashboard grids show 3-4 columns. Chart rows show main + side. |
| **900–1199px** | Dashboard grids drop to 2 columns. Chart rows stack vertically (1 column). Tables get horizontal scroll if needed. |
| **< 900px** | Dashboard grids drop to 1 column. Tables always get horizontal scroll with a `6px` scrollbar. Settings field rows collapse from 2-3 columns to 1. |

Minimum supported window size: `768px × 600px`. Below this, the app should still function but may look cramped. This is acceptable for a desktop tool.

---

## 5. Component Styling Direction

### 5.1 Sidebar Navigation

**Structure**: Vertical nav list with icon + label + optional keyboard shortcut badge.

```
Nav Item (inactive):
  height: 36px
  padding: 0 8px
  border-radius: 8px
  display: flex, align-items: center, gap: 8px
  background: transparent
  color: var(--text-1)
  icon: 18px, Lucide React, stroke-width: 1.75
  label: 13px font-medium
  shortcut badge: pushed to right (margin-left: auto), 10px font-mono, text-3

Nav Item (hover):
  background: var(--surface-hover)
  color: var(--text-0)
  transition: 150ms ease-out

Nav Item (active):
  background: var(--accent-soft)  /* accent at 10% alpha */
  color: var(--text-0)
  font-weight: 600
  Left edge accent bar: 3px wide, full height, border-radius: 2px,
    background: linear-gradient(180deg, accent, accent-dim),
    box-shadow: 0 0 8px accent-glow
  Icon color: accent (full)
```

**Keyboard shortcut badges**: `⌘1` through `⌘7` (or `Ctrl+1` on Windows). Rendered as `10px` JetBrains Mono in `text-3`. Always right-aligned. On hover, brighten to `text-1`.

**Icon consistency**: Use Lucide React exclusively. Stroke-width `1.75` for nav (slightly lighter than the default `2` — this matches Linear's delicate icon treatment). Icon size: `18px` for nav, `16px` for inline/card icons, `14px` for button icons.

### 5.2 Stat Cards

**Structure**: Icon (left) + label (top) + value (below) + optional secondary info.

```
Card container:
  background: var(--bg-1)
  backdrop-filter: blur(12px)
  border: 1px solid var(--border)
  border-radius: 12px (var(--radius))
  padding: 20px
  transition: border-color 200ms ease, box-shadow 200ms ease

Card (hover):
  border-color: var(--border-hover)
  box-shadow: 0 0 0 1px var(--border-hover), 0 8px 24px -8px rgba(0,0,0,0.3)
  (dark mode only; light mode hover just darkens border)

Layout (icon + info):
  display: flex, gap: 12px, align-items: flex-start

Icon container:
  width: 36px, height: 36px
  border-radius: 8px
  background: var(--accent-soft)
  color: var(--accent)
  display: flex, align-items: center, justify-content: center
  flex-shrink: 0
  (icon: 18px Lucide)

Info container:
  flex: 1, min-width: 0  /* allows text truncation */

Stat label:
  11px font-medium, uppercase, tracking-wide
  color: var(--text-1)

Stat value:
  font-mono, font-bold, 24px (or 28px for hero)
  tracking-tight, color: var(--text-0)
  margin-top: 4px
  line-height: 1.1
  white-space: nowrap, overflow: hidden, text-overflow: ellipsis

Stat secondary (optional):
  11px, color: var(--text-2), margin-top: 4px
```

**Wide variant**: `grid-column: span 2`. Same internal layout but with wider value area. Used for listen address, upstream URL, quota bars.

**Quota bar variant**: Replace the stat-value with horizontal progress bars. Each bar:
```
Container: margin-top: 8px
Label row: flex, justify-between, 11px font-medium
  Left: model name (text-0)
  Right: "1.23M / 5M" (text-2, font-mono)
Bar track: height 6px, border-radius 3px, background var(--surface-active)
Bar fill: height 6px, border-radius 3px
  Color: accent (under 60%), warning (60-80%), danger (>80%)
  Transition: width 400ms ease-out
```

### 5.3 Data Tables

**Philosophy**: Tables should feel like Linear's issue list — clean, scannable, with subtle row separation that disappears until you need it.

```
Table container:
  No card wrapper for tables — they sit directly in a card body section.
  The card provides the border and background.

Table header row:
  height: 36px
  background: var(--bg-2)
  font: 11px font-semibold, uppercase, tracking-wide, color: var(--text-2)
  border-bottom: 1px solid var(--border)
  text-align: left (right-aligned for numeric columns)
  padding: 0 12px
  position: sticky, top: 0, z-index: 5

Table body row:
  height: 40px
  border-bottom: 1px solid var(--border) (very subtle)
  padding: 0 12px
  font: 13px, color: var(--text-0)
  transition: background 100ms ease

Table body row (hover):
  background: var(--surface-hover)

Table body row (last):
  No bottom border

Numeric cells:
  font-mono, text-right, tabular-nums
  color: var(--text-0)

Secondary cells (model name, source):
  color: var(--text-1) or var(--text-0) for model IDs (use mono)

Status cell:
  Inline badge (see Status Badge Pattern above)
```

**Zebra striping**: **No.** Do not use alternating row backgrounds. The 1px border between rows is sufficient separation. Zebra striping adds visual noise that competes with data. (Linear, Vercel, and GitHub all dropped zebra striping years ago.)

**Sticky headers**: Yes, always. When a table is inside a scrolling container, the header sticks to `top: 0` within that container. The header gets a subtle `backdrop-blur(8px)` so content scrolling underneath is slightly obscured.

**Empty table state**: Center a muted icon (`32px`, `text-3`) + message (`13px text-1`) + optional action button. See [Empty States](#58-empty-states).

**Pagination bar**: Below the table, `12px` padding-top:
```
Layout: flex, justify-between, align-items: center
Left: "Showing 1–20 of 156" — 12px text-2 font-mono for numbers
Right: Page buttons — ghost buttons, 28px height, 8px padding-x
  Active page: accent-soft background, accent text
  Prev/Next: icon buttons (chevron), disabled state at 40% opacity
```

### 5.4 Chart Containers

**Chart card wrapper**: Every chart lives inside a standard card (`p-5`, `rounded-lg`, `border`, `bg-1`).

```
Chart card structure:
  ┌─────────────────────────────────┐
  │  Chart Title (14px font-bold)   │  ← section-title with accent bar
  │  Optional subtitle (11px text-2)│  ← e.g., "Last 7 days"
  ├─────────────────────────────────┤
  │                                 │
  │       Chart Canvas/SVG          │
  │       (height: see below)       │
  │                                 │
  └─────────────────────────────────┘

Chart title row:
  flex, items-center, justify-between
  Left: title + subtitle (stacked, 2px gap)
  Right: optional legend or filter (e.g., time range pills)

Chart padding:
  Title to chart: 16px gap
  Chart to card bottom: 0px (chart fills remaining space)
  Chart left/right padding: 0px (let Recharts handle axis padding)
```

**Chart heights**:
- Token/request trend (main): `220px`
- Model donut (side): `180px` canvas, `160px` chart area
- Request trend (secondary): `180px`
- Model breakdown (donut): `200px`
- Hub model distribution: `200px`

**Recharts theming** (not Chart.js — the React version uses Recharts):

| Element | Value |
|---|---|
| Grid lines | `stroke: var(--border)`, `strokeDasharray: "3 3"`, horizontal only |
| Axis tick text | `11px`, `fill: var(--text-2)`, `font-family: Inter` |
| Axis line | Hidden (`stroke: transparent`) |
| Tooltip | `bg-3` background, `border`, `rounded-md`, `8px` padding, `11px` text, `shadow-md`, no default Chart.js style — fully custom |
| Line series | `strokeWidth: 2`, `dot: false`, `activeDot: { r: 4, fill: accent }` |
| Area fill | Gradient from `accent/20` (top) to `accent/0` (bottom) |
| Bar series | `borderRadius: [4, 4, 0, 0]` (top corners only), `barSize: 12` |
| Donut | `innerRadius: 55%`, `outerRadius: 80%`, `paddingAngle: 2`, centered label showing total |
| Animation | `isAnimationActive: true`, `animationDuration: 600`, `animationEasing: "ease-out"` |

### 5.5 Integration Cards (Quick Connect)

**Pattern**: Expandable row with icon, title, status badge, action buttons, and a collapsible details drawer.

```
Integration row (collapsed):
  ┌───────────────────────────────────────────────────────┐
  │ [icon]  Title Text              [badge]  [btn] [btn]  │
  │                                                  [▾]  │
  └───────────────────────────────────────────────────────┘
  
  background: var(--bg-1)
  border: 1px solid var(--border)
  border-radius: 12px
  margin-bottom: 8px
  
  Inner main (flex row):
    height: 56px
    padding: 0 16px
    align-items: center, gap: 12px

  Icon:
    width: 36px, height: 36px
    border-radius: 8px
    background: var(--surface-active)
    color: var(--text-1)
    (icon: 18px)
  
  Title:
    14px font-semibold, color: var(--text-0)
  
  Badge (status):
    11px, see Status Badge Pattern
    Positioned right after title
  
  Action buttons:
    margin-left: auto
    Primary: "一键激活" — accent fill
    Ghost-danger: "移除配置" — text-danger, ghost background
  
  Expand button (chevron):
    24px, text-2, rotates 180deg when expanded

Integration row (expanded):
  border-color: var(--border-hover)
  
  Drawer (slide down):
    max-height transition from 0 to auto (use grid-template-rows trick
    or React state with CSS height)
    Padding: 16px
    border-top: 1px solid var(--border)
    
    Contains: description text (13px text-1), code blocks,
    optional shell tabs, tips
```

**Dual Codex distinction** (Codex CLI vs Codex App):

Since both integrate with OpenAI's Codex ecosystem, they need subtle visual differentiation without being confusing:

| Aspect | Codex CLI | Codex App |
|---|---|---|
| Icon | `Terminal` icon (Lucide) | `Monitor` or `AppWindow` icon (Lucide) |
| Icon background tint | `info/10` (blue-tinted, matching OpenAI's brand) | `info/10` (same blue tint) |
| Title suffix | "Codex CLI" | "Codex App" |
| Badge label when active | "CLI 已配置" | "App 已配置" |
| Description emphasis | Mentions `~/.codex/config.toml` in mono | Mentions GUI app config path |
| Visual grouping | Place adjacent in the list with a `4px` gap between them (tighter than the `8px` gap to other cards) | Same |
| Optional separator | A subtle `1px dashed border-l` on the App card's left edge in `border` color, creating a faint "sub-item" visual link to the CLI card above it | — |

The goal: they look like siblings (same blue icon tint, adjacent placement) but the icon and title suffix make them instantly distinguishable. Think of how VS Code and VS Code Insiders share visual language but have distinct marks.

### 5.6 Forms & Inputs

#### Text Input

```
Container:
  position: relative

Input:
  width: 100%
  height: 36px
  padding: 0 12px
  background: var(--surface)
  border: 1px solid var(--border)
  border-radius: 8px (var(--radius-sm))
  font: 13px Inter, color: var(--text-0)
  transition: border-color 150ms ease, box-shadow 150ms ease

Input (focus):
  border-color: accent
  box-shadow: 0 0 0 3px accent-glow (accent at 25% alpha)
  outline: none

Input (placeholder):
  color: var(--text-2)

Input (error):
  border-color: danger
  box-shadow: 0 0 0 3px danger/15
  (error text appears below: 11px text-danger)

Input (disabled):
  opacity: 0.5
  cursor: not-allowed

Password input variant:
  Same as text, but with an eye-toggle button absolutely positioned
  on the right inside the input (24px, text-2, hover → text-1)
```

#### Select (Custom)

Do not use native `<select>`. Build a custom dropdown using a button + popover for consistent theming:

```
Trigger button:
  Same dimensions as text input (36px height, 12px padding)
  background: var(--surface), border: var(--border), radius: 8px
  display: flex, justify-between, align-items: center
  Right side: ChevronDown icon (16px text-2), rotates 180deg when open

Dropdown popover:
  position: absolute, top: calc(100% + 4px), left: 0, right: 0
  background: var(--bg-3) (highest tier for overlays)
  backdrop-filter: blur(16px)
  border: 1px solid var(--border-hover)
  border-radius: 8px
  box-shadow: var(--shadow-lg)
  padding: 4px
  z-index: 50
  max-height: 240px, overflow-y: auto
  
Option:
  height: 32px, padding: 0 10px
  border-radius: 6px
  font: 13px, color: var(--text-1)
  cursor: pointer
  
Option (hover):
  background: var(--surface-hover), color: var(--text-0)
  
Option (selected):
  background: var(--accent-soft), color: var(--text-0), font-weight: 500
  Right side: Check icon (14px accent)
```

#### Toggle Switch

```
Container: label (flex, align-items: center, gap: 8px, cursor: pointer)

Track (off):
  width: 36px, height: 20px
  border-radius: 10px (pill)
  background: var(--surface-active)
  border: 1px solid var(--border)
  position: relative
  transition: background 200ms ease

Knob (off):
  width: 14px, height: 14px
  border-radius: 50%
  background: var(--text-1)
  position: absolute, top: 2px, left: 2px
  transition: transform 200ms ease, background 200ms ease

Track (on):
  background: accent
  border-color: accent

Knob (on):
  transform: translateX(16px)
  background: white
```

#### Segmented Control (e.g., Thinking Intensity)

```
Container:
  display: inline-flex
  background: var(--surface)
  border: 1px solid var(--border)
  border-radius: 8px
  padding: 3px
  gap: 2px

Segment button:
  padding: 6px 14px
  border-radius: 6px
  font: 13px font-medium, color: var(--text-1)
  background: transparent
  transition: all 150ms ease

Segment (hover):
  color: var(--text-0)

Segment (active):
  background: var(--bg-2)  (or accent-soft for emphasis)
  color: var(--text-0)
  font-weight: 600
  box-shadow: var(--shadow)  (subtle inset feel)
```

#### Segmented Tabs (e.g., Sessions time period)

Similar to segmented control but full-width:

```
Container:
  display: flex
  background: var(--surface)
  border: 1px solid var(--border)
  border-radius: 8px
  padding: 3px

Tab button:
  flex: 1
  padding: 6px 16px
  (same styling as segmented control segments)
```

#### Code/Textarea (JSON editor)

```
Textarea:
  width: 100%
  padding: 12px
  background: var(--bg-2)
  border: 1px solid var(--border)
  border-radius: 8px
  font: 13px JetBrains Mono, line-height: 1.5
  color: var(--text-0)
  resize: vertical
  min-height: 120px

Focus state: same as text input (accent border + glow ring)
```

### 5.7 Buttons

```
Primary button:
  height: 36px (default) / 30px (btn-sm)
  padding: 0 16px / 0 12px (sm)
  background: accent
  color: white (or #ffffff for contrast)
  border: none
  border-radius: 8px
  font: 13px font-semibold
  cursor: pointer
  transition: all 150ms ease
  display: inline-flex, align-items: center, gap: 6px

Primary (hover):
  background: linear-gradient(135deg, accent, accent-dim)
  box-shadow: 0 4px 12px -2px accent-glow
  transform: translateY(-1px)

Primary (active):
  transform: translateY(0)
  box-shadow: 0 2px 4px accent-glow

Primary (disabled):
  opacity: 0.4
  cursor: not-allowed
  (no hover transform)

Secondary button:
  Same dimensions as primary
  background: var(--surface)
  color: var(--text-0)
  border: 1px solid var(--border)

Secondary (hover):
  background: var(--surface-hover)
  border-color: var(--border-hover)

Ghost button:
  Same dimensions
  background: transparent
  color: var(--text-1)
  border: none

Ghost (hover):
  background: var(--surface-hover)
  color: var(--text-0)

Danger ghost button:
  Same as ghost but color: danger
  Danger ghost (hover): background: color-mix(in srgb, danger 8%, transparent)
```

### 5.8 Empty States

```
Container:
  display: flex, flex-direction: column
  align-items: center, justify-content: center
  padding: 48px 24px
  text-align: center

Icon:
  width: 48px, height: 48px
  border-radius: 12px
  background: radial-gradient(circle, accent-soft, transparent)
  color: accent (at 60% opacity for subtlety)
  display: flex, align-items: center, justify-content: center
  margin-bottom: 16px
  (icon: 24px Lucide)

Title:
  14px font-semibold, color: var(--text-0)
  margin-bottom: 4px

Message:
  13px, color: var(--text-1), max-width: 320px
  line-height: 1.5

Action (optional):
  margin-top: 16px
  Primary or secondary button
```

**Empty state copy examples**:
- Traffic Monitor: "暂无流量数据" / "代理启动后，请求记录将在此显示"
- Sessions: "暂无会话记录" / "开始使用 Claude Code 后，会话将自动记录"
- Hub: "暂无在线设备" / "在其他设备上启动 ocgt 并启用同步即可查看"
- Traffic Detail: "暂无明细记录" / "调整时间范围或筛选条件试试"

### 5.9 Loading States

#### Skeleton Screens (preferred for initial page load)

```
Skeleton block:
  background: linear-gradient(
    90deg,
    var(--surface) 0%,
    var(--surface-hover) 50%,
    var(--surface) 100%
  )
  background-size: 200% 100%
  animation: shimmer 1.5s ease-in-out infinite
  border-radius: 4px

@keyframes shimmer:
  0%: background-position: 200% 0
  100%: background-position: -200% 0

Skeleton card (for dashboard):
  Matches the stat-card dimensions exactly:
  - 36px square icon placeholder (rounded-md)
  - Two text lines: 60% width (label), 80% width (value)
  - Same padding (20px) and border-radius (12px)
  - border: 1px solid var(--border)
```

#### Spinners (for inline/button loading)

```
Spinner:
  width: 16px, height: 16px (or 14px for button-internal)
  border: 2px solid var(--border-hover)
  border-top-color: accent
  border-radius: 50%
  animation: spin 0.6s linear infinite

@keyframes spin:
  to { transform: rotate(360deg) }

Large spinner (for overlay):
  width: 32px, height: 32px
  border-width: 3px
```

#### Loading overlay (startup/connection)

```
Full-screen overlay:
  position: fixed, inset: 0
  background: var(--bg-0) at 90% opacity
  backdrop-filter: blur(4px)
  display: flex, flex-direction: column
  align-items: center, justify-content: center
  z-index: 100

Content:
  Large spinner (32px)
  Title: 16px font-semibold, margin-top: 16px
  Subtitle: 13px text-1, margin-top: 4px
  Retry button (hidden by default): margin-top: 20px
```

### 5.10 Modals / Dialogs

```
Overlay:
  position: fixed, inset: 0
  background: rgba(0, 0, 0, 0.5)  (dark mode)
  background: rgba(0, 0, 0, 0.3)  (light mode)
  backdrop-filter: blur(4px)
  display: flex, align-items: center, justify-content: center
  z-index: 200
  animation: fadeIn 150ms ease

Modal card:
  width: min(480px, 90vw)  (default)
  width: min(640px, 90vw)  (wide variant — for custom model, session detail)
  max-height: 80vh
  background: var(--bg-1)  (glass surface)
  backdrop-filter: blur(20px)
  border: 1px solid var(--border-hover)
  border-radius: 16px  (slightly larger than cards for modal emphasis)
  box-shadow: var(--shadow-lg)
  display: flex, flex-direction: column
  animation: slideUp 200ms cubic-bezier(0.16, 1, 0.3, 1)

Modal header:
  padding: 20px 24px 0
  display: flex, align-items: center, justify-between
  
  Title: 16px font-bold, color: var(--text-0)
  Close button: 28px ghost icon button, top-right

Modal body:
  padding: 16px 24px
  overflow-y: auto
  flex: 1

Modal footer:
  padding: 0 24px 20px
  display: flex, justify-content: flex-end, gap: 8px
  (border-top: 1px solid var(--border) if body scrolls)
```

**Modal variants**:

| Variant | Description |
|---|---|
| **Confirm** | Centered icon + title + message + action buttons. Used for close dialog, clear history. No header/body/footer split — single padded block. |
| **Form** | Header (title + close) + body (form fields) + footer (cancel + confirm). Used for custom model dialog. |
| **Detail** | Header (title + actions + close) + scrollable body. Used for session detail with conversation turns. Wide variant (640px). |
| **About** | Centered branding: app icon, version badge, title, description, meta table, close button. Decorative, no form structure. |

### 5.11 Status Chips / Sync Bars

Used in Settings (sync status strip) and Dashboard (integration chips):

```
Sync chip:
  display: inline-flex, align-items: center, gap: 6px
  padding: 4px 10px
  background: var(--surface)
  border: 1px solid var(--border)
  border-radius: 6px
  font: 12px, color: var(--text-1)

Sync chip label: text-2, 12px
Sync chip value: text-0, 12px font-mono, font-weight: 500

Sync dot: 6px circle (smaller than nav status dots)
  Active: success fill + ring
  Inactive: text-3 fill
```

### 5.12 Toast Notifications

```
Toast container:
  position: fixed, bottom: 40px, right: 24px
  display: flex, flex-direction: column, gap: 8px
  z-index: 300

Toast:
  min-width: 280px, max-width: 400px
  padding: 12px 16px
  background: var(--bg-3)
  backdrop-filter: blur(16px)
  border: 1px solid var(--border-hover)
  border-radius: 10px
  box-shadow: var(--shadow-md)
  display: flex, align-items: flex-start, gap: 10px
  animation: slideInRight 200ms ease

Toast icon: 18px, positioned left
  Success: CheckCircle, success color
  Error: XCircle, danger color
  Info: Info, info color

Toast title: 13px font-semibold, text-0
Toast message: 12px, text-1, optional

Toast variants use a 3px left border:
  Success: border-left: 3px solid success
  Error: border-left: 3px solid danger
  Info: border-left: 3px solid info
  Warning: border-left: 3px solid warning

Auto-dismiss: 4 seconds (success/info), 6 seconds (error)
Close button: 16px ghost, top-right
```

---

## 6. Page-by-Page Design Notes

### 6.1 Dashboard

**Layout**: Three vertical sections, each a card grid:

1. **Status cards** (6 cards in auto-fill grid): listen address (wide), upstream (wide), timeout, API key, profile, model. Each card shows icon + label + value. The first two span 2 columns because they contain URLs/addresses.

2. **Quota monitoring** (1 wide card): Horizontal progress bars for each model quota. Refresh button in the top-right of the card. "Last refreshed" timestamp below the bars.

3. **Integration status** (1 wide card): Horizontal row of status chips (CLI, VS Code, Claude Desktop, Codex). Each chip is a sync-chip with a status dot. Clicking a chip navigates to Quick Connect.

**Visual emphasis**: The listen address and model cards are the most important — they answer "is it running?" and "what model am I using?". Give these slightly larger icon backgrounds (`accent-soft` fill) to draw the eye.

**Refresh behavior**: Auto-refresh every 30 seconds. Manual refresh button in header (ghost icon button). Last-updated text updates with relative time ("刚刚更新", "30秒前").

### 6.2 Settings

**Layout**: Vertical stack of setting cards, each with a card header (icon + title + description) and a body with field rows.

**Cards (in order)**:
1. API Proxy Config — profile select, API key (password), quota cookie, workspace ID, default model, timeout
2. Model Strategy — thinking intensity (segmented control), model alias mapping (3 selects: Sonnet/Haiku/Opus)
3. Network Config (collapsible `<details>`) — upstream URL, listen address, rate limits (3 fields in a row)
4. Advanced Env (collapsible) — env toggle chips, numeric env params, JSON editor textarea

**Action bar**: Sticky at the bottom of the scroll area. Cancel (secondary) + Save & Apply (primary). Background `bg-1` with top border, `12px` padding.

**Sync status strip**: Between cards and action bar. Shows current profile, listen address, and integration states as sync chips.

**Form field rows**: Use CSS grid `grid-template-columns: repeat(2, 1fr)` or `repeat(3, 1fr)` with `12px` gap. Each field has a label (12px, text-1, font-medium) above the input.

### 6.3 Quick Connect

**Layout**: Vertical stack of expandable integration cards with `8px` gap. No card grid — this is a single-column list.

**Card order**:
1. Claude Code CLI (system env)
2. Quick Start: Temp Terminal (recommended badge)
3. Repair All (utility action)
4. VS Code Claude Code plugin
5. Claude Code settings (settings.json)
6. Claude Desktop App
7. Codex CLI
8. Codex App *(planned — see dual Codex distinction)*

**Page header subtitle**: "一键配置 Claude Code、Codex 及其他客户端的代理连接" or English equivalent.

**Code blocks in expanded drawer**: Use a dark code container (`bg-2`, `rounded-md`, `8px` padding, `font-mono`, `12px`, `text-0`) with a copy button (ghost, top-right). Shell tabs (PowerShell/CMD/Bash) as compact segmented tabs above the code block.

### 6.4 Traffic Monitor

**Layout**: Top bar (time range + title + timestamp) → stat row → chart rows → model breakdown table.

**Time range selector**: Segmented pill tabs (今日 / 7天 / 30天) in the top-left of the top bar.

**Stat row**: 3-4 stat cards in a row:
- Total Requests (`28px` mono value)
- Total Tokens (input + output, `28px` mono)
- Total Cost (`28px` mono, prefixed with `$`)
- (Optional) Avg Latency

**Chart rows**: Two rows:
- Row 1: Token trend (2fr, line/area chart) + Model donut (1fr)
- Row 2: Request trend (2fr, bar chart) + Client source table (1fr)

**Model breakdown table**: Full-width table section with header row showing 8 columns (Model, Requests, Input, Output, Cache, Total, Proportion bar, Cost). Numeric columns right-aligned and monospace.

### 6.5 Traffic Detail

**Layout**: Top bar (title + timestamp + controls) → table → pagination.

**Controls row**: Time range selector + model filter (select) + status filter (select) + refresh button + export CSV button + clear history button (danger ghost).

**Table**: 10 columns (Time, Model, Status, Input, Output, Cache, Total, Latency, Source, Error). Sticky header. Row height `40px`. Status column shows inline badge. Error column truncated with ellipsis + tooltip on hover.

**Pagination**: Bottom bar with page info + prev/next + page number buttons.

**Export CSV**: Triggers download, shows a success toast. Button shows a brief loading spinner during export.

**Clear history**: Opens a confirm modal ("确定要清除所有流量记录？此操作不可撤销。") with danger primary button.

### 6.6 Hub (Multi-Device Sync)

**Layout**: Connection status bar → aggregate stats → device list → model distribution chart.

**Connection status bar**: Full-width card-like bar showing:
- Left: Status dot (large, `10px`) + status text ("已连接" / "未连接") + device ID label (mono, `text-2`)
- Right: Refresh button (secondary) + Sync Now button (primary)

**Aggregate stats**: 2 wide stat cards side by side:
- Total Tokens across all devices (with today's breakdown below)
- Total Cost across all devices (with today's breakdown below)

**Device list**: Card with header ("在线设备" + device count badge) and a list of device rows:
```
Device row:
  height: 48px, padding: 0 16px
  display: flex, align-items: center, gap: 12px
  border-bottom: 1px solid var(--border)
  
  Left: Status dot (8px) + Device name (14px font-semibold)
  Right: Device ID (mono, 12px text-2) + Last seen (12px text-2) +
         Token count (mono, 13px text-0) + Cost (mono, 13px text-0)
```

**Model distribution chart**: Card with a Recharts bar chart showing token usage per model across all devices.

**Empty state** (no devices): "暂无设备数据" with a description explaining how to connect other devices.

### 6.7 Sessions

**Layout**: Period bar + summary → control bar → optional chart → session list → detail modal.

**Period bar**: Segmented tabs (今日 / 本月 / 全部) on the left + summary stats on the right (session count · total tokens · total cost, with `·` separators and mono numbers in bold).

**Control bar**: Search input (with search icon) + model filter select + sort select + content toggle. All inline, `8px` gap.

**Session list**: Compact expandable rows:
```
Session row (collapsed):
  height: 44px, padding: 0 12px
  display: flex, align-items: center, gap: 12px
  border-bottom: 1px solid var(--border)
  hover: background var(--surface-hover)
  
  Left: Model badge (small, colored) + Session ID (mono, 12px text-2, truncated)
  Right: Time (12px text-2) + Tokens (mono, 13px text-0) + Cost (mono, 13px text-0)
         + Expand chevron

Session row (expanded):
  Shows: Turn count, input/output breakdown, duration, first message preview
  Indented section with left border accent
```

**Session detail modal** (wide, 640px): Header with session ID + model + close button. Body shows conversation turns:
```
Conversation turn:
  Alternating alignment or consistent left-align with role labels
  Role label: 11px uppercase, text-2 (USER / ASSISTANT)
  Content: 13px text-0, max-height with scroll
  Token count: 11px mono text-2, right-aligned per turn
```

**Optional model distribution chart**: Collapsible section between control bar and session list. Click to expand a small horizontal bar chart showing model distribution.

---

## 7. Motion & Interaction

### Animation Principles

1. **Duration**: `150ms` for micro-interactions (hover, focus, toggle), `200ms` for layout transitions (view switches, drawer expand), `400–600ms` for data visualizations (chart animations, progress bars).
2. **Easing**: `ease-out` for everything entering the screen (things decelerate as they arrive). `ease-in` for things leaving. `cubic-bezier(0.16, 1, 0.3, 1)` for modal/drawer entrances (fast start, smooth settle — the "Linear ease").
3. **Never animate opacity alone.** Pair opacity with a `translateY(4px)` or `scale(0.98)` so the element feels like it's arriving, not just fading in.

### Specific Animations

| Element | Trigger | Animation |
|---|---|---|
| **View transition** | Nav click | Fade out current (`100ms`) → fade in + `translateY(4px)` new (`200ms ease-out`). Use CSS `.fade-enter` class or React state with `opacity` + `transform`. |
| **Card hover** | Mouse enter | `border-color` transition `150ms ease`. In dark mode, add `box-shadow` `0 8px 24px -8px rgba(0,0,0,0.3)`. |
| **Button hover** | Mouse enter | `background` transition `150ms ease`. Primary buttons add `translateY(-1px)` + shadow. |
| **Button press** | Mouse down | `translateY(0)` + reduced shadow. `100ms`. |
| **Nav item active** | Nav click | Background fade `150ms ease`. Left accent bar slides in from `width: 0` to `3px` over `200ms ease-out`. |
| **Drawer expand** | Expand button click | `max-height: 0 → auto` using grid-rows trick (`grid-template-rows: 0fr → 1fr`) with `200ms ease`. Chevron rotates `180deg` over `150ms`. |
| **Modal open** | Trigger | Overlay `fadeIn 150ms`. Card `slideUp 200ms cubic-bezier(0.16,1,0.3,1)` — `opacity: 0, translateY(12px)` → `opacity: 1, translateY(0)`. |
| **Modal close** | Close/overlay click | Reverse: card `fadeOut + slideDown 150ms`. Overlay `fadeOut 150ms`. Both run simultaneously. |
| **Toast enter** | Toast triggered | `slideInRight 200ms ease-out` — `opacity: 0, translateX(20px)` → `opacity: 1, translateX(0)`. |
| **Toast exit** | Auto-dismiss / close | `slideOutRight 150ms ease-in` — reverse of enter. |
| **Chart load** | Data arrives | Recharts built-in: `600ms ease-out`. Area charts fill bottom-up. Bar charts grow from baseline. Donut charts sweep clockwise. |
| **Progress bar** | Value update | `width` transition `400ms ease-out`. |
| **Toggle switch** | Toggle | Knob `transform` `200ms ease`. Track `background` `200ms ease`. |
| **Skeleton shimmer** | Loading state | Continuous `1.5s ease-in-out infinite`. See [Loading States](#59-loading-states). |
| **Status dot pulse** | Active status | `pulseSoft 2s ease-in-out infinite` — `opacity: 1 → 0.5`. Only on success/active dots, not on inactive. |
| **Select dropdown** | Open | `opacity: 0, translateY(-4px), scale(0.97)` → `opacity: 1, translateY(0), scale(1)` over `120ms ease-out`. |
| **Input focus ring** | Focus | `box-shadow` ring fades in `150ms ease`. |

### What should NOT animate

- Text color changes on hover (instant is fine)
- Table row borders (static)
- Scrollbar appearance (native behavior)
- Window resize (native behavior)
- Data updates to existing charts (only animate on initial load, not on refresh — use Recharts `isAnimationActive` conditionally)

### View Transitions (React-level)

When switching between pages via the sidebar, the main content area should:

1. **Fade out** the current view (`opacity: 0`, `100ms`)
2. **Swap** the React component
3. **Fade in + slide up** the new view (`opacity: 0 → 1`, `translateY(8px) → 0`, `200ms ease-out`)

Implementation: A `<ViewTransition>` wrapper component that uses a `key` prop matching the current view name. On key change, apply exit animation, then enter animation. The `.fade-enter` class in `globals.css` already provides the enter animation.

---

## 8. Implementation Reference

### Tailwind Class Patterns

Here are the most common component class strings for quick copy-paste:

```js
// Card
'glass-panel p-5 transition-all duration-200 hover:border-[var(--border-hover)]'

// Stat card
'glass-panel p-5 flex items-start gap-3 transition-all duration-200'

// Stat icon container
'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent/10 text-accent'

// Stat label
'text-[11px] font-medium uppercase tracking-wide text-content-secondary'

// Stat value
'font-mono font-bold text-2xl tracking-tight text-content-primary mt-1'

// Section title (with accent bar — uses CSS ::before)
'section-title'

// Page title
'text-xl font-bold text-content-primary'

// Page subtitle
'text-[13px] text-content-secondary'

// Primary button
'inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-accent text-white font-semibold text-[13px] transition-all duration-150 hover:shadow-lg hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:pointer-events-none'

// Secondary button
'inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-surface text-content-primary border border-border font-semibold text-[13px] transition-all duration-150 hover:bg-surface-hover hover:border-border-hover'

// Ghost button
'inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-content-secondary font-semibold text-[13px] transition-all duration-150 hover:bg-surface-hover hover:text-content-primary'

// Danger ghost button
'inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-danger font-semibold text-[13px] transition-all duration-150 hover:bg-danger/10'

// Text input
'w-full h-9 px-3 bg-surface border border-border rounded-lg text-[13px] text-content-primary placeholder:text-content-tertiary transition-all duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25'

// Table header cell
'text-[11px] font-semibold uppercase tracking-wide text-content-tertiary px-3'

// Table body cell
'text-[13px] text-content-primary px-3 border-b border-border'

// Table numeric cell (right-aligned mono)
'text-[13px] font-mono text-right tabular-nums text-content-primary px-3 border-b border-border'

// Badge - success
'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border bg-success/10 text-success border-success/25'

// Badge - inactive
'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border bg-surface text-content-tertiary border-border'

// Empty state
'flex flex-col items-center justify-center py-12 text-center'

// Empty state icon
'w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-accent/60'
// (with inline style: background: 'radial-gradient(circle, hsl(var(--accent-h) 85% 55% / 0.1), transparent)')

// Skeleton
'rounded animate-pulse bg-surface'

// Modal overlay
'fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm'

// Modal card
'w-full max-w-md max-h-[80vh] glass-panel rounded-2xl border-border-hover shadow-lg flex flex-col'
// (rounded-2xl = 16px for modal emphasis)

// Toast container
'fixed bottom-10 right-6 z-[300] flex flex-col gap-2'
```

### Recharts Theme Config

Create a shared theme object for all charts:

```ts
export const chartTheme = {
  colors: {
    grid: 'var(--border)',
    axis: 'var(--text-2)',
    accent: 'hsl(var(--accent-h, 174) var(--accent-s, 85%) var(--accent-l, 55%))',
    palette: [
      'hsl(var(--accent-h, 174) 85% 55%)',
      'hsl(calc(var(--accent-h, 174) + 30) 75% 60%)',
      'hsl(calc(var(--accent-h, 174) - 30) 70% 50%)',
      'hsl(calc(var(--accent-h, 174) + 60) 65% 65%)',
      'hsl(calc(var(--accent-h, 174) - 60) 60% 45%)',
    ],
  },
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 11,
  animationDuration: 600,
}

// Tooltip content style
export const tooltipStyle = {
  backgroundColor: 'var(--bg-3)',
  border: '1px solid var(--border-hover)',
  borderRadius: '8px',
  fontSize: '11px',
  fontFamily: 'Inter, sans-serif',
  padding: '8px 12px',
  boxShadow: 'var(--shadow-md)',
}
```

### Dark/Light Theme Switching

The existing system uses `data-theme="light"` / `data-theme="dark"` on `<html>`. The CSS variables in `globals.css` handle the rest. In React:

```tsx
// Theme context
type Theme = 'dark' | 'light' | 'system'

function applyTheme(theme: Theme) {
  const resolved = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
  localStorage.setItem('theme', theme)
}
```

### Accent Hue Rotation

```tsx
function applyAccentHue(hue: number) {
  const clamped = Math.max(0, Math.min(360, hue))
  document.documentElement.style.setProperty('--accent-h', String(clamped))
  localStorage.setItem('accent-hue', String(clamped))
}

// Preset accents for the preferences panel
const accentPresets = [
  { name: 'Teal',    hue: 174, hex: '#14b8a6' },
  { name: 'Blue',    hue: 217, hex: '#3b82f6' },
  { name: 'Purple',  hue: 265, hex: '#8b5cf6' },
  { name: 'Pink',    hue: 330, hex: '#ec4899' },
  { name: 'Orange',  hue: 25,  hex: '#f97316' },
  { name: 'Green',   hue: 142, hex: '#22c55e' },
]
```

### Accessibility Notes

- **Focus rings**: All interactive elements must show a visible focus ring on keyboard navigation. Use `focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0`. Do not remove focus outlines globally.
- **Color contrast**: Text-0 on bg-0 achieves WCAG AAA (7:1+). Text-1 on bg-1 achieves AA (4.5:1+). Text-2 is for non-essential metadata only — never use it for actionable text.
- **Status indicators**: Never rely on color alone. Status dots are paired with text labels. Error states include icon + text. Charts include labels and tooltips, not just color-coded legends.
- **Keyboard navigation**: Tab order follows visual order. `Enter` activates buttons/links. `Escape` closes modals. Arrow keys navigate tables and lists. `Ctrl+1` through `Ctrl+7` switch pages (matching the nav shortcut badges).
- **Reduced motion**: Respect `prefers-reduced-motion: reduce` — disable all animations except opacity transitions. Charts should render instantly without animation.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Appendix: Design Token Quick Reference

All values already defined in `globals.css` and `tailwind.config.js`. This is a quick-lookup summary:

| Category | Token | Value (Dark) | Tailwind Class |
|---|---|---|---|
| **Background** | bg-0 | `#05080c` | `bg-bg-0` |
| | bg-1 | `rgba(14,21,30,0.7)` | `bg-bg-1` |
| | bg-2 | `rgba(23,29,40,0.8)` | `bg-bg-2` |
| | bg-3 | `rgba(30,37,51,0.9)` | `bg-bg-3` |
| **Surface** | surface | `rgba(255,255,255,0.02)` | `bg-surface` |
| | surface-hover | `rgba(255,255,255,0.05)` | `bg-surface-hover` |
| | surface-active | `rgba(255,255,255,0.08)` | `bg-surface-active` |
| **Border** | border | `rgba(255,255,255,0.06)` | `border-border` |
| | border-hover | `rgba(255,255,255,0.12)` | `border-border-hover` |
| **Text** | primary | `#f1f5f9` | `text-content-primary` |
| | secondary | `#94a3b8` | `text-content-secondary` |
| | tertiary | `#64748b` | `text-content-tertiary` |
| | muted | `#475569` | `text-content-muted` |
| **Accent** | default | `hsl(174 85% 55%)` | `bg-accent` / `text-accent` |
| | soft | `hsl(174 85% 55% / 0.1)` | `bg-accent/10` |
| | glow | `hsl(174 85% 55% / 0.25)` | `ring-accent/25` |
| **Status** | success | `#34d399` | `text-success` / `bg-success/10` |
| | warning | `#fbbf24` | `text-warning` / `bg-warning/10` |
| | danger | `#f87171` | `text-danger` / `bg-danger/10` |
| | info | `#60a5fa` | `text-info` / `bg-info/10` |
| **Radius** | lg | `12px` | `rounded-lg` |
| | md | `8px` | `rounded-md` |
| | sm | `6px` | `rounded-sm` |
| **Shadow** | sm | multi-layer | `shadow` |
| | md | multi-layer | `shadow-md` |
| | lg | multi-layer | `shadow-lg` |
| **Animation** | fade-in | `0.2s ease` | `animate-fade-in` |
| | slide-up | `0.3s cubic-bezier(0.16,1,0.3,1)` | `animate-slide-up` |
| | pulse-soft | `2s ease-in-out infinite` | `animate-pulse-soft` |

---

*This document is a living spec. When implementation reveals edge cases or new patterns, update this file and note the change. The goal is a single source of truth that a developer can implement from without ambiguity.*
