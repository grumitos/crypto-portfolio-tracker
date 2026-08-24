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

  it('allows Auto mode with only Bybit credentials when they are read-only', async () => {
    testBybitApiConnectionMock.mockResolvedValue({
      success: true,
      readOnly: true,
      permissions: { Earn: ['Earn'] },
    });
    const { openApiConfigModal } = await import('./api-config-modal');

    openApiConfigModal();
    document.querySelector<HTMLButtonElement>('#mode-auto')?.click();
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
    expect(stored.apiKey).toBe('bybit-key');
    expect(stored.apiSecret).toBeUndefined();
    expect(Object.keys(stored)).toEqual(['apiKey']);
    const rawState = localStorage.getItem('crypto-portfolio-tracker');
    expect(rawState).not.toBeNull();
    expect(JSON.parse(rawState ?? '{}')).toMatchObject({
      positionsConfig: { mode: 'auto' },
    });
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
    const rawState = localStorage.getItem('crypto-portfolio-tracker');
    expect(rawState).not.toBeNull();
    expect(JSON.parse(rawState ?? '{}')).toMatchObject({
      portfolio: { totalInvested: 0 },
      positionsConfig: { mode: 'manual' },
    });
    expect(document.querySelector('#api-config-status')?.textContent).toContain(
      'API Key y Secret son requeridos',
    );
  });
});
