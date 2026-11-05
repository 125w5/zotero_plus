/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The assembly page keeps A4 width and is scaled to the canvas: a 27 inch monitor shows it
// at 100%, a 14 inch laptop at about 74%, with the same line and page breaks on both.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPER_WIDTH, paperFit, paperScale} from '../../chrome/content/zotero/research/manuscript/paper-scale.mjs';

test('a canvas narrower than A4 scales the page down; a wider one keeps 100%', () => {
	assert.equal(PAPER_WIDTH, 794);
	assert.equal(paperFit(1739), 1, '27 inch: the page keeps its size with margins around it');
	assert.equal(paperFit(794), 1);
	assert.equal(paperFit(584), 0.73, '14 inch at 150%: 584 px of canvas');
	assert.equal(paperFit(200), 0.5, 'never below half size');
	assert.equal(paperFit(0), 1, 'a hidden canvas keeps the last size');
	assert.equal(paperFit(undefined), 1);
});

test('the Ctrl+wheel zoom multiplies the fitted size', () => {
	assert.equal(paperScale({paperZoom: 1}, 0.73), 0.73);
	assert.equal(paperScale({paperZoom: 1.2}, 0.75), 0.9);
	assert.equal(paperScale({}, undefined), 1);
	assert.equal(paperScale(undefined, 0.8), 0.8);
});
