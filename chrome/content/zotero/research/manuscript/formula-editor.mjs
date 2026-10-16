/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {formulaEvidenceRows} from '../shared/material-content.mjs';
import {installMediaPreview} from '../shared/media-preview.mjs';
import {formulaSourceKey,normalizeFormulaInput,extractTexFormulas,searchFormulaEvidence,recognizeFormulaSource,explainFormulaSource} from '../shared/formula-research.mjs';
function ensureStyles(doc){if(doc.querySelector('link[data-easysch-formula-editing]'))return;const link=doc.createElement('link');link.rel='stylesheet';link.href=new URL('./formula-editing.css',import.meta.url).href;link.dataset.easyschFormulaEditing='true';(doc.head||doc.documentElement).append(link);}

export function renderFormulaPreview(host, text, {E, onOpenAnchor, anchor, onEdit} = {}) {
	const doc = host.ownerDocument, view = doc.createElement('div');ensureStyles(doc); view.className = 'formula-typeset'; host.append(view);
	if (!text?.trim()) {view.classList.add('formula-empty'); return () => {};}
	try {
		const katex = doc.defaultView.katex;
		if (katex?.render) katex.render(text, view, {displayMode: true, throwOnError: true, trust: false, maxExpand: 1000});
		else if (E?.renderContent) E.renderContent(view, '$$\n' + text + '\n$$');
		else {view.textContent = text; view.classList.add('formula-code');}
	} catch (error) {view.classList.add('formula-error'); view.textContent = '公式格式有误，请检查 LaTeX'; view.title = error.message; return () => {};}
	return installMediaPreview(view, {content: () => view.cloneNode(true), alt: '公式预览', onLocate: onEdit || (anchor && onOpenAnchor ? () => onOpenAnchor(anchor) : null), doubleClickLabel: onEdit ? '编辑公式' : '定位原文'});
}

export async function currentPaperFormulaEvidence(E, materials = [], attachmentIDs = []) {
	const ids = new Set(attachmentIDs);
	for (const material of materials) for (const anchor of [...(material.sourceAnchors || []), ...(material.anchors || []), material.anchor, material]) if (anchor?.attachmentID) ids.add(Number(anchor.attachmentID));
	const assets = [];
	for (const id of ids) {
		const cached = E.assets?.active?.get?.(id);
		const result = cached || await E.assets?.index?.(id, () => {});
  for (const row of result?.assets || []) {
   if(row.kind!=='formula')continue;
			const material = E.assets?.materialFor?.(row), transcription = E.store?.get?.('formulaTranscriptions', formulaSourceKey({...row,attachmentID:row.attachmentID||id}));
			assets.push({...row, attachmentID: row.attachmentID || id, tags: material?.tags || row.tags || [], ...(transcription?.latex ? {latex:transcription.latex,formulaRecognition:transcription} : {})});
		}
	}
	return formulaEvidenceRows(assets, {attachmentIDs: [...ids]});
}

