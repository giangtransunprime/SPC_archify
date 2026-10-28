// Builds tools/swimlane-editor/swimlane-editor.html: the editor UI plus the real swimlane
// renderer and viewer template in one offline file. esbuild is a build-time tool only:
//   npm i --no-save esbuild && node tools/swimlane-editor/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const editorDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(editorDir, '../../archify');
let esbuild;
try { esbuild = await import('esbuild'); } catch {
  console.error('esbuild is required to build the editor: npm i --no-save esbuild');
  process.exit(1);
}

const locales = {}; // read-only files the renderer reads at import time, served by the browser fs shim
for (const file of fs.readdirSync(path.join(root, 'locales'))) {
  if (file.endsWith('.json')) locales[file] = fs.readFileSync(path.join(root, 'locales', file), 'utf8');
}
for (const file of ['NOTICE', 'LICENSE', 'LICENSE-MIT', 'THIRD_PARTY_NOTICES.md']) locales[file] = fs.readFileSync(path.join(root, file), 'utf8');
const unavailable = `const no = () => { throw new Error('Not available in the browser editor'); };
export default new Proxy({}, { get: (_, key) => (key === 'constants' ? {} : no) });
export const createHash = no, randomBytes = no, spawnSync = no, lookup = no, setTimeout = no;
export const fileURLToPath = (url) => String(url?.href ?? url);`;
const shims = {
  'node:fs': `${unavailable}\nconst LOCALES = ${JSON.stringify(locales)};
export const readFileSync = (target) => {
  const name = String(target).split('/').pop();
  if (!(name in LOCALES)) throw new Error('Not available in the browser editor: ' + target);
  return LOCALES[name];
};`.replace('export default new Proxy({}, { get: (_, key) => (key === \'constants\' ? {} : no) });', "export default { readFileSync: (...a) => readFileSync(...a), constants: {} };"),
};
const plugin = {
  name: 'node-shims',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-shim' }));
    build.onLoad({ filter: /.*/, namespace: 'node-shim' }, (args) => ({ contents: shims[args.path] || unavailable, loader: 'js' }));
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(editorDir, 'browser-entry.mjs')],
  bundle: true, write: false, format: 'iife', globalName: 'ArchifyBrowser', platform: 'browser',
  loader: { '.html': 'text' },
  define: { 'import.meta.url': '"file:///archify/renderers/shared/i18n.mjs"' },
  banner: { js: "globalThis.process = globalThis.process || { env: {}, argv: [], platform: 'browser' }; globalThis.SharedArrayBuffer = globalThis.SharedArrayBuffer || ArrayBuffer;" },
  plugins: [plugin], legalComments: 'none', logLevel: 'warning',
});
const bundle = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const source = fs.readFileSync(path.join(editorDir, 'swimlane-editor.src.html'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'examples/order-fulfilment.swimlane.json'), 'utf8');
const out = source
  .replace('/*__ARCHIFY_BUNDLE__*/', () => bundle)
  .replace('__SEED__', () => JSON.stringify(JSON.parse(seed)).replace(/</g, '\\u003c'));
fs.writeFileSync(path.join(editorDir, 'swimlane-editor.html'), out);
console.log(`swimlane-editor.html ${(out.length / 1024).toFixed(0)} KB`);
