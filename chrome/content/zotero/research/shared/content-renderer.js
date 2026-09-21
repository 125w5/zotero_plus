/* SPDX-License-Identifier: AGPL-3.0-or-later */
// One renderer for reader cards, notebook, manuscript and workbench. No AI HTML executes.
(function(root){
 const NS='http://www.w3.org/1999/xhtml';
 function normalize(value){
  let text=String(value??'').replace(/\r\n?/g,'\n');
  // Only decode a complete JSON string. Never globally unescape TeX or user paths.
  if(text.startsWith('"')&&text.endsWith('"'))try{const decoded=JSON.parse(text);if(typeof decoded==='string')text=decoded;}catch{}
  return text;
 }
 function render(target,value,{sources=[],onSource=()=>{},original, bilingual=false}={}){
  const doc=target.ownerDocument,make=(tag,text)=>{const e=doc.createElementNS(NS,tag);if(text!==undefined)e.textContent=text;return e;};
  let text=normalize(value),math=[],prefix='EASYMATH'+Math.random().toString(36).slice(2)+'TOKEN';
  text=text.replace(/\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\\n])+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g,v=>{math.push(v);return prefix+(math.length-1)+'END';});
  const safe=root.DOMPurify.sanitize(root.marked.parse(text,{async:false,breaks:true}),{RETURN_DOM_FRAGMENT:true,ALLOWED_TAGS:['p','br','strong','em','del','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','hr','a'],ALLOWED_ATTR:['href','title'],ALLOWED_URI_REGEXP:/^(?:https?:|zotero:)/i});
  target.replaceChildren(doc.importNode(safe,true));target.classList.add('easysch-content');target.style.whiteSpace='normal';
  const walker=doc.createTreeWalker(target,4),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  const known=new Map(sources.map(s=>[String(s.id),s]));
  for(const node of nodes){node.nodeValue=node.nodeValue.replace(new RegExp(prefix+'(\\d+)END','g'),(_,i)=>math[+i]);if(node.parentElement.closest('pre,code,a'))continue;
   const parts=node.nodeValue.split(/(\[[A-Za-z0-9:_-]+\])/g);if(parts.length<2)continue;const fragment=doc.createDocumentFragment();for(const part of parts){const source=known.get(part.slice(1,-1));if(source){const b=make('button',source.id.length>14?'['+(sources.findIndex(s=>s.id===source.id)+1)+']':part);b.dataset.sourceID=source.id;b.type='button';b.className='source-citation';b.title=source.label||source.title||'定位原文';b.onclick=()=>onSource(source);fragment.append(b);}else fragment.append(doc.createTextNode(part));}node.replaceWith(fragment);
  }
  // Links are usable only when matched to an actual supplied source. No arbitrary AI URLs.
  for(const a of target.querySelectorAll('a')){
   const href=a.getAttribute('href'),matches=sources.filter(s=>s.uri===href||s.url===href||s.anchor?.url===href),label=a.textContent.trim().replace(/^\[|\]$/g,'');
   // Several excerpts may share one PDF page URL. Match the stable excerpt ID
   // before falling back to a unique URL, so a citation retains its exact position.
   const source=matches.find(s=>String(s.id)===label)||(matches.length===1?matches[0]:null);
   if(source){a.removeAttribute('href');a.setAttribute('role','button');a.dataset.sourceID=source.id;a.tabIndex=0;a.onclick=()=>onSource(source);a.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSource(source);}};}else a.replaceWith(...a.childNodes);
  }
  root.renderMathInElement(target,{trust:false,throwOnError:false,delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}]});
  if(bilingual&&original){const wrap=make('div'),source=make('blockquote',original),answer=make('div');answer.append(...target.childNodes);wrap.className='bilingual-content';wrap.append(source,answer);target.append(wrap);}
  return target;
 }
 function stream(target,options){let value='';return {append(chunk){value+=chunk;render(target,value,options);},replace(text){value=text;render(target,value,options);},get text(){return value;}};}
 function plainText(target){const copy=target.cloneNode(true),doc=target.ownerDocument;for(const math of copy.querySelectorAll('.katex'))math.replaceWith(doc.createTextNode(math.querySelector('annotation')?.textContent||math.textContent));for(const row of copy.querySelectorAll('tr'))row.replaceWith(doc.createTextNode([...row.children].map(c=>c.textContent.trim()).join('\t')+'\n'));for(const node of copy.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre'))node.append(doc.createTextNode('\n'));for(const br of copy.querySelectorAll('br'))br.replaceWith(doc.createTextNode('\n'));return copy.textContent.replace(/\n{3,}/g,'\n\n').trim();}
 root.EasySchContent={render,stream,normalize,plainText};
})(globalThis);
