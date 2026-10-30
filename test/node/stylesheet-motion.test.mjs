/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Motion contracts from the design handbook (拖动时暂停模糊, reduced motion)
// that live only in stylesheets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let sheet=name=>fs.readFileSync(new URL('../../chrome/content/zotero/research/shared/'+name,import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');

test('resizing the chat height pauses the glass blur, as moving the chat already does',()=>{
	let clui=sheet('clui-surface.css'),surface=sheet('conversation-surface.css');
	assert.match(surface,/\[data-dragging=true\] \.clui-native-glass\{backdrop-filter:none;?\}/,'the move drag rule this mirrors');
	assert.match(clui,/\[data-clui-native\]\[data-clui-resizing=true\] \.clui-native-glass\{backdrop-filter:none;?\}/);
});

test('the calendar drawer does not animate when reduced motion is requested',()=>{
	let css=sheet('compact-ui.css');
	assert.match(css,/\.calendar-drawer\{[^}]*animation:calendar-rise/,'the animated rule this guards');
	assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.calendar-drawer\{animation:none;?\}\s*\}/);
});
