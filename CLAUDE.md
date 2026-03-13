# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static web app (no backend) for tracking a crypto portfolio focused on Binance Dual Investment positions. Built with **Vite + TypeScript** (vanilla, no framework). All state persists in `localStorage`. Charts use `Chart.js`. The project and its documentation are in Spanish.

Para contexto detallado sobre vistas, flujo de uso, formato de backup y troubleshooting, ver `README.md`.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Build (typecheck + bundle) | `npm run build` |
| Typecheck only | `npm run typecheck` |
| Tests (watch) | `npm run test` |
| Tests (single run) | `npm run test:run` |
| Tests + coverage | `npm run test:coverage` |
| Lint (ESLint) | `npm run lint` |
| Lint + autofix | `npm run lint:fix` |
| Format (Prettier) | `npm run format` |
| Format check | `npm run format:check` |
| Full check (typecheck + tests + build) | `npm run check` |
| CI check (typecheck + coverage + build) | `npm run check:ci` |
| Run a single test file | `npx vitest run src/utils/market.test.ts` |
| Run tests matching a name | `npx vitest run -t "nombre del test"` |

## Architecture

### Routing & Views

Hash-based SPA routing (`#dashboard`, `#positions`, `#simulator`, `#calculadora`) implemented in `src/utils/router.ts` with View Transitions API support. Route changes are handled in `src/main.ts` which renders the active view into `<div id="app">`.

### Component Pattern

Each view is a **render function** `(container: HTMLElement) => (() => void) | void` that returns a dispose/cleanup function. State lives in module scope and syncs to localStorage. No classes, no framework — pure functions + DOM manipulation.

The four views:
- **Dashboard** (`src/components/dashboard.ts`) — portfolio summary, P&L, breakeven/goal progress
- **Positions** (`src/components/positions.ts`) — CRUD for Dual Investment positions, Binance paste-import
- **Simulator** (`src/components/simulator.ts`) — compound projection with AUTO/MANUAL modes, Chart.js graph
- **Calculadora** (`src/components/calculadora.ts`) — swing trade calculator with fee presets

Larger components split logic into companion files (e.g. `positions.table.ts`, `positions.parser.ts`, `dashboard.state.ts`, `dashboard.events.ts`, `calculadora.math.ts`, `simulator.state.ts`).

### Market Data

`src/utils/market.ts` fetches prices from Binance API with US fallback. Resolution strategy: direct pair (`ASSETUSDT`), then cross via `ASSETBTC × BTCUSDT`. Prices cached in memory with 60s TTL.

`src/utils/market-poller.ts` provides a central pub/sub poller (60s interval) that components subscribe to for price updates.

### State & Persistence

`src/utils/storage.ts` handles load/save with sanitization. Six localStorage keys are used (see README for full list). The main key `crypto-portfolio-tracker` stores `{ portfolio, positions }`.

Backup import/export supports current format (version 2 with `app` + `calculadora`) and legacy format.

### Modals

Modals use native `<dialog>` elements via `src/utils/modal-manager.ts` (`openModal`/`closeModal`/`bindModalEvents`). Confirmation dialogs in `src/utils/dialogs.ts` also create `<dialog>` elements dynamically. The manager auto-detects `<dialog>` vs `<div>` and uses `showModal()`/`close()` when available, falling back to `display` toggling (jsdom doesn't support `showModal`).

### Animation

`src/utils/animation.ts` provides `setAnimatedNumber` and `setAnimatedText` with RAF interpolation, stability keys, and `prefers-reduced-motion` support. Each component currently manages its own `WeakMap<HTMLElement, number>` for tracking active animations. `src/utils/animated-output.ts` offers higher-level wrappers (`animateCurrency`, `animatePercent`, `animateTextFade`, etc.) with shared WeakMaps — new components should prefer this module over creating local WeakMaps.

### Styling

CSS files in `src/styles/` with CSS custom properties for theming. Light/dark/system theme support via `[data-theme]` attribute. Theme variables defined in `variables.css`. Anti-FOUC inline script in `index.html` applies theme before CSS loads.

## Testing

- **Framework:** Vitest with jsdom environment
- **Pattern:** Test files colocated with source (e.g. `market.ts` → `market.test.ts`)
- **Coverage thresholds:** 80% lines/statements, 78% functions, 70% branches
- **Test utilities:** `src/test/test-utils.ts` provides in-memory localStorage mock and DOM reset helpers
- **Browser API mocks:** Tests mock `matchMedia`, `localStorage`, `fetch`, and `IntersectionObserver` as needed

## Key Domain Rules

- **Dual Investment billing:** Settlement at 08:00 UTC, Binance cutoff at 15:59 UTC. Days billed by cutoff windows, minimum 1 day. Logic in `src/utils/dual-yield.ts`.
- **Binance parser:** Strict Binance-only format. Allowed base assets: BTC, ETH, BNB, SOL, USDT, USDC. Parser in `src/components/positions.parser.ts`.
- **Price unavailability:** Components show `---` placeholders and error banners when market data is unavailable. Cache-stale values are used as fallback.
