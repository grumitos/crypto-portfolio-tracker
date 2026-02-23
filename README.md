# Crypto Portfolio Tracker

App estatica para monitorear portafolio crypto, posiciones Dual Investment, simulador de recuperacion y calculadora de swing trade.

## Objetivo
- Seguimiento de balance, P&L y progreso a meta.
- Gestion de posiciones Dual Investment.
- Proyecciones de compound interest.
- Calculo de APR/rendimiento para ciclos de trading.

## Stack y alcance
- Frontend: `Vite + TypeScript`.
- Sin backend (todo corre en navegador).
- Persistencia local en `localStorage`.
- Graficos con `Chart.js`.
- Import/export de backups JSON.

## Requisitos
- Node.js 20+
- npm 10+

## Inicio rapido
```bash
npm ci
npm run dev
```

## Scripts
| Comando | Descripcion |
|---------|-------------|
| `npm run dev` | Desarrollo con hot reload |
| `npm run build` | Build de produccion |
| `npm run preview` | Servir build local |
| `npm run test` | Tests en modo watch |
| `npm run test:run` | Tests una sola vez |
| `npm run test:coverage` | Tests + reporte de coverage |
| `npm run typecheck` | Validacion TypeScript |
| `npm run check` | Typecheck + tests + build |
| `npm run check:ci` | Typecheck + coverage + build |

## Vistas
1. `Dashboard`: resumen de portfolio, run-rate y progreso.
2. `Posiciones`: CRUD de Dual Investment.
3. `Simulador`: proyeccion de recuperacion/compound.
4. `Calculadora`: metricas de APR, fees y ciclos.

## Persistencia local
- `crypto-portfolio-tracker`: estado principal (portfolio + posiciones).
- `crypto-calculadora`: estado de la calculadora.
- `crypto-simulator-view`: estado de vista del simulador (capital, APR, frecuencia, meta, auto flags).
- `crypto-api-last-updated-at`: timestamp de la ultima actualizacion exitosa de precios.
- `crypto-theme`: preferencia de tema (light, dark, system).

## Tema y paleta
Referencia guardada (captura 2026-02-19):

| Modo | Fondo | Texto | Borde ref | Focus |
|------|-------|-------|-----------|-------|
| Light | `#FAF9F5` | `#141413` | `#1F1E1D` | `#2C84DB` |
| Dark | `#262624` | `#FAF9F5` | `#DEDCD1` | `#2C84DB` |

Implementado en:
- `src/styles/variables.css`
- `src/utils/theme.ts`
