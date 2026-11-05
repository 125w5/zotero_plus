/* SPDX-License-Identifier: AGPL-3.0-or-later */
// On a 14-16 inch laptop the assembly window is 1280-1536 px wide. The saved 380/390 px
// side panes left the paper about 510 px; they now shrink in proportion so the canvas
// keeps at least 620 px, while wide windows and the saved widths are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyPaneWidths} from '../../chrome/content/zotero/research/manuscript/assembly-workflow.mjs';

let canvas = (width, panes) => width - panes.left - panes.right;

test('a laptop window shrinks both side panes in proportion and keeps the canvas room', () => {
	let panes = assemblyPaneWidths({width: 1280, left: 380, right: 390});
	assert.equal(canvas(1280, panes), 620);
	assert.ok(Math.abs(panes.left / panes.right - 380 / 390) < 0.01, 'the saved proportion is kept');
	panes = assemblyPaneWidths({width: 1536, left: 380, right: 390});
	assert.deepEqual(panes, {left: 380, right: 390}, 'a 16 inch window already has room');
});

test('a wide window, a closed pane or an unknown width leaves the saved widths alone', () => {
	assert.deepEqual(assemblyPaneWidths({width: 1600, left: 380, right: 390}), {left: 380, right: 390});
	assert.deepEqual(assemblyPaneWidths({width: undefined, left: 380, right: 390}), {left: 380, right: 390});
	let leftOnly = assemblyPaneWidths({width: 1280, left: 380, right: 390, rightOpen: false});
	assert.deepEqual(leftOnly, {left: 380, right: 390}, 'with the right pane closed the canvas has room');
});

test('panes never shrink below their minimum widths', () => {
	let panes = assemblyPaneWidths({width: 900, left: 380, right: 390});
	assert.deepEqual(panes, {left: 230, right: 280});
	assert.deepEqual(assemblyPaneWidths({width: 980, left: 230, right: 230}), {left: 230, right: 230}, 'a pane the user made narrower than the minimum is not widened');
});
