import { vi as bunVi } from 'bun:test';
import type { Mock } from 'bun:test';

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  jest,
  mock,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test';
export type { Mock } from 'bun:test';

type BunVi = typeof bunVi;
type MockedValue<T> = T extends (...args: infer Args) => infer Result
  ? Mock<(...args: Args) => Result>
  : T;

interface BunTestCompatVi extends BunVi {
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  hoisted<T>(factory: () => T): T;
  mocked<T>(value: T): MockedValue<T>;
  resetModules(): void;
  setSystemTime(date?: Date | number | string): void;
  stubGlobal(name: PropertyKey, value: unknown): void;
  unstubAllGlobals(): void;
}

export const vi = bunVi as BunTestCompatVi;
