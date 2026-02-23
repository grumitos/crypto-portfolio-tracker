import { iconDownload, iconUpload } from '../utils/icons';
import { exportBackup, importBackup } from '../utils/storage';
import { todayISODateLocal } from '../utils/date';
import { bindModalEvents, openModal, closeModal } from '../utils/modal-manager';

export function renderBackupModal(): string {
    return `
    <div id="modal-backup" class="modal-overlay" style="display:none">
      <div class="modal">
        <h3 class="modal-title">Backup de datos</h3>
        <div style="display:flex;flex-direction:column;gap:var(--space-md)">
          <button class="btn btn-primary" id="btn-export">${iconDownload(15)}Exportar JSON</button>
          <div style="border-top:1px solid var(--border);padding-top:var(--space-md)">
            <label class="text-secondary" style="font-size:0.8rem;display:flex;align-items:center;gap:6px;margin-bottom:var(--space-sm)">
              ${iconUpload(14)}Importar backup JSON
            </label>
            <input type="file" id="backup-file-input" accept=".json" style="font-size:0.8rem;color:var(--text-secondary)">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="btn-close-backup">Cerrar</button>
        </div>
      </div>
    </div>
  `;
}

export function bindBackupEvents(app: HTMLElement, onStateChange: () => void): void {
    const modal = app.querySelector('#modal-backup') as HTMLElement;

    bindModalEvents(modal, [app.querySelector('#btn-close-backup') as HTMLElement]);

    app.querySelector('#btn-backup')?.addEventListener('click', () => {
        openModal(modal);
    });

    app.querySelector('#btn-export')?.addEventListener('click', () => {
        const json = exportBackup();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crypto-tracker-backup-${todayISODateLocal()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    const fileInput = app.querySelector('#backup-file-input') as HTMLInputElement;
    fileInput?.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = e.target?.result as string;
                importBackup(json);
                closeModal(modal);
                onStateChange();
            } catch {
                alert('Error al importar el archivo. Asegurate de que sea un JSON valido.');
            }
        };
        reader.readAsText(file);
    });
}
