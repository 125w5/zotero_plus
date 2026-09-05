/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	const origin = 'https://easyscholar.cc';
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
