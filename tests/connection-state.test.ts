import { expect, test } from 'bun:test';
import { ConnectionController } from '../src/lib/connection-state.ts';
import { ProbeError } from '../src/lib/transport.ts';

test('a retry starts a fresh connection while concurrent clicks share the current attempt', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const connection = new ConnectionController({
    connect: async () => { if (++calls === 1) { await gate; throw new ProbeError('redirect-required', 'Dining redirected.'); } return { writable: true, writeReason: '' }; },
    openDining: async () => {}, changed() {},
  });
  const first = connection.check();
  expect(connection.state.phase).toBe('checking');
  expect(connection.check()).toBe(first);
  release();
  await first;
  expect(connection.state.phase).toBe('redirect');
  expect(connection.state.checkedAt).not.toBeNull();
  await connection.check(true);
  expect(calls).toBe(2);
  expect(connection.state.phase).toBe('connected');
});

test('returning from dining checks once, without opening another tab or requesting permission automatically', async () => {
  const interactive: boolean[] = [];
  let opened = 0;
  const connection = new ConnectionController({
    connect: async value => { interactive.push(value); return { writable: true, writeReason: '' }; },
    openDining: async () => { opened++; }, changed() {},
  });
  await connection.openDining();
  expect(connection.state.phase).toBe('waiting');
  const returned = connection.returned();
  connection.returned();
  await returned;
  expect(interactive).toEqual([false]);
  expect(opened).toBe(1);
  expect(connection.state.phase).toBe('connected');
  connection.returned();
  expect(interactive).toEqual([false]);
});

test('failed checks do not poll, and a manual check consumes a pending return check', async () => {
  let calls = 0;
  const connection = new ConnectionController({
    connect: async () => { calls++; throw new ProbeError('network-error', 'Cannot reach dining.'); },
    openDining: async () => {}, changed() {},
  });
  await connection.openDining();
  await connection.check(true);
  expect(connection.returned()).toBeUndefined();
  expect(connection.state.phase).toBe('network');
  expect(calls).toBe(1);
});

test('read-only, confirmed login failure, missing access and failed tab opening are distinct', async () => {
  for (const [code, phase] of [['login-required', 'login'], ['redirect-required', 'redirect'], ['permission-required', 'permission'], ['server-error', 'server'], ['timeout', 'timeout']] as const) {
    const connection = new ConnectionController({ connect: async () => { throw new ProbeError(code, 'Predefined message.'); }, openDining: async () => {}, changed() {} });
    await connection.check();
    expect(connection.state.phase).toBe(phase);
  }
  const connection = new ConnectionController({ connect: async () => ({ writable: false, writeReason: 'Multiple wallets.' }), openDining: async () => { throw new Error('private details'); }, changed() {} });
  await connection.check();
  expect(connection.state.phase).toBe('read-only');
  await connection.openDining();
  expect(connection.state.phase).toBe('error');
  expect(connection.state.message).not.toContain('private');
  expect(connection.returned()).toBeUndefined();
});

test('an old menu error cannot overwrite checking or waiting for the dining tab', async () => {
  const connection = new ConnectionController({ connect: async () => ({ writable: true, writeReason: '' }), openDining: async () => {}, changed() {} });
  await connection.check();
  connection.invalidate('redirect-required', 'Dining redirected.');
  expect(connection.state.phase).toBe('redirect');
  await connection.openDining();
  connection.invalidate('login-required', 'An older menu failed.');
  expect(connection.state.phase).toBe('waiting');
});

test('connection errors report each attempt once and opening failures report a safe message', async () => {
  const failures: { message: string; code?: string }[] = [];
  const connection = new ConnectionController({
    connect: async () => { throw new ProbeError('network-error', 'Cannot reach dining.'); },
    openDining: async () => { throw new Error('private browser exception'); }, changed() {},
    onError: failure => failures.push(failure),
  });
  const first = connection.check();
  connection.check();
  await first;
  expect(failures).toEqual([{ code: 'network-error', message: 'Cannot reach dining.' }]);
  await connection.check(true);
  expect(failures).toHaveLength(2);
  await connection.openDining();
  expect(failures[2].message).toBe('The dining tab could not be opened. Try opening it again.');
});

test('read-only save verification can restore a previously invalidated connection state', async () => {
  let calls = 0;
  const connection = new ConnectionController({ connect: async () => { calls++; return { writable: true, writeReason: '' }; }, openDining: async () => {}, changed() {} });
  await connection.check();
  connection.invalidate('save-unknown', 'The extension lost the save reply.');
  expect(connection.state.phase).toBe('error');
  connection.verified({ writable: true, writeReason: '' });
  expect(connection.state.phase).toBe('connected');
  expect(connection.state.code).toBeUndefined();
  expect(calls).toBe(1);
});
