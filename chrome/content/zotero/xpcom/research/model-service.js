/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
	const requests = new Map(), cache = new Map();
	// Custom providers keep their explicit model; /models is not universal.
	E.resolveModel = async (config, { signal, refresh = false } = {}) => {
		const endpoint = E.core.endpoint(config.endpoint);
		if (new URL(endpoint).hostname !== 'api.deepseek.com') return { ...config };
		let entry = cache.get(endpoint);
		if (refresh || !entry || Date.now() - entry.at > 3600000) {
			let task = requests.get(endpoint);
			if (!task) {
				task = (async () => {
					const key = await E.credentials.get(endpoint);
					const result = JSON.parse(await E.requestProvider(endpoint + '/models', { headers: { Authorization: 'Bearer ' + key } }, 12000));
					const ids = (result.data || []).map(m => m.id).filter(id => typeof id === 'string');
					if (!ids.length) throw Error('模型列表为空，请检查设置中的服务地址');
					const value = { ids, at: Date.now() }; cache.set(endpoint, value); return value;
				})();
				requests.set(endpoint, task);
				task.finally(() => requests.delete(endpoint)).catch(() => {});
			}
			try { entry = await task; }
			catch (error) {
				if (!config.model) throw error;
				return { ...config };
			}
		}
		if (signal?.aborted) throw Error('已取消');
		const model = entry.ids.includes(config.model) ? config.model
			: entry.ids.find(id => /flash/i.test(id)) || entry.ids.find(id => /chat/i.test(id)) || entry.ids[0];
		if (model !== config.model) await E.store.update(state => {
			if (state.settings.endpoint === config.endpoint && state.settings.model === config.model) state.settings.model = model;
		});
		return { ...config, model };
	};
	E.aiProgress = (model, stage = '正在生成') => `${stage} · ${model}`;
})(Zotero.Research);
