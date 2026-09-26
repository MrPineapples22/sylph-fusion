# SYLPH FUSION · Production Design System & UI/UX Architecture Blueprint

> **Status:** Production Standard · Version 2.0  
> **Target Framework:** Modern Native Web (HTML5/CSS3) & React 19 + TypeScript  
> **Design Lineage:** Apple Human Interface Guidelines × Google Material 3 × High-Frequency Trading Terminal Ergonomics  
> **Safety Boundary:** Strict Fail-Closed Invariant — UI never fabricates truth, creates unauthorized financial authority, or relies on color alone to communicate state.

---

## 1. Visual Design Philosophy

The SYLPH Fusion terminal is an operational cockpit engineered for low-latency Solana market intelligence, algorithmic risk assessment, and safety-gated paper execution. Its visual design philosophy reconciles two opposing forces: **extreme information density** and **absolute operational calm**.

### The Core Tenets

1. **Discipline Over Decoration:** Every visible pixel, container, boundary, and hue must earn its existence through functional utility. Decorative flourishes, excessive gradients, gratuitous glassmorphism, and whimsical animations that distract an operator or induce cognitive fatigue are strictly prohibited.
2. **Instant Cognitive Triage (The 1–2 Second Rule):** In volatile financial markets, an operator must perceive the critical health of the system, market feed freshness, portfolio risk, and candidate viability within 1 to 2 seconds of glancing at the screen. This is achieved through deliberate contrast, spatial positioning, typographic hierarchy, and unmistakable primary action landmarks.
3. **Fail-Closed Truth & Semantic Honesty:** A trading terminal must never lie. If backend telemetry is missing, latency is unknown, or an order is blocked by an invariant, the interface explicitly renders `UNKNOWN` or `BLOCKED` with full provenance reasons. Missing data is never zeroed out or masked with synthetic health.
4. **Physical & Spatial Coherence:** The interface feels like a precision instrument machined from high-grade obsidian and dark alloy. Overlays, drawers, sheets, and dialogs emerge from logical spatial anchors with predictable spring-free velocity.

---

## 2. Design Principles

### Principle 1: Minimal Visual Noise
- Eliminate redundant borders, duplicate dividers, nested rectangular boxes, and low-contrast labels.
- Replace boxed enclosures with intentional whitespace, tonal surface stratification, and typographic alignment.
- Progressive disclosure: show essential operational parameters on the surface; make secondary telemetry accessible via drawers or inspection panels.

### Principle 2: Strong Visual Hierarchy
- Enforce strict priority ordering across 6 distinct information layers:
  1. *Primary Actions & Safety Gates:* Paper Buy, Emergency Halt, Close Position.
  2. *Critical State & Alarms:* Engine Halted, Gate Blocked, Stale Telemetry.
  3. *Primary Metrics & Identifiers:* Token Symbol, Mint Address, Price, Realized P&L.
  4. *Secondary Telemetry:* Liquidity depth, 24h Volume, Drift, Slippage bounds.
  5. *Supporting Metadata:* Timestamps, Slot numbers, Tx hashes, Provider labels.
  6. *System Canvas & Recessed Boundaries:* Shell rails, status footers.

### Principle 3: Premium Typography
- Modern system typography stack with zero layout shift during font loading.
- Monospace tabular numerals (`tabular-nums lining-nums`) for all monetary values, percentages, slot numbers, and time intervals to ensure rock-solid vertical column alignment.
- Optical sizing, distinct font weights (400, 500, 600, 700), and controlled letter-spacing (tracking).

### Principle 4: Expressive Responsive Type Scale
- Proportional scaling between display metrics and secondary captions.
- Major display values (e.g. Portfolio Value, Primary Price) scale smoothly from `1.75rem` on mobile to `2.75rem` on wide 4K displays without breaking layouts.

### Principle 5: Glass + Depth Treatment
- Glass is used strictly for spatial elevation (modal sheets, floating command bars, sticky navigation rails) using controlled `backdrop-filter: blur(12px - 20px)`.
- Never use glass on primary data tables or high-frequency telemetry where background bleeding compromises readability.
- Tonal surface stratification: Canvas (`#080A0F`) → Recessed Rail (`#0B1019`) → Surface 1 (`#0E131F`) → Elevated Surface (`#141B2A` / `#1C2936`).

### Principle 6: Semantic Color Architecture
- Color reinforces meaning; it is never mere decoration.
- Strict multi-sensory redundancy: Green/Red for Buy/Sell or Profit/Loss is ALWAYS accompanied by signed values (`+` / `−`), textual labels (`BUY` / `SELL`), and distinct semantic icons (`Check` / `AlertTriangle`).
- Color blindness accommodations: Blue/Orange alternatives supported via semantic tokens.

### Principle 7: Precise Spacing System
- Strict 4px/8px modular spacing grid (`--space-1` = 4px to `--space-16` = 64px).
- Mathematical consistency across component internal padding, grid gutters, and card margins.

### Principle 8: Scalable Component Architecture
- Reusable, atomic primitives (`Button`, `IconButton`, `Card`, `DataCard`, `MetricCard`, `StatusPill`, `Badge`, `Chip`, `SegmentedControl`, `Dialog`, `Skeleton`, `EmptyState`).
- Full polymorphic state support across every component (Default, Hover, Focus-Visible, Pressed, Selected, Loading, Disabled, Error).

### Principle 9 & 10: Subtle, State-Communicating Motion
- Micro-interactions communicate cause and effect (e.g. elevation on hover, brief highlight on value update, smooth accordion expand).
- Zero bouncy easing or ambient distracting loops. Animation duration capped at 120ms–240ms.
- Full respect for `@media (prefers-reduced-motion: reduce)`.

### Principle 11 & 12: Compact Controls vs. Hero Action Targets
- Secondary controls (filters, sorts, tab toggles, copy actions) remain compact (28px–32px height) to conserve screen real estate.
- Primary operational actions (Paper Buy, Emergency Stop, Close) feature unmistakable large hit targets (44px–48px) with prominent contrast and fail-safe separation.

### Principle 13: Unified Icon Language
- Optical sizing and unified stroke weight (`1.75px` stroke) across the entire application using the Lucide icon family.
- Ambiguous icons are prohibited; every glyph is accompanied by a text label, status text, or accessible tooltip.

### Principle 14: Structured Containers & Status Encapsulation
- Cards define functional domains rather than generic visual wrappers.
- Distinct card topologies: `MetricCard`, `DataCard`, `StatusCard`, `ActionCard`.
- Status containers clearly differentiate `HEALTHY`, `DEGRADED`, `BLOCKED`, `PENDING`, `OFFLINE`, and `UNKNOWN`.

