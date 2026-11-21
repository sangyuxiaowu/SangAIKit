declare module 'bun:test' {
  export function test(name: string, fn: () => unknown | Promise<unknown>): void;
  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toContainEqual(expected: unknown): void;
    toMatch(expected: RegExp | string): void;
    toMatchObject(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toHaveLength(expected: number): void;
    toHaveProperty(key: string, value?: unknown): void;
    toBeTruthy(): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toThrow(expected?: string | RegExp): void;
    not: Matchers;
    rejects: Matchers;
  }
  export function expect(actual: unknown): Matchers;
}

declare namespace fetch {
  var preconnect: ((url: string | URL) => void) | undefined;
}
