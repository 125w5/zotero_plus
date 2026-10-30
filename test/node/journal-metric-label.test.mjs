/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {journalMetricLabel,journalMetricDetail} from '../../chrome/content/zotero/research/shared/journal-metric-label.mjs';

test('an IF without a metric year is pending verification, with the reported value retained only in detail',()=>{
 for(const impact_factor of [8,8.4]){const metric={impact_factor,metric_year:null,source:'easyScholar 当前返回'};assert.equal(journalMetricLabel(metric),'IF 待核验（年份未标明）');assert.match(journalMetricDetail(metric),new RegExp('来源报告值 '+impact_factor));assert.match(journalMetricDetail(metric),/easyScholar/);}
 assert.equal(journalMetricLabel({impact_factor:8.4,metric_year:2025}),'IF 8.4 · 2025');assert.equal(journalMetricLabel({impact_factor:8.4,metric_year:2025},{submitted:true}),'投稿期刊 IF 8.4 · 2025');
 assert.equal(journalMetricLabel({impact_factor:NaN}), '');assert.equal(journalMetricLabel(null),'');assert.match(journalMetricLabel({impact_factor:8.4,metric_year:'latest'}),/待核验/);
});
