import { iconDownload, iconUpload } from '../utils/icons';
import { exportBackup, importBackup } from '../utils/storage';
import { todayISODateLocal } from '../utils/date';
import { bindModalEvents, openModal, closeModal } from '../utils/modal-manager';
import { showAlertDialog } from '../utils/dialogs';

export function renderBackupSection(): string {
  return `
    <div class="backup-panel">
      <div class="backup-panel-copy">
        <div class="backup-panel-title">Respaldo de datos</div>
        <p class="text-muted">
          Exporta un JSON completo o restaura uno existente sin salir del flujo actual.
        </p>
      </div>
      <div class="backup-body">
        <button type="button" class="btn btn-primary" id="btn-export">${iconDownload(15)}Exportar JSON</button>
        <div class="backup-import-section">
          <label class="backup-import-label text-secondary" for="backup-file-input">
            ${iconUpload(14)}Importar backup JSON
          </label>
          <div class="backup-import-control">
            <label class="backup-import-trigger btn" for="backup-file-input">Seleccionar archivo</label>
            <span class="backup-file-name text-muted" id="backup-file-name">Ningún archivo seleccionado</span>
          </div>
          <input
            type="file"
            id="backup-file-input"
            accept=".json"
            class="backup-file-input"
            aria-describedby="backup-file-name"
          >
        </div>
      </div>
    </div>
  `;
}

export function renderBackupModal(): string {
  return `
    <dialog id="modal-backup" class="modal-overlay">
      <div class="modal">
        <h3 class="modal-title">Backup de datos</h3>
        ${renderBackupSection()}
        <div class="modal-actions">
          <button type="button" class="btn" id="btn-close-backup">Cerrar</button>
        </div>
      </div>
    </dialog>
  `;
}

export function bindBackupControls(root: ParentNode, onImportSuccess: () => void): void {
  root.querySelector('#btn-export')?.addEventListener('click', () => {
    const json = exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crypto-tracker-backup-${todayISODateLocal()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const fileInput = root.querySelector('#backup-file-input') as HTMLInputElement | null;
  const fileName = root.querySelector('#backup-file-name') as HTMLElement | null;

  const resetSelectedFile = () => {
    if (fileName) fileName.textContent = 'Ningún archivo seleccionado';
  };

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      resetSelectedFile();
      return;
    }

    if (fileName) fileName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        importBackup(json);
        onImportSuccess();
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[backup] import failed', err);
        }
        void showAlertDialog('Error al importar el archivo. Asegúrate de que sea un JSON válido.');
      } finally {
        fileInput.value = '';
        resetSelectedFile();
      }
    };
    reader.readAsText(file);
  });
}

export function bindBackupEvents(app: HTMLElement, onStateChange: () => void): void {
  const modal = app.querySelector('#modal-backup') as HTMLElement;

  bindModalEvents(modal, [app.querySelector('#btn-close-backup') as HTMLElement]);

  app.querySelector('#btn-backup')?.addEventListener('click', () => {
    openModal(modal);
  });

  bindBackupControls(app, () => {
    closeModal(modal);
    onStateChange();
  });
}
