import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildReadRequest, createReadTransport, publicError, ProbeError } from '../extension/lib/transport.ts';
import { fake } from './fake.ts';

test('the transport cannot be redirected to writes or arbitrary URLs', () => {
  for (const operation of ['save', 'Index', '/Reserves/Index', 'https://example.com', '__proto__', 'toString']) {
    assert.throws(() => buildReadRequest(operation), { code: 'invalid-request' });
  }
  assert.throws(() => buildReadRequest('menu', { personGroupId: 10, restId: 20, DataId: ['anything'] }), { code: 'invalid-request' });
  for (const id of ['../Index', '1&DataId=x', 0, -1, undefined, {}, '01']) {
    assert.throws(() => buildReadRequest('menu', { personGroupId: id, restId: 20 }), { code: 'invalid-request' });
  }
});

test('authenticated reads use browser credentials and do not follow SSO redirects', async () => {
  const observed = [];
  const client = createReadTransport(async (url, init) => {
    observed.push({ url, init });
    return new Response('<html>ok</html>', { status: 200 });
  });
  await client.read('menu', { personGroupId: 10, restId: 20 });
  assert.equal(observed[0].url, 'https://dining2.ut.ac.ir/Reserves/GetReservePage');
  assert.equal(observed[0].init.credentials, 'include');
  assert.equal(observed[0].init.redirect, 'manual');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(observed[0].init.body)), { personGroupId: '10', restId: '20', isKiosk: 'false' });
});

test('logged-out redirects are recognized without reading the login page', async () => {
  let bodyRead = false;
  const client = createReadTransport(async () => fake({ status: 0, type: 'opaqueredirect', text() { bodyRead = true; } }));
  await assert.rejects(client.read('bootstrap'), { code: 'login-required' });
  assert.equal(bodyRead, false);
});

test('server errors are not retried or mistaken for authentication', async () => {
  let calls = 0;
  const client = createReadTransport(async () => { calls++; return new Response('private server error', { status: 500 }); });
  await assert.rejects(client.read('bootstrap'), (error: ProbeError) => {
    assert.equal(error.code, 'server-error');
    assert.equal(error.diagnostic.status, 500);
    assert.equal(error.diagnostic.path, '/Reserves');
    assert.equal(typeof error.diagnostic.elapsedMs, 'number');
    assert.equal(error.message.includes('private'), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('reads are serialized, and a failed request does not stop later reads', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const client = createReadTransport(async () => {
    calls++;
    if (calls === 1) { await gate; throw new TypeError('sensitive implementation details'); }
    return new Response('ok');
  });
  const first = client.read('bootstrap');
  const second = client.read('bootstrap');
  const firstCheck = assert.rejects(first, { code: 'network-error' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await firstCheck;
  assert.equal((await second).body, 'ok');
  assert.equal(calls, 2);
});

test('timeouts abort without automatic retries', async () => {
  const client = createReadTransport((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }), { timeoutMs: 10 });
  await assert.rejects(client.read('bootstrap'), { code: 'timeout' });
});

test('diagnostics never forward arbitrary exception messages or stacks', () => {
  const result = publicError(new Error('cookie=PRIVATE; token=SECRET'));
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal('stack' in result, false);
  assert.equal(publicError(new ProbeError('login-required', 'Sign in.')).code, 'login-required');
});
