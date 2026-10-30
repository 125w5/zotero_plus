/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
	const Policy=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-ai-policy.mjs');
	// Artifact indexing also runs before the interactive workspace starts.
	// Capture one complete timer pair so cleanup uses the same implementation.
	const artifactTimers = () => typeof E.setTimeout === 'function' && typeof E.clearTimeout === 'function'
		? { setTimeout: E.setTimeout, clearTimeout: E.clearTimeout }
		: ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
	E.readChartData = async file => {
		if ((await IOUtils.stat(file)).size > 1000000) throw new Error('数据文件超过 1 MB');
		if (/\.(csv|xlsx)$/i.test(file)) return E.runArtifactEngine({ operation: 'assets-dataset', file });
		let value = JSON.parse(await IOUtils.readUTF8(file));
		if (!Array.isArray(value) || value.length > 20) throw new Error('数据格式应为数据集数组，最多 20 组');
		return value;
	};
	// Page previews need LibreOffice and Poppler. A preference that points at a
	// missing program counts as not installed.
	E.presentationRenderer = async () => {
		let soffice = Zotero.Prefs.get('extensions.easysch.soffice', true);
		let poppler = Zotero.Prefs.get('extensions.easysch.poppler', true);
		if (!soffice || !poppler) return null;
		let render = { soffice, pdftoppm: PathUtils.join(poppler, 'pdftoppm.exe'), pdftotext: PathUtils.join(poppler, 'pdftotext.exe') };
		return await IOUtils.exists(soffice) && await IOUtils.exists(render.pdftoppm) ? render : null;
	};
	// A user export runs here; only the finished PPTX goes to the chosen folder.
	E.pptExportWorkRoot = async () => {
		let directory = PathUtils.join(Zotero.DataDirectory.dir, 'easysch', 'asset-cache', 'exports');
		await IOUtils.makeDirectory(directory, { ignoreExisting: true });
		return directory;
	};
	E.runArtifactEngine = async function (request, onStatus = () => {}, signal) {
		if (signal?.aborted) throw new Error('任务已取消');
		if (signal) {
			let directory=PathUtils.join(Zotero.DataDirectory.dir,'easysch','task-cancel');await IOUtils.makeDirectory(directory,{ignoreExisting:true});
			request.cancelFile=PathUtils.join(directory,Zotero.Utilities.randomString(20)+'.cancel');
		}
		if (request.operation?.startsWith('assets-')) {
			request.python = Zotero.Prefs.get('extensions.easysch.assetPython', true);
			request.cacheRoot = PathUtils.join(Zotero.DataDirectory.dir, 'easysch', 'asset-cache');
		}
		if (request.operation === 'export') {
			let render = await E.presentationRenderer();
			if (render) request.render = render;
		}
		let command = Zotero.Prefs.get('extensions.easysch.engineNode', true);
		let entry = Zotero.Prefs.get('extensions.easysch.engineEntry', true);
		if (!command || !entry || !await IOUtils.exists(command) || !await IOUtils.exists(entry)) throw new Error('文档处理工具缺失，请重新安装完整的 EasySch 安装包。');
		const timers = artifactTimers();
		let { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
		let proc = await Subprocess.call({ command, arguments: [entry], stderr: 'pipe' });
		let cancel = () => IOUtils.writeUTF8(request.cancelFile,'cancel').catch(()=>proc.kill()); signal?.addEventListener('abort', cancel, { once: true });
		let result, failure, remainder = '';
		let timer = timers.setTimeout(() => proc.kill(), 180000);
		try {
			let output = (async () => {
				let chunk;
				while ((chunk = await proc.stdout.readString())) {
					remainder += chunk;
					let lines = remainder.split('\n'); remainder = lines.pop();
					for (let line of lines) {
						if (!line.trim()) continue;
						let event = JSON.parse(line);
						if (event.type === 'result') result = event.value;
						if (event.type === 'error') failure = event.message;
						if (event.type === 'progress') onStatus(`${event.stage} · ${event.status}`);
					}
				}
			})();
			let errors = (async () => { while (await proc.stderr.readString()) { /* Drain without exposing private process details. */ } })();
			await proc.stdin.write(JSON.stringify(request)); await proc.stdin.close();
			let [status] = await Promise.all([proc.wait(), output, errors]);
			if (signal?.aborted) throw new Error('任务已取消');
			if (status.exitCode || failure || !result) throw new Error(failure || '产物引擎失败或超时；原文未修改');
			return result;
		}
		finally { timers.clearTimeout(timer); signal?.removeEventListener('abort', cancel); if(request.cancelFile) await IOUtils.remove(request.cancelFile,{ignoreAbsent:true}); }
	};
	// Canvases call this on every render. Identical data URLs also let Gecko reuse
	// the decoded image, so keep recent ones, bounded by their total size.
	const PREVIEW_CACHE_BYTES = 32 * 1024 * 1024;
	let previewCache = new Map(), previewCacheSize = 0;
	let encodePreview = async (path, key) => {
		let bytes = await IOUtils.read(path);
		const type = /\.jpe?g$/i.test(path)?'image/jpeg':/\.webp$/i.test(path)?'image/webp':'image/png';
		// The native byte encoder needs no browser window, Blob or FileReader.
		const encoded = ChromeUtils.base64URLEncode(bytes, { pad: true }).replace(/-/g, '+').replace(/_/g, '/');
		let url = `data:${type};base64,${encoded}`, entry = previewCache.get(key);
		if (entry) {
			entry.size = url.length;
			previewCacheSize += url.length;
		}
		for (let [oldKey, old] of previewCache) {
			if (previewCacheSize <= PREVIEW_CACHE_BYTES || oldKey === key) break;
			previewCache.delete(oldKey);
			previewCacheSize -= old.size;
		}
		return url;
	};
	E.previewImage = async path => {
		let info = await IOUtils.stat(path), key = path + '\n' + info.size + '\n' + info.lastModified, entry = previewCache.get(key);
		if (entry) {
			previewCache.delete(key);
			previewCache.set(key, entry);
			return entry.job;
		}
		entry = { size: 0, job: null };
		previewCache.set(key, entry);
		entry.job = encodePreview(path, key);
		entry.job.catch(() => {
			if (previewCache.get(key) !== entry) return;
			previewCache.delete(key);
			previewCacheSize -= entry.size;
		});
		return entry.job;
	};
	E.previewPresentation = async (request, status, signal) => {
		let key = E.assets.key(['ppt-layout-2', request.plan, request.record, request.datasets, (request.assets || []).map(a => [a.id, a.assetHash, a.uri])]);
		let python=Zotero.Prefs.get('extensions.easysch.assetPython',true), cacheEnabled=python&&await IOUtils.exists(python);
		let cached = cacheEnabled ? await E.runArtifactEngine({ operation: 'assets-cache-get', key },status,signal) : {miss:true};
		if (!cached.miss && cached.previews && await IOUtils.exists(cached.path) && (await Promise.all(cached.previews.map(p => IOUtils.exists(p)))).every(Boolean)) {
			status('页面与素材未变化，复用实际 PPTX 逐页预览'); return { ...cached, cacheHit: true };
		}
		if (!await E.presentationRenderer()) throw new Error('预览图未生成：没有找到 LibreOffice 和 Poppler 渲染工具。页面内容已保存；可以直接导出 PPTX，用 PowerPoint 查看实际效果。');
		let directory = PathUtils.join(Zotero.DataDirectory.dir, 'easysch', 'asset-cache', 'previews');
		await IOUtils.makeDirectory(directory, { ignoreExisting: true });
		let result = await E.runArtifactEngine({ ...request, operation: 'export', directory }, status, signal);
		if (cacheEnabled && result.previews) await E.runArtifactEngine({ operation: 'assets-cache-put', key, layer: 'ppt', value: result });
		E.prunePresentationJobs(directory, 24).catch(error => Zotero.logError(error));
		return result;
	};
	// Every preview and export renders in its own job folder. Keep the newest few
	// and every folder a saved draft still shows; the rest are regenerable.
	E.prunePresentationJobs = async (directory, keep) => {
		if (!await IOUtils.exists(directory)) return;
		let used = new Set(), parent = file => typeof file === 'string' && file ? PathUtils.parent(file) : null;
		for (let draft of Object.values(E.store.peek ? E.store.peek('pptDrafts') || {} : {})) {
			for (let preview of Object.values(draft?.previews || {})) used.add(parent(preview?.path));
			for (let file of draft?.lastPreview?.previews || []) used.add(parent(file));
			used.add(parent(draft?.lastPreview?.path));
		}
		let jobs = [];
		for (let child of await IOUtils.getChildren(directory)) {
			let info = await IOUtils.stat(child).catch(() => null);
			if (info?.type === 'directory' && PathUtils.filename(child).startsWith('easysch-deck-')) jobs.push({ child, at: info.lastModified || 0 });
		}
		jobs.sort((a, b) => b.at - a.at);
		for (let { child } of jobs.slice(keep)) if (!used.has(child)) await IOUtils.remove(child, { recursive: true, ignoreAbsent: true }).catch(() => {});
	};
	// Export embeds PNG and JPEG. Other images (WebP from image generation or a
	// drop) are decoded by Gecko once and cached as PNG; the draft keeps the original.
	E.pptImagePath = async (path, signal) => {
		let head = await IOUtils.read(path, { maxBytes: 12 }), text = String.fromCharCode(...head);
		if (head[0] === 0x89 && text.slice(1, 4) === 'PNG' || head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return path;
		if (!(text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') && !text.startsWith('GIF8') && !text.startsWith('BM')) throw new Error('图片“' + PathUtils.filename(path) + '”不是 PNG、JPG 或 WebP，未导出；请换用这三种格式的图片。');
		let info = await IOUtils.stat(path), folder = PathUtils.join(Zotero.DataDirectory.dir, 'easysch', 'asset-cache', 'ppt-images');
		let target = PathUtils.join(folder, E.assets.key(['ppt-image-1', path, info.size, info.lastModified]) + '.png');
		if (await IOUtils.exists(target)) return target;
		let win = Zotero.getMainWindow(), image = new win.Image();
		image.src = await E.previewImage(path);
		try { await image.decode(); }
		catch { throw new Error('图片“' + PathUtils.filename(path) + '”无法解码，未导出；请重新导入这张图片。'); }
		if (image.naturalWidth * image.naturalHeight > 25_000_000) throw new Error('图片“' + PathUtils.filename(path) + '”分辨率过大，未导出；请缩小后重新导入。');
		let canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
		canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
		canvas.getContext('2d').drawImage(image, 0, 0);
		let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
		if (!blob) throw new Error('图片“' + PathUtils.filename(path) + '”转换为 PNG 失败，未导出；请换用 PNG 或 JPG 图片。');
		if (signal?.aborted) throw new Error('任务已取消');
		await IOUtils.makeDirectory(folder, { ignoreExisting: true });
		await IOUtils.write(target, new Uint8Array(await blob.arrayBuffer()));
		return target;
	};
	E.planPresentation = async function (meeting, onStatus) {
		let assembly = await E.runArtifactEngine({ operation: 'prompt' });
		let config = await E.resolveModel(E.settings()), endpoint = E.core.endpoint(config.endpoint);
		let key = await E.credentials.get(endpoint);
		let win = Zotero.getMainWindow(), abort = new win.AbortController();
		const timers = artifactTimers();
		let timer = timers.setTimeout(() => abort.abort(), 120000);
		try {
			onStatus(E.aiProgress(config.model,'正在整理汇报页面'));
			const chat=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-completion.mjs'),stream=chat.chatRequiresStreaming(endpoint);
			let response = await win.fetch(endpoint + '/chat/completions', { method: 'POST', redirect: 'error', signal: abort.signal,
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
				body: JSON.stringify({ model: config.model, temperature: 0.2, max_tokens: 7000, ...(stream ? { stream: true } : {}),
					...(new URL(endpoint).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' }, response_format: { type: 'json_object' } } : {}),
					messages: [{ role: 'system', content: Policy.RESEARCH_AI_RULES+'\n'+assembly.sections.map(s => s.text).join('\n\n') + '\n本次仅整理组会汇报页面，不是论文正文。只允许 text、table、asset 页；不生成 diagram、chart 或绘图代码。' + (meeting.assets?.length ? '\n优先使用已确认的论文原图，返回 version:2。至少60%内容页使用 kind:asset；不得连续三页同布局。asset页格式：{kind:"asset",title,layoutType:"original"或"method"或"results"或"question"或"formula",assetIDs:[输入素材ID],sources:[对应证据ID],slidePurpose,claim,assetReason,speakerFocus,bullets:[最多3条各120字内],notes}。不得假装看到图片像素；图注不足时注明待核对。不得用通用关系图替代已有论文图。' : '') }, { role: 'user', content: JSON.stringify({
						title: meeting.title, minutes: meeting.minutes, outline: meeting.outline.result, datasets: meeting.datasets || [],
						assets: (meeting.assets || []).map(a => ({ id: a.id, sourceID: 'A-' + a.id, label: a.label, caption: a.caption, page: a.page, kind: a.kind })),
						sources: meeting.outline.sources.map(s => ({ id: s.id, label: s.label, text: s.text.slice(0, 4000) })) }) }] }) });
			if (!response.ok) throw new Error(`页面规划接口返回 HTTP ${response.status}`);
			let completion = await chat.readChatCompletion(response,{stream});
			if(completion.finishReason==='length')throw new Error('页面规划达到输出上限，请缩小范围重试');
			let plan = JSON.parse(completion.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
			if (!Array.isArray(plan.slides) || !plan.slides.length || plan.slides.length > 40) throw new Error('无效页面规划');
			if(plan.slides.some(s=>!['text','table','asset'].includes(s.kind)))throw Error('AI 不生成图片或图表；请使用论文原图或人工整理的素材。');
			await E.runArtifactEngine({ operation: 'validate', plan, evidence: meeting.outline.sources });
			await E.store.update(s => { s.meetings[meeting.id].slidePlan = plan; });
			return plan;
		}
		finally { timers.clearTimeout(timer); }
	};
	E.diagramCore = () => ChromeUtils.importESModule('chrome://zotero/content/research/shared/diagram.mjs');
	E.selectionDiagramSVG = slide => E.diagramCore().diagramSVG(slide);
	E.planSelectionDiagram = async () => { Policy.assertAIAction('diagram_generate'); };
	E.saveSelectionDiagram = async function (diagram) {
		let folder = await E.pick(Zotero.getMainWindow(), '保存可编辑 SVG 方法图', 'folder');
		if (!folder) return null;
		let name = diagram.slide.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0, 60) || 'method-diagram';
		let path = PathUtils.join(folder, `${name}-${Date.now()}.svg`);
		await IOUtils.writeUTF8(path, diagram.svg);
		await IOUtils.writeUTF8(path.replace(/\.svg$/, '.drawio'), E.diagramCore().diagramDrawio(diagram.slide));
		await IOUtils.writeUTF8(path.replace(/\.svg$/, '.json'), JSON.stringify({slide:diagram.slide,sources:diagram.sources}, null, 2));
		return path;
	};
})(EasySch);
