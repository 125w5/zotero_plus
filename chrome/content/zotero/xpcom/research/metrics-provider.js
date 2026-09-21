/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	const origin = 'https://easyscholar.cc';
	const pendingMetrics = new Map();
	let currentMetrics;
 const context=item=>R.journalContext?.(item)||{journal:item?.isRegularItem()?item.getField('publicationTitle'):'',kind:'unknown'};
 const journalKey=item=>{let issn='';try{if(item?.isRegularItem())issn=R.issn(item);}catch(_){}return issn||'journal:'+context(item).journal.normalize('NFKC').toLowerCase().trim();};
 const load=()=>currentMetrics ||= new Map(Object.entries(R.store.get().journalMetricSnapshots||{}));
 R.currentMetric=item=>{if(!item)return;const key=journalKey(item),dated=R.metrics.get(key)?.find(m=>m.impact_factor!=null);if(dated?.metric_year>=new Date().getFullYear()-1)return dated;return load().get(key)?.metric||dated;};
 R.metricStatus=item=>{const info=context(item);if(!info.journal)return info.kind==='preprint'?'预印本 · 无期刊 IF':'IF 待补期刊';const entry=load().get(journalKey(item));if(entry?.error)return entry.error;return pendingMetrics.has(journalKey(item))?'IF 查询中…':'IF 准备查询';};
 R.ensurePaperMetrics=async function(item,{retry=false}={}){
  const info=context(item),journal=info.journal;if(!journal)return;
  const key=journalKey(item),current=R.currentMetric(item);if(current?.metric_year>=new Date().getFullYear()-1)return current;
  const old=load().get(key),age=Date.now()-Date.parse(old?.at||'');
  if(!retry&&old&&age<(old.error?30*60*1000:24*60*60*1000))return old.metric;
  if(pendingMetrics.has(key))return pendingMetrics.get(key);
  const task=(async()=>{let entry;try{
   if(!await R.credentials.get(origin))throw Error('IF 需配置 easyScholar');
   const rank=await R.readJournalRank(journal),value=Number(rank.sciif);
   if(rank.sciif==null||rank.sciif===''||!Number.isFinite(value)||value<0)throw Error('期刊暂无可用 IF');
   entry={at:new Date().toISOString(),metric:{issn:key.startsWith('journal:')?'':key,journal,impact_factor:value,metric_year:null,source:'easyScholar 当前返回（年份未标明）',fetched_at:new Date().toISOString()}};
  }catch(e){entry={at:new Date().toISOString(),error:e.message};}
  load().set(key,entry);await R.store.update(s=>{s.journalMetricSnapshots||={};s.journalMetricSnapshots[key]=entry;});R.refreshTrees();return entry.metric;})();
  pendingMetrics.set(key,task);try{return await task;}finally{pendingMetrics.delete(key);}
 };
	R.readJournalRank = async function(journal) {
		const secret=await R.credentials.get(origin);if(!secret)throw Error('请先在设置中保存 easyScholar 密钥');
		const win=Zotero.getMainWindow(),abort=new win.AbortController(),timer=win.setTimeout(()=>abort.abort(),20000);
		try{const url=new URL('https://www.easyscholar.cc/open/getPublicationRank');url.searchParams.set('secretKey',secret);url.searchParams.set('publicationName',journal);
			const response=await win.fetch(url.href,{signal:abort.signal,redirect:'error',cache:'no-store'});if(!response.ok)throw Error('provider response');
			const payload=await response.json(),rank=payload.data?.officialRank?.all;if(!rank||!Object.keys(rank).length)throw Error('missing rank');return rank;
		}catch(_){throw Error('影响因子查询失败或无匹配期刊；原有题录保留');}finally{win.clearTimeout(timer);}
	};
	R.lookupMetrics = async function (item, year) {
		let secret = await R.credentials.get(origin);
		if (!secret) throw new Error('请先在工作台设置中保存 easyScholar 密钥');
		let journal = item.getField('publicationTitle');
		if (!journal || !R.issn(item)) throw new Error('请先补全期刊名称及 ISSN');
		let check = R.validateMetric({ issn: R.issn(item), metric_year: year, source: 'easyScholar（年份由用户核对）' });
		let win = Zotero.getMainWindow(), abort = new win.AbortController();
		let timer = win.setTimeout(() => abort.abort(), 20000);
		try {
			// Official API requires a query credential. Use fetch without Zotero's URL logging.
			let url = new URL('https://www.easyscholar.cc/open/getPublicationRank');
			url.searchParams.set('secretKey', secret); url.searchParams.set('publicationName', journal);
			let response = await win.fetch(url.href, { signal: abort.signal, redirect: 'error', cache: 'no-store' });
			if (!response.ok) throw new Error('provider response');
			let payload = await response.json(), rank = payload.data?.officialRank?.all;
			if (!rank || !Object.keys(rank).length) throw new Error('missing rank');
			return R.validateMetric({ ...check, impact_factor: rank.sciif, impact_factor_5y: rank.sciif5,
				jcr_quartile: rank.sci || rank.ssci, cas_large_category: rank.sciUp,
				cas_small_category: rank.sciUpSmall, cas_top: rank.sciUpTop,
				warning_status: rank.sciwarn, ccf: rank.ccf,
				indexing: ['sci', 'ssci', 'ei', 'cscd', 'cssci', 'pku'].filter(k => rank[k]).map(k => `${k.toUpperCase()}: ${rank[k]}`).join('；') });
		}
		catch (_) { throw new Error('easyScholar 查询失败、无匹配期刊或返回值无法解析，请检查密钥、网络和期刊名称'); }
		finally { win.clearTimeout(timer); }
	};
	R.saveMetricsKey = key => R.credentials.set(origin, key);
})(Zotero.Research);
