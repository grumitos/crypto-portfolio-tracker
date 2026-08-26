# Engineering Guide

Guía técnica del repositorio para agentes y colaboradores humanos.

## Resumen

- Stack: `Bun + TypeScript` sin framework.
- Dependencias y scripts de proyecto: `pnpm`; runtime, tests y build siguen ejecutandose con Bun.
- UI: SPA por hash con vistas `dashboard`, `positions`, `simulator` y `calculadora`.
- Persistencia: `localStorage`.
- Proyeccion: tabla mensual en `simulator`, sin dependencia de graficos.
- Idioma del producto: español.

## Comandos

| Tarea                 | Comando                 |
| --------------------- | ----------------------- |
| Desarrollo            | `pnpm run dev`          |
| Typecheck             | `pnpm run typecheck`    |
| Tests                 | `pnpm run test:run`     |
| Build                 | `pnpm run build`        |
| Verificación completa | `pnpm run check`        |
| Cobertura CI          | `pnpm run check:ci`     |
| Analisis ETH          | `pnpm run eth:analysis` |

## Arquitectura actual

### Shell y navegación

- `src/main.ts` monta el shell de la app y enruta por hash.
- El shell compartido vive en:
  - `src/components/app-shell.constants.ts`
  - `src/components/app-shell.template.ts`
- La navegación y las acciones globales deben seguir siendo estables a nivel de IDs y accesibilidad.

### Patrón de vistas

Cada vista expone un `render...(container)` que puede devolver un `dispose`.

Patrón preferido para vistas medianas o grandes:

- `*.constants.ts`: copy, presets, thresholds, ids semánticos.
- `*.template.ts`: markup puro.
- `*.dom.ts`: cacheo/selectores.
- `*.state.ts`: persistencia/sanitización.
- Helpers específicos cuando hay integración externa o submódulos costosos.

Estado actual:

- `dashboard` está dividido en `constants/template/state/dom/events`, aunque `dashboard.ts` conserva orquestacion relevante.
- `simulator` está dividido en `constants/template/dom/state`.
- `calculadora` está dividido en `constants/template` más `calculadora.math.ts`.
- `positions` ya extrae `constants/template/table/parser` y el modal de configuracion vive en `positions/api-config-modal.ts`, pero sigue siendo la vista con más lógica por desacoplar.

### Tema y design system

- Tokens fuente de verdad: `src/styles/variables.css`.
- Tema runtime: `src/utils/theme.ts`.
- `theme.ts` debe leer colores de CSS custom properties; evitar hex hardcodeados nuevos en TypeScript.
- Mantener tema `light`, `dark` y `system`.
- El shell y los componentes interactivos usan objetivo táctil mínimo de `44px`.

### Animación

- Preferir `src/utils/animated-output.ts` o `src/utils/animation.ts`.
- Respetar `prefers-reduced-motion`.
- No animar layout si puede resolverse con `transform` u `opacity`.

### Mercado, exchanges y vault local

- Mercado: `src/utils/market.ts`, `src/utils/market-poller.ts`.
- Integración Binance: `src/utils/binance-auth.ts`, `src/utils/binance-client.ts`, `src/utils/binance-sync.ts`.
- Integracion Bybit V5: `src/utils/bybit-auth.ts`, `src/utils/bybit-client.ts`.
- Vault local DPAPI: `src/server.ts`, `src/utils/local-vault.ts`.
- La app debe seguir funcionando sin credenciales y degradar con mensajes claros.
- Cualquier cliente de exchange debe mantenerse en modo lectura: endpoints firmados `GET`, whitelist explicita de paths y validacion de permisos antes de sincronizar datos privados.
- Bybit Dual Asset vive en `GET /v5/earn/advance/position` y requiere permiso `Earn`; se mapea como posicion `dual`.
- Bybit Discount Buy usa `GET /v5/earn/advance/position` con categoria `DiscountBuy`; se mapea como posicion `discount-buy`.
- El alcance son productos con ventana de liquidacion. Nada de futuros, perpetuos ni opciones: no se leen, no se modelan y no se piden sus permisos.
- Un dato que el exchange no manda se queda ausente. Nunca se rellena con `Date.now()` ni con la fecha de hoy: un valor tomado del reloj cambia en cada sondeo, hace que la posicion parezca otra y arrastra a la vista a redibujarse entera. Fecha desconocida es `''`, y la fila la muestra como `--/--`.
- Si `GET /v5/account/wallet-balance` no esta permitido, los saldos Bybit deben caer a `GET /v5/asset/transfer/query-account-coins-balance` con permisos de Activos.
- Las credenciales de exchanges se configuran desde el modal local, no desde `.env.local`, porque Bun puede exponer las variables `PUBLIC_*` en el bundle del navegador.
- Los secrets se guardan cifrados con Windows DPAPI en `.local/credentials.dpapi.json`, expuesto por `src/server.ts` y consumido desde `src/utils/local-vault.ts`; en `localStorage` solo deben persistir metadatos no secretos como la API key.

## Criterios de calidad

- Mantener contratos públicos:
  - mismas rutas hash
  - mismas keys de `localStorage`
  - mismo comportamiento funcional principal
- Evitar hardcoding nuevo de copy, colores y números mágicos.
- Mantener accesibilidad:
  - `aria-*` correcto
  - foco visible
  - navegación por teclado
- Cualquier refactor relevante debe cerrar con `pnpm run check`.

## Archivos de referencia

- Producto y uso: `README.md`
- Riesgos vigentes de diseno: `design-audit-findings.md`
