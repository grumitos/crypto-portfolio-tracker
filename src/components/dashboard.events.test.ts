import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindDashboardEvents } from './dashboard.events';
import { resetDom } from '../test/test-utils';

function renderDashboardEventsFixture(): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = `
    <button id="btn-edit-balance"></button>
    <button id="btn-edit-settings"></button>
    <div id="modal-balance" style="display:none">
      <button id="btn-cancel-balance"></button>
      <button id="btn-save-balance"></button>
      <input id="input-balance" />
    </div>
    <div id="modal-settings" style="display:none">
      <button id="btn-cancel-settings"></button>
      <button id="btn-save-settings"></button>
      <input id="input-invested" />
      <input id="input-goal" />
    </div>
  `;
  return container;
}

describe('dashboard events', () => {
  beforeEach(() => {
    resetDom();
    vi.clearAllMocks();
  });

  it('opens and closes balance/settings modals', () => {
    const container = renderDashboardEventsFixture();
    bindDashboardEvents(
      container,
      {
        onSaveBalance: vi.fn(),
        onSaveSettings: vi.fn(),
      },
      (value) => Number(value),
    );

    const balanceModal = container.querySelector('#modal-balance') as HTMLElement;
    const settingsModal = container.querySelector('#modal-settings') as HTMLElement;

    (container.querySelector('#btn-edit-balance') as HTMLButtonElement).click();
    expect(balanceModal.style.display).toBe('flex');
    (container.querySelector('#btn-cancel-balance') as HTMLButtonElement).click();
    expect(balanceModal.style.display).toBe('none');

    (container.querySelector('#btn-edit-settings') as HTMLButtonElement).click();
    expect(settingsModal.style.display).toBe('flex');
    (container.querySelector('#btn-cancel-settings') as HTMLButtonElement).click();
    expect(settingsModal.style.display).toBe('none');
  });

  it('saves valid balance and settings values', () => {
    const container = renderDashboardEventsFixture();
    const onSaveBalance = vi.fn();
    const onSaveSettings = vi.fn();
    bindDashboardEvents(container, { onSaveBalance, onSaveSettings }, (value) => Number(value));

    const balanceInput = container.querySelector('#input-balance') as HTMLInputElement;
    balanceInput.value = '1234.5';
    (container.querySelector('#btn-save-balance') as HTMLButtonElement).click();

    const investedInput = container.querySelector('#input-invested') as HTMLInputElement;
    const goalInput = container.querySelector('#input-goal') as HTMLInputElement;
    investedInput.value = '2000';
    goalInput.value = '3000';
    (container.querySelector('#btn-save-settings') as HTMLButtonElement).click();

    expect(onSaveBalance).toHaveBeenCalledWith(1234.5);
    expect(onSaveSettings).toHaveBeenCalledWith(2000, 3000);
  });

  it('does not persist invalid values', () => {
    const container = renderDashboardEventsFixture();
    const onSaveBalance = vi.fn();
    const onSaveSettings = vi.fn();
    bindDashboardEvents(container, { onSaveBalance, onSaveSettings }, (value) => Number(value));

    const balanceInput = container.querySelector('#input-balance') as HTMLInputElement;
    balanceInput.value = '-100';
    (container.querySelector('#btn-save-balance') as HTMLButtonElement).click();

    const investedInput = container.querySelector('#input-invested') as HTMLInputElement;
    const goalInput = container.querySelector('#input-goal') as HTMLInputElement;
    investedInput.value = '0';
    goalInput.value = 'bad';
    (container.querySelector('#btn-save-settings') as HTMLButtonElement).click();

    expect(onSaveBalance).not.toHaveBeenCalled();
    expect(onSaveSettings).not.toHaveBeenCalled();
  });
});