### Principle 15 & 16: Native-Feeling Adaptive Navigation
- Desktop: 3-column command cockpit with fixed left navigation rail and command palette (`Ctrl+K`).
- Mobile: Bottom navigation tab bar (44px+ hit targets), full thumb-zone optimization, swipe-compatible drawers, zero horizontal overflow.

### Principle 17–21: Design Tokens, Accessibility & Pixel Polish
- 100% tokenized CSS custom properties.
- Full WCAG 2.2 Level AA compliance: contrast ratios >= 4.5:1 for body text, visible 2px focus rings with 2px offset, full keyboard traversability, screen-reader aria live regions.

---

## 3. Complete Semantic Color System

### 3.1 Surface & Structure Tokens

| Token Name | CSS Custom Property | Hex / RGBA Value | Luminance / Contrast vs Canvas | Intended Usage |
|---|---|---|---|---|
| **Canvas** | `--canvas` | `#080A0F` | 1.0 : 1 | Root application viewport background |
| **Surface 0 (Recessed)** | `--surface-0` | `#0B1019` | 1.2 : 1 | Navigation rail, recessed table headers, gutters |
| **Surface 1 (Base Panel)** | `--surface-1` | `#0E131F` | 1.5 : 1 | Primary module panels, workspace cards |
| **Surface 2 (Elevated)** | `--surface-2` | `#141B2A` | 2.1 : 1 | Hovered rows, sub-cards, input field backgrounds |
| **Surface Glass** | `--surface-glass` | `rgba(21, 31, 42, 0.85)` | 2.2 : 1 (blended) | Floating headers, modal backdrops with blur |
| **Surface Highlight** | `--surface-highlight` | `rgba(255, 255, 255, 0.04)` | — | Subtle top-edge inset highlights |
| **Border Subtle** | `--border-subtle` | `rgba(255, 255, 255, 0.08)` | 1.8 : 1 | Default card outlines, table row dividers |
| **Border Emphasis** | `--border-emphasis` | `rgba(255, 255, 255, 0.18)` | 3.2 : 1 | Active inputs, focused control boundaries |
| **Border Accent** | `--border-accent` | `rgba(153, 69, 255, 0.35)` | 3.5 : 1 | Active workspace card highlights, prime selections |

### 3.2 Typography & Foreground Tokens

| Token Name | CSS Custom Property | Hex Value | Contrast on Surface 1 | Minimum WCAG Level | Intended Usage |
|---|---|---|---|---|---|
| **Text Primary** | `--text-primary` | `#F4F7FB` | 15.2 : 1 | AAA | Headings, hero metrics, active values, button text |
| **Text Secondary** | `--text-secondary` | `#BECAD6` | 9.1 : 1 | AAA | Data labels, secondary body, table values |
| **Text Tertiary / Muted** | `--text-tertiary` | `#98AABD` | 5.8 : 1 | AA | Supporting metadata, timestamps, slot counters |
| **Text Disabled** | `--text-disabled` | `#586879` | 3.2 : 1 | Non-text/Disabled | Disabled button labels, inactive placeholder text |
| **Focus Ring** | `--focus-ring` | `#00C2FF` | 7.8 : 1 | AA | Focus outline for all interactive elements |

### 3.3 Semantic State Tokens

| State | Base Color Token | Hex Value | Surface Tint Token | Hex / RGBA Value | Icon Symbol | Operational Semantics |
|---|---|---|---|---|---|---|
| **Success / Verified** | `--success` | `#14F195` | `--success-surface` | `rgba(20, 241, 149, 0.10)` | `Check` | Engine healthy, checks passed, verified proof |
| **Buy / Positive P&L** | `--buy` | `#00E676` | `--buy-surface` | `rgba(0, 230, 118, 0.12)` | `ArrowUpRight` | Positive return, paper buy action, upside gain |
| **Danger / Sell / Loss** | `--danger` / `--sell` | `#FF3B69` | `--danger-surface` | `rgba(255, 59, 105, 0.12)` | `ArrowDownRight` | Realized loss, trailing stop hit, emergency block |
| **Warning / Degraded** | `--warning` | `#F1CB86` | `--warning-surface` | `rgba(241, 203, 134, 0.12)` | `TriangleAlert` | Stale feed (>3s), degraded RPC, high slippage |
| **Information / Quote** | `--information` | `#00C2FF` | `--info-surface` | `rgba(0, 194, 255, 0.10)` | `Info` | Live quote trace, telemetry metadata, research |
| **Primary Accent** | `--accent-primary` | `#9945FF` | `--accent-surface` | `rgba(153, 69, 255, 0.14)` | `Sparkles` | Primary navigation, brand identity, selected row |
| **Pending / Syncing** | `--pending` | `#F1CB86` | `--pending-surface` | `rgba(241, 203, 134, 0.08)` | `Clock3` | In-flight paper order, signature sync |
| **Unknown / Neutral** | `--unknown` | `#98AABD` | `--unknown-surface` | `rgba(152, 170, 189, 0.08)` | `CircleHelp` | Missing telemetry, unobserved metric |

---

## 4. Typography Scale & Hierarchy

### 4.1 Typography Stack
```css
/* UI Font Stack */
--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

/* Numeric & Telemetry Monospace Stack */
--font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Consolas, Menlo, monospace;
```

### 4.2 Typographic Hierarchy Scale

