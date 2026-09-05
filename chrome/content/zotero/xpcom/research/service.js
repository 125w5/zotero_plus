/* SPDX-License-Identifier: AGPL-3.0-or-later */
Zotero.Research = {
	async init() {
		let scope = { Zotero, Services, ChromeUtils, Cc, Ci, IOUtils, PathUtils, URL,
			EasySch: this };
		this.id = 'easysch-builtin';
		this.rootURI = 'chrome://zotero/content/xpcom/research/';
		for (let name of ['core', 'paper-skills', 'storage', 'zotero', 'ai', 'export', 'artifacts', 'database', 'metrics-provider', 'providers', 'search', 'columns', 'sidebar', 'meetings', 'app']) {
			Services.scriptloader.loadSubScript(this.rootURI + name + '.js', scope, 'UTF-8');
		}
		await this.initDatabase();
		await this.initStorage();
	},
	async attachWindow(win) {
		if (!this._started) {
			this._started = this.start();
		}
		await this._started;
		this.addWindow(win);
	}
};
