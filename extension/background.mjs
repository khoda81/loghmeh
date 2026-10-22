import { createReadTransport, HOST_PERMISSION, ProbeError, publicError } from './lib/transport.mjs';

const api = globalThis.browser ?? globalThis.chrome;
const transport = createReadTransport();

api.action.onClicked.addListener(() => {
  api.tabs.create({ url: api.runtime.getURL('planner.html') });
});

api.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== api.runtime.id
      || sender.url?.split(/[?#]/u)[0] !== api.runtime.getURL('probe.html')
      || message?.type !== 'loghmeh:read') return false;

  (async () => {
    if (!await api.permissions.contains({ origins: [HOST_PERMISSION] })) {
      throw new ProbeError('permission-required', 'Allow Loghmeh to access the dining website first.');
    }
    const result = await transport.read(message.operation, message.parameters);
    return { ok: true, ...result };
  })().then(reply, error => reply({ ok: false, error: publicError(error) }));
  return true;
});

