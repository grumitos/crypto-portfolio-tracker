import { beforeEach, describe, expect, it, vi } from '#test';

async function loadDialogs() {
  vi.resetModules();
  return import('./dialogs');
}

function getDialogRoot(): HTMLElement {
  const root = document.getElementById('modal-app-dialog') as HTMLElement | null;
  if (!root) throw new Error('dialog root not found');
  return root;
}

describe('dialogs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves true when confirm dialog is accepted', async () => {
    const dialogs = await loadDialogs();
    const pending = dialogs.showConfirmDialog('Continuar?', {
      title: 'Confirmar accion',
      confirmLabel: 'Si, continuar',
      cancelLabel: 'No',
      destructive: true,
    });

    const root = getDialogRoot();
    const confirmBtn = root.querySelector('#btn-app-dialog-confirm') as HTMLButtonElement;
    expect(confirmBtn.textContent).toBe('Si, continuar');
    expect(confirmBtn.classList.contains('btn-danger')).toBe(true);
    expect((root.querySelector('#btn-app-dialog-cancel') as HTMLElement).style.display).toBe('');

    confirmBtn.click();
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false when confirm dialog is cancelled', async () => {
    const dialogs = await loadDialogs();
    const pending = dialogs.showConfirmDialog('Cancelar flujo?');
    const root = getDialogRoot();

    (root.querySelector('#btn-app-dialog-cancel') as HTMLButtonElement).click();
    await expect(pending).resolves.toBe(false);
  });

  it('resolves false when confirm dialog is closed from overlay click', async () => {
    const dialogs = await loadDialogs();
    const pending = dialogs.showConfirmDialog('Cerrar por overlay?');
    const root = getDialogRoot();

    root.click();
    await expect(pending).resolves.toBe(false);
  });

  it('closes previous pending dialog when opening a new one', async () => {
    const dialogs = await loadDialogs();
    const first = dialogs.showConfirmDialog('Primero');
    const second = dialogs.showConfirmDialog('Segundo');
    const root = getDialogRoot();

    await expect(first).resolves.toBe(false);
    (root.querySelector('#btn-app-dialog-confirm') as HTMLButtonElement).click();
    await expect(second).resolves.toBe(true);
  });
});
