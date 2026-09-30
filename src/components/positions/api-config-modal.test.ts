import { beforeEach, describe, expect, it, vi } from '#test';
import { createMemoryStorage, flushMicrotasks } from '../../test/test-utils';

const testApiConnectionMock = vi.fn();
const testBybitApiConnectionMock = vi.fn();
const saveLocalVaultCredentialMock = vi.fn();
const loadLocalVaultCredentialsMock = vi.fn();
const clearLocalVaultCredentialMock = vi.fn();

function createCryptoStub(): Crypto {
  return {
    getRandomValues: vi.fn((array: Uint8Array) => {
      array.fill(7);
      return array;
    }),
    subtle: {
      importKey: vi.fn().mockResolvedValue({}),
      deriveKey: vi.fn().mockResolvedValue({}),
      encrypt: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
      decrypt: vi.fn().mockResolvedValue(new TextEncoder().encode('decrypted-secret').buffer),
    },
  } as unknown as Crypto;
}

vi.mock('../../utils/binance-client', () => ({
  clearAllCaches: vi.fn(),
  testApiConnection: testApiConnectionMock,
}));

vi.mock('../../utils/bybit-client', () => ({
  clearBybitClientCaches: vi.fn(),
  testBybitApiConnection: testBybitApiConnectionMock,
}));

vi.mock('../../utils/binance-sync', () => ({
  clearBinanceSyncCaches: vi.fn(),
}));

vi.mock('../../utils/local-vault', () => ({
  clearLocalVaultCredential: clearLocalVaultCredentialMock,
  loadLocalVaultCredentials: loadLocalVaultCredentialsMock,
  saveLocalVaultCredential: saveLocalVaultCredentialMock,
}));

