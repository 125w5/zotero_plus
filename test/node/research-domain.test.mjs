/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeResearchScope,matchesResearchScope,buildResearchQuery,researchScopeFromProject} from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import {activePlanDecisions} from '../../chrome/content/zotero/research/shared/academic-plan.mjs';

test('research scope requires the selected field and both keyword groups',()=>{
 const scope={domain:'communications',primaryKeyword:'AMC;modulation classification',secondaryKeyword:'low SNR'};
 assert.equal(matchesResearchScope({title:'AMC in wireless channels',abstract:'Automatic modulation classification at low SNR'},scope),true);
 assert.equal(matchesResearchScope({title:'CNN image classification',abstract:'Neural networks for visual datasets at low SNR'},scope),false);
 assert.equal(matchesResearchScope({title:'AMC wireless modulation',abstract:'high SNR only'},scope),false);
});
test('fuzzy search preserves short acronyms and the user supplied meaning',()=>{
 assert.equal(matchesResearchScope('connexin cellular model',{primaryKeyword:'CNN'}),false);
 assert.equal(matchesResearchScope('CNN convolutional neural network',{primaryKeyword:'CNN',acronymMeaning:'convolutional neural network'}),true);
 assert.equal(matchesResearchScope('CNN cellular neural network',{primaryKeyword:'CNN',acronymMeaning:'convolutional neural network'}),false);
 assert.equal(matchesResearchScope('CNN-based modulation at low-SNR',{primaryKeyword:'CNN',secondaryKeyword:'low SNR'}),true);
 assert.equal(matchesResearchScope('robust channel estimators',{primaryKeyword:'estimator',fuzzy:true}),true);
 assert.equal(matchesResearchScope('robust channel estimators',{primaryKeyword:'estimator',fuzzy:false}),false);
});
test('query construction keeps primary and secondary task constraints without guessed acronym expansion',()=>{
 const scope=normalizeResearchScope({fieldID:'physics',primaryKeyword:'CNN',secondaryKeywords:['spin'],excludedKeywords:['medical']});
 const query=buildResearchQuery(scope,'quantum model');assert.match(query,/CNN/);assert.match(query,/spin/);assert.match(query,/physics/);assert.doesNotMatch(query,/convolution/i);
 assert.equal(matchesResearchScope('CNN quantum spin medical',scope),false);
 assert.deepEqual(researchScopeFromProject({researchPreparation:{researchScope:scope}}),scope);
});
test('active decisions use the current version and remove revoked or superseded records',()=>{
 const rows=[{decision:'使用同一批次',versionID:'old'},{id:'choice',decision:'随机拆分',versionID:'v2',status:'confirmed'},{id:'choice',decision:'随机拆分',versionID:'v2',status:'revoked'},{decision:'独立场景验证',versionID:'v2',reason:'检验泛化'}];
 assert.deepEqual(activePlanDecisions(rows,'v2'),[{decision:'独立场景验证',reason:'检验泛化',objection:''}]);assert.equal(rows.length,4);
});
