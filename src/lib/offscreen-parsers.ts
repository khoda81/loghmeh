import { ProbeError } from './transport.ts';
import type { LiveBootstrap } from './live-parser.ts';
import type { LiveRestaurant } from './dining-session.ts';
import type { ExtensionApi, Menu, Reply, RuntimeApi } from './types.ts';

// Chrome's background service worker has no DOMParser, so dining pages are parsed
// in a hidden offscreen extension document that only answers the background.
export function createOffscreenParsers(api: RuntimeApi<'getURL' | 'getContexts' | 'sendMessage'> & Pick<ExtensionApi, 'offscreen'>) {
  const url = api.runtime.getURL('offscreen.html');
  let ready: Promise<void> | undefined;
  const open = () => ready ??= (async () => {
    const existing = await api.runtime.getContexts!({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (!existing.length) await api.offscreen!.createDocument({ url, reasons: ['DOM_PARSER'], justification: 'Read dining reservation pages.' });
  })().catch(error => { ready = undefined; throw error; });
  async function parse(parser: 'bootstrap', html: string): Promise<LiveBootstrap>;
  async function parse(parser: 'menu', html: string, restaurant: LiveRestaurant): Promise<Menu>;
  async function parse(parser: string, html: string, restaurant?: LiveRestaurant) {
    let result: Reply<{ value: unknown }> | undefined;
    try {
      await open();
      result = await api.runtime.sendMessage({ type: 'loghmeh:parse', parser, html, restaurant });
    } catch {
      ready = undefined; // Chrome may have closed the document; recreate it next time.
      throw new ProbeError('unexpected-error', 'The page reader did not start. Please try again.');
    }
    if (!result?.ok) throw new ProbeError(result?.error?.code || 'unexpected-error', result?.error?.message || 'The page reader did not answer.', result?.error?.diagnostic);
    return result.value;
  }
  return {
    bootstrapParser: (html: string) => parse('bootstrap', html),
    menuParser: (html: string, restaurant: LiveRestaurant) => parse('menu', html, restaurant),
  };
}
