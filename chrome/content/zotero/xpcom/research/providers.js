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
	// PDF streams use the same application-owned background transport and can
	// follow repository redirects without waiting behind metadata search jobs.
	R.fetchDiscoveryPDF=(url,options)=>providerTransport().fetch(url,options);
	R.createProviderController=()=>new (providerTransport().AbortController)();
	R.requestProvider = async function (url, options = {}, timeout = 30000, readResponse = response => response.text()) {
		// A background request must outlive closing its originating library or
		// Reader window. A persistent system-principal sandbox owns fetch and
		// its stream; hiddenDOMWindow is unavailable in Windows Zotero builds.
		const win=providerTransport();
		if(!win?.fetch||!win.AbortController)throw new Error('后台网络环境不可用，请重新打开软件');
		const timers=R.setTimeout&&R.clearTimeout?R:ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
		const controller=new win.AbortController(),external=options.signal;let reason,timer,rejectStopped;
		// A number keeps the legacy single deadline. {firstByte,idle,total}
		// lets a streamed answer run long while a stalled one still stops.
		let limits=typeof timeout==='object'&&timeout?{firstByte:Number(timeout.firstByte)||0,idle:Number(timeout.idle)||0,total:Number(timeout.total)||0}:{firstByte:0,idle:0,total:Number(timeout)||30000},firstTimer,idleTimer;
		let stopMessages={cancel:'服务请求已取消',timeout:'服务请求超时，请重试','first-byte':'模型较长时间没有开始回复，请重试或降低思考强度',idle:'模型输出中断时间过长，请重试',total:'本次生成超过时长上限，请重试或降低思考强度'};
		const stopError=()=>{const error=new Error(stopMessages[reason]||stopMessages.timeout);error.name=reason==='cancel'?'AbortError':'TimeoutError';if(reason!=='cancel'&&reason!=='timeout')error.timeoutStage=reason;return error;};
		const stopped=new Promise((_,reject)=>{rejectStopped=reject;});
		const stop=cause=>{if(reason)return;reason=cause;controller.abort();rejectStopped(stopError());};
		const abort=()=>stop('cancel');external?.addEventListener('abort',abort,{once:true});if(external?.aborted)abort();
		if(!reason&&limits.total)timer=timers.setTimeout(()=>stop(limits.firstByte||limits.idle?'total':'timeout'),limits.total);
		if(!reason&&limits.firstByte)firstTimer=timers.setTimeout(()=>stop('first-byte'),limits.firstByte);
		// Readers report streamed chunks; silent reasoning before the first
		// chunk is covered by the total deadline, not the idle timer.
		const activity=()=>{if(reason||!limits.idle)return;if(idleTimer!==undefined)timers.clearTimeout(idleTimer);idleTimer=timers.setTimeout(()=>stop('idle'),limits.idle);};
		try {
			const reading=(async()=>{
				if(reason)throw stopError();
				let response;try{response=await win.fetch(url,{...options,signal:controller.signal,redirect:'error'});}
				catch(error){if(reason)throw stopError();throw Object.assign(new Error('无法连接服务，请检查网络或代理'),{name:'ProviderTransportError'});}
				if(reason)throw stopError();
				if(firstTimer!==undefined){timers.clearTimeout(firstTimer);firstTimer=undefined;}
				if(!response.ok){const errors=ChromeUtils.importESModule('chrome://zotero/content/research/shared/provider-error.mjs');throw await errors.providerResponseError(response);}
				return await readResponse(response,activity);
			})();
			// Covers headers, response.text() and custom streaming readers. Abort
			// also rejects our own promise if a reader is awaiting a stalled chunk.
			// Promise.race observes a later rejection from the interrupted reader.
			const result=await Promise.race([reading,stopped]);if(reason)throw stopError();return result;
		}
		catch (e) { if(reason)throw stopError();if(e.name==='ProviderRequestError'||e.name==='ProviderTransportError')throw e;throw Object.assign(new Error(/^(服务返回 HTTP|模型流式响应|模型响应在完成前)/.test(e.message)?e.message:'服务已连接，但返回内容无法读取，请重试'),{name:'ProviderResponseError'}); }
		finally { for(const id of [timer,firstTimer,idleTimer])if(id!==undefined)timers.clearTimeout(id);external?.removeEventListener('abort',abort); }
	};
	R.configureProviders = async function (data) {
		// Import a user-supplied OpenAI-compatible provider into the profile's
		// password manager. The source tree and exported research data never hold keys.
		if (data.ai) {
			const endpoint = R.core.endpoint(data.ai.endpoint || data.ai.url || R.settings().endpoint);
			const model = String(data.ai.model || R.settings().model || 'gpt-6.1-sol').trim().replace(/^gpt6luna$/i, 'gpt-6-luna').replace(/^gpt6[.-]?1sol$/i, 'gpt-6.1-sol');
			if (!model || model.length > 160 || /[\s\x00-\x1f]/.test(model)) throw new Error('请输入有效的模型名称');
			if (data.ai.key !== undefined) {
				if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(data.ai.key || '')) throw new Error('AI 密钥格式无效');
				await R.credentials.set(endpoint, data.ai.key);
			}
			else if (!await R.credentials.get(endpoint)) throw new Error('此接口尚未保存 AI 密钥');
			await R.store.update(s => { s.settings.endpoint = endpoint; s.settings.model = model; });
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
		if (data.azure) {
			const region=String(data.azure.region||'').trim();
			if (!/^[a-z][a-z0-9-]{1,60}$/.test(region)) throw Error('请填写 Azure Translator 资源区域，例如 eastasia');
			if (data.azure.key) await R.credentials.set('https://api.cognitive.microsofttranslator.com', data.azure.key.trim());
			if (!await R.credentials.get('https://api.cognitive.microsofttranslator.com')) throw Error('请填写 Azure Translator 密钥');
			await R.store.update(s=>{s.settings.azureTranslatorRegion=region;});
		}
		if (data.translation) {
			const endpoint=R.core.endpoint(data.translation.endpoint||'https://api.deepseek.com'),model=String(data.translation.model||'deepseek-flash').trim();
			if (!model||model.length>160) throw Error('请填写翻译模型名称');
			if (data.translation.key) await R.credentials.set(endpoint,data.translation.key.trim());
			await R.store.update(s=>{s.settings.translationEndpoint=endpoint;s.settings.translationModel=model;});
		}
		await R.store.update(s => {
			if (data.deepseek) Object.assign(s.settings, { translationEndpoint: 'https://api.deepseek.com', translationModel: 'deepseek-flash' });
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
			deepseek: !!await R.credentials.get(settings.translationEndpoint||'https://api.deepseek.com'),
			azure: !!settings.azureTranslatorRegion && !!await R.credentials.get('https://api.cognitive.microsofttranslator.com'),
			easyscholar: !!await R.credentials.get('https://easyscholar.cc'),
			youdao: !!R.settings().youdaoAppID && !!await R.credentials.get('https://openapi.youdao.com') };
	};
	// A stopped test starts no further probe and aborts the running one.
	R.testProviders = async function ({ signal } = {}) {
		let flags = await R.providerStatus(), results = {};
		for (let name of Object.keys(flags)) {
			if (signal?.aborted) break;
			if (!flags[name]) { results[name] = '未配置'; continue; }
			try {
				if (name === 'ai') {
					const settings = R.settings(), { endpoint, model } = settings;
					const chat=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-completion.mjs'),stream=chat.chatRequiresStreaming(endpoint);
					const Policy=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-ai-policy.mjs'),key=await R.credentials.get(endpoint);
					const probe=async(config,tokens,timeout)=>{
						const reply=await R.requestProvider(endpoint + '/chat/completions', {
							method: 'POST', signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
							body: JSON.stringify({ model: config.model, [Policy.tokenParameter(config)]: tokens, ...Policy.reasoningPayload(config), ...(stream ? { stream: true } : {}), messages: [{ role: 'user', content: '只回答：连接正常' }] })
						}, timeout, response=>chat.readChatCompletion(response,{stream}));
						// A reasoning model may spend this small cap on thinking; the
						// length stop still proves the model and effort were accepted.
						if (!reply.text && reply.finishReason !== 'length') throw new Error('模型未返回正文');
					};
					R.lastResearchProbe = null;
					await probe({ ...settings, thinkingLevel: 'off', reasoningParameter: '' }, 24, 30000);
					results[name] = '对话成功 · ' + model;
					// The settings test must cover the model research tasks actually
					// route to, with its real effort, not only the configured model.
					// Name an effort only when a reasoning parameter is actually sent.
					const routed = R.researchModelConfig({ ...settings, thinkingLevel: '' }, 'research'), sent = Object.keys(Policy.reasoningPayload(routed)).length > 0;
					const label = '将使用 ' + routed.model + (sent ? ' · 思考 ' + Policy.thinkingLabel(routed.thinkingLevel) : ' · 未发送思考参数') + (settings.researchModelRouting === 'configured' ? '（已设为使用配置模型）' : '');
					const needed = routed.model !== model || sent;
					// Writing and assessment can run at a higher effort than this probe covers.
					let writing = R.researchModelConfig({ ...settings, thinkingLevel: '' }, 'writing'), writingNote = sent && Object.keys(Policy.reasoningPayload(writing)).length && writing.thinkingLevel !== routed.thinkingLevel ? '；写作与评估使用' + Policy.thinkingLabel(writing.thinkingLevel) + '思考，未单独测试' : '';
					try {
						if (needed) await probe(routed, ['high', 'xhigh'].includes(routed.thinkingLevel) ? 8192 : 4096, 90000);
						results.research = label + (needed ? '：可用' : '：与对话测试相同') + writingNote;
						R.lastResearchProbe = { ok: true, routedModel: routed.model, configuredModel: model, thinkingLevel: routed.thinkingLevel, routing: settings.researchModelRouting || 'auto' };
					}
					catch (error) {
						// A stop is not a failed probe and must not offer a model switch.
						if (signal?.aborted) throw error;
						results.research = label + '：不可用（' + error.message + '）';
						R.lastResearchProbe = { ok: false, routedModel: routed.model, configuredModel: model, thinkingLevel: routed.thinkingLevel, routing: settings.researchModelRouting || 'auto', message: error.message };
					}
				}
				else if (name === 'image') {
					const Image = ChromeUtils.importESModule('chrome://zotero/content/research/shared/image-generation.mjs');
					const selected = Image.selectImageModel(await R.imageModels({ refresh: true, signal }), R.settings().imageModel);
					results[name] = '已连接 · ' + selected + '（未生成图片）';
				}
				else if (name === 'deepseek') {
					const result=await R.quickTranslate('The experiment includes a control group.',signal,{purpose:'document',persist:false});
					results[name] = '学术翻译成功 · ' + result.provider;
				}
				else if (name === 'azure') { await R.translateAzure('The experiment includes a control group.', undefined, { signal }); results[name] = '选区机翻成功'; }
				else if (name === 'youdao') { await R.translateYoudao('The experiment includes a control group.', undefined, { signal }); results[name] = '短句翻译成功'; }
				else {
					let item = new Zotero.Item('journalArticle'); item.setField('publicationTitle', 'Nature'); item.setField('ISSN', '0028-0836');
					let data = await R.lookupMetrics(item, new Date().getFullYear() - 1, { signal });
					results[name] = data.impact_factor != null ? '期刊查询成功（未写入文库）' : '接口已连接，未返回影响因子';
				}
			}
			catch (e) {
				if (signal?.aborted) break;
				results[name] = e.message;
			}
		}
		return results;
	};
	R.translateAzure = async function (text, to = 'zh-Hans', {signal,timeout=15000} = {}) {
		if (!text?.trim() || text.length>5000) throw Error('请选择不超过 5000 字符的原文');
		const region=R.settings().azureTranslatorRegion,key=await R.credentials.get('https://api.cognitive.microsofttranslator.com');
		if (!region||!key) throw Error('请在设置中保存 Azure Translator 密钥和区域');
		if (signal?.aborted) throw Object.assign(Error('翻译已取消'),{name:'AbortError'});
		// Preserve TeX and native PDF placeholders. HTML notranslate is part of
		// Translator's documented textType=html API, never rendered as markup.
		const protectedText=String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
			.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\bZXQ(?:MATH|BLOCK)[A-Z0-9]*ZXQ\b/g,value=>'<span class="notranslate">'+value+'</span>');
		const body=JSON.stringify([{Text:protectedText}]);
		const response=JSON.parse(await R.requestProvider('https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=html&to='+encodeURIComponent(to),{
			method:'POST',signal,headers:{'Content-Type':'application/json','Ocp-Apim-Subscription-Key':key,'Ocp-Apim-Subscription-Region':region},body
		},timeout));
		const html=response?.[0]?.translations?.find(row=>row.to===to)?.text||response?.[0]?.translations?.[0]?.text;
		if (!html?.trim()) throw Error('Azure Translator 未返回译文');
		const translated=html.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(?:39|x27);/gi,"'").replace(/&amp;/g,'&');
		for (const token of text.match(/\bZXQ(?:MATH|BLOCK)[A-Z0-9]*ZXQ\b/g)||[]) if(translated.split(token).length!==text.split(token).length) throw Error('Azure 译文未保留公式位置，原文已保留');
		return {text:translated,provider:'Microsoft Azure Translator',at:new Date().toISOString()};
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
