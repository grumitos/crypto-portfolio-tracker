import { loadState, SIMULATOR_VIEW_KEY } from '../utils/storage';
import { weightedAverageAPR } from '../utils/calculator';
import type { CompoundFrequency, SimulationTargetMode } from '../types';

export const DEFAULT_APR_FALLBACK = 30;

export interface AutoState {
  capital: boolean;
  apr: boolean;
  goal: boolean;
}

export interface SimulatorViewState {
  capital: number;
  apr: number;
  frequency: CompoundFrequency;
  goal: number;
  targetMode: SimulationTargetMode;
  autoCapital: boolean;
  autoApr: boolean;
  autoGoal: boolean;
}

export function parsePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function sanitizeFrequency(value: unknown, fallback: CompoundFrequency): CompoundFrequency {
  if (value === 'daily' || value === 'weekly' || value === 'biweekly') {
    return value;
  }
  return fallback;
}

export function getDefaultViewState(): SimulatorViewState {
  const state = loadState();
  const avgAPR = weightedAverageAPR(state.positions);
  return {
    capital: state.portfolio.currentBalance,
    apr: avgAPR > 0 ? avgAPR : DEFAULT_APR_FALLBACK,
    frequency: 'daily',
    goal: state.portfolio.goalAmount,
    targetMode: 'both',
    autoCapital: true,
    autoApr: true,
    autoGoal: true,
  };
}

export function loadSimulatorViewState(defaults: SimulatorViewState): SimulatorViewState {
  try {
    const raw = localStorage.getItem(SIMULATOR_VIEW_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SimulatorViewState>;
    return {
      capital: parsePositiveNumber(parsed.capital, defaults.capital),
      apr: parsePositiveNumber(parsed.apr, defaults.apr),
      frequency: sanitizeFrequency(parsed.frequency, defaults.frequency),
      goal: parsePositiveNumber(parsed.goal, defaults.goal),
      targetMode: 'both',
      autoCapital: typeof parsed.autoCapital === 'boolean' ? parsed.autoCapital : defaults.autoCapital,
      autoApr: typeof parsed.autoApr === 'boolean' ? parsed.autoApr : defaults.autoApr,
      autoGoal: typeof parsed.autoGoal === 'boolean' ? parsed.autoGoal : defaults.autoGoal,
    };
  } catch {
    return defaults;
  }
}

export function saveSimulatorViewState(state: SimulatorViewState): void {
  localStorage.setItem(SIMULATOR_VIEW_KEY, JSON.stringify(state));
}

export function persistSimulatorViewState(container: HTMLElement, autoState: AutoState): void {
  const defaults = getDefaultViewState();
  const capitalValue = (container.querySelector('#sim-capital') as HTMLInputElement | null)?.value;
  const aprValue = (container.querySelector('#sim-apr') as HTMLInputElement | null)?.value;
  const frequencyValue = (container.querySelector('#sim-frequency') as HTMLSelectElement | null)?.value;
  const goalValue = (container.querySelector('#sim-goal') as HTMLInputElement | null)?.value;

  saveSimulatorViewState({
    capital: parsePositiveNumber(capitalValue, defaults.capital),
    apr: parsePositiveNumber(aprValue, defaults.apr),
    frequency: sanitizeFrequency(frequencyValue, defaults.frequency),
    goal: parsePositiveNumber(goalValue, defaults.goal),
    targetMode: 'both',
    autoCapital: autoState.capital,
    autoApr: autoState.apr,
    autoGoal: autoState.goal,
  });
}
