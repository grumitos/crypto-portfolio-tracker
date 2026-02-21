import { updatePortfolio } from '../utils/storage';

export function bindDashboardEvents(
  container: HTMLElement,
  onStateChange: () => void,
  parseFlexibleNumber: (value: string) => number,
): void {
  const modalBalance = container.querySelector('#modal-balance') as HTMLElement;
  const modalSettings = container.querySelector('#modal-settings') as HTMLElement;

  container.querySelector('#btn-edit-balance')?.addEventListener('click', () => {
    modalBalance.style.display = 'flex';
  });

  container.querySelector('#btn-edit-settings')?.addEventListener('click', () => {
    modalSettings.style.display = 'flex';
  });

  container.querySelector('#btn-cancel-balance')?.addEventListener('click', () => {
    modalBalance.style.display = 'none';
  });

  container.querySelector('#btn-cancel-settings')?.addEventListener('click', () => {
    modalSettings.style.display = 'none';
  });

  modalBalance.addEventListener('click', (e) => {
    if (e.target === modalBalance) modalBalance.style.display = 'none';
  });

  modalSettings.addEventListener('click', (e) => {
    if (e.target === modalSettings) modalSettings.style.display = 'none';
  });

  container.querySelector('#btn-save-balance')?.addEventListener('click', () => {
    const input = container.querySelector('#input-balance') as HTMLInputElement;
    const value = parseFlexibleNumber(input.value);
    if (!isNaN(value) && value >= 0) {
      updatePortfolio({ savings: value });
      modalBalance.style.display = 'none';
      onStateChange();
    }
  });

  container.querySelector('#btn-save-settings')?.addEventListener('click', () => {
    const investedInput = container.querySelector('#input-invested') as HTMLInputElement;
    const goalInput = container.querySelector('#input-goal') as HTMLInputElement;
    const invested = parseFlexibleNumber(investedInput.value);
    const goal = parseFlexibleNumber(goalInput.value);

    if (!isNaN(invested) && !isNaN(goal) && invested > 0 && goal > 0) {
      updatePortfolio({ totalInvested: invested, goalAmount: goal });
      modalSettings.style.display = 'none';
      onStateChange();
    }
  });
}
