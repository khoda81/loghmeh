import { createDiningTransport } from './lib/transport.ts';
import { DiningSession } from './lib/dining-session.ts';
import { createMessageHandler } from './lib/background-bridge.ts';
import { createOffscreenParsers } from './lib/offscreen-parsers.ts';

const api = (globalThis.browser ?? globalThis.chrome)!;
// Firefox's background page parses directly; Chrome's service worker has no DOM.
const parsers = typeof DOMParser === 'undefined' ? createOffscreenParsers(api) : {};
const session = new DiningSession({ transport: createDiningTransport(), ...parsers });

api.action!.onClicked.addListener(() => {
  api.tabs.create({ url: api.runtime.getURL('planner.html') });
});

api.runtime.onMessage!.addListener(createMessageHandler(api, session));

