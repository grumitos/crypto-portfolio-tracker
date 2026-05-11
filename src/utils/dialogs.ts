import { bindModalEvents, closeModal, openModal } from './modal-manager';

interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface DialogElements {
  overlay: HTMLElement;
  title: HTMLElement;
  message: HTMLElement;
  cancelButton: HTMLButtonElement;
  confirmButton: HTMLButtonElement;
}

let dialogElements: DialogElements | null = null;
let pendingResolve: ((value: boolean) => void) | null = null;

function ensureDialogElements(): DialogElements | null {
  if (typeof document === 'undefined') return null;
  if (dialogElements?.overlay.isConnected) return dialogElements;
  dialogElements = null;

  const overlay = document.createElement('dialog');
  overlay.id = 'modal-app-dialog';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="modal-title" id="app-dialog-title">Confirmar</h3>
      <p id="app-dialog-message" class="modal-message"></p>
      <div class="modal-actions">
        <button type="button" class="btn" id="btn-app-dialog-cancel">Cancelar</button>
        <button type="button" class="btn btn-primary" id="btn-app-dialog-confirm">Aceptar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const title = overlay.querySelector('#app-dialog-title') as HTMLElement | null;
  const message = overlay.querySelector('#app-dialog-message') as HTMLElement | null;
  const cancelButton = overlay.querySelector('#btn-app-dialog-cancel') as HTMLButtonElement | null;
  const confirmButton = overlay.querySelector(
    '#btn-app-dialog-confirm',
  ) as HTMLButtonElement | null;
  if (!title || !message || !cancelButton || !confirmButton) return null;

  bindModalEvents(overlay, [cancelButton]);
  cancelButton.addEventListener('click', () => settleDialog(false));
  confirmButton.addEventListener('click', () => settleDialog(true));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      settleDialog(false);
    }
  });

  dialogElements = {
    overlay,
    title,
    message,
    cancelButton,
    confirmButton,
  };
  return dialogElements;
}

function settleDialog(value: boolean): void {
  if (!dialogElements) return;
  closeModal(dialogElements.overlay);
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(value);
}

function prepareDialog(
  message: string,
  options: DialogOptions,
  withCancel: boolean,
): DialogElements | null {
  const elements = ensureDialogElements();
  if (!elements) return null;

  if (pendingResolve) {
    const resolvePrevious = pendingResolve;
    pendingResolve = null;
    resolvePrevious(false);
  }

  elements.title.textContent = options.title ?? (withCancel ? 'Confirmar' : 'Aviso');
  elements.message.textContent = message;
  elements.cancelButton.style.display = withCancel ? '' : 'none';
  elements.cancelButton.textContent = options.cancelLabel ?? 'Cancelar';
  elements.confirmButton.textContent = options.confirmLabel ?? 'Aceptar';
  elements.confirmButton.classList.toggle('btn-danger', options.destructive === true);
  elements.confirmButton.classList.toggle('btn-primary', options.destructive !== true);
  openModal(elements.overlay);
  return elements;
}

export function showConfirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  const elements = prepareDialog(message, options, true);
  if (!elements) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
  });
}

export function showAlertDialog(message: string, options: DialogOptions = {}): Promise<void> {
  const elements = prepareDialog(message, options, false);
  if (!elements) return Promise.resolve();

  return new Promise<void>((resolve) => {
    pendingResolve = () => resolve();
  });
}
