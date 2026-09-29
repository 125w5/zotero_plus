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
			header:{l10nID:'easysch-paper-overview',icon:'chrome://zotero/skin/item-type/16/light/attachment-pdf.svg'},
			sidenav:{l10nID:'easysch-paper-overview',icon:'chrome://zotero/skin/item-type/16/light/attachment-pdf.svg'},
			onItemChange:({item,setEnabled})=>setEnabled(!!item&&(item.isRegularItem()||item.attachmentContentType==='application/pdf')),
			onRender:()=>{},
			onAsyncRender:({body,item})=>R.renderPaperOverview(body,item),
			onDestroy:({body})=>body._overviewOff?.()
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
			}
		});
		if (!R.sidebarID) throw new Error('科研侧栏注册失败');
	};
 R.installNavigation=win=>{
  const doc=win.document;if(!doc.getElementById('easysch-native-style')){const link=doc.createElementNS('http://www.w3.org/1999/xhtml','link');link.id='easysch-native-style';link.rel='stylesheet';link.href='chrome://zotero/content/research/surface-native.css';doc.documentElement.append(link);}
  const host=doc.getElementById('zotero-collections-pane');if(!host||doc.getElementById('easysch-home-navigation'))return;
  const nav=doc.createElementNS('http://www.w3.org/1999/xhtml','nav');nav.id='easysch-home-navigation';nav.setAttribute('aria-label','科研工作区');
  const group=doc.createElementNS('http://www.w3.org/1999/xhtml','details'),label=doc.createElementNS('http://www.w3.org/1999/xhtml','summary');group.className='native-workbench';group.open=true;label.textContent='工作台';group.append(label);nav.append(group);
  for(const [title,page]of [['文献阅读','research'],['文献搜集','search'],['论文装配','writing'],['组会 PPT','ppt']]){const b=doc.createElementNS('http://www.w3.org/1999/xhtml','button');b.textContent=title;b.dataset.page=page;b.onclick=async()=>{try{for(const n of nav.querySelectorAll('button'))n.classList.toggle('active',n===b);const ui=await R.openWorkflow(page);if(page==='ppt')await ui.openPPTStudio();}catch(e){Zotero.logError(e);}};group.append(b);}host.prepend(nav);
  const bottom=doc.createElementNS('http://www.w3.org/1999/xhtml','div');bottom.id='easysch-library-bottom';host.append(bottom);
  const {mountCalendar}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/compact-ui.mjs');win._researchCalendar=mountCalendar(bottom,R,{openSchedule:()=>R.openWorkflow('schedule')});
  const settings=doc.createElementNS('http://www.w3.org/1999/xhtml','button');settings.className='compact-settings';settings.textContent='⚙ 设置';settings.title='模型、翻译、期刊与论文模板';settings.onclick=()=>R.openWorkflow('settings');bottom.append(settings);
 };
 R.openPageMenu=(win,anchor,event)=>{
  const doc=win.document;doc.getElementById('easysch-new-page-menu')?.remove();const menu=doc.createXULElement('menupopup');menu.id='easysch-new-page-menu';doc.querySelector('popupset').append(menu);
  for(const [label,page,create]of [['文献阅读','research'],['文献搜集','search'],['论文装配','writing'],['新建论文项目','writing',true],['组会 PPT','ppt'],['日程','schedule']]){const item=doc.createXULElement('menuitem');item.setAttribute('label',label);item.addEventListener('command',async()=>{try{const ui=await R.openWorkflow(page);if(create)ui.$('new-manuscript')?.click();if(page==='ppt')await ui.openPPTStudio();}catch(e){Zotero.logError(e);}});menu.append(item);}
  menu.addEventListener('popuphidden',()=>menu.remove(),{once:true});if(event)menu.openPopupAtScreen(event.screenX,event.screenY,true);else menu.openPopup(anchor,'after_start');return menu;
 };
 R._overviewPages=new Map();
 R.firstPage=async attachment=>{
  const path=await attachment.getFilePathAsync(),stat=await IOUtils.stat(path),key=attachment.id+':'+stat.lastModified;
  if(!R._overviewPages.has(key)){
   const task=R.assets.page({attachmentID:attachment.id,pageIndex:0}).then(page=>R.previewImage(page.path));
   R._overviewPages.set(key,task);task.catch(()=>R._overviewPages.delete(key));
   if(R._overviewPages.size>16)R._overviewPages.delete(R._overviewPages.keys().next().value);
  }
  return R._overviewPages.get(key);
 };
 R.renderPaperOverview=async(host,item,{abstract=false}={})=>{
  if(host._overviewItem===item?.id&&host.querySelector('.paper-cover'))return;
   host._overviewOff?.();host._overviewHoverCleanup?.();host._overviewItem=item?.id;const token=host._overviewToken={};host.replaceChildren();
  const doc=host.ownerDocument,el=(tag,text,cls)=>{const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const box=el('section',undefined,'paper-overview'),info=el('small','正在读取首页…','overview-status');box.append(info);host.append(box);
  try{
   const attachment=await R.library.localPDF(item);if(host._overviewToken!==token||!host.isConnected)return;
   if(!attachment){info.textContent='暂无本地 PDF，保留题录与摘要';}
   else{
    const open=()=>R.library.openSource({attachmentID:attachment.id,pageIndex:0});
    const image=el('img');image.alt='论文 PDF 首页';image.className='paper-cover';image.src=await R.firstPage(attachment);if(host._overviewToken!==token||!host.isConnected)return;
     image.tabIndex=0;image.title='悬停放大首页；双击打开 PDF';image.ondblclick=open;image.onkeydown=e=>{if(e.key==='Enter')open();};
     let hoverTimer,popup;const closePreview=()=>{doc.defaultView.clearTimeout(hoverTimer);hoverTimer=null;popup?.remove();popup=null;};
     const showPreview=()=>{if(popup||!image.isConnected)return;const preview=el('div',undefined,'paper-cover-hover'),large=el('img');large.src=image.src;large.alt='论文 PDF 首页放大预览';preview.append(large);doc.documentElement.append(preview);popup=preview;
      const bounds=image.getBoundingClientRect(),width=Math.min(490,Math.max(290,doc.defaultView.innerWidth*.38)),spaceRight=doc.defaultView.innerWidth-bounds.right;
      preview.style.width=width+'px';preview.style.left=(spaceRight>width+18?bounds.right+10:Math.max(8,bounds.left-width-10))+'px';preview.style.top=Math.max(8,Math.min(bounds.top,doc.defaultView.innerHeight-12-Math.min(640,doc.defaultView.innerHeight*.78)))+'px';
     };
     const schedulePreview=()=>{doc.defaultView.clearTimeout(hoverTimer);hoverTimer=doc.defaultView.setTimeout(showPreview,260);};
     image.addEventListener('mouseenter',schedulePreview);image.addEventListener('mouseleave',closePreview);image.addEventListener('focus',schedulePreview);image.addEventListener('blur',closePreview);
     image.addEventListener('keydown',e=>{if(e.key==='Escape'){closePreview();e.stopPropagation();}});
     const onScroll=()=>closePreview();doc.defaultView.addEventListener('scroll',onScroll,true);host._overviewHoverCleanup=()=>{closePreview();doc.defaultView.removeEventListener('scroll',onScroll,true);};
     box.insertBefore(image,info);info.textContent='PDF 首页';
   }
  }catch(e){if(host._overviewToken===token){info.textContent='首页预览暂不可用：'+e.message;const retry=el('button','重试预览');retry.onclick=()=>{host._overviewItem=null;R.renderPaperOverview(host,item,{abstract});};box.append(retry);}}
  if(abstract&&host._overviewToken===token){const parent=item?.parentItem||item,summary=el('details',undefined,'overview-abstract');summary.append(el('summary','摘要'),el('p',parent?.getField('abstractNote')||'尚无摘要'));box.append(summary);}
 };
 R.renderSidebar=function(doc,body,originalItem){
  const previous=body.querySelector('.academic-chat');const targetID=originalItem?.parentID||originalItem?.id;if(previous?.dataset.researchItem===String(targetID)){previous._updateResearch?.();return;}
  body.closest('item-details')?.classList.remove('academic-focus');body.closest('item-pane-custom-section')?.classList.remove('academic-active-pane');body.replaceChildren();const item=originalItem?.parentID?Zotero.Items.get(originalItem.parentID):originalItem;if(!item)return;
  const el=(tag,text)=>{const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;return n;};
  const box=el('div');box.className='academic-chat';box.dataset.researchItem=String(item.id);const header=el('div');header.className='academic-chat-heading';header.append(el('strong','学术对话'),el('small','论文 · 批注 · 研究记忆'));
  const messages=el('div');messages.className='academic-chat-messages';const suggested=el('details');suggested.className='academic-chat-suggestions';const form=el('form'),prompt=el('textarea');prompt.dataset.aiPrompt='true';prompt.placeholder='针对论文提问，或讨论你的研究想法…';prompt.setAttribute('aria-label','学术对话');prompt.rows=3;const send=el('button','讨论这个问题');send.type='submit';send.className='primary';const status=el('div');status.className='academic-chat-status';status.setAttribute('role','status');const cancel=el('button','停止');cancel.type='button';cancel.hidden=true;cancel.onclick=()=>R.ai.cancel();form.append(prompt,send,cancel);box.append(header,messages,suggested,form,status);body.append(box);
  const details=body.closest('item-details');if(details){const abstract=details.querySelector('abstract-box');if(abstract&&!abstract.dataset.researchDefault){abstract.open=false;abstract.dataset.researchDefault='true';}const info=details.querySelector('info-box');if(info){let metric=info.querySelector('.research-paper-metric');if(!metric){metric=el('div');metric.className='research-paper-metric';info.querySelector('#info-table')?.before(metric);}const data=R.materialSourceInfo({paperItemID:item.id});metric.hidden=data.metric?.impact_factor==null;metric.textContent='影响因子：'+(data.metric?.impact_factor!=null?data.impact+' · '+data.metric.source:data.impact);}}
  const state=()=>R.paperConversation(item.id);let full=false,busy=false;
  const expand=()=>{if(full)return;full=true;box.classList.add('focused');if(details){const pane=body.closest('item-pane-custom-section');if(pane){details.classList.add('academic-focus');pane.classList.add('academic-active-pane');pane.open=true;pane.scrollIntoView({block:'start'});}}};
  const button=(label,fn,host)=>{const b=el('button',label);b.type='button';b.onclick=async()=>{try{await fn();}catch(e){status.textContent=e.message;}};host.append(b);return b;};
  const collapse=(focusInfo=false)=>{full=false;box.classList.remove('focused');details?.classList.remove('academic-focus');body.closest('item-pane-custom-section')?.classList.remove('academic-active-pane');if(focusInfo)details?.querySelector('info-box')?.scrollIntoView({block:'start'});};
  const infoButton=button('返回论文信息',()=>collapse(true),header);infoButton.className='academic-info-toggle';infoButton.title='返回论文信息（Esc）；对话自动保留';
  box.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopPropagation();if(busy)R.ai.cancel();collapse(true);}});
  if(!doc._researchExitChat){doc._researchExitChat=true;doc.addEventListener('click',e=>{const button=e.target.closest?.('item-pane-sidenav [data-pane],item-pane-sidenav [data-action]');if(button&&!String(button.dataset.pane||'').includes('research-workstation'))for(const chat of doc.querySelectorAll('.academic-chat.focused'))chat._collapse?.();},true);}
  box._collapse=collapse;box._expand=expand;
  const render=()=>{messages.replaceChildren();const turns=state().turns;for(const turn of turns.slice(-12)){const row=el('article');row.className='academic-turn';row.append(el('p',turn.question));const content=el('div');R.renderContent(content,R.core.resultMarkdown(turn.record),{sources:turn.record.sources,onSource:s=>R.library.openSource(s)});row.append(content);const more=el('details');more.append(el('summary','保存与记忆'));button('保存回答为笔记',async()=>{const id=await R.library.note(R.library.describe(item),turn.record);status.textContent='已保存为论文下的 Zotero 笔记';button('打开笔记',()=>Zotero.getActiveZoteroPane().selectItem(id),more);},more);button('记住这项研究决策',async()=>{await R.confirmPaperDecision(item.id,turn.question+'\n'+R.core.resultMarkdown(turn.record));status.textContent='已加入长期研究记忆，后续讨论会带入';},more);row.append(more);messages.append(row);}suggested.replaceChildren(el('summary','继续讨论'));if(!turns.length)messages.append(el('p','从论文与批注出发，讨论证据、实验设计和研究边界。'));for(const q of R.suggestPaperQuestions(item))button(q,()=>{prompt.value=q;form.requestSubmit();},suggested);if(turns.length>12){const older=el('details');older.append(el('summary','更早的讨论 · '+(turns.length-12)+' 条'));for(const t of turns.slice(0,-12)){const answer=el('div');R.renderContent(answer,R.core.resultMarkdown(t.record),{sources:t.record.sources,onSource:s=>R.library.openSource(s)});older.append(el('strong',t.question),answer);}messages.prepend(older);}};
  form.onsubmit=async e=>{e.preventDefault();if(busy||!prompt.value.trim())return;expand();const question=prompt.value;busy=true;send.disabled=true;cancel.hidden=false;try{await R.askPaper(item,question,text=>status.textContent=text);if(!box.isConnected)return;prompt.value='';render();status.textContent='回答与研究记忆已保存';messages.scrollTop=messages.scrollHeight;}catch(e){status.textContent=e.message;}finally{busy=false;send.disabled=false;cancel.hidden=true;}};
  prompt.addEventListener('focus',expand);prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();form.requestSubmit();}});render();
  const T=ChromeUtils.importESModule('chrome://zotero/content/research/shared/prompt-templates.mjs');if(!doc._researchPrompts){doc._researchPrompts=T.installPromptTemplates(doc,R,{selector:'.academic-chat [data-ai-prompt]'} )||true;}
  const evidence=el('details');evidence.className='academic-related';evidence.append(el('summary','关联证据与论文图表'));header.after(evidence);
  button('查看句间关联',()=>R.showSentenceLinks(doc,item.id,evidence),evidence);
  button('图片证据与中文解读',async()=>{const attachment=await R.library.localPDF(item);if(!attachment)throw Error('本机尚无 PDF，请先下载附件');await R.openImageEvidence(attachment.id);},evidence);
  box._updateResearch=()=>{if(!box.isConnected)return;const metric=details?.querySelector('.research-paper-metric'),data=R.materialSourceInfo({paperItemID:item.id});if(metric){metric.hidden=data.metric?.impact_factor==null;metric.textContent='影响因子：'+data.impact;metric.title=[data.journalContext?.journal,data.metric?.source,data.metric?.fetched_at,data.journalContext?.kind==='submitted'?'投稿封面所列期刊，不表示已发表':''].filter(Boolean).join(' · ');} };
  R.completePaperMetadata(item).then(()=>R.ensurePaperMetrics(item)).then(()=>box._updateResearch()).catch(e=>Zotero.logError(e));
 };
})(Zotero.Research);