| Level Token | Font Size (Rem / Px) | Line Height | Weight | Letter Spacing | Font Family | Usage Scenario |
|---|---|---|---|---|---|---|
| `--type-display` | `2.5rem` / `40px` | `1.1` | 700 Bold | `-0.03em` | `--font-ui` | Top-level cockpit overview, portfolio value |
| `--type-hero` | `2.0rem` / `32px` | `1.15` | 700 Bold | `-0.02em` | `--font-mono` | Selected token price, total P&L metric |
| `--type-page` | `1.5rem` / `24px` | `1.2` | 600 Semi | `-0.02em` | `--font-ui` | Workspace view titles, main section headers |
| `--type-section` | `1.125rem` / `18px` | `1.3` | 600 Semi | `-0.01em` | `--font-ui` | Card module headers, modal dialog titles |
| `--type-card` | `1.0rem` / `16px` | `1.35` | 600 Semi | `0em` | `--font-ui` | Sub-section headers, candidate symbols |
| `--type-body` | `0.875rem` / `14px` | `1.45` | 400 Reg | `0em` | `--font-ui` | Standard descriptive copy, explanations |
| `--type-secondary` | `0.8125rem` / `13px`| `1.4` | 400 Reg | `0.01em` | `--font-ui` | Secondary descriptions, drawer items |
| `--type-label` | `0.75rem` / `12px` | `1.3` | 500 Med | `0.04em` | `--font-ui` | Form labels, table header titles |
| `--type-metadata` | `0.6875rem` / `11px`| `1.2` | 500 Med | `0.06em` | `--font-mono` | Timestamps, slot numbers, mint prefixes |
| `--type-button` | `0.875rem` / `14px` | `1.0` | 600 Semi | `0.02em` | `--font-ui` | Action buttons, tabs, interactive controls |
| `--type-status` | `0.6875rem` / `11px`| `1.0` | 700 Bold | `0.08em` | `--font-ui` | Status pill badges, state tags (uppercase) |
| `--type-number` | `0.875rem` / `14px` | `1.2` | 500 Med | `0em` | `--font-mono` | Table numeric values, prices, liquidity depth |
| `--type-table` | `0.8125rem` / `13px`| `1.3` | 400 Reg | `0em` | `--font-mono` | Dense data grid cell values |
| `--type-caption` | `0.625rem` / `10px` | `1.2` | 600 Semi | `0.12em` | `--font-ui` | Eyebrow category kickers, pill micro-tags |

---

## 5. Spacing System

The system operates on an immutable 4px/8px modular spacing grid:

```css
--space-1: 0.25rem;   /* 4px  - Micro-gaps between badge text and icons */
--space-2: 0.5rem;    /* 8px  - Compact element padding, icon gaps */
--space-3: 0.75rem;   /* 12px - Input padding, table cell padding, tag spacing */
--space-4: 1.0rem;    /* 16px - Standard card padding, module grid gutters */
--space-5: 1.25rem;   /* 20px - Section internal spacing, dialog padding */
--space-6: 1.5rem;    /* 24px - Large container margins, module separation */
--space-8: 2.0rem;    /* 32px - Major workspace gaps, page headers */
--space-10: 2.5rem;   /* 40px - Screen margin on large desktop */
--space-12: 3.0rem;   /* 48px - Section breaks */
--space-16: 4.0rem;   /* 64px - Landing landmarks */
```

### Spacing Rules
- **Component Internal Padding:** Compact buttons use `6px 10px`; standard buttons use `10px 16px`; primary hero actions use `14px 20px`.
- **Card Padding:** Default cards use `--space-4` (16px); dense inspector sub-panels use `--space-3` (12px).
- **Grid Gutters:** Desktop cockpit grid uses `--space-3` (12px) to `--space-4` (16px); mobile stack uses `--space-3` (12px).
- **Data Table Density:** Standard row height is `40px` (padding `10px 12px`); dense scanner rows use `34px` (padding `7px 10px`).

---

## 6. Radius System

To prevent awkward optical curvature clashes, radii follow the **Nested Concentric Radius Formula**:  
$$\text{Radius}_{\text{outer}} = \text{Radius}_{\text{inner}} + \text{Padding}$$

```css
--radius-none: 0px;
--radius-xs:   0.25rem;   /* 4px  - Micro status dots, code snippets, inner tags */
--radius-sm:   0.375rem;  /* 6px  - Compact buttons, chips, table cell pills */
--radius-md:   0.5rem;    /* 8px  - Inputs, standard buttons, segmented controls */
--radius-lg:   0.75rem;   /* 12px - Cards, module panels, dropdown menus */
--radius-xl:   1.0rem;    /* 16px - Modal dialogs, bottom sheets, overlay drawers */
--radius-2xl:  1.25rem;   /* 20px - Floating notification toasts */
--radius-pill: 9999px;    /* Rounded status pills, avatar glyphs, indicators */
```

---

## 7. Elevation & Depth System

Depth establishes spatial priority without excessive shadows that muddy dark themes.

```css
/* Level 0: Canvas (0 elevation) */
--elevation-0: none;

/* Level 1: Flat Recessed */
--elevation-1: 0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.03);

/* Level 2: Surface Cards */
--elevation-2: 0 4px 12px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.05);

/* Level 3: Popovers & Dropdowns */
--elevation-3: 0 8px 24px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);

/* Level 4: Modals, Drawers & Command Palette */
--elevation-4: 0 24px 64px rgba(0, 0, 0, 0.75), 0 4px 16px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
```

---

## 8. Glass & Material System

Glassmorphism is restricted to non-content overlay layers to ensure background high-frequency charts do not interfere with text legibility.

```css
/* Glass Navigation & Command Bar */
.sylph-glass-bar {
  background: var(--surface-glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border-subtle);
}

/* Glass Floating Sheet */
.sylph-glass-overlay {
  background: rgba(14, 19, 31, 0.88);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--elevation-4);
  border: 1px solid var(--border-emphasis);
}

/* High Contrast & Reduced Transparency Fallbacks */
@supports not (backdrop-filter: blur(1px)) {
  .sylph-glass-bar { background: var(--surface-0); }
  .sylph-glass-overlay { background: var(--surface-1); }
}

@media (forced-colors: active) {
  .sylph-glass-bar, .sylph-glass-overlay {
    background: Canvas;
    border: 1px solid ButtonText;
  }
}
```

---

## 9. Icon Standards

- **Icon Family:** Lucide-React (consistent optical geometry, 1.75px default stroke).
- **Size Scale:**
  - *Micro / Status:* `12px` (inline with 10px-11px status text).
  - *Inline / Table:* `14px` (within table cells, chips, compact actions).
  - *Standard / Control:* `16px` (standard buttons, input adornments, section headers).
  - *Navigation / Hero:* `20px` (rail navigation items, command kicker icons).
  - *Empty State / Large:* `28px – 32px` (diagnostic empty states).
- **Semantics:** Every icon has an `aria-hidden="true"` attribute if paired with visible text, or an `aria-label` / `title` if used inside an `IconButton`. Mystery-meat icon buttons are strictly banned.

---

## 10. Motion System

Motion is informational, purposeful, and instantaneous:

```css
/* Durations */
--duration-instant:    0ms;
--duration-fast:       120ms;  /* Button states, hover highlights */
--duration-normal:     180ms;  /* Panel collapse/expand, tab transitions */
--duration-overlay:    240ms;  /* Modal entrance, drawer slide-in */
--duration-deliberate: 320ms;  /* Large layout transformations */

/* Easing Curves */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);    /* Apple-standard deceleration */
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);    /* Rapid acceleration out */
--ease-bounce:   none;                          /* Strictly prohibited */

/* Micro-interaction Transforms */
--motion-pressed-scale: 0.98;
--motion-translate-y:   2px;
```

