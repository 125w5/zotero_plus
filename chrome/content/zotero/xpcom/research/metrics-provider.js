/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	const origin = 'https://easyscholar.cc';
	const pendingMetrics = new Map();
	let currentMetrics;
 const context=item=>R.journalContext?.(item)||{journal:item?.isRegularItem()?item.getField('publicationTitle'):'',kind:'unknown'};
 const journalKey=item=>{let issn='';try{if(item?.isRegularItem())issn=R.issn(item);}catch(_){}return issn||'journal:'+context(item).journal.normalize('NFKC').toLowerCase().trim();};
 const load=()=>currentMetrics ||= new Map(Object.entries(R.store.get('journalMetricSnapshots')||{}));
	// Metrics arrive one journal at a time while result cards scroll into view.
	// Batch the workspace commits and the item-tree refresh; readers use the
	// in-memory map, and shutdown writes whatever is still pending.
	let dirtyMetrics=new Set(),writingMetrics=new Map();
	let metricWriteTimer=null,metricWriteStart=0,treeRefreshTimer=null;
	let timers=()=>typeof R.setTimeout==='function'&&typeof R.clearTimeout==='function'?R:null;
	R.flushJournalMetrics=function(){
		if(metricWriteTimer!==null)timers()?.clearTimeout(metricWriteTimer);
		metricWriteTimer=null;metricWriteStart=0;
		if(!dirtyMetrics.size)return Promise.resolve();
		let batch=new Map([...dirtyMetrics].map(key=>[key,load().get(key)]));dirtyMetrics.clear();
		for(let [key,entry] of batch)writingMetrics.set(key,entry);
		return Promise.resolve(R.store.update(s=>{s.journalMetricSnapshots||={};for(let [key,entry] of batch)s.journalMetricSnapshots[key]=entry;}))
			.catch(error=>{for(let key of batch.keys())dirtyMetrics.add(key);throw error;})
			.finally(()=>{for(let [key,entry] of batch)if(writingMetrics.get(key)===entry)writingMetrics.delete(key);});
	};
	R.pendingJournalMetrics=()=>{let rows={};for(let [key,entry] of writingMetrics)rows[key]=entry;for(let key of dirtyMetrics)rows[key]=load().get(key);return rows;};
	let rememberMetric=(key,entry)=>{
		load().set(key,entry);dirtyMetrics.add(key);
		let clock=timers();
		if(!clock)return R.flushJournalMetrics().then(()=>R.refreshTrees());
		if(treeRefreshTimer===null)treeRefreshTimer=clock.setTimeout(()=>{treeRefreshTimer=null;R.refreshTrees();},150);
		if(!metricWriteStart)metricWriteStart=Date.now();
		if(metricWriteTimer!==null)clock.clearTimeout(metricWriteTimer);
		metricWriteTimer=clock.setTimeout(()=>{metricWriteTimer=null;R.flushJournalMetrics().catch(error=>Zotero.logError(error));},Math.max(0,Math.min(350,2000-(Date.now()-metricWriteStart))));
		return Promise.resolve();
	};
	Zotero.addShutdownListener?.(()=>R.flushJournalMetrics().catch(error=>Zotero.logError(error)));
 R.currentMetric=item=>{if(!item)return;const key=journalKey(item),dated=R.metrics.get(key)?.find(m=>m.impact_factor!=null);if(dated?.metric_year>=new Date().getFullYear()-1)return dated;return load().get(key)?.metric||dated;};
 R.metricStatus=item=>{const info=context(item);if(!info.journal)return info.kind==='preprint'?'预印本 · 无期刊 IF':'IF 待补期刊';const entry=load().get(journalKey(item));if(entry?.error)return entry.error;if(entry?.metric&&entry.metric.impact_factor==null)return'期刊暂无可用 IF';return pendingMetrics.has(journalKey(item))?'IF 查询中…':'IF 准备查询';};
 // easyScholar names a CAS TOP journal's category in sciUpTop, e.g. 化学TOP.
 // A CAS rank without it is not TOP; no CAS rank says nothing about TOP.
 const casTopStatus=rank=>{const top=String(rank.sciUpTop??'').trim();if(top)return /^(?:否|非|no\b|false$|0$|not[\s-]*top)/i.test(top)?'not-top':'reported';return String(rank.sciUp??'').trim()?'not-top':'unknown';};
 // A lookup that gives no record keeps the journal's previous metric. A failed
 // request is asked again after 5 min, a missing key after 30 min or once a
 // key exists, and a journal easyScholar has no record for after a day. Older
 // error entries carry no kind and keep the 30 min wait.
 let RETRY_AFTER={failed:5*60*1000,'no-key':30*60*1000,miss:24*60*60*1000};
 R.ensurePaperMetrics=async function(item,{retry=false,needTop=false}={}){
  const info=context(item),journal=info.journal;if(!journal)return;
  const key=journalKey(item),current=R.currentMetric(item);if(current?.metric_year>=new Date().getFullYear()-1&&(!needTop||String(current.cas_top??'').trim()))return current;
  let old=load().get(key),now=Date.now();
  if(!retry&&old?.error){let noKey=old.kind==='no-key'||!old.kind&&old.error==='IF 需配置 easyScholar';if(now-Date.parse(old.at||'')<(RETRY_AFTER[old.kind]||30*60*1000)&&!(noKey&&await R.journalMetricsAvailable()))return old.metric;}
  // Entries saved before TOP was parsed carry no top_status; a TOP filter
  // asks once more for them.
  let stale=needTop&&!!old?.metric&&!old.metric.top_status;
  if(!retry&&!stale&&old?.metric&&now-Date.parse(old.metricAt||old.at||'')<24*60*60*1000)return old.metric;
  if(pendingMetrics.has(key))return pendingMetrics.get(key);
  const task=(async()=>{let entry,at=new Date().toISOString(),kept=old?.metric?{metric:old.metric,metricAt:old.metricAt||old.at}:{};try{
   if(!await R.credentials.get(origin))entry={at,error:'IF 需配置 easyScholar',kind:'no-key',...kept};
   else{
    const rank=await R.readJournalRank(journal),value=Number(rank?.sciif),impact=rank&&rank.sciif!=null&&rank.sciif!==''&&Number.isFinite(value)&&value>=0?value:null,top=rank?casTopStatus(rank):'unknown';
    // A CAS TOP journal without an SCI IF keeps its TOP record.
    if(impact==null&&top==='unknown')entry={at,error:'期刊暂无可用 IF',kind:'miss',...kept};
    else entry={at,metric:{issn:key.startsWith('journal:')?'':key,journal,impact_factor:impact,jcr_quartile:rank.sci||rank.ssci||null,cas_large_category:rank.sciUp||null,cas_top:rank.sciUpTop||null,top_status:top,metric_year:null,source:'easyScholar 当前返回（年份未标明）',fetched_at:at}};
   }
  }catch{entry={at,error:'影响因子查询未成功；原有题录保留',kind:'failed',...kept};}
  await rememberMetric(key,entry);return entry.metric;})();
  pendingMetrics.set(key,task);try{return await task;}finally{pendingMetrics.delete(key);}
 };
 // Discovery asks once per batch whether lookups are possible at all; the
 // answer is kept briefly instead of reading the password store each time.
 let keyCheck=null;
 R.journalMetricsAvailable=async()=>{if(keyCheck&&Date.now()-keyCheck.at<10000)return keyCheck.value;let value=false;try{value=!!await R.credentials.get(origin);}catch(_){}keyCheck={at:Date.now(),value};return value;};
	// null: easyScholar answered and has no rank for the journal. A failed
	// request throws: HTTP or network error, unreadable reply, or a reply whose
	// code is not 200 (easyScholar refused the request, e.g. the key).
	R.readJournalRank = async function(journal) {
		const secret=await R.credentials.get(origin);if(!secret)throw Error('请先在设置中保存 easyScholar 密钥');
		const win=Zotero.getMainWindow(),abort=new win.AbortController(),timer=win.setTimeout(()=>abort.abort(),20000);
		try{const url=new URL('https://www.easyscholar.cc/open/getPublicationRank');url.searchParams.set('secretKey',secret);url.searchParams.set('publicationName',journal);
			const response=await win.fetch(url.href,{signal:abort.signal,redirect:'error',cache:'no-store'});if(!response.ok)throw Error('provider response');
			const payload=await response.json();if(payload?.code!=null&&Number(payload.code)!==200)throw Error('provider code');
			const rank=payload?.data?.officialRank?.all;return rank&&Object.keys(rank).length?rank:null;
		}catch{throw Error('影响因子查询未成功；原有题录保留');}finally{win.clearTimeout(timer);}
	};
	R.lookupMetrics = async function (item, year, { signal } = {}) {
		let secret = await R.credentials.get(origin);
		if (!secret) throw new Error('请先在工作台设置中保存 easyScholar 密钥');
		let journal = item.getField('publicationTitle');
		if (!journal || !R.issn(item)) throw new Error('请先补全期刊名称及 ISSN');
		let check = R.validateMetric({ issn: R.issn(item), metric_year: year, source: 'easyScholar（年份由用户核对）' });
		let cancelled = () => Object.assign(new Error('期刊查询已取消'), { name: 'AbortError' });
		if (signal?.aborted) throw cancelled();
		let win = Zotero.getMainWindow(), abort = new win.AbortController(), stop = () => abort.abort();
		let timer = win.setTimeout(stop, 20000);
		signal?.addEventListener('abort', stop, { once: true });
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
		catch {
			if (signal?.aborted) throw cancelled();
			throw new Error('easyScholar 查询失败、无匹配期刊或返回值无法解析，请检查密钥、网络和期刊名称');
		}
		finally {
			win.clearTimeout(timer);
			signal?.removeEventListener('abort', stop);
		}
	};
	// Lookup errors recorded under the old key are dropped, so the next search
	// asks again; a journal's metric that a failed refresh kept stays. Discovery
	// compares the generation to forget the journals it skipped.
	R.journalMetricKeyGeneration = 0;
	R.saveMetricsKey = async key => {
		let result = await R.credentials.set(origin, key);
		keyCheck = null; R.journalMetricKeyGeneration++;
		let cleared = new Map();
		for (let [name, entry] of load()) if (entry?.error) cleared.set(name, entry.metric ? {at: entry.metricAt || entry.at, metric: entry.metric} : null);
		if (cleared.size) {
			for (let [name, entry] of cleared) {
				if (entry) load().set(name, entry); else load().delete(name);
				dirtyMetrics.delete(name); writingMetrics.delete(name);
			}
			await R.store.update(s => {s.journalMetricSnapshots ||= {}; for (let [name, entry] of cleared) {if (entry) s.journalMetricSnapshots[name] = entry; else delete s.journalMetricSnapshots[name];}});
			R.refreshTrees();
		}
		return result;
	};
})(Zotero.Research);
