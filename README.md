# Crypto Portfolio Tracker

App web estatica para monitorear un portfolio crypto, gestionar posiciones Dual Investment, proyectar recuperacion por compound y calcular rendimiento de swing trade.

## Alcance
- Frontend: `Vite + TypeScript`.
- Sin backend: todo corre en el navegador.
- Persistencia local en `localStorage`.
- Graficos con `Chart.js` (vista Simulador).
- Import/export de backup en JSON.

## Requisitos
- Node.js 20+
- npm 10+

## Inicio rapido
```bash
npm ci
npm run dev
```

Abrir la URL local que imprime Vite (por defecto `http://localhost:5173`).

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
| `npm run lint` | Lint con ESLint |
| `npm run lint:fix` | Lint + autofix |
| `npm run format` | Formatear con Prettier |
| `npm run format:check` | Verificar formato |
| `npm run check` | Typecheck + tests + build |
| `npm run check:ci` | Typecheck + coverage + build |

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
- Resultado con hitos de BE/meta y grafica de proyeccion.

### 4) Calculadora Swing Trade
- Evalua resultados reales y estrategia objetivo por ciclo.
- Soporta tabla de compras parciales (`Agregar`/`Borrar`).
- Cuando hay compras validas:
  - Capital y precio base se bloquean en modo AUTO usando totales de compras.
- Presets de fee: `spot` y `futures` (con switch FDUSD en spot).

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
| Key | Uso |
|-----|-----|
| `crypto-portfolio-tracker` | Estado principal (`portfolio` + `positions`) |
| `crypto-calculadora` | Estado de la calculadora |
| `crypto-simulator-view` | Estado de UI del simulador (valores + banderas AUTO) |
| `crypto-dashboard-view` | Preferencia de leyenda BE/Meta del dashboard |
| `crypto-api-last-updated-at` | Timestamp de ultima actualizacion de mercado exitosa |
| `crypto-theme` | Preferencia de tema (`light`, `dark`, `system`) |

## Tema y paleta
La app soporta `light`, `dark` y `system`.  
El tema se aplica al inicio para evitar FOUC y tambien actualiza `meta[name="theme-color"]`.

Referencia de paleta:

| Modo | Fondo | Texto | Borde ref | Focus |
|------|-------|-------|-----------|-------|
| Light | `#FAF9F5` | `#141413` | `#1F1E1D` | `#2C84DB` |
| Dark | `#262624` | `#FAF9F5` | `#DEDCD1` | `#2C84DB` |

## Accesibilidad
- `:focus-visible` en todos los elementos interactivos.
- `aria-current="page"` en la navegacion activa.
- `aria-expanded` y `aria-pressed` en toggles y leyendas.
- Soporte `prefers-reduced-motion` para animaciones.
- Targets tactiles minimos de 36px.

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
