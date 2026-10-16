/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Shared research evidence citation display',function(){
 it('uses compact linked citations for saved PDF aliases while preserving math and actual navigation',async()=>{
  const E=Zotero.Research,win=await loadZoteroPane(),doc=win.document,host=doc.createElementNS('http://www.w3.org/1999/xhtml','section');doc.documentElement.append(host);
  const evidence=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-evidence.mjs'),source={id:'P1-T7',stableID:'evidence:paper:4:P1-T7',title:'实验条件',uri:'zotero://open-pdf/library/items/TEST?page=1',sourceText:'原文记录为28GHz。',attachmentID:4,pageIndex:0},seen=[];
  const text='已读取实验条件。\nP1-T7\n\n[P1-T7]('+source.uri+')\n\n$$E_{\\mathrm{F}} = x_i^2$$\n\n$$x_{[P1-T7]}$$';
  try{E.renderContent(host,evidence.evidenceCitationText(text,[source]),{sources:[source],onSource:value=>seen.push(value)});const citations=host.querySelectorAll('.source-citation');assert.lengthOf(citations,2);for(const link of citations){assert.equal(link.textContent,'[1]');assert.equal(link.dataset.sourceID,source.stableID);link.click();}assert.deepEqual(seen,[source,source]);assert.equal(host.querySelector('.katex annotation').textContent,'E_{\\mathrm{F}} = x_i^2');assert.equal(host.querySelectorAll('.katex annotation')[1].textContent,'x_{[P1-T7]}','公式内部类似编号的字样保持原式，不转换成来源按钮');assert.strictEqual(evidence.citedSources({text,sources:[source]})[0],source);assert.include(text,'P1-T7','保存消息保留完整原始来源ID');}
  finally{host.remove();win.close();}
 });
});
