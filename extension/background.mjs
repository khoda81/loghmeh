import { createDiningTransport } from './lib/transport.mjs';
import { DiningSession } from './lib/dining-session.mjs';
import { createMessageHandler } from './lib/background-bridge.mjs';
import { createOffscreenParsers } from './lib/offscreen-parsers.mjs';

const api = globalThis.browser ?? globalThis.chrome;
// Firefox's background page parses directly; Chrome's service worker has no DOM.
const parsers = typeof DOMParser === 'undefined' ? createOffscreenParsers(api) : {};
const session = new DiningSession({ transport: createDiningTransport(), ...parsers });

api.action.onClicked.addListener(() => {
  api.tabs.create({ url: api.runtime.getURL('planner.html') });
});

api.runtime.onMessage.addListener(createMessageHandler(api, session));

