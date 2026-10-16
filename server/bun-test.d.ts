declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(
    name: string,
    fn: () => void | Promise<void>,
    timeout?: number,
  ): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeDefined(): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toContain(expected: unknown): void;
    rejects: {
      toThrow(): Promise<void>;
    };
  };
}
