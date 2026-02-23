import { iconChevronUp, iconChevronDown } from './icons';

function countDecimals(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const text = String(n);
  const dotIndex = text.indexOf('.');
  return dotIndex >= 0 ? text.length - dotIndex - 1 : 0;
}

function stepNumberInput(input: HTMLInputElement, direction: 1 | -1): void {
  if (input.disabled || input.readOnly) return;

  const rawStep = input.step === '' || input.step === 'any' ? NaN : Number(input.step);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;
  const min = input.min === '' ? NaN : Number(input.min);
  const max = input.max === '' ? NaN : Number(input.max);

  let current = Number(input.value);
  if (!Number.isFinite(current)) {
    current = Number.isFinite(min) ? min : 0;
  }

  let next = current + direction * step;
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);

  const decimals = countDecimals(step);
  input.value = decimals > 0 ? next.toFixed(decimals) : String(Math.round(next));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function enhanceNumberSteppers(root: ParentNode): void {
  const inputs = root.querySelectorAll('input[type="number"]');
  inputs.forEach((node) => {
    const input = node as HTMLInputElement;
    if (input.dataset.stepperReady === '1') return;
    if (!input.parentElement) return;

    input.dataset.stepperReady = '1';
    input.classList.add('num-stepper-input');

    const wrapper = document.createElement('div');
    wrapper.className = 'num-stepper-wrap';
    input.parentElement.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const controls = document.createElement('div');
    controls.className = 'num-stepper-controls';

    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'num-stepper-btn';
    btnUp.setAttribute('aria-label', 'Aumentar valor');
    btnUp.innerHTML = iconChevronUp(12);
    btnUp.addEventListener('click', () => stepNumberInput(input, 1));

    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'num-stepper-btn';
    btnDown.setAttribute('aria-label', 'Reducir valor');
    btnDown.innerHTML = iconChevronDown(12);
    btnDown.addEventListener('click', () => stepNumberInput(input, -1));

    controls.appendChild(btnUp);
    controls.appendChild(btnDown);
    wrapper.appendChild(controls);
  });
}
