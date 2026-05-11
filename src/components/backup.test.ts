import { beforeEach, describe, expect, it, vi } from '#test';

const backupMocks = vi.hoisted(() => ({
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
  todayISODateLocal: vi.fn(),
  bindModalEvents: vi.fn(),
  openModal: vi.fn(),
  closeModal: vi.fn(),
  showAlertDialog: vi.fn(),
}));

vi.mock('../utils/storage', () => ({
  exportBackup: backupMocks.exportBackup,
  importBackup: backupMocks.importBackup,
}));

vi.mock('../utils/date', () => ({
  todayISODateLocal: backupMocks.todayISODateLocal,
}));

vi.mock('../utils/modal-manager', () => ({
  bindModalEvents: backupMocks.bindModalEvents,
  openModal: backupMocks.openModal,
  closeModal: backupMocks.closeModal,
}));

vi.mock('../utils/dialogs', () => ({
  showAlertDialog: backupMocks.showAlertDialog,
}));

import { bindBackupEvents, renderBackupModal } from './backup';

function setupAppShell(): HTMLElement {
  const app = document.createElement('div');
  app.innerHTML = `
    <button id="btn-backup">Backup</button>
    ${renderBackupModal()}
  `;
  document.body.appendChild(app);
  return app;
}

describe('backup modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    backupMocks.exportBackup.mockReset();
    backupMocks.importBackup.mockReset();
    backupMocks.todayISODateLocal.mockReset();
    backupMocks.bindModalEvents.mockReset();
    backupMocks.openModal.mockReset();
    backupMocks.closeModal.mockReset();
    backupMocks.showAlertDialog.mockReset();

    backupMocks.exportBackup.mockReturnValue('{"version":2}');
    backupMocks.todayISODateLocal.mockReturnValue('2026-02-28');
  });

  it('renders modal markup with expected controls', () => {
    const html = renderBackupModal();
    expect(html).toContain('id="modal-backup"');
    expect(html).toContain('id="btn-export"');
    expect(html).toContain('id="backup-file-input"');
  });

  it('binds open/close modal handlers', () => {
    const app = setupAppShell();
    const onStateChange = vi.fn();

    bindBackupEvents(app, onStateChange);
    (app.querySelector('#btn-backup') as HTMLButtonElement).click();

    expect(backupMocks.bindModalEvents).toHaveBeenCalledTimes(1);
    expect(backupMocks.openModal).toHaveBeenCalledTimes(1);
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('exports json as downloadable file', () => {
    const app = setupAppShell();
    bindBackupEvents(app, vi.fn());

    const createObjectURL = vi.fn(() => 'blob:test-url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    (app.querySelector('#btn-export') as HTMLButtonElement).click();

    expect(backupMocks.exportBackup).toHaveBeenCalledTimes(1);
    expect(backupMocks.todayISODateLocal).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');

    clickSpy.mockRestore();
  });

  it('imports backup and refreshes state on successful file read', () => {
    const app = setupAppShell();
    const onStateChange = vi.fn();
    bindBackupEvents(app, onStateChange);

    class MockFileReader {
      onload: ((event: { target: { result: string } }) => void) | null = null;

      readAsText(_file: Blob): void {
        this.onload?.({ target: { result: '{"app":{"positions":[]}}' } });
      }
    }

    Object.defineProperty(globalThis, 'FileReader', {
      value: MockFileReader,
      configurable: true,
      writable: true,
    });

    const input = app.querySelector('#backup-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['{}'], 'backup.json', { type: 'application/json' })],
      configurable: true,
    });

    input.dispatchEvent(new Event('change'));

    expect(backupMocks.importBackup).toHaveBeenCalledWith('{"app":{"positions":[]}}');
    expect(backupMocks.closeModal).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it('alerts the user when import fails', () => {
    backupMocks.importBackup.mockImplementation(() => {
      throw new Error('invalid backup');
    });

    const app = setupAppShell();
    bindBackupEvents(app, vi.fn());

    class MockFileReader {
      onload: ((event: { target: { result: string } }) => void) | null = null;

      readAsText(_file: Blob): void {
        this.onload?.({ target: { result: '{bad-json' } });
      }
    }

    Object.defineProperty(globalThis, 'FileReader', {
      value: MockFileReader,
      configurable: true,
      writable: true,
    });

    const input = app.querySelector('#backup-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['{bad-json'], 'backup.json', { type: 'application/json' })],
      configurable: true,
    });

    input.dispatchEvent(new Event('change'));

    expect(backupMocks.showAlertDialog).toHaveBeenCalledTimes(1);
    expect(backupMocks.closeModal).not.toHaveBeenCalled();
  });

  it('rejects non-json backup files before reading', () => {
    const app = setupAppShell();
    bindBackupEvents(app, vi.fn());

    const readAsText = vi.fn();
    Object.defineProperty(globalThis, 'FileReader', {
      value: class {
        readAsText = readAsText;
      },
      configurable: true,
      writable: true,
    });

    const input = app.querySelector('#backup-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['{}'], 'backup.txt', { type: 'text/plain' })],
      configurable: true,
    });

    input.dispatchEvent(new Event('change'));

    expect(readAsText).not.toHaveBeenCalled();
    expect(backupMocks.importBackup).not.toHaveBeenCalled();
    expect(backupMocks.showAlertDialog).toHaveBeenCalledWith(
      'Selecciona un archivo JSON de backup.',
    );
  });

  it('rejects oversized backup files before reading', () => {
    const app = setupAppShell();
    bindBackupEvents(app, vi.fn());

    const readAsText = vi.fn();
    Object.defineProperty(globalThis, 'FileReader', {
      value: class {
        readAsText = readAsText;
      },
      configurable: true,
      writable: true,
    });

    const input = app.querySelector('#backup-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'backup.json')],
      configurable: true,
    });

    input.dispatchEvent(new Event('change'));

    expect(readAsText).not.toHaveBeenCalled();
    expect(backupMocks.importBackup).not.toHaveBeenCalled();
    expect(backupMocks.showAlertDialog).toHaveBeenCalledWith('El backup supera el límite de 2 MB.');
  });

  it('does nothing when change event has no selected file', () => {
    const app = setupAppShell();
    bindBackupEvents(app, vi.fn());

    const input = app.querySelector('#backup-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [],
      configurable: true,
    });

    input.dispatchEvent(new Event('change'));
    expect(backupMocks.importBackup).not.toHaveBeenCalled();
  });
});
