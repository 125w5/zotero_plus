/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const copy=x=>JSON.parse(JSON.stringify(x));
 const anchor=s=>({paperID:s.paperID||s.paperItemID,attachmentID:s.attachmentID,pageIndex:s.pageIndex,position:copy(s.position),text:s.text||s.sourceText,sourceVersion:s.sourceVersion||null});
 E.linkSentences=async(first,second,{relation='相关',description=''}={})=>{
  for(const s of [first,second])if(!(s.text||s.sourceText)?.trim()||!s.attachmentID||!Number.isInteger(s.pageIndex)||!s.position)throw Error('关联需要原文和准确 PDF 位置，请重新划选');
  if(first.attachmentID===second.attachmentID)throw Error('请选择另一篇文献中的语句');
  if(!['相关','支持','反驳','方法对比'].includes(relation))throw Error('无效的证据关系');
  const from=anchor(first),to=anchor(second),key=E.assets.key([from.attachmentID,from.position,from.text,to.attachmentID,to.position,to.text,relation]);
  const link={id:'sentence-'+key,from,to,relation,description:description.trim()||'用户关联的原文语句；关系需结合上下文核验。',at:new Date().toISOString(),verification:'unverified'};
  await E.store.update(s=>{s.sentenceLinks||={};s.sentenceLinks[link.id]||=link;});return link;
 };
 E.showSentenceLinks=async(doc,paperID,host)=>{
  host.querySelector('.sentence-link-list')?.remove();const list=doc.createElementNS('http://www.w3.org/1999/xhtml','div');list.className='sentence-link-list';host.append(list);
  const links=Object.values(E.store.get().sentenceLinks||{}).filter(l=>l.from.paperID===paperID||l.to.paperID===paperID);
  const make=(tag,text)=>{const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);n.textContent=text;return n;};
  if(!links.length)list.append(make('p','在 PDF 中选一句话，右键“关联其他文献语句”；也可先标记起点，再到另一篇论文选择终点。'));
  for(const l of links){const row=make('article','');for(const s of [l.from,l.to]){const b=make('button',s.text);b.title='定位原文 · 第 '+(s.pageIndex+1)+' 页';b.onclick=()=>E.library.openSource(s);row.append(b);if(s===l.from)row.append(make('p','↓ '+l.relation+' · '+l.description));}list.append(row);}
 };
 E.openSentenceLinker=async(reader,selection)=>{
  const doc=reader._iframeWindow.document;doc.getElementById('easysch-sentence-linker')?.remove();
  const make=(tag,text,host)=>{const n=doc.createElement(tag);if(text)n.textContent=text;host?.append(n);return n;};
  const panel=make('section');panel.id='easysch-sentence-linker';panel.style.cssText='position:fixed;right:12px;top:50px;bottom:16px;width:min(430px,90vw);z-index:10000;background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:12px;box-shadow:0 8px 28px #0003;padding:16px;display:flex;flex-direction:column;gap:10px;font:13px/1.6 system-ui;';
  const header=make('div','',panel);header.style.cssText='display:flex;justify-content:space-between';make('strong','关联其他文献语句',header);const close=make('button','关闭',header);close.onclick=()=>panel.remove();
  const original=make('p',selection.text,panel);original.style.cssText='max-height:70px;overflow:auto;margin:0';
  const search=make('input','',panel);search.placeholder='搜索另一篇论文中的术语或语句';search.setAttribute('aria-label',search.placeholder);
  const hint=make('p','只列出本机已有全文的位置；相关性不等于支持关系。',panel);hint.setAttribute('role','status');
  const rows=make('div','',panel);rows.style.cssText='overflow:auto;flex:1;min-height:0';
  const relation=make('select','',panel);relation.setAttribute('aria-label','语句关系');for(const value of ['相关','支持','反驳','方法对比'])make('option',value,relation);
  const pending=make('button','将此句设为起点，去另一篇论文选择终点',panel);pending.onclick=()=>{E.pendingSentence=copy(selection);panel.remove();};
  let composing=false,timer,token=0;
  const find=async()=>{const current=++token;await E.preparePassageSearch();if(!panel.isConnected||current!==token)return;rows.replaceChildren();const hits=E.findPaperPassages(search.value,{limit:60}).filter(x=>x.m.attachmentID!==selection.attachmentID).slice(0,20);if(!hits.length){rows.append(make('p','暂无匹配。可以更换关键词，或在另一篇 PDF 中直接划选终点。'));return;}
   for(const {m} of hits){const article=make('article','',rows);article.style.cssText='padding:10px 0;border-bottom:1px solid #8885';make('small',E.materialSourceInfo(m).title+' · 第 '+(m.pageIndex+1)+' 页',article);const quote=make('p',m.sourceText,article);quote.style.cssText='max-height:130px;overflow:auto';const view=make('button','查看原文',article);view.onclick=()=>E.library.openSource(m);const save=make('button','关联这段原文',article);save.onclick=async()=>{try{await E.linkSentences(selection,m,{relation:relation.value});hint.textContent='已保存语句关联，可在侧栏“关联证据”查看';save.disabled=true;save.textContent='已关联';}catch(e){hint.textContent=e.message;}};}
  };
  search.oncompositionstart=()=>composing=true;search.oncompositionend=()=>{composing=false;find().catch(e=>hint.textContent=e.message);};search.oninput=()=>{E.clearTimeout(timer);if(!composing)timer=E.setTimeout(()=>find().catch(e=>hint.textContent=e.message),250);};
  panel.onkeydown=e=>{if(e.key==='Escape'&&!e.isComposing){e.stopPropagation();panel.remove();}};doc.body.append(panel);search.focus();
 };
})(Zotero.Research);
