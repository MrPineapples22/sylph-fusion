# SYLPH Cyber-Obsidian design system

The terminal uses a dark, high-contrast surface stack. Color alone never communicates a trade state: icons, labels, signed values, and status text remain present in every state.

## Color tokens

| Token | HEX | RGB | Intended use |
| --- | --- | --- | --- |
| `canvas` | `#080A0F` | `8, 10, 15` | Root application canvas |
| `surface-0` | `#0B1019` | `11, 16, 25` | Navigation rail and recessed regions |
| `surface-1` | `#0E131F` | `14, 19, 31` | Primary card and terminal surface |
| `surface-2` | `#141B2A` | `20, 27, 42` | Hover and active sub-surface |
| `border` | `rgba(255,255,255,0.08)` | `255,255,255,8%` | Default divider and card outline |
| `border-accent` | `rgba(153,69,255,0.20)` | `153,69,255,20%` | Focused/active module outline |
| `purple` | `#9945FF` | `153, 69, 255` | Primary action and selected navigation |
| `turquoise` | `#14F195` | `20, 241, 149` | Connected/healthy state and confirmation |
| `cyan` | `#00C2FF` | `0, 194, 255` | Analytical data and quote trace |
| `buy` | `#00E676` | `0, 230, 118` | Positive P&L and buy state |
| `buy-soft` | `#00E6761A` | `0,230,118,10%` | Positive state background |
| `sell` | `#FF3B69` | `255, 59, 105` | Loss, exit, and safety block state |
| `sell-soft` | `#FF3B691A` | `255,59,105,10%` | Negative state background |
| `text` | `#F4F7FB` | `244, 247, 251` | Primary text and numeric values |
| `text-muted` | `#A6B1C4` | `166, 177, 196` | Secondary labels; retained above AA contrast on `surface-1` |
| `text-faint` | `#A6B1C4` | `166, 177, 196` | Nonessential timestamps and notes |

Opacity layers use 4% for subtle insets, 8% for regular dividers, 10% for semantic background tints, 16% for hover fills, and 20% for an accent outline. Primary text, `text-muted`, buy, sell, and cyan are selected against the actual dark surfaces to retain readable contrast; dim text is used only for nonessential context.

## Information architecture

The desktop terminal is a stable three-column grid:

1. **Watch and signals**: source health, token discovery, saved watchlist, KOL activity, search, and per-token research links.
2. **Analysis**: selected-token identity, fresh quote trace, liquidity/volume/momentum readout, source links, and the risk result.
3. **Execution and tape**: paper-order action, entry risk status, position capacity, realized/unrealized P&L, and the latest fills.

The lower workspace keeps open positions, execution activity, operational status, limits, strategies, and discovery candidates visible without displacing the execution controls. On smaller screens the grid stacks in execution order: watch, analysis, execution, positions, risk.

## Component anatomy

### Token card and scanner row

- A 2-character token glyph, symbol, name, and copyable mint form the identity block.
- Price, 24-hour change, liquidity, and volume use tabular numbers for quick comparison.
- Signed performance uses a label and a buy/sell color, with no reliance on hue alone.
- Actions are compact: chart, save, safety, paper buy, test buy. A row click updates the analysis and order panes without moving the market list.

### Analysis module

- The selected mint stays copyable beside symbol/name identity.
- The price trace uses only observations collected by the dashboard from its real market feed. It reports that it is collecting samples when no trace exists; it does not fabricate a chart.
- Liquidity, 24-hour volume, and momentum are labeled indicators, not an order-book substitute. The module labels them as quote-derived indicators.
- Research destinations open separately and use `noopener noreferrer`; no third-party wallet, login, or execution page is embedded in the local terminal.

### Order execution widget

- The selected token, current price, configured allocation, remaining slots, and current safety state sit above the action buttons.
- `Paper buy` calls the existing safety-gated simulator endpoint. `Test buy` keeps its explicit confirmation because it intentionally bypasses token checks for simulator mechanics only.
- Priority fee, Jito tip, slippage, and stop values are shown as configured engine limits. This display is informational: UI controls cannot quietly override execution safety.
- Positive and negative realized values retain a signed textual value, and all values use tabular numerals.

### Live transaction feed

- Each row provides event type, mint, side/reason, and time in a dense, scanable format.
- The newest fill appears first. Green/rose dots are paired with `BUY`/`SELL` labels and signed P&L.
- Source availability is clearly separated from trade results so a stale data source cannot look like a successful fill.

## External research destinations

The research dock opens Solsniffer, Bubblemaps, GMGN, Axiom, Photon, BullX, and Jupiter in separate tabs. It does not connect wallets or transmit a trade. The local app retains its own live market cache and paper engine as the source of recorded P&L.

Bubblemaps describes its product as real-time wallet/token visual analysis and supports iframe/API integrations; it is linked as a forensic research destination instead of being embedded without an API agreement. [Bubblemaps](https://bubblemaps.io/) · [Jupiter](https://jup.ag/) · [GMGN](https://gmgn.ai/?chain=sol)

## Usability refinement

Secondary text now shares the readable #A6B1C4 token. Data labels use an 11px minimum in the main modules; table values use 12px. Buy actions have 44px height. Active scanner rows have a turquoise edge and purple tint. Keyboard focus, a skip link, pressed tab states, section navigation state, and reduced-motion preferences are supported. Desktop widths from 1280px retain three columns; smaller viewports stack modules.

The reusable React + Tailwind shell accepts optional per-token `prices` and `events` props. It draws only supplied observations, shows explicit empty states, resolves selection against current token data, and disables actions without handlers. Integrate it in a React application with Tailwind and lucide-react installed. The existing app continues to serve its native HTML/CSS/JavaScript interface; the React file is a separate integration deliverable. Its displayed execution limits are illustrative and must be wired to engine configuration before use.

Validation: JavaScript syntax check, TypeScript engine build, and all 39 existing tests passed. The separate offline browser preview was visually checked at its current viewport. This is not a complete WCAG certification or a full responsive-browser audit. The strategy research and candidate-scoring engine remain separate implementation work.
