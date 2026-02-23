import { bindModalEvents, openModal, closeModal } from '../utils/modal-manager';

export interface DashboardEventHandlers {
  onSaveBalance: (savings: number) => void;
  onSaveSettings: (invested: number, goal: number) => void;
}

export function bindDashboardEvents(
  container: HTMLElement,
  handlers: DashboardEventHandlers,
  parseFlexibleNumber: (value: string) => number,
): void {
  const modalBalance = container.querySelector('#modal-balance') as HTMLElement;
  const modalSettings = container.querySelector('#modal-settings') as HTMLElement;

  container.querySelector('#btn-edit-balance')?.addEventListener('click', () => {
    openModal(modalBalance);
  });

  container.querySelector('#btn-edit-settings')?.addEventListener('click', () => {
    openModal(modalSettings);
  });

  bindModalEvents(modalBalance, [container.querySelector('#btn-cancel-balance') as HTMLElement]);
  bindModalEvents(modalSettings, [container.querySelector('#btn-cancel-settings') as HTMLElement]);

  container.querySelector('#btn-save-balance')?.addEventListener('click', () => {
    const input = container.querySelector('#input-balance') as HTMLInputElement;
    const value = parseFlexibleNumber(input.value);
    if (!isNaN(value) && value >= 0) {
      handlers.onSaveBalance(value);
      closeModal(modalBalance);
    }
  });

  container.querySelector('#btn-save-settings')?.addEventListener('click', () => {
    const investedInput = container.querySelector('#input-invested') as HTMLInputElement;
    const goalInput = container.querySelector('#input-goal') as HTMLInputElement;
    const invested = parseFlexibleNumber(investedInput.value);
    const goal = parseFlexibleNumber(goalInput.value);

    if (!isNaN(invested) && !isNaN(goal) && invested > 0 && goal > 0) {
      handlers.onSaveSettings(invested, goal);
      closeModal(modalSettings);
    }
  });
}