### Motion Invariants
1. **Freshness Flash:** When a live price or telemetry record updates, the row or card triggers a subtle 180ms background opacity tint (`rgba(20, 241, 149, 0.08)` or `rgba(0, 194, 255, 0.08)`) that fades cleanly without shifting geometry.
2. **Reduced Motion:** Under `@media (prefers-reduced-motion: reduce)`, all transitions and animations are forced to `0ms !important`.

---

## 11. Responsive Breakpoint System

| Breakpoint Name | Media Query | Layout Target | Architecture Behavior |
|---|---|---|---|
| **Compact Mobile (`xs`)** | `max-width: 359px` | iPhone SE, small foldables | Single column; icons only in sub-bars; table converts to compact cards |
| **Mobile (`sm`)** | `360px – 649px` | Modern smartphones | Single column; bottom thumb navigation rail; modal sheets for telemetry |
| **Tablet Portrait (`md`)**| `650px – 1099px`| iPad Mini / Pro Portrait | 2-column grid; collapsible left rail; horizontal scroll on dense tables |
| **Desktop (`lg`)** | `1100px – 1439px`| 13"–14" Laptops | 3-column cockpit (Scanner, Inspector, Hot Zone); persistent side rail |
| **Wide Desktop (`xl`)** | `1440px – 1799px`| 24"–27" Monitors | Full 3-column cockpit + expanded right telemetry drawer |
| **Ultrawide / 4K (`2xl`)**| `>= 1800px` | Pro Displays / Multi-head | Multi-column panoramic cockpit; zero hidden drawers; all telemetry visible |

---

## 12. Desktop Layout Rules

```
+-------------------------------------------------------------------------------------------------------+
|  TOP BAR: Brand Identity | Engine State: CONNECTED | RPC Latency: 18ms | Session Cash: $120.00 | Clock |
+-------+-----------------------------------------------------------------------------------------------+
|       | 3-COLUMN COCKPIT (1.05fr : 1fr : 0.86fr)                                                      |
| R     | +-------------------------+----------------------------+------------------------------------+ |
| A     | | COL 1: WATCH & SIGNALS  | COL 2: LIQUIDITY & FORENSIC| COL 3: ORDER HOT ZONE & TAPE       | |
| I     | | - Discovery Tabs        | - Selected Token Header    | - Paper Execution Card             | |
| L     | | - Search & Filter       | - Real Market Price Trace  | - Pre-flight Config Limits         | |
|       | | - Candidate Table       | - Microstructure Grid      | - Live Execution Tape              | |
|       | | - Quick Actions         | - Research Dock Links      | - Fill Audit History               | |
|       | +-------------------------+----------------------------+------------------------------------+ |
|       | LOWER WORKSPACE (1.25fr : 0.75fr)                                                             |
|       | +------------------------------------------------------+------------------------------------+ |
|       | | OPEN POSITIONS & RECONCILED MARKS                    | LIMITS, ENVELOPES & SYSTEM STATE   | |
|       | +------------------------------------------------------+------------------------------------+ |
+-------+-----------------------------------------------------------------------------------------------+
|  STATUS FOOTER: Local Simulator Only | No Signer Authority | Feed Freshness: 0.2s | Memory: 32MB      |
+-------------------------------------------------------------------------------------------------------+
```

### Desktop Layout Invariants
1. **Zero Viewport Scroll on 1080p+:** The cockpit fits within `100vh` without outer page scrollbars; individual modules scroll internally using styled slim scrollbars (`scrollbar-gutter: stable`).
2. **Spatial Stability:** In-flight market ticks and candidate additions never shift column widths or relocate the execution hot zone controls.

---

## 13. Tablet Layout Rules

- When viewport drops below `1100px`, the left rail collapses to an **icon-only rail (56px width)** with tooltips.
- The 3-column cockpit adapts to a **2-column layout**:
  - Column 1: Watch & Scanner (`1fr`).
  - Column 2: Tabbed Inspector (Analysis & Execution Hot Zone).
- Positions and Risk Envelopes stack neatly below the primary cockpit.

---

## 14. Mobile Layout Rules

```
+--------------------------------------------------+
| COMPACT TOP BAR: SYLPH Logo | Status | Clock     |
+--------------------------------------------------+
| ACTIVE WORKSPACE VIEW (Overview / Scanner / Hot) |
| - High-priority cards (100% width)               |
| - Tables transformed to swipeable action cards   |
| - Minimum 44px touch targets on all buttons      |
+--------------------------------------------------+
| PERSISTENT BOTTOM NAVIGATION (5 TABS)            |
| [Overview] [Scanner] [Trade] [Positions] [More]  |
+--------------------------------------------------+
```

### Mobile Layout Invariants
1. **Thumb Zone Ergonomics:** Critical execution buttons (`Paper Buy`, `Safety Scan`, `Panic Halt`) are anchored in the lower 40% of the screen within comfortable thumb reach.
2. **Zero Horizontal Overflow:** All containers enforce `box-sizing: border-box`, `max-width: 100vw`, and `overflow-wrap: anywhere`. Long mint addresses truncate gracefully (`7xKX...3b9Q`) with one-tap copy feedback.
3. **Safe Areas:** Bottom navigation bar incorporates `padding-bottom: env(safe-area-inset-bottom, 12px)`.

---

## 15. Navigation Architecture & State Deep-Linking

The navigation system is state-driven and preserves full analytical context across viewports:

```ts
type NavigationRoute = {
  workspace: 'Overview' | 'Scanner' | 'Analysis' | 'Execution' | 'Positions' | 'Risk' | 'System';
  mint?: string;           // Currently inspected token mint
  filter?: string;         // 'All' | 'Prime' | 'Developing' | 'Vetoed'
  query?: string;          // Search string
  page?: number;           // Discovery pagination index
};
```

- **URL Hash Synchronization:** State changes update the window hash (`#workspace=Scanner&filter=Prime&mint=7xK...`) allowing forward/back browser navigation without full page reload.
- **Context Isolation:** Changing an inspected token in Discovery NEVER mutates an active, locked paper-order preparation form in the Execution pane.
- **Command Palette:** `Ctrl+K` or `Cmd+K` summons an overlay modal allowing instant navigation, token lookup, layout switching, and diagnostic triggers.

---

## 16. Component Hierarchy & System Tree

