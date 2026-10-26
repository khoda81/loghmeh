import { DINING_ORIGIN, HOST_PERMISSION, ProbeError } from './transport.ts';
import { parseBootstrap, parseRestaurants, parseMenu } from './parser.ts';
import type { TransportResult } from './transport.ts';
import type { Diagnostic, ExtensionApi, Reply } from './types.ts';

// The probe page's read-only client; createDemoClient in demo.ts has the same shape.
export interface ProbeClient {
  mode: string;
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  openLogin(): Promise<unknown>;
  bootstrap(): Promise<ReturnType<typeof parseBootstrap> & { diagnostic: Diagnostic }>;
  restaurants(personGroupId: string): Promise<{ restaurants: ReturnType<typeof parseRestaurants>; diagnostic: Diagnostic }>;
  menu(personGroupId: string, restId: string): Promise<ReturnType<typeof parseMenu> & { diagnostic: Diagnostic }>;
}

export function createExtensionClient(api: ExtensionApi): ProbeClient {
  function decode<T>(result: TransportResult, parser: (body: string) => T) {
    try { return parser(result.body); }
    catch (error) {
      if (error instanceof ProbeError) error.diagnostic = result.diagnostic;
      throw error;
    }
  }
  async function read(operation: string, parameters = {}) {
    const result: Reply<TransportResult> | undefined = await api.runtime.sendMessage({ type: 'loghmeh:read', operation, parameters });
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
