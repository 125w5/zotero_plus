/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDiscoveryQuery,removeDiscoveryQueryTerm,discoveryScopeVerdict,discoveryDomainMatch,discoveryQueryGroups,discoveryQueryText} from '../../chrome/content/zotero/research/shared/discovery-query.mjs';
import {matchesResearchScope,wordStem,canonicalResearchDomain,normalizeResearchScope} from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import {sortDiscoveryRecords} from '../../chrome/content/zotero/research/shared/discovery-presentation.mjs';

function engine(reply){
 const state={},calls=[];
 const E={store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>fn(state)},studio:{request:async(prompt,input)=>{calls.push({prompt,input});return{value:typeof reply==='function'?reply(input):reply};}}};
 return{E,state,calls};
}
const SCOPE={domain:'earth-environment',primaryKeyword:'solute transport',secondaryKeyword:'macropore',fuzzy:true};
const prepare=(E,expansion,scope=SCOPE,extra={})=>prepareDiscoveryQuery(E,scope.primaryKeyword,scope,undefined,{discovery:{domainMatch:'rank',queryExpansion:expansion},...extra});

test('an explicit search asks the model once for same-concept synonyms, builds OR groups and reuses them from the cache',async()=>{
 const {E,calls}=engine({translations:{},synonyms:{primaryKeyword:['solute transfer','Solute Transport','transport and flow','溶质运移','solute migration'],secondaryKeyword:['macropores','preferential flow']}});
 const first=await prepare(E,'auto');
 assert.equal(calls.length,1);assert.deepEqual(first.queryExpansion.terms,{primaryKeyword:['solute transfer','solute migration'],secondaryKeyword:['macropores','preferential flow']},'duplicates, boolean words and Chinese are dropped');
 assert.equal(first.queryExpansion.source,'model');
 assert.equal(first.query,'((solute transport) OR (solute transfer) OR (solute migration)) AND (macropore OR macropores OR (preferential flow))');
 assert.equal(first.plainQuery,'solute transport macropore');assert.doesNotMatch(first.query,/earth/,'the ranked domain is not a required word');
 assert.ok(matchesResearchScope({title:'Preferential flow and solute migration in loam'},first.researchScope,{domain:false}),'the local check accepts what the OR groups return');
 const again=await prepare(E,'cache');assert.equal(calls.length,1,'filters, paging and history reuse the saved terms');assert.equal(again.query,first.query);assert.equal(again.queryExpansion.source,'cache');
 const fresh=await prepare(E,'auto');assert.equal(calls.length,1,'one cached expansion per normalized query');assert.equal(fresh.query,first.query);
 await removeDiscoveryQueryTerm(E,first.queryExpansion.signature,'preferential flow');
 const removed=await prepare(E,'cache');assert.equal(calls.length,1);assert.deepEqual(removed.queryExpansion.terms.secondaryKeyword,['macropores']);assert.doesNotMatch(removed.query,/preferential/);
 const kept=await prepare(E,{terms:removed.queryExpansion.terms,removed:removed.queryExpansion.removed});assert.equal(kept.query,removed.query,'load more keeps the first page terms');assert.equal(calls.length,1);
 const off=await prepare(E,'off');assert.equal(off.queryExpansion,null);assert.equal(off.query,'solute transport macropore','without alternatives the query keeps its plain form');
});

test('Chinese keywords are translated and expanded in the same single request',async()=>{
 const {E,calls}=engine(input=>({translations:{query:'soil pore water',primaryKeyword:'soil pore water'},synonyms:{primaryKeyword:['pore water','soil water']}}));
 const result=await prepare(E,'auto',{domain:'',primaryKeyword:'土壤孔隙水',secondaryKeyword:'',fuzzy:true});
 assert.equal(calls.length,1,'never a translation call and a separate expansion call');assert.deepEqual(calls[0].input.synonymFields,['primaryKeyword']);assert.equal(calls[0].input.terms.primaryKeyword,'土壤孔隙水');
 assert.equal(result.researchScope.primaryKeyword.split('; ')[0],'soil pore water');assert.equal(result.query,'((soil pore water) OR (pore water) OR (soil water))');
});

test('without a configured model nothing is requested and the status says the terms were not expanded',async()=>{
 const {E,calls}=engine({});
 const result=await prepare(E,'auto',SCOPE,{modelReady:async()=>false});
 assert.equal(calls.length,0);assert.ok(result.notes.includes('未配置模型，本次未扩展检索词。'));assert.equal(result.queryExpansion.source,'none');assert.equal(result.query,'solute transport macropore');
});

