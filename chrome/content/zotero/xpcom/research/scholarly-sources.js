/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The scholarly APIs used to search for and download papers. E.requestProvider asks this
// module to add each service's key, the contact email of the polite pools and a
// User-Agent, and to space requests to the same service, so no caller handles keys.
// Keys live in the login manager (E.credentials); the contact email in settings.
(function (E) {
	const SOURCES = [
		{ id: 'openalex', label: 'OpenAlex', host: 'api.openalex.org', key: 'param', param: 'api_key', mailto: 'mailto', spacing: 120,
			test: 'https://api.openalex.org/works?search=modulation%20recognition&per-page=1&select=id' },
		{ id: 'semantic', label: 'Semantic Scholar', host: 'api.semanticscholar.org', key: 'header', header: 'x-api-key', spacing: 1100, keyless: 3100,
			test: 'https://api.semanticscholar.org/graph/v1/paper/search?query=modulation%20recognition&limit=1&fields=title' },
		{ id: 'core', label: 'CORE', host: 'api.core.ac.uk', key: 'bearer', spacing: 700, keyless: 2100,
			test: 'https://api.core.ac.uk/v3/search/works/?q=modulation%20recognition&limit=1' },
		{ id: 'springer-meta', label: 'Springer Nature Meta', host: 'api.springernature.com', path: /^\/meta\//, key: 'param', param: 'api_key', spacing: 600,
			test: 'https://api.springernature.com/meta/v2/json?q=modulation%20recognition&p=1' },
		{ id: 'springer-oa', label: 'Springer Nature Open Access', host: 'api.springernature.com', path: /^\/openaccess\//, key: 'param', param: 'api_key', spacing: 600,
			test: 'https://api.springernature.com/openaccess/json?q=modulation%20recognition&p=1' },
		{ id: 'crossref', label: 'Crossref', host: 'api.crossref.org', mailto: 'mailto', spacing: 350 },
		{ id: 'unpaywall', label: 'Unpaywall', host: 'api.unpaywall.org', mailto: 'email', spacing: 150 },
		{ id: 'europepmc', label: 'Europe PMC', host: 'www.ebi.ac.uk', path: /^\/europepmc\//, spacing: 150 },
		// OpenAlex's paid full-text files (pdf-resolver.js openAlexContentPDF) use the OpenAlex key;
		// not listed as a source of its own.
		{ id: 'openalex-content', keyID: 'openalex', hidden: true, label: 'OpenAlex 全文', host: 'content.openalex.org', key: 'param', param: 'api_key', spacing: 200 }
	];
	const realm = id => 'easysch-scholarly:' + id;
	const keys = new Map(), tails = new Map(), listed = SOURCES.filter(source => !source.hidden), keyOf = source => source.keyID || source.id;
	let loading = null;
	const load = () => loading ||= Promise.all(listed.filter(source => source.key).map(async source => keys.set(source.id, await E.credentials.get(realm(source.id)) || '')));
	const contact = () => String(E.store?.peek?.('settings', 'scholarlyContact') || '').trim();
	const match = url => {
		let parsed; try { parsed = new URL(url); } catch (_) { return null; }
		let source = SOURCES.find(row => row.host === parsed.hostname && (!row.path || row.path.test(parsed.pathname)));
		return source ? { source, parsed } : null;
	};
	E.scholarly = {
		sources: listed.map(({ id, label, key }) => ({ id, label, needsKey: !!key })),
		contact,
		// Synchronous, so requests to other services start without waiting a turn.
		matches: url => !!match(url),
		async has(id) { await load(); return !!keys.get(id); },
		async state() { await load(); return listed.filter(source => source.key).map(source => ({ id: source.id, label: source.label, saved: !!keys.get(source.id) })); },
		async save(id, key) {
			let source = listed.find(row => row.id === id && row.key);
			if (!source) throw new Error('未知的文献数据源');
			await E.credentials.set(realm(id), String(key || '').trim());
			loading = null; keys.clear();
		},
		// The request options to use for a URL, or null when the URL is not a scholarly API.
		async prepare(url, options = {}) {
			let found = match(url);
			if (!found) return null;
			let { source, parsed } = found, headers = { ...(options.headers || {}) }, key = '';
			// CORE answers /v3/search/works with a 301 to the same path plus "/"; the key header must not follow it.
			if (source.id === 'core' && /^\/v3\/search\/[a-z]+$/.test(parsed.pathname)) parsed.pathname += '/';
			if (source.key) { await load(); key = keys.get(keyOf(source)) || ''; }
			if (key && source.key === 'param' && !parsed.searchParams.has(source.param)) parsed.searchParams.set(source.param, key);
			if (key && source.key === 'header') headers[source.header] = key;
			if (key && source.key === 'bearer') headers.Authorization = 'Bearer ' + key;
			let email = contact();
			if (email && source.mailto && !parsed.searchParams.has(source.mailto)) parsed.searchParams.set(source.mailto, email);
			headers['User-Agent'] ||= 'EasySch/1.0 (https://github.com/125w5/zotero_plus' + (email ? '; mailto:' + email : '') + ')';
			// A key sent in a header must not follow a redirect to another site.
			return { id: source.id, keyed: !!key, url: parsed.href, options: { ...options, headers }, redirect: source.key === 'header' || source.key === 'bearer' ? 'error' : 'follow',
				wait: () => E.scholarly.wait(source.id, key ? source.spacing : (source.keyless || source.spacing)) };
		},
		// Requests to one service leave at least `spacing` ms between them.
		wait(id, spacing) {
			let previous = tails.get(id) || Promise.resolve(0);
			let next = previous.then(async last => {
				let delay = last + spacing - Date.now();
				if (delay > 0) await new Promise(resolve => (E.setTimeout || ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs').setTimeout)(resolve, delay));
				return Date.now();
			});
			tails.set(id, next.catch(() => Date.now()));
			return next;
		},
		// One small request per configured service; the result names the service and the outcome only.
		async test(signal) {
			await load();
			let rows = [];
			for (let source of listed.filter(row => row.test)) {
				let saved = !!keys.get(source.id);
				if (source.key && !saved) { rows.push({ id: source.id, label: source.label, saved, ok: null, message: '未填写密钥' }); continue; }
				try { await E.requestProvider(source.test, { signal }, 15000); rows.push({ id: source.id, label: source.label, saved, ok: true, message: '可用' }); }
				catch (error) { rows.push({ id: source.id, label: source.label, saved, ok: false, message: error.providerStatus ? 'HTTP ' + error.providerStatus : (error.message || '无法连接') }); }
			}
			return rows;
		}
	};
})(EasySch);
