/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Static cascade checks for two native acceptance steps: the collection
// toolbar matches the collections pane, and the reader chat input stays
// readable on white and black paper. The rules are the stylesheets the main
// window loads, in document order. Colours are read back the way an 8-bit
// canvas reads them, as the native contrast test does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const RESEARCH = new URL('../../chrome/content/zotero/research/', import.meta.url);
const SCSS = new URL('../../scss/components/', import.meta.url);
const YES = 'yes', NO = 'no', UNKNOWN = 'unknown';
let all = results => results.includes(NO) ? NO : results.includes(UNKNOWN) ? UNKNOWN : YES;
let any = results => results.includes(YES) ? YES : results.includes(UNKNOWN) ? UNKNOWN : NO;

// Visit characters outside quotes, parentheses and brackets; stop on true.
function scan(text, visit) {
	let quote = null, depth = 0;
	for (let i = 0; i < text.length; i++) {
		let ch = text[i];
		if (quote) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") quote = ch;
		else if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (depth === 0 && visit(ch, i)) return i;
	}
	return -1;
}
function stripComments(text) {
	let out = '', quote = null;
	for (let i = 0; i < text.length; i++) {
		let ch = text[i];
		if (quote) {
			out += ch;
			if (ch === '\\') out += text[++i] ?? '';
			else if (ch === quote) quote = null;
		}
		else if (ch === '/' && text[i + 1] === '*') {
			let end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 1;
		}
		else {
			if (ch === '"' || ch === "'") quote = ch;
			out += ch;
		}
	}
	return out;
}
// Top-level {prelude, body} blocks; a statement such as @import has no body.
function blocks(text) {
	let out = [], depth = 0, start = 0, open = -1;
	scan(text, (ch, i) => {
		if (ch === '{') {
			if (depth++ === 0) open = i;
		}
		else if (ch === '}') {
			if (--depth === 0) {
				out.push({prelude: text.slice(start, open).trim(), body: text.slice(open + 1, i)});
				start = i + 1;
			}
		}
		else if (ch === ';' && depth === 0) {
			out.push({prelude: text.slice(start, i).trim(), body: null});
			start = i + 1;
		}
		return false;
	});
	return out.filter(block => block.prelude || block.body !== null);
}
function splitTop(text, separator) {
	let parts = [], start = 0;
	scan(text, (ch, i) => {
		if (ch === separator) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
		return false;
	});
	parts.push(text.slice(start));
	return parts.map(part => part.trim()).filter(Boolean);
}
function declarations(body) {
	if (scan(body, ch => ch === '{') >= 0) throw Error('Nested rules are not modelled: ' + body.slice(0, 80));
	return splitTop(body, ';').map(text => {
		let colon = scan(text, ch => ch === ':');
		if (colon < 0) throw Error('Malformed declaration: ' + text);
		let name = text.slice(0, colon).trim(), value = text.slice(colon + 1).trim(), important = /!\s*important\s*$/i.test(value);
		if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
		return {name: name.startsWith('--') ? name : name.toLowerCase(), value, important};
	});
}
function mediaMatches(condition, env) {
	return splitTop(condition, ',').some(alternative => alternative.split(/\s+and\s+/i).every(term => {
		term = term.trim();
		if (/^(all|screen)$/i.test(term)) return true;
		if (/^print$/i.test(term)) return false;
		let feature = term.match(/^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/i);
		if (!feature) throw Error('Unmodelled media query: ' + condition);
		let [, name, value] = feature;
		if (name === 'prefers-color-scheme') return value === env.scheme;
		if (name === 'prefers-reduced-motion') return value === 'reduce' ? env.reducedMotion : !env.reducedMotion;
		let px = Number(value.replace(/px$/, ''));
		if (name === 'max-width') return env.width <= px;
		if (name === 'min-width') return env.width >= px;
		if (name === 'max-height') return env.height <= px;
		if (name === 'min-height') return env.height >= px;
		throw Error('Unmodelled media feature: ' + name);
	}));
}
// Imported rules take the place of their @import, as the browser applies them.
function loadRules(text, url, env, state = {order: 0, stack: []}, rules = []) {
	for (let {prelude, body} of blocks(stripComments(text))) {
		let at = prelude.match(/^@([a-z-]+)/i)?.[1]?.toLowerCase();
		if (at === 'import') {
			let target = new URL(prelude.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"]/).slice(1).find(Boolean), url);
			if (state.stack.includes(target.href)) throw Error('Import cycle: ' + target.href);
			state.stack.push(target.href);
			loadRules(readFileSync(target, 'utf8'), target, env, state, rules);
			state.stack.pop();
		}
		else if (at === 'media') {
			if (mediaMatches(prelude.slice(6).trim(), env)) loadRules(body, url, env, state, rules);
		}
		else if (at && /(^|-)keyframes$|^(container|font-face|charset|namespace)$/.test(at)) continue;
		else if (at) throw Error('Unmodelled at-rule @' + at + ' in ' + url.href);
		else if (body === null) throw Error('Stray statement in ' + url.href + ': ' + prelude.slice(0, 80));
		else {
			let order = state.order++, list = declarations(body);
			for (let source of splitTop(prelude, ',')) rules.push({source, selector: parseComplex(source), declarations: list, order, sheet: url.href});
		}
	}
	return rules;
}
function parseComplex(text) {
	let parts = [], start = 0, joint = null;
	let flush = end => {
		let compound = text.slice(start, end).trim();
		if (compound) {
			parts.push({combinator: parts.length ? joint || ' ' : null, compound: parseCompound(compound)});
			joint = null;
		}
	};
	scan(text, (ch, i) => {
		if (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~') {
			flush(i);
			if (ch !== ' ' && !/\s/.test(ch)) joint = ch;
			start = i + 1;
		}
		return false;
	});
	flush(text.length);
	if (!parts.length) throw Error('Empty selector');
	return parts;
}
function closing(text, at) {
	let open = text[at], close = open === '(' ? ')' : ']', depth = 0, quote = null;
	for (let i = at; i < text.length; i++) {
		let ch = text[i];
		if (quote) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = null;
		}
		else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === open) depth++;
		else if (ch === close && --depth === 0) return i;
	}
	throw Error('Unbalanced selector: ' + text);
}
const LEGACY_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
function parseCompound(text) {
	let parts = [], i = 0;
	if (text[0] === '*') {
		parts.push({kind: 'universal'});
		i = 1;
	}
	else {
		let tag = text.match(/^[a-zA-Z][\w-]*/);
		if (tag) {
			parts.push({kind: 'type', name: tag[0].toLowerCase()});
			i = tag[0].length;
		}
	}
	while (i < text.length) {
		let rest = text.slice(i), ch = text[i];
		if (ch === '#' || ch === '.') {
			let name = rest.match(/^[#.]([\w-]+)/);
			if (!name) throw Error('Unmodelled selector: ' + text);
			parts.push({kind: ch === '#' ? 'id' : 'class', name: name[1]});
			i += name[0].length;
		}
		else if (ch === '[') {
			let end = closing(text, i), inner = text.slice(i + 1, end).trim(), match = inner.match(/^([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i|s)?)?$/);
			if (!match) throw Error('Unmodelled attribute selector: ' + inner);
			parts.push({kind: 'attr', name: match[1], op: match[2] || null, value: match[3] ?? match[4] ?? match[5] ?? null, insensitive: match[6] === 'i'});
			i = end + 1;
		}
		else if (ch === ':') {
			let element = rest.match(/^::([\w-]+)/) || (LEGACY_ELEMENTS.has(rest.match(/^:([\w-]+)/)?.[1]) ? rest.match(/^:([\w-]+)/) : null);
			if (element) {
				parts.push({kind: 'element', name: element[1]});
				i += element[0].length;
				continue;
			}
			let name = rest.match(/^:([\w-]+)/);
			if (!name) throw Error('Unmodelled selector: ' + text);
			let part = {kind: 'pseudo', name: name[1].toLowerCase()};
			i += name[0].length;
			if (text[i] === '(') {
				let end = closing(text, i);
				part.argument = text.slice(i + 1, end);
				if (['is', 'where', 'not', 'matches', 'has'].includes(part.name)) part.list = splitTop(part.argument, ',').map(parseComplex);
				i = end + 1;
			}
			parts.push(part);
		}
		else throw Error('Unmodelled selector: ' + text);
	}
	return parts;
}
// Elements are modelled at rest: nothing hovered, focused, checked or disabled.
const RESTING = new Set(['hover', 'active', 'focus', 'focus-visible', 'focus-within', 'checked', 'disabled', 'target', 'visited']);
function attribute(element, name) {
	if (name === 'id') return element.id;
	if (name === 'class') return element.classes.length ? element.classes.join(' ') : null;
	return Object.hasOwn(element.attrs, name) ? String(element.attrs[name]) : null;
}
function matchAttr(element, part) {
	let actual = attribute(element, part.name);
	if (actual === null) return NO;
	if (!part.op) return YES;
	let a = part.insensitive ? actual.toLowerCase() : actual, v = part.insensitive ? part.value.toLowerCase() : part.value;
	let hit = {'=': a === v, '~=': a.split(/\s+/).includes(v), '|=': a === v || a.startsWith(v + '-'), '^=': !!v && a.startsWith(v), '$=': !!v && a.endsWith(v), '*=': !!v && a.includes(v)}[part.op];
	return hit ? YES : NO;
}
function structural(element, name) {
	if (name === 'empty') return element.complete ? (element.children.length ? NO : YES) : UNKNOWN;
	let siblings = element.parent?.complete ? element.parent.children : null;
	if (!siblings) return UNKNOWN;
	let same = siblings.filter(sibling => sibling.tag === element.tag);
	let result = {'first-child': siblings[0] === element, 'last-child': siblings.at(-1) === element, 'only-child': siblings.length === 1, 'first-of-type': same[0] === element, 'last-of-type': same.at(-1) === element}[name];
	return result === undefined ? UNKNOWN : result ? YES : NO;
}
function matchPseudo(element, part) {
	if (part.name === 'root') return element.parent ? NO : YES;
	if (part.name in element.state) return element.state[part.name] ? YES : NO;
	if (RESTING.has(part.name)) return NO;
	if (['is', 'where', 'matches'].includes(part.name)) return any(part.list.map(selector => matchComplex(element, selector)));
	if (part.name === 'not') {
		let inner = any(part.list.map(selector => matchComplex(element, selector)));
		return inner === YES ? NO : inner === NO ? YES : UNKNOWN;
	}
	if (['empty', 'first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type'].includes(part.name)) return structural(element, part.name);
	return UNKNOWN;
}
function matchSimple(element, part) {
	switch (part.kind) {
		case 'universal': return YES;
		case 'type': return element.tag === part.name ? YES : NO;
		case 'id': return element.id === part.name ? YES : NO;
		case 'class': return element.classes.includes(part.name) ? YES : NO;
		case 'attr': return matchAttr(element, part);
		case 'pseudo': return matchPseudo(element, part);
		case 'element': return NO;
	}
	throw Error('Unknown selector part ' + part.kind);
}
// A pseudo-element subject such as ::placeholder matches through its host.
function matchComplex(subject, selector) {
	let last = selector.at(-1).compound, elements = last.filter(part => part.kind === 'element');
	if (elements.length > 1 || (elements[0]?.name || null) !== subject.pseudo) return NO;
	let host = subject.pseudo ? subject.host : subject;
	let own = all(last.filter(part => part.kind !== 'element').map(part => matchSimple(host, part)));
	return own === NO ? NO : all([own, matchFrom(host, selector, selector.length - 1)]);
}
function matchFrom(element, selector, index) {
	if (index === 0) return YES;
	let combinator = selector[index].combinator, previous = selector[index - 1].compound;
	let next = candidate => {
		let here = all(previous.map(part => matchSimple(candidate, part)));
		return here === NO ? NO : all([here, matchFrom(candidate, selector, index - 1)]);
	};
	if (combinator === '>') return element.parent ? next(element.parent) : NO;
	if (combinator === ' ') {
		let results = [];
		for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) results.push(next(ancestor));
		return any(results);
	}
	let siblings = element.parent?.complete ? element.parent.children : null;
	if (!siblings) return UNKNOWN;
	let at = siblings.indexOf(element);
	if (combinator === '+') return at > 0 ? next(siblings[at - 1]) : NO;
	if (combinator === '~') return any(siblings.slice(0, at).map(next));
	throw Error('Unknown combinator ' + combinator);
}
function specificity(selector) {
	let total = [0, 0, 0];
	let add = value => value.forEach((n, i) => total[i] += n);
	for (let {compound} of selector) for (let part of compound) {
		if (part.kind === 'id') add([1, 0, 0]);
		else if (part.kind === 'class' || part.kind === 'attr') add([0, 1, 0]);
		else if (part.kind === 'type' || part.kind === 'element') add([0, 0, 1]);
		else if (part.kind === 'pseudo') {
			if (part.name === 'where') continue;
			if (part.list) add(part.list.map(specificity).reduce((a, b) => compareSpecificity(a, b) >= 0 ? a : b));
			else add([0, 1, 0]);
		}
	}
	return total;
}
let compareSpecificity = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
let compareRank = (a, b) => a.important - b.important || compareSpecificity(a.specificity, b.specificity) || a.order - b.order || a.index - b.index;
function cascade(rules) {
	let matches = new WeakMap(), customs = new WeakMap();
	let matched = element => {
		if (!matches.has(element)) matches.set(element, rules.map(rule => ({rule, result: matchComplex(element, rule.selector)})).filter(entry => entry.result !== NO));
		return matches.get(element);
	};
	// The strongest declaration among the names; an undecided match that could
	// outrank it makes the result unknowable rather than silently wrong.
	function winner(element, names) {
		let candidates = [];
		for (let {rule, result} of matched(element)) rule.declarations.forEach((declaration, index) => {
			if (names.includes(declaration.name)) candidates.push({...declaration, result, rule, index, order: rule.order, important: declaration.important ? 1 : 0, specificity: rule.specificity ||= specificity(rule.selector)});
		});
		let decided = candidates.filter(c => c.result === YES).sort(compareRank), best = decided.at(-1) || null;
		let doubt = candidates.find(c => c.result === UNKNOWN && (!best || compareRank(c, best) > 0));
		if (doubt) throw Error('Undecided rule "' + doubt.rule.source + '" in ' + doubt.rule.sheet + ' could set ' + names.join('/'));
		return best;
	}
	function custom(element, name, stack = []) {
		let cache = customs.get(element) || new Map();
		customs.set(element, cache);
		if (cache.has(name)) return cache.get(name);
		let key = element.uid + name;
		if (stack.includes(key)) throw Error('Custom property cycle at ' + name);
		let parent = element.pseudo ? element.host : element.parent, declared = winner(element, [name]), value;
		if (!declared || /^(inherit|unset)$/i.test(declared.value)) value = parent ? custom(parent, name, [...stack, key]) : undefined;
		else if (/^(initial|revert)$/i.test(declared.value)) value = undefined;
		else value = substitute(declared.value, reference => custom(element, reference, [...stack, key]));
		cache.set(name, value);
		return value;
	}
	let computed = (element, names) => {
		let declared = winner(element, names);
		return declared && {name: declared.name, value: substitute(declared.value, name => custom(element, name))};
	};
	return {winner, custom, computed, matched};
}
function substitute(value, lookup) {
	let out = '', at = 0;
	for (let start = value.indexOf('var(', at); start >= 0; start = value.indexOf('var(', at)) {
		let end = closing(value, start + 3), inner = value.slice(start + 4, end), comma = scan(inner, ch => ch === ',');
		let name = (comma < 0 ? inner : inner.slice(0, comma)).trim(), fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
		let found = lookup(name);
		if (found === undefined && fallback === null) throw Error('Unresolved ' + name);
		out += value.slice(at, start) + (found === undefined ? substitute(fallback, lookup) : found);
		at = end + 1;
	}
	return out + value.slice(at);
}
const NAMED = {transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1]};
// Colours as [r, g, b, alpha 0-1]; null when the text is not a colour.
function parseColor(text) {
	text = text.trim();
	let lower = text.toLowerCase();
	if (NAMED[lower]) return NAMED[lower];
	let hex = lower.match(/^#([0-9a-f]{3,8})$/);
	if (hex) {
		let digits = hex[1];
		if (digits.length === 3 || digits.length === 4) digits = [...digits].map(d => d + d).join('');
		if (digits.length !== 6 && digits.length !== 8) throw Error('Bad hex colour ' + text);
		let n = i => parseInt(digits.slice(i, i + 2), 16);
		return [n(0), n(2), n(4), digits.length === 8 ? n(6) / 255 : 1];
	}
	let rgb = lower.match(/^rgba?\((.*)\)$/);
	if (rgb) {
		let values = rgb[1].split(/[\s,/]+/).filter(Boolean).map(v => v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v));
		return [values[0], values[1], values[2], values[3] ?? 1];
	}
	if (lower.startsWith('color-mix(')) return colorMix(text.slice(text.indexOf('(') + 1, closing(text, text.indexOf('('))));
	if (/^[a-z-]+\(/.test(lower)) throw Error('Unmodelled colour function ' + text);
	return null;
}
// color-mix(in srgb, ...) interpolates premultiplied channels; weights under
// 100% scale the alpha, as CSS Color 5 defines.
function colorMix(inner) {
	let [space, first, second] = splitTop(inner, ',');
	if (space.trim().toLowerCase() !== 'in srgb') throw Error('Unmodelled colour space ' + space);
	let item = text => {
		let lead = text.match(/^(\d+(?:\.\d+)?)%\s+(.*)$/s), tail = text.match(/^(.*?)\s+(\d+(?:\.\d+)?)%$/s);
		let [color, weight] = lead ? [lead[2], Number(lead[1])] : tail ? [tail[1], Number(tail[2])] : [text, null];
		let parsed = parseColor(color);
		if (!parsed) throw Error('Not a colour: ' + color);
		return {color: parsed, weight};
	};
	let a = item(first), b = item(second);
	let p1 = a.weight ?? (b.weight === null ? 50 : 100 - b.weight), p2 = b.weight ?? 100 - p1, sum = p1 + p2;
	let w1 = p1 / sum, w2 = p2 / sum, alpha = a.color[3] * w1 + b.color[3] * w2;
	let channel = i => alpha ? (a.color[i] * a.color[3] * w1 + b.color[i] * b.color[3] * w2) / alpha : 0;
	return [channel(0), channel(1), channel(2), alpha * Math.min(1, sum / 100)];
}
const BACKGROUND_WORDS = new Set(['none', 'repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round', 'scroll', 'fixed', 'local', 'border-box', 'padding-box', 'content-box', 'text', 'center', 'top', 'bottom', 'left', 'right', 'auto', 'cover', 'contain']);
// The colour of the final background layer, or transparent when it has none.
function backgroundColor(engine, element) {
	let declared = engine.computed(element, ['background', 'background-color']);
	if (!declared) return NAMED.transparent;
	if (declared.name === 'background-color') return parseColor(declared.value) || assert.fail('Not a colour: ' + declared.value);
	let last = splitTop(declared.value, ',').at(-1), words = [], start = 0;
	scan(last, (ch, i) => {
		if (/\s/.test(ch) || ch === '/') {
			words.push(last.slice(start, i));
			start = i + 1;
		}
		return false;
	});
	words.push(last.slice(start));
	for (let word of words.filter(Boolean)) {
		if (/^url\(|^(repeating-)?(linear|radial|conic)-gradient\(/i.test(word)) continue;
		let color = parseColor(word);
		if (color) return color;
		if (!BACKGROUND_WORDS.has(word.toLowerCase()) && !/^[-\d.]+(px|%|em|rem)?$/.test(word)) throw Error('Unmodelled background token ' + word);
	}
	return NAMED.transparent;
}
// Text colours come from an author rule; the UA field colour is not modelled.
function textColor(engine, element) {
	let declared = engine.computed(element, ['color']);
	if (declared && !/^(inherit|unset)$/i.test(declared.value)) return parseColor(declared.value) || assert.fail('Not a colour: ' + declared.value);
	let parent = element.pseudo ? element.host : element.parent;
	if (!declared && ['textarea', 'input', 'button', 'select'].includes(element.tag)) throw Error('No author colour for ' + element.tag);
	if (!parent) throw Error('No colour on the root');
	return textColor(engine, parent);
}
// An 8-bit canvas stores premultiplied channels; getImageData divides them back.
function pixel([r, g, b, alpha]) {
	let a = Math.round(alpha * 255);
	if (!a) return [0, 0, 0, 0];
	return [r, g, b].map(value => Math.floor(Math.round(value * a / 255) * 255 / a)).concat(a);
}
// The same arithmetic as researchReaderAIOrbTest's contrast check.
let over = (color, background) => color.slice(0, 3).map((value, i) => value * color[3] / 255 + background[i] * (1 - color[3] / 255));
let luminance = color => color.map(value => {value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;}).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
let contrast = (ink, background) => {let a = luminance(over(ink, background)), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);};

let uid = 0;
function node(tag, {id = null, classes = [], attrs = {}, state = {}, complete = false} = {}, parent = null) {
	let element = {uid: 'n' + uid++ + ':', tag, id, classes, attrs, state, parent, children: [], complete, pseudo: null};
	parent?.children.push(element);
	return element;
}
let pseudoOf = (host, name) => ({uid: 'n' + uid++ + ':', tag: '::' + name, id: null, classes: [], attrs: {}, state: {}, parent: host, children: [], complete: true, pseudo: name, host});
// The collections pane after sidebar.js moves the folder toolbar above the
// calendar block and marks it as the library search tools.
function mainWindow(attrs) {
	let root = node('window', {id: 'main-window', attrs: {'data-library-workspace': 'local', ...attrs}});
	let parent = root;
	for (let [tag, id] of [['hbox', 'browser'], ['vbox', 'appcontent'], ['stack', 'zotero-pane-stack'], ['hbox', null], ['deck', 'tabs-deck'], ['tab-content', 'zotero-pane'], ['hbox', 'zotero-trees']]) parent = node(tag, {id}, parent);
	let pane = node('vbox', {id: 'zotero-collections-pane'}, parent);
	let toolbar = node('toolbar', {id: 'zotero-toolbar-collection-tree', classes: ['zotero-toolbar', 'toolbar', 'toolbar-primary', 'native-library-search-tools']}, pane);
	node('div', {id: 'easysch-library-bottom'}, pane);
	return {root, pane, toolbar};
}
// The floating reader chat after undock() and showBottom(), before any reply.
function readerSurface(attrs) {
	let root = node('window', {id: 'main-window', attrs: {'data-library-workspace': 'local', ...attrs}});
	let surface = node('section', {id: 'easysch-conversation-surface', classes: ['clui-native-surface', 'conversation-surface'], attrs: {'data-clui-native': 'true', 'data-clui-persistent': 'false', 'data-clui-size': 'compact', 'data-clui-retracted': 'true', 'data-expanded': 'false', 'data-dimmed': 'false', 'data-presentation': 'reader-bottom', 'data-dock': 'floating', 'data-open': 'true', 'data-idle': 'false', 'data-unfocused': 'false', 'data-pinned': 'false', role: 'dialog', 'aria-modal': 'false', 'aria-label': '研究助手'}}, root);
	let row = node('div', {classes: ['clui-native-input-row', 'conversation-surface-input-row'], attrs: {'aria-hidden': 'true'}}, surface);
	let pill = node('form', {classes: ['clui-native-input-pill', 'clui-native-glass', 'conversation-surface-footer']}, row);
	let composer = node('div', {classes: ['conversation-surface-composer']}, pill);
	let input = node('textarea', {classes: ['conversation-surface-input'], attrs: {rows: '1', placeholder: '讨论研究、查找证据或整理资料…', 'aria-label': '研究问题'}, complete: true}, composer);
	return {root, surface, pill, input, placeholder: pseudoOf(input, 'placeholder')};
}
// Sheets the main window holds once the library workspace, the task rail and
// the reader chat are installed. Each module appends its sheet when it first
// runs, so the two chat sheets can arrive in either order.
const MAIN_SHEETS = ['surface-native.css', 'library-workspace.css', 'shared/task-progress.css'];
const CHAT_SHEETS = ['shared/conversation-surface.css', 'shared/clui-surface.css'];
// Zotero's compiled skin paints both rails with --material-sidepane before any
// research sheet loads. A sentinel colour shows whether a research rule won.
const SIDEPANE = [1, 2, 3, 1];
function nativeRules(env, state, rules) {
	for (let [file, selector] of [['_collection-tree.scss', '#zotero-collections-pane'], ['_toolbar.scss', '#zotero-toolbar-collection-tree']]) {
		let source = readFileSync(new URL(file, SCSS), 'utf8'), at = source.indexOf('\n' + selector + ' {');
		assert.ok(at >= 0, selector + ' rule in ' + file);
		assert.match(source.slice(at, source.indexOf('}', at)), /background: var\(--material-sidepane\);/, file + ' paints ' + selector + ' with the side pane material');
	}
	let css = `:root{--material-sidepane:rgb(${SIDEPANE.slice(0, 3).join(',')})}#zotero-collections-pane{background:var(--material-sidepane)}#zotero-toolbar-collection-tree{background:var(--material-sidepane)}`;
	loadRules(css, new URL('compiled-skin.css', SCSS), env, state, rules);
}
function engineFor(env, chat = CHAT_SHEETS) {
	let state = {order: 0, stack: []}, rules = [];
	nativeRules(env, state, rules);
	for (let file of [...MAIN_SHEETS, ...chat]) {
		let url = new URL(file, RESEARCH);
		loadRules(readFileSync(url, 'utf8'), url, env, state, rules);
	}
	return cascade(rules);
}
let environment = scheme => ({scheme, reducedMotion: false, width: 1480, height: 980});
// Root attributes the native suites set: a host theme alone, an explicit
// EasySch appearance over the opposite host theme, and the OS fallback.
const THEMES = [
	{name: 'native-light', attrs: {'data-theme': 'light'}, scheme: 'light', card: '#fff', surface: [255, 255, 255, 1]},
	{name: 'native-dark', attrs: {'data-theme': 'dark'}, scheme: 'dark', card: '#30363f', surface: [37, 43, 51, 1]},
	{name: 'explicit-light', attrs: {'data-theme': 'dark', 'data-easysch-appearance': 'light'}, scheme: 'dark', card: '#fff', surface: [255, 255, 255, 1]},
	{name: 'explicit-dark', attrs: {'data-theme': 'light', 'data-easysch-appearance': 'dark'}, scheme: 'light', card: '#30363f', surface: [37, 43, 51, 1]},
	{name: 'system-dark', attrs: {systemdark: 'true'}, scheme: 'dark', card: '#30363f', surface: [37, 43, 51, 1]}
];

test('the folder toolbar shares the collections pane surface in every theme', () => {
	for (let theme of THEMES) {
		let engine = engineFor(environment(theme.scheme)), {pane, toolbar} = mainWindow(theme.attrs);
		let paneColor = backgroundColor(engine, pane), toolbarColor = backgroundColor(engine, toolbar);
		assert.notDeepEqual(paneColor, SIDEPANE, theme.name + ': a research rule paints the collections pane');
		assert.deepEqual(toolbarColor, paneColor, theme.name + ': the folder toolbar matches the collections pane');
		assert.deepEqual(paneColor, theme.surface, theme.name + ': both rails use the shared surface colour');
	}
});

test('the reader chat input stays readable on white and black paper in every theme and sheet order', () => {
	for (let chat of [CHAT_SHEETS, [...CHAT_SHEETS].reverse()]) for (let theme of THEMES) {
		let engine = engineFor(environment(theme.scheme), chat), {surface, pill, input, placeholder} = readerSurface(theme.attrs);
		let label = theme.name + ' (' + chat.map(file => file.split('/').pop()).join(' then ') + ')';
		assert.equal(engine.custom(surface, '--ui-card'), theme.card, label + ': the surface uses the shared palette');
		let background = pixel(backgroundColor(engine, pill));
		for (let ink of [textColor(engine, input), textColor(engine, placeholder)]) for (let underlay of [[0, 0, 0], [255, 255, 255]]) {
			let ratio = contrast(pixel(ink), over(background, underlay));
			assert.ok(ratio >= 4.5, `${label}: contrast ${ratio.toFixed(3)} for ${ink.join(',')} over ${underlay.join(',')}`);
		}
	}
});

test('an idle reader entry dims in place and keeps its 30px strip', () => {
	let engine = engineFor(environment('light')), {surface} = readerSurface({'data-theme': 'light'});
	surface.attrs['data-idle'] = 'true';
	let opacity = Number(engine.computed(surface, ['opacity']).value);
	assert.ok(opacity > 0 && opacity <= .6, 'idle opacity ' + opacity);
	assert.equal(engine.computed(surface, ['transform']).value, 'none', 'the entry does not slide out of the reader');
	assert.equal(engine.computed(surface, ['height']).value, '30px', 'the retracted strip keeps its entry');
});

test('the colour arithmetic reproduces the native contrast figure for the lighter glass', () => {
	// researchReaderAIOrbTest logged 4.007217673164575 in native dark with 86% glass.
	let glass = pixel(colorMix('in srgb,#30363f 86%,transparent')), placeholder = pixel(parseColor('#b0b9c7'));
	assert.deepEqual(glass, [47, 53, 62, 219]);
	assert.ok(Math.abs(contrast(placeholder, over(glass, [255, 255, 255])) - 4.007217673164575) < 1e-12);
});
