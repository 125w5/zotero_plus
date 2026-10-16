/* SPDX-License-Identifier: AGPL-3.0-or-later */
// User explanations are separate from immutable excerpts and PDF geometry.
import {normalizeMaterialHighlights} from './material-highlights.mjs';
export function explicitFormula(material) {
	return typeof material?.latex === 'string' ? material.latex : '';
}

export function explanationNumberTokens(text) {
	let value = String(text || '').replace(/[\u2212\ufe63\uff0d]/g, '-').replace(/\uff0b/g, '+').replace(/\uff0e/g, '.')
		.replace(/\\times|\\cdot|[⋅·]/g, '×').replace(/\\%/g, '%');
	const literal = '[+-]?(?:\\d+(?:,\\d{3})*(?:\\.\\d*)?|\\.\\d+)';
	// Canonicalize explicit decimal scientific notation only, never infer a
	// computation, missing sign, decimal separator or a mathematical definition.
	value = value.replace(new RegExp('(' + literal + ')\\s*[×*]\\s*10\\s*(?:\\^\\s*)?\\{?\\s*([+-]?\\d+)\\s*\\}?', 'g'), (_, mantissa, power) => mantissa.replace(/,/g, '') + 'e' + power);
	value = value.replace(/\b10\s*\^\s*\{?\s*([+-]?\d+)\s*\}?/g, (_, power) => '1e' + power);
	const tokens = value.match(new RegExp(literal + '(?:[eE][+-]?\\d+)?\\s*%?', 'g')) || [];
	return tokens.map(token => {
		const percent = /%\s*$/.test(token), source = token.replace(/[\s,%]/g, '');
		const parts = source.match(/^([+-]?)(\d*(?:\.\d*)?)(?:[eE]([+-]?\d+))?$/);
		if (!parts) return source.toLowerCase() + (percent ? '%' : '');
		const [whole, fraction = ''] = parts[2].split('.');
		let digits = (whole + fraction).replace(/^0+/, '');
		if (!digits) return '0' + (percent ? '%' : '');
		const suffix = digits.match(/0+$/)?.[0].length || 0; if (suffix) digits = digits.slice(0, -suffix);
		// Exact decimal canonicalization, not floating-point equality. Long
		// mantissas and very small exponents must not silently become equal.
		const exponent = BigInt(parts[3] || 0) - BigInt(fraction.length) + BigInt(suffix);
		return (parts[1] === '-' ? '-' : '') + digits + 'e' + exponent + (percent ? '%' : '');
	});
}

export function assertExplanationNumbers(explanation, ...sources) {
	const permitted = new Set(sources.flatMap(explanationNumberTokens));
	if (explanationNumberTokens(explanation).some(token => !permitted.has(token))) throw Error('说明中出现原文没有的数值，请核对后手工编辑。');
	return explanation;
}

export function normalizeMaterialContents(value) {
	if (!Array.isArray(value) || value.length > 50) throw Error('说明最多包含 50 个内容块');
	return value.map((entry, index) => {
		if (!entry || typeof entry !== 'object') throw Error('说明内容无效');
		const id = typeof entry.id === 'string' ? entry.id.slice(0, 100) : 'content-' + index;
		if (entry.type === 'text' || entry.type === 'formula') {
			const key = entry.type === 'formula' ? 'latex' : 'text';
			if (typeof entry[key] !== 'string' || entry[key].length > 20000) throw Error('说明文字或公式过长');
			return {id, type: entry.type, [key]: entry[key]};
		}
		if (entry.type === 'image') {
			if (typeof entry.imagePath !== 'string' || !entry.imagePath.trim() || entry.imagePath.length > 4096) throw Error('图片文件位置无效');
			return {id, type: 'image', imagePath: entry.imagePath, caption: String(entry.caption || '').slice(0, 4000)};
		}
		if (entry.type === 'table') {
			if (!Array.isArray(entry.rows) || !entry.rows.length || entry.rows.length > 100
				|| entry.rows.some(row => !Array.isArray(row) || !row.length || row.length > 30)) throw Error('表格支持 1–100 行、1–30 列');
			const width = entry.rows[0].length;
			if (entry.rows.some(row => row.length !== width)) throw Error('表格每行列数应一致');
			return {id, type: 'table', rows: entry.rows.map(row => row.map(cell => String(cell ?? '').slice(0, 4000))), caption: String(entry.caption || '').slice(0, 4000)};
		}
		throw Error('不支持的说明内容');
	});
}

export function materialExplanationPatch(changes,material) {
	const patch = {};
	for (const key of ['title', 'summary', 'latex']) if (changes[key] !== undefined) {
		if (typeof changes[key] !== 'string' || changes[key].length > 20000) throw Error('素材说明无效或过长');
		patch[key] = changes[key];
	}
	if (changes.contents !== undefined) patch.contents = normalizeMaterialContents(changes.contents);
	if (changes.highlights !== undefined) patch.highlights = normalizeMaterialHighlights(changes.highlights,material);
	return patch;
}

export function formulaEvidenceRows(assets, {attachmentIDs = []} = {}) {
	const allowed = new Set(attachmentIDs), seen = new Set();
	return (assets || []).filter(asset => asset?.kind === 'formula' && (!allowed.size || allowed.has(asset.attachmentID)))
		.filter(asset => {
			const key = JSON.stringify([asset.attachmentID, asset.pdfHash, asset.pageIndex, asset.bbox]);
			if (seen.has(key)) return false;
			seen.add(key); return true;
		}).sort((a, b) => (a.pageIndex ?? Infinity) - (b.pageIndex ?? Infinity) || (a.bbox?.[1] || 0) - (b.bbox?.[1] || 0));
}

// Only use script/italic information explicitly recovered from PDF glyphs.
// Flattened source text is never guessed into TeX, HTML or superscripts.
export function renderSourceRuns(host, text, runs) {
	const doc = host.ownerDocument;
	const valid = Array.isArray(runs) ? runs.filter(run => typeof run?.text === 'string') : [];
	const compact = value => String(value || '').replace(/\s+/g, '');
	if (!valid.length || text && compact(valid.map(run => run.text).join('')) !== compact(text)) {host.textContent = text || ''; return;}
	for (const run of valid) {
		const tag = run.script === 'super' || run.sup ? 'sup' : run.script === 'sub' || run.sub ? 'sub' : 'span';
		let node = doc.createElement(tag); node.textContent = run.text;
		if (run.fontStyle === 'italic' || run.italic) {const em = doc.createElement('em'); em.append(node); node = em;}
		if (run.bold) {const strong = doc.createElement('strong'); strong.append(node); node = strong;}
		host.append(node);
	}
}
