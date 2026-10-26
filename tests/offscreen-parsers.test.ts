import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createOffscreenParsers } from '../src/lib/offscreen-parsers.ts';
import { ProbeError } from '../src/lib/transport.ts';
import { fake } from './fake.ts';

function fakeChrome(answer) {
  const calls = { created: 0, messages: [], options: undefined };
  let open = false;
  const api = {
    runtime: {
      getURL: path => `chrome-extension://loghmeh/${path}`,
      getContexts: async () => open ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [],
      sendMessage: async message => { calls.messages.push(message); return answer(message, () => { open = false; }); },
    },
    offscreen: { createDocument: async options => { calls.created++; calls.options = options; open = true; } },
  };
  return { api, calls };
}

test('Chrome parsing opens one offscreen document and forwards the page and restaurant', async () => {
  const { api, calls } = fakeChrome(message => ({ ok: true, value: { parser: message.parser, length: message.html.length } }));
  const { bootstrapParser, menuParser } = createOffscreenParsers(api);
  const [bootstrap, menu] = await Promise.all([bootstrapParser('<html>'), menuParser('<p>', fake({ id: '1:2' }))]);
  assert.deepEqual(bootstrap, { parser: 'bootstrap', length: 6 });
  assert.deepEqual(menu, { parser: 'menu', length: 3 });
  assert.equal(calls.created, 1);
  assert.equal(calls.options.url, 'chrome-extension://loghmeh/offscreen.html');
  assert.deepEqual(calls.options.reasons, ['DOM_PARSER']);
  assert.deepEqual(calls.messages[1], { type: 'loghmeh:parse', parser: 'menu', html: '<p>', restaurant: { id: '1:2' } });
});

test('parser errors keep their public code, and a closed reader is reopened', async () => {
  let attempt = 0;
  const { api, calls } = fakeChrome((message, close) => {
    attempt++;
    if (attempt === 1) return { ok: false, error: { code: 'login-required', message: 'Sign in.' } };
    if (attempt === 2) { close(); throw new Error('Receiving end does not exist.'); }
    return { ok: true, value: 'parsed' };
  });
  const { bootstrapParser } = createOffscreenParsers(api);
  await assert.rejects(bootstrapParser('<html>'), (error: unknown) => error instanceof ProbeError && error.code === 'login-required' && error.message === 'Sign in.');
  await assert.rejects(bootstrapParser('<html>'), (error: unknown) => error instanceof ProbeError && error.code === 'unexpected-error');
  assert.equal(await bootstrapParser('<html>'), 'parsed');
  assert.equal(calls.created, 2);
});
