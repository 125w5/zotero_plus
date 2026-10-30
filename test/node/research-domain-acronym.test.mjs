/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {acronymMeaningTerm, matchesResearchScope, buildResearchQuery, normalizeResearchScope, researchScopeLabel} from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import {prepareDiscoveryQuery, matchesPreparedDiscoveryScope} from '../../chrome/content/zotero/research/shared/discovery-query.mjs';

test('the documented "X = meaning" form keeps only the meaning as a match term', () => {
	assert.equal(acronymMeaningTerm('CNN = 卷积神经网络'), '卷积神经网络');
	assert.equal(acronymMeaningTerm('CNN＝convolutional neural network'), 'convolutional neural network', 'full-width equals sign');
	assert.equal(acronymMeaningTerm('卷积神经网络 = CNN'), '卷积神经网络', 'meaning written first');
	assert.equal(acronymMeaningTerm('3DGS = Gaussian splatting'), 'Gaussian splatting');
	assert.equal(acronymMeaningTerm('convolutional neural network'), 'convolutional neural network', 'a bare meaning is unchanged');
	assert.equal(acronymMeaningTerm('CNN ='), '', 'an acronym without a meaning adds no requirement');
	assert.equal(acronymMeaningTerm(''), '');
});

test('records match the meaning instead of the literal "=" string, and the saved scope keeps the typed text', () => {
	let scope = {primaryKeyword: 'CNN', acronymMeaning: 'CNN = convolutional neural network'};
	assert.equal(matchesResearchScope('CNN convolutional neural network for radar', scope), true);
	assert.equal(matchesResearchScope('CNN cellular neural network', scope), false, 'a different expansion still does not match');
	assert.equal(matchesResearchScope('卷积神经网络 雷达', {acronymMeaning: 'CNN = 卷积神经网络'}), true);
	assert.equal(buildResearchQuery(scope), 'CNN convolutional neural network');
	assert.equal(normalizeResearchScope(scope).acronymMeaning, 'CNN = convolutional neural network');
	assert.match(researchScopeLabel(scope), /CNN = convolutional neural network/);
});

test('a Chinese meaning uses the term table and needs no model translation', async () => {
	let E = {store: {get: () => undefined, update: async () => {throw Error('no translation cache write expected');}}, studio: {request: async () => {throw Error('no model call expected');}}};
	let prepared = await prepareDiscoveryQuery(E, 'CNN', {primaryKeyword: 'CNN', acronymMeaning: 'CNN = 卷积神经网络'});
	assert.equal(prepared.warning, '');
	assert.equal(prepared.researchScope.acronymMeaning, 'convolutional neural network');
	assert.equal(prepared.originalResearchScope.acronymMeaning, 'CNN = 卷积神经网络');
	assert.match(prepared.query, /convolutional neural network/);
	assert.doesNotMatch(prepared.query, /=/);
	assert.equal(matchesPreparedDiscoveryScope({title: 'A CNN (convolutional neural network) for modulation'}, prepared), true);
	assert.equal(matchesPreparedDiscoveryScope({title: 'CNN news ranking'}, prepared), false);
});
