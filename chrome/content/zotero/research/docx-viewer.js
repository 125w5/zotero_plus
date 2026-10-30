(function () {
let E = window.parent.Zotero.Research;
let attachmentID = window.frameElement.docxItemID;
let preview;
let selectedText = '';
let job = null;
let stopButton;
let summary = '';
let $ = id => document.getElementById(id);
let el = (tag, text, className) => {
	let node = document.createElement(tag);
	if (text !== undefined) node.textContent = text;
	if (className) node.className = className;
	return node;
};
function renderResult(record) {
	let result = $('result');
	result.replaceChildren();
	for (let section of record.result.sections) {
		let box = el('section');
		box.append(el('h3', section.heading), el('p', section.body));
		for (let id of section.sources) {
			let source = record.sources.find(value => value.id === id);
			if (!source) continue;
			let button = el('button', source.label);
			button.title = source.text;
			button.addEventListener('click', () => E.library.openSource(source));
			box.append(button);
		}
		result.append(box);
	}
	if (record.result.keywords?.length) result.append(el('section', `术语：${record.result.keywords.join(' · ')}`));
}
function setBusy(busy) {
	for (let button of document.querySelectorAll('[data-mode]')) button.disabled = busy;
	$('translate').disabled = busy;
	stopButton.hidden = !busy;
	$('selection-tools').setAttribute('aria-busy', String(busy));
}
async function run(mode) {
	if (job) return;
	let text = selectedText;
	if (!text.trim()) throw new Error('请先选择正文文字');
	let current = new AbortController();
	job = current;
	setBusy(true);
	$('selection-status').textContent = '正在读取选段证据…';
	try {
		let paper = await E.getItem(preview.parentID);
		let record = await E.ai.run({ mode, papers: [E.library.describe(paper)], signal: current.signal,
			selection: { text, attachmentID, paperID: preview.parentID },
			onStatus: (status) => {
				if (!current.signal.aborted) $('selection-status').textContent = status;
			} });
		renderResult(record);
		$('selection-status').textContent = '完成；请核对原文';
	}
	finally {
		job = null;
		setBusy(false);
	}
}
async function init() {
	preview = await E.library.docxPreview(attachmentID);
	$('title').textContent = preview.filename;
	let data = preview.document;
	summary = `${data.paragraphs.length} 段 · ${data.tables.length} 表 · ${data.citations.length} 个引用字段`;
	$('meta').textContent = summary;
	let lastPart = 'word/document.xml';
	for (let paragraph of data.blocks) {
		if (paragraph.part !== lastPart) {
			$('document').append(el('h2', ({ 'word/comments.xml': '文档批注（非正文）', 'word/footnotes.xml': '脚注', 'word/endnotes.xml': '尾注' })[paragraph.part] || paragraph.part));
			lastPart = paragraph.part;
		}
		if (paragraph.type === 'table') {
			let table = el('table'); table.className = 'search-block';
			for (let cells of paragraph.rows) {
				let row = el('tr');
				for (let cell of cells) row.append(el('td', cell));
				table.append(row);
			}
			$('document').append(table);
			continue;
		}
		let level = /(?:heading|标题)\s*([1-6])/i.exec(paragraph.style || '')?.[1]
				|| (paragraph.outlineLevel !== '' ? String(Number(paragraph.outlineLevel) + 1) : '');
		let node = el(level ? `h${Math.min(6, Number(level))}` : 'p', paragraph.text,
			level ? `paragraph search-block heading heading-${level}` : 'paragraph search-block');
		node.id = `paragraph-${paragraph.part.replace(/\W/g, '-')}-${paragraph.index}`;
		$('document').append(node);
		if (level && Number(level) <= 3) {
			let link = el('button', paragraph.text.slice(0, 80));
			link.addEventListener('click', () => node.scrollIntoView({ behavior: 'smooth', block: 'start' }));
			$('outline').append(link);
		}
	}
	document.addEventListener('selectionchange', () => {
		let selection = document.getSelection();
		selectedText = $('document').contains(selection.anchorNode) ? selection.toString().trim().slice(0, 12000) : '';
		$('selection-tools').hidden = !selectedText && !job;
	});
	stopButton = el('button', '停止');
	stopButton.type = 'button';
	stopButton.title = '停止当前解释、术语或翻译；保留上一次结果';
	stopButton.hidden = true;
	stopButton.addEventListener('click', () => {
		$('selection-status').textContent = '正在停止…';
		job?.abort();
	});
	$('selection-status').before(stopButton);
	for (let button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => run(button.dataset.mode).catch((error) => {
		$('selection-status').textContent = error.message;
	}));
	$('translate').addEventListener('click', () => run('translate').catch((error) => {
		$('selection-status').textContent = error.message;
	}));
	$('index').addEventListener('click', async () => {
		$('index').disabled = true;
		$('meta').textContent = summary + ' · 正在建立全文索引…';
		try {
			await window.parent.Zotero.Fulltext.indexItems([attachmentID]);
			$('meta').textContent = summary + ' · 已建立全文索引';
		}
		catch (error) {
			window.parent.Zotero.logError(error);
			$('meta').textContent = `${summary} · 建立全文索引失败：${error?.message || error}。正文仍可阅读和搜索，可稍后重试`;
		}
		finally {
			$('index').disabled = false;
		}
	});
	$('external').addEventListener('click', () => window.parent.Zotero.launchFile(preview.path));
	$('search').addEventListener('input', () => {
		let query = $('search').value.trim().toLocaleLowerCase();
		for (let node of document.querySelectorAll('.search-block')) node.hidden = !!query && !node.textContent.toLocaleLowerCase().includes(query);
	});
	window.docxReady = true;
}
window.addEventListener('DOMContentLoaded', () => init().catch((error) => {
	$('title').textContent = 'DOCX 打开失败'; $('meta').textContent = error.message;
}));
window.addEventListener('pagehide', () => job?.abort());
})();
