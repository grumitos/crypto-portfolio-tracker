# Riesgos de Diseno

Seguimiento compacto de riesgos de diseno vigentes. La remediacion historica ya esta reflejada en el codigo y en `ENGINEERING_GUIDE.md`.

## Riesgos Vigentes

- `src/components/positions.ts` sigue concentrando coordinacion de estado, eventos y render auxiliar. Es la siguiente vista a desacoplar antes de agregar flujos nuevos.
- `src/components/dashboard.ts` sigue siendo grande aunque ya tiene modulos de soporte; `src/components/dashboard.template.ts` conserva skeletons con anchos inline.
- `src/styles/global.css` sigue siendo la hoja global mas grande; nuevos estilos deberian ir a hojas de vista o a primitivos compartidos cuando corresponda.

## Guardas

- Preservar rutas hash, keys de `localStorage`, semantica del vault DPAPI e integraciones Binance/Bybit.
- Ejecutar `pnpm run check` cuando haya refactors de UI o flujo.
- Mantener navegacion por teclado, foco visible y contraste actual.
