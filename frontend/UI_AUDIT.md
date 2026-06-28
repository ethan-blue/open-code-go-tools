# UI Audit Report — Target Design vs React Implementation

**Generated:** 2026-06-22  
**Target HTML:** `111111/index (1).html` (2101 lines)  
**React Source:** `src/` (17 TSX files, 3 CSS files)

---

## 1. CSS Classes: Target HTML → Not Defined in `v4-design.css`

> All CSS classes used in the target HTML ARE defined in `v4-design.css`. The CSS file is essentially a 1:1 copy of the target's inline `<style>` blocks (with minor structural adaptation for Wails). **No missing CSS class definitions found.**

### 1.1 Classes defined in `globals.css` but NOT in the target HTML
These React-only CSS classes exist in `globals.css` (not in the target):
| Class | Purpose | File |
|---|---|---|
| `.fade-enter` | Page transition animation | `globals.css:27` |
| `.modal-content`, `.modal-header`, `.modal-title`, etc. | Custom modal variant (not in target) | `globals.css:42-77` |
| `.prefs-sections`, `.prefs-theme-btn`, `.prefs-accent-dot` | Preferences dialog styles | `globals.css:80-102` |
| `.loading-overlay`, `.loading-spinner`, `.loading-title` | Loading state overlay | `globals.css:104-130` |
| `.winbtn` | Windows-style window controls | `globals.css:137-144` |
| `.sett-card`, `.sett-card__header`, `.sett-field-row` | Alternative settings card layout | `globals.css:171-225` |
| `.integration-row`, `.ir-main`, `.ir-icon` | Alternative integration layout | `globals.css:228-289` |
| `.compact-tabs`, `.compact-tab` | Alternative tab component | `globals.css:267-272` |
| `.space-y-*`, `.grid-cols-3` | Utility helpers | `globals.css:147-153` |

**Impact:** These are React-app-specific additions that don't conflict but represent divergence from the target design system.

---

## 2. Missing Components / Sections

### 2.1 Design Language Footer (`#footprint`)
**Target:** Lines 1907–1974 — Full design system showcase footer with color swatches, typography samples, scale demo, button examples, status dots, and OCGT v4.0 branding mark.

**React:** **COMPLETELY MISSING.** No component renders the `#footprint` section.

### 2.2 Command Palette (`#palette`)
**Target:** Lines 1979–2002 — Full `⌘K` command palette with grouped Navigate/Actions items, arrow-key navigation, search input.

**React:** **MISSING as a dedicated overlay.** The `ShortcutsModal` (ShortcutsModal.tsx) is a keyboard shortcuts display, NOT a command palette. It shows key bindings but has no:
- Search/filter input
- Grouped command items with icons
- Arrow-key navigation through results
- `⌘K` trigger (React uses `?` key instead)
- Action execution (restart proxy, switch profile, export, toggle theme)

### 2.3 Account Popover
**Target:** Lines 807–821 — Account popover with avatar, name, menu items (Profile, Preferences, Sign out).

**React:** **COMPLETELY MISSING.** The `#meBtn` / `.popover` pattern is not implemented. The topbar "me" button in the target opens a popover; React's topbar has no user menu at all.

### 2.4 "Add Custom Client" Card (partial)
**Target:** Line 1225–1236 — Dashed "Add custom client" card with `repeating-linear-gradient` background.

**React:** **PRESENT** in QuickConnect.tsx (line 257–272) ✅

### 2.5 Hub: End-to-End Encryption Card
**Target:** Lines 1732–1739 — Recovery key display, AES-256-GCM tag, "Rotate key" button.

**React:** **MISSING.** Hub.tsx has a "Connection" statusgrid instead of the encryption card. No recovery key display.

### 2.6 Hub: "Add device" Button
**Target:** Line 1672 — `btn btn-sm` "Add device" button in hero area.

**React:** Hub.tsx has "Refresh" button instead. **"Add device" is missing.**

### 2.7 Hub: Per-device "⋯" Action Column
**Target:** Lines 1690, 1698, 1706, 1714 — Each device row has a `⋯` button for actions.

