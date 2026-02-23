/**
 * Helper to bind common modal events: click outside to close, and explicit close buttons.
 */
export function bindModalEvents(
    modal: HTMLElement | null,
    closeElements: (HTMLElement | null)[],
): void {
    if (!modal) return;

    const close = () => {
        modal.style.display = 'none';
    };

    closeElements.forEach(el => {
        el?.addEventListener('click', close);
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
}

/**
 * Opens a modal.
 */
export function openModal(modal: HTMLElement | null): void {
    if (modal) modal.style.display = 'flex';
}

/**
 * Closes a modal.
 */
export function closeModal(modal: HTMLElement | null): void {
    if (modal) modal.style.display = 'none';
}