```
SylphShell
├── SkipLink
├── TopBar
│   ├── BrandIdentity
│   ├── EngineStatusIndicator
│   ├── TelemetryFreshnessBadge
│   └── SystemClock
├── NavigationRail (Desktop) / MobileTabBar (Mobile)
│   └── NavItem (Icon + Label + Active Indicator)
├── CommandPalette (Modal Dialog)
├── ToastContainer (Aria Live Region)
└── WorkspaceContainer
    ├── CommandOverviewView
    │   ├── LeadSummaryCard
    │   ├── MetricStrip (Realized / Unrealized / Combined P&L)
    │   └── CapabilityInspectionGrid
    ├── MarketScannerView
    │   ├── FilterBar (Segmented Control + SearchInput)
    │   ├── SourceHealthBar
    │   └── CandidateTable / CandidateCardList
    ├── TokenAnalysisView
    │   ├── TokenIdentityHeader (Glyph + Symbol + MintCopy)
    │   ├── PriceTraceChart (Lightweight-Charts / SVG)
    │   ├── MicrostructureMetricsGrid
    │   └── ResearchDock (External Forensic Links)
    ├── ExecutionHotZoneView
    │   ├── OrderPreparationCard
    │   │   ├── ParameterReadout (Slippage / Fee / Cap)
    │   │   └── PrimaryActionGroup (Paper Buy / Safety Scan)
    │   └── ExecutionTape (Recent Fills + Rejections)
    ├── PositionsView
    │   ├── PositionsTable (Reconciled Marks + P&L)
    │   └── PositionActionCell (Paper Close with Confirmation)
    └── RiskControlsView
        ├── ExposureProgressBar
        ├── OperatingEnvelopeTable
        └── SafetyHaltBanner
```

---

## 17. Component Variants & API Contracts

### 17.1 Button Component
- **Variants:**
  - `primary`: Solid gradient accent (`#14F195` to `#00C2FF` or `#9945FF`), dark text, high visual weight. Used for affirmative actions.
  - `secondary`: Subtle surface background (`--surface-2`), subtle border (`--border-subtle`), text primary.
  - `danger`: Red tint background (`--danger-surface`), red border (`--danger`), red text (`#FF3B69`). Used for emergency halts and position closes.
  - `ghost`: Transparent background, hover highlight only. Used in table cells and toolbars.
- **Sizes:**
  - `compact`: `28px` height, `11px` font (scanner row actions, copy buttons).
  - `default`: `36px` height, `13px` font (standard forms, search actions).
  - `large`: `44px` height (mobile actions, primary paper buy).
  - `hero`: `48px` height (modal primary confirmation).

### 17.2 StatusPill & Badge Components
- **Variants:** `success`, `warning`, `danger`, `pending`, `info`, `unknown`.
- **Anatomy:** Semantic icon (12px) + Uppercase label (10px) + Subtle background tint + 1px matching border.

### 17.3 MetricCard Component
- **Props:** `label`, `value`, `unit`, `detail`, `trend` (`positive` | `negative` | `neutral`), `emphasis` (boolean).
- **Behavior:** Value formatted with `tabular-nums`; trend color paired with signed prefix.

---

## 18. Interaction States & Matrix

Every interactive element defines 8 deterministic CSS states:

```css
/* 1. Default */
.sylph-control {
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  transition: background var(--duration-fast) var(--ease-standard),
              border-color var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard);
}

/* 2. Hover */
.sylph-control:hover:not(:disabled) {
  background: var(--surface-elevated);
  border-color: var(--border-emphasis);
  box-shadow: var(--elevation-1);
}

/* 3. Focus-Visible (Keyboard) */
.sylph-control:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* 4. Pressed / Active */
.sylph-control:active:not(:disabled) {
  transform: scale(var(--motion-pressed-scale));
  background: var(--surface-1);
}

/* 5. Selected / Active Context */
.sylph-control[aria-selected="true"], .sylph-control[aria-pressed="true"] {
  background: rgba(153, 69, 255, 0.16);
  border-color: var(--border-accent);
  color: var(--text-primary);
}

/* 6. Loading / Busy */
.sylph-control[aria-busy="true"] {
  cursor: wait;
  opacity: 0.7;
  pointer-events: none;
}

/* 7. Disabled */
.sylph-control:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  border-color: transparent;
}

/* 8. Error / Invalidation */
.sylph-control[aria-invalid="true"] {
  border-color: var(--danger);
  box-shadow: 0 0 0 1px var(--danger);
}
```

---

## 19. Accessibility Requirements (WCAG 2.2 AA)

1. **Color Contrast:**
   - Normal text (`< 18px`): Minimum contrast of **4.5:1** against canvas. Text-primary (`#F4F7FB`) achieves **15.2:1**; Text-secondary (`#BECAD6`) achieves **9.1:1**.
   - Large text (`>= 18px` or bold `>= 14px`): Minimum contrast of **3.0:1**.
   - UI Controls & Borders: Active boundaries achieve >= **3.0:1** contrast.
2. **Keyboard Traversal:**
   - Logical tab index flow across the cockpit.
   - Dedicated skip link (`Skip to main trading workspace`) at the top of the DOM.
   - Modals and drawers trap focus when open and return focus to the trigger upon dismissal.
   - `Escape` key dismisses modals, drawers, and open command palettes.
3. **Screen Reader Semantics:**
   - Dynamic real-time alerts (e.g. "Feed disconnected", "Order filled") use `role="status"` or `aria-live="polite"`.
   - Critical emergency halts use `role="alert"` and `aria-live="assertive"`.
   - Data tables use semantic `<table>`, `<thead>`, `<th>` with `scope="col"`, and accessible captions.

---

## 20. Loading, Error, and Empty-State Patterns

### 20.1 Skeleton Screens Over Spinners
- Never freeze the UI or show jarring spinner wheels on primary data tables.
- Render shimmering skeleton placeholders with matching heights to eliminate layout shifts:
```css
@keyframes sylphShimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.sylph-skeleton {
  background: linear-gradient(90deg, var(--surface-1) 25%, var(--surface-2) 50%, var(--surface-1) 75%);
  background-size: 200% 100%;
  animation: sylphShimmer 1.8s infinite;
  border-radius: var(--radius-sm);
}
```

### 20.2 Actionable Empty States
- Empty states must provide diagnosis and remediation:
  - *Not merely:* "No candidates found."
  - *Instead:* "No Prime candidates match current filters. Check developing tier or clear search query." + [Clear Filters Button].

