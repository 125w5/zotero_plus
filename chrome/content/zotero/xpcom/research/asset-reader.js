/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
	E.installAssetReader = () => {
		E.assetToolbar = ({ reader, doc, append }) => {
			if (reader.type !== 'pdf') return;
			let button = doc.createElement('button'); button.textContent = '论文图表'; button.title = '图片证据：完整原图、中文解读与原文位置'; button.className = 'easysch-assets-open';
			button.style.cssText = 'width:auto;padding:4px 9px;font:inherit;color:inherit;';
			button.addEventListener('click', () => E.openImageEvidence(reader.itemID)); append(button);
			// The second open performs a content hash check and reuses the material index.
			E.assets.index(reader.itemID, () => {}).then(() => E.attachAssetHover(reader)).catch(() => {});
		};
		Zotero.Reader.registerEventListener('renderToolbar', E.assetToolbar, E.id);
	};
	E.openAssetPanel = (reader, focusID, host) => {
		const {normalizeEvidenceOrder,sortEvidence,evidenceKindLabel}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/evidence-order.mjs');
		const {visibleReaderEvidence}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reader-evidence-detail.mjs');
		const {evidenceSummary}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/evidence-summary.mjs');
		const orderPref='research.images.order.'+reader.itemID;
		let order;try{order=normalizeEvidenceOrder(JSON.parse(Zotero.Prefs.get(orderPref)||'{}'));}catch{order=normalizeEvidenceOrder();}
		let doc = host?.ownerDocument || reader._iframeWindow.document, previous = host?.querySelector('#easysch-asset-panel') || (!host && doc.getElementById('easysch-asset-panel'));
		if (previous) { if (focusID) previous.focusAsset?.(focusID); return previous; }
		if(!doc.querySelector('[data-easysch-image-evidence-style]')){
			const link=doc.createElementNS('http://www.w3.org/1999/xhtml','link');link.rel='stylesheet';link.href='chrome://zotero/content/research/reader-image-evidence.css';link.dataset.easyschImageEvidenceStyle='true';(doc.head||doc.documentElement).append(link);
		}
		let panel = doc.createElementNS('http://www.w3.org/1999/xhtml','section'); panel.id = 'easysch-asset-panel'; panel.setAttribute('aria-label', '图片证据链');
		if (host) panel.className = 'embedded-evidence';
		let style = doc.createElementNS('http://www.w3.org/1999/xhtml','style'); style.textContent = ChromeUtils.importESModule('chrome://zotero/content/research/shared/asset-style.mjs').assetReaderStyle; panel.append(style);
		const el = (tag, text, parent = panel) => { let n = doc.createElementNS('http://www.w3.org/1999/xhtml',tag); if (text) n.textContent = text; parent.append(n); return n; };
		const action = (label, fn, parent = panel) => { let b = el('button', label, parent); b.type='button'; b.onclick = fn; return b; };
		const iconAction = (label, kind, fn, parent) => {
			const button=action('',fn,parent);button.title=label;button.setAttribute('aria-label',label);button.className='asset-icon-button';
			const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
			const path=doc.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',kind==='sort'?'M4 5h16l-6 7v6l-4 2v-8L4 5Z':kind==='note'?'M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h5':kind==='locate'?'M12 3v4m0 10v4M3 12h4m10 0h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM12 10v4m-2-2h4':kind==='expand'?'m9 5 7 7-7 7':'M5 12h.01M12 12h.01M19 12h.01');svg.append(path);button.append(svg);return button;
		};
		let header=el('header');el('strong', '图片证据',header);
		let unsubscribe,preview,previewOrigin,previewAnchor,previewTimer,hoverTimer,menuCleanup,disposed=false;const images=new Map(),rowTimers=new Map(),motions=new Map(),noteTasks=new Map();const closeMenu=()=>{menuCleanup?.();menuCleanup=null;};const previewEscape=event=>{if(event.key==='Escape'&&preview){event.preventDefault();event.stopPropagation();closePreview();}};const cancelPreviewTimers=()=>{doc.defaultView.clearTimeout(previewTimer);doc.defaultView.clearTimeout(hoverTimer);previewTimer=hoverTimer=null;};
		const closePreview=()=>{cancelPreviewTimers();doc.removeEventListener('keydown',previewEscape,true);const origin=previewOrigin,restore=!disposed&&preview?.contains(doc.activeElement)&&origin?.isConnected;previewAnchor?.removeAttribute('aria-describedby');preview?.remove();preview=previewOrigin=previewAnchor=null;if(restore)origin.focus({preventScroll:true});};
		const stopRows=()=>{for(const timer of rowTimers.values())doc.defaultView.clearTimeout(timer);rowTimers.clear();for(const animation of motions.values())animation.cancel();motions.clear();};const close=()=>{panel.dispose();panel.remove();if(host){const section=host.closest('item-pane-custom-section');if(section)section.open=false;}else doc.querySelector('.easysch-assets-open')?.focus();};panel.closePanel=close;
		action('关闭',close,header);panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
		let status = el('p', '正在读取图表…'); status.className='asset-status';status.setAttribute('role', 'status');
		let controls = el('div');controls.className='asset-task-actions';
		let searchRow=el('div');searchRow.className='asset-search-row asset-filter-row';
		let filter=el('select','',searchRow);filter.setAttribute('aria-label','素材类型');filter.title='筛选图表类型';
		for(let [value,label] of [['all','全部'],['figure','图片'],['table','表格'],['manual','裁切']]){let o=el('option',label,filter);o.value=value;}
		let body = el('div'); body.className = 'easysch-asset-list';
		const markGroups=()=>{let last;for(const card of body.children){delete card.dataset.groupHeading;if(card.hidden)continue;const label=evidenceKindLabel(card.dataset.kind);if(order.group==='type'&&last!==label)card.dataset.groupHeading=label;last=label;}};
		const applyFilter=()=>{for(let card of body.children)card.hidden=!(filter.value==='all'||card.dataset.kind===filter.value||(filter.value==='manual'&&card.dataset.manual==='true'));markGroups();};
		const applyOrder=()=>{const focused=doc.activeElement,rows=new Map([...body.children].map(card=>[card.dataset.assetId,card]));for(const asset of sortEvidence(result?.assets||[],order)){const card=rows.get(String(asset.id));if(card){body.append(card);rows.delete(String(asset.id));}}panel.dataset.order=order.direction;panel.dataset.group=order.group;sortButton.title='排序与分组：'+(order.direction==='desc'?'原文倒序':'原文顺序')+(order.group==='type'?' · 按类型':'');sortButton.setAttribute('aria-label',sortButton.title);applyFilter();if(body.contains(focused))focused.focus({preventScroll:true});};
		const sortButton=iconAction('排序与分组','sort',()=>{
			closeMenu();const menu=el('div','',panel);menu.className='asset-context-menu asset-order-menu';menu.setAttribute('role','menu');sortButton.setAttribute('aria-expanded','true');
			for(const [label,key,value]of [['按原文顺序','direction','asc'],['按原文倒序','direction','desc'],['按类型分组','group','type']]){
				const item=action(label,()=>{order=normalizeEvidenceOrder({...order,[key]:key==='group'&&order.group==='type'?'none':value});Zotero.Prefs.set(orderPref,JSON.stringify(order));applyOrder();closeMenu();sortButton.focus({preventScroll:true});},menu);
				item.dataset.orderValue=value;item.setAttribute('role',key==='group'?'menuitemcheckbox':'menuitemradio');item.setAttribute('aria-checked',String(order[key]===value));
			}
			const rect=sortButton.getBoundingClientRect();menu.style.left=Math.max(6,Math.min(rect.right-menu.offsetWidth,doc.defaultView.innerWidth-menu.offsetWidth-6))+'px';menu.style.top=Math.max(6,Math.min(rect.bottom+5,doc.defaultView.innerHeight-menu.offsetHeight-6))+'px';
			const dismiss=event=>{if(!menu.contains(event.target)&&event.target!==sortButton)closeMenu();};menuCleanup=()=>{menu.remove();sortButton.setAttribute('aria-expanded','false');doc.removeEventListener('pointerdown',dismiss,true);};doc.addEventListener('pointerdown',dismiss,true);menu.querySelector('button')?.focus();
			menu.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu();sortButton.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...menu.querySelectorAll('button')],at=items.indexOf(doc.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}};
		},searchRow);sortButton.classList.add('asset-order-button');sortButton.setAttribute('aria-haspopup','menu');sortButton.setAttribute('aria-expanded','false');
		filter.onchange=applyFilter;
		let current, retryAction, result;
		const run = async fn => {
			if (current||disposed) return;
			retryAction = fn; current = new doc.defaultView.AbortController(); cancel.hidden = false; retry.hidden = true;
			status.hidden=false;try { await fn(current.signal, text => {status.hidden=false;status.textContent = text;}); }
			catch (e) { status.hidden=false;status.textContent = current.signal.aborted ? '已取消；已确认的素材仍保留' : '未完成：' + e.message; retry.hidden = false; }
			finally { current = null; cancel.hidden = true; }
		};
		let cancel = action('取消当前任务', () => current?.abort(), controls); cancel.hidden = true;
		let retry = action('重试未完成部分', () => run(retryAction), controls); retry.hidden = true;
		const navigate=asset=>Promise.resolve().then(()=>reader.navigate({pageIndex:asset.pageIndex,position:E.assets.position(asset)})).catch(error=>{status.hidden=false;status.textContent='定位 PDF 原图失败：'+error.message;});
		const saveAsNote=asset=>{
			closePreview();if(noteTasks.has(asset.id))return noteTasks.get(asset.id);const card=[...body.children].find(n=>n.dataset.assetId===String(asset.id)),button=card?.querySelector('.asset-save-note');if(button)button.disabled=true;
			const pending=(async()=>{if(!disposed){status.hidden=false;status.textContent='正在保存完整图片与来源…';}try{const saved=await E.saveAssetNote(asset);if(!disposed){status.hidden=false;status.textContent=saved.warning||(saved.reused?'已打开已有图片笔记':'已保存完整图片笔记');}return saved;}catch(error){if(!disposed){status.hidden=false;status.textContent='图片笔记保存失败：'+error.message;}throw error;}finally{noteTasks.delete(asset.id);if(button?.isConnected)button.disabled=false;}})();noteTasks.set(asset.id,pending);pending.catch(()=>{});return pending;
		};
		const imageSource=path=>{if(!path)return Promise.reject(Error('原图路径暂不可用'));if(!images.has(path)){const pending=Promise.resolve().then(()=>E.previewImage(path));images.set(path,pending);pending.catch(()=>{if(images.get(path)===pending)images.delete(path);});}return images.get(path);};
		const assetLabel=asset=>String(asset.label||'图片').replace(/^Fig(?:ure)?\.?\s*/i,'图 ').replace(/^Tab(?:le)?\.?\s*/i,'表 ').replace(/^(?:Eq(?:uation)?|Formula)\.?\s*/i,'公式 ').replace(/^(图|表|公式)\s+(\d)/,'$1$2');
		const showHoverPreview=async(asset,anchor)=>{
			if(disposed||!anchor?.isConnected||preview&&!preview.classList.contains('is-hover-preview'))return;
			closePreview();const popup=el('aside','',doc.documentElement),viewer=el('div','',popup);popup.className='easysch-image-preview is-hover-preview';popup.dataset.assetId=String(asset.id);popup.id='easysch-asset-hover-'+Zotero.Utilities.randomString(8);popup.setAttribute('role','tooltip');viewer.className='asset-hover-content';
			el('small',`${assetLabel(asset)} · 第 ${asset.page} 页`,viewer).className='asset-hover-heading';const image=el('img','',viewer);image.alt=asset.caption||asset.label;image.className='asset-hover-image';
			const win=doc.defaultView,place=()=>{
				if(preview!==popup||!anchor.isConnected)return;
				const bounds=anchor.getBoundingClientRect(),maxWidth=Math.max(1,Math.min(360,win.innerWidth-24)),maxHeight=Math.max(1,Math.min(320,win.innerHeight*.48)),aspect=(image.naturalWidth&&image.naturalHeight?image.naturalWidth/image.naturalHeight:asset.width>0&&asset.height>0?asset.width/asset.height:1);
				popup.style.width=Math.min(maxWidth,Math.max(160,Math.min(maxWidth-20,maxHeight*aspect)+20))+'px';image.style.maxHeight=maxHeight+'px';const size=popup.getBoundingClientRect(),right=win.innerWidth-bounds.right,left=right>=size.width+18?bounds.right+10:bounds.left-size.width-10;
				popup.style.left=Math.max(12,Math.min(left,win.innerWidth-size.width-12))+'px';popup.style.top=Math.max(12,Math.min(bounds.top,win.innerHeight-size.height-12))+'px';
			};
			preview=popup;previewAnchor=anchor;anchor.setAttribute('aria-describedby',popup.id);doc.addEventListener('keydown',previewEscape,true);place();
			try{const source=await imageSource(asset.path||asset.thumbnail);if(preview===popup){image.onload=place;image.src=source;place();}}catch(error){if(preview===popup)closePreview();}
		};
		const showPreview=async(asset,{hover=false}={})=>{
			if(hover)return showHoverPreview(asset,[...body.children].find(card=>card.dataset.assetId===String(asset.id))?.querySelector('.asset-preview-trigger'));
			if(disposed)return;closePreview();const origin=[...body.children].find(card=>card.dataset.assetId===String(asset.id))?.querySelector('.asset-preview-trigger');
			try{return await E.openReaderEvidenceDetail(reader,asset,{origin,imageSource});}catch(error){if(!disposed){status.hidden=false;status.textContent='原图打开失败：'+error.message;}}
		};
		const load = (force = false) => run(async (signal, update) => {
			result = await E.assets.index(reader.itemID, update, signal, force); if(disposed)return;await render();
			status.textContent = visibleReaderEvidence(result.assets).length?'':'这篇论文暂未提取到可用图表';status.hidden=!!visibleReaderEvidence(result.assets).length;
			E.attachAssetHover(reader);
			E.assets.queueImages(reader.itemID).catch(e=>{if(!disposed){status.hidden=false;status.textContent='图片整理未完成：'+e.message;}});
		});
		const materialSummary=m=>!m?'':!m.imageExplanation&&!m.userEdited&&!['verified','confirmed'].includes(m.verification)&&['pending','running','failed'].includes(m.generationStatus)?'':m.summary||'';
		const loadThumbnail=(image,path,fallback)=>{
			if(image.dataset.loaded)return;image.dataset.loaded='true';
			const unavailable=()=>{if(image.isConnected){delete image.dataset.loaded;image.alt='缩略图暂不可用，可打开原图核对';image.title='缩略图暂不可用 · 单击查看原图';}};
			imageSource(path).catch(error=>{if(!fallback||fallback===path)throw error;return imageSource(fallback);}).then(source=>{if(!disposed&&image.isConnected&&image.closest('.asset-evidence-row')?.dataset.expanded!=='true')image.src=source;}).catch(unavailable);
		};
		panel.focusAsset=id=>{
			focusID=id;const card=[...body.children].find(n=>n.dataset.assetId===String(id));if(!card){const asset=result?.assets.find(a=>String(a.id)===String(id));if(asset)void showPreview(asset);return;}
			const asset=result?.assets.find(a=>a.id===id||String(a.id)===String(id));if(!asset)return;
			if(card.hidden){filter.value='all';applyFilter();}
			card.scrollIntoView({block:'center'});void showPreview(asset);
		};
		const refreshEvidence=()=>{
			if(disposed||!panel.isConnected){unsubscribe?.();return;}
			const state=E.assets.imageState(reader.itemID);
			if(state){const pending=['running','queued'].includes(state.status),failed=['partial','failed'].includes(state.status),available=visibleReaderEvidence(result?.assets).length;status.hidden=!pending&&!failed&&!!available;status.textContent=pending?`正在整理中文说明 · ${state.completed||0}/${state.total||'…'}`:failed?`部分说明未完成 · ${state.error||'可重试'}`:available?'':'这篇论文暂未提取到可用图表';imageRetry.hidden=!failed;}
			for(const card of body.children){
				const asset=result?.assets.find(a=>String(a.id)===card.dataset.assetId),m=asset&&E.assets.materialFor(asset);if(!asset)continue;
				card.dataset.generationStatus=m?.generationStatus||'pending';card.dataset.verification=m?.verification||'unverified';
				const brief=card.querySelector('.asset-row-summary');if(brief)brief.textContent=evidenceSummary(m,{limit:76})||'图表说明待整理';if(card.dataset.expanded==='true')card.refreshExplanation?.();
			}
			applyFilter();
		};
		const imageRetry=action('重试图片说明',()=>{E.assets.queueImages(reader.itemID).catch(e=>{status.textContent=e.message;});},controls);imageRetry.hidden=true;
		const render = async () => {
			stopRows();closeMenu();closePreview();body.replaceChildren();
			for (const asset of sortEvidence(visibleReaderEvidence(E.assets.uniqueAssets(result.assets)),order)) {
				let card = el('article', '', body);card.className='asset-evidence-row';card.dataset.assetId = asset.id;card.dataset.sourceKey=E.assets.sourceKey(asset);card.dataset.kind=asset.kind;card.dataset.manual=String(!!asset.userModified);
				const heading=el('div','',card);heading.className='asset-row-heading';
				const toggle=iconAction('展开图表与解读','expand',()=>card.toggleExpanded?.(),heading);toggle.classList.add('asset-row-toggle');toggle.setAttribute('aria-expanded','false');
				const text=el('span','',heading);text.className='asset-row-text';const titleline=el('span','',text);titleline.className='asset-row-titleline';
				el('span',assetLabel(asset),titleline).className='asset-row-label';
				const thumbnail=el('span','',titleline);thumbnail.className='asset-row-thumbnail';el('span',evidenceSummary(E.assets.materialFor(asset),{limit:76})||'图表说明待整理',text).className='asset-row-summary';el('small',`第 ${asset.page} 页`,heading).className='asset-row-page';
				const actions=el('div','',heading);actions.className='asset-row-actions';iconAction('保存完整图片为笔记','note',()=>saveAsNote(asset),actions).classList.add('asset-save-note');
				const content=el('div','',card);content.className='asset-row-content';content.hidden=true;
				content.id='asset-row-content-'+body.children.length;
				toggle.setAttribute('aria-controls',content.id);
				let expandedReady=false,explanationRevision;
				card.refreshExplanation=()=>{
					const material=E.assets.materialFor(asset),key=JSON.stringify([material?.revision,material?.summary,material?.imageExplanation]);if(key===explanationRevision)return;explanationRevision=key;
					const target=content.querySelector('.asset-inline-explanation');if(!target)return;const wasOpen=target.querySelector('details')?.open;target.replaceChildren();
					const renderText=(host,text)=>E.renderContent?E.renderContent(host,text,{sources:material?.imageExplanation?.sources||[],onSource:source=>E.library.openSource({...source,...source.anchor})}):host.textContent=text;
					const brief=evidenceSummary(material,{limit:120});if(brief)renderText(el('div','',target),brief);
					if(material?.imageExplanation?.result?.sections?.length||material?.summary&&material.summary!==brief){const full=el('details','',target);full.className='asset-inline-detail';full.open=!!wasOpen;el('summary','详细解读',full);if(material?.summary)renderText(el('div','',full),material.summary);for(const section of material?.imageExplanation?.result?.sections||[]){const group=el('section','',full);if(section.heading)el('h3',section.heading,group);renderText(el('div','',group),section.body||'');}}
					if(!target.childElementCount)el('p',material?.generationError?'图表解读暂未完成':'正在整理图表解读…',target);
				};
				card.toggleExpanded=(open=card.dataset.expanded!=='true')=>{
					if(disposed||!card.isConnected)return;closePreview();const prior=motions.get(card);prior?.cancel();motions.delete(card);card.dataset.expanded=String(open);toggle.setAttribute('aria-expanded',String(open));toggle.title=open?'收起图表与解读':'展开图表与解读';toggle.setAttribute('aria-label',toggle.title);
					if(open&&!expandedReady){expandedReady=true;const visual=el('img','',content);visual.className='asset-inline-image';visual.alt=asset.caption||asset.label;visual.tabIndex=0;visual.setAttribute('role','button');visual.title='查看原图与详细解读';visual.onclick=event=>{event.stopPropagation();if(event.detail===1){cancelPreviewTimers();previewTimer=doc.defaultView.setTimeout(()=>showPreview(asset),220);}};visual.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showPreview(asset);}};visual.onpointerenter=()=>{cancelPreviewTimers();hoverTimer=doc.defaultView.setTimeout(()=>showHoverPreview(asset,visual),420);};visual.onpointerleave=()=>{doc.defaultView.clearTimeout(hoverTimer);if(preview?.classList.contains('is-hover-preview'))closePreview();};imageSource(asset.path).then(value=>{if(!disposed&&visual.isConnected)visual.src=value;}).catch(error=>{if(!disposed){status.hidden=false;status.textContent='原图读取失败：'+error.message;}});el('div','',content).className='asset-inline-explanation';}
					if(open){content.hidden=false;card.refreshExplanation();}
					const height=content.scrollHeight;if(doc.defaultView.matchMedia('(prefers-reduced-motion:reduce)').matches||!content.animate){content.hidden=!open;return;}
					const motion=content.animate(open?[{height:'0px',opacity:0},{height:height+'px',opacity:1}]:[{height:height+'px',opacity:1},{height:'0px',opacity:0}],{duration:190,easing:'cubic-bezier(.2,.8,.25,1)'});motions.set(card,motion);motion.onfinish=()=>{if(motions.get(card)!==motion)return;motions.delete(card);content.hidden=!open;};
				};
				const image=el('img','',thumbnail);image.alt=asset.caption||asset.label;image.className='asset-preview-trigger asset-thumb-image';image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label',asset.label+'，查看原图与详细解读');image.title='查看原图与详细解读';
				if(asset.width>0&&asset.height>0){image.width=asset.width;image.height=asset.height;image.style.aspectRatio=`${asset.width} / ${asset.height}`;}
				loadThumbnail(image,asset.thumbnail||asset.path,asset.path);
				image.addEventListener('pointerenter',()=>{cancelPreviewTimers();hoverTimer=doc.defaultView.setTimeout(()=>showPreview(asset,{hover:true}),420);});
				image.addEventListener('pointerleave',()=>{doc.defaultView.clearTimeout(hoverTimer);hoverTimer=null;if(preview?.classList.contains('is-hover-preview'))closePreview();});
				image.addEventListener('pointerdown',event=>{doc.defaultView.clearTimeout(hoverTimer);hoverTimer=null;if(event.detail>1)cancelPreviewTimers();});
				image.addEventListener('click',event=>{event.stopPropagation();if(event.detail>1)return;cancelPreviewTimers();previewTimer=doc.defaultView.setTimeout(()=>showPreview(asset),220);});
				if(reader.researchPreviewOnly){image.title='查看原图与详细解读';image.setAttribute('aria-label',asset.label+'，查看原图与详细解读');}
				const doublePreview=event=>{event.preventDefault();event.stopPropagation();cancelPreviewTimers();showPreview(asset);};image.addEventListener('dblclick',doublePreview);
				heading.addEventListener('click',event=>{if(event.detail>1||event.target.closest('button,img'))return;const prior=rowTimers.get(card);if(prior)doc.defaultView.clearTimeout(prior);rowTimers.set(card,doc.defaultView.setTimeout(()=>{rowTimers.delete(card);card.toggleExpanded();},350));});
				image.addEventListener('keydown',event=>{if(event.isComposing||event.keyCode===229)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();showPreview(asset);}else if(event.key==='Escape')closePreview();});
				const showMenu=(x,y)=>{
					closeMenu();
					const menu=el('div','',panel);menu.className='asset-context-menu';menu.setAttribute('role','menu');
					const entries=[['保存为笔记',()=>saveAsNote(asset)],['定位原图',()=>navigate(asset)],['复制中文说明',()=>Zotero.Utilities.Internal.copyTextToClipboard(materialSummary(E.assets.materialFor(asset)))],['查看整页并调整裁切',()=>{content.hidden=false;showCrop(asset,content).catch(error=>{status.hidden=false;status.textContent='整页读取失败：'+error.message;});}]];
					if(asset.kind!=='formula')entries.push(['重新解读',()=>run(async(signal,update)=>{const saved=await E.assets.saveMaterial(asset,update,signal,true);refreshEvidence();status.hidden=false;status.textContent=saved.reused?'已保留用户确认或修改的说明':'中文解读已更新，原版本已保留';})]);
					entries.push([E.assets.tray().some(a=>a.id===asset.id)?'移出 PPT 素材':'加入 PPT 素材',()=>run(async()=>{if(E.assets.tray().some(a=>a.id===asset.id))await E.assets.unselect(asset.id);else await E.assets.select(asset);})]);
					for(const [label,fn]of entries){
						const item=action(label,()=>{closeMenu();fn();},menu);item.setAttribute('role','menuitem');if(label==='复制中文说明'&&!materialSummary(E.assets.materialFor(asset)))item.disabled=true;
					}
					menu.style.left=Math.max(4,Math.min(x,doc.defaultView.innerWidth-menu.offsetWidth-6))+'px';menu.style.top=Math.max(4,Math.min(y,doc.defaultView.innerHeight-menu.offsetHeight-6))+'px';
					menu.querySelector('button')?.focus();const dismiss=e=>{if(!menu.contains(e.target))closeMenu();};menuCleanup=()=>{menu.remove();doc.removeEventListener('pointerdown',dismiss,true);};doc.addEventListener('pointerdown',dismiss,true);menu.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();closeMenu();toggle.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled)')],at=items.indexOf(doc.activeElement),index=e.key==='Home'?0:e.key==='End'?items.length-1:(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[index]?.focus();}};
				};
				iconAction('更多图片操作','more',event=>{const r=event.currentTarget.getBoundingClientRect();showMenu(r.right,r.bottom);},actions);
				card.oncontextmenu=event=>{if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;event.preventDefault();showMenu(event.clientX,event.clientY);};
			}
			panel.dataset.ready = 'true';
			refreshEvidence();applyOrder();
			if(focusID)panel.focusAsset(focusID);
		};
		body.addEventListener('keydown',event=>{
			const toggle=event.target.closest('.asset-row-toggle');if(!toggle||event.ctrlKey||event.altKey||event.metaKey||event.isComposing)return;
			const card=toggle.closest('.asset-evidence-row'),asset=result?.assets.find(a=>String(a.id)===card.dataset.assetId);if(!asset)return;
			if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();card.toggleExpanded(event.key==='ArrowRight');}
			else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const rows=[...body.children].filter(n=>!n.hidden),at=rows.indexOf(card);rows[at+(event.key==='ArrowDown'?1:-1)]?.querySelector('.asset-row-toggle').focus();}
		});
		const showCrop = async (asset, card) => {
			card.querySelector('.asset-crop-area')?.remove();let area = el('div', '', card);area.className='asset-crop-area';el('p', '框选完整图或子图，保留坐标轴和图例。', area);
			let canvas = el('canvas', '', area); canvas.style.cssText = 'width:100%;background:white;touch-action:none;cursor:crosshair;';
			const page=await E.assets.page(asset);let image = new doc.defaultView.Image(); image.src = await E.previewImage(page.path); await image.decode();
			canvas.width = 760; canvas.height = Math.round(760*image.height/image.width); let ctx = canvas.getContext('2d'), start, crop;
			const paint = () => { ctx.drawImage(image,0,0,canvas.width,canvas.height); if (crop) { ctx.strokeStyle = '#e95a27'; ctx.lineWidth = 3; ctx.strokeRect(...crop); } }; paint();
			const point = e => { let r = canvas.getBoundingClientRect(); return [(e.clientX-r.left)/r.width*canvas.width,(e.clientY-r.top)/r.height*canvas.height]; };
			canvas.onpointerdown = e => { start = point(e); canvas.setPointerCapture(e.pointerId); };
			canvas.onpointermove = e => { if (!start) return; let p = point(e); crop = [Math.max(0,Math.min(p[0],start[0])),Math.max(0,Math.min(p[1],start[1])),Math.abs(p[0]-start[0]),Math.abs(p[1]-start[1])]; paint(); };
			canvas.onpointerup = () => { start = null; };
			action('保存当前子图', () => run(async (signal, update) => {
				if (!crop || crop[2]<12 || crop[3]<12) throw new Error('请先拖动框选区域');
				let [x,y,x2,y2] = page.bbox, b = [x+crop[0]/canvas.width*(x2-x), y+crop[1]/canvas.height*(y2-y), x+(crop[0]+crop[2])/canvas.width*(x2-x), y+(crop[1]+crop[3])/canvas.height*(y2-y)];
				let child = await E.assets.crop(asset,b,update,signal); result.assets.push(child);await E.assets.retainMaterial(child);await render();await E.assets.saveMaterial(child,update,signal);refreshEvidence();status.textContent = '新裁切与中文解读已保存；原素材保留';
			}), area);
		};
		const cancelHoverPreview=()=>{doc.defaultView.clearTimeout(hoverTimer);hoverTimer=null;if(preview?.classList.contains('is-hover-preview'))closePreview();};doc.addEventListener('scroll',cancelHoverPreview,{capture:true,passive:true});doc.defaultView.addEventListener('resize',cancelHoverPreview,{passive:true});
		(host||doc.body).append(panel);const offMaterials=E.manuscripts.onAssetsChanged(refreshEvidence),offImages=E.assets.onImagesChanged(id=>{if(id===reader.itemID)refreshEvidence();});unsubscribe=()=>{offMaterials();offImages();};
		const disposePanel=()=>{if(disposed)return;disposed=true;doc.defaultView.removeEventListener('unload',disposePanel);stopRows();closeMenu();closePreview();doc.removeEventListener('scroll',cancelHoverPreview,true);doc.defaultView.removeEventListener('resize',cancelHoverPreview);current?.abort();unsubscribe?.();};panel.dispose=disposePanel;doc.defaultView.addEventListener('unload',disposePanel,{once:true});load();return panel;
	};
	E.attachAssetHover = async reader => {
		let view = reader._internalReader?._primaryView; if (!view) return; await view.initializedPromise;
		let win = Cu.unwaiveXrays(view._iframeWindow); if (!win) return;
		let doc = win.document; if(doc.querySelector('.easysch-figure-hover')) return;
		let bar = doc.createElement('button'); bar.className = 'easysch-figure-hover'; bar.style.cssText = 'display:none;position:fixed;z-index:9999;max-width:240px;padding:6px 9px;background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:6px;box-shadow:0 3px 12px #0003;font:menu;cursor:pointer;';bar.title='打开图片证据与中文解读';doc.body.append(bar);
		let current,hideTimer,showTimer;
		const hide=()=>{if(!current&&!showTimer&&bar.style.display==='none')return;E.clearTimeout(showTimer);showTimer=null;E.clearTimeout(hideTimer);hideTimer=E.setTimeout(()=>{bar.style.display='none';current=null;},180);};
		const onMove=event=>{
			if(event.target===bar){E.clearTimeout(hideTimer);return;}
			if(event.buttons||doc.getSelection()?.toString()||event.target.closest?.('.textLayer span')){hide();return;}
			const page=event.target.closest?.('.page[data-page-number]');if(!page){hide();return;}
			const n=Number(page.dataset.pageNumber)-1,rotation=Number(page.dataset.mainRotation||0);if(rotation%360){hide();return;}
			const rect=page.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;
			const candidate=E.assets.active.get(reader.itemID)?.assets.find(a=>['figure','table','image'].includes(a.kind)&&a.pageIndex===n&&x*a.pageWidth>=a.bbox[0]&&x*a.pageWidth<=a.bbox[2]&&y*a.pageHeight>=a.bbox[1]&&y*a.pageHeight<=a.bbox[3]);
			if(!candidate){hide();return;}E.clearTimeout(hideTimer);
			if(current?.id===candidate.id&&(bar.style.display==='block'||showTimer))return;
			E.clearTimeout(showTimer);bar.style.display='none';current=candidate;
			const left=Math.max(8,Math.min(event.clientX+18,win.innerWidth-250)),top=event.clientY+42<win.innerHeight?event.clientY+18:Math.max(8,event.clientY-44);
			showTimer=E.setTimeout(()=>{showTimer=null;if(current?.id!==candidate.id)return;bar.textContent=`${candidate.label} · 查看原图与中文解读`;bar.style.left=left+'px';bar.style.top=top+'px';bar.style.display='block';},260);
		};
		const onScroll=()=>{E.clearTimeout(showTimer);showTimer=null;bar.style.display='none';current=null;};
		const onKey=event=>{if(event.key==='Escape')onScroll();};
		bar.onpointerenter=()=>E.clearTimeout(hideTimer);bar.onpointerleave=hide;
		bar.onclick=()=>{if(current)Promise.resolve().then(()=>E.openImageEvidence(reader.itemID,current.id)).catch(error=>{bar.title='图片证据未打开：'+error.message;});};
		doc.addEventListener('pointermove',onMove,{capture:true,passive:true});doc.addEventListener('scroll',onScroll,true);doc.addEventListener('keydown',onKey,true);
		win.addEventListener('unload',()=>{E.clearTimeout(hideTimer);E.clearTimeout(showTimer);doc.removeEventListener('pointermove',onMove,true);doc.removeEventListener('scroll',onScroll,true);doc.removeEventListener('keydown',onKey,true);bar.remove();},{once:true});
	};
})(Zotero.Research);