describe('api config modal', () => {
  beforeEach(() => {
    vi.resetModules();
    testApiConnectionMock.mockReset();
    testBybitApiConnectionMock.mockReset();
    saveLocalVaultCredentialMock.mockReset();
    saveLocalVaultCredentialMock.mockResolvedValue(true);
    loadLocalVaultCredentialsMock.mockReset();
    loadLocalVaultCredentialsMock.mockResolvedValue(null);
    clearLocalVaultCredentialMock.mockReset();
    clearLocalVaultCredentialMock.mockResolvedValue(undefined);
    document.body.innerHTML = '';
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: createCryptoStub(),
      configurable: true,
      writable: true,
    });
  });

  it('marks each exchange with its brand dot', async () => {
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    const names = [...document.querySelectorAll('.cfg-exchange-name')];

    expect(names.map((name) => name.textContent)).toEqual(['Binance', 'Bybit']);
    expect(names[0]?.querySelector('.provider-dot--binance')).not.toBeNull();
    expect(names[1]?.querySelector('.provider-dot--bybit')).not.toBeNull();
  });

  it('tests credentials without persisting them before save', async () => {
    testApiConnectionMock.mockResolvedValue({
      success: true,
      permissions: ['SPOT'],
      readOnly: true,
      permissionWarnings: [],
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    const keyInput = document.querySelector('#input-api-key') as HTMLInputElement;
    const secretInput = document.querySelector('#input-api-secret') as HTMLInputElement;
    keyInput.value = 'test-key';
    secretInput.value = 'test-secret';

    document.querySelector<HTMLButtonElement>('#btn-api-config-test')?.click();
    await Promise.resolve();

    expect(testApiConnectionMock).toHaveBeenCalledWith({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });
    expect(localStorage.getItem('crypto-binance-api')).toBeNull();
    expect(document.querySelector('#api-config-status')?.textContent).toContain('Conexión exitosa');
  });

  it('tests Bybit credentials without persisting them before save', async () => {
    testBybitApiConnectionMock.mockResolvedValue({
      success: true,
      readOnly: true,
      permissions: { Earn: ['Earn'] },
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    const keyInput = document.querySelector('#input-bybit-api-key') as HTMLInputElement;
    const secretInput = document.querySelector('#input-bybit-api-secret') as HTMLInputElement;
    keyInput.value = 'bybit-key';
    secretInput.value = 'bybit-secret';

    document.querySelector<HTMLButtonElement>('#btn-bybit-api-config-test')?.click();
    await Promise.resolve();

    expect(testBybitApiConnectionMock).toHaveBeenCalledWith({
      apiKey: 'bybit-key',
      apiSecret: 'bybit-secret',
    });
    expect(localStorage.getItem('crypto-bybit-api')).toBeNull();
    expect(document.querySelector('#api-config-status')?.textContent).toContain(
      'Conexión Bybit exitosa en modo solo lectura',
    );
  });

  it('saves Bybit credentials persistently in the local DPAPI vault', async () => {
    testBybitApiConnectionMock.mockResolvedValue({
      success: true,
      readOnly: true,
      permissions: { Earn: ['Earn'] },
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    const keyInput = document.querySelector('#input-bybit-api-key') as HTMLInputElement;
    const secretInput = document.querySelector('#input-bybit-api-secret') as HTMLInputElement;
    keyInput.value = 'bybit-key';
    secretInput.value = 'bybit-secret';

    document.querySelector<HTMLButtonElement>('#btn-api-config-save')?.click();
    await flushMicrotasks();

    const stored = JSON.parse(localStorage.getItem('crypto-bybit-api') ?? '{}') as {
      apiKey?: string;
      apiSecret?: string;
    };
    expect(saveLocalVaultCredentialMock).toHaveBeenCalledWith('bybit', {
      apiKey: 'bybit-key',
      apiSecret: 'bybit-secret',
    });
    expect(stored.apiKey).toBe('bybit-key');
    expect(stored.apiSecret).toBeUndefined();
    expect(Object.keys(stored)).toEqual(['apiKey']);
  });

  it('tests the credentials already in session when the form is left empty', async () => {
    // El campo de secret nunca se rellena: sin fallback a lo guardado, el boton
    // de probar seria inutilizable tras recargar la pagina.
    loadLocalVaultCredentialsMock.mockResolvedValue({
      binance: { apiKey: 'vault-key', apiSecret: 'vault-secret' },
      bybit: { apiKey: 'vault-bybit-key', apiSecret: 'vault-bybit-secret' },
    });
    testApiConnectionMock.mockResolvedValue({
      success: true,
      permissions: ['SPOT'],
      readOnly: true,
      permissionWarnings: [],
    });
    testBybitApiConnectionMock.mockResolvedValue({
      success: true,
      permissions: { Earn: ['Earn'] },
      readOnly: true,
      permissionWarnings: [],
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();

    expect((document.querySelector('#input-api-secret') as HTMLInputElement).value).toBe('');

    document.querySelector<HTMLButtonElement>('#btn-api-config-test')?.click();
    await flushMicrotasks();
    expect(testApiConnectionMock).toHaveBeenCalledWith({
      apiKey: 'vault-key',
      apiSecret: 'vault-secret',
    });

    document.querySelector<HTMLButtonElement>('#btn-bybit-api-config-test')?.click();
    await flushMicrotasks();
    expect(testBybitApiConnectionMock).toHaveBeenCalledWith({
      apiKey: 'vault-bybit-key',
      apiSecret: 'vault-bybit-secret',
    });
  });

  it('prefers what is typed in the form over the stored credentials', async () => {
    loadLocalVaultCredentialsMock.mockResolvedValue({
      binance: { apiKey: 'vault-key', apiSecret: 'vault-secret' },
    });
    testApiConnectionMock.mockResolvedValue({
      success: true,
      permissions: ['SPOT'],
      readOnly: true,
      permissionWarnings: [],
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();
    (document.querySelector('#input-api-key') as HTMLInputElement).value = 'typed-key';
    (document.querySelector('#input-api-secret') as HTMLInputElement).value = 'typed-secret';

    document.querySelector<HTMLButtonElement>('#btn-api-config-test')?.click();
    await flushMicrotasks();

    expect(testApiConnectionMock).toHaveBeenCalledWith({
      apiKey: 'typed-key',
      apiSecret: 'typed-secret',
    });
  });

  it('loads DPAPI credentials automatically on open, with no manual action', async () => {
    loadLocalVaultCredentialsMock.mockResolvedValue({
      binance: { apiKey: 'binance-key', apiSecret: 'binance-secret' },
      bybit: { apiKey: 'bybit-key', apiSecret: 'bybit-secret' },
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();

    expect(document.querySelector('#btn-api-vault-unlock')).toBeNull();
    expect(loadLocalVaultCredentialsMock).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('crypto-binance-api') ?? '{}')).toEqual({
      apiKey: 'binance-key',
    });
    expect(JSON.parse(localStorage.getItem('crypto-bybit-api') ?? '{}')).toEqual({
      apiKey: 'bybit-key',
    });
  });

  it('saves Bybit without asking for the existing Binance secret again', async () => {
    localStorage.setItem('crypto-binance-api', JSON.stringify({ apiKey: 'stored-binance-key' }));
    testBybitApiConnectionMock.mockResolvedValue({
      success: true,
      readOnly: true,
      permissions: { Earn: ['Earn'] },
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    const bybitKeyInput = document.querySelector('#input-bybit-api-key') as HTMLInputElement;
    const bybitSecretInput = document.querySelector('#input-bybit-api-secret') as HTMLInputElement;
    bybitKeyInput.value = 'bybit-key';
    bybitSecretInput.value = 'bybit-secret';

    document.querySelector<HTMLButtonElement>('#btn-api-config-save')?.click();
    await flushMicrotasks();

    expect(testApiConnectionMock).not.toHaveBeenCalled();
    expect(testBybitApiConnectionMock).toHaveBeenCalledWith({
      apiKey: 'bybit-key',
      apiSecret: 'bybit-secret',
    });
    expect(JSON.parse(localStorage.getItem('crypto-binance-api') ?? '{}')).toEqual({
      apiKey: 'stored-binance-key',
    });
    expect(JSON.parse(localStorage.getItem('crypto-bybit-api') ?? '{}')).toMatchObject({
      apiKey: 'bybit-key',
    });
  });

  it('saves Binance without asking for the existing Bybit secret again', async () => {
    localStorage.setItem('crypto-bybit-api', JSON.stringify({ apiKey: 'stored-bybit-key' }));
    testApiConnectionMock.mockResolvedValue({
      success: true,
      permissions: ['SPOT'],
      readOnly: true,
      permissionWarnings: [],
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    const keyInput = document.querySelector('#input-api-key') as HTMLInputElement;
    const secretInput = document.querySelector('#input-api-secret') as HTMLInputElement;
    keyInput.value = 'binance-key';
    secretInput.value = 'binance-secret';

    document.querySelector<HTMLButtonElement>('#btn-api-config-save')?.click();
    await flushMicrotasks();

    expect(testBybitApiConnectionMock).not.toHaveBeenCalled();
    expect(testApiConnectionMock).toHaveBeenCalledWith({
      apiKey: 'binance-key',
      apiSecret: 'binance-secret',
    });
    expect(JSON.parse(localStorage.getItem('crypto-bybit-api') ?? '{}')).toEqual({
      apiKey: 'stored-bybit-key',
    });
    expect(JSON.parse(localStorage.getItem('crypto-binance-api') ?? '{}')).toMatchObject({
      apiKey: 'binance-key',
    });
  });

  it('refuses to save Bybit credentials that are not read-only', async () => {
    testBybitApiConnectionMock.mockResolvedValue({
      success: true,
      readOnly: false,
      permissions: { ContractTrade: ['Order'] },
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    const keyInput = document.querySelector('#input-bybit-api-key') as HTMLInputElement;
    const secretInput = document.querySelector('#input-bybit-api-secret') as HTMLInputElement;
    keyInput.value = 'bybit-key';
    secretInput.value = 'bybit-secret';

    document.querySelector<HTMLButtonElement>('#btn-api-config-save')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(localStorage.getItem('crypto-bybit-api')).toBeNull();
    expect(document.querySelector('#api-config-status')?.textContent).toContain('readOnly: 1');
  });

  it('censors the stored secret instead of rendering it or leaving the field empty', async () => {
    localStorage.setItem('crypto-binance-api', JSON.stringify({ apiKey: 'stored-binance-key' }));
    localStorage.setItem('crypto-bybit-api', JSON.stringify({ apiKey: 'stored-bybit-key' }));
    loadLocalVaultCredentialsMock.mockResolvedValue({
      binance: { apiKey: 'stored-binance-key', apiSecret: 'real-binance-secret' },
      bybit: { apiKey: 'stored-bybit-key', apiSecret: 'real-bybit-secret' },
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();

    const binanceSecret = document.querySelector('#input-api-secret') as HTMLInputElement;
    const bybitSecret = document.querySelector('#input-bybit-api-secret') as HTMLInputElement;

    for (const input of [binanceSecret, bybitSecret]) {
      expect(input.disabled).toBe(true);
      expect(input.value).toBe('•'.repeat(12));
      expect(input.getAttribute('placeholder')).toBeNull();
    }

    const markup = document.querySelector('#modal-api-config')?.outerHTML ?? '';
    expect(markup).not.toContain('real-binance-secret');
    expect(markup).not.toContain('real-bybit-secret');
    expect(document.querySelectorAll('.chip-gain')).toHaveLength(2);
  });

  it('leaves the secret field editable and empty when nothing is stored', async () => {
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();

    const binanceSecret = document.querySelector('#input-api-secret') as HTMLInputElement;
    const bybitSecret = document.querySelector('#input-bybit-api-secret') as HTMLInputElement;

    for (const input of [binanceSecret, bybitSecret]) {
      expect(input.disabled).toBe(false);
      expect(input.value).toBe('');
      expect(input.getAttribute('placeholder')).toContain('API Secret');
    }

    expect(document.querySelectorAll('.chip-idle')).toHaveLength(2);
  });

  it('never sends the censored filler as a secret when testing the connection', async () => {
    localStorage.setItem('crypto-binance-api', JSON.stringify({ apiKey: 'stored-binance-key' }));
    loadLocalVaultCredentialsMock.mockResolvedValue({
      binance: { apiKey: 'stored-binance-key', apiSecret: 'real-binance-secret' },
    });
    testApiConnectionMock.mockResolvedValue({
      success: true,
      permissions: ['SPOT'],
      readOnly: true,
      permissionWarnings: [],
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();

    document.querySelector<HTMLButtonElement>('#btn-api-config-test')?.click();
    await flushMicrotasks();

    expect(testApiConnectionMock).toHaveBeenCalledWith({
      apiKey: 'stored-binance-key',
      apiSecret: 'real-binance-secret',
    });
  });

  it('saves invested and goal without any exchange configured', async () => {
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();
    (document.querySelector('#input-cfg-invested') as HTMLInputElement).value = '5,000.00';
    (document.querySelector('#input-cfg-goal') as HTMLInputElement).value = '9,000.00';

    document.querySelector<HTMLButtonElement>('#btn-api-config-save')?.click();
    await flushMicrotasks();

    expect(JSON.parse(localStorage.getItem('crypto-portfolio-tracker') ?? '{}')).toMatchObject({
      portfolio: { totalInvested: 5000, goalAmount: 9000 },
    });
    expect(document.querySelector('#modal-api-config')?.getAttribute('open')).toBeNull();
  });

  it('no longer offers a reading mode or an external savings field', async () => {
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();

    expect(document.querySelector('#mode-manual')).toBeNull();
    expect(document.querySelector('#mode-auto')).toBeNull();
    expect(document.querySelector('.mode-btn')).toBeNull();
    expect(document.querySelector('#cfg-savings-section')).toBeNull();
    expect(document.querySelector('#input-cfg-savings')).toBeNull();
    expect(document.querySelector('#modal-api-config')?.textContent).not.toContain('Modo');
  });

  it('keeps the stored secret untouched when the censored field is left alone on save', async () => {
    localStorage.setItem('crypto-binance-api', JSON.stringify({ apiKey: 'stored-binance-key' }));
    localStorage.setItem('crypto-bybit-api', JSON.stringify({ apiKey: 'stored-bybit-key' }));
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();
    (document.querySelector('#input-cfg-invested') as HTMLInputElement).value = '5000';

    document.querySelector<HTMLButtonElement>('#btn-api-config-save')?.click();
    await flushMicrotasks();

    expect(testApiConnectionMock).not.toHaveBeenCalled();
    expect(testBybitApiConnectionMock).not.toHaveBeenCalled();
    expect(saveLocalVaultCredentialMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('crypto-binance-api') ?? '{}')).toEqual({
      apiKey: 'stored-binance-key',
    });
    expect(JSON.parse(localStorage.getItem('crypto-bybit-api') ?? '{}')).toEqual({
      apiKey: 'stored-bybit-key',
    });
  });

  it('points at Eliminar credenciales when the API key changes while the secret is censored', async () => {
    localStorage.setItem('crypto-binance-api', JSON.stringify({ apiKey: 'stored-binance-key' }));
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();
    (document.querySelector('#input-api-key') as HTMLInputElement).value = 'another-key';

    document.querySelector<HTMLButtonElement>('#btn-api-config-save')?.click();
    await flushMicrotasks();

    expect(saveLocalVaultCredentialMock).not.toHaveBeenCalled();
    expect(document.querySelector('#api-config-status')?.textContent).toContain(
      'Elimina las credenciales',
    );
  });

  it('no longer ships the JSON backup section', async () => {
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    await flushMicrotasks();

    expect(document.querySelector('#btn-export')).toBeNull();
    expect(document.querySelector('#backup-file-input')).toBeNull();
    expect(document.querySelector('#backup-file-name')).toBeNull();
    expect(document.querySelector('#modal-api-config')?.textContent).not.toContain('Respaldo');
  });

  it('refuses partial Binance credentials before changing persisted state', async () => {
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    const keyInput = document.querySelector('#input-api-key') as HTMLInputElement;
    const investedInput = document.querySelector('#input-cfg-invested') as HTMLInputElement;
    keyInput.value = 'binance-key';
    investedInput.value = '123';

    document.querySelector<HTMLButtonElement>('#btn-api-config-save')?.click();
    await Promise.resolve();

    expect(localStorage.getItem('crypto-binance-api')).toBeNull();
    expect(localStorage.getItem('crypto-portfolio-tracker')).toBeNull();
    expect(document.querySelector('#api-config-status')?.textContent).toContain(
      'API Key y Secret son requeridos',
    );
  });
});
