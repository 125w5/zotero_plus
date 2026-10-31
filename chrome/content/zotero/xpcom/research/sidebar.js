/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	const presets = {
		'日常整理': ['title', 'firstCreator', 'year', 'research_tags', 'research_impact_factor', 'research_journalTags', 'dateAdded'],
		'文献筛选': ['title', 'year', 'research_impact_factor', 'research_jcr_quartile', 'research_cas_large_category', 'research_metricInfo', 'research_relevance'],
		'组会准备': ['title', 'research_reading', 'research_question', 'research_meeting', 'research_ppt']
	};
	R.applyView = function (win, keys) {
		let tree = win.ZoteroPane.itemsView, prefs = { ...tree._getColumnPrefs() };
		for (let col of tree.getColumns()) {
			// Preserve third-party columns and their independent settings.
			if (col.pluginID) continue;
			prefs[col.dataKey] = { ...prefs[col.dataKey], hidden: !keys.includes(col.dataKey),
				ordinal: keys.includes(col.dataKey) ? keys.indexOf(col.dataKey) : 100 + (col.ordinal || 0) };
		}
		tree._storeColumnPrefs(prefs);
		tree._rowCache = {};
		// Rebuild cell DOM only after React has applied the new column order.
		return new Promise(resolve => tree.forceUpdate(() => { tree.tree?.invalidate(); resolve(); }));
	};
	R.addViewMenu = function (win) {
		let menu = win.document.createXULElement('menu');
		menu.id = 'easysch-views'; menu.setAttribute('label', '科研文献视图');
		let popup = win.document.createXULElement('menupopup'); menu.append(popup);
		for (let [label, keys] of Object.entries(presets)) {
			let option = win.document.createXULElement('menuitem'); option.setAttribute('label', label);
			option.addEventListener('command', () => R.applyView(win, keys)); popup.append(option);
		}
		win.document.getElementById('menu_ToolsPopup')?.append(menu);
	};
	R.registerSidebar = function () {
		R.overviewID = Zotero.ItemPaneManager.registerSection({
			paneID:'research-overview',pluginID:R.id,
			onInit:({paneID})=>{const key=`panes.${paneID}.easyschOverviewDefault`;if(Zotero.Prefs.get(key)!==2){Zotero.Prefs.set(`panes.${paneID}.open`,true);Zotero.Prefs.set(key,2);}},
			header:{l10nID:'easysch-paper-overview',icon:'chrome://zotero/skin/item-type/16/light/attachment-pdf.svg'},
			sidenav:{l10nID:'easysch-paper-overview',icon:'chrome://zotero/skin/item-type/16/light/attachment-pdf.svg'},
			onItemChange:({item,setEnabled})=>setEnabled(!!item&&(item.isRegularItem()||item.attachmentContentType==='application/pdf')),
			onRender:()=>{},
			onAsyncRender:({body,item})=>R.renderPaperOverview(body,item),
			onDestroy:({body})=>{body._overviewOff?.();body._overviewHoverCleanup?.();body._overviewToken=null;}
		});
		R.abstractID = Zotero.ItemPaneManager.registerSection({
			paneID:'research-abstract',pluginID:R.id,
			header:{l10nID:'section-abstract',icon:'chrome://zotero/skin/16/universal/abstract.svg'},
			sidenav:{l10nID:'sidenav-abstract',icon:'chrome://zotero/skin/16/universal/abstract.svg'},
			onItemChange:({item,setEnabled})=>setEnabled(!!item&&(item.isRegularItem()||item.attachmentContentType==='application/pdf')),
			onRender:()=>{},
			onAsyncRender:({body,item})=>R.renderPaperAbstract(body,item),
			onDestroy:({body})=>{body._abstractToken=null;}
		});
		R.sidebarID = Zotero.ItemPaneManager.registerSection({
			paneID: 'research-workstation', pluginID: R.id,
			header: { l10nID: 'easysch-section', icon: 'chrome://zotero/skin/20/universal/note.svg' },
			sidenav: { l10nID: 'easysch-sidenav', icon: 'chrome://zotero/skin/20/universal/note.svg' },
			onItemChange: ({ item, setEnabled }) => setEnabled(!!item && (item.isRegularItem() || item.isAttachment())),
			onRender: ({ doc, body, item }) => R.renderSidebar(doc, body, item),
			onToggle: ({ body, event }) => {
				if(event.target._restoringOpenState)return;
				const chat=body.querySelector('.academic-chat');
				if(event.target.open)chat?._expand?.();else chat?._collapse?.();
			},
			onDestroy: ({ body }) => body.querySelector('.academic-chat')?._disposeResearch?.()
		});
		if (!R.sidebarID) throw new Error('科研侧栏注册失败');
	};
 // Reading starts in the existing library: selection, filters and the native
 // item details remain available instead of opening an empty analysis form.
 R.openLibraryReading=async win=>{
  await R.openLibraryWorkspace(win,'local');
  const details=win.document.getElementById('zotero-item-details');
  const overview=details?.getPanes?.().find(p=>String(p.dataset.pane).includes('research-overview'));
  if(overview)await details.selectResearchPane(overview.dataset.pane);
  win.ZoteroPane.itemsView?.tree?.focus?.();
  return win.ZoteroPane;
 };
 R.installNavigation=win=>{
  const doc=win.document;if(!doc.getElementById('easysch-native-style')){const link=doc.createElementNS('http://www.w3.org/1999/xhtml','link');link.id='easysch-native-style';link.rel='stylesheet';link.href='chrome://zotero/content/research/surface-native.css';doc.documentElement.append(link);}
  const {installLibraryWorkspace}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/library-workspace.mjs');
  const workspace=installLibraryWorkspace(R,win,{Zotero});
  const host=doc.getElementById('zotero-collections-pane'),previous=doc.getElementById('easysch-home-navigation');if(!host||previous?._libraryWorkspace===workspace)return;if(previous){previous._dispose?.();previous.remove();}
  const nav=doc.createElementNS('http://www.w3.org/1999/xhtml','nav');nav.id='easysch-home-navigation';nav.setAttribute('aria-label','科研工作区');
  nav._libraryWorkspace=workspace;
  const node=(tag,cls,text)=>{const value=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(cls)value.className=cls;if(text!==undefined)value.textContent=text;return value;};
  const group=node('section','native-workbench');nav.append(group);
  const error=e=>Zotero.logError(e);
  // A failed or timed-out route has already restored the native list; say so,
  // or the click looks as if it did nothing. Closing the workspace is no error.
  // Clicks made while the first load is pending wait on that same load, so only
  // the latest open reports; the counter lives on the window because a rebuilt
  // navigation keeps the earlier 设置 and 日程 entries.
  const opening=async(title,open)=>{const token=win._researchOpenRequest=(win._researchOpenRequest||0)+1;try{await open();}catch(e){reportOpenFailure(title,e,token===win._researchOpenRequest);}};
  const reportOpenFailure=(title,e,latest=true)=>{if(e?.name==='AbortError')return;error(e);if(!latest)return;const reason=String(e?.message||e||'').replace(/[，,；;]?\s*请重试[。.]?$/u,'').replace(/[。.]$/u,'');try{Services.prompt.alert(win,'科研工作区',title+'未能打开'+(reason?'：'+reason:'')+'。已回到文库列表，请再点击一次“'+title+'”重试。');}catch(alertError){error(alertError);}};
  for(const [title,page]of [['研究对话','agent'],['文献检索','search'],['论文装配','writing'],['组会 PPT','ppt']]){const b=node('button',undefined,title);b.type='button';b.title=title;b.dataset.page=page;b.onclick=()=>opening(title,()=>workspace.show(page));group.append(b);}
  const offMode=workspace.subscribe(mode=>{const page=mode==='local'?'research':mode==='notebook'?'writing':mode;for(const b of group.querySelectorAll('[data-page]')){const active=b.dataset.page===page;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');}});
  let disposed=false;nav._dispose=()=>{if(disposed)return;disposed=true;offMode();};win.addEventListener('unload',nav._dispose,{once:true});host.prepend(nav);
  const collections=win.ZoteroPane.collectionsView;
  collections?.waitForLoad?.().then(async()=>{if(disposed)return;const selected=win.ZoteroPane.getCollectionTreeRows();if(selected.some(row=>!row.isLibrary?.(true)))return;for(let index=collections._rows.length-1;index>=0;index--){const row=collections.getRow(index);if(row.isLibrary?.(true)&&row.isOpen)await collections.toggleOpenState(index);}}).catch(error);
  if(doc.getElementById('easysch-library-bottom'))return;
  const bottom=doc.createElementNS('http://www.w3.org/1999/xhtml','div');bottom.id='easysch-library-bottom';host.append(bottom);
  const {mountCalendar}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/compact-ui.mjs');win._researchCalendar=mountCalendar(bottom,R,{openSchedule:()=>opening('日程',()=>R.openWorkflow('schedule'))});
  const toolbar=doc.getElementById('zotero-toolbar-collection-tree');if(toolbar){bottom.before(toolbar);toolbar.classList.add('native-library-search-tools');}
  const settings=doc.createElementNS('http://www.w3.org/1999/xhtml','button');settings.className='compact-settings';settings.textContent='⚙ 设置';settings.title='模型、翻译、期刊与论文模板';settings.onclick=()=>opening('设置',()=>R.openWorkflow('settings'));bottom.append(settings);
 };
 R.openLibraryWorkspace=(win,mode='local',options)=>{
  R.installNavigation(win);
  const {installLibraryWorkspace}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/library-workspace.mjs');
  return installLibraryWorkspace(R,win,{Zotero}).show(mode,options);
 };
 R.openPageMenu=(win,anchor,event)=>{
  const doc=win.document;doc.getElementById('easysch-new-page-menu')?.remove();const menu=doc.createXULElement('menupopup');menu.id='easysch-new-page-menu';doc.querySelector('popupset').append(menu);
  for(const [label,page,create]of [['文献检索','search'],['论文装配','writing'],['新建论文项目','writing',true],['组会 PPT','ppt'],['日程','schedule']]){const item=doc.createXULElement('menuitem');item.setAttribute('label',label);item.setAttribute('data-workflow-page',page);if(create)item.setAttribute('data-create-project','true');item.addEventListener('command',async()=>{try{await R.openWorkflowPage(page,{win,createProject:!!create});}catch(e){Zotero.logError(e);Services.prompt.alert(win,'新建页面',e.message);}});menu.append(item);}
  menu.addEventListener('popuphidden',()=>menu.remove(),{once:true});if(event)menu.openPopupAtScreen(event.screenX,event.screenY,true);else menu.openPopup(anchor,'after_start');return menu;
 };
 ChromeUtils.importESModule('chrome://zotero/content/research/shared/paper-overview.mjs').installPaperOverview(R,{Zotero,IOUtils});
 // The reader rail borrows the Logo's physical conversation surface. Keep a
 // small lifecycle marker for native section hooks, outside the mounted root
 // so legacy library composer selectors cannot restyle the shared controls.
 const renderReaderSidebar=(doc,body,item,reader)=>{
  const win=doc.defaultView,details=body.closest('item-details'),pane=body.closest('item-pane-custom-section');
  const marker=doc.createElementNS('http://www.w3.org/1999/xhtml','div');marker.className='academic-chat';marker.dataset.researchItem=String(item.id);marker.style.display='none';marker._readerResearch=reader;
  const host=doc.createElementNS('http://www.w3.org/1999/xhtml','div');host.className='academic-shared-host';host.hidden=true;host.style.cssText='position:relative;width:100%;min-width:0;height:420px;overflow:hidden;';
  const status=doc.createElementNS('http://www.w3.org/1999/xhtml','div');status.setAttribute('role','status');status.hidden=true;body.append(marker,host,status);
  let lease,pending,generation=0,disposed=false;
  const currentReader=()=>win.Zotero_Tabs?.selectedID===reader.tabID&&Zotero.Reader.getByTabID(reader.tabID)===reader&&details.tabID===reader.tabID;
  const selected=()=>!disposed&&marker.isConnected&&host.isConnected&&currentReader()&&details.researchActivePane===pane?.dataset.pane;
  const resize=()=>{
   if(!lease||!selected())return;const viewport=details._paneParent?.getBoundingClientRect(),rect=host.getBoundingClientRect();
   if(viewport?.height>180&&rect.top>=viewport.top-1)host.style.height=Math.max(160,Math.floor(viewport.bottom-rect.top-8))+'px';lease.surface.refresh();
  };
  const release=()=>{
   generation++;pending=null;const prior=lease;lease=null;prior?.dispose();
   if(prior&&!currentReader())prior.surface.hide();host.hidden=true;status.hidden=true;marker.classList.remove('focused');
  };
  const expand=()=>{
   if(!selected()){release();return Promise.resolve(null);}host.hidden=false;marker.classList.add('focused');
   if(lease){resize();return Promise.resolve(lease);}if(pending)return pending;
   const token=++generation;status.hidden=true;
   const job=R.mountReaderAcademicChat(reader,host,{locked:true}).then(value=>{
    if(token!==generation||!selected()){value.dispose();return null;}
    lease=value;resize();return value;
   }).catch(error=>{if(token===generation&&selected()){status.textContent=error.message;status.hidden=false;}return null;}).finally(()=>{if(pending===job)pending=null;});
   pending=job;return job;
  };
  const changing=event=>{if(event.target===details&&event.detail?.paneID!==pane?.dataset.pane)release();};
  const close=event=>{event.stopPropagation();release();details.selectResearchPane('info').catch(Zotero.logError);};
  const tabChanged=()=>{if(!currentReader())release();else if(selected())expand();};
  const notifier=Zotero.Notifier.registerObserver({notify:tabChanged},['tab'],'easysch-reader-dialogue');
  const selection=new win.MutationObserver(()=>{if(selected())expand();else release();});selection.observe(details,{attributes:true,attributeFilter:['data-easysch-active-pane']});
  const removal=new win.MutationObserver(()=>{if(!marker.isConnected||!details.isConnected)marker._disposeResearch();});removal.observe(doc.documentElement,{childList:true,subtree:true});
  const dimensions=new win.ResizeObserver(resize);if(details._paneParent)dimensions.observe(details._paneParent);
  const unload=event=>{if(event.target===doc||event.target===win)marker._disposeResearch();};
  details.addEventListener('easysch-research-pane-changing',changing);host.addEventListener('easysch-conversation-close-request',close);win.addEventListener('unload',unload);
  marker._collapse=release;marker._expand=expand;marker._updateResearch=()=>{if(selected())expand();else release();};
  marker._disposeResearch=()=>{
   if(disposed)return;release();disposed=true;selection.disconnect();removal.disconnect();dimensions.disconnect();Zotero.Notifier.unregisterObserver(notifier);
   details.removeEventListener('easysch-research-pane-changing',changing);host.removeEventListener('easysch-conversation-close-request',close);win.removeEventListener('unload',unload);
  };
  if(selected())expand();
 };
 R.renderSidebar=function(doc,body,originalItem){
  const detailsHost=body.closest('item-details'),reader=detailsHost?.tabID&&Zotero.Reader.getByTabID(detailsHost.tabID);
  const previous=body.querySelector('.academic-chat');const targetID=originalItem?.parentID||originalItem?.id;if(previous?.dataset.researchItem===String(targetID)&&previous._readerResearch===(reader||undefined)){previous._updateResearch?.();return;}
  previous?._disposeResearch?.();body.closest('item-details')?.classList.remove('academic-focus');body.closest('item-pane-custom-section')?.classList.remove('academic-active-pane');body.replaceChildren();const item=originalItem?.parentID?Zotero.Items.get(originalItem.parentID):originalItem;if(!item)return;
  if(reader&&reader._window===doc.defaultView){renderReaderSidebar(doc,body,item,reader);return;}
  const el=(tag,text)=>{const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;return n;};
  const box=el('div');box.className='academic-chat';box.dataset.researchItem=String(item.id);const header=el('div');header.className='academic-chat-heading';header.hidden=true;
  const messages=el('div');messages.className='academic-chat-messages';const suggested=el('details');suggested.className='academic-chat-suggestions';const form=el('form'),prompt=el('textarea');prompt.dataset.aiPrompt='true';prompt.placeholder='针对论文提问，或讨论你的研究想法…';prompt.setAttribute('aria-label','学术对话');prompt.rows=3;const send=el('button','发送');send.type='submit';send.className='primary';const status=el('div');status.className='academic-chat-status';status.setAttribute('role','status');const cancel=el('button','停止');cancel.type='button';cancel.hidden=true;
  const composerBrand=el('div');composerBrand.className='academic-composer-brand';const composerSymbol=el('span');composerSymbol.className='easysch-symbol academic-symbol';composerSymbol.setAttribute('aria-hidden','true');composerBrand.append(composerSymbol,el('small','EasySch'));
  form.append(prompt,composerBrand,send,cancel);box.append(header,messages,suggested,form,status);body.append(box);
  const details=body.closest('item-details');if(details){const abstract=details.querySelector('abstract-box');if(abstract&&!abstract.dataset.researchDefault){abstract.open=false;abstract.dataset.researchDefault='true';}const info=details.querySelector('info-box');if(info){let metric=info.querySelector('.research-paper-metric');if(!metric){metric=el('div');metric.className='research-paper-metric';info.querySelector('#info-table')?.before(metric);}const data=R.materialSourceInfo({paperItemID:item.id});metric.hidden=data.metric?.impact_factor==null;metric.textContent='影响因子：'+(data.metric?.impact_factor!=null?data.impact+' · '+data.metric.source:data.impact);}}
  const S=R.workbenchConversations,state=()=>S?.getForScope({paperID:item.id});let full=false,busy=false,disposed=false,taskController=null,draftTimer,observer,lastTranscript='',currentSession,sessionChoices='';
  const interactionTools=ChromeUtils.importESModule('chrome://zotero/content/research/shared/conversation-interactions.mjs'),interactions=interactionTools.installConversationInteractions({doc,host:box,renderContent:(host,text)=>R.renderContent(host,text),onSource:source=>R.library.openSource({...source,...source.anchor}),onOpen:()=>expand(),onError:error=>{status.textContent=error.message;}});form.before(interactions.root);
  const execution=el('select');execution.setAttribute('aria-label','应用操作权限');execution.title='直接执行：完成本轮明确要求的操作；询问：写入前逐次确认';for(const [id,label]of [['auto','直接执行'],['ask','询问']]){const option=el('option',label);option.value=id;execution.append(option);}execution.onchange=()=>{const current=state();if(current)S.update(current.id,{executionMode:execution.value},{origin:'academic'}).catch(error=>{status.textContent=error.message;});};send.before(execution);
  const expand=()=>{if(full)return;full=true;header.hidden=false;box.classList.add('focused');if(details){const pane=body.closest('item-pane-custom-section');if(pane){details.classList.add('academic-focus');pane.classList.add('academic-active-pane');pane.open=true;pane.scrollIntoView({block:'start'});}}};
  const button=(label,fn,host)=>{const b=el('button',label);b.type='button';b.onclick=async()=>{try{await fn();}catch(e){status.textContent=e.message;}};host.append(b);return b;};
  const collapse=(focusInfo=false)=>{full=false;header.hidden=true;box.classList.remove('focused');details?.classList.remove('academic-focus');body.closest('item-pane-custom-section')?.classList.remove('academic-active-pane');if(focusInfo)details?.querySelector('info-box')?.scrollIntoView({block:'start'});};
  const infoButton=button('返回',()=>collapse(true),header);infoButton.className='academic-info-toggle';infoButton.title='返回论文信息（Esc）；对话自动保留';
  const sessions=el('select');sessions.className='academic-session-select';sessions.setAttribute('aria-label','切换或新建对话');header.append(sessions);
  const refreshSessions=(current=currentSession||state())=>{const rows=S?.list({summary:true})||[],signature=JSON.stringify([current?.id,current?.isDraft,rows.map(session=>[session.id,session.title])]);if(signature===sessionChoices)return;sessionChoices=signature;sessions.replaceChildren();const option=(value,title)=>{const node=el('option',title);node.value=value;return node;};if(current?.isDraft)sessions.append(option(current.id,'新对话'));for(const session of rows)sessions.append(option(session.id,session.title||'研究对话'));sessions.append(option('__new__','＋ 新建对话'));sessions.value=current?.id||'__new__';};
  sessions.onchange=async()=>{if(disposed||!box.isConnected)return;if(busy){refreshSessions();return;}const selectedID=sessions.value;try{doc.defaultView.clearTimeout(draftTimer);const current=state();if(current)await S.update(current.id,{draft:prompt.value},{origin:'academic'});if(disposed||!box.isConnected)return;if(selectedID==='__new__')await R.openPaperConversation(item,{fresh:true});else await S.select(selectedID,{scope:{paperID:item.id}});if(disposed||!box.isConnected)return;render();prompt.focus();}catch(error){if(!disposed&&box.isConnected)status.textContent=error.message;}};
  box.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopPropagation();if(busy)taskController?.abort();collapse(true);}});cancel.onclick=()=>taskController?.abort();
  if(!doc._researchExitChat){doc._researchExitChat=true;doc.addEventListener('click',e=>{const button=e.target.closest?.('item-pane-sidenav [data-pane],item-pane-sidenav [data-action]');if(button&&!String(button.dataset.pane||'').includes('research-workstation'))for(const chat of doc.querySelectorAll('.academic-chat.focused'))chat._collapse?.();},true);}
  box._collapse=collapse;box._expand=expand;
  const renderMessage=message=>{
   const row=el('article');row.className='academic-turn';row.dataset.turnId=message.id;
   if(message.role==='user'){const question=el('div');question.className='academic-message user';question.append(el('small','你'),el('p',message.text||''));row.append(question);return row;}
   const answer=el('div');answer.className='academic-message assistant';const answerHead=el('div');answerHead.className='academic-message-head';const symbol=el('span');symbol.className='easysch-symbol academic-symbol';symbol.setAttribute('aria-hidden','true');answerHead.append(symbol,el('small','EasySch'));
   const content=el('div');content.className='academic-message-content';R.renderContent(content,message.text||'',{sources:message.sources||[],onSource:s=>R.library.openSource({...s,...s.anchor})});
   const more=el('details');more.className='academic-message-actions';const moreTitle=el('summary','⋯');moreTitle.title='保存回答或研究决策';moreTitle.setAttribute('aria-label',moreTitle.title);more.append(moreTitle);
   let noteID=message.savedNoteID;const noteButton=button(noteID?'打开笔记':'保存为笔记',async()=>{
    more.open=false;const saved=noteID&&Zotero.Items.get(noteID);if(saved&&!saved.deleted){await R.showLibraryItem(noteID);return;}
    const current=state(),result=await R.saveResearchMessageNote(message,{sessionID:current.id,projectID:current.projectID||''});noteID=result.noteID;await S.update(current.id,{messages:[{id:message.id,savedNoteID:noteID}]},{origin:'academic'});noteButton.textContent='打开笔记';status.textContent='已保存为笔记';
   },more);
   button('记为研究决策',async()=>{more.open=false;await R.confirmPaperDecision(item.id,message.text);status.textContent='已保存研究决策';},more);
   more.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){more.open=false;moreTitle.focus();e.stopPropagation();}});
   answerHead.append(more);answer.append(answerHead,content);row.append(answer);return row;
  };
  const render=(session=state())=>{
   if(disposed||!box.isConnected)return;
   currentSession=session;const turns=session?.messages||[];interactions.setSession(session?.id);execution.value=session?.executionMode||'auto';refreshSessions(session);if(!busy&&doc.activeElement!==prompt)prompt.value=session?.draft||'';
   const signature=JSON.stringify([session?.id,turns]);if(signature===lastTranscript)return;lastTranscript=signature;const nearBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<60;
   messages.replaceChildren();for(const message of turns.slice(-24))messages.append(renderMessage(message));
   const key=R.core.paperKey(R.library.describe(item)),records=(R.store.peek?R.store.peek('papers',key,'records'):R.store.get('papers',key,'records'))||[],savedQuestions=R.paperConversation(item.id).questions||[],questions=savedQuestions.length?savedQuestions:records.at(-1)?.result.questions||[];
   suggested.replaceChildren(el('summary','继续讨论'));suggested.hidden=!questions.length;for(const q of questions.slice(0,3))button(q,()=>{prompt.value=q;form.requestSubmit();},suggested);
   if(turns.length>24){const older=el('details');older.className='academic-older';older.append(el('summary','更早的讨论 · '+(turns.length-24)+' 条'));let loaded=false;older.addEventListener('toggle',()=>{if(older.open&&!loaded){loaded=true;for(const message of turns.slice(0,-24))older.append(renderMessage(message));}});messages.prepend(older);}if(nearBottom)messages.scrollTop=messages.scrollHeight;
  };
  form.onsubmit=async e=>{e.preventDefault();if(disposed||!box.isConnected||busy||!prompt.value.trim())return;expand();const question=prompt.value;doc.defaultView.clearTimeout(draftTimer);busy=true;send.disabled=true;sessions.disabled=true;cancel.hidden=false;taskController=new doc.defaultView.AbortController();try{const session=state()||await R.openPaperConversation(item);if(disposed||!box.isConnected)return;interactions.setSession(session.id);prompt.value='';await R.askPaperShared(item,question,text=>{if(!disposed&&box.isConnected)status.textContent=text;},{sessionID:session.id,signal:taskController.signal,executionMode:execution.value||session.executionMode||'auto',onToolPermission:value=>interactions.requestToolPermission({...value,sessionID:session.id}),onResearchQuestion:value=>interactions.requestResearchQuestion({...value,sessionID:session.id})});if(disposed||!box.isConnected)return;render();status.textContent='';messages.scrollTop=messages.scrollHeight;}catch(e){if(!disposed&&box.isConnected){if(!prompt.value)prompt.value=question;status.textContent=e.message;}}finally{busy=false;interactions.cancel();if(!disposed&&box.isConnected){send.disabled=false;sessions.disabled=false;cancel.hidden=true;}taskController=null;}};
  prompt.addEventListener('input',()=>{if(disposed||!box.isConnected)return;doc.defaultView.clearTimeout(draftTimer);const id=currentSession?.id||state()?.id,text=prompt.value;if(id)draftTimer=doc.defaultView.setTimeout(()=>{draftTimer=null;if(disposed||!box.isConnected)return;S.update(id,{draft:text},{origin:'academic'}).catch(error=>{if(!disposed&&box.isConnected)status.textContent=error.message;});},160);});
  const off=S?.subscribe((snapshot,meta)=>{
   if(disposed||!box.isConnected)return;if(!snapshot?.sessions){render();return;}
   const next=S.getForScope({paperID:item.id},snapshot);
   if(meta&&next?.id===currentSession?.id&&meta.sessionID!==currentSession?.id){if(['rename','remove','create-draft','migration'].includes(meta.action)||meta.fields?.includes('messages')||meta.fields?.includes('title'))refreshSessions(next);return;}
   render(next&&!Array.isArray(next.messages)?S.get(next.id):next);
  },{summary:true,sessionID:()=>currentSession?.id});box._disposeResearch=()=>{if(disposed)return;disposed=true;interactions.destroy();off?.();doc.defaultView.clearTimeout(draftTimer);draftTimer=null;taskController?.abort();observer?.disconnect();doc.defaultView.removeEventListener('unload',box._disposeResearch);};
  observer=new doc.defaultView.MutationObserver(()=>{if(!box.isConnected)box._disposeResearch();});observer.observe(body,{childList:true});doc.defaultView.addEventListener('unload',box._disposeResearch,{once:true});
  R.openPaperConversation(item,{activate:false}).then(()=>{if(!disposed&&box.isConnected)render();}).catch(error=>{if(!disposed&&box.isConnected)status.textContent=error.message;});
  prompt.addEventListener('focus',expand);prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();form.requestSubmit();}});render();
  const T=ChromeUtils.importESModule('chrome://zotero/content/research/shared/prompt-templates.mjs');if(!doc._researchPrompts){doc._researchPrompts=T.installPromptTemplates(doc,R,{selector:'.academic-chat [data-ai-prompt]'} )||true;}
  // Image evidence has its own single rail destination. Only actual sentence
  // links belong in this optional conversation context; do not add another
  // image button or an empty evidence workflow here.
  const evidence=el('details');evidence.className='academic-related';const evidenceTitle=el('summary');evidence.append(evidenceTitle);header.after(evidence);
  let evidenceRevision;const updateEvidence=()=>{const revision=R.store.branchRevision?.('sentenceLinks');if(revision!==undefined&&revision===evidenceRevision)return;evidenceRevision=revision;const links=Object.values(R.store.get('sentenceLinks')||{}).filter(link=>link.from.paperID===item.id||link.to.paperID===item.id);evidence.hidden=!links.length;evidenceTitle.textContent='关联语句 · '+links.length;if(evidence.open&&links.length)R.showSentenceLinks(doc,item.id,evidence);};
  evidence.addEventListener('toggle',()=>{if(evidence.open)R.showSentenceLinks(doc,item.id,evidence);});updateEvidence();
  box._updateResearch=()=>{if(!box.isConnected)return;updateEvidence();const metric=details?.querySelector('.research-paper-metric'),data=R.materialSourceInfo({paperItemID:item.id});if(metric){metric.hidden=data.metric?.impact_factor==null;metric.textContent='影响因子：'+data.impact;metric.title=[data.journalContext?.journal,data.metric?.source,data.metric?.fetched_at,data.journalContext?.kind==='submitted'?'投稿封面所列期刊，不表示已发表':''].filter(Boolean).join(' · ');} };
  R.completePaperMetadata(item).then(()=>R.ensurePaperMetrics(item)).then(()=>box._updateResearch()).catch(e=>Zotero.logError(e));
 };
})(Zotero.Research);
