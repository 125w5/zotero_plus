Object.assign(EasySchUI, {
	initSettings() {
		this.bind('save-settings', async () => {
			let config = {};
			for (let name of ['endpoint', 'model', 'template', 'pandoc', 'csl', 'referenceDoc', 'latexTemplate', 'documentLanguage']) config[name] = this.$(name).value.trim();
			if (config.endpoint) config.endpoint = this.E.core.endpoint(config.endpoint);
			if (this.$('api-key').value && !config.endpoint) throw new Error('保存密钥前请填写接口地址');
			if (this.$('api-key').value) await this.E.credentials.set(config.endpoint, this.$('api-key').value);
			await this.E.store.update(s => { s.settings = { ...s.settings, ...config }; });
			this.$('api-key').value = ''; this.status('设置已保存；密钥按接口地址隔离存储');
		});
		this.bind('forget-key', async () => {
			let endpoint = this.E.core.endpoint(this.$('endpoint').value);
			await this.E.credentials.set(endpoint, ''); this.$('api-key').value = ''; this.status('此接口密钥已删除');
		});
		for (let button of document.querySelectorAll('[data-pick]')) button.addEventListener('click', async () => {
			try {
				let name = button.dataset.pick;
				let extension = { csl: 'csl', referenceDoc: 'docx', latexTemplate: 'tex' }[name];
				let path = await this.E.pick(window, '选择 ' + name, 'file', extension);
				if (path) this.$(name).value = path;
			}
			catch (e) { this.status(e.message, true); }
		});
		this.bind('save-metric', async () => {
			if (!this.current) throw new Error('请先选择论文');
			let value = Number(this.$('metric-value').value), year = Number(this.$('metric-year').value);
			let source;
			try { source = new URL(this.$('metric-source').value); } catch (_) { throw new Error('请输入有效来源网址'); }
			if (!this.$('metric-value').value || !Number.isFinite(value) || value < 0
				|| !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()
				|| !['https:', 'http:'].includes(source.protocol)) throw new Error('请完整填写数值、已发生的年份与来源网址');
			let key = this.E.core.paperKey(this.current);
			await this.E.store.update(s => {
				let paper = s.papers[key] ||= { records: [] }; paper.metric = { value, year, source: source.href, checkedAt: new Date().toISOString() };
			}); this.renderPapers(); this.status('期刊指标已保存为人工记录');
		});
	},
	loadSettings() {
		let config = this.E.settings();
		for (let name of ['endpoint', 'model', 'template', 'pandoc', 'csl', 'referenceDoc', 'latexTemplate', 'documentLanguage']) this.$(name).value = config[name];
		this.E.compatibility().then(text => { this.$('compatibility').textContent = text; }).catch(e => this.status(e.message, true));
	},
	loadMetric() {
		let metric = this.current ? this.E.store.get().papers[this.E.core.paperKey(this.current)]?.metric : null;
		for (let field of ['value', 'year', 'source']) this.$('metric-' + field).value = metric?.[field] ?? '';
	}
});
