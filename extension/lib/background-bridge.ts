import { HOST_PERMISSION, ProbeError, publicError } from './transport.ts';
import type { DiningSession } from './dining-session.ts';
import type { ExtensionApi, MessageListener, RuntimeApi } from './types.ts';

export function createMessageHandler(api: RuntimeApi<'id' | 'getURL'> & { permissions: Pick<ExtensionApi['permissions'], 'contains'> },
  session: Pick<DiningSession, 'probeRead' | 'connect' | 'readMenu' | 'save'>): MessageListener {
  return (message, sender, reply) => {
    if (sender.id !== api.runtime.id) return false;
    const page = sender.url?.split(/[?#]/u)[0];
    const probe = page === api.runtime.getURL('probe.html') && message?.type === 'loghmeh:read';
    const planner = page === api.runtime.getURL('planner.html') && message?.type === 'loghmeh:planner';
    if (!probe && !planner) return false;
    (async () => {
      if (!await api.permissions.contains({ origins: [HOST_PERMISSION] })) {
        throw new ProbeError('permission-required', 'Allow Loghmeh to access the dining website first.');
      }
      if (probe) return { ok: true, ...await session.probeRead(message.operation, message.parameters) };
      const parameters = message.parameters ?? {};
      if (typeof parameters !== 'object' || Array.isArray(parameters)) throw new ProbeError('invalid-request', 'Invalid planner parameters.');
      const { token, restaurantId, week, changes } = parameters;
      if (message.operation === 'connect' && !Object.keys(parameters).length) return { ok: true, value: await session.connect() };
      if (message.operation === 'menu' && Object.keys(parameters).every(key => ['token', 'restaurantId', 'week'].includes(key))) {
        return { ok: true, value: await session.readMenu(token, restaurantId, week) };
      }
      if (message.operation === 'save' && Object.keys(parameters).every(key => ['token', 'restaurantId', 'week', 'changes'].includes(key))) {
        return { ok: true, value: await session.save(token, restaurantId, week, changes) };
      }
      throw new ProbeError('invalid-request', 'Unknown planner operation.');
    })().then(reply, error => reply({ ok: false, error: publicError(error) }));
    return true;
  };
}
