// Test doubles implement only what the code under test calls.
export const fake = <T>(value: unknown) => value as T;
