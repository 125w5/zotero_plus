import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const file = relative => fileURLToPath(new URL(relative, import.meta.url));
const aiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@mariozechner/pi-ai'))), '..');
const pi = await build({
  entryPoints: [file('./src/pi-browser-entry.mjs')], bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof', metafile: true,
  banner: {js: '/*! Pi Agent / Pi AI 0.73.1, Copyright (c) 2025 Mario Zechner, MIT; see PI-AGENT-LICENSE.txt and TYPEBOX-LICENSE.txt. */'},
  outfile: file('../../chrome/content/zotero/research/vendor/pi-agent.mjs'),
  plugins: [{name: 'pi-api-only', setup(build) {
    // The upstream root registers every provider. Keep only stream primitives
    // and its actual validator, while Zotero supplies the existing API transport.
    build.onResolve({filter: /^@mariozechner\/pi-ai$/}, () => ({path: file('./src/pi-browser-adapter.mjs')}));
    build.onResolve({filter: /^@mariozechner\/pi-ai\/dist\//}, args => ({
      path: path.join(aiRoot, args.path.slice('@mariozechner/pi-ai/'.length))
    }));
  }}]
});
const providers = Object.keys(pi.metafile.inputs).filter(name =>
  /(?:\/providers\/|@anthropic-ai|@aws-sdk|@google|openai\/|proxy-agent|undici\/|node:)/.test(name));
if (providers.length) throw new Error(`Pi browser bundle unexpectedly includes provider dependencies: ${providers.join(', ')}`);
await build({entryPoints:[file('./src/studio-graph-browser.mjs')],bundle:true,format:'iife',globalName:'PPTGraph',platform:'browser',target:'es2022',minify:true,legalComments:'eof',outfile:file('../../chrome/content/zotero/research/vendor/ppt-graph.js')});
