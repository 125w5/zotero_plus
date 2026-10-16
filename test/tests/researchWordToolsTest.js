/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Manual Word tools, source labels and independent image geometry', function () {
 this.timeout(150000);
 const E=Zotero.Research;
 // A real Gecko document and execCommand are used. Only image pixels and the
 // model-list response are controlled; no research/model request is made.
 const preview='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80"><rect width="320" height="80" fill="#dfe8f2"/><path d="M0 40H320" stroke="#70839a"/></svg>');
 let win,frame,U,projectID,priorModels,baseline,prior,saveCalls;
 const doc=()=>frame.contentDocument,fw=()=>frame.contentWindow;
 const wait=async(fn,label='Word 工具')=>{for(let i=0;i<300;i++){if(await fn())return;await Zotero.Promise.delay(50);}throw Error('等待'+label+'超时');};
 const dispatch=(node,type)=>node.dispatchEvent(new (fw().Event)(type,{bubbles:true,cancelable:true}));
 const editable=id=>U.$('canvas').querySelector(`[data-id="${id}"] .editable`);
 const toolbar=()=>doc().querySelector('.manual-writing-toolbar');
 const command=name=>toolbar().querySelector(`[data-writing-command="${name}"]`);
 const sourceMaterial=()=>U.M.material({title:'独立批次的实验条件',kind:'experiment',summary:'训练与验证来自独立批次。',sourceText:'Original source: independent batches; x_i is the measured variable.',anchor:{pageIndex:2,sourceText:'Original source: independent batches; x_i is the measured variable.'}});
 const install=(blocks,materials=[])=>{U.p.materials=materials;U.p.blocks=blocks;U.p.ui.sectionID=U.p.sections[0].id;U.p.ui.blockID=blocks[0]?.id||null;U.p.ui.left='structure';U.p.ui.leftOpen=true;U.p.ui.rightOpen=true;U.p.ui.aiOpen=false;U.p.ui.paperZoom=1;U.previewMaterialID=null;U.undo=[];U.redo=[];U.changed({editor:true});U.applyPanels();};
 const selectText=(node,start=0,end=node.textContent.length)=>{
  node.focus();
  const walker=doc().createTreeWalker(node,fw().NodeFilter.SHOW_TEXT),leaves=[];let leaf;
  while((leaf=walker.nextNode()))leaves.push(leaf);
  const point=count=>{for(const text of leaves){if(count<=text.length)return [text,count];count-=text.length;}throw Error('选区超出实际正文');};
  const [first,left]=point(start),[last,right]=point(end),range=doc().createRange();range.setStart(first,left);range.setEnd(last,right);
  const selection=fw().getSelection();selection.removeAllRanges();selection.addRange(range);dispatch(doc(),'selectionchange');
  assert.equal(selection.getRangeAt(0).toString(),node.textContent.slice(start,end));assert.equal(toolbar().dataset.selection,start===end?'caret':'text');
  return range;
 };
 const clickFormat=(node,name)=>{selectText(node);const control=command(name);assert.exists(control,name);assert.isFalse(control.disabled,name+' is active for the real selection');control.click();};
 const changeFormat=(node,name,value)=>{selectText(node);const control=command(name);assert.exists(control,name);assert.isFalse(control.disabled);control.focus();control.value=String(value);dispatch(control,'change');};
 const assertSources=(material,block,original)=>{assert.equal(JSON.stringify(material),original.material);assert.equal(JSON.stringify(block.materials),original.links);};
 const snapshotFixture=async filename=>{
  // Capture only the window created by this test. This is Gecko's internal
  // rendering API, with no desktop activation/capture or personal library.
  assert.equal(win.Zotero_Tabs.selectedID,frame.parentElement.id);
  const folder=PathUtils.join(Zotero.DataDirectory.dir,'word-tools-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const label=doc().createElement('div');label.textContent='真实 Gecko 测试样例 · 受控论文内容 · 非日常文库';label.style.cssText='position:fixed;left:12px;bottom:8px;z-index:2147483647;padding:5px 9px;border:1px solid #cad2dc;border-radius:6px;background:#f7f9fc;color:#56667a;font:11px/1.4 system-ui;pointer-events:none';doc().body.append(label);
  let image;
  try{
   await new Promise(resolve=>fw().requestAnimationFrame(()=>fw().requestAnimationFrame(resolve)));
   image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');
   const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));assert.exists(blob,'Gecko test-window rendering produces PNG');
   await IOUtils.write(PathUtils.join(folder,filename),new Uint8Array(await blob.arrayBuffer()));
   await IOUtils.writeUTF8(PathUtils.join(folder,filename.replace(/\.png$/,'.json')),JSON.stringify({fixture:true,renderer:'Gecko currentWindowGlobal.drawSnapshot of test-owned Zotero window',projectID,width:image.width,height:image.height,description:'真实 Gecko 中工具栏选区、格式持久化及重绘后的受控测试内容；不代表真人鼠标操作或日常文库截图'},null,2));
  }finally{image?.close();label.remove();}
 };
 before(async()=>{
  priorModels=E.workbenchModels;E.workbenchModels=async()=>[{id:'controlled-model',label:'受控模型列表'}];
  win=await loadZoteroPane();await E.attachWindow(win);win.resizeTo(1600,1000);
  const p=await E.manuscripts.create('Word 手工格式与图片尺寸验收 '+Date.now());projectID=p.id;await E.manuscripts.open(p.id);
  await wait(()=>{frame=win.document.getElementById('manuscript-'+p.id);U=frame?.contentWindow.ManuscriptUI;return U?.ready;},'装配文档');
 });
 beforeEach(async()=>{
  baseline=U.M.clone(U.p);prior={save:U.A.save,previewImage:U.E.previewImage};saveCalls=[];
  win.Zotero_Tabs.select(frame.parentElement.id);win.focus();fw().focus();await Zotero.Promise.delay(100);
  assert.isAbove(frame.getBoundingClientRect().height,300,'Gecko 装配文档必须可见');assert.isTrue(doc().hasFocus(),'真实前台焦点不可用时不能伪造 execCommand 成功');
  U.writingRibbon.setTab('home');
  await U.persist();baseline=U.M.clone(U.p);
  U.A.save=async function(...args){saveCalls.push(U.M.clone(args[0]));return prior.save.apply(this,args);};
  U.E.previewImage=async()=>preview;
 });
 afterEach(async()=>{
  try{await U.persist();}finally{
   U.A.save=prior.save;U.E.previewImage=prior.previewImage;fw().getSelection().removeAllRanges();U.p=baseline;U.previewMaterialID=null;U.undo=[];U.redo=[];U.changed({editor:true});await U.persist();
  }
 });
 after(async()=>{
  try{if(U){await U.persist();U.closing=true;}if(projectID){win.Zotero_Tabs.close('manuscript-'+projectID);await E.manuscripts.remove(projectID);}await E.store.flush();}
  finally{E.workbenchModels=priorModels;win?.close();}
 });
 it('applies 18 pt, strike, highlight and distinct scripts through a preserved real selection, then saves and redraws',async()=>{
  const material=sourceMaterial(),text='变量 xi2 的观测条件',block=U.M.block('paragraph',U.p.sections[0].id,{text,materials:[{id:material.id,role:'primary',revision:material.revision}]});
  install([block],[material]);const source={material:JSON.stringify(material),links:JSON.stringify(block.materials)},node=editable(block.id);
  changeFormat(node,'fontSize',18);assert.isTrue(block.runs.every(run=>!run.text||run.fontSize===18));assert.notExists(node.querySelector('font[size]'),'Gecko 旧字号值必须规范化成 pt');
  clickFormat(node,'strikeThrough');assert.isTrue(block.runs.some(run=>run.strike&&run.text.includes('变量')));assert.equal(command('strikeThrough').getAttribute('aria-pressed'),'true');
  changeFormat(node,'hiliteColor','#fff0a0');assert.isTrue(block.runs.some(run=>['#fff0a0','rgb(255, 240, 160)'].includes(run.highlight)));
  selectText(node,text.indexOf('i'),text.indexOf('i')+1);command('subscript').click();assert.isTrue(block.runs.some(run=>run.text==='i'&&run.sub));
  selectText(node,text.indexOf('2'),text.indexOf('2')+1);command('superscript').click();assert.isTrue(block.runs.some(run=>run.text==='2'&&run.sup));
  assert.equal(block.text,text);assertSources(material,block,source);
  const runs=JSON.stringify(block.runs);await U.persist();const saved=E.manuscripts.get(projectID).blocks.find(value=>value.id===block.id);assert.equal(JSON.stringify(saved.runs),runs);assert.isAbove(saveCalls.length,0,'真实保存函数仍执行');
  U.renderEditor();const restored=editable(block.id);assert.equal(restored.textContent,text);assert.exists(restored.querySelector('s'));assert.exists(restored.querySelector('sub'));assert.exists(restored.querySelector('sup'));
  const sized=[...restored.querySelectorAll('span')].filter(span=>span.style.fontSize==='18pt');assert.isAbove(sized.length,0);assert.closeTo(parseFloat(fw().getComputedStyle(sized[0]).fontSize),24,.1);
  for(const script of restored.querySelectorAll('sub,sup')){const glyph=script.querySelector('span')||script;assert.isBelow(parseFloat(fw().getComputedStyle(glyph).fontSize),24,'上下标必须真正小于18pt正文，不能被内层固定字号覆盖');}
  const Runs=ChromeUtils.importESModule('chrome://zotero/content/research/shared/editable-runs.mjs'),read=Runs.readEditableRuns(restored),scripts=read.filter(run=>run.sup||run.sub);assert.lengthOf(scripts,2);assert.isTrue(scripts.every(run=>run.fontSize===18),'重读保留18pt基准字号，不把缩小后的脚本字号写回正文');assert.deepEqual(JSON.parse(JSON.stringify(read)),JSON.parse(runs));
  assert.isTrue([...restored.querySelectorAll('[style]')].some(span=>span.style.backgroundColor==='rgb(255, 240, 160)'));assert.equal(JSON.stringify(block.runs),runs);assertSources(material,block,source);
  await snapshotFixture('formats.png');
 });
 it('keeps rich heading formats and sources in the rendered heading after persistence',async()=>{
  const material=sourceMaterial(),text='实验条件',block=U.M.block('heading',U.p.sections[0].id,{text,runs:[{text,bold:true}],materials:[{id:material.id,role:'support',revision:material.revision}]});
  install([block],[material]);const source={material:JSON.stringify(material),links:JSON.stringify(block.materials)},node=editable(block.id);
  changeFormat(node,'fontSize',18);clickFormat(node,'strikeThrough');changeFormat(node,'hiliteColor','#ddeeff');
  assert.isTrue(block.runs.some(run=>run.bold&&run.strike&&run.fontSize===18));assert.equal(block.type,'heading');assert.equal(block.text,text);
  const runs=JSON.stringify(block.runs);await U.persist();assert.equal(JSON.stringify(E.manuscripts.get(projectID).blocks[0].runs),runs);U.renderEditor();
  const restored=editable(block.id);assert.exists(restored.closest('.block-heading'));assert.exists(restored.querySelector('strong'));assert.exists(restored.querySelector('s'));assert.equal(restored.textContent,text);assertSources(material,block,source);
 });
 it('changes a paragraph into a numbered list with preserved runs and applies real spacing and indentation controls',async()=>{
  const material=sourceMaterial(),text='第一行观测\n第二行验证',block=U.M.block('paragraph',U.p.sections[0].id,{text,runs:[{text,italic:true}],materials:[{id:material.id,role:'primary',revision:material.revision}]});
  install([block],[material]);const source={material:JSON.stringify(material),links:JSON.stringify(block.materials)};
  clickFormat(editable(block.id),'list-number');assert.equal(block.type,'list');assert.equal(block.listStyle,'number');let node=editable(block.id);assert.equal(node.tagName,'OL');assert.lengthOf(node.querySelectorAll(':scope > li'),2);assert.exists(node.querySelector('em'));assert.equal(block.text,text);
  changeFormat(node,'fontSize',18);assert.isTrue(block.runs.filter(run=>run.text.trim()).every(run=>run.fontSize===18));
  changeFormat(node,'lineSpacing',1.5);assert.equal(block.lineSpacing,1.5);assert.equal(node.style.lineHeight,'1.5');
  clickFormat(node,'indentMore');clickFormat(node,'indentMore');assert.equal(block.indent,10);clickFormat(node,'indentLess');assert.equal(block.indent,5);assert.equal(node.style.marginLeft,'5mm');assert.closeTo(parseFloat(fw().getComputedStyle(node).marginLeft),5*96/25.4,.1);
  const runs=JSON.stringify(block.runs);await U.persist();const saved=E.manuscripts.get(projectID).blocks[0];assert.equal(saved.type,'list');assert.equal(saved.listStyle,'number');assert.equal(saved.lineSpacing,1.5);assert.equal(saved.indent,5);assert.equal(JSON.stringify(saved.runs),runs);
  U.renderEditor();node=editable(block.id);assert.equal(node.tagName,'OL');assert.lengthOf(node.querySelectorAll(':scope > li'),2);assert.equal(node.style.lineHeight,'1.5');assert.equal(node.style.marginLeft,'5mm');assert.exists(node.querySelector('em'));assert.equal(block.text,text);assertSources(material,block,source);
 });
 it('labels an empty linked paragraph with its material title in the structure and actual evidence usage',()=>{
  const material=sourceMaterial(),block=U.M.block('paragraph',U.p.sections[0].id,{assembly:true,text:'',materials:[{id:material.id,role:'primary',revision:material.revision}]});
  install([block],[material]);const source={material:JSON.stringify(material),links:JSON.stringify(block.materials)};
  for(const view of ['structure','evidence']){U.p.ui.left=view;U.p.ui.evidenceFilter='used';U.renderLibrary();const label=U.$('library').querySelector(`[data-outline-block="${block.id}"] .outline-label`);assert.exists(label);assert.equal(label.textContent,material.title);assert.notEqual(label.textContent,'空白段落');}
  assert.equal(block.text,'');assertSources(material,block,source);
 });
 it('uses real dimension inputs to resize independently, restores ratio, and updates the canvas, preview and saved project',async()=>{
  const material=sourceMaterial(),block=U.M.block('image',U.p.sections[0].id,{text:'原始实验图片',imagePath:'controlled-word-tools.svg',width:80,height:20,aspectLocked:true,materials:[{id:material.id,role:'primary',revision:material.revision}]});
  install([block],[material]);const source={material:JSON.stringify(material),links:JSON.stringify(block.materials)},imagePath=block.imagePath;
  const canvas=()=>U.$('canvas').querySelector(`[data-id="${block.id}"] .canvas-image-wrap img`),detail=()=>U.$('details').querySelector('.object-preview img');
  await wait(()=>canvas()?.naturalWidth===320&&detail()?.naturalWidth===320,'受控图片真实加载');
  const tools=U.$('details').querySelector('.image-size-tools'),width=tools.querySelector('[aria-label="图片宽度（毫米）"]'),height=tools.querySelector('[aria-label="图片高度（毫米）"]'),lock=tools.querySelector('[type=checkbox]');assert.exists(width);assert.exists(height);assert.isTrue(lock.checked);
  lock.click();assert.isFalse(block.aspectLocked);width.value='70';dispatch(width,'change');assert.equal(block.width,70);assert.equal(block.height,20);height.value='35';dispatch(height,'change');assert.equal(block.width,70);assert.equal(block.height,35);
  for(const image of [canvas(),detail()]){assert.equal(image.style.width,'70mm');assert.equal(image.style.height,'35mm');assert.equal(image.style.objectFit,'fill');assert.closeTo(image.getBoundingClientRect().width/image.getBoundingClientRect().height,2,.05);}
  lock.click();assert.isTrue(block.aspectLocked);assert.equal(block.width,70);assert.equal(block.height,17.5);height.value='20';dispatch(height,'change');assert.equal(block.width,80);assert.equal(block.height,20);
  for(const image of [canvas(),detail()]){assert.equal(image.style.width,'80mm');assert.equal(image.style.height,'20mm');assert.equal(image.style.objectFit,'contain');assert.closeTo(image.getBoundingClientRect().width/image.getBoundingClientRect().height,4,.05);}
  await U.persist();const saved=E.manuscripts.get(projectID).blocks[0];assert.equal(saved.width,80);assert.equal(saved.height,20);assert.isTrue(saved.aspectLocked);assert.equal(saved.imagePath,imagePath);assertSources(material,block,source);
  U.renderEditor();await wait(()=>canvas()?.naturalWidth===320,'重绘后的图片');assert.equal(canvas().style.width,'80mm');assert.equal(canvas().style.height,'20mm');assert.equal(block.imagePath,imagePath);assertSources(material,block,source);
 });
 it('keeps its automatic ribbon in the article column, pins on request and retains real controls in a narrow window',async()=>{
  const block=U.M.block('paragraph',U.p.sections[0].id,{text:'窄窗口中的字体和段落工具'});install([block]);const before=JSON.stringify(U.p.blocks);
  try{
   win.resizeTo(940,900);await wait(()=>fw().innerWidth<1000&&fw().innerWidth>700,'真实窄窗口');U.applyPanels();await Zotero.Promise.delay(150);
   const ribbon=U.$('tools'),bounds=ribbon.getBoundingClientRect(),main=U.$('workspace').querySelector('main');assert.equal(ribbon.parentElement,main,'工具栏只属于中间文章栏');assert.closeTo(bounds.width,main.getBoundingClientRect().width,1,'边界严格沿用文章栏');
   const article=U.$('workspace').querySelector('main').getBoundingClientRect();assert.isAbove(article.width,380,'两侧栏随窗口收窄，给正文保留可编辑宽度');assert.isAbove(U.$('left').getBoundingClientRect().width,200);assert.isAbove(U.$('right').getBoundingClientRect().width,200);
   U.p.ui.ribbonPinned=false;U.writingRibbon.collapse({force:true});assert.isTrue(U.writingRibbon.drawer.hidden,'默认自动收起');const left=U.$('left').getBoundingClientRect().toJSON(),right=U.$('right').getBoundingClientRect().toJSON(),canvas=U.$('canvas').getBoundingClientRect().toJSON();
   const nav=doc().querySelector('.writing-ribbon-tabs');ribbon.dispatchEvent(new (fw().PointerEvent)('pointerenter',{pointerType:'mouse'}));assert.isFalse(U.writingRibbon.drawer.hidden,'悬停工具区域直接展开');nav.querySelector('[data-ribbon-tab=home]').click();assert.deepEqual(U.$('left').getBoundingClientRect().toJSON(),left);assert.deepEqual(U.$('right').getBoundingClientRect().toJSON(),right);const expandedCanvas=U.$('canvas').getBoundingClientRect(),drawer=U.writingRibbon.drawer.getBoundingClientRect();assert.isAtLeast(expandedCanvas.top,drawer.bottom-1,'工具区占用文章栏空间，不覆盖正文');assert.closeTo(expandedCanvas.bottom,canvas.bottom,1,'正文底部保持原位');const navBounds=nav.getBoundingClientRect(),barBounds=doc().querySelector('.writing-ribbon-bar').getBoundingClientRect();assert.closeTo((navBounds.left+navBounds.right)/2,(barBounds.left+barBounds.right)/2,1,'常用、插入和查找标签居中');
   for(const control of toolbar().querySelectorAll('button,select')){const rect=control.getBoundingClientRect();assert.isAbove(rect.height,20);assert.isAtLeast(rect.left,bounds.left-1);assert.isAtMost(rect.right,bounds.right+1,'每个控件都在窄窗口内');}
   U.$('left').dispatchEvent(new (fw().PointerEvent)('pointerdown',{bubbles:true}));assert.isTrue(U.writingRibbon.drawer.hidden,'点击素材栏自动收起且不拦截该点击');nav.querySelector('[data-ribbon-tab=insert]').click();U.writingRibbon.pin.click();await wait(()=>U.p.ui.ribbonPinned,'固定工具栏');U.$('right').dispatchEvent(new (fw().PointerEvent)('pointerdown',{bubbles:true}));assert.isFalse(U.writingRibbon.drawer.hidden,'固定后点击详情栏保持展开');assert.equal(U.writingRibbon.pin.getAttribute('aria-pressed'),'true');assert.isTrue(U.$('manual-writing-tools').hidden);assert.isFalse(doc().querySelector('.manuscript-insert-actions').hidden);assert.isAbove(doc().querySelector('[aria-label="插入公式"]').getBoundingClientRect().height,35);U.writingRibbon.pin.click();await wait(()=>!U.p.ui.ribbonPinned);
   nav.querySelector('[data-ribbon-tab=find]').click();assert.isAbove(U.writingRibbon.query.getBoundingClientRect().height,25);assert.equal(doc().activeElement,U.writingRibbon.query);assert.equal(JSON.stringify(U.p.blocks),before,'切换工具页不改正文');
   await snapshotFixture('ribbon-narrow.png');
   const selectedID=U.p.ui.blockID;U.writingRibbon.query.dispatchEvent(new (fw().KeyboardEvent)('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.isTrue(U.writingRibbon.drawer.hidden);assert.equal(U.p.ui.blockID,selectedID,'收起工具栏不清除正文模块选择');
  }finally{win.resizeTo(1600,1000);U.writingRibbon.setTab('home');U.applyPanels();await Zotero.Promise.delay(150);}
 });
 it('typesets authored inline math for reading and copies LaTeX, while editing and saving preserve rich runs and source text',async()=>{
  U.writingRibbon.collapse({force:true});
  const block=U.M.block('paragraph',U.p.sections[0].id,{text:'人工正文：独立批次条件 $x_i$。',runs:[{text:'人工正文：',bold:true},{text:'独立批次条件 $x_'},{text:'i',italic:true},{text:'$。'}]});U.p.ui.caret=null;install([block]);const node=editable(block.id),original=JSON.stringify(block.runs);
  await wait(()=>node.dataset.mathPreview==='true'&&node.querySelector('.katex'),'正文数学排版');assert.equal(node.querySelector('annotation').textContent,'x_i');assert.equal(node.contentEditable,'false');assert.equal(block.text,'人工正文：独立批次条件 $x_i$。');assert.equal(JSON.stringify(block.runs),original,'排版 DOM 不进入保存的正文');
  const range=doc().createRange();range.selectNodeContents(node);fw().getSelection().removeAllRanges();fw().getSelection().addRange(range);const copy=new (fw().ClipboardEvent)('copy',{bubbles:true,cancelable:true});node.dispatchEvent(copy);assert.isTrue(copy.defaultPrevented);assert.equal(copy.clipboardData.getData('text/plain'),block.text,'复制完整正文保留原 LaTeX');
  const partial=doc().createRange();partial.selectNodeContents(node.querySelector('.katex-html'));fw().getSelection().removeAllRanges();fw().getSelection().addRange(partial);const partialCopy=new (fw().ClipboardEvent)('copy',{bubbles:true,cancelable:true});node.dispatchEvent(partialCopy);assert.isTrue(partialCopy.defaultPrevented);assert.equal(partialCopy.clipboardData.getData('text/plain'),'$x_i$','从排版内部选取也复制完整LaTeX表达式');
  node.focus();assert.equal(node.contentEditable,'true');assert.isFalse(!!node.querySelector('.katex'),'编辑恢复源码后再计算选区与格式');assert.equal(node.textContent,block.text);assert.exists(node.querySelector('strong'),'人工富文本保留');assert.exists(node.querySelector('em'),'公式内人工样式也保留');node.querySelector('em span').textContent='i^2';dispatch(node,'input');assert.equal(block.text,'人工正文：独立批次条件 $x_i^2$。');assert.equal(block.runs[0].bold,true);
  U.$('left-tabs').querySelector('button').focus();await wait(()=>node.dataset.mathPreview==='true'&&node.querySelector('annotation')?.textContent==='x_i^2','编辑失焦后重新排版');await U.persist({flush:true});const saved=E.manuscripts.get(projectID).blocks.find(row=>row.id===block.id);assert.equal(saved.text,block.text);assert.equal(saved.runs[0].bold,true);assert.equal(saved.runs.map(run=>run.text).join(''),saved.text);assert.notInclude(JSON.stringify(saved),'katex');await snapshotFixture('authored-inline-math.png');
  U.p.ui.caret=block.text.indexOf('$x_')+2;U.renderEditor();const restored=editable(block.id);assert.equal(restored.contentEditable,'true');assert.isFalse(!!restored.querySelector('.katex'));assert.equal(restored.textContent,block.text);const cursor=fw().getSelection().getRangeAt(0),prefix=cursor.cloneRange();prefix.selectNodeContents(restored);prefix.setEnd(cursor.startContainer,cursor.startOffset);assert.equal(prefix.toString().length,U.p.ui.caret,'重绘先恢复源码，再按源码偏移恢复光标');
  const list=U.M.block('list',U.p.sections[0].id,{text:'条件 $x_i$\n结果 $y_i^2$',listStyle:'bullet'});U.p.ui.caret=null;install([list]);const listNode=editable(list.id);assert.lengthOf(listNode.querySelectorAll('.katex'),2);const listRange=doc().createRange();listRange.selectNodeContents(listNode);fw().getSelection().removeAllRanges();fw().getSelection().addRange(listRange);const listCopy=new (fw().ClipboardEvent)('copy',{bubbles:true,cancelable:true});listNode.dispatchEvent(listCopy);assert.equal(listCopy.clipboardData.getData('text/plain'),list.text,'列表复制保留各项换行及原 LaTeX');assert.equal(listNode.contentEditable,'false');
 });
 it('finds across real rich text and lists, replaces only unlocked user text, and preserves sources and undo',async()=>{
  const material=sourceMaterial(),links=[{id:material.id,role:'primary',revision:material.revision}],section=U.p.sections[0].id;
  const first=U.M.block('paragraph',section,{text:'条件 xi 条件',runs:[{text:'条件 ',bold:true},{text:'x',italic:true},{text:'i',sub:true},{text:' 条件'}],materials:links}),locked=U.M.block('paragraph',section,{text:'条件锁定',locked:true}),list=U.M.block('list',section,{text:'第一行\n条件第二行',listStyle:'bullet'});
  install([first,locked,list],[material]);const source=JSON.stringify(material),original=JSON.stringify(U.p.blocks);U.writingRibbon.setTab('find');U.writingRibbon.query.value='条件';dispatch(U.writingRibbon.query,'input');U.writingRibbon.find(-1);
  assert.equal(U.p.ui.blockID,list.id,'上一处首次从最后一个列表匹配开始');assert.equal(fw().getSelection().toString(),'条件','列表换行的位置与保存正文一致');
  U.writingRibbon.replacement.value='边界';doc().querySelector('[data-writing-find=replaceAll]').click();assert.equal(first.text,'边界 xi 边界');assert.equal(list.text,'第一行\n边界第二行');assert.equal(locked.text,'条件锁定');assert.isTrue(first.runs.some(run=>run.text==='i'&&run.sub));assert.isTrue(first.runs.some(run=>run.text==='x'&&run.italic));assert.equal(JSON.stringify(material),source);assert.deepEqual(first.materials,links);
  await U.persist();assert.equal(E.manuscripts.get(projectID).blocks.find(block=>block.id===first.id).text,first.text);
  U.writingRibbon.setTab('home');command('undo').click();assert.equal(JSON.stringify(U.p.blocks),original,'替换所有属于同一个可撤销操作');assert.equal(JSON.stringify(U.p.materials[0]),source);
  await snapshotFixture('ribbon-rich-replace.png');
 });
 it('finds the correct live DOM characters after soft line breaks and nested paragraph breaks',()=>{
  const block=U.M.block('paragraph',U.p.sections[0].id,{text:'first'});install([block]);const node=editable(block.id);
  node.append(doc().createElement('br'),doc().createTextNode('条件'));dispatch(node,'input');assert.equal(block.text,'first\n条件');U.writingRibbon.setTab('find');U.writingRibbon.query.value='条件';U.writingRibbon.find();assert.equal(fw().getSelection().toString(),'条件');
  const nested=doc().createElement('div');nested.textContent='范围';node.append(nested);dispatch(node,'input');assert.equal(block.text,'first\n条件\n范围');U.writingRibbon.query.value='范围';U.writingRibbon.find();assert.equal(fw().getSelection().toString(),'范围');U.writingRibbon.setTab('home');
 });
});