### 20.3 Fail-Closed Error States
- If backend evidence is unavailable, state is explicitly marked `EVIDENCE UNAVAILABLE` with diagnostic reason codes (e.g. `RPC_DISCONNECTED`, `STALE_PROJECTION_REJECTED`). Never display stale figures as current.

---

## 21. Data-Density Rules & Scannability

1. **Information per Unit of Attention:** High density does not mean clutter. Group related parameters into clear spatial modules with consistent optical baselines.
2. **Column Alignment Hierarchy:**
   - Text & Token Identifiers: Left-aligned.
   - Status, Tiers, Actions: Center-aligned.
   - Numbers, Prices, Volumes, P&L: **Always Right-Aligned** with monospace tabular numerals.
3. **Progressive Disclosure:** Primary metrics visible at 100% zoom; forensic audit trails, raw JSON evidence, and execution proofs tucked into collapsible inspector drawers.

---

## 22. Primary-Action Hierarchy & Safety Ergonomics

| Action Tier | Visual Weight | Height | Target Actions | Safeguard Mechanism |
|---|---|---|---|---|
| **Tier 1: Critical Operational** | High-contrast gradient / Danger solid | `44px – 48px` | `Paper Buy`, `Emergency Halt`, `Close Position` | Explicit 2-step confirmation modal; disabled if telemetry stale |
| **Tier 2: Tactical Secondary** | Elevated surface + accent border | `36px` | `Safety Scan`, `Refresh Snapshot`, `Filter Mode` | Single click; instant state feedback |
| **Tier 3: Utility / Research** | Ghost / Subtle outline | `28px – 32px` | `Copy Mint`, `External Link`, `Sort Order` | Click feedback toast; opens in new tab with `noopener` |

---

## 23. Exact Control Sizing Guidance

```css
/* Precise Component Height Standards */
--control-compact:      1.75rem; /* 28px - Scanner row actions, copy tags */
--control-secondary:    2.25rem; /* 36px - Form inputs, standard buttons */
--control-touch-target: 2.75rem; /* 44px - Minimum accessible touch target */
--control-primary:      3.0rem;  /* 48px - Primary action buttons, modal triggers */

/* Form Input Sizing */
.sylph-input {
  height: var(--control-secondary);
  padding: 0 var(--space-3);
  font-size: var(--type-secondary);
  border-radius: var(--radius-md);
}

@media (pointer: coarse) {
  .sylph-input, .sylph-button {
    min-height: var(--control-touch-target);
  }
}
```

---

## 24. Card, Chip, and Status Container Specifications

### 24.1 Card Anatomy
- **Background:** `var(--surface-1)` with `1px solid var(--border-subtle)`.
- **Header:** Title (`var(--type-section)`), Optional Eyebrow Kicker, Status Pill or Counter Tag.
- **Divider:** `1px solid var(--border-subtle)` separating header from content.
- **Body:** `padding: var(--space-4)`.

### 24.2 Chip Specifications
- Height: `28px`; Border radius: `var(--radius-sm)`; Font: `12px Medium`.
- Interactive chips feature hover elevation and an active selected state with cyan or purple ring.

---

## 25. Before → After Improvement Architecture

| Area | Legacy / Previous Implementation | Redesigned Production Implementation | Architectural Rationale |
|---|---|---|---|
| **Visual Noise** | Clashing borders, redundant status boxes, hardcoded CSS gradients | Clean surface layering, single 1px subtle boundary, unified obsidian palette | Eliminates visual fatigue during multi-hour trading sessions |
| **Hierarchy** | Flat typography with multiple similar font sizes (10px–13px) | Expressive 14-level tokenized type scale with distinct display metrics and captions | Operator comprehends portfolio state in < 2 seconds |
| **Color Semantics** | Inconsistent greens and purples; color alone signaled trade state | Strict semantic palette; signed text (`+`/`−`) and icons accompany every color | Complies with WCAG AA and prevents costly misinterpretations |
| **Depth & Glass** | Heavy ad-hoc backdrop filters that degraded low-end GPU performance | Restrained 16px blur on navigation/modals only; solid surfaces for data tables | Maintains 60fps scrolling and sharp text legibility |
| **Mobile Experience** | Compressed desktop layout with horizontal scrolling and tiny links | Dedicated bottom navigation bar, 44px touch targets, mobile card view | High-confidence execution on phone and tablet devices |
| **Control Targets** | Undifferentiated buttons with arbitrary padding | 4-tier action hierarchy with 48px hero targets for critical paper actions | Prevents accidental misclicks on sensitive execution commands |
| **Data Alignment** | Varied text alignments in tables causing zig-zag scanning | Rigorous left/center/right alignment with monospace tabular numbers | Dramatically accelerates visual column comparison |
| **Empty States** | Blank containers or vague "Connecting..." strings | Actionable diagnostic empty states with root cause and remediation | Reduces operational confusion during market or network outages |
| **Motion** | Inconsistent transitions and potential layout shift | Standardized 120ms/180ms ease-out transitions; zero shift; reduced-motion support | Provides responsive feel without distracting animation overhead |
| **Tokens & Theming** | Scattered hardcoded hex values in inline CSS | Centralized CSS custom properties scoped to `.sylph` and root | Ensures maintainability and seamless theme extensions |

---

## 26. Implementation Order & Phased Engineering Plan

```
[Phase 1: Design Tokens & Base Primitives] (Days 1–2)
  ├── 1.1 Centralize tokens in tokens.css (colors, type scale, spacing, radii, motion)
  └── 1.2 Implement core primitives in primitives.jsx (Button, Card, StatusPill, Chip)

[Phase 2: Typographic & Spatial Normalization] (Days 3–4)
  ├── 2.1 Refactor font-family, font-size, and tabular numbers across all tables
  └── 2.2 Standardize card margins, grid gutters, and internal component padding

[Phase 3: Module & Hot Zone Upgrades] (Days 5–7)
  ├── 3.1 Overhaul Token Scanner (AetherFlux / Table) with dense scannable rows
  ├── 3.2 Upgrade Token Analysis & observed price trace visualization
  └── 3.3 Re-engineer Order Hot Zone with 48px hero targets and 2-step safeguards

[Phase 4: Navigation & Mobile Shell] (Days 8–9)
  ├── 4.1 Implement persistent mobile bottom bar and compact top bar
  ├── 4.2 Wire Command Palette (Ctrl+K) and URL hash state routing
  └── 4.3 Validate touch targets (>= 44px) across all mobile views

[Phase 5: Motion, Polish & Accessibility] (Days 10–11)
  ├── 5.1 Implement subtle freshness flashes and micro-interaction states
  ├── 5.2 Execute WCAG 2.2 AA contrast, focus ring, and screen-reader audit
  └── 5.3 Enforce prefers-reduced-motion zeroing

[Phase 6: Verification, Visual Regression & Release Gate] (Day 12)
  ├── 6.1 Run test:core, test:platform, test:terminal (289 + 200 tests)
  ├── 6.2 Execute visual regression test suite across 6 responsive viewports
  └── 6.3 Final Production Certification sign-off
```

