import { beforeEach, describe, expect, it, vi } from '#test';
import { enhanceNumberSteppers } from './number-stepper';

describe('number-stepper', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('wraps numeric inputs once and steps up/down with input events', () => {
    const container = document.createElement('div');
    container.innerHTML = `<input id="n" type="number" step="0.5" value="1">`;
    document.body.appendChild(container);

    const input = container.querySelector('#n') as HTMLInputElement;
    const inputEvents = vi.fn();
    input.addEventListener('input', inputEvents);

    enhanceNumberSteppers(container);

    const wrapper = input.closest('.num-stepper-wrap');
    expect(wrapper).not.toBeNull();
    const buttons = wrapper!.querySelectorAll<HTMLButtonElement>('.num-stepper-btn');
    expect(buttons).toHaveLength(2);

    buttons[0].click();
    expect(input.value).toBe('1.5');

    buttons[1].click();
    expect(input.value).toBe('1.0');
    expect(inputEvents).toHaveBeenCalledTimes(2);

    enhanceNumberSteppers(container);
    expect(container.querySelectorAll('.num-stepper-wrap')).toHaveLength(1);
    expect(container.querySelectorAll('.num-stepper-controls')).toHaveLength(1);
  });

  it('uses min as fallback and respects min/max bounds', () => {
    const container = document.createElement('div');
    container.innerHTML = `<input id="n" type="number" step="2" min="4" max="8" value="">`;
    document.body.appendChild(container);

    enhanceNumberSteppers(container);

    const input = container.querySelector('#n') as HTMLInputElement;
    const buttons = container.querySelectorAll<HTMLButtonElement>('.num-stepper-btn');
    const up = buttons[0];
    const down = buttons[1];

    down.click();
    expect(input.value).toBe('4');

    up.click();
    expect(input.value).toBe('6');

    up.click();
    expect(input.value).toBe('8');

    up.click();
    expect(input.value).toBe('8');
  });

  it('uses default step=1 for step=any and rounds to integer output', () => {
    const container = document.createElement('div');
    container.innerHTML = `<input id="n1" type="number" step="any" value="1.2"><input id="n2" type="number" step="any" value="abc">`;
    document.body.appendChild(container);

    enhanceNumberSteppers(container);

    const first = container.querySelector('#n1') as HTMLInputElement;
    const second = container.querySelector('#n2') as HTMLInputElement;
    const controls = container.querySelectorAll('.num-stepper-wrap');

    const firstUp = controls[0].querySelectorAll<HTMLButtonElement>('.num-stepper-btn')[0];
    firstUp.click();
    expect(first.value).toBe('2');

    const secondUp = controls[1].querySelectorAll<HTMLButtonElement>('.num-stepper-btn')[0];
    secondUp.click();
    expect(second.value).toBe('1');
  });

  it('does not modify disabled or readonly inputs', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <input id="disabled" type="number" value="5" disabled>
      <input id="readonly" type="number" value="7" readonly>
    `;
    document.body.appendChild(container);

    enhanceNumberSteppers(container);

    const disabled = container.querySelector('#disabled') as HTMLInputElement;
    const readonly = container.querySelector('#readonly') as HTMLInputElement;
    const wraps = container.querySelectorAll('.num-stepper-wrap');

    wraps[0].querySelectorAll<HTMLButtonElement>('.num-stepper-btn')[0].click();
    wraps[1].querySelectorAll<HTMLButtonElement>('.num-stepper-btn')[1].click();

    expect(disabled.value).toBe('5');
    expect(readonly.value).toBe('7');
  });
});
