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
		let doc = host?.ownerDocument || reader._iframeWindow.document, previous = host?.querySelector('#easysch-asset-panel') || (!host && doc.getElementById('easysch-asset-panel'));
		if (previous) { previous.closePanel?.(); if (!focusID) return; }
		let panel = doc.createElementNS('http://www.w3.org/1999/xhtml','section'); panel.id = 'easysch-asset-panel'; panel.setAttribute('aria-label', '图片证据链');
		if (host) panel.className = 'embedded-evidence';
		let style = doc.createElementNS('http://www.w3.org/1999/xhtml','style'); style.textContent = ChromeUtils.importESModule('chrome://zotero/content/research/shared/asset-style.mjs').assetReaderStyle; panel.append(style);
		const el = (tag, text, parent = panel) => { let n = doc.createElementNS('http://www.w3.org/1999/xhtml',tag); if (text) n.textContent = text; parent.append(n); return n; };
		const action = (label, fn, parent = panel) => { let b = el('button', label, parent); b.onclick = fn; return b; };
		let header=el('header');el('strong', '图片证据',header);
		let unsubscribe,preview,previewTimer,thumbnailObserver;const previewEscape=event=>{if(event.key==='Escape'&&preview){event.preventDefault();event.stopPropagation();closePreview();}};const closePreview=()=>{doc.defaultView.clearTimeout(previewTimer);previewTimer=null;doc.removeEventListener('keydown',previewEscape,true);preview?.remove();preview=null;};const close=()=>{closePreview();thumbnailObserver?.disconnect();current?.abort();unsubscribe?.();panel.remove();if(host)host.closest('item-pane-custom-section').open=false;else doc.querySelector('.easysch-assets-open')?.focus();};panel.closePanel=close;
		action('关闭',close,header);panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
		let status = el('p', '正在核对 PDF 与素材缓存…'); status.setAttribute('role', 'status');
		let controls = el('div');
		let search=el('input');search.type='search';search.placeholder='查找中文说明、图号或页码';search.setAttribute('aria-label','查找论文素材');
		let filter=el('select');filter.setAttribute('aria-label','素材类型');
		for(let [value,label] of [['all','全部素材'],['figure','论文图'],['table','表格'],['formula','公式'],['manual','手动裁切']]){let o=el('option',label,filter);o.value=value;}
		let body = el('div'); body.className = 'easysch-asset-list';
		const applyFilter=()=>{for(let card of body.children)card.hidden=!(filter.value==='all'||card.dataset.kind===filter.value||(filter.value==='manual'&&card.dataset.manual==='true'))||!card.dataset.search.includes(search.value.trim().toLowerCase());};
		search.oninput=applyFilter;filter.onchange=applyFilter;
		let current, retryAction, result;
		const run = async fn => {
			if (current) return;
			retryAction = fn; current = new doc.defaultView.AbortController(); cancel.hidden = false; retry.hidden = true;
			try { await fn(current.signal, text => status.textContent = text); }
			catch (e) { status.textContent = current.signal.aborted ? '已取消；已确认的素材仍保留' : '未完成：' + e.message; retry.hidden = false; }
			finally { current = null; cancel.hidden = true; }
		};
		let cancel = action('取消当前任务', () => current?.abort(), controls); cancel.hidden = true;
		let retry = action('重试未完成部分', () => run(retryAction), controls); retry.hidden = true;
		const navigate=asset=>Promise.resolve().then(()=>reader.navigate({pageIndex:asset.pageIndex,position:E.assets.position(asset)})).catch(error=>{status.textContent='定位 PDF 原图失败：'+error.message;});
		const saveAsNote=asset=>{closePreview();return run(async()=>{status.textContent='正在保存完整图片与来源…';const saved=await E.saveAssetNote(asset);status.textContent=saved.warning|| (saved.reused?'已打开已有图片笔记':'完整图片、中文解读与来源已保存，笔记已打开');});};
		const showPreview=async asset=>{
			closePreview();const overlay=doc.createElementNS('http://www.w3.org/1999/xhtml','div');overlay.className='easysch-image-preview';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label',asset.label+' · 原图预览');overlay.tabIndex=-1;
			const viewer=doc.createElementNS('http://www.w3.org/1999/xhtml','div');viewer.className='easysch-image-preview-content';viewer.onclick=event=>event.stopPropagation();
			const heading=doc.createElementNS('http://www.w3.org/1999/xhtml','div');heading.className='easysch-image-preview-heading';const title=doc.createElementNS('http://www.w3.org/1999/xhtml','strong');title.textContent=`${asset.label} · PDF 第 ${asset.page} 页`;heading.append(title);
			const dismiss=doc.createElementNS('http://www.w3.org/1999/xhtml','button');dismiss.type='button';dismiss.textContent='关闭';dismiss.title='关闭预览（Esc）';dismiss.onclick=closePreview;heading.append(dismiss);viewer.append(heading);
			const image=doc.createElementNS('http://www.w3.org/1999/xhtml','img');image.alt=asset.caption||asset.label;image.title='点击图片关闭预览';image.onclick=closePreview;viewer.append(image);
			const foot=doc.createElementNS('http://www.w3.org/1999/xhtml','footer');const caption=doc.createElementNS('http://www.w3.org/1999/xhtml','span');caption.textContent=asset.caption||'原文未提取到可靠图注，请回到 PDF 核对';foot.append(caption);
			const note=doc.createElementNS('http://www.w3.org/1999/xhtml','button');note.type='button';note.textContent='保存为笔记';note.onclick=()=>saveAsNote(asset);foot.append(note);
			const locate=doc.createElementNS('http://www.w3.org/1999/xhtml','button');locate.type='button';locate.textContent='定位原图';locate.onclick=()=>{closePreview();navigate(asset);};foot.append(locate);viewer.append(foot);
			overlay.append(viewer);overlay.onclick=event=>{if(event.target===overlay)closePreview();};
			(doc.body||doc.documentElement).append(overlay);preview=overlay;doc.addEventListener('keydown',previewEscape,true);overlay.focus();
			try{const source=await E.previewImage(asset.path||asset.thumbnail);if(preview===overlay)image.src=source;}catch(error){if(preview===overlay){closePreview();status.textContent='图片放大失败：'+error.message;}}
		};
		const load = (force = false) => run(async (signal, update) => {
			result = await E.assets.index(reader.itemID, update, signal, force); await render();
			status.textContent = `${result.cacheHit ? '已复用缓存' : '提取完成'}：${result.assets.filter(a => a.kind === 'figure').length} 张图、${result.assets.filter(a => a.kind === 'table').length} 张表、${result.assets.filter(a => a.kind === 'formula').length} 个公式。`;
			E.attachAssetHover(reader);
			E.assets.queueImages(reader.itemID).catch(e=>{status.textContent='图片整理未完成：'+e.message;});
		});
		const refreshEvidence=()=>{
			if(!panel.isConnected){unsubscribe?.();return;}
			const state=E.assets.imageState(reader.itemID);
			if(state){status.textContent=state.status==='complete'?`${state.total} 张图片证据已入库` : ['running','queued'].includes(state.status)?`正在整理图片证据 · ${state.completed||0}/${state.total||'…'}`:`图片已保留 · ${state.completed||0} 张说明完成；${state.error||'可重试未完成部分'}`;imageRetry.hidden=!['partial','failed'].includes(state.status);}
			for(const card of body.children){
				const asset=result?.assets.find(a=>E.assets.sourceKey(a)===card.dataset.sourceKey),m=asset&&E.assets.materialFor(asset);if(!m)continue;
				const slot=card.querySelector('.asset-explanation');if(!slot||slot.dataset.version===String(m.revision)+m.generationStatus)continue;
				slot.dataset.version=String(m.revision)+m.generationStatus;slot.replaceChildren();
				el('p',m.summary,slot);
				el('p',m.coverage,slot).className='asset-muted';
				if(m.generationError)el('p','说明未完成：'+m.generationError,slot).className='asset-error';
				if(m.imageExplanation){const details=el('details','',slot);el('summary','阅读完整解读',details);for(const section of m.imageExplanation.result.sections){el('strong',section.heading,details);E.renderContent(el('div','',details),section.body,{sources:m.imageExplanation.sources,onSource:s=>E.library.openSource(s)});}}
				card.dataset.search=`${asset.label} ${asset.caption} ${asset.page} ${m.summary}`.toLowerCase();
			}
			applyFilter();
		};
		const imageRetry=action('重试图片说明',()=>{E.assets.queueImages(reader.itemID).catch(e=>{status.textContent=e.message;});},controls);imageRetry.hidden=true;
		const render = async () => {
			closePreview();thumbnailObserver?.disconnect();body.replaceChildren();
			const loadThumbnail=(image,path)=>E.previewImage(path).then(source=>{if(image.isConnected)image.src=source;}).catch(()=>{if(image.isConnected){image.alt='缩略图暂不可用，可打开原图核对';image.title='缩略图暂不可用 · 单击查看原图';}});
			thumbnailObserver=doc.defaultView.IntersectionObserver?new doc.defaultView.IntersectionObserver(entries=>{
				for(const entry of entries)if(entry.isIntersecting){const image=entry.target;thumbnailObserver.unobserve(image);loadThumbnail(image,image.dataset.thumbnailPath);}
			},{rootMargin:'240px'}):null;
			let rank={figure:0,table:1,formula:2,image:3};
			for (const asset of E.assets.uniqueAssets(result.assets).sort((a,b) => rank[a.kind]-rank[b.kind] || a.page-b.page)) {
				let card = el('article', '', body); card.dataset.assetId = asset.id;card.dataset.sourceKey=E.assets.sourceKey(asset);card.dataset.kind=asset.kind;card.dataset.manual=String(!!asset.userModified);card.dataset.search=`${asset.label} ${asset.caption} ${asset.page}`.toLowerCase();
				el('strong', `${asset.label} · PDF 第 ${asset.page} 页${asset.userModified ? ' · 手动裁切' : ''}`, card);
				let image = el('img', '', card); image.alt = asset.caption || asset.label; image.loading = 'lazy'; image.className='asset-preview-trigger';image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label',asset.label+'，单击放大，双击定位 PDF 原图');image.title='单击放大 · 双击定位原图';
				if(asset.width>0&&asset.height>0){image.width=asset.width;image.height=asset.height;image.style.aspectRatio=`${asset.width} / ${asset.height}`;}else image.style.minHeight='80px';
				if(thumbnailObserver){image.dataset.thumbnailPath=asset.thumbnail;thumbnailObserver.observe(image);}else loadThumbnail(image,asset.thumbnail);
				const cardText='button,summary,details,input,select,p,strong,.asset-explanation';
				card.addEventListener('pointerdown',event=>{if(event.detail>1){doc.defaultView.clearTimeout(previewTimer);previewTimer=null;}});
				card.addEventListener('click',event=>{if(event.detail>1||event.target.closest(cardText)||doc.defaultView.getSelection()?.toString())return;doc.defaultView.clearTimeout(previewTimer);previewTimer=doc.defaultView.setTimeout(()=>showPreview(asset),500);});
				card.addEventListener('dblclick',event=>{if(event.target.closest(cardText))return;doc.defaultView.clearTimeout(previewTimer);previewTimer=null;closePreview();navigate(asset);});
				image.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showPreview(asset);}});
				let caption=el('details','',card);el('summary','查看原始图注',caption);el('p', asset.caption || '没有可靠匹配图注，请回到原文核对', caption);
				el('div','',card).className='asset-explanation';
				el('p','原论文 → 原图素材 → 中文解读（待核验）',card).className='asset-chain';
				action('回到原图', () => navigate(asset), card);
				action('保存为笔记',()=>saveAsNote(asset),card).className='asset-save-note';
				let more = el('details', '', card); el('summary', '更多', more);
				if(asset.kind!=='formula')action('重新解读',()=>run(async(signal,update)=>{const saved=await E.assets.saveMaterial(asset,update,signal,true);refreshEvidence();status.textContent=saved.reused?'已保留用户确认或修改的说明':'中文解读已更新，原版本已保留';}),more);
				action('查看整页并调整裁切', () => showCrop(asset, card), more);
				action(E.assets.tray().some(a=>a.id===asset.id)?'移出 PPT 素材':'加入 PPT 素材',()=>run(async()=>{if(E.assets.tray().some(a=>a.id===asset.id))await E.assets.unselect(asset.id);else await E.assets.select(asset);await render();}),more);

			}
			if (focusID) body.querySelector(`[data-asset-id="${focusID}"]`)?.scrollIntoView({ block: 'center' });
			panel.dataset.ready = 'true';
			refreshEvidence();applyFilter();
		};
		const showCrop = async (asset, card) => {
			let area = el('div', '', card); el('p', '从完整页面框选整张图或子图，确保包含坐标轴和图例。保存为新素材，原图不变。', area);
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
		(host||doc.body).append(panel);const offMaterials=E.manuscripts.onAssetsChanged(refreshEvidence),offImages=E.assets.onImagesChanged(id=>{if(id===reader.itemID)refreshEvidence();});unsubscribe=()=>{offMaterials();offImages();};panel.dispose=()=>{closePreview();thumbnailObserver?.disconnect();current?.abort();unsubscribe?.();};doc.defaultView.addEventListener('unload',()=>{closePreview();thumbnailObserver?.disconnect();unsubscribe?.();},{once:true});load();return panel;
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
