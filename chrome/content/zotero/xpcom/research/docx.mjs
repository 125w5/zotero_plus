/* SPDX-License-Identifier: AGPL-3.0-or-later */
ChromeUtils.defineESModuleGetters(globalThis, { Zotero: 'chrome://zotero/content/zotero.mjs' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W_STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const MAX_XML_BYTES = 32 * 1024 * 1024;
const parts = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml'];

// Native ZIP and XML parsers are shared with Zotero's EPUB implementation.
// Never execute field instructions or resolve external relationships.
export function parsePart(xml, part, Parser = DOMParser) {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCX XML 不允许 DTD 或实体声明');
	let doc = new Parser().parseFromString(xml, 'application/xml');
	if (doc.getElementsByTagName('parsererror').length) throw new Error(`DOCX XML 损坏：${part}`);
	let ns = doc.documentElement.namespaceURI;
	if (![W, W_STRICT].includes(ns)) throw new Error(`不支持的 DOCX 命名空间：${part}`);
	let nodes = (node, tag) => [...node.getElementsByTagNameNS(ns, tag)];
	let attr = (node, name) => node?.getAttributeNS(ns, name) || '';
	let excluded = node => {
		for (let p = node.parentNode; p && p !== doc; p = p.parentNode) {
			if (p.namespaceURI === ns && ['del', 'moveFrom'].includes(p.localName)) return true;
		}
		return false;
	};
	let textOf = node => {
		if (excluded(node)) return '';
		if (node.localName === 't' && /\/officeDocument\/2006\/math$|\/ooxml\/officeDocument\/math$/.test(node.namespaceURI || '')) return node.textContent;
		if (node.namespaceURI === ns) {
			if (['del', 'moveFrom', 'instrText', 'delText'].includes(node.localName)) return '';
			if (node.localName === 't') return node.textContent;
			if (node.localName === 'tab') return '\t';
			if (['br', 'cr'].includes(node.localName)) return '\n';
		}
		return [...node.childNodes].map(textOf).join('');
	};
	let paragraphs = nodes(doc, 'p').filter(p => !excluded(p)).map((p, i) => ({
		part, index: i + 1, style: attr(nodes(p, 'pStyle')[0], 'val'),
		outlineLevel: attr(nodes(p, 'outlineLvl')[0], 'val'), text: textOf(p)
	})).filter(p => p.text.trim());
	let tables = nodes(doc, 'tbl').map(table => nodes(table, 'tr').map(row =>
		[...row.children].filter(c => c.namespaceURI === ns && c.localName === 'tc').map(textOf)));
	let citations = nodes(doc, 'instrText').map(n => n.textContent).filter(t => /ZOTERO_ITEM|ZOTERO_BIBL|\bCITATION\b/.test(t));
	return { paragraphs, tables, citations };
}

export async function extractDOCX(path) {
	const ZipReader = Components.Constructor('@mozilla.org/libjar/zip-reader;1', 'nsIZipReader', 'open');
	let zip = new ZipReader(Zotero.File.pathToFile(path));
	try {
		if (!zip.hasEntry('word/document.xml')) throw new Error('文件不是有效 DOCX（缺少正文）');
		let output = { paragraphs: [], tables: [], citations: [] }, total = 0;
		for (let part of parts) {
			if (!zip.hasEntry(part)) continue;
			total += zip.getEntry(part).realSize;
			if (total > MAX_XML_BYTES) throw new Error('DOCX 解压正文超过 32 MB 限制');
			let stream = zip.getInputStream(part), xml;
			try { xml = await Zotero.File.getContentsAsync(stream, 'UTF-8'); }
			finally { stream.close(); }
			let data = parsePart(xml, part);
			for (let key of Object.keys(output)) output[key].push(...data[key]);
		}
		output.text = output.paragraphs.map(p => p.text).join('\n');
		return output;
	}
	finally { zip.close(); }
}
