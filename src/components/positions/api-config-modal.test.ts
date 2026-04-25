import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../test/test-utils';

const testApiConnectionMock = vi.fn();

vi.mock('../../utils/binance-client', () => ({
  clearAllCaches: vi.fn(),
  testApiConnection: testApiConnectionMock,
}));

describe('api config modal', () => {
  beforeEach(() => {
    vi.resetModules();
    testApiConnectionMock.mockReset();
    document.body.innerHTML = '';
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it('tests credentials without persisting them before save', async () => {
    testApiConnectionMock.mockResolvedValue({ success: true, permissions: ['SPOT'] });
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
});
