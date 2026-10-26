import { parseLiveBootstrap, parseLiveMenu } from './lib/live-parser.ts';
import { publicError } from './lib/transport.ts';

// Chrome only: parses dining HTML for the background service worker, which has no DOMParser.
const api = globalThis.chrome!;
const parsers: Record<string, (html: string, restaurant: any) => unknown> = { bootstrap: parseLiveBootstrap, menu: parseLiveMenu };

api.runtime.onMessage!.addListener((message, sender, reply) => {
  if (sender.id !== api.runtime.id || sender.url !== api.runtime.getURL('background.js')) return false;
  if (message?.type !== 'loghmeh:parse' || !Object.hasOwn(parsers, message.parser)) return false;
  try { reply({ ok: true, value: parsers[message.parser](message.html, message.restaurant) }); }
  catch (error) { reply({ ok: false, error: publicError(error) }); }
  return false;
});
