import type { DualPosition, DualPositionComponent } from '../types';
import { calculateDualProjectedProfit, normalizeTime } from './dual-yield';

/**
 * Agrupa suscripciones que son la misma apuesta repetida.
 *
 * Un exchange devuelve una fila por suscripcion, asi que comprar el mismo par
 * cuatro veces para la misma ventana produce cuatro filas que solo se
 * diferencian en el importe y el minuto de entrada. Leerlas por separado obliga
 * a sumar de cabeza; leerlas juntas es lo que el usuario piensa que tiene.
 *
 * Lo que define un grupo es aquello que el usuario no puede cambiar sin abrir
 * otra posicion distinta: el par, la direccion y la ventana de bloqueo. El
 * exchange entra en la clave porque la columna "Fuente" tiene que seguir siendo
 * cierta, y el tipo de posicion porque una Dual y una Discount Buy del mismo par
 * son productos distintos aunque venzan el mismo dia.
 */

function groupKey(position: DualPosition): string {
  return [
    position.positionKind ?? 'dual',
    position.direction,
    position.asset,
    position.subscriptionAsset,
    position.quoteAsset ?? '',
    position.settlementDate,
    normalizeTime(position.settlementTime) ?? '',
    position.source ?? '',
  ].join('|');
}

function toComponent(position: DualPosition): DualPositionComponent {
  return {
    id: position.id,
    amount: position.amount,
    targetPrice: position.targetPrice,
    entryDate: position.entryDate,
    entryTime: position.entryTime,
    settlementDate: position.settlementDate,
    settlementTime: position.settlementTime,
    apr: position.apr,
  };
}

/** Orden comparable de una fecha con hora opcional. */
function timestampKey(date: string, time: string | undefined): string {
  return `${date} ${normalizeTime(time) ?? '00:00'}`;
}

function isGroupable(position: DualPosition): boolean {
  // Sin ventana no hay con que decidir si dos suscripciones son la misma
  // apuesta, y fusionarlas por descarte juntaria posiciones sin relacion.
  return (
    Boolean(position.settlementDate) && Number.isFinite(position.amount) && position.amount > 0
  );
}

/**
 * Promedia ponderando por importe: una suscripcion de 6.000 pesa el triple que
 * una de 2.000 al decidir el APR del grupo. La media simple mentiria.
 */
function weightedAverage(parts: DualPosition[], pick: (position: DualPosition) => number): number {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total <= 0) return 0;
  return parts.reduce((sum, part) => sum + pick(part) * part.amount, 0) / total;
}

function sumOptional(
  parts: DualPosition[],
  pick: (position: DualPosition) => number | undefined,
): number | undefined {
  let total = 0;
  let seen = false;
  for (const part of parts) {
    const value = pick(part);
    if (!Number.isFinite(value)) continue;
    total += value as number;
    seen = true;
  }
  return seen ? total : undefined;
}

function mergeGroup(parts: DualPosition[]): DualPosition {
  if (parts.length === 1) return parts[0];

  // La entrada del grupo es la primera suscripcion: es cuando el capital dejo
  // de estar libre, que es lo que la ventana mide.
  const earliest = parts.reduce((first, part) =>
    timestampKey(part.entryDate, part.entryTime) < timestampKey(first.entryDate, first.entryTime)
      ? part
      : first,
  );

  // El id del grupo es el de una de sus partes a proposito: aguas abajo hay
  // comprobaciones que leen el prefijo para saber de que exchange viene.
  const merged: DualPosition = {
    ...earliest,
    amount: parts.reduce((sum, part) => sum + part.amount, 0),
    apr: weightedAverage(parts, (part) => part.apr),
    targetPrice: weightedAverage(parts, (part) => part.targetPrice),
    components: parts.map(toComponent),
  };

  const projectedProfit = sumOptional(parts, (part) => part.projectedProfit);
  if (projectedProfit !== undefined) merged.projectedProfit = projectedProfit;

  const expectedSettlementAmount = sumOptional(parts, (part) => part.expectedSettlementAmount);
  if (expectedSettlementAmount !== undefined) {
    merged.expectedSettlementAmount = expectedSettlementAmount;
  }

  return merged;
}

/**
 * Consolida las posiciones que comparten par y ventana de bloqueo. Las que no
 * se pueden agrupar pasan intactas y conservan su orden relativo.
 */
export function groupPositionsByLockWindow(positions: DualPosition[]): DualPosition[] {
  const groups = new Map<string, DualPosition[]>();
  const order: Array<{ key: string } | { position: DualPosition }> = [];

  positions.forEach((position) => {
    if (!isGroupable(position)) {
      order.push({ position });
      return;
    }

    const key = groupKey(position);
    const existing = groups.get(key);
    if (existing) {
      existing.push(position);
      return;
    }

    groups.set(key, [position]);
    order.push({ key });
  });

  return order.map((entry) =>
    'position' in entry ? entry.position : mergeGroup(groups.get(entry.key)!),
  );
}

/**
 * Suscripciones reales detras de una lista ya agrupada. La metrica dice
 * "suscripciones abiertas", asi que un grupo de cuatro cuenta como cuatro.
 */
export function countPositionSubscriptions(positions: DualPosition[]): number {
  return positions.reduce((total, position) => total + (position.components?.length || 1), 0);
}

/**
 * Las partes de una fila como posiciones completas, o la propia fila si no
 * resume un grupo. Sirve para que cualquier magnitud que dependa del strike o de
 * la ventana se calcule parte por parte y luego se sume, en vez de derivarla de
 * los promedios del grupo.
 */
export function componentPositions(position: DualPosition): DualPosition[] {
  if (!position.components || position.components.length === 0) return [position];

  const parts = position.components.map((component) => ({
    ...position,
    ...component,
    components: undefined,
    // La ganancia guardada es la del grupo entero: cada parte parte de cero.
    projectedProfit: undefined,
  }));

  // Sin cifra del exchange cada parte calcula la suya y basta. Con ella, manda:
  // se reparte en proporcion a lo que cada parte genera por si misma, de modo
  // que las partes cuadran con el total en vez de contradecirlo.
  if (!Number.isFinite(position.projectedProfit)) return parts;

  const own = parts.map((part) => calculateDualProjectedProfit(part));
  const total = own.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return parts;

  return parts.map((part, index) => ({
    ...part,
    projectedProfit: (position.projectedProfit as number) * (own[index] / total),
  }));
}

/**
 * Ganancia proyectada de una fila. En un grupo es la suma de sus partes, cada
 * una con su strike y su ventana: derivarla del promedio del grupo aplicaria la
 * entrada mas temprana a todo el capital y facturaria dias que las suscripciones
 * posteriores no vivieron.
 */
export function resolvePositionProjectedProfit(position: DualPosition): number {
  return componentPositions(position).reduce(
    (total, part) => total + calculateDualProjectedProfit(part),
    0,
  );
}
