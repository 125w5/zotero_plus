(function (E) {
	E.createStore = function (io) {
		let state;
		let queue = Promise.resolve();
		return {
			async init() {
				state = await io.read();
				if (!state) state = { version: 1, papers: {}, projects: {}, settings: {} };
				if (state.version !== 1 || !state.papers || !state.projects || !state.settings) {
					throw new Error('EasySch 数据版本不支持或文件损坏；原文件未覆盖');
				}
			},
			get() { return JSON.parse(JSON.stringify(state)); },
			update(mutator) {
				let operation = queue.then(async () => {
					let next = JSON.parse(JSON.stringify(state));
					await mutator(next);
					await io.write(next);
					state = next;
				});
				queue = operation.catch(() => {});
				return operation;
			},
			flush() { return queue; }
		};
	};
	E.initStorage = async function () {
		let dir = PathUtils.join(Zotero.DataDirectory.dir, 'easysch');
		await IOUtils.makeDirectory(dir, { ignoreExisting: true });
		let path = PathUtils.join(dir, 'workspace.json');
		E.store = E.createStore({
			async read() { return await IOUtils.exists(path) ? JSON.parse(await IOUtils.readUTF8(path)) : null; },
			async write(data) {
				await IOUtils.writeUTF8(path, JSON.stringify(data, null, 2),
					{ tmpPath: path + '.tmp', backupFile: path + '.bak' });
			}
		});
		await E.store.init();
		E.dataDir = dir;
	};
})(EasySch);
