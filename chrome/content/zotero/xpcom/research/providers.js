/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	let transport;
	const providerTransport = () => {
		if (!transport) transport = new Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
			sandboxName: 'EasySch background provider transport',
			wantGlobalProperties: ['fetch', 'AbortController']
		});
		return transport;
	};
	R.requestProvider = async function (url, options = {}, timeout = 30000, readResponse = response => response.text()) {
		// A background request must outlive closing its originating library or
		// Reader window. A persistent system-principal sandbox owns fetch and
		// its stream; hiddenDOMWindow is unavailable in Windows Zotero builds.
		const win=providerTransport();
		if(!win?.fetch||!win.AbortController)throw new Error('后台网络环境不可用，请重新打开软件');
		const timers=R.setTimeout&&R.clearTimeout?R:ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
		const controller=new win.AbortController(),external=options.signal;let reason,timer,rejectStopped;
		const stopError=()=>{const error=new Error(reason==='cancel'?'服务请求已取消':'服务请求超时，请重试');error.name=reason==='cancel'?'AbortError':'TimeoutError';return error;};
		const stopped=new Promise((_,reject)=>{rejectStopped=reject;});
		const stop=cause=>{if(reason)return;reason=cause;controller.abort();rejectStopped(stopError());};
		const abort=()=>stop('cancel');external?.addEventListener('abort',abort,{once:true});if(external?.aborted)abort();
		if(!reason)timer=timers.setTimeout(()=>stop('timeout'),timeout);
		try {
			const reading=(async()=>{
				if(reason)throw stopError();
				let response;try{response=await win.fetch(url,{...options,signal:controller.signal,redirect:'error'});}
				catch(error){if(reason)throw stopError();throw Object.assign(new Error('无法连接服务，请检查网络或代理'),{name:'ProviderTransportError'});}
				if(reason)throw stopError();
				if(!response.ok){const errors=ChromeUtils.importESModule('chrome://zotero/content/research/shared/provider-error.mjs');throw await errors.providerResponseError(response);}
				return await readResponse(response);
			})();
			// Covers headers, response.text() and custom streaming readers. Abort
			// also rejects our own promise if a reader is awaiting a stalled chunk.
			// Promise.race observes a later rejection from the interrupted reader.
			const result=await Promise.race([reading,stopped]);if(reason)throw stopError();return result;
		}
		catch (e) { if(reason)throw stopError();if(e.name==='ProviderRequestError'||e.name==='ProviderTransportError')throw e;throw Object.assign(new Error(/^(服务返回 HTTP|模型流式响应|模型响应在完成前)/.test(e.message)?e.message:'服务已连接，但返回内容无法读取，请重试'),{name:'ProviderResponseError'}); }
		finally { if(timer!==undefined)timers.clearTimeout(timer);external?.removeEventListener('abort',abort); }
	};
	R.configureProviders = async function (data) {
		// Import a user-supplied OpenAI-compatible provider into the profile's
		// password manager. The source tree and exported research data never hold keys.
		if (data.ai) {
			const endpoint = R.core.endpoint(data.ai.endpoint || data.ai.url || R.settings().endpoint);
			if (!['gpt6luna', 'gpt-6-luna'].includes(data.ai.model)) throw new Error('此 AI 接口只允许使用 GPT-6 Luna');
			if (data.ai.key !== undefined) {
				if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(data.ai.key || '')) throw new Error('AI 密钥格式无效');
				await R.credentials.set(endpoint, data.ai.key);
			}
			else if (!await R.credentials.get(endpoint)) throw new Error('此接口尚未保存 AI 密钥');
			await R.store.update(s => { s.settings.endpoint = endpoint; s.settings.model = 'gpt-6-luna'; });
		}
		if (data.image) {
			const endpoint = R.core.endpoint(data.image.endpoint || data.image.url);
			if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(data.image.key || '')) throw new Error('生图密钥格式无效');
			if (data.image.model !== undefined && (typeof data.image.model !== 'string' || !data.image.model.trim() || data.image.model.length > 160)) throw new Error('生图模型名称无效');
			// A separate credential scope is required when chat and images share a host.
			await R.credentials.set(endpoint + '/images', data.image.key);
			await R.store.update(s => {
				if (s.settings.imageEndpoint !== endpoint) delete s.settings.imageModel;
				s.settings.imageEndpoint = endpoint;
				if (data.image.model) s.settings.imageModel = data.image.model.trim();
			});
			imageCatalogs.delete(endpoint);
		}
		if (data.deepseek) await R.credentials.set('https://api.deepseek.com', data.deepseek);
		if (data.easyscholar) await R.saveMetricsKey(data.easyscholar);
		if (data.youdaoSecret) await R.credentials.set('https://openapi.youdao.com', data.youdaoSecret);
		await R.store.update(s => {
			if (data.deepseek) Object.assign(s.settings, { endpoint: 'https://api.deepseek.com', model: 'deepseek-flash' });
			if (data.youdaoAppID) s.settings.youdaoAppID = data.youdaoAppID;
		});
	};
	const imageCatalogs = new Map();
	R.imageModels = async function ({ refresh = false, signal } = {}) {
		const config = R.settings();
		if (!config.imageEndpoint) throw Error('请先在设置中保存生图接口');
		const endpoint = R.core.endpoint(config.imageEndpoint), saved = imageCatalogs.get(endpoint);
		if (!refresh && saved && Date.now() - saved.at < 3600000) return [...saved.models];
		const key = await R.credentials.get(endpoint + '/images');
		if (!key) throw Error('请先在设置中保存生图密钥');
		const Image = ChromeUtils.importESModule('chrome://zotero/content/research/shared/image-generation.mjs');
		try {
			const response = JSON.parse(await R.requestProvider(endpoint + '/models', { signal, headers: { Authorization: 'Bearer ' + key } }, 12000));
			const models = Image.imageModelsFromCatalog(response);
			imageCatalogs.set(endpoint, { models, at: Date.now() });
			return models;
		}
		catch (error) {
			if (signal?.aborted) throw error;
			// Some compatible services omit /models. Preserve a deliberate model
			// setting, rather than guessing a different paid model after an error.
			if (config.imageModel) return [config.imageModel];
			throw Error('无法读取生图模型列表，请检查接口或在设置中填写支持的生图模型');
		}
	};
	R.generateResearchImage = async function (prompt, { signal, onProgress = () => {}, size = '1024x1024', retainImport = false } = {}) {
		const Image = ChromeUtils.importESModule('chrome://zotero/content/research/shared/image-generation.mjs');
		// Validate before touching credentials, files or a paid request.
		Image.imageRequest(prompt, { size });
		const abort = () => { if (signal?.aborted) throw Object.assign(Error('已取消生成图片'), { name: 'AbortError' }); };abort();
		const config = R.settings();
		if (!config.imageEndpoint) throw Error('请先在设置中保存生图接口');
		const endpoint = R.core.endpoint(config.imageEndpoint);
		const key = await R.credentials.get(endpoint + '/images');
		if (!key) throw Error('请先在设置中保存生图密钥');
		onProgress('正在确认生图模型…');
		const model = Image.selectImageModel(await R.imageModels({ signal }), config.imageModel);abort();
		if (R.core.endpoint(R.settings().imageEndpoint || '') !== endpoint || R.settings().imageModel !== config.imageModel) throw Error('生图设置已变化，请按新的设置重新生成');
		onProgress('正在生成图片 · ' + model);
		const body = Image.imageRequest(prompt, { model, size });
		const response = JSON.parse(await R.requestProvider(endpoint + '/images/generations', { method: 'POST', signal,
			headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 180000));abort();
		const { bytes, extension } = Image.generatedImageBytes(response);
		const temporary = PathUtils.join(Zotero.getTempDirectory().path, 'easysch-image-' + Zotero.Utilities.randomString(16) + '.' + extension);
		let image;
		try {
			await IOUtils.write(temporary, bytes);abort();
			image = await R.importWritingImage(temporary, { signal: signal || new (Zotero.getMainWindow().AbortController)().signal });abort();
			const result = { ...image, model, endpoint, prompt: String(prompt).trim(), generatedAt: new Date().toISOString() };
			for (const name of ['rollbackImport', 'finishImport']) if (image[name]) Object.defineProperty(result, name, { value: image[name] });
			if (!retainImport) image.finishImport?.();
			return result;
		}
		catch (error) { await image?.rollbackImport?.();throw error; }
		finally { await IOUtils.remove(temporary, { ignoreAbsent: true }); }
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
				else if (name === 'image') {
					const Image = ChromeUtils.importESModule('chrome://zotero/content/research/shared/image-generation.mjs');
					const selected = Image.selectImageModel(await R.imageModels({ refresh: true }), R.settings().imageModel);
					results[name] = '已连接 · ' + selected + '（未生成图片）';
				}
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
	R.translateYoudao = async function (text, to = 'zh-CHS', {signal,timeout=30000} = {}) {
		if (!text?.trim()) throw new Error('请先选择或输入待翻译文字');
		if (text.length > 5000) throw new Error('一次最多翻译 5000 字符，请分段选择');
		const Deadline=ChromeUtils.importESModule('chrome://zotero/content/research/shared/request-deadline.mjs');
		const timers=R.setTimeout&&R.clearTimeout?R:ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
		return Deadline.requestWithinDeadline(async currentSignal=>{
		let appKey = R.settings().youdaoAppID, secret = await R.credentials.get('https://openapi.youdao.com');
		if(currentSignal.aborted)throw Object.assign(new Error('请求已取消'),{name:'AbortError'});
		if (!appKey || !secret) throw new Error('请在设置中配置有道应用 ID 和密钥');
		let formulas = [];
		let q = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, value => { formulas.push(value); return `ZXQFORMULA${formulas.length}ZXQ`; });
		let chars = Array.from(q), input = chars.length > 20 ? chars.slice(0, 10).join('') + chars.length + chars.slice(-10).join('') : q;
		let salt = Zotero.Utilities.randomString(24), curtime = String(Math.floor(Date.now() / 1000));
		let win = Zotero.getMainWindow();
		let digest = await win.crypto.subtle.digest('SHA-256', new win.TextEncoder().encode(appKey + input + salt + curtime + secret));
		if(currentSignal.aborted)throw Object.assign(new Error('请求已取消'),{name:'AbortError'});
		let sign = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
		let body = new win.URLSearchParams({ q, from: 'auto', to, appKey, salt, curtime, signType: 'v3', sign });
		let data = JSON.parse(await R.requestProvider('https://openapi.youdao.com/api', {
			method: 'POST', signal:currentSignal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
		},timeout));
		if (String(data.errorCode) !== '0') throw new Error(`有道翻译错误码 ${data.errorCode || '未知'}（请检查密钥、服务授权和余额）`);
		let translation = data.translation?.join('\n');
		if (!translation) throw new Error('有道未返回译文');
		for (let [i, formula] of formulas.entries()) {
			let token = new RegExp(`ZXQ\\s*FORMULA\\s*${i + 1}\\s*ZXQ`, 'gi');
			if (!token.test(translation)) throw new Error('翻译未完整保留公式占位符，请缩短选段后重试');
			translation = translation.replace(token, () => formula);
		}
		return { text: translation, provider: '有道智云', at: new Date().toISOString() };
		},{signal,timeout,AbortController:providerTransport().AbortController,setTimeout:timers.setTimeout.bind(timers),clearTimeout:timers.clearTimeout.bind(timers)});
	};
})(Zotero.Research);
