import { ProbeError } from './transport.mjs';

// Chrome's background service worker has no DOMParser, so dining pages are parsed
// in a hidden offscreen extension document that only answers the background.
export function createOffscreenParsers(api) {
  const url = api.runtime.getURL('offscreen.html');
  let ready;
  const open = () => ready ??= (async () => {
    const existing = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (!existing.length) await api.offscreen.createDocument({ url, reasons: ['DOM_PARSER'], justification: 'Read dining reservation pages.' });
  })().catch(error => { ready = undefined; throw error; });
  const parse = async (parser, html, restaurant) => {
    let result;
    try {
      await open();
      result = await api.runtime.sendMessage({ type: 'loghmeh:parse', parser, html, restaurant });
    } catch {
      ready = undefined; // Chrome may have closed the document; recreate it next time.
      throw new ProbeError('unexpected-error', 'The page reader did not start. Please try again.');
    }
    if (!result?.ok) throw new ProbeError(result?.error?.code || 'unexpected-error', result?.error?.message || 'The page reader did not answer.', result?.error?.diagnostic);
    return result.value;
  };
  return {
    bootstrapParser: html => parse('bootstrap', html),
    menuParser: (html, restaurant) => parse('menu', html, restaurant),
  };
}
