# Design Audit Findings

## Executive Summary
- `High`: shell touch targets and responsive header behavior were below production expectations.
- `High`: theme visuals still depended on scattered literals in TypeScript.
- `High`: `simulator`, `calculadora` and `positions` mixed rendering, state and side effects in monolith files.
- `Medium`: loading skeletons and several UI fragments depended on inline styles or repeated string markup.
- `Medium`: CSS was heavily global, increasing regression risk across views.

## Implemented Remediation
- Consolidated semantic theme/browser tokens and routed theme runtime through CSS variables with safe fallbacks.
- Made the app shell mobile-first with wrap-safe navigation and 44px global touch targets for header actions.
- Extracted `simulator` into `constants`, `template` and `dom` modules while keeping behavior and IDs stable.
- Extracted `calculadora` into `constants` and `template` modules and centralized fee/copy configuration.
- Extracted `positions` constants/template helpers for header, empty states, modal shell and spot-strip card rendering.

## Residual Risks
- `positions.ts` still contains significant controller/event logic and is the next file with the highest structural debt.
- `dashboard` is already partially modularized, but shared skeleton helpers still rely on width-specific inline styles in some paths.
- Global CSS remains large; the current pass reduced risk but did not yet split styles by primitive/component layer.

## Acceptance Checks
- Preserve routes, localStorage keys and Binance integration behavior.
- Keep `bun run check` green.
- Maintain keyboard navigation, focus visibility and current AA-oriented contrast baseline.
