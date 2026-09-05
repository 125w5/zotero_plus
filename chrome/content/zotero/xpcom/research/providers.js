/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	R.requestProvider = async function (url, options = {}, timeout = 30000) {
		let win = Zotero.getMainWindow(), controller = new win.AbortController();
		let timer = win.setTimeout(() => controller.abort(), timeout);
		try {
			let response = await win.fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
			if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
			return await response.text();
		}
		catch (e) { throw new Error(controller.signal.aborted ? '服务请求超时，请重试' : (e.message.startsWith('服务返回 HTTP') ? e.message : '无法连接服务，请检查网络或代理')); }
		finally { win.clearTimeout(timer); }
	};
	R.configureProviders = async function (data) {
		if (data.deepseek) await R.credentials.set('https://api.deepseek.com', data.deepseek);
		if (data.easyscholar) await R.saveMetricsKey(data.easyscholar);
		if (data.youdaoSecret) await R.credentials.set('https://openapi.youdao.com', data.youdaoSecret);
		await R.store.update(s => {
			if (data.deepseek) Object.assign(s.settings, { endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash' });
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
		return { deepseek: !!await R.credentials.get('https://api.deepseek.com'),
			easyscholar: !!await R.credentials.get('https://easyscholar.cc'),
			youdao: !!R.settings().youdaoAppID && !!await R.credentials.get('https://openapi.youdao.com') };
	};
	R.testProviders = async function () {
		let flags = await R.providerStatus(), results = {};
		for (let name of Object.keys(flags)) {
			if (!flags[name]) { results[name] = '未配置'; continue; }
			try {
				if (name === 'deepseek') {
					let headers = { Authorization: 'Bearer ' + await R.credentials.get('https://api.deepseek.com'), 'Content-Type': 'application/json' };
					let models = JSON.parse(await R.requestProvider('https://api.deepseek.com/models', { headers }));
					let model = R.settings().model;
					if (!models.data?.some(m => m.id === model)) {
						model = ['deepseek-v4-flash', 'deepseek-chat'].find(id => models.data?.some(m => m.id === id));
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
	R.translateYoudao = async function (text, to = 'zh-CHS') {
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
			method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
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
