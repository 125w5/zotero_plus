Object.assign(EasySchUI, {
	initSettings() {
		this.settingsAction('save-azure', async()=>{
			await this.E.configureProviders({azure:{region:this.$('azure-region').value.trim(),key:this.$('azure-key').value.trim()}});
			this.$('azure-key').value='';this.loadProviderStatus();this.status('Azure 选区机翻已保存');
		});
		this.settingsAction('save-translation',async()=>{
			let config={endpoint:this.$('translation-endpoint').value.trim(),model:this.$('translation-model').value.trim(),key:this.$('translation-key').value.trim()};
			// One key per address: on the chat model's address a typed key replaces its key too.
			let address=config.endpoint||'https://api.deepseek.com',shared=this.sameEndpoint(address,this.E.settings().endpoint);
			if(shared)address=this.E.core.endpoint(address);
			if(shared&&config.key&&!window.confirm('对话模型也使用 '+address+' 的密钥。保存后，对话模型与学术翻译都改用新密钥，是否继续？')){this.status('未保存学术翻译；对话模型与学术翻译的密钥都没有改变');return;}
			await this.E.configureProviders({translation:config});
			this.$('translation-key').value='';this.loadProviderStatus();this.status(shared?'学术翻译已保存；与对话模型共用 '+address+' 的密钥':'学术翻译已保存，对话模型保持原设置');
		});
		if (this.E.hasBundledProviders) {
			const area = this.$('provider-status');
			const row = document.createElement('p');
			row.className = 'muted';
			row.textContent = '已内置模型、翻译与期刊接口，可直接使用，也可在下方配置自己的 API。';
			const restore = document.createElement('button');
			restore.type = 'button'; restore.textContent = '恢复内置接口';
			this.settingsAction(restore, async () => {
				try {
					await this.E.applyBundledProviders({ reset: true });
				}
				catch {
					throw new Error('恢复失败，请重新安装完整安装包。');
				}
				this.loadSettings(); this.status('已恢复安装包内置接口');
			});
			row.append(' ', restore); area.before(row);
		}
        this.settingsAction('save-youdao', async () => {
            await this.E.configureProviders({ youdaoAppID: this.$('youdao-app-id').value.trim(), youdaoSecret: this.$('youdao-secret').value.trim() });
            this.$('youdao-secret').value = ''; this.loadProviderStatus(); this.status('有道配置已保存');
        });
		this.settingsAction('test-providers', async () => {
			// 停止测试 aborts the running probe and ends the wait at once, even for
			// a service that does not stop when asked.
			let controller = new AbortController(), stop = this.$('stop-provider-test');
			let stopped = new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
			if (stop) {
				stop.hidden = false;
				stop.onclick = () => controller.abort();
			}
			this.status('正在测试已配置服务（短句翻译与最小模型请求）…');
			try {
				let result = await Promise.race([this.E.testProviders({ signal: controller.signal }), stopped]);
				if (controller.signal.aborted) {
					this.status('已停止连接测试，各服务结果未更新');
					return;
				}
				let labels = { ai: '学术 AI', research: '研究任务', image: '示意图', deepseek: 'DeepSeek', easyscholar: '期刊指标', youdao: '有道机翻', azure: 'Azure 机翻' };
				this.$('provider-status').textContent = Object.entries(result).map(([k, v]) => (labels[k] || k) + '：' + v).join('；');
				this.renderResearchRoutingAction();
				this.status('连接测试已结束，请查看各服务结果');
			}
			finally {
				if (stop) {
					stop.hidden = true;
					stop.onclick = null;
				}
			}
		});
		this.settingsAction('metrics-save-key', async () => { if (!this.$('metrics-key').value.trim()) throw new Error('请输入密钥'); await this.E.saveMetricsKey(this.$('metrics-key').value.trim()); this.$('metrics-key').value = ''; this.status('指标密钥已保存至密码管理器'); });
		this.settingsAction('metrics-remove-key', async () => { await this.E.saveMetricsKey(''); this.$('metrics-key').value = ''; this.status('指标密钥已删除'); });
		// Each group validates and saves on its own, so an invalid model entry
		// does not block saving template paths, and the reverse.
		this.settingsAction('save-settings', async () => {
			let merge = config => this.E.store.update((s) => {
				s.settings = { ...s.settings, ...config };
			});
			let saveFormat = async () => {
				let config = {};
				for (let name of ['template', 'pandoc', 'csl', 'referenceDoc', 'latexTemplate', 'documentLanguage']) config[name] = this.$(name).value.trim();
				await merge(config);
			};
			let saveModel = async () => {
				let config = { endpoint: this.$('endpoint').value.trim(), model: this.$('model').value.trim() }, key = this.$('api-key').value;
				if (config.endpoint) config.endpoint = this.E.core.endpoint(config.endpoint);
				config.model = config.model.replace(/^gpt6luna$/i, 'gpt-6-luna').replace(/^gpt6[.-]?1sol$/i, 'gpt-6.1-sol');
				if (config.model && (config.model.length > 160 || /[\s\x00-\x1f]/.test(config.model))) throw new Error('请输入有效的模型名称');
				if (key && !config.endpoint) throw new Error('保存密钥前请填写接口地址');
				// A new key on academic translation's address replaces the key it uses.
				let moving = key && this.sameEndpoint(config.endpoint, this.E.settings().translationEndpoint || 'https://api.deepseek.com') && !this.sameEndpoint(config.endpoint, this.E.settings().endpoint);
				if (moving && await this.E.credentials.get(config.endpoint) && !window.confirm('学术翻译正在使用 ' + config.endpoint + ' 的密钥。保存后，学术翻译也改用这个新密钥，是否继续？')) throw new Error('对话模型未保存，学术翻译的密钥没有改变');
				if (key) await this.E.credentials.set(config.endpoint, key);
				await merge(config);
				this.$('api-key').value = '';
			};
			let saveImage = async () => {
				let config = { imageEndpoint: this.$('image-endpoint').value.trim(), imageModel: this.$('image-model').value.trim() }, imageKey = this.$('image-key').value.trim();
				if (config.imageEndpoint) config.imageEndpoint = this.E.core.endpoint(config.imageEndpoint);
				if (imageKey && !config.imageEndpoint) throw new Error('保存生图密钥前请填写生图接口地址');
				if (imageKey && !/^sk-[A-Za-z0-9_-]{20,}$/.test(imageKey)) throw new Error('生图密钥格式无效');
				if (imageKey) await this.E.credentials.set(config.imageEndpoint + '/images', imageKey);
				await merge(config);
				this.$('image-key').value = '';
			};
			let errors = [];
			for (let group of [saveFormat, saveModel, saveImage]) {
				try {
					await group();
				}
				catch (error) {
					errors.push(error.message);
				}
			}
			this.loadProviderStatus();
			let settings = this.E.settings(), shared = this.sameEndpoint(settings.endpoint, settings.translationEndpoint || 'https://api.deepseek.com');
			if (errors.length) this.status('其余设置已保存；' + errors.join('；'), true);
			else this.status(shared ? '设置已保存；对话模型与学术翻译共用 ' + settings.endpoint + ' 的密钥' : '设置已保存；密钥按接口地址隔离存储');
		});
		this.settingsAction('forget-key', async () => {
			let typed = this.$('endpoint').value.trim(), saved = this.E.settings().endpoint || '', value = typed || saved;
			if (!value) throw new Error('请先填写接口地址');
			let endpoint = this.E.core.endpoint(value), translation = this.E.settings().translationEndpoint || 'https://api.deepseek.com';
			let shared = this.sameEndpoint(endpoint, translation);
			if (shared && !this.sameEndpoint(endpoint, saved)) throw new Error('学术翻译正在使用 ' + endpoint + '，当前对话模型没有使用这个地址；未删除任何密钥');
			if (!window.confirm(shared ? '对话模型与学术翻译共用 ' + endpoint + ' 的密钥。删除后两者都需要重新保存密钥；生图与期刊指标的密钥不受影响。是否删除？' : '删除对话模型在 ' + endpoint + ' 的密钥？学术翻译、生图与期刊指标的密钥不受影响。')) return;
			await this.E.credentials.set(endpoint, ''); this.$('api-key').value = ''; this.loadProviderStatus(); this.status(shared ? '已删除 ' + endpoint + ' 的密钥；对话模型与学术翻译都需要重新保存' : '已删除对话模型在 ' + endpoint + ' 的密钥');
		});
		this.settingsAction('forget-image-key', async () => {
			const value = this.$('image-endpoint').value.trim() || this.E.settings().imageEndpoint;
			if (!value) throw new Error('请先填写生图接口地址');
			const endpoint = this.E.core.endpoint(value);
			await this.E.credentials.set(endpoint + '/images', '');
			this.$('image-key').value = ''; this.loadProviderStatus(); this.status('生图接口密钥已删除');
		});
		for (let button of document.querySelectorAll('[data-pick]')) this.settingsAction(button, async () => {
			let name = button.dataset.pick;
			let label = document.querySelector('label[for="' + name + '"]')?.textContent.trim() || name;
			let windows = window.parent?.Zotero?.isWin ?? /^Win/i.test(navigator.platform || '');
			// Pandoc has no file extension outside Windows.
			let extension = { pandoc: windows ? 'exe' : undefined, csl: 'csl', referenceDoc: 'docx', latexTemplate: 'tex' }[name];
			let path = await this.E.pick(window, '选择' + (/^[A-Za-z]/.test(label) ? ' ' : '') + label, 'file', extension);
			if (path) this.$(name).value = path;
		});
		// 已核验顶刊 reads cas_top from a saved record with a source, so the
		// journal form records TOP next to the impact factor.
		let topField = this.$('metric-top');
		if (!topField && this.$('metric-source')) {
			let label = document.createElement('label');
			label.htmlFor = 'metric-top'; label.textContent = '中科院 TOP';
			topField = document.createElement('select'); topField.id = 'metric-top';
			for (let [value, text] of [['', '未填写'], ['TOP', 'TOP 期刊'], ['非TOP', '非 TOP 期刊']]) {
				let option = document.createElement('option'); option.value = value; option.textContent = text; topField.append(option);
			}
			this.$('metric-source').after(label, topField);
		}
		this.settingsAction('save-metric', async () => {
			if (!this.current) throw new Error('请先选择论文');
			let raw = this.$('metric-value').value.trim(), value = Number(raw), year = Number(this.$('metric-year').value), top = this.$('metric-top')?.value || '';
			let source;
			try { source = new URL(this.$('metric-source').value); } catch (_) { throw new Error('请输入有效来源网址'); }
			if (!raw && !top) throw new Error('请填写影响因子或 TOP 标记');
			if (raw && (!Number.isFinite(value) || value < 0)
				|| !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()
				|| !['https:', 'http:'].includes(source.protocol)) throw new Error('请完整填写数值、已发生的年份与来源网址');
			let item = await this.E.getItem(this.current.id);
			await this.E.saveMetrics([{ issn: this.E.issn(item), metric_year: year, source: source.href, impact_factor: raw ? value : null, cas_top: top || null }]);
			this.renderPapers(); this.status('已保存至期刊指标数据库');
		});
	},
	// A second click while a probe or save is pending starts nothing.
	settingsAction(target, action) {
		let button = typeof target === 'string' ? this.$(target) : target;
		button.addEventListener('click', async () => {
			if (button.disabled) return;
			button.disabled = true;
			button.setAttribute('aria-busy', 'true');
			try {
				await action();
			}
			catch (error) {
				this.status(error.message, true);
			}
			finally {
				button.disabled = false;
				button.setAttribute('aria-busy', 'false');
			}
		});
	},
	sameEndpoint(first, second) {
		try {
			return !!first && !!second && this.E.core.endpoint(first) === this.E.core.endpoint(second);
		}
		catch {
			return false;
		}
	},
	loadSettings() {
		this.loadProviderStatus();
		let config = this.E.settings();
		this.$('azure-region').value=config.azureTranslatorRegion||'';
		this.$('translation-endpoint').value=config.translationEndpoint||'https://api.deepseek.com';
		this.$('translation-model').value=config.translationModel||'deepseek-flash';
		this.$('youdao-app-id').value = config.youdaoAppID || '';
		this.$('image-endpoint').value = config.imageEndpoint || '';
		this.$('image-model').value = config.imageModel || '';
		for (let name of ['endpoint', 'model', 'template', 'pandoc', 'csl', 'referenceDoc', 'latexTemplate', 'documentLanguage']) this.$(name).value = config[name];
		this.E.compatibility().then(text => { this.$('compatibility').textContent = text; }).catch(e => this.status(e.message, true));
	},
	async loadProviderStatus() {
		let flags = await this.E.providerStatus(), settings = this.E.settings();
		let labels = { ai: '学术 AI', image: '示意图', deepseek: 'DeepSeek', easyscholar: '期刊指标', youdao: '有道机翻', azure: 'Azure 机翻' };
		let shared = this.sameEndpoint(settings.endpoint, settings.translationEndpoint || 'https://api.deepseek.com');
		this.$('provider-status').textContent = Object.entries(flags).map(([k, v]) => (labels[k] || k) + '：' + (v ? '已保存凭据' + (k === 'deepseek' && shared ? '（与对话模型共用）' : '') : '未配置')).join('；');
		this.renderResearchRoutingAction();
	},
	// One explicit click switches research tasks to the configured model after
	// the routed one failed its real-effort probe; nothing falls back silently.
	renderResearchRoutingAction() {
		document.getElementById('research-routing-action')?.remove();
		const probe = this.E.lastResearchProbe, routing = this.E.settings().researchModelRouting;
		const switchable = !!probe && !probe.ok && routing !== 'configured' && probe.routedModel !== probe.configuredModel;
		if (!switchable && routing !== 'configured') return;
		const button = document.createElement('button');
		button.type = 'button'; button.id = 'research-routing-action';
		button.textContent = switchable ? '研究任务改用配置模型 ' + probe.configuredModel : '研究任务恢复按任务选择模型';
		button.onclick = async () => {
			button.disabled = true;
			try {
				await this.E.store.update(s => { if (switchable) s.settings.researchModelRouting = 'configured'; else delete s.settings.researchModelRouting; });
				button.remove();
				this.status(switchable ? '研究任务将使用配置模型，可再次测试确认' : '研究任务已恢复按任务选择模型，可再次测试确认');
			}
			catch (error) {
				button.disabled = false;
				this.status(error.message, true);
			}
		};
		this.$('provider-status').after(button);
	},
	loadMetric() {
		let item = this.current && this.E.getCachedItem(this.current.id);
		let metric = item ? this.E.metrics.get(this.E.issn(item))?.[0] : null;
		this.$('metric-value').value = metric?.impact_factor ?? '';
		this.$('metric-year').value = metric?.metric_year ?? '';
		this.$('metric-source').value = metric?.source ?? '';
		let top = this.$('metric-top'), mark = String(metric?.cas_top ?? '').trim();
		if (top) top.value = !mark ? '' : /^(?:否|非|no\b|false$|0$|not[\s-]*top)/i.test(mark) ? '非TOP' : 'TOP';
	}
});