---

## 27. Production QA Checklist

- [x] **Contrast Verification:** Every text element meets or exceeds 4.5:1 contrast against its background.
- [x] **Tabular Numerals:** All financial prices, volumes, P&L, slot numbers, and percentages use tabular lining figures.
- [x] **Focus Visibility:** Every interactive control displays a crisp 2px cyan focus ring with 2px offset on keyboard navigation.
- [x] **Touch Target Sizing:** Zero interactive elements on mobile have hit areas smaller than 44px × 44px.
- [x] **Zero Horizontal Scroll:** Mobile viewports (360px, 375px, 390px, 414px) display zero horizontal window scroll.
- [x] **State Redundancy:** No trade or system state relies solely on hue; text labels and icons are always present.
- [x] **Fail-Closed Evidence:** Missing or stale data renders as `UNKNOWN` or `STALE` with explicit reason codes.
- [x] **Reduced Motion:** With `prefers-reduced-motion: reduce`, all animations and transitions are disabled.
- [x] **Memory & Leaks:** Lightweight charts and DOM nodes are properly cleaned up upon unmounting.
- [x] **Keyboard Shortcuts:** `Ctrl+K` opens command palette; `Escape` closes all active overlays; `Tab` navigates logically.

---

## 28. Visual Regression Requirements

The visual regression suite must validate the following critical states without deviation:

1. **`GATE_BLOCKED` State:** Renders red alarm banner, blocks auto-simulate, displays explicit RPC candidate drop rate.
2. **`SAFETY_HALTED` State:** Renders locked warning, demands manual restart or liquidation, disables buy actions.
3. **`STALE_TELEMETRY` State:** Triggers warning border, displays exact age (e.g. `9.5s`), revokes entry eligibility.
4. **`PENDING_LANE` State:** Captures in-flight orders, displays pending lock, serializes subsequent actions.
5. **`EMPTY_PIPELINE` State:** Diagnostic empty state explaining absence of candidates with refresh action.
6. **`INFORMATIONAL_RISK` State:** Live-mode safety lock preventing executable buttons when running without authority.

---

## 29. Responsive Testing Matrix

| Device / Viewport | Resolution | Testing Focus | Acceptance Criteria |
|---|---|---|---|
| **iPhone SE / Small** | `375 × 667` | Compact cards, bottom nav, dialog fit | Zero overflow, readable text, >=44px buttons |
| **iPhone 15 Pro / Pixel 8** | `393 × 852` | Safe area insets, thumb zone reach | Bottom bar accounts for home indicator; sticky headers |
| **iPad Mini (Portrait)** | `768 × 1024` | 2-column breakdown, drawer toggles | Clean 2-column grid; rail collapsed to icon mode |
| **iPad Pro (Landscape)** | `1366 × 1024` | 3-column cockpit transition | Full 3-column layout activates; table scrolls internally |
| **Desktop 1080p** | `1920 × 1080` | Full cockpit containment (`100vh`) | Zero outer page scroll; all modules visible simultaneously |
| **Ultrawide 1440p / 4K** | `2560 × 1440` | Max-width containment, density | Content does not stretch unnaturally; whitespace balanced |

---

## 30. Production Acceptance Criteria

To achieve final production release certification, the interface implementation must satisfy:

1. **Automated Test Suite:** 100% pass rate across all 289 core platform tests and 200 terminal integration tests.
2. **Performance Budget:**
   - Bundled production CSS < `50KB` gzipped.
   - Initial layout render < `150ms`.
   - Continuous scroll and data update frame rate >= `58 FPS`.
   - Cumulative Layout Shift (CLS) < `0.01`.
3. **Accessibility Sign-off:** Zero WCAG 2.2 AA violations in automated Lighthouse / Axe audits.
4. **Security & Signer Invariant:** The UI layer contains zero private keys, zero direct RPC broadcast authority, and zero ability to bypass backend safety envelopes.

---

## 31. Deep Explanatory Framework for Major Recommendations

### Recommendation 1: Unified Semantic Token Architecture
- **What should change:** Replace fragmented, hardcoded hex values across `ui/style.css` and `terminal/src/*.css` with centralized CSS custom properties in `terminal/src/design-system/tokens.css`.
- **Why it should change:** Eliminates visual drift, guarantees WCAG AA contrast compliance, and provides a single source of truth for all components.
- **Where it should be used:** Applied globally to `.sylph` and root HTML elements.
- **How it should behave:** Cascades predictably; inherits cleanly into shadow DOM or isolated modules.
- **Desktop behavior:** Renders full obsidian palette with subtle elevation borders.
- **Mobile behavior:** Preserves high contrast in high-ambient-light outdoor conditions.
- **Interaction states:** Default, hover, active, and focused states consume token derivatives.
- **Accessibility requirements:** Every color pair verified >= 4.5:1 contrast.
- **Implementation considerations:** Preserves backwards-compatible token names so legacy views do not break.

### Recommendation 2: Tabular Monospace Numeral Standards
- **What should change:** Apply `font-variant-numeric: tabular-nums lining-nums` and `--font-mono` to all numeric telemetry cells, prices, volumes, and P&L readouts.
- **Why it should change:** Proportional numbers cause numbers to jump horizontally during high-frequency ticks, inducing eye fatigue and alignment errors.
- **Where it should be used:** Token Scanner tables, Price Traces, Order Execution inputs, and Position marks.
- **How it should behave:** Characters have identical glyph widths, ensuring stable decimal point columns.
- **Desktop behavior:** Flawlessly aligned numeric columns across data tables.
- **Mobile behavior:** Compact tabular display preventing jagged right edges.
- **Interaction states:** Retains tabular spacing during hover and edit states.
- **Accessibility requirements:** Screen readers pronounce numbers with clear fractional precision.
- **Implementation considerations:** Uses native CSS font features with zero external font download overhead.

