/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	R.metrics = new Map();
	R.states = new Map();
	R.key = item => `${item.libraryID}/${item.key}`;
	R.issn = item => (item.getField('ISSN') || '').match(/\d{4}-?\d{3}[\dX]/i)?.[0].replace('-', '').toUpperCase() || '';
	R.initDatabase = async function () {
		R.db = new Zotero.DBConnection('research');
		await R.db.executeTransaction(async () => {
			await R.db.queryAsync('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
			let version = await R.db.valueQueryAsync('SELECT version FROM schema_version');
			if (version > 1) throw new Error('科研数据库版本过新，请使用新版 EasySch');
			if (!version) {
				await R.db.queryAsync(`CREATE TABLE journal_metrics (
					issn TEXT NOT NULL, metric_year INTEGER NOT NULL, source TEXT NOT NULL,
					impact_factor REAL, impact_factor_5y REAL, jcr_quartile TEXT,
					cas_large_category TEXT, cas_small_category TEXT, cas_top TEXT,
					warning_status TEXT, indexing TEXT, ccf TEXT, school_rank TEXT,
					fetched_at TEXT NOT NULL, PRIMARY KEY (issn, metric_year, source))`);
				await R.db.queryAsync('CREATE TABLE research_items (item_key TEXT PRIMARY KEY, state TEXT NOT NULL)');
				await R.db.queryAsync('INSERT INTO schema_version VALUES (1)');
			}
		});
		for (let row of await R.db.queryAsync('SELECT * FROM journal_metrics ORDER BY metric_year DESC, fetched_at DESC')) {
			let list = R.metrics.get(row.issn) || [];
			list.push(row); R.metrics.set(row.issn, list);
		}
		for (let row of await R.db.queryAsync('SELECT * FROM research_items')) {
			R.states.set(row.item_key, JSON.parse(row.state));
		}
		Zotero.addShutdownListener(() => R.db.closeDatabase());
	};
	R.metricFields = ['impact_factor', 'impact_factor_5y', 'jcr_quartile', 'cas_large_category',
		'cas_small_category', 'cas_top', 'warning_status', 'indexing', 'ccf', 'school_rank'];
	R.validateMetric = function (input) {
		let m = { ...input, issn: String(input.issn || '').replace('-', '').toUpperCase(),
			metric_year: Number(input.metric_year), source: String(input.source || '').trim(),
			fetched_at: input.fetched_at || new Date().toISOString() };
		if (!/^\d{7}[\dX]$/.test(m.issn)) throw new Error('指标需要有效 ISSN');
		let sum = [...m.issn].reduce((n, c, i) => n + (c === 'X' ? 10 : Number(c)) * (8 - i), 0);
		if (sum % 11) throw new Error('ISSN 校验位不正确');
		if (!Number.isInteger(m.metric_year) || m.metric_year < 1900 || m.metric_year > new Date().getFullYear()) {
			throw new Error('指标年份无效');
		}
		if (!m.source || m.source.length > 200 || !Number.isFinite(Date.parse(m.fetched_at))) throw new Error('指标必须有来源及有效获取时间');
		for (let key of R.metricFields) {
			if (key.startsWith('impact_factor')) {
				let value = m[key];
				m[key] = value === '' || value == null ? null : Number(value);
				if (m[key] !== null && (!Number.isFinite(m[key]) || m[key] < 0)) throw new Error('影响因子必须是非负数或留空');
			}
			else m[key] = m[key] == null ? null : String(m[key]).slice(0, 500);
		}
		return m;
	};
	R.saveMetrics = async function (inputs) {
		let records = inputs.map(R.validateMetric);
		let fields = ['issn', 'metric_year', 'source', ...R.metricFields, 'fetched_at'];
		await R.db.executeTransaction(async () => {
			for (let m of records) await R.db.queryAsync(
				`REPLACE INTO journal_metrics (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
				fields.map(k => m[k]));
		});
		for (let m of records) {
			let list = (R.metrics.get(m.issn) || []).filter(x => x.metric_year !== m.metric_year || x.source !== m.source);
			list.push(m); list.sort((a, b) => b.metric_year - a.metric_year || b.fetched_at.localeCompare(a.fetched_at));
			R.metrics.set(m.issn, list);
		}
		R.refreshTrees();
	};
	R.saveState = async function (item, changes) {
		if (!item.library.editable) throw new Error('当前文库只读');
		let key = R.key(item), state = { ...R.states.get(key), ...changes };
		await R.db.queryAsync('REPLACE INTO research_items (item_key, state) VALUES (?, ?)', [key, JSON.stringify(state)]);
		R.states.set(key, state); R.refreshTrees();
	};
	R.field = function (item, field) {
		if (!item?.isRegularItem?.()) return '';
		let key = field.slice('research_'.length);
		if (key === 'tags') return item.getTags().map(t => t.tag).join(' · ');
		if (key === 'journalTags') {
			let m = R.metrics.get(R.issn(item))?.[0];
			return m ? [m.impact_factor, m.jcr_quartile, m.cas_large_category, m.indexing, m.ccf].filter(v => v != null).join(' · ') : '';
		}
		if (key === 'firstAuthor') {
			let author = item.getCreators().find(c => c.creatorTypeID === Zotero.CreatorTypes.getID('author'));
			return author ? [author.firstName, author.lastName].filter(Boolean).join(' ') : '';
		}
		let list = R.metrics.get(R.issn(item)) || [], metric = list[0];
		if (key === 'publicationIF') {
			let year = Number((item.getField('date', true) || '').slice(0, 4));
			return list.find(m => m.metric_year === year)?.impact_factor ?? '';
		}
		if (key === 'metricInfo') return metric ? `${metric.metric_year} · ${metric.source}` : '';
		if (R.metricFields.includes(key)) return metric?.[key] ?? '';
		return R.states.get(R.key(item))?.[key] ?? (key === 'reading' ? '未读' : '');
	};
	R.refreshTrees = function () {
		for (let win of Zotero.getMainWindows()) {
			let tree = win.ZoteroPane?.itemsView;
			if (tree) { tree._rowCache = {}; tree.tree?.invalidate(); }
			for (let box of win.document.querySelectorAll('[data-research-item]')) box._updateResearch?.();
		}
	};
})(Zotero.Research);
