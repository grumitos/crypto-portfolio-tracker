export interface SimulatorElements {
  capitalInput: HTMLInputElement | null;
  aprInput: HTMLInputElement | null;
  frequencyInput: HTMLSelectElement | null;
  goalInput: HTMLInputElement | null;
  capitalTag: HTMLElement | null;
  aprTag: HTMLElement | null;
  goalTag: HTMLElement | null;
  capitalHint: HTMLElement | null;
  aprHint: HTMLElement | null;
  goalHint: HTMLElement | null;
  beDate: HTMLElement | null;
  beTime: HTMLElement | null;
  goalDate: HTMLElement | null;
  goalTime: HTMLElement | null;
  daily: HTMLElement | null;
  monthly: HTMLElement | null;
  rate: HTMLElement | null;
  final: HTMLElement | null;
  tableContainer: HTMLElement | null;
  table: HTMLElement | null;
  chartBlock: HTMLElement | null;
  chart: HTMLElement | null;
}

export function getSimulatorElements(container: HTMLElement): SimulatorElements {
  return {
    capitalInput: container.querySelector('#sim-capital'),
    aprInput: container.querySelector('#sim-apr'),
    frequencyInput: container.querySelector('#sim-frequency'),
    goalInput: container.querySelector('#sim-goal'),
    capitalTag: container.querySelector('#sim-capital-tag'),
    aprTag: container.querySelector('#sim-apr-tag'),
    goalTag: container.querySelector('#sim-goal-tag'),
    capitalHint: container.querySelector('#sim-capital-hint'),
    aprHint: container.querySelector('#sim-apr-hint'),
    goalHint: container.querySelector('#sim-goal-hint'),
    beDate: container.querySelector('#sim-out-be-date'),
    beTime: container.querySelector('#sim-out-be-time'),
    goalDate: container.querySelector('#sim-out-goal-date'),
    goalTime: container.querySelector('#sim-out-goal-time'),
    daily: container.querySelector('#sim-out-daily'),
    monthly: container.querySelector('#sim-out-monthly'),
    rate: container.querySelector('#sim-out-rate'),
    final: container.querySelector('#sim-out-final'),
    tableContainer: container.querySelector('#sim-table-container'),
    table: container.querySelector('#sim-table'),
    chartBlock: container.querySelector('#sim-chart-block'),
    chart: container.querySelector('#projection-chart'),
  };
}
