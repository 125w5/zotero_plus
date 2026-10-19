/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
	const seedPref = 'extensions.easysch.bundledProvidersSeeded';
	const runtimePrefs = {
		engineNode: 'node', engineEntry: 'engine', assetPython: 'python',
		pandoc: 'pandoc', soffice: 'soffice', poppler: 'poppler'
	};
	// Keep in sync with the authorized private exporter. Never seed local paths
	// or user research data, and keep the three model services independent.
	const settingNames = ['endpoint', 'model', 'imageEndpoint', 'imageModel',
		'translationEndpoint', 'translationModel', 'azureTranslatorRegion',
		'youdaoAppID', 'language', 'documentLanguage', 'reasoningParameter'];
	E.initDistribution = async function () {
		const directory = Services.dirsvc.get('XREExeF', Ci.nsIFile).parent.path;
		const file = PathUtils.join(directory, 'easysch-distribution.json');
		if (!await IOUtils.exists(file)) return;
		const manifest = JSON.parse(await IOUtils.readUTF8(file));
		if (manifest.version !== 1) throw new Error('安装包版本不兼容，请重新安装 EasySch。');
		const root = PathUtils.parent(directory);
		const resolve = relative => {
			const parts = String(relative || '').replaceAll('\\', '/').split('/');
			if (parts.some(p => !p || p === '.' || p === '..' || p.includes(':'))) {
				throw new Error('安装包工具路径无效，请重新安装 EasySch。');
			}
			return PathUtils.join(root, ...parts);
		};
		for (const [name, key] of Object.entries(runtimePrefs)) {
			const path = resolve(manifest.runtime[key]);
			if (!await IOUtils.exists(path)) throw new Error('安装包缺少必要工具：' + key + '，请重新安装 EasySch。');
			Zotero.Prefs.set('extensions.easysch.' + name, path, true);
		}
		// Derived paths change when a portable folder is moved or an installation upgraded.
		await E.store.update(s => {
			const old = s.settings.bundledPandoc;
			if (!s.settings.pandoc || s.settings.pandoc === old) s.settings.pandoc = resolve(manifest.runtime.pandoc);
			s.settings.bundledPandoc = resolve(manifest.runtime.pandoc);
		});
		const defaultsFile = PathUtils.join(directory, 'easysch-provider-defaults.json');
		E.hasBundledProviders = await IOUtils.exists(defaultsFile);
		E.applyBundledProviders = async function ({ reset = false } = {}) {
			if (!E.hasBundledProviders) return;
			const data = JSON.parse(await IOUtils.readUTF8(defaultsFile));
			if (data.version !== 1 || !data.settings || !Array.isArray(data.credentials)) throw new Error('内置接口配置不完整，请重新安装 EasySch。');
			// Validate the whole input before changing even one stored credential.
			const entries = data.credentials.map(entry => {
				if (typeof entry?.key !== 'string' || !entry.key || entry.key.length > 16384) throw new Error('内置接口配置不完整，请重新安装 EasySch。');
				return {endpoint: E.core.endpoint(entry.endpoint), key: entry.key};
			});
			const settings = {};
			for (const key of settingNames) {
				if (data.settings[key] === undefined) continue;
				if (typeof data.settings[key] !== 'string' || data.settings[key].length > 2048) throw new Error('内置接口设置无效，请重新安装 EasySch。');
				if (!data.settings[key].trim()) continue;
				settings[key] = key.endsWith('Endpoint') || key === 'endpoint' ? E.core.endpoint(data.settings[key]) : data.settings[key];
			}
			for (const entry of entries) {
				if (reset || !await E.credentials.get(entry.endpoint)) await E.credentials.set(entry.endpoint, entry.key);
			}
			await E.store.update(s => {
				for (const key of settingNames) {
					const pair = {model: 'endpoint', imageModel: 'imageEndpoint', translationModel: 'translationEndpoint'}[key];
					if (pair && !reset && s.settings[pair] && s.settings[pair] !== settings[pair]) continue;
					if (settings[key] && (reset || !s.settings[key])) s.settings[key] = settings[key];
				}
			});
			// Removing a key or changing providers must survive subsequent launches.
			Zotero.Prefs.set(seedPref, true, true);
		};
		if (!Zotero.Prefs.get(seedPref, true)) await E.applyBundledProviders();
		E.distribution = { version: manifest.release, bundledProviders: E.hasBundledProviders };
	};
})(EasySch);
