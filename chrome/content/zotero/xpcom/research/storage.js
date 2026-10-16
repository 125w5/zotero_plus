(function (E) {
	E.createStore = function (io) {
		let state, revision = 0, allBranchesRevision = 0;
		let queue = Promise.resolve();
		const listeners = new Set(), branchRevisions = new Map();
		const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
		const commit = async (next, branches) => {
			await io.write(next);
			state = next;
			revision++;
			if (branches) for (const key of branches) branchRevisions.set(key, revision);
			else allBranchesRevision = revision;
			const change = Object.freeze({revision, changedBranches: branches ? Object.freeze([...branches]) : null});
			for (const fn of listeners) { try { fn(change); } catch (e) { Zotero.logError(e); } }
		};
		const enqueue = fn => { const operation = queue.then(fn); queue = operation.catch(() => {}); return operation; };
		return {
			get revision() { return revision; },
			branchRevision(key) { return Math.max(allBranchesRevision, branchRevisions.get(key) || 0); },
			subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
			async init() {
				state = await io.read();
				if (!state) state = { version: 1, papers: {}, projects: {}, settings: {} };
				if (state.version !== 1 || !state.papers || !state.projects || !state.settings) {
					throw new Error('EasySch 数据版本不支持或文件损坏；原文件未覆盖');
				}
				revision++;
				allBranchesRevision = revision;
			},
			// Copy only the requested branch for frequent card/selection reads.
			// The returned data stays detached: callers cannot mutate saved assets.
			get(...path) {
				let value = state;
				for (const key of path) value = value?.[key];
				return clone(value);
			},
			// Conversation edits replace only their branch. Capture a detached copy
			// now; unrelated manuscript/material branches need no second deep copy.
			replaceBranch(key, value) {
				if (typeof key !== 'string' || !key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('无效的数据分支');
				const branch = clone(value);
				return enqueue(() => commit({...state, [key]: branch}, [key]));
			},
			update(mutator) {
				return enqueue(async () => {
					let next = clone(state);
					await mutator(next);
					await commit(next, null);
				});
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