export function renderFormulaEditor(host, {text = '', onSave = () => {}, E, materials = [], attachmentIDs = [], onOpenAnchor = () => {}, onUseEvidence, onError = () => {}, embedded = false, asset, sourceText = '', onSaveExplanation, recognition} = {}) {
	const doc = host.ownerDocument, win = doc.defaultView, cleanups = [];ensureStyles(doc);
	const el = (tag, value, className) => {const node = doc.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node;};
	const root = el('section', undefined, 'formula-editor'), heading = el('div', undefined, 'formula-editor-heading');
	heading.append(el('strong', '公式'));
	const fromPaper = el('button', '从论文选择', 'formula-source-action'); fromPaper.type = 'button'; fromPaper.title = '按论文名、定理名、标签或公式检索'; heading.append(fromPaper); root.append(heading);
	const input = el('textarea', undefined, 'formula-latex-input'); input.value = text; input.rows = 3; input.spellcheck = false; input.setAttribute('aria-label', 'LaTeX 公式'); input.dataset.type = 'formula'; input.placeholder = '例如 E_{\\mathrm{F}} = \\frac{\\hbar^2 k_{\\mathrm{F}}^2}{2m}';
	const preview = el('div', undefined, 'formula-live-preview'), status = el('small', '', 'formula-editor-status'); status.setAttribute('aria-live', 'polite');
	root.append(input, preview, status); host.append(root);
	let previewDispose, saveTimer, disposed = false, selectedAsset = asset, explanationRecord, requestController, requestKind, rows = [];
	const update = () => {previewDispose?.(); preview.replaceChildren(); previewDispose = renderFormulaPreview(preview, input.value, {E});};
	const save = async () => {if (disposed) return; win.clearTimeout(saveTimer); try {await onSave(input.value); status.textContent = ''; } catch (error) {status.textContent = error.message; onError(error);}};
	input.addEventListener('input', () => {update(); if (embedded) return; win.clearTimeout(saveTimer); saveTimer = win.setTimeout(save, 450);});
	if (!embedded) {input.addEventListener('blur', save); input.addEventListener('change', save);}
	input.addEventListener('keydown', event => {if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); save();}});
	input.addEventListener('paste', event => {const text = event.clipboardData?.getData('text/plain');if(!text)return;try{const value=normalizeFormulaInput(text);if(value!==text){event.preventDefault();input.setRangeText(value,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new win.Event('input',{bubbles:true}));}}catch(error){event.preventDefault();status.textContent=error.message;onError(error);}});
	const tools=el('div',undefined,'formula-editor-tools');preview.after(tools);
	const tool=(label,title,fn)=>{const button=el('button',label);button.type='button';button.title=title;button.onclick=()=>Promise.resolve().then(fn).catch(error=>{status.textContent=error.message;onError(error);});tools.append(button);return button;};
	tool('复制 LaTeX','复制公式源码，不复制渲染杂字',async()=>{const copy=E.window?.Zotero?.Utilities?.Internal?.copyTextToClipboard||win.parent?.Zotero?.Utilities?.Internal?.copyTextToClipboard;if(copy)copy(input.value);else await win.navigator.clipboard.writeText(input.value);status.textContent='LaTeX 已复制';});
	tool('导入 .tex','从 TeX 或文本文件导入公式',async()=>{let formulas;if(E.assets?.importFormulaTex)formulas=await E.assets.importFormulaTex(win);else{const file=el('input');file.type='file';file.accept='.tex,.txt';formulas=await new Promise(resolve=>{file.onchange=async()=>resolve(file.files[0]?extractTexFormulas(await file.files[0].text()):null);file.addEventListener('cancel',()=>resolve(null));file.click();});}if(!formulas?.length)return;if(formulas.length===1){input.value=formulas[0].latex;update();if(!embedded)await save();input.focus();}else{candidates.hidden=false;candidates.replaceChildren();for(const formula of formulas){const choice=el('button',formula.latex.slice(0,100),'formula-tex-choice');choice.type='button';choice.title=formula.latex;choice.onclick=()=>{input.value=formula.latex;update();if(!embedded)save();input.focus();};candidates.append(choice);}}});
	const explanation=el('div',undefined,'formula-source-explanation');explanation.hidden=true;root.append(explanation);
	const explain=tool('解释公式','根据公式与论文来源解释变量和条件',async()=>{
		if(requestController){if(requestKind==='explain'){requestController.abort();return;}throw Error('正在识别原式，请稍候');}
		const controller=new win.AbortController();requestController=controller;requestKind='explain';explain.textContent='停止';
		try{
			const value={latex:input.value,asset:selectedAsset||{},sourceText},options={status:text=>{if(!disposed)status.textContent=text;},signal:controller.signal};
			const record=await(E.assets?.explainFormula?E.assets.explainFormula(value,options):explainFormulaSource(E,value,options));
			if(disposed||controller.signal.aborted)return;
			explanationRecord={...record,id:'formula-explanation-'+Date.now().toString(36),role:'assistant'};explanation.hidden=false;explanation.replaceChildren();
			const body=el('div');E.renderContent(body,record.text,{sources:record.sources||[],onSource:onOpenAnchor});explanation.append(body);
			if(onSaveExplanation){const keep=el('button','保存笔记');keep.type='button';keep.onclick=()=>Promise.resolve(onSaveExplanation(explanationRecord)).then(()=>{if(!disposed)status.textContent='公式解释已保存为笔记';}).catch(onError);explanation.append(keep);}
			status.textContent='';
		}finally{if(requestController===controller){requestController=null;requestKind=null;}if(explain.isConnected)explain.textContent='解释公式';}
	});
	if(recognition?.needsReview){const marker=el('small','转写待核验','formula-transcription-review');marker.title=(recognition.uncertainties||[]).join('\n')||'请对照原式检查符号、上下标与分式';root.prepend(marker);}
	const candidates = el('div', undefined, 'formula-source-list'); candidates.hidden = true; root.append(candidates);
	const search=el('input',undefined,'formula-source-search');search.type='search';search.placeholder='论文名、定理、标签或公式';search.setAttribute('aria-label','搜索论文公式');
	const list=el('div',undefined,'formula-source-results');
	const validate=value=>{if(win.katex?.renderToString)win.katex.renderToString(value,{throwOnError:true,trust:false,maxExpand:1000});};
	const apply=async row=>{
		if(requestController)throw Error('当前公式任务尚未完成，请稍候');
		let next=row;
		if(!row.latex?.trim()){
			const controller=new win.AbortController();requestController=controller;requestKind='recognize';
			try{
				const options={status:text=>{if(!disposed)status.textContent=text;},signal:controller.signal,validate};
				const value=await(E.assets?.recognizeFormula?E.assets.recognizeFormula(row,options):recognizeFormulaSource(E,row,options));
				if(controller.signal.aborted)return;next={...row,latex:value.latex,formulaRecognition:value};
			}finally{if(requestController===controller){requestController=null;requestKind=null;}}
		}
		if(disposed)return;
		const value=normalizeFormulaInput(next.latex);validate(value);selectedAsset=next;input.value=value;update();
		if(onUseEvidence)await onUseEvidence(next);else if(!embedded)await save();
		// Selecting a source may re-render the complete details panel.
		if(disposed)return;
		status.textContent=next.formulaRecognition?.needsReview?'转写已导入，请对照原式核验'+(next.formulaRecognition.uncertainties?.length?'：'+next.formulaRecognition.uncertainties.join('；'):''):'';input.focus();
	};
	const renderRows=()=>{for(const cleanup of cleanups.splice(0))cleanup();list.replaceChildren();const found=searchFormulaEvidence(rows,search.value);if(!found.length)list.append(el('small',rows.length?'未找到匹配公式':'当前来源尚无公式，可导入 TeX 或在阅读器中裁切原式。'));for(const row of found){const card=el('article',undefined,'formula-source-card'),label=el('div',undefined,'formula-source-heading');label.append(el('span',row.label||'原文公式'),el('small','第 '+(row.pageIndex+1)+' 页'));card.append(label);if(row.paperTitle)card.append(el('small',row.paperTitle,'formula-source-paper'));const img=el('img');img.alt=row.label||'原文公式';card.append(img);const path=row.path||row.imagePath;if(path){E.previewImage(path).then(src=>{if(img.isConnected)img.src=src;}).catch(onError);cleanups.push(installMediaPreview(img,{alt:img.alt,onLocate:()=>onOpenAnchor({...row,position:E.assets?.position?.(row)})}));}const controls=el('div',undefined,'formula-source-actions'),locate=el('button','定位原文');locate.type='button';locate.onclick=()=>Promise.resolve(onOpenAnchor({...row,position:E.assets?.position?.(row)})).catch(onError);controls.append(locate);const use=el('button',row.latex?.trim()?'使用 LaTeX':'识别并使用');use.type='button';use.title=row.latex?.trim()?'导入可编辑公式':'读取完整原式图片，转写为待核验的可编辑 LaTeX';use.onclick=async()=>{use.disabled=true;try{await apply(row);}catch(error){status.textContent=error.message;onError(error);}finally{if(use.isConnected)use.disabled=false;}};controls.append(use);card.append(controls);list.append(card);}};
	search.oninput=renderRows;
	fromPaper.onclick = async () => {
		if (!candidates.hidden) {candidates.hidden = true; fromPaper.setAttribute('aria-expanded', 'false'); return;}
		candidates.hidden = false; fromPaper.setAttribute('aria-expanded', 'true'); candidates.replaceChildren(el('small', '读取公式…')); fromPaper.disabled = true;
		try {
			rows = await currentPaperFormulaEvidence(E, materials, attachmentIDs); if (disposed || !root.isConnected) return; candidates.replaceChildren(search,list);renderRows();search.focus();
		} catch (error) {candidates.replaceChildren(el('small', error.message)); onError(error);} finally {fromPaper.disabled = false;}
	};
	update();
	return {element: root, input, getValue: () => input.value, setValue(value){input.value=value;update();},flush: save, dispose: () => {disposed = true;requestController?.abort(); win.clearTimeout(saveTimer); previewDispose?.(); for (const cleanup of cleanups) cleanup(); root.remove();}};
}
