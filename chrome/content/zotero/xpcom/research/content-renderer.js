/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const base='chrome://zotero/content/research/',renderers=new WeakMap(),styledDocuments=new WeakMap();let stylesheetBundle;
 const loadStyles=()=>stylesheetBundle||=(async()=>{
  const paths=['vendor/katex.min.css','shared/content-renderer.css'],responses=await Promise.all(paths.map(path=>Zotero.HTTP.request('GET',base+path)));
  let mathCSS=responses[0].responseText;const fontPaths=[...new Set([...mathCSS.matchAll(/url\((fonts\/[A-Za-z0-9_-]+\.woff2)\)/g)].map(match=>match[1]))],fonts=new Map();
  await Promise.all(fontPaths.map(async path=>{
   const response=await Zotero.HTTP.request('GET',base+'vendor/'+path,{responseType:'arraybuffer'}),bytes=new Uint8Array(response.response);let binary='';
   for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
   fonts.set(path,'data:font/woff2;base64,'+Zotero.getMainWindow().btoa(binary));
  }));
  // Content reader frames cannot load chrome CSS or its relative font files.
  // Inline only the bundled WOFF2 faces, once, without exposing app resources.
  mathCSS=mathCSS.replace(/src:([^;}]+)(?=[;}])/g,(declaration,sources)=>{const match=sources.match(/url\((fonts\/[A-Za-z0-9_-]+\.woff2)\)\s*format\(["']woff2["']\)/);return match?'src:url('+fonts.get(match[1])+') format("woff2")':declaration;});
  return [[paths[0],mathCSS],[paths[1],responses[1].responseText]];
 })().catch(error=>{stylesheetBundle=null;throw error;});
 E.prepareContentStyles=doc=>{
  if(styledDocuments.has(doc))return styledDocuments.get(doc);
  const task=loadStyles().then(styles=>{for(const [path,css]of styles){doc.querySelector('[data-easysch-style="'+path+'"]')?.remove();const style=doc.createElementNS('http://www.w3.org/1999/xhtml','style');style.dataset.easyschStyle=path;style.textContent=css;(doc.head||doc.documentElement).append(style);}}).catch(error=>{styledDocuments.delete(doc);throw error;});
  styledDocuments.set(doc,task);return task;
 };
 E.contentRenderer=doc=>{const win=doc.defaultView;if(!renderers.has(doc)){
  // loadSubScript's target is an environment, not a browser global. Explicitly bind
  // globalThis so all UMD libraries and the renderer export to the same scope.
  const scope={window:win,document:doc,console:win.console,Node:win.Node,NodeFilter:win.NodeFilter};scope.globalThis=scope;scope.self=scope;
  for(const path of ['vendor/marked.js','vendor/purify.js','vendor/katex.js','vendor/auto-render.js','shared/content-renderer.js'])Services.scriptloader.loadSubScript(base+path,scope,'UTF-8');
  if(!scope.EasySchContent)throw Error('内容渲染器未能初始化');renderers.set(doc,scope.EasySchContent);
 }E.prepareContentStyles(doc).catch(Zotero.logError);return renderers.get(doc);};
 // Without options (no sources, citation handler or bilingual original) the
 // rendered nodes depend only on the text: no citation buttons, no handlers and
 // no state from earlier renders. Material cards repeat the same descriptions on
 // every canvas render, so those renders are kept per document and cloned.
 // Plain text (renderer.isPlain) is built directly, which costs about what a
 // copy does, so it is not kept and leaves the cache to Markdown and TeX.
 const renderedContent=new WeakMap(),RENDER_CACHE_SIZE=500,RENDER_CACHE_TEXT=20000;let Evidence;
 E.renderContent=(target,text,options)=>{
  Evidence||=ChromeUtils.importESModule(base+'shared/chat-evidence.mjs');const value=Evidence.evidenceCitationText(text,options?.sources),doc=target.ownerDocument,renderer=E.contentRenderer(doc);
  if(options!==undefined||value.length>RENDER_CACHE_TEXT||renderer.isPlain?.(value))return renderer.render(target,value,options);
  let cache=renderedContent.get(doc);if(!cache){cache=new Map();renderedContent.set(doc,cache);}
  let rendered=cache.get(value);
  if(rendered)cache.delete(value);
  else{rendered=renderer.render(doc.createElementNS('http://www.w3.org/1999/xhtml','div'),value);if(cache.size>=RENDER_CACHE_SIZE)cache.delete(cache.keys().next().value);}
  cache.set(value,rendered);
  target.replaceChildren(...rendered.cloneNode(true).childNodes);target.classList.add('easysch-content');target.style.whiteSpace='normal';return target;
 };
 E.noteContentHTML=text=>{const doc=Zotero.getMainWindow().document,node=doc.createElementNS('http://www.w3.org/1999/xhtml','div');E.renderContent(node,text);
  // The native note editor stores TeX, not KaTeX's presentation spans.
  for(const math of [...node.querySelectorAll('.katex')]){const tex=math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;if(!tex)continue;const display=math.closest('.katex-display'),out=doc.createElementNS('http://www.w3.org/1999/xhtml',display?'pre':'span');out.className='math';out.textContent=(display?'$$':'$')+tex+(display?'$$':'$');(display||math).replaceWith(out);}
  return node.innerHTML;};
})(Zotero.Research);
