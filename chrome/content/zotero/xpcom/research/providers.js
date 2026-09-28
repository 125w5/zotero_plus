/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	R.requestProvider = async function (url, options = {}, timeout = 30000, readResponse = response => response.text()) {
		let win = Zotero.getMainWindow(), controller = new win.AbortController();
		const external=options.signal,abort=()=>controller.abort();external?.addEventListener('abort',abort,{once:true});if(external?.aborted)abort();
		let timer = win.setTimeout(() => controller.abort(), timeout);
		try {
			let response = await win.fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
			if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
			return await readResponse(response);
		}
		catch (e) { throw new Error(controller.signal.aborted ? '服务请求超时，请重试' : (/^(服务返回 HTTP|模型流式响应|模型响应在完成前)/.test(e.message) ? e.message : '无法连接服务，请检查网络或代理')); }
		finally { win.clearTimeout(timer);external?.removeEventListener('abort',abort); }
	};
	R.configureProviders = async function (data) {
		// Import a user-supplied OpenAI-compatible provider into the profile's
		// password manager. The source tree and exported research data never hold keys.
		if (data.ai) {
			const endpoint = R.core.endpoint(data.ai.endpoint);
			if (!['gpt6luna', 'gpt-6-luna'].includes(data.ai.model)) throw new Error('此 AI 接口只允许使用 GPT-6 Luna');
			if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(data.ai.key || '')) throw new Error('AI 密钥格式无效');
			await R.credentials.set(endpoint, data.ai.key);
			await R.store.update(s => { s.settings.endpoint = endpoint; s.settings.model = 'gpt-6-luna'; });
		}
		if (data.image) {
			const endpoint = R.core.endpoint(data.image.endpoint);
			if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(data.image.key || '')) throw new Error('生图密钥格式无效');
			// A separate credential scope is required when chat and images share a host.
			await R.credentials.set(endpoint + '/images', data.image.key);
			await R.store.update(s => { s.settings.imageEndpoint = endpoint; });
		}
		if (data.deepseek) await R.credentials.set('https://api.deepseek.com', data.deepseek);
		if (data.easyscholar) await R.saveMetricsKey(data.easyscholar);
		if (data.youdaoSecret) await R.credentials.set('https://openapi.youdao.com', data.youdaoSecret);
		await R.store.update(s => {
			if (data.deepseek) Object.assign(s.settings, { endpoint: 'https://api.deepseek.com', model: 'deepseek-flash' });
			if (data.youdaoAppID) s.settings.youdaoAppID = data.youdaoAppID;
		});
	};
	R.importProviderSetup = async function () {
		let file = PathUtils.join(Services.dirsvc.get('ProfD', Ci.nsIFile).path, 'easysch-provider-setup.json');
		if (!await IOUtils.exists(file)) return;
		try { await R.configureProviders(JSON.parse(await IOUtils.readUTF8(file))); }
		finally { await IOUtils.remove(file); }
	};
	R.providerStatus = async function () {
		let settings = R.settings();
		return { ai: !!(settings.endpoint && await R.credentials.get(settings.endpoint)),
			image: !!(settings.imageEndpoint && await R.credentials.get(settings.imageEndpoint + '/images')),
			deepseek: !!await R.credentials.get('https://api.deepseek.com'),
			easyscholar: !!await R.credentials.get('https://easyscholar.cc'),
			youdao: !!R.settings().youdaoAppID && !!await R.credentials.get('https://openapi.youdao.com') };
	};
	R.testProviders = async function () {
		let flags = await R.providerStatus(), results = {};
		for (let name of Object.keys(flags)) {
			if (!flags[name]) { results[name] = '未配置'; continue; }
			try {
				if (name === 'ai') {
					const { endpoint, model } = R.settings();
					const chat=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-completion.mjs'),stream=chat.chatRequiresStreaming(endpoint);
					const reply = await R.requestProvider(endpoint + '/chat/completions', {
						method: 'POST', headers: { Authorization: 'Bearer ' + await R.credentials.get(endpoint), 'Content-Type': 'application/json' },
						body: JSON.stringify({ model, max_tokens: 24, ...(stream ? { stream: true } : {}), messages: [{ role: 'user', content: '只回答：连接正常' }] })
					}, 30000, response=>chat.readChatCompletion(response,{stream}));
					if (!reply.text) throw new Error('模型未返回正文');
					results[name] = '对话成功 · ' + model;
				}
				else if (name === 'image') results[name] = '凭据已保存（生图请求另行验证）';
				else if (name === 'deepseek') {
					let headers = { Authorization: 'Bearer ' + await R.credentials.get('https://api.deepseek.com'), 'Content-Type': 'application/json' };
					let models = JSON.parse(await R.requestProvider('https://api.deepseek.com/models', { headers }));
					let model = R.settings().model;
					if (!models.data?.some(m => m.id === model)) {
						model = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-v4-pro', 'deepseek-reasoner'].find(id => models.data?.some(m => m.id === id));
						if (!model) throw new Error('账户未提供可用的对话模型');
						await R.store.update(s => { s.settings.model = model; });
					}
					let reply = JSON.parse(await R.requestProvider('https://api.deepseek.com/chat/completions', { method: 'POST', headers,
						body: JSON.stringify({ model, max_tokens: 32, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'Reply only: connection verified' }] }) }, 60000));
					if (!reply.choices?.[0]?.message?.content) throw new Error('模型未返回正文');
					results[name] = '对话成功 · ' + model;
				}
				else if (name === 'youdao') { await R.translateYoudao('The experiment includes a control group.'); results[name] = '短句翻译成功'; }
				else {
					let item = new Zotero.Item('journalArticle'); item.setField('publicationTitle', 'Nature'); item.setField('ISSN', '0028-0836');
					let data = await R.lookupMetrics(item, new Date().getFullYear() - 1);
					results[name] = data.impact_factor != null ? '期刊查询成功（未写入文库）' : '接口已连接，未返回影响因子';
				}
			}
			catch (e) { results[name] = e.message; }
		}
		return results;
	};
	R.translateYoudao = async function (text, to = 'zh-CHS', {signal} = {}) {
		if (!text?.trim()) throw new Error('请先选择或输入待翻译文字');
		if (text.length > 5000) throw new Error('一次最多翻译 5000 字符，请分段选择');
		let appKey = R.settings().youdaoAppID, secret = await R.credentials.get('https://openapi.youdao.com');
		if (!appKey || !secret) throw new Error('请在设置中配置有道应用 ID 和密钥');
		let formulas = [];
		let q = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, value => { formulas.push(value); return `ZXQFORMULA${formulas.length}ZXQ`; });
		let chars = Array.from(q), input = chars.length > 20 ? chars.slice(0, 10).join('') + chars.length + chars.slice(-10).join('') : q;
		let salt = Zotero.Utilities.randomString(24), curtime = String(Math.floor(Date.now() / 1000));
		let win = Zotero.getMainWindow();
		let digest = await win.crypto.subtle.digest('SHA-256', new win.TextEncoder().encode(appKey + input + salt + curtime + secret));
		let sign = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
		let body = new win.URLSearchParams({ q, from: 'auto', to, appKey, salt, curtime, signType: 'v3', sign });
		let data = JSON.parse(await R.requestProvider('https://openapi.youdao.com/api', {
			method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
		}));
		if (String(data.errorCode) !== '0') throw new Error(`有道翻译错误码 ${data.errorCode || '未知'}（请检查密钥、服务授权和余额）`);
		let translation = data.translation?.join('\n');
		if (!translation) throw new Error('有道未返回译文');
		for (let [i, formula] of formulas.entries()) {
			let token = new RegExp(`ZXQ\\s*FORMULA\\s*${i + 1}\\s*ZXQ`, 'gi');
			if (!token.test(translation)) throw new Error('翻译未完整保留公式占位符，请缩短选段后重试');
			translation = translation.replace(token, () => formula);
		}
		return { text: translation, provider: '有道智云', at: new Date().toISOString() };
	};
})(Zotero.Research);
