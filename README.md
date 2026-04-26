# Crypto Portfolio Tracker

App web estatica para monitorear un portfolio crypto, gestionar posiciones Dual Investment, proyectar recuperacion por compound y calcular rendimiento de swing trade.

## Alcance

- Frontend: `Vite + TypeScript`.
- Sin backend: todo corre en el navegador.
- Persistencia local en `localStorage`.
- Tabla de proyeccion mensual en la vista `Simulador`.
- Import/export de backup en JSON.

## Documentacion tecnica

- Guia tecnica del repo: `ENGINEERING_GUIDE.md`
- Hallazgos de auditoria y remediacion: `design-audit-findings.md`

## Requisitos

- Node.js 20+
- npm 10+

## Inicio rapido

```bash
npm ci
npm run dev
```

Abrir la URL local que imprime Vite (por defecto `http://localhost:5176`).

## Scripts

| Comando                 | Descripcion                  |
| ----------------------- | ---------------------------- |
| `npm run dev`           | Desarrollo con hot reload    |
| `npm run build`         | Build de produccion          |
| `npm run preview`       | Servir build local           |
| `npm run test`          | Tests en modo watch          |
| `npm run test:run`      | Tests una sola vez           |
| `npm run test:coverage` | Tests + reporte de coverage  |
| `npm run typecheck`     | Validacion TypeScript        |
| `npm run lint`          | Lint con ESLint              |
| `npm run lint:fix`      | Lint + autofix               |
| `npm run format`        | Formatear con Prettier       |
| `npm run format:check`  | Verificar formato            |
| `npm run check`         | Typecheck + tests + build    |
| `npm run check:ci`      | Typecheck + coverage + build |

## Flujo recomendado de uso

1. Configurar `Ahorros` y `Configurar` (invertido/meta) en `Dashboard`.
2. Cargar posiciones en `Posiciones` (manual o con pegado de Binance).
3. Revisar proyecciones en `Simulador` (AUTO o MANUAL).
4. Evaluar ciclos en `Calculadora Swing Trade`.
5. Exportar backup JSON desde el boton de archivo en la barra superior.

## Vistas y comportamiento

### 1) Dashboard

- Resumen de portfolio: balance, P&L, progreso a breakeven (BE) y meta.
- Modales:
  - `Ahorros`: actualiza balance disponible.
  - `Configurar`: define total invertido y meta.
- Barra de progreso con leyenda BE/Meta; el estado de la leyenda se persiste.
- Tarjetas de capital/APR/rendimiento diario calculadas desde posiciones y precios de mercado.

### 2) Posiciones

- CRUD completo de posiciones Dual Investment.
- **Tira de precios spot**: muestra precio actual y cambio 24h de los activos con posiciones (BTC, ETH, BNB, SOL). Orden fijo, excluye stablecoins.
- Modo `Editar` para eliminar rapido desde la tabla.
- Importacion masiva con `Pegar y reemplazar`:
  - Parsea texto de posiciones exportadas/copypasteadas desde Binance.
  - Reemplaza la lista completa por las posiciones parseadas.
- Parser estricto Binance-only (sin capas ni opciones de otros exchanges).
- Activo base permitido por defecto para parser: `BTC`, `ETH`, `BNB`, `SOL`, `USDT`, `USDC`.

### 3) Simulador

- Proyeccion de compound con frecuencia `Diaria`, `Semanal` o `Quincenal`.
- Modos `AUTO/MANUAL` para:
  - Capital (AUTO: total en posiciones).
  - APR (AUTO: promedio ponderado USD de posiciones).
  - Meta (AUTO: meta del dashboard).
- Boton `Resetear AUTO` para restaurar sincronizacion automatica.
- Resultado con hitos de BE/meta y tabla de proyeccion mensual.
- Arquitectura interna refactorizada en `constants`, `template` y `dom`.

### 4) Calculadora Swing Trade

- Evalua resultados reales y estrategia objetivo por ciclo.
- Soporta tabla de compras parciales (`Agregar`/`Borrar`).
- Cuando hay compras validas:
  - Capital y precio base se bloquean en modo AUTO usando totales de compras.
- Presets de fee: `spot` y `futures` (con switch FDUSD en spot).
- Arquitectura interna refactorizada para separar copy/presets y template del flujo de calculo.

## Arquitectura UI

- Shell compartido extraido para header, navegacion y acciones globales.
- Sistema visual consolidado alrededor de `src/styles/variables.css` y `src/utils/theme.ts`.
- `dashboard`, `simulator` y `calculadora` ya siguen un patron modular; `positions` conserva mas logica de coordinacion pero ya extrae constants/template.
- Los colores de browser theme se derivan de tokens CSS para evitar drift entre tema y runtime.

## Datos de mercado

- Endpoints usados (con fallback):
  - `https://api.binance.com/api/v3/ticker/price`
  - `https://api.binance.us/api/v3/ticker/price`
- Estrategia de precio:
  - Par directo `ASSETUSDT`.
  - Fallback via `ASSETBTC` x `BTCUSDT`.
- Polling central: cada 60s (`MARKET_POLL_INTERVAL_MS = 60000`).
- Cache en memoria de precios: TTL 60s.
- Si no hay precio fresco:
  - Usa `cache-stale` cuando exista cache anterior.
  - Marca `unavailable` cuando no hay forma de resolver precio.
