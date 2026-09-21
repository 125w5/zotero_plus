/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const base='chrome://zotero/content/research/',renderers=new WeakMap();
 E.contentRenderer=doc=>{const win=doc.defaultView;if(!renderers.has(doc)){
  // loadSubScript's target is an environment, not a browser global. Explicitly bind
  // globalThis so all UMD libraries and the renderer export to the same scope.
  const scope={window:win,document:doc,console:win.console,Node:win.Node,NodeFilter:win.NodeFilter};scope.globalThis=scope;scope.self=scope;
  for(const path of ['vendor/marked.js','vendor/purify.js','vendor/katex.js','vendor/auto-render.js','shared/content-renderer.js'])Services.scriptloader.loadSubScript(base+path,scope,'UTF-8');
  if(!scope.EasySchContent)throw Error('内容渲染器未能初始化');renderers.set(doc,scope.EasySchContent);
 }for(const path of ['vendor/katex.min.css','shared/content-renderer.css'])if(!doc.querySelector('link[data-easysch-style="'+path+'"]')){const link=doc.createElementNS('http://www.w3.org/1999/xhtml','link');link.rel='stylesheet';link.href=base+path;link.dataset.easyschStyle=path;(doc.head||doc.documentElement).append(link);}return renderers.get(doc);};
 E.renderContent=(target,text,options)=>E.contentRenderer(target.ownerDocument).render(target,text,options);
 E.noteContentHTML=text=>{const doc=Zotero.getMainWindow().document,node=doc.createElementNS('http://www.w3.org/1999/xhtml','div');E.renderContent(node,text);
  // The native note editor stores TeX, not KaTeX's presentation spans.
  for(const math of [...node.querySelectorAll('.katex')]){const tex=math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;if(!tex)continue;const display=math.closest('.katex-display'),out=doc.createElementNS('http://www.w3.org/1999/xhtml',display?'pre':'span');out.className='math';out.textContent=(display?'$$':'$')+tex+(display?'$$':'$');(display||math).replaceWith(out);}
  return node.innerHTML;};
})(Zotero.Research);
