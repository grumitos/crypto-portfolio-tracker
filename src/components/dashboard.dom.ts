export interface DashboardElements {
  invested: HTMLElement | null;
  balance: HTMLElement | null;
  balanceDate: HTMLElement | null;
  pnl: HTMLElement | null;
  pnlPct: HTMLElement | null;
  goalBar: HTMLElement | null;
  goalMutedFirst: HTMLElement | null;
  goalMutedSecond: HTMLElement | null;
  goalSolidFirst: HTMLElement | null;
  goalSolidSecond: HTMLElement | null;
  goalCurrent: HTMLElement | null;
  goalTargetLabel: HTMLElement | null;
  goalTargetAmount: HTMLElement | null;
  goalRemainingText: HTMLElement | null;
  goalRemainingAmount: HTMLElement | null;
  goalRemainingPrefix: HTMLElement | null;
  goalRemainingTarget: HTMLElement | null;
  goalDays: HTMLElement | null;
  goalDaysSeparator: HTMLElement | null;
  legendBreakEven: HTMLButtonElement | null;
  legendGoal: HTMLButtonElement | null;
  apr: HTMLElement | null;
  capital: HTMLElement | null;
  daily: HTMLElement | null;
  positionsCount: HTMLElement | null;
  balanceStrip: HTMLElement | null;
  balanceStripItems: HTMLElement | null;
}

function query<T extends Element>(container: HTMLElement, selector: string): T | null {
  return container.querySelector<T>(selector);
}

export function getDashboardElements(container: HTMLElement): DashboardElements {
  return {
    invested: query(container, '#dash-invested'),
    balance: query(container, '#dash-balance'),
    balanceDate: query(container, '#dash-balance-date'),
    pnl: query(container, '#dash-pnl'),
    pnlPct: query(container, '#dash-pnl-pct'),
    goalBar: query(container, '#dash-goal-progress-bar'),
    goalMutedFirst: query(container, '#dash-prog-muted-first'),
    goalMutedSecond: query(container, '#dash-prog-muted-second'),
    goalSolidFirst: query(container, '#dash-prog-solid-first'),
    goalSolidSecond: query(container, '#dash-prog-solid-second'),
    goalCurrent: query(container, '#dash-prog-current'),
    goalTargetLabel: query(container, '#dash-prog-target-label'),
    goalTargetAmount: query(container, '#dash-prog-target-amount'),
    goalRemainingText: query(container, '#dash-prog-remaining-text'),
    goalRemainingAmount: query(container, '#dash-prog-remaining-amount'),
    goalRemainingPrefix: query(container, '#dash-prog-remaining-prefix'),
    goalRemainingTarget: query(container, '#dash-prog-remaining-target'),
    goalDays: query(container, '#dashboard-days'),
    goalDaysSeparator: query(container, '#dashboard-days-sep'),
    legendBreakEven: query(container, '#dashboard-legend-be'),
    legendGoal: query(container, '#dashboard-legend-goal'),
    apr: query(container, '#dashboard-apr'),
    capital: query(container, '#dashboard-capital'),
    daily: query(container, '#dashboard-daily'),
    positionsCount: query(container, '#dashboard-positions-count'),
    balanceStrip: query(container, '#dashboard-balance-strip'),
    balanceStripItems: query(container, '#dashboard-balance-strip-items'),
  };
}
