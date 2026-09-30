# Crypto Portfolio Tracker

App web local en TypeScript para seguir un portafolio cripto con datos de solo lectura de
Binance, Bybit e Hyperliquid.

Sirve en local una app de una sola página, instalable como PWA, que suma los saldos y las
posiciones de Binance y Bybit, sigue los vaults de Hyperliquid, proyecta el crecimiento por
interés compuesto y calcula ciclos de swing trade. Las claves de los exchanges se guardan
cifradas con Windows DPAPI y los exchanges solo se consultan en modo lectura.

![Dashboard de una instalación limpia, sin datos de cartera](docs/screenshots/dashboard.png)

## Requisitos

- Windows: las claves se guardan cifradas con DPAPI. Sin DPAPI no se pueden guardar claves, y la
  app queda limitada a los datos públicos de mercado.
- [Bun](https://bun.sh/) 1.3 o superior en el `PATH`. Para ejecutar la app no hace falta instalar
  dependencias.
- Opcional: claves de API de solo lectura de Binance o Bybit, y la dirección pública de una wallet
  de Hyperliquid para la vista Capital.
- Solo para desarrollo: pnpm 11 (o `corepack pnpm`) para las dependencias de desarrollo, y
  Python 3 para el análisis ETH de `scripts/`.

## Instalación y uso

Ejecuta `run.bat` (con doble clic o desde una terminal): sirve la app en `http://localhost:5176`
y la abre en el navegador en cuanto responde. La ventana de la consola es el servidor: ciérrala o
pulsa Ctrl+C para detenerlo. Luego, en la app:

1. Abre Configuración (el engrane) y conecta Binance o Bybit con claves de solo lectura; en el
   mismo modal define el total invertido y la meta.
2. Sincroniza y revisa Dashboard y Posiciones.
3. En Capital, indica la wallet de Hyperliquid para sincronizar sus vaults.
4. Proyecta en Simulador y evalúa ciclos en Calculadora.

Sin el lanzador:

```bat
set NODE_ENV=production
set PUBLIC_APP_ENV=production
bun src/server.ts
```

`run.bat` acepta un argumento:

| Opción | Efecto |
| --- | --- |
| `5180` | sirve la app en ese puerto (por defecto, `5176`) |

El lanzador termina con código de salida 1 si falta Bun o si el puerto ya está en uso.

## Vistas

- **Dashboard**: invertido total, saldo, P&L, progreso hacia el breakeven (BE) y la meta, APR
  promedio, capital en posiciones, run-rate diario y saldos por activo de los exchanges. Sin
  saldos ni posiciones, conserva el último saldo guardado en lugar de reescribirlo a cero.
- **Posiciones**: vista de solo lectura de las posiciones Binance Dual Investment, Bybit Dual
  Asset y Bybit Discount Buy. Cada sincronización reemplaza la lista completa. La tira de precios
  spot (BTC, ETH, BNB y SOL) solo aparece cuando hay posiciones.
- **Capital**: vaults de Hyperliquid de una wallet: equity, capital neto aportado, PnL histórico,
  XIRR anualizado por flujos y movimientos. Es una consulta pública: no pide claves.
- **Simulador**: proyección por interés compuesto con frecuencia diaria, semanal o quincenal.
  Capital, APR y meta pueden ser automáticos (tomados de las posiciones y del dashboard) o
  manuales, con hitos de BE y meta y una tabla de proyección mensual.
- **Calculadora**: ciclos de swing trade de venta y recompra. Separa la posición (coste medio y
  capital, automáticos si se agregan compras parciales) del ciclo; los precios del ciclo se
  capturan en dólares o en porcentaje, y la comisión se elige entre spot y FDUSD.

## Integraciones de exchange

- **Solo lectura.** Binance y Bybit se consultan con endpoints firmados `GET` de una lista
  cerrada, y el proxy local rechaza `POST`, `PUT`, `PATCH`, `DELETE` y cualquier ruta
  desconocida. No se crean órdenes, suscripciones, transferencias, retiros ni préstamos.
- **Permisos.** Antes de guardar, la app comprueba que la clave no tenga permisos de ejecución,
  retiro ni transferencia (`GET /sapi/v1/account/apiRestrictions` en Binance, `readOnly: 1` en
  Bybit).
- **Saldo de Binance.** Suma Wallet, Spot, Funding, Simple Earn, USDⓈ-M, COIN-M, Opciones,
  Margin, Portfolio Margin, staking, BFUSD/RWUSD, On-chain Yields, Soft Staking, Discount Buy,
  préstamos (como colateral neto) y recompensas acreditadas, sin contar dos veces lo que liquida
  en Wallet o ya aparece como posición.
- **Saldo de Bybit.** Cuentas `UNIFIED`, `CONTRACT` y `SPOT` (`GET /v5/account/wallet-balance`),
  con `GET /v5/asset/transfer/query-account-coins-balance` como respaldo; las posiciones Dual
  Asset y Discount Buy requieren el permiso `Earn`.
- **PnL diario.** Suma el rendimiento live de las posiciones activas y el PnL que reporta Binance
  en el refresco actual, una sola vez. El run-rate y el APR de cuenta son live.
- **Hyperliquid.** El servidor local consulta la API pública con la dirección de la wallet; no hay
  claves.

## Datos de mercado

- Precios de los endpoints públicos de Binance (`api.binance.com`, con `api.binance.us` como
  respaldo); el cambio de 24 h sale de `/ticker/24hr`. `PUBLIC_BINANCE_ENDPOINTS` reemplaza la
  lista en builds locales.
- Precio directo `ASSETUSDT`, o `ASSETBTC` × `BTCUSDT` si no existe el par.
- Sondeo cada 60 s y caché en memoria de 60 s. Si no hay precio nuevo se usa el de la caché
  (`cache-stale`) y, si tampoco lo hay, se marca como `unavailable`; ante un fallo aparece el aviso
  "No se pudo actualizar precios de mercado".

## Regla de facturación (Dual Binance)

- Liquidación de referencia: `08:00 UTC` (`03:00 UTC-5`) en la fecha de liquidación.
- Corte de ventana de Binance: `15:59 UTC` (`10:59 UTC-5`).
- Los días facturados se cuentan por ventanas de corte, no por fracciones de hora, con un mínimo
  de 1 día.

## Persistencia local

| Clave de `localStorage` | Uso |
| --- | --- |
| `crypto-portfolio-tracker` | estado principal: portafolio y posiciones sincronizadas |
| `crypto-calculadora` | estado de la calculadora |
| `crypto-simulator-view` | valores del simulador y modos automáticos |
| `crypto-dashboard-view` | preferencia de la leyenda BE/Meta |
| `crypto-api-last-updated-at` | última actualización de mercado correcta |
| `crypto-theme` | tema: `light`, `dark` o `system` |
| `crypto-binance-api` | API Key de Binance (el Secret no se guarda aquí) |
| `crypto-bybit-api` | API Key de Bybit (el Secret no se guarda aquí) |

Los Secret se guardan cifrados con DPAPI en `.local/credentials.dpapi.json`; en el navegador solo
viven en memoria durante la sesión.

## Tema, accesibilidad y PWA

- Temas `light`, `dark` y `system`, aplicados antes de pintar la página. Los tokens de color están
  en `src/styles/variables.css` y las reglas del sistema visual, en `docs/design-system.md`.
- Binance, Bybit e Hyperliquid llevan junto a su nombre un punto con su color de marca; el texto
  conserva el color de la interfaz porque esos colores no alcanzan el contraste en el tema claro.
- Foco visible, `aria-current`, `aria-expanded` y `aria-pressed` donde corresponde, soporte de
  `prefers-reduced-motion` y objetivos táctiles de 44 px como mínimo.
- `manifest.json`, iconos de 192 y 512 px y un service worker básico (`public/sw.js`) para
  instalarla como app.

## Desarrollo

```bat
corepack pnpm install
corepack pnpm run dev
```

| Comando | Efecto |
| --- | --- |
| `pnpm run dev` | servidor con recarga en caliente |
| `pnpm run build` / `pnpm run preview` | build de producción en `dist/` y servirlo |
| `pnpm run typecheck` | comprobación de tipos con `tsc` |
| `pnpm run lint` / `pnpm run format:check` | ESLint y Prettier |
| `pnpm run test:run` / `pnpm run test:coverage` | pruebas, una vez o con cobertura |
| `pnpm run check` | tipos, pruebas con cobertura y build |
| `pnpm run eth:analysis` | análisis ETH en Python (`scripts/`) |

La guía técnica (arquitectura y criterios de calidad) está en `docs/engineering-guide.md`.

## Privacidad

Las claves (`.local/`), el build (`dist/`) y la cobertura (`coverage/`) permanecen en local y
están fuera de Git; el repositorio no incluye claves ni datos de cartera, y la captura muestra una
instalación limpia. Las peticiones firmadas solo van a Binance y Bybit, a través del proxy local, y
el Secret nunca sale del equipo: solo firma. La dirección de la wallet solo se envía a la API
pública de Hyperliquid. Las variables
`PUBLIC_*` de Bun pueden acabar en el código del navegador, por eso las claves nunca se leen de
`.env`: se configuran desde la app.

## Pruebas

Las pruebas usan `bun test` con jsdom y clientes simulados: no llaman a los exchanges ni leen el
vault. Están junto al código que prueban (`*.test.ts`), como es habitual en TypeScript. El
análisis ETH tiene sus propias pruebas con `unittest`.

```bat
corepack pnpm install
bun test --isolate
python -m unittest scripts/eth_analysis_runner_test.py
```

## Estructura

```text
src/                app: TypeScript sin framework
  main.ts           arranque: shell, rutas por hash y sondeo de precios
  server.ts         servidor local: app, proxy de solo lectura, vault DPAPI e Hyperliquid
  index.html        página de entrada
  components/       vistas (dashboard, positions, capital, simulator, calculadora) y shell
  utils/            clientes de exchanges, mercado, almacenamiento, tema y animación
  styles/           tokens del sistema visual y estilos por vista
  types/            tipos compartidos
  assets/           logos de criptoactivos
  test/             configuración de bun test (jsdom)
public/             manifest, service worker e iconos de la PWA
scripts/            análisis ETH en Python y sus pruebas
docs/               guía técnica, sistema visual y captura
package.json        scripts de desarrollo y dependencias de desarrollo (pnpm)
run.bat             lanzador para Windows: sirve la app y abre el navegador
```

## Licencia

[MIT](LICENSE).
