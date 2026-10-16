/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Research conversation glass surface',function(){
 this.timeout(30000);
 let hostWin,fixtureFrame,win,doc,surface,orb,left,right,outside,folder,states=[],selected=[],sent=[],attached=[],removed=[],sourceOpened=[],fileDragged=[],sendHook;
 const pause=()=>Zotero.Promise.delay(80);
 const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(fn())return;await Zotero.Promise.delay(50);}throw Error('等待'+label+'超时');};
 const value={id:'surface-fixture-one',title:'当前论文的研究讨论',mode:'auto',thinkingLevel:'off',messages:[{id:'surface-answer',role:'assistant',text:'待验证假设：隔离训练和测试来源。',sources:[{title:'真实位置接口',attachmentID:123,pageIndex:2}]}],attachments:[]};
 const node=(tag,css)=>{const element=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);element.style.cssText=css||'';doc.documentElement.append(element);return element;};
 const event=(target,type,point={x:100,y:100},extra={})=>target.dispatchEvent(new win.PointerEvent(type,{bubbles:true,pointerId:97,button:0,clientX:point.x,clientY:point.y,...extra}));
 const capture=async name=>{
  const image=await hostWin.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');
  try{const canvas=doc.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}
  finally{image.close();}
 };
 before(async()=>{
  hostWin=await loadZoteroPane();
  // Reader toolbar callbacks may still mount the app's own conversation in
  // the main document. Give this standalone widget its own native document.
  fixtureFrame=hostWin.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');fixtureFrame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;background:white';fixtureFrame.srcdoc='<!doctype html><html><head><meta charset="utf-8"></head><body><span hidden>isolated-conversation-fixture</span></body></html>';hostWin.document.documentElement.append(fixtureFrame);
  await wait(()=>fixtureFrame.contentDocument?.body?.textContent.includes('isolated-conversation-fixture'),'独立的原生HTML组件Document');win=fixtureFrame.contentWindow;doc=win.document;
  folder=PathUtils.join(Zotero.DataDirectory.dir,'conversation-surface-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  assert.equal(doc.querySelectorAll('.conversation-surface').length,0,'组件Document最初不包含应用窗口的共享对话');
  orb=node('button','position:fixed;left:380px;top:140px;width:40px;height:40px');
  left=node('section','position:fixed;left:4px;top:90px;width:220px;height:430px;background:white');
  right=node('section','position:fixed;right:4px;top:90px;width:230px;height:430px;background:white');
  outside=node('button','position:fixed;left:250px;top:95px');outside.textContent='测试外部区域';
  const module=ChromeUtils.importESModule('chrome://zotero/content/research/shared/conversation-surface.mjs');
  surface=module.installConversationSurface({doc,orb,state:{x:300,y:190,width:420,height:420},dockTargets:()=>[{id:'left',label:'批注',element:left},{id:'right',label:'详情',element:right}],onState:value=>states.push(value),getModels:async()=>[{id:'model-one',label:'已配置模型一'},{id:'model-two',label:'已配置模型二'}],onSelectSession:id=>selected.push(id),onSend:async(text,options)=>{sent.push({text,...options});if(sendHook)return sendHook(text,options);},onSource:source=>sourceOpened.push(source),onAttach:async(payload,meta)=>{attached.push({payload,meta});return [{id:'material:test',title:'研究图示',kind:'image'}];},onDragAttachment:(item,event)=>fileDragged.push({item,type:event.type}),onRemoveAttachment:async(id,meta)=>{removed.push({id,meta});return [];}});
  const captures=new Set();surface.root.setPointerCapture=id=>captures.add(id);surface.root.hasPointerCapture=id=>captures.has(id);surface.root.releasePointerCapture=id=>captures.delete(id);
  surface.render(value,[value,{id:'surface-fixture-two',title:'第二研究对话',messages:[]}]);surface.show();await pause();
 });
 after(()=>{surface?.destroy();for(const element of [orb,left,right,outside])element?.remove();fixtureFrame?.remove();hostWin?.close();});
 it('uses the real CLUI compact shell, expands normal replies and enlarges clicked content without focusout collapse',async()=>{
  const root=surface.root,shell=root.querySelector('.clui-native-shell'),body=root.querySelector('.clui-native-body');
  assert.equal(root.dataset.cluiSize,'compact');assert.isTrue(body.inert);assert.equal(win.getComputedStyle(shell).marginBottom,'-14px');
  const compact=root.getBoundingClientRect();assert.isAtMost(compact.height,210,'默认仅保留重叠页签与输入胶囊');assert.closeTo(shell.getBoundingClientRect().width,compact.width-30,1,'紧凑卡片两边各缩进15px');
  surface.setExpanded(true,{detail:false});await wait(()=>win.getComputedStyle(shell).marginBottom==='10px','展开动效完成');const normal=root.getBoundingClientRect();assert.equal(root.dataset.cluiSize,'conversation');assert.isFalse(body.inert);assert.isAbove(normal.height,compact.height);assert.equal(win.getComputedStyle(shell).marginBottom,'10px');
  surface.input.click();await Zotero.Promise.delay(320);const detail=root.getBoundingClientRect();assert.equal(root.dataset.cluiSize,'detail');assert.isAbove(detail.height,normal.height);assert.isAtLeast(detail.width,normal.width);outside.focus();await pause();assert.equal(root.dataset.cluiSize,'detail','移走输入焦点不会自动折叠');
  await capture('shared-clui-clicked-detail');surface.setExpanded(true,{detail:false});
 });
 it('uses an aligned icon task control, custom session menu and explicit model and thinking controls',async()=>{
  const root=surface.root;
  assert.notExists(root.querySelector('select'),'研究浮层不再调用原生下拉框');
  const mode=root.querySelector('.conversation-surface-mode');assert.exists(mode.querySelector('svg'));assert.equal(mode.querySelector('span').textContent,'自动');
  root.querySelector('.conversation-surface-sessions').click();assert.isFalse(root.querySelector('.conversation-surface-session-menu').hidden);root.querySelector('[data-session-id="surface-fixture-two"]').click();assert.equal(selected.at(-1),'surface-fixture-two');
  root.querySelector('.conversation-surface-model-button').click();await pause();root.querySelector('[data-model="model-two"]').click();root.querySelector('.conversation-surface-strength-button').click();root.querySelector('[data-strength="high"]').click();
  surface.input.value='检查当前证据';root.querySelector('form').requestSubmit();await pause();assert.equal(sent.at(-1).modelID,'model-two');assert.equal(sent.at(-1).thinkingLevel,'high');
  assert.notEqual(win.getComputedStyle(root.querySelector('.clui-native-shell')).backdropFilter,'none','原生Gecko实际支持本地玻璃层');assert.equal(root.dataset.cluiSize,'conversation','发送使用正常对话高度');
 });
 it('uses the shared described research choices inside a real send and waits for explicit confirmation',async()=>{
  surface.undock({nearLogo:false});surface.render(value,[value]);surface.show();sourceOpened=[];let answer,resolved=false,request;
  const source={id:'material:surface-test-batches',title:'已读批次条件记录'},before=JSON.stringify(value);
  sendHook=async(_text,options)=>{request=options;answer=await options.onResearchQuestion({question:'先核对哪项实验条件？',options:[{label:'采集批次',description:'先比较训练与测试的采集时间。'},{label:'设备条件',description:'先核对设备型号与校准记录。'}],basis:'人工记录区分了批次与设备，先确认本次研究范围。',sources:[source]});resolved=true;};
  const hit=async node=>{node.scrollIntoView({block:'nearest'});await wait(()=>{const r=node.getBoundingClientRect(),target=doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>0&&r.height>0&&(target===node||node.contains(target));},'共享研究选择真实可点击');};
  try{
   surface.input.value='请提供实验条件核对选项。';surface.root.querySelector('form').requestSubmit();await wait(()=>surface.root.querySelector('.conversation-question-controls'),'真实发送显示共享选择控件');
   const card=surface.root.querySelector('.conversation-interaction-card'),controls=card.querySelector('.conversation-question-controls'),options=[...controls.querySelectorAll('.conversation-question-option')],confirm=controls.querySelector('.conversation-question-submit');
   assert.isFunction(request.onResearchQuestion,'发送协议提供当前会话的选择回调');assert.equal(card.dataset.sessionId,value.id);assert.lengthOf(options,2);assert.include(options[0].textContent,'训练与测试的采集时间');assert.isTrue(confirm.disabled);assert.isTrue(options.every(node=>node.getAttribute('aria-pressed')==='false'),'默认不代用户决定');
   await hit(options[0]);options[0].click();await pause();assert.equal(options[0].getAttribute('aria-pressed'),'true');assert.isFalse(confirm.disabled);assert.isFalse(resolved,'点选仅保留草稿，不自动回传给任务');assert.isUndefined(answer);assert.equal(JSON.stringify(value),before,'显示与选择不改来源和正文');
   const evidence=controls.querySelector('.conversation-question-source');assert.exists(evidence);await hit(evidence);evidence.click();await wait(()=>sourceOpened.length===1,'原始依据按钮回调');assert.strictEqual(sourceOpened[0],source);assert.isFalse(resolved,'查看依据不提交选择');
   await hit(confirm);assert.equal(win.getComputedStyle(options[0]).borderRadius,'10px','装配和普通研究对话使用共享圆角选项');assert.equal(win.getComputedStyle(options[0]).alignItems,'stretch');assert.equal(win.getComputedStyle(surface.root.querySelector('.conversation-interaction-host')).overflowY,'visible','选择卡片使用对话主滚动区，不叠加第二层滚动条');await capture('shared-described-research-options');confirm.click();await wait(()=>resolved&&!surface.root.querySelector('.conversation-interaction-card'),'显式确认完成当前选择');assert.deepEqual(answer,{answer:'采集批次'});assert.equal(JSON.stringify(value),before,'确认只回传选择，没有直接修改正文');
  }finally{surface.root.querySelector('.conversation-question-cancel')?.click();await pause();sendHook=null;surface.hide();surface.render(value,[value]);surface.show();}
 });
 it('keeps left-aligned selectable messages above a layered composer with non-interactive blurred edges',async()=>{
  const visual={...value,messages:[{id:'surface-question',role:'user',text:'核对这篇论文中训练与测试的数据划分。'},value.messages[0]]};surface.undock({nearLogo:false});surface.render(visual,[visual]);surface.show();surface.setExpanded(true);await pause();
  try{
   const root=surface.root,composer=root.querySelector('.conversation-surface-composer'),footer=root.querySelector('.conversation-surface-footer'),articles=[...surface.log.querySelectorAll('article')],composerRect=composer.getBoundingClientRect();
   for(const article of articles){assert.equal(win.getComputedStyle(article).textAlign,'left');assert.isAtMost(Math.abs(article.getBoundingClientRect().left-composerRect.left),1,'问题、回答和输入框使用相同的左侧排布');}
   assert.equal(win.getComputedStyle(articles[0]).alignSelf,'flex-start','用户消息不会漂到右边');
   assert.equal(win.getComputedStyle(root.querySelector('.conversation-surface-text')).fontFamily,win.getComputedStyle(surface.input).fontFamily,'消息和输入使用同一字体');
   for(const [element,pseudo] of [[surface.header,'::after'],[footer,'::before']]){const style=win.getComputedStyle(element,pseudo);assert.equal(style.pointerEvents,'none','渐隐层不遮挡选字、拖动与按钮');assert.notEqual(style.backdropFilter,'none');assert.include(style.maskImage,'linear-gradient');assert.equal(style.height,'18px');}
   for(const text of root.querySelectorAll('.conversation-surface-text')){assert.equal(win.getComputedStyle(text).filter,'none','模糊限定在滚动边缘，正文保持清晰');assert.equal(win.getComputedStyle(text).backdropFilter,'none');}
   assert.notEqual(win.getComputedStyle(footer).boxShadow,'none','输入胶囊底层和边缘具有独立层次');assert.isAtLeast(footer.getBoundingClientRect().top,surface.header.getBoundingClientRect().bottom+100,'消息区保持可用高度');
   const body=root.querySelector('.from-assistant .conversation-surface-text'),range=doc.createRange();range.selectNodeContents(body);doc.getSelection().addRange(range);assert.equal(doc.getSelection().toString(),value.messages[0].text);doc.getSelection().removeAllRanges();
   await capture('floating-shared-conversation');
   surface.dock('right');surface.header.querySelector('.conversation-surface-tabs button').click();assert.equal(win.getComputedStyle(surface.header,'::after').display,'none','切回原栏时一并移除消息区的渐隐层');surface.header.querySelectorAll('.conversation-surface-tabs button')[1].click();await pause();
   await capture('docked-shared-conversation');
  }finally{doc.getSelection().removeAllRanges();surface.undock({nearLogo:false});surface.render(value,[value]);}
 });
 it('dims on outside click, preserves pinned detail and collapses to a usable pill without blocking the original pane',async()=>{
  surface.undock({nearLogo:false});surface.setExpanded(true,{detail:true});outside.click();assert.equal(surface.root.dataset.unfocused,'true');assert.equal(surface.root.dataset.dimmed,'true');assert.equal(surface.root.dataset.cluiSize,'detail');
  surface.setPinned(true);outside.dispatchEvent(new win.MouseEvent('dblclick',{bubbles:true,button:0}));assert.equal(surface.root.dataset.cluiSize,'detail');assert.equal(surface.root.querySelector('.conversation-surface-pin').getAttribute('aria-pressed'),'true');
  surface.setPinned(false);outside.dispatchEvent(new win.MouseEvent('dblclick',{bubbles:true,button:0}));assert.isTrue(surface.isOpen,'双击保留输入栏');assert.equal(surface.root.dataset.cluiSize,'compact');assert.isFalse(orb.hidden);
  surface.dock('left');assert.isTrue(left.inert);outside.dispatchEvent(new win.MouseEvent('dblclick',{bubbles:true,button:0}));assert.isTrue(surface.isOpen);assert.equal(surface.docked,'left');assert.equal(surface.root.dataset.cluiSize,'compact');assert.isFalse(left.inert,'紧凑对话不会阻挡原素材/详情栏');assert.notEqual(win.getComputedStyle(left).visibility,'hidden');
 });
 it('hides the external logo while docked, restores original panes and drags back out with one persistence at completion',async()=>{
  const moved=[],follow=event=>{if(event.detail.orbPosition)moved.push(event.detail);};doc.addEventListener('easysch-conversation-statechange',follow);
  try{
  surface.dock('left');assert.isTrue(orb.hidden);assert.isTrue(left.inert);surface.root.querySelector('.conversation-surface-tabs button').click();assert.isFalse(left.inert);surface.root.querySelectorAll('.conversation-surface-tabs button')[1].click();
  const rect=surface.header.getBoundingClientRect(),start={x:rect.left+30,y:rect.top+20};states=[];
  event(surface.header,'pointerdown',start);event(surface.header,'pointermove',{x:450,y:240});event(surface.header,'pointermove',{x:490,y:270});await pause();
  assert.equal(states.length,0,'拖动帧只更新位置，不写会话或配置');assert.isFalse(orb.hidden);assert.equal(surface.docked,null);assert.isFalse(left.inert);
  assert.isAtLeast(moved.length,1,'拥有 Logo 的 Document 能收到拖出侧栏的位置事件');assert.equal(moved.at(-1).movement,'move');assert.isFalse(moved.at(-1).persistOrb);
  event(surface.header,'pointerup',{x:490,y:270});assert.equal(states.length,1);assert.equal(surface.root.dataset.dock,'floating');assert.equal(surface.root.dataset.dragging,undefined);
  assert.equal(moved.at(-1).movement,'end');assert.isTrue(moved.at(-1).persistOrb);
  const previous=moved.at(-1).orbPosition,startFloating=surface.header.getBoundingClientRect();states=[];event(surface.header,'pointerdown',{x:startFloating.left+60,y:startFloating.top+20});event(surface.header,'pointermove',{x:startFloating.left+100,y:startFloating.top+60});await pause();assert.notDeepEqual(moved.at(-1).orbPosition,previous,'继续移动浮动对话时 Logo 跟随');assert.equal(states.length,0);event(surface.header,'pointerup',{x:startFloating.left+100,y:startFloating.top+60});assert.equal(states.length,1);
  }finally{doc.removeEventListener('easysch-conversation-statechange',follow);}
 });
 it('syncs draft text without recreating task icons, attachment cards, session choices or rendered messages',async()=>{
  const session={...value,attachments:[{id:'stable-material',title:'保持选中状态的资料',kind:'image'}]};surface.render(session,[value]);
  const elements=[surface.root.querySelector('.conversation-surface-mode svg'),surface.root.querySelector('[data-attachment-id="stable-material"]'),surface.root.querySelector('[data-session-id="'+value.id+'"]'),surface.root.querySelector('[data-message-id="surface-answer"]')];
  surface.render({...session,draft:'继续核对这个公式'},[value],{sessionID:value.id,action:'update',fields:['draft']});
  const after=[surface.root.querySelector('.conversation-surface-mode svg'),surface.root.querySelector('[data-attachment-id="stable-material"]'),surface.root.querySelector('[data-session-id="'+value.id+'"]'),surface.root.querySelector('[data-message-id="surface-answer"]')];elements.forEach((element,index)=>assert.strictEqual(after[index],element));
  surface.render({...session,messages:[{...value.messages[0],text:'新的核验证据'}]},[value],{sessionID:value.id,action:'update',fields:['messages']});assert.equal(surface.root.querySelector('.conversation-surface-text').textContent,'新的核验证据');surface.render(value,[value]);
 });
 it('hides the original reader pane behind docked glass and exactly restores its paint and interaction styles',async()=>{
  surface.undock({nearLogo:false});const names=['visibility','pointer-events','padding-top'],prior=names.map(name=>[name,left.style.getPropertyValue(name),left.style.getPropertyPriority(name)]);
  try{left.style.setProperty('visibility','visible','important');left.style.setProperty('pointer-events','auto','important');left.style.setProperty('padding-top','7px','important');
   surface.dock('left');assert.equal(win.getComputedStyle(left).visibility,'hidden','原封面与摘要不透过 AI 玻璃层绘制');assert.equal(left.style.getPropertyPriority('visibility'),'important');assert.equal(win.getComputedStyle(surface.root).visibility,'visible','对话是原栏的兄弟节点，仍可见');
   surface.root.querySelector('.conversation-surface-tabs button').click();assert.equal(left.style.getPropertyValue('visibility'),'visible');assert.equal(left.style.getPropertyPriority('visibility'),'important');assert.equal(left.style.getPropertyValue('pointer-events'),'auto');
   surface.root.querySelectorAll('.conversation-surface-tabs button')[1].click();assert.equal(win.getComputedStyle(left).visibility,'hidden');surface.hide();assert.equal(left.style.getPropertyValue('visibility'),'visible');assert.equal(left.style.getPropertyPriority('visibility'),'important');assert.equal(left.style.getPropertyValue('padding-top'),'7px');assert.equal(left.style.getPropertyPriority('padding-top'),'important');assert.isFalse(left.inert);
   surface.dock('left');surface.undock({nearLogo:false});assert.equal(left.style.getPropertyValue('visibility'),'visible');assert.equal(left.style.getPropertyPriority('pointer-events'),'important');
  }finally{surface.undock({nearLogo:false});for(const [name,value,priority]of prior){if(value)left.style.setProperty(name,value,priority);else left.style.removeProperty(name);}}
 });
 it('keeps IME and message text selection distinct from mode and window dragging',async()=>{
  surface.render(value,[value]);surface.input.dispatchEvent(new win.CompositionEvent('compositionstart',{bubbles:true}));states=[];
  surface.input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Tab',keyCode:229,isComposing:true,bubbles:true,cancelable:true}));assert.equal(states.length,0);
  surface.input.dispatchEvent(new win.CompositionEvent('compositionend',{bubbles:true}));surface.input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(states.at(-1).mode,'search');
  const text=surface.root.querySelector('.conversation-surface-text');event(text,'pointerdown');event(text,'pointermove',{x:600,y:400});assert.notEqual(surface.root.dataset.dragging,'true');
 });
 it('selects answer text on the first gesture and drags its card only from blank space or its handle',async()=>{
  surface.render(value,[value]);await pause();const body=surface.root.querySelector('.conversation-surface-text'),article=body.closest('article'),grip=article.querySelector('.conversation-surface-message-grip'),selection=doc.getSelection(),range=doc.createRange();selection.removeAllRanges();range.selectNodeContents(body);const rect=range.getClientRects()[0],point={x:rect.left+3,y:rect.top+rect.height/2};
  event(body,'pointerdown',point);assert.isFalse(article.draggable,'首次在文字上按下即可选字，不先抢走整条回答');assert.notEqual(surface.root.dataset.dragging,'true');selection.addRange(range);assert.equal(selection.toString(),value.messages[0].text);
  const selectedText=new win.DataTransfer();selectedText.setData('text/plain',selection.toString());const nativeDrag=new win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:selectedText});body.dispatchEvent(nativeDrag);assert.isFalse(nativeDrag.defaultPrevented);assert.equal(selectedText.getData('text/plain'),value.messages[0].text);assert.equal(selectedText.getData('application/x-easysch-research-message'),'','选中文字仍是原生文字拖动');selection.removeAllRanges();
  const bounds=article.getBoundingClientRect();event(article,'pointerdown',{x:bounds.left+2,y:bounds.top+2});assert.isTrue(article.draggable,'回答卡片的留白区域可以拖动');const data=new win.DataTransfer(),start=new win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data});article.dispatchEvent(start);assert.isFalse(start.defaultPrevented);const payload=JSON.parse(data.getData('application/x-easysch-research-message'));assert.equal(payload.messageID,'surface-answer');assert.equal(payload.sessionID,value.id);assert.equal(Object.keys(payload).length,2,'拖动仅传稳定引用，不复制整篇论文的source正文');article.dispatchEvent(new win.DragEvent('dragend',{bubbles:true,dataTransfer:data}));assert.isFalse(article.draggable,'拖动结束即恢复选字行为');
  const handleData=new win.DataTransfer();assert.isTrue(grip.draggable);grip.dispatchEvent(new win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:handleData}));assert.equal(JSON.parse(handleData.getData('application/x-easysch-research-message')).messageID,'surface-answer');grip.dispatchEvent(new win.DragEvent('dragend',{bubbles:true,dataTransfer:handleData}));
 });
 it('renders real source buttons, formula notation and complete Chinese bold pairs without raw citation tokens',async()=>{
  const E=Zotero.Research,host=node('div'),source={id:'P1-L93',stableID:'evidence:paper:13:13:P1-L93',title:'Review of deep learning'},opened=[];
  try{E.renderContent(host,'**怎么理解它的价值： **它提供领域概览。[evidence:paper:13:13:P1-L93]\n\n**阅读时的注意点：**综述不是实测结果。变量为 $x_i^2$。',{sources:[source],onSource:row=>opened.push(row)});await E.prepareContentStyles(doc);assert.equal(host.querySelectorAll('strong').length,2);assert.isFalse(host.textContent.includes('**'));assert.isFalse(host.textContent.includes('evidence:paper:'));const citation=host.querySelector('.source-citation');assert.exists(citation);citation.click();assert.strictEqual(opened[0],source);assert.equal(host.querySelector('.katex annotation').textContent,'x_i^2');}finally{host.remove();}
 });
 it('accepts existing material references and files, ignores answer-message drops, and removes only the conversation reference',async()=>{
  const data=new win.DataTransfer();data.setData('application/x-manuscript-material','existing-material-id');surface.root.dispatchEvent(new win.DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));assert.equal(surface.root.dataset.attachmentDrop,'true');assert.equal(win.getComputedStyle(surface.root.querySelector('.conversation-surface-drop-hint')).display,'flex','仅支持的资料类型显示落点反馈');surface.root.dispatchEvent(new win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));await pause();assert.deepEqual(attached.at(-1).payload.materialIDs,['existing-material-id']);assert.equal(attached.at(-1).meta.sessionID,value.id);assert.exists(surface.root.querySelector('[data-attachment-id="material:test"]'));assert.isUndefined(surface.root.dataset.attachmentDrop);
  const card=surface.root.querySelector('[data-attachment-id="material:test"]'),grip=card.querySelector('.conversation-surface-attachment-grip');assert.isFalse(card.draggable,'资料名称可选字，卡片不抢走文字选择');assert.isTrue(grip.draggable);assert.equal(win.getComputedStyle(grip).cursor,'grab');grip.dispatchEvent(new win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new win.DataTransfer()}));assert.equal(fileDragged.at(-1).item.id,'material:test');grip.dispatchEvent(new win.DragEvent('dragend',{bubbles:true}));assert.isUndefined(card.dataset.dragging);
  const files=new win.DataTransfer();files.items.add(new win.File(['fixture-png'],'research.png',{type:'image/png'}));surface.root.dispatchEvent(new win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:files}));await pause();assert.equal(attached.at(-1).payload.files[0].name,'research.png');
  const before=attached.length,message=new win.DataTransfer();message.setData('application/x-easysch-research-message','{"messageID":"same-message"}');const unsupported=new win.DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:message});surface.root.dispatchEvent(unsupported);assert.isFalse(unsupported.defaultPrevented);assert.isUndefined(surface.root.dataset.attachmentDrop,'不支持的消息落点没有虚假提示');surface.root.dispatchEvent(new win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:message}));await pause();assert.equal(attached.length,before,'消息落点仍交由原PDF/素材流程处理');assert.include(surface.root.querySelector('input[type=file]').accept,'.xlsx');assert.include(surface.root.querySelector('input[type=file]').accept,'.xls');assert.include(surface.root.querySelector('input[type=file]').accept,'.csv');
  surface.root.querySelector('.conversation-surface-attachment-remove').click();await pause();assert.equal(removed.at(-1).id,'material:test');assert.isTrue(surface.root.querySelector('.conversation-surface-attachments').hidden);
 });
 it('temporarily embeds the same conversation in a locked evidence host and restores nested dock leases',async()=>{
  surface.undock({nearLogo:false});surface.render(value,[value]);surface.hide();await pause();const parent=surface.root.parentNode,stored={...surface.state},messages=[...surface.log.children],host=node('div','position:fixed;left:450px;top:100px;width:350px;height:410px');states=[];
  let readerMode,media;
  try{
   readerMode=surface.lockDock('right',{locked:true});assert.equal(surface.docked,'right');assert.isTrue(surface.state.locked);assert.isTrue(orb.hidden);assert.isTrue(right.inert);
   media=surface.mount(host,{locked:true});assert.strictEqual(surface.root.parentNode,host);assert.strictEqual(media.root,surface.root);assert.isTrue(surface.state.embedded);assert.isTrue(surface.root.querySelector('.conversation-surface-tabs').hidden);assert.isTrue(surface.root.querySelector('.conversation-surface-close').hidden);assert.isFalse(right.inert,'图表浮层不再屏蔽原侧栏');
   surface.root.querySelector('.conversation-surface-tabs button:first-child').click();assert.equal(surface.root.dataset.tab,'ai');assert.isFalse(surface.undock({nearLogo:false}));assert.isFalse(surface.dock('left'));event(surface.header,'pointerdown',{x:500,y:120});event(surface.root,'pointermove',{x:100,y:200});event(surface.root,'pointerup',{x:100,y:200});assert.notEqual(surface.root.dataset.dragging,'true');
   outside.click();outside.dispatchEvent(new win.MouseEvent('dblclick',{bubbles:true}));assert.isTrue(surface.isOpen);assert.deepEqual([...surface.log.children],messages,'保留同一消息节点');assert.equal(doc.querySelectorAll('.conversation-surface').length,1,'借用布局仍然只有一个共享对话');assert.lengthOf(states,0,'临时几何不写入已保存偏好');
   media.dispose();assert.equal(surface.docked,'right');assert.isTrue(surface.state.locked);assert.isTrue(right.inert);readerMode.dispose();assert.strictEqual(surface.root.parentNode,parent);assert.isFalse(surface.isOpen);assert.isFalse(surface.state.locked);assert.isFalse(surface.state.embedded);assert.isFalse(right.inert);assert.equal(surface.state.x,stored.x);assert.equal(surface.state.width,stored.width);media.dispose();readerMode.dispose();
  }finally{media?.dispose();readerMode?.dispose();host.remove();}
 });
 it('restores every live pane after an observed editor iframe navigates and is destroyed',async()=>{
  surface.hide();const iframe=doc.createElementNS('http://www.w3.org/1999/xhtml','iframe'),control=doc.createElementNS('http://www.w3.org/1999/xhtml','button'),prior={inert:left.inert,pointer:left.style.getPropertyValue('pointer-events'),priority:left.style.getPropertyPriority('pointer-events'),padding:left.style.getPropertyValue('padding-top')};iframe.srcdoc='<p>editor-before-navigation</p>';control.textContent='原栏功能';let clicks=0;control.onclick=()=>clicks++;left.append(iframe,control);
  try{
   await wait(()=>iframe.contentDocument?.body?.textContent.includes('editor-before-navigation'),'真实嵌套编辑页');const oldDocument=iframe.contentDocument;surface.dock('left');surface.show();assert.isTrue(left.inert);
   iframe.srcdoc='<p>editor-after-navigation</p>';await wait(()=>iframe.contentDocument?.body?.textContent.includes('editor-after-navigation'),'编辑iframe真实导航');const currentDocument=iframe.contentDocument;assert.notStrictEqual(currentDocument,oldDocument);await pause();iframe.remove();await pause();
   Zotero.debug('Conversation pane lifecycle '+JSON.stringify({oldDocumentDead:Components.utils.isDeadWrapper(oldDocument),removedDocumentDead:Components.utils.isDeadWrapper(currentDocument)}));
   assert.doesNotThrow(()=>surface.undock({nearLogo:false}),'销毁的编辑Document不能中断其余pane恢复');assert.strictEqual(left.inert,prior.inert);assert.equal(left.style.getPropertyValue('pointer-events'),prior.pointer);assert.equal(left.style.getPropertyPriority('pointer-events'),prior.priority);assert.equal(left.style.getPropertyValue('padding-top'),prior.padding);control.focus();assert.strictEqual(doc.activeElement,control);control.click();assert.equal(clicks,1,'恢复原栏操作');
   surface.dock('left');assert.isTrue(left.inert);control.click();assert.equal(clicks,1,'重新停靠后只屏蔽原栏');surface.hide();control.click();assert.equal(clicks,2,'再次收起后恢复原栏');assert.doesNotThrow(()=>surface.destroy(),'关闭浮层也能清理已销毁iframe的外部点击监听');assert.isFalse(surface.root.isConnected);
  }finally{iframe.remove();control.remove();}
 });
});