**React:** Hub.tsx device table **MISSING** the action column entirely (line 116 — table headers omit the last empty `<th>`).

### 2.8 Copilot: Suggestion Chevron Icon
**Target:** Line 1544–1548 — Each suggestion pill has `<span class="ic">›</span>`.

**React:** Copilot.tsx line 233 uses `<span className="ic">*</span>` — **wrong character** (should be `›`).

### 2.9 Settings: Sections 06–09
**Target:** Lines 1766–1769 — Account, Billing, Team, Audit log sections in sec-nav.

**React:** SettingsPage.tsx lines 426–429 has these as "coming soon" with `.coming` class. **Partially present** (placeholder only).

### 2.10 Traffic: "Export" Button with Download Icon
**Target:** Line 1250 — Export button with SVG download icon.

**React:** TrafficMonitor.tsx **MISSING** the Export button entirely. TrafficDetail.tsx has it (line 124) but TrafficMonitor does not.

### 2.11 Traffic: "Stream" Button in Recent Requests
**Target:** Line 1350 — "Stream" button in card-h actions.

**React:** TrafficMonitor.tsx **MISSING** — no Stream button in the recent requests card header.

### 2.12 Traffic: Filter Input in Card Header
**Target:** Line 1348 — Search/filter input `model:sonnet client:cli status:!=200`.

**React:** TrafficMonitor.tsx **MISSING** — no filter input in the recent requests header.

### 2.13 Sessions: "Filter" and "Export JSONL" Buttons
**Target:** Lines 1457–1458 — Filter and Export JSONL buttons in hero area.

**React:** Sessions.tsx has period selector but **MISSING** explicit Filter and Export JSONL buttons in that location.

---

## 3. Structural Differences

### 3.1 App Shell: Single-Page vs Stacked Pages
| Aspect | Target | React |
|---|---|---|
| Navigation model | **Stacked scroll** — all pages rendered as `<article>` elements vertically; scroll-based nav with IntersectionObserver | **Single-page router** — only one page rendered at a time via `activeView` state |
| Sidebar active state | Scroll-position-synced via IntersectionObserver | Click-based state toggle |
| Breadcrumb | Updates on scroll via observer | Static, based on `activeView` |

**Impact:** The target's scroll-tour feel is completely lost. All pages are simultaneously visible in the target; React shows one at a time.

### 3.2 Titlebar Layout
| Aspect | Target | React |
|---|---|---|
| Grid | `grid-template-columns: 140px 1fr 220px` | `display:flex` with gap:0 |
| Traffic lights | Simple `.traffic span` (3 colored circles) | Platform-adaptive: macOS traffic-lights with hover/active SVG icons, Windows `.winbtn` close/min/max |
| Right section | Pills + connection info | Pills + window control buttons |

### 3.3 Topbar: Search Button
| Aspect | Target | React |
|---|---|---|
| Shortcut | `⌘K` badge | `?` badge |
| Action | Opens command palette | Opens ShortcutsModal |

### 3.4 Topbar: Missing Buttons
| Target Button | React Equivalent |
|---|---|
| Update available (with blue dot) | **MISSING** |
| Theme toggle (moon icon) | **MISSING** (theme in Preferences dialog only) |
| User avatar "me" button | **MISSING** (no account popover) |

React has: Help (?), Refresh, Notifications, Settings — different set.

### 3.5 Dashboard: Stat Card Content
| Aspect | Target | React |
|---|---|---|
| Requests delta | `↑ 12.4%` with `.delta.up` | `total received · 24h` (no percentage) |
| Tokens delta | `↑ 4.7%` | `in / out` (no percentage) |
| Cache hit delta | `↑ 3.1pp` | `last 24h` (no pp delta) |
| Errors delta | `↓ 0.04pp` with `.delta.dn` | Dynamic based on error rate |

The target shows **comparison deltas** (vs prev period). React shows **static labels**.

### 3.6 Dashboard: Proxy Status — Missing Dot
**Target:** Line 1048 — `<span class="dot online"></span>` before listen address.