test('a ";" list is one concept with alternatives, not words that must all appear',()=>{
 const groups=discoveryQueryGroups(normalizeResearchScope({primaryKeyword:'solute transport',secondaryKeyword:'macropore; preferential flow'}),'solute transport');
 assert.deepEqual(groups,[['solute transport'],['macropore','preferential flow']]);assert.equal(discoveryQueryText(groups),'(solute transport) AND (macropore OR (preferential flow))');
 assert.deepEqual(discoveryQueryGroups(normalizeResearchScope({domain:'earth-environment'}),''),[['earth','environment','environmental','climate','geology','ecology']],'a domain-only browse ORs the domain terms');
});

test('the domain ranks by default, strict matching is explicit, and Chinese text is never required in English records',async()=>{
 const {E}=engine({});
 const ranked=await prepareDiscoveryQuery(E,'solute transport',{...SCOPE,domain:'地球'},undefined,{discovery:{domainMatch:'rank',queryExpansion:'off'}});
 assert.equal(ranked.researchScope.domain,'earth-environment');assert.ok(ranked.notes.some(note=>note.includes('研究领域“地球”按“地球与环境”处理')));
 const soil={title:'Solute transport in macropores of a loam soil',abstract:'Tracer breakthrough curves in undisturbed columns.'},climate={title:'Climate effects on solute transport through macropore flow'};
 assert.equal(discoveryScopeVerdict(soil,ranked),'match','a paper without the domain words is kept');assert.equal(discoveryDomainMatch(soil,ranked),false);assert.equal(discoveryDomainMatch(climate,ranked),true);
 assert.deepEqual(sortDiscoveryRecords([{id:'soil',domainMatch:false},{id:'climate',domainMatch:true}],'relevance').map(row=>row.id),['climate','soil'],'domain matches rank first');
 const strict=await prepareDiscoveryQuery(E,'solute transport',SCOPE,undefined,{discovery:{domainMatch:'strict',queryExpansion:'off'}});
 assert.equal(discoveryScopeVerdict(soil,strict),'domain');assert.equal(discoveryScopeVerdict(climate,strict),'match');
 const custom=await prepareDiscoveryQuery({store:{get:()=>({})}},'solute transport',{...SCOPE,domain:'土壤水文'},undefined,{discovery:{domainMatch:'strict',queryExpansion:'off'}});
 assert.equal(discoveryScopeVerdict(soil,custom),'match','an untranslated Chinese domain is no evidence against an English record');
 const legacy=await prepareDiscoveryQuery(E,'solute transport',SCOPE);assert.equal(discoveryScopeVerdict(soil,legacy),'domain','callers without a discovery mode keep the hard domain filter');
});

test('fuzzy matching covers macroporous and macroporosity in discovery and keeps solute and solution apart',async()=>{
 const scope={primaryKeyword:'macropore',fuzzy:true};
 assert.equal(wordStem('macroporous'),wordStem('macropore'));assert.equal(wordStem('macroporosity'),wordStem('macropore'));assert.notEqual(wordStem('solution'),wordStem('solute'));
 for(const title of ['Macroporous soil columns','Soil macroporosity and flow'])assert.ok(matchesResearchScope({title},scope,{stemmed:true}),title);
 assert.equal(matchesResearchScope({title:'Macroporous soil columns'},scope),false,'material filters keep the old prefix rule');
 assert.equal(matchesResearchScope({title:'Solution chemistry of soils'},{primaryKeyword:'solute',fuzzy:true},{stemmed:true}),false);
 assert.equal(canonicalResearchDomain('地学'),'earth-environment');assert.equal(canonicalResearchDomain('soil hydrology'),'soil hydrology');assert.equal(normalizeResearchScope({domain:'地球'}).domain,'地球','saved scopes keep the custom text');
});

test('the model step is reported before its request and the search step after it; a cached expansion reports nothing',async()=>{
 const phases=[],{E,calls}=engine(input=>{phases.push('request:'+calls.length);return{translations:Object.fromEntries(Object.keys(input.terms||input).filter(key=>/\p{Script=Han}/u.test((input.terms||input)[key])).map(key=>[key,'rare study object'])),synonyms:{primaryKeyword:['solute migration']}};});
 const run=(query,scope,expansion)=>prepareDiscoveryQuery(E,query,scope,undefined,{discovery:{domainMatch:'rank',queryExpansion:expansion,onPhase:phase=>phases.push(phase)}});
 await run(SCOPE.primaryKeyword,SCOPE,'auto');assert.deepEqual(phases,['expand','request:1','search']);
 phases.length=0;await run(SCOPE.primaryKeyword,SCOPE,'cache');assert.deepEqual(phases,[],'no model call, no phase report');
 phases.length=0;await run('不常见的研究对象',{primaryKeyword:'不常见的研究对象'},'off');assert.deepEqual(phases,['translate','request:2','search'],'a translation-only call is named as such');
});
