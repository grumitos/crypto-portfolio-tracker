function isNativeDialog(el: HTMLElement): el is HTMLDialogElement {
  return el.tagName === 'DIALOG' && typeof (el as HTMLDialogElement).showModal === 'function';
}

/**
 * Helper to bind common modal events: click outside to close, and explicit close buttons.
 * For <dialog> elements, Escape-to-close is handled natively.
 */
export function bindModalEvents(
  modal: HTMLElement | null,
  closeElements: (HTMLElement | null)[],
): void {
  if (!modal) return;

  const close = () => closeModal(modal);

  closeElements.forEach((el) => {
    el?.addEventListener('click', close);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
}

/**
 * Opens a modal. Uses showModal() for <dialog> elements (provides focus trap + Escape).
 * Falls back to display:flex for environments without native dialog support.
 */
export function openModal(modal: HTMLElement | null): void {
  if (!modal) return;
  if (isNativeDialog(modal)) {
    if (!modal.open) modal.showModal();
  } else {
    modal.style.display = 'flex';
  }
}

/**
 * Closes a modal. Uses close() for <dialog> elements.
 * Falls back to display:none for environments without native dialog support.
 */
export function closeModal(modal: HTMLElement | null): void {
  if (!modal) return;
  if (isNativeDialog(modal)) {
    if (modal.open) modal.close();
  } else {
    modal.style.display = 'none';
  }
}
