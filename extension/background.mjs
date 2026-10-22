import { createDiningTransport } from './lib/transport.mjs';
import { DiningSession } from './lib/dining-session.mjs';
import { createMessageHandler } from './lib/background-bridge.mjs';

const api = globalThis.browser ?? globalThis.chrome;
const session = new DiningSession({ transport: createDiningTransport() });

api.action.onClicked.addListener(() => {
  api.tabs.create({ url: api.runtime.getURL('planner.html') });
});

api.runtime.onMessage.addListener(createMessageHandler(api, session));

