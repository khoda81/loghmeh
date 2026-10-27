import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const repository = import.meta.dirname;
const at = (file: string) => path.join(repository, file);
const entries = { planner: 'planner.html', offscreen: 'offscreen.html', background: 'background.ts' };
const testPages = ['browser', 'browser-live-planner', 'browser-mobile'];
export const STATIC_FILES = ['manifest.json', 'THIRD_PARTY_NOTICES.txt', 'icon.svg', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png'];

function staticFiles(prefix: string): Plugin {
  return {
    name: 'loghmeh-static-files',
    generateBundle(_, bundle) {
      for (const name of STATIC_FILES) {
        const fileName = prefix + name;
        if (!(fileName in bundle)) this.emitFile({ type: 'asset', fileName, source: readFileSync(at(`src/${name}`)) });
      }
    },
  };
}

// The extension build (dist/build/) is the loadable extension root. The preview build
// keeps the repository layout so the local test pages can sit beside /src/.
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  const prefix = preview ? 'src/' : '';
  return {
    root: preview ? repository : at('src'),
    base: './',
    define: { __LOGHMEH_PREVIEW__: JSON.stringify(preview) },
    // Build DOM with createElement rather than innerHTML templates, which the AMO linter flags.
    plugins: [svelte({ compilerOptions: { fragments: 'tree' } }), staticFiles(prefix)],
    build: {
      outDir: at(preview ? 'dist/preview' : 'dist/build'),
      emptyOutDir: true,
      target: ['firefox142', 'chrome116'],
      // Readable output for store review; the source ZIP accompanies each AMO upload.
      minify: false,
      // Extension pages allow only same-origin scripts, styles, and images: no data: URIs.
      assetsInlineLimit: 0,
      modulePreload: false,
      rolldownOptions: {
        input: {
          ...Object.fromEntries(Object.entries(entries).map(([name, file]) => [prefix + name, at(`src/${file}`)])),
          ...(preview ? { 'src/probe': at('src/probe.html'), ...Object.fromEntries(testPages.map(name => [`tests/${name}`, at(`tests/${name}.html`)])) } : {}),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: `${prefix}chunks/[name].js`,
          assetFileNames: `${prefix}[name][extname]`,
        },
      },
    },
  };
});
