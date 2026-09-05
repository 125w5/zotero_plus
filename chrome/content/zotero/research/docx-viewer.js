(function () {
let E = window.parent.Zotero.Research;
let attachmentID = window.frameElement.docxItemID;
let preview;
let selectedText = '';
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
async function run(mode) {
	if (!selectedText.trim()) throw new Error('请先选择正文文字');
	$('selection-status').textContent = '正在读取选段证据…';
	let paper = await E.getItem(preview.parentID);
	let record = await E.ai.run({ mode, papers: [E.library.describe(paper)],
		selection: { text: selectedText, attachmentID, paperID: preview.parentID },
		onStatus: (text) => {
			$('selection-status').textContent = text;
		} });
	renderResult(record);
	$('selection-status').textContent = '完成；请核对原文';
}
async function init() {
	preview = await E.library.docxPreview(attachmentID);
	$('title').textContent = preview.filename;
	let data = preview.document;
	$('meta').textContent = `${data.paragraphs.length} 段 · ${data.tables.length} 表 · ${data.citations.length} 个引用字段`;
	for (let paragraph of data.paragraphs) {
		let level = /(?:heading|标题)\s*([1-6])/i.exec(paragraph.style || '')?.[1]
				|| (paragraph.outlineLevel !== '' ? String(Number(paragraph.outlineLevel) + 1) : '');
		let node = el(level ? `h${Math.min(6, Number(level))}` : 'p', paragraph.text,
			level ? `paragraph heading heading-${level}` : 'paragraph');
		node.id = `paragraph-${paragraph.part.replace(/\W/g, '-')}-${paragraph.index}`;
		$('document').append(node);
		if (level && Number(level) <= 3) {
			let link = el('button', paragraph.text.slice(0, 80));
			link.addEventListener('click', () => node.scrollIntoView({ behavior: 'smooth', block: 'start' }));
			$('outline').append(link);
		}
	}
	for (let rows of data.tables) {
		let table = el('table');
		for (let cells of rows) {
			let row = el('tr');
			for (let cell of cells) row.append(el('td', cell));
			table.append(row);
		}
		$('document').append(table);
	}
	document.addEventListener('selectionchange', () => {
		let selection = document.getSelection();
		selectedText = $('document').contains(selection.anchorNode) ? selection.toString().trim().slice(0, 12000) : '';
		$('selection-tools').hidden = !selectedText;
	});
	for (let button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => run(button.dataset.mode).catch((error) => {
		$('selection-status').textContent = error.message;
	}));
	$('translate').addEventListener('click', () => run('translate').catch((error) => {
		$('selection-status').textContent = error.message;
	}));
	$('index').addEventListener('click', async () => {
		await window.parent.Zotero.Fulltext.indexItems([attachmentID]); $('meta').textContent += ' · 已建立全文索引';
	});
	$('external').addEventListener('click', () => window.parent.Zotero.launchFile(preview.path));
	$('search').addEventListener('input', () => {
		let query = $('search').value.trim().toLocaleLowerCase();
		for (let node of document.querySelectorAll('.paragraph')) node.hidden = !!query && !node.textContent.toLocaleLowerCase().includes(query);
	});
}
window.addEventListener('DOMContentLoaded', () => init().catch((error) => {
	$('title').textContent = 'DOCX 打开失败'; $('meta').textContent = error.message;
}));
})();
