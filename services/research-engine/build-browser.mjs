import {build} from 'esbuild';
await build({entryPoints:[new URL('./src/studio-graph-browser.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,format:'iife',globalName:'PPTGraph',platform:'browser',target:'es2022',minify:true,legalComments:'eof',outfile:new URL('../../chrome/content/zotero/research/vendor/ppt-graph.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
