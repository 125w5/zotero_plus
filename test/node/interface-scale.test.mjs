/* SPDX-License-Identifier: AGPL-3.0-or-later */
// On 14-16 inch laptops the interface is drawn smaller so the window has about 1536 CSS px
// (a 16 inch laptop's space), never below 80% of the system scaling; layouts are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/interface-scale.js', import.meta.url), 'utf8');
function load({device = 1920, system = 1.5, prefs = {}} = {}) {
	let gecko = new Map(Object.entries(prefs).filter(([key]) => key === 'layout.css.devPixelsPerPx')), zotero = new Map(Object.entries(prefs).filter(([key]) => key.startsWith('easysch.')));
	let screen = {GetRect: (x, y, w, h) => { w.value = device; h.value = 1200; }, get defaultCSSScaleFactor() { return gecko.has('layout.css.devPixelsPerPx') ? Number(gecko.get('layout.css.devPixelsPerPx')) : system; }};
	let Services = {prefs: {
		getStringPref: (key, fallback) => gecko.has(key) ? gecko.get(key) : fallback, setStringPref: (key, value) => gecko.set(key, value),
		prefHasUserValue: key => gecko.has(key), clearUserPref: key => gecko.delete(key)
	}};
	let Zotero = {Prefs: {get: key => zotero.get(key), set: (key, value) => zotero.set(key, value), clear: key => zotero.delete(key)}};
	let E = {};
	vm.runInNewContext(source, {EasySch: E, Services, Zotero, Cc: {'@mozilla.org/gfx/screenmanager;1': {getService: () => ({primaryScreen: screen})}}, Ci: {nsIScreenManager: {}}});
	return {E, gecko, zotero, set screen(next) { device = next.device ?? device; system = next.system ?? system; }};
}
let scale = f => f.gecko.get('layout.css.devPixelsPerPx');

test('common laptop panels get about 1536 CSS px, within 80% of the system scaling', () => {
	let {E} = load();
	assert.equal(E.interfaceScale(1920, 1.5), 1.25, '14 inch 1920x1200 at 150%: 1280 -> 1536 px');
	assert.equal(E.interfaceScale(2560, 2), 1.67, '14 inch 2560x1600 at 200%: 1280 -> 1533 px');
	assert.equal(E.interfaceScale(2880, 2), 1.88, '16 inch 2880x1800 at 200%: 1440 -> 1532 px');
	assert.equal(E.interfaceScale(1920, 1.25), 0, '1920 at 125% already gives 1536 px');
	assert.equal(E.interfaceScale(2560, 1), 0, 'a 27 inch monitor at 100% is not made larger or smaller');
	assert.equal(E.interfaceScale(3840, 2.5), 0, '1536 px already');
	assert.equal(E.interfaceScale(1366, 1), 0.89, 'a 1366 px laptop at 100% is drawn at 89%: 1366 -> 1535 px');
	assert.equal(E.interfaceScale(1280, 1.5), 1.2, 'never below 80% of the system scaling');
	assert.ok(E.interfaceScale(1920, 1) === 0, 'a 1920 px screen at 100% is never enlarged');
	assert.equal(E.interfaceScale(1920, 2), 1.6, 'never below 80% of the system scaling');
});

test('the scale is set on a laptop and kept on the next start', () => {
	let f = load();
	f.E.applyInterfaceScale();
	assert.equal(scale(f), '1.25');
	assert.deepEqual([f.zotero.get('easysch.interfaceScale.applied'), f.zotero.get('easysch.interfaceScale.system'), f.zotero.get('easysch.interfaceScale.device')], ['1.25', '1.5', 1920]);
	f.E.applyInterfaceScale();
	assert.equal(scale(f), '1.25', 'Gecko now reports 1.25 as the screen scale; the recorded 150% is used');
});

test('a scale set by the user, a test profile or turning it off are respected', () => {
	let user = load({prefs: {'layout.css.devPixelsPerPx': '1.4'}});
	user.E.applyInterfaceScale();
	assert.equal(scale(user), '1.4', 'a value set in about:config is not replaced');
	let tests = load({prefs: {'easysch.testProfile': true}});
	tests.E.applyInterfaceScale();
	assert.equal(scale(tests), undefined, 'test screenshots keep the system scaling');
	let off = load();
	off.E.applyInterfaceScale();
	off.zotero.set('easysch.interfaceScale.auto', false);
	off.E.applyInterfaceScale();
	assert.equal(scale(off), undefined, 'turning it off restores the system scaling');
	assert.equal(off.zotero.get('easysch.interfaceScale.applied'), undefined);
});

test('a different screen clears the scale so the next start measures it again', () => {
	let f = load();
	f.E.applyInterfaceScale();
	f.screen = {device: 2560, system: 1};
	f.E.applyInterfaceScale();
	assert.equal(scale(f), undefined, 'the recorded scaling belongs to the old screen');
	f.E.applyInterfaceScale();
	assert.equal(scale(f), undefined, 'a 27 inch monitor at 100% needs no change');
});
