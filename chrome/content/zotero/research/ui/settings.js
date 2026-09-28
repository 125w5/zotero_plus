Object.assign(EasySchUI, {
	initSettings() {
		if (this.E.hasBundledProviders) {
			const area = this.$('provider-status');
			const row = document.createElement('p');
			row.className = 'muted';
			row.textContent = '已内置模型、翻译与期刊接口，可直接使用，也可在下方配置自己的 API。';
			const restore = document.createElement('button');
			restore.type = 'button'; restore.textContent = '恢复内置接口';
			restore.onclick = async () => {
				try { await this.E.applyBundledProviders({ reset: true }); this.loadSettings(); this.status('已恢复安装包内置接口'); }
				catch (_) { this.status('恢复失败，请重新安装完整安装包。', true); }
			};
			row.append(' ', restore); area.before(row);
		}
        this.bind('save-youdao', async () => {
            await this.E.configureProviders({ youdaoAppID: this.$('youdao-app-id').value.trim(), youdaoSecret: this.$('youdao-secret').value.trim() });
            this.$('youdao-secret').value = ''; this.loadProviderStatus(); this.status('有道配置已保存');
        });
        this.bind('test-providers', async () => {
            this.status('正在测试已配置服务（短句翻译与最小模型请求）…');
            let result = await this.E.testProviders();
            const labels = { ai: '学术 AI', image: '示意图', deepseek: 'DeepSeek', easyscholar: '期刊指标', youdao: '快速翻译' };
            this.$('provider-status').textContent = Object.entries(result).map(([k,v]) => (labels[k] || k) + '：' + v).join('；');
            this.status('连接测试已结束，请查看各服务结果');
        });
		this.bind('metrics-save-key', async () => { if (!this.$('metrics-key').value.trim()) throw new Error('请输入密钥'); await this.E.saveMetricsKey(this.$('metrics-key').value.trim()); this.$('metrics-key').value = ''; this.status('指标密钥已保存至密码管理器'); });
		this.bind('metrics-remove-key', async () => { await this.E.saveMetricsKey(''); this.$('metrics-key').value = ''; this.status('指标密钥已删除'); });
		this.bind('save-settings', async () => {
			let config = {};
			for (let name of ['endpoint', 'model', 'template', 'pandoc', 'csl', 'referenceDoc', 'latexTemplate', 'documentLanguage']) config[name] = this.$(name).value.trim();
			if (config.endpoint) config.endpoint = this.E.core.endpoint(config.endpoint);
			if (config.endpoint && new URL(config.endpoint).hostname === 'openai.goldgom.top') {
				if (config.model && !['gpt6luna', 'gpt-6-luna'].includes(config.model)) throw new Error('此接口只允许 GPT-6 Luna');
				config.model = 'gpt-6-luna';
			}
			if (this.$('api-key').value && !config.endpoint) throw new Error('保存密钥前请填写接口地址');
			const imageKey = this.$('image-key').value.trim();
			config.imageEndpoint = this.$('image-endpoint').value.trim();
			if (config.imageEndpoint) config.imageEndpoint = this.E.core.endpoint(config.imageEndpoint);
			if (imageKey && !config.imageEndpoint) throw new Error('保存生图密钥前请填写生图接口地址');
			if (imageKey && !/^sk-[A-Za-z0-9_-]{20,}$/.test(imageKey)) throw new Error('生图密钥格式无效');
			if (this.$('api-key').value) await this.E.credentials.set(config.endpoint, this.$('api-key').value);
			if (imageKey) await this.E.credentials.set(config.imageEndpoint + '/images', imageKey);
			await this.E.store.update(s => { s.settings = { ...s.settings, ...config }; });
			this.$('api-key').value = ''; this.$('image-key').value = ''; this.loadProviderStatus(); this.status('设置已保存；密钥按接口地址隔离存储');
		});
		this.bind('forget-key', async () => {
			let endpoint = this.E.core.endpoint(this.$('endpoint').value);
			await this.E.credentials.set(endpoint, ''); this.$('api-key').value = ''; this.status('此接口密钥已删除');
		});
		this.bind('forget-image-key', async () => {
			const value = this.$('image-endpoint').value.trim() || this.E.settings().imageEndpoint;
			if (!value) throw new Error('请先填写生图接口地址');
			const endpoint = this.E.core.endpoint(value);
			await this.E.credentials.set(endpoint + '/images', '');
			this.$('image-key').value = ''; this.loadProviderStatus(); this.status('生图接口密钥已删除');
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
			let item = await this.E.getItem(this.current.id);
			await this.E.saveMetrics([{ issn: this.E.issn(item), metric_year: year, source: source.href, impact_factor: value }]);
			this.renderPapers(); this.status('已保存至期刊指标数据库');
		});
	},
	loadSettings() {
		this.loadProviderStatus();
		let config = this.E.settings();
		this.$('youdao-app-id').value = config.youdaoAppID || '';
		this.$('image-endpoint').value = config.imageEndpoint || '';
		for (let name of ['endpoint', 'model', 'template', 'pandoc', 'csl', 'referenceDoc', 'latexTemplate', 'documentLanguage']) this.$(name).value = config[name];
		this.E.compatibility().then(text => { this.$('compatibility').textContent = text; }).catch(e => this.status(e.message, true));
	},
    async loadProviderStatus() {
        let flags = await this.E.providerStatus();
        const labels = { ai: '学术 AI', image: '示意图', deepseek: 'DeepSeek', easyscholar: '期刊指标', youdao: '快速翻译' };
        this.$('provider-status').textContent = Object.entries(flags).map(([k,v]) => (labels[k] || k) + '：' + (v ? '已保存凭据' : '未配置')).join('；');
    },
	loadMetric() {
		let item = this.current && this.E.getCachedItem(this.current.id);
		let metric = item ? this.E.metrics.get(this.E.issn(item))?.[0] : null;
		this.$('metric-value').value = metric?.impact_factor ?? '';
		this.$('metric-year').value = metric?.metric_year ?? '';
		this.$('metric-source').value = metric?.source ?? '';
	}
});