- Ante fallo/parcialidad:
  - Se registra estado de error de API.
  - Se muestra banner `No se pudo actualizar precios de mercado`.
  - El header pasa a estado de error con ultimo dato valido relativo.

## Integraciones de exchange

- Binance usa endpoints firmados `GET` para lectura de cuenta y posiciones.
- La prueba de credenciales Binance valida `GET /sapi/v1/account/apiRestrictions` para detectar permisos de ejecucion, retiro o transferencia.
- Bybit V5 esta preparado con cliente separado y whitelist de endpoints `GET`:
  - `GET /v5/user/query-api` para confirmar `readOnly: 1`.
  - `GET /v5/account/wallet-balance` para saldos `UNIFIED`, `CONTRACT` y `SPOT`.
  - `GET /v5/asset/transfer/query-account-coins-balance` como respaldo de saldos con permisos de Activos.
  - `GET /v5/earn/advance/position` para posiciones activas de Advanced Earn Dual Asset cuando la key tiene permiso `Earn`.
  - `GET /v5/position/list` para posiciones abiertas `linear`, `inverse` y `option`.
  - `GET /v5/market/tickers` para precios spot publicos.
- En ambas integraciones, el `API Secret` se guarda cifrado en localStorage con WebCrypto AES-GCM y una contraseña maestra que no se persiste; tras recargar, hay que desbloquear el vault para firmar lecturas privadas.
- Las credenciales de exchanges no se cargan desde `.env.local`: en una SPA de Vite esos valores terminan expuestos al bundle del navegador. Configuralas solo desde el modal local de la app.
- Dashboard puede sumar saldos de Binance y Bybit a la vez. Las posiciones automatizadas incluyen Binance Dual Investment, Bybit Dual Asset y, solo si la key lo permite, posiciones derivadas abiertas de Bybit; el nocional derivado Bybit no se suma encima del wallet para evitar doble conteo.

## Regla de facturacion (Dual Binance)

- Liquidacion de referencia: `08:00 UTC` (`03:00 UTC-5`) para la fecha de settlement.
- Corte de ventana Binance: `15:59 UTC` (`10:59 UTC-5`).
- Dias facturados:
  - Se calculan por ventanas de corte Binance (no por fracciones de hora).
  - El minimo facturable es `1` dia.

## Backup de datos

El modal de backup permite:

- `Exportar JSON`
- `Importar backup JSON`

Formato actual exportado:

```json
{
  "version": 2,
  "exportedAt": "2026-02-23T00:00:00.000Z",
  "app": {
    "portfolio": {},
    "positions": []
  },
  "calculadora": {}
}
```

Compatibilidad de importacion:

- Soporta formato actual (`version: 2`, con `app` y `calculadora`).
- Soporta formato legacy (objeto raiz equivalente al estado `app`).

## Persistencia local (`localStorage`)

| Key                          | Uso                                                  |
| ---------------------------- | ---------------------------------------------------- |
| `crypto-portfolio-tracker`   | Estado principal (`portfolio` + `positions`)         |
| `crypto-calculadora`         | Estado de la calculadora                             |
| `crypto-simulator-view`      | Estado de UI del simulador (valores + banderas AUTO) |
| `crypto-dashboard-view`      | Preferencia de leyenda BE/Meta del dashboard         |
| `crypto-api-last-updated-at` | Timestamp de ultima actualizacion de mercado exitosa |
| `crypto-theme`               | Preferencia de tema (`light`, `dark`, `system`)      |
| `crypto-binance-api`         | API Key Binance y vault cifrado del Secret           |
| `crypto-bybit-api`           | API Key Bybit y vault cifrado del Secret             |

## Tema y paleta

La app soporta `light`, `dark` y `system`.  
El tema se aplica al inicio para evitar FOUC y tambien actualiza `meta[name="theme-color"]`.

Referencia de paleta:

| Modo  | Fondo     | Texto     | Borde ref | Focus     |
| ----- | --------- | --------- | --------- | --------- |
| Light | `#FAF9F5` | `#141413` | `#1F1E1D` | `#2C84DB` |
| Dark  | `#262624` | `#FAF9F5` | `#DEDCD1` | `#2C84DB` |

Los tokens semanticos activos cubren superficie, texto, borde, accent, success, danger, warning y focus.

## Accesibilidad

- `:focus-visible` en todos los elementos interactivos.
- `aria-current="page"` en la navegacion activa.
- `aria-expanded` y `aria-pressed` en toggles y leyendas.
- Soporte `prefers-reduced-motion` para animaciones.
- Targets tactiles minimos de 44px.

## Checklist de PR

- Ejecutar `npm run check`.
- Verificar estados `light` y `dark`.
- Revisar shell en mobile y desktop.
- Confirmar que no se introduzcan nuevos hardcodeos visuales en TypeScript.
- Confirmar que cualquier nueva vista grande siga el patron modular del repo.

## PWA

Incluye `manifest.json`, iconos (192/512) y service worker basico (`public/sw.js`) para instalacion como app.

## Troubleshooting rapido

- `No se pudo actualizar precios de mercado`:
  - Verifica conectividad y disponibilidad de Binance.
  - La app puede seguir mostrando valores de cache (stale) temporalmente.
- Import JSON falla:
  - Validar que el archivo sea JSON valido y tenga formato compatible.
- Valores en `---` o `0` en cards:
  - Revisar que existan posiciones activas con datos correctos.
- Estado inconsistente:
  - Reimportar ultimo backup valido.
