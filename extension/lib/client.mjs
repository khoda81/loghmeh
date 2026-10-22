import { DINING_ORIGIN, HOST_PERMISSION, ProbeError } from './transport.mjs';
import { parseBootstrap, parseRestaurants, parseMenu } from './parser.mjs';

export function createExtensionClient(api) {
  function decode(result, parser) {
    try { return parser(result.body); }
    catch (error) {
      if (error instanceof ProbeError) error.diagnostic = result.diagnostic;
      throw error;
    }
  }
  async function read(operation, parameters = {}) {
    const result = await api.runtime.sendMessage({ type: 'loghmeh:read', operation, parameters });
    if (!result) throw new ProbeError('extension-error', 'The extension did not respond. Reload Loghmeh in about:debugging.');
    if (!result.ok) throw new ProbeError(result.error.code, result.error.message, result.error.diagnostic);
    return result;
  }
  return {
    mode: 'extension',
    hasPermission: () => api.permissions.contains({ origins: [HOST_PERMISSION] }),
    requestPermission: () => api.permissions.request({ origins: [HOST_PERMISSION] }),
    openLogin: () => api.tabs.create({ url: `${DINING_ORIGIN}/Reserves` }),
    async bootstrap() {
      const result = await read('bootstrap');
      return { ...decode(result, parseBootstrap), diagnostic: result.diagnostic };
    },
    async restaurants(personGroupId) {
      const result = await read('restaurants', { personGroupId });
      return { restaurants: decode(result, parseRestaurants), diagnostic: result.diagnostic };
    },
    async menu(personGroupId, restId) {
      const result = await read('menu', { personGroupId, restId });
      return { ...decode(result, parseMenu), diagnostic: result.diagnostic };
    },
  };
}