**React:** Dashboard.tsx line 193 — **NO status dot** before listen address.

### 3.7 Dashboard: Quota Section
| Aspect | Target | React |
|---|---|---|
| Structure | 3 bars (Requests, Tokens, Cost) with `.hbar` separator and footer | Dynamic based on API data, no `.hbar` separator |
| Cost bar | `.quotabar.warn` class for >60% | Conditional `warn` class based on threshold ✅ |
| Footer text | "Resets in 9 days" + "Pro · $20/mo" | Static "Resets in 9 days" + "Pro · $20/mo" ✅ |

### 3.8 Traffic: Area Chart
| Aspect | Target | React |
|---|---|---|
| Colors | `#0a0a0a` (dark) / `#a1a1aa` (light gray) | `#4ECDC4` (teal) / `#FF6B6B` (red) |
| Hover marker | Single circle on dark line | Two circles (one per line) |
| Y-axis labels | None (just gridlines) | Token count labels |
| X-axis labels | None | Date labels |
| Legend | "Input tokens · 13.2M" / "Output tokens · 8.2M" | "Input" / "Output" (no totals) |
| Hover tooltip | Dashed vertical line + circle | Dashed line + circles + tooltip box |

### 3.9 Traffic: Recent Requests — Simulated Data
**React** (TrafficMonitor.tsx lines 249–270) **generates fake request data** from summary stats. The target has **real-looking hardcoded data** with specific timestamps, request IDs, and model names.

### 3.10 Traffic Detail: Complete Page Restructure
| Aspect | Target | React |
|---|---|---|
| Purpose | Single request waterfall view | Request history table (paginated list) |
| Waterfall timeline | 6-step waterfall with timing | **MISSING** entirely |
| Response body | Rendered + Raw JSON + SSE tabs | **MISSING** |
| Metadata KV list | Key-value pairs | **MISSING** |
| Cost breakdown | Input/Output/Cache/Total | **MISSING** |
| Structure | 2-column (1.6fr 1fr) layout | Single-column table layout |

**The TrafficDetail page is completely reimplemented as a history log viewer, not a single-request detail page.**

### 3.11 Sessions: Layout Differences
| Aspect | Target | React |
|---|---|---|
| Session list items | 6 hardcoded sessions with titles | Dynamic from API |
| Session detail | Shows conversation messages with role pills (user/assistant/tool) | Shows messages with role pills ✅ |
| Tool role | `.pill.tool` with amber styling | **MISSING** — only user/assistant |
| Tags in list | Client tag + model tag + cost tag | Model + client + cost ✅ |

### 3.12 Copilot: Digest Section
| Aspect | Target | React |
|---|---|---|
| Content | Rich formatted paragraphs with bold/inline code | Single paragraph with `dangerouslySetInnerHTML` |
| Stats | 6 rows (Requests, Tokens, Spend, Cache hit, Errors, Top model) | 4 rows (Total requests, Total cost, Estimated savings, Uptime) |
| Layout | `grid-template-columns: 1fr 280px` | Same grid ✅ |

### 3.13 Hub: Geography Map
| Aspect | Target | React |
|---|---|---|
| Pins | 4 pins (SF, NY, BER, SIN) with labels | 1 pin (local device) |
| Device names in labels | "jin-mbp-16 · SF", "aria · BER" | "local · here" |

### 3.14 Settings: sec-nav Items
| Target | React |
|---|---|
| 01 API & Credentials | 01 API ✅ |
| 02 Model mapping | 02 Models ✅ |
| 03 Network & limits | 03 Network ✅ |
| 04 Environment | 04 Env ✅ |
| 05 Preferences | 05 Preferences ✅ |
| 06 Account | 06 Security (coming soon) |
| 07 Billing | 07 Plugins (coming soon) |
| 08 Team | 08 Backups (coming soon) |
| 09 Audit log | 09 About (coming soon) |

### 3.15 Settings: Missing Section 04 (Environment in Target)
**Target:** Has section "04 · Environment" with Claude env JSON editor, toggles, token caps.