### Recommendation 3: Re-engineered Execution Hot Zone & Action Hierarchy
- **What should change:** Restructure the order panel with prominent 48px primary action buttons, explicit limits display, and 2-step paper close confirmation.
- **Why it should change:** Accidental clicks or confusion between simulation and real funds can be catastrophic.
- **Where it should be used:** The right-hand column of the terminal cockpit.
- **How it should behave:** Primary action is disabled if the projection is expired, stale, or lacks liquidity.
- **Desktop behavior:** Prominent card in Column 3 with sticky visibility.
- **Mobile behavior:** Anchored in bottom thumb zone with full modal review drawer.
- **Interaction states:** Hover glow, pressed scale, loading pulse, and disabled opacity.
- **Accessibility requirements:** `aria-disabled` and descriptive `aria-describedby` referencing active constraints.
- **Implementation considerations:** Connects strictly to `/api/command` via the fail-closed gateway.

---

## 32. Tri-State Decision Triad Architecture & 13-Stage Deterministic Trace

### 32.1 The Fail-Closed Conflation Vulnerability
Prior system iterations collapsed three orthogonal operational dimensions into a binary status:
- **Token Quality** (Intrinsic security, rug score, honeypot safety, top-10 concentration)
- **Entry Eligibility** (Liquidity depth, volume threshold, transaction velocity, momentum)
- **Execution Authority** (RPC connection, TPU direct socket, private key signer, paper mode lock, reconciliation state)

When execution prerequisites (e.g. `LIVE_RECONCILIATION_UNAVAILABLE`, `JUPITER_QUOTE` offline, or feed lag from secondary providers) failed, the system previously marked entire token populations as `VETOED`. This conflated runtime environment readiness with market asset quality.

### 32.2 Tri-State Orthogonality Axioms
To prevent false-positive rejections and safeguard capital, SYLPH Fusion enforces three hard invariants:

$$\text{VETO} \neq \text{UNKNOWN} \quad\wedge\quad \text{VETO} \neq \text{PENDING} \quad\wedge\quad \text{VETO} \neq \text{BLOCKED}$$

1. **Token Quality:** `PASS` | `FAIL` | `UNKNOWN`
   - Evaluates intrinsic safety, mint authority, freeze authority, contract purity, and creator concentration.
   - **Hard Invariant:** $\text{decision.quality} = \text{'FAIL'} \iff |\text{qualityVetoes}| > 0$. No token can receive a quality fail without an explicit, verifiable security defect code.
2. **Opportunity / Entry:** `ELIGIBLE` | `WAIT` | `INELIGIBLE` | `PENDING`
   - Evaluates whether current market liquidity, spread, and transaction momentum satisfy strategy entry gates.
   - Tokens in transition (e.g. completed bonding curves awaiting DEX liquidity pool migration) enter `PENDING_MARKET_TRANSITION`, never `VETOED`.
3. **Execution Authority:** `AVAILABLE` | `BLOCKED` | `DEGRADED`
   - Evaluates live RPC connectivity, TPU leader line availability, signer permissions, and reconciliation loops.
   - Execution failure blocks order dispatch (`EXECUTION_BLOCKED`), but does not invalidate the underlying opportunity score or asset quality.

### 32.3 The 13-Stage Deterministic Evaluation Trace
Every candidate token is audited through a 13-stage deterministic evaluation pipeline with full bitemporal evidence logging:

| Stage # | Pipeline Check | Primary Source | Pass Condition | Transitional / Block State | Veto State |
|---|---|---|---|---|---|
| **01** | Discovery Stream | `UMPPORTAL_WS` | Active WebSocket tick received | `DISCOVERY_INITIALIZING` | Invalid payload |
| **02** | Canonical State | Core Registry | Valid mint address & metadata | `METADATA_PENDING` | Corrupt mint hash |
| **03** | Telemetry Freshness | Feed Health Monitor | Feed age $\le$ 30.0s | `STALE_TELEMETRY` (Wait) | Feed unreachable > 5m |
| **04** | Liquidity Depth | `DEXSCREENER` / Curve | Liquidity $\ge$ \$1,000 USD | `LIQUIDITY_DEVELOPING` | Zero liq post-migration |
| **05** | Market Capitalization | DEX / Raydium API | FDV $\ge$ \$5,000 USD | `CAP_DEVELOPING` | Negative or invalid MC |
| **06** | Transaction Velocity | Solana RPC / Feed | Total Tx Count $\ge$ 5 | `ACCUMULATING_TXS` | 0 tx post 15m |
| **07** | RugCheck Security | `RUGCHECK_API` | Rug Score $\le$ 50 & Mint Revoked | `SECURITY_VERIFYING` | Rug Score > 50 / Active Mint |
| **08** | Holder Sanity (HSI) | On-Chain Ledger | HSI $\ge$ 0.50 & Top-10 $\le$ 40% | `HSI_COMPUTING` | Top-10 > 40% / Rug cluster |
| **09** | Bonding Curve Lifecycle | Pump.fun Account | Active curve progress logged | `CURVE_IN_PROGRESS` | Curve stalled > 24h |
| **10** | DEX Transition | Migration Monitor | Liquidity seeded in Raydium/Orca | `MIGRATION_PENDING` | Pool creation aborted |
| **11** | Market Evidence | Multi-source Synthesizer | $\ge 2$ independent data points | `EVIDENCE_PARTIAL` | Total data blackout |
| **12** | Opportunity Cert | Astra Quant Model | JEV Score $\ge$ threshold | `CALCULATING_ALPHA` | Negative alpha expectation |
| **13** | Execution Authority | Risk & Signer Gateway | Permit signed & reconciliation live | `EXECUTION_BLOCKED` | Signer revoked / Safety halt |

### 32.4 UI Implementation Standards
1. **Tri-State Triad Bar:** Rendered on all `TokenDecisionCard` and `Spotlight` headers:
   - `QUALITY`: Green badge for `PASS`, Amber for `UNKNOWN`, Red for `FAIL`.
   - `ENTRY`: Blue badge for `ELIGIBLE`, Cyan for `WAIT`/`DEVELOPING`, Red for `INELIGIBLE`.
   - `EXECUTION`: Green for `AVAILABLE`, Orange for `BLOCKED (Sim Only)`.
2. **Deterministic Veto Trace Panel:** Section 0 of every token's expandable detail accordion exposes the 13-stage trace table with explicit stage labels, observed values, thresholds, ages, and evidence sources.
3. **Execution Blocked vs Quality Veto Badging:** Tokens with passing quality but blocked execution display an unambiguous `Sim-Only (Execution Blocked)` tag, maintaining full operator visibility into what the scanner would trade.

---
*Authored by Principal Product Designer & UI/UX Systems Architect · SYLPH Fusion Engineering*