**React:** Has "04 · Environment" ✅ but with **significantly more fields** (env JSON, 4 toggles, max output/MCP tokens, API/MCP timeout). The React version is actually MORE complete here.

### 3.16 Settings: Theme Section
| Aspect | Target | React |
|---|---|---|
| Theme segmented | `Light / System / Dark` with `.on` on System | Same structure but **NOT connected to theme state** |
| Accent colors | Tag-style color swatches (Ink, Blue, Green, Violet, Amber, Red) | Colored tag spans (no labels, no click handler for theme) |
| Auto-update | Shows "v4.0.0-rc.2 → v4.0.0 available" with Update button | Shows "up to date" with Update button |

---

## 4. Missing CSS Rules

### 4.1 Rules in Target but NOT in `v4-design.css`
**None found.** The `v4-design.css` file is a complete copy of all target CSS rules.

### 4.2 Rules in `v4-design.css` but NOT in Target (React additions)
| Rule | Lines | Purpose |
|---|---|---|
| `html,body{overflow:hidden}` | 116 | Wails window containment |
| `#app{width:100%;height:100vh;...}` | 160-164 | Full-window Wails mode (vs target's centered card) |
| `#titlebar .winbtn` | 194-200 | Windows-style window controls |
| `#titlebar .traffic-lights` | 203-226 | macOS traffic light buttons |
| `#main #page-content{flex:1;overflow-y:auto}` | 314 | Scrollable page content area |
| `#sidebar nav{flex:1;overflow-y:auto;min-height:0}` | 274 | Scrollable sidebar nav |
| `.gap-1{gap:4px}` | 155 | Additional utility class |
| Scrollbar styles | 914-919 | Custom thin scrollbar |
| `@media (max-width:1100px)` responsive | 804-811 | Breakpoint adjustments |

### 4.3 CSS in `globals.css` Not in Target
| Rule | Purpose |
|---|---|
| `.fade-enter` / `fadeIn` keyframes | Page transition animation |
| `.modal-overlay` / `.modal-content` | Custom modal (different from target's `.modal-overlay` / `.modal`) |
| `.loading-overlay` / `.loading-spinner` | Full-screen loading state |
| `.prefs-*` classes | Preferences dialog internals |
| `.sett-card` / `.sett-card__*` | Alternative settings card system |
| `.integration-row` / `.ir-*` | Alternative integration row system |
| `.quota-bar-*` | Alternative quota bar system |
| `.toggle-track` / `.toggle-label` | Alternative toggle component |

**Key issue:** `globals.css` defines `.modal-overlay` (line 42) which **conflicts** with the `.modal-overlay` in `v4-design.css` (line 859). The `globals.css` version uses `z-index: 9998` and `display: flex` always, while `v4-design.css` uses `display: none` with `.on` class toggle and `z-index: 58`.

---

## 5. Interaction Gaps

### 5.1 Command Palette (`⌘K`)
**Target (lines 2054–2082):**
- `⌘K` / `Ctrl+K` opens/closes palette
- Search input auto-focuses
- Arrow keys navigate items
- Enter selects/activates item
- Click backdrop closes
- Escape closes
- Groups: Navigate (⌘1, ⌘2, ⌘3, ⌘,) + Actions (⌃R, ⌘P, ⌘E, ⌘T)

**React:** **COMPLETELY MISSING.** No command palette component exists.

### 5.2 Scroll-Based Navigation
**Target (lines 2019–2052):**
- IntersectionObserver watches `.page` elements
- Sidebar active state updates on scroll
- Breadcrumb text updates on scroll
- Smooth scroll on sidebar click
- `detail` page maps to `traffic` in nav

**React:** Navigation is click-based only. No scroll observation.

### 5.3 Toast Dismiss Animation
**Target (lines 2084–2086):**
- Close button triggers opacity + translateY transition
- Element removed after 200ms timeout

**React:** Toast uses React state removal (no exit animation). The `dismiss` callback immediately removes from state.

### 5.4 Segmented Toggle
**Target (lines 2092–2096):**
- All `.segmented` groups get click handlers
- Click removes `.on` from siblings, adds to clicked

**React:** Each segmented group manages its own state via React useState. **Functionally equivalent** ✅ but implementation differs.

### 5.5 Toggle Switches
**Target (line 2089):**
- All `.toggle` elements get click handlers to toggle `.on` class

**React:** Toggle component in `ui.tsx` uses React state. Settings page toggles use direct state. **Functionally equivalent** ✅.

### 5.6 Sidebar Workspace Switcher
**Target:** `.ws` element has hover effect (`border-color` transition) and chevron icon.

**React:** `.ws` is a `<button>` that navigates to settings. Hover effect present ✅ but no dropdown/workspace switcher.

---

## 6. Design Polish Gaps

### 6.1 Shadows
| Element | Target | React |
|---|---|---|
| `#app` outer shadow | `0 50px 100px -30px rgba(15,15,18,.22)` | `box-shadow:none` (full-window mode) |
| `.cmd` (palette) | `var(--sh-pop)` | N/A (not implemented) |
| `.toast` | `var(--sh-pop)` | `var(--sh-pop)` ✅ |
| `.modal` | `var(--sh-pop)` | `var(--sh-pop)` ✅ |
| `.drawer` | `var(--sh-pop)` | `var(--sh-pop)` ✅ |

### 6.2 Transitions
| Element | Target Transition | React |
|---|---|---|
| `#sidebar .ws` | `border-color .15s` | ✅ |
| `#sidebar nav a` | `background .12s, color .12s` | ✅ |
| `#topbar .search` | `border-color .15s, background .15s` | ✅ |
| `.btn` | `background .12s, border-color .12s, color .12s, transform .08s` | ✅ |
| `.card` | `border-color .15s, box-shadow .15s` | ✅ |
| `.conn-card` | `border-color .15s, transform .15s` | ✅ |
| `.ins-card` | `border-color .15s, transform .15s` | ✅ |
| `.segmented button.on` | `box-shadow:var(--sh-1)` | ✅ |
| `.drawer` | `transform .22s cubic-bezier(.2,.7,.3,1)` | ✅ |
| Toast exit | `opacity .15s, transform .2s` | ❌ No exit animation |
| Page transitions | None in target | `.fade-enter` fadeIn (React addition) |

### 6.3 Hover States
| Element | Target Hover | React |
|---|---|---|
| `.conn-card:hover` | `translateY(-1px)` lift | ✅ |
| `.ins-card:hover` | `translateY(-1px)` lift | ✅ |
| `.stat:hover` | `border-color:var(--line-strong)` | ✅ |
| `.card:hover` | `border-color:var(--line-strong)` | ✅ |
| `.cmd .item:hover` | `background:var(--ink-100)` | N/A (no palette) |
| `.popover .it:hover` | `background:var(--ink-100)` | N/A (no popover) |
| `.notif:hover` | `background:var(--ink-50)` | ✅ |
| `.session-list .item:hover` | `background:var(--ink-50)` | ✅ |
| `#topbar .iconbtn:hover` | `background:var(--ink-100); border-color:var(--line)` | ✅ |
| `#topbar .me:hover` | Not defined in target | N/A |

### 6.4 Animations
| Animation | Target | React |
|---|---|---|
| `@keyframes ring` (Hub pins) | ✅ Defined | ✅ In v4-design.css |
| `@keyframes pulse` (Copilot eyebrow) | ✅ Defined | ✅ In v4-design.css |
| `@keyframes rise` (modal/cmd entry) | ✅ Defined | ✅ In v4-design.css |
| `@keyframes sk` (skeleton shimmer) | ✅ Defined | ✅ In v4-design.css |
| `@keyframes spin` (loading spinner) | ✅ Defined | ✅ In globals.css |
| `@keyframes fadeIn` (page transition) | ❌ Not in target | ✅ React addition |

### 6.5 Dark Theme Specifics
All dark theme overrides from the target (lines 64–122) are present in `v4-design.css` (lines 56–112) ✅.

### 6.6 Typography
| Aspect | Target | React |
|---|---|---|
| Geist font | Google Fonts CDN | Local @font-face woff2 ✅ |
| Geist Mono | Google Fonts CDN | Local @font-face woff2 ✅ |
| Instrument Serif | Google Fonts CDN | Local @font-face woff2 ✅ |
| `.hero` serif font | `font-family:var(--serif)` | ✅ |
| `.num` / `.mono` tabular | `font-feature-settings:"tnum","zero","ss01"` | ✅ |

### 6.7 Responsive Breakpoints
**Target:** `@media (max-width:1100px)` shrinks sidebar, adjusts grid layouts.

**React:** Same breakpoint in `v4-design.css` ✅ but no additional responsive behavior for the single-page layout.

---

## 7. Summary of Severity

### 🔴 Critical (Major visual/functional gap)
1. **No Command Palette** — `⌘K` overlay completely missing
2. **No Design Footer** — `#footprint` section completely missing
3. **No Account Popover** — User menu completely missing
4. **TrafficDetail is a different page** — History table vs request waterfall
5. **Stacked scroll navigation vs SPA** — Fundamental navigation model difference

### 🟡 Moderate (Noticeable visual difference)
6. **No scroll-based nav sync** — Sidebar active state not tied to scroll
7. **Stat card deltas missing** — No percentage comparisons
8. **Traffic chart colors differ** — Teal/red vs black/gray
9. **Toast exit animation missing** — No fade-out on dismiss
10. **Hub geography map** — Only 1 pin vs 4
11. **Hub missing encryption card** — Connection statusgrid instead
12. **Settings theme segment not wired** — UI present but not functional
13. **Dashboard missing status dot** in proxy status grid
14. **Missing topbar buttons** (Update, Theme toggle, User avatar)
15. **CSS `.modal-overlay` conflict** between globals.css and v4-design.css

### 🟢 Minor (Small polish items)
16. Copilot suggestion `*` vs `›` character
17. Sessions missing "Filter" / "Export JSONL" buttons
18. Traffic missing filter input and Stream button
19. Hub missing "Add device" button and `⋯` action column
20. Toast has no exit animation (immediate removal)
21. Settings sec-nav labels differ slightly (Security/Plugins/Backups/About vs Account/Billing/Team/Audit)

---

## 8. Files Audited

### Target
- `111111/index (1).html` — 2101 lines, complete single-file design

### React Implementation
| File | Lines | Status |
|---|---|---|
| `src/App.tsx` | 442 | Shell + overlays |
| `src/pages/Dashboard.tsx` | 258 | ✅ Mostly complete |
| `src/pages/QuickConnect.tsx` | 276 | ✅ Mostly complete |
| `src/pages/TrafficMonitor.tsx` | 481 | ⚠️ Chart colors differ, missing features |
| `src/pages/TrafficDetail.tsx` | 177 | 🔴 Completely different page |
| `src/pages/Sessions.tsx` | 286 | ✅ Mostly complete |
| `src/pages/Copilot.tsx` | 354 | ⚠️ Digest content simplified |
| `src/pages/Hub.tsx` | 182 | ⚠️ Missing encryption card, single pin |
| `src/pages/SettingsPage.tsx` | 694 | ⚠️ Theme not wired, different sec-nav |
| `src/components/ShortcutsModal.tsx` | 74 | Not a command palette |
| `src/components/NotificationDrawer.tsx` | 127 | ✅ Complete |
| `src/components/UpgradeModal.tsx` | 59 | ✅ Complete |
| `src/components/OnboardingWizard.tsx` | 153 | ✅ Complete (React-only addition) |
| `src/components/ui.tsx` | 157 | ✅ Primitive components |
| `src/hooks/toast.tsx` | 62 | ⚠️ No exit animation |
| `src/i18n/index.tsx` | — | i18n support (React-only) |
| `src/styles/v4-design.css` | 920 | ✅ Complete copy of target CSS |
| `src/styles/globals.css` | 292 | ⚠️ Has conflicting `.modal-overlay` |
| `src/styles/fonts.css` | 39 | ✅ Offline font faces |
