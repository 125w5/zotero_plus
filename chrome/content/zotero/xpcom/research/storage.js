(function (E) {
	E.createStore = function (io) {
		let state, revision = 0, allBranchesRevision = 0;
		let queue = Promise.resolve();
		const listeners = new Set(), branchRevisions = new Map();
		const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
		// Committed state is replaced, never edited in place, so a frozen subtree
		// can be shared by readers. Children freeze first: a frozen object always
		// has a frozen subtree, and unchanged parts of later commits skip the walk.
		const deepFreeze = value => {
			if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
			for (let key of Object.keys(value)) deepFreeze(value[key]);
			return Object.freeze(value);
		};
		// Draft only the paths a transaction changes. Cached paper text and image
		// records often dominate the workspace; a note must not copy them all.
		const draft = base => {
			const nodes = new WeakMap(); let active = true;
			const object = value => value !== null && typeof value === 'object';
			const create = (value, parent, key) => {
				const node = {base: value, copy: null, children: new Map(), parent, key};
				const change = () => {
					if (!active) throw Error('数据事务已经结束');
					if (!node.copy) { node.copy = Array.isArray(value) ? value.slice() : {...value}; parent?.change(); }
				}; node.change = change;
				node.proxy = new Proxy(Array.isArray(value) ? [] : {}, {
					get(_, property) {
						const current = (node.copy || value)[property];
						if (!object(current)) return current;
						if (nodes.has(current)) return current;
						let child = node.children.get(property);
						if (!child || child.base !== current) { child = create(current, node, property); node.children.set(property, child); }
						return child.proxy;
					},
					set(_, property, next) {
						const current = node.copy || value;
						if (Object.hasOwn(current, property) && Object.is(current[property], next)) return true;
						// Assignment expressions return their original RHS. Keep that value
						// live inside the transaction (including `const row = list[id] ||= {}`)
						// and detach it only when the successful draft is finalized.
						change(); node.copy[property] = next; node.children.delete(property); return true;
					},
					deleteProperty(_, property) {
						if (Object.hasOwn(node.copy || value, property)) { change(); delete node.copy[property]; node.children.delete(property); }
						return true;
					},
					has: (_, property) => property in (node.copy || value),
					ownKeys: () => Reflect.ownKeys(node.copy || value),
					getOwnPropertyDescriptor(_, property) {
						const descriptor = Object.getOwnPropertyDescriptor(node.copy || value, property);
						// A committed base can be frozen for shared reads. The draft itself
						// stays writable, and array length must match the proxy target.
						if (descriptor && 'value' in descriptor) descriptor.writable = true;
						return descriptor && {...descriptor, configurable: property !== 'length' || !Array.isArray(value)};
					}
				}); nodes.set(node.proxy, node); return node;
			};
			const root = create(base);
			const finish = node => {
				if (!node.copy) return node.base;
				const result = node.copy;
				for (const property of Object.keys(result)) {
					const value = result[property], child = node.children.get(property), assigned = object(value) && nodes.get(value);
					if (assigned) result[property] = finish(assigned);
					else if (child && child.base === value) {
						const completed = finish(child);
						result[property] = value !== node.base[property] ? clone(completed) : completed;
					}
					else if (object(value) && value !== node.base[property]) result[property] = clone(value);
				}
				return result;
			};
			return {value: root.proxy, finish() { active = false; const next = finish(root); return {next, branches: [...new Set([...Object.keys(base), ...Object.keys(next)])].filter(key => !Object.is(base[key], next[key]))}; }, close() {active = false;} };
		};
		const commit = async (next, branches) => {
			await io.write(next, branches);
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
				io.loaded?.(() => state);
			},
			// Copy only the requested branch for frequent card/selection reads.
			// The returned data stays detached: callers cannot mutate saved assets.
			get(...path) {
				let value = state;
				for (const key of path) value = value?.[key];
				return clone(value);
			},
			// Shared read-only view of committed data. Use it for lists, search and
			// lookups over large caches; writes still go through update().
			peek(...path) {
				let value = state;
				for (let key of path) value = value?.[key];
				return deepFreeze(value);
			},
			// Freeze one large branch a few entries at a time during idle periods,
			// so the first peek of a big cache does not pause the window.
			freezeIdle(key, deadline) {
				let branch = state?.[key];
				if (branch === null || typeof branch !== 'object' || Object.isFrozen(branch)) return true;
				for (let name of Object.keys(branch)) {
					if (deadline()) return false;
					deepFreeze(branch[name]);
				}
				Object.freeze(branch);
				return true;
			},
			// Conversation edits replace only their branch. Capture a detached copy
			// now; unrelated manuscript/material branches need no second deep copy.
			replaceBranch(key, value) {
				if (typeof key !== 'string' || !key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('无效的数据分支');
				const branch = clone(value);
				return enqueue(() => commit({...state, [key]: branch}, [key]));
			},
			// Resolve the branch inside the shared queue. A field edit must neither
			// clone every cached PDF nor replace a snapshot older than a concurrent save.
			updateBranch(key, mutator) {
				if (typeof key !== 'string' || !key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('无效的数据分支');
				return enqueue(async () => {
					const branch = clone(state[key]);
					const result = await mutator(branch);
					await commit({...state, [key]: clone(result === undefined ? branch : result)}, [key]);
				});
			},
			update(mutator) {
				return enqueue(async () => {
					const transaction = draft(state);
					try {
						await mutator(transaction.value);
						const {next, branches} = transaction.finish();
						if (branches.length) await commit(next, branches);
					} finally { transaction.close(); }
				});
			},
			flush() { return queue; }
		};
	};
	// The workspace stays one atomic file. It is assembled from cached pieces per
	// branch and, for object branches, per entry: committed objects are never
	// edited in place, so an unchanged identity reuses its encoded piece and a
	// note or material edit encodes that entry instead of every cached paper.
	E.createWorkspaceSerializer = function ({encode = text => text, join = parts => parts.join('')} = {}) {
		let records = new Map();
		const OPEN = encode('{'), CLOSE = encode('}'), COMMA = encode(',');
		let plain = value => {
			if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.toJSON === 'function') return false;
			let proto = Object.getPrototypeOf(value);
			return proto === null || Object.getPrototypeOf(proto) === null;
		};
		let piece = (name, value) => {
			let json = JSON.stringify(value);
			return json === undefined ? null : encode(JSON.stringify(name) + ':' + json);
		};
		let record = (key, value) => {
			let old = records.get(key);
			if (old && old.value === value) return old;
			let next = plain(value)
				? {key, value, split: true, prefix: encode(JSON.stringify(key) + ':'), names: Object.keys(value), entries: new Map(), previous: old?.entries || null, filled: 0}
				: {key, value, split: false, piece: undefined};
			records.set(key, next);
			return next;
		};
		let fill = (item, deadline) => {
			if (!item.split) {
				if (item.piece === undefined) item.piece = piece(item.key, item.value);
				return true;
			}
			while (item.filled < item.names.length) {
				if (deadline?.()) return false;
				let name = item.names[item.filled], value = item.value[name], prior = item.previous?.get(name);
				item.entries.set(name, prior && prior.value === value ? prior : {value, piece: piece(name, value)});
				item.filled++;
			}
			item.previous = null;
			return true;
		};
		return {
			serialize(data) {
				let parts = [OPEN], first = true, live = new Set();
				for (let key of Object.keys(data)) {
					live.add(key);
					let item = record(key, data[key]);
					fill(item);
					if (!item.split && item.piece === null) continue;
					if (!first) parts.push(COMMA);
					first = false;
					if (!item.split) {
						parts.push(item.piece);
						continue;
					}
					parts.push(item.prefix, OPEN);
					let inner = true;
					for (let name of item.names) {
						let entry = item.entries.get(name);
						if (entry.piece === null) continue;
						if (!inner) parts.push(COMMA);
						inner = false;
						parts.push(entry.piece);
					}
					parts.push(CLOSE);
				}
				parts.push(CLOSE);
				for (let key of [...records.keys()]) if (!live.has(key)) records.delete(key);
				return join(parts);
			},
			// Encode committed data ahead of the next write, in deadline-bounded
			// slices. A record that a pending write already replaced is left alone.
			prime(data, deadline) {
				for (let key of Object.keys(data)) {
					if (deadline()) return false;
					let item = records.get(key);
					if (item && item.value !== data[key]) continue;
					if (!fill(item || record(key, data[key]), deadline)) return false;
				}
				return true;
			}
		};
	};
	const concatBytes = parts => {
		let size = 0;
		for (let part of parts) size += part.length;
		let bytes = new Uint8Array(size), offset = 0;
		for (let part of parts) {
			bytes.set(part, offset);
			offset += part.length;
		}
		return bytes;
	};
	const IDLE_FREEZE = ['researchMaterials', 'manuscriptDocuments', 'manuscriptIndex', 'materialDescriptions', 'manuscriptSectionView', 'manuscriptSectionReferences'];
	// After startup, encode the workspace and freeze the large caches in idle
	// slices, so neither the first edit nor the first material list pauses the
	// window for a whole-workspace pass.
	const primeWorkspace = (serializer, current) => {
		let thread = typeof Services === 'object' && typeof Services.tm?.idleDispatchToMainThread === 'function' ? Services.tm : null;
		if (!thread) return;
		let {setTimeout} = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
		let freezing = [...IDLE_FREEZE];
		let step = () => {
			try {
				let start = Date.now(), deadline = () => Date.now() - start > 8;
				let done = serializer.prime(current(), deadline);
				while (done && freezing.length && !deadline()) {
					if (E.store.freezeIdle(freezing[0], deadline)) freezing.shift();
					else done = false;
				}
				if (!done || freezing.length) thread.idleDispatchToMainThread(step, 1000);
			}
			catch (error) {
				Zotero.logError(error);
			}
		};
		setTimeout(() => thread.idleDispatchToMainThread(step, 1000), 4000);
	};
	E.initStorage = async function () {
		let dir = PathUtils.join(Zotero.DataDirectory.dir, 'easysch');
		await IOUtils.makeDirectory(dir, { ignoreExisting: true });
		let path = PathUtils.join(dir, 'workspace.json');
		// Cached UTF-8 pieces skip both JSON and string conversion for unchanged
		// data; without an encoder the same pieces are joined as text.
		let bytes = typeof TextEncoder === 'function' && typeof IOUtils.write === 'function';
		let encoder = bytes ? new TextEncoder() : null;
		let serializer = E.createWorkspaceSerializer(bytes ? { encode: text => encoder.encode(text), join: concatBytes } : {});
		E.store = E.createStore({
			async read() { return await IOUtils.exists(path) ? JSON.parse(await IOUtils.readUTF8(path)) : null; },
			async write(data) {
				let body = serializer.serialize(data), options = { tmpPath: path + '.tmp', backupFile: path + '.bak' };
				if (bytes) await IOUtils.write(path, body, options);
				else await IOUtils.writeUTF8(path, body, options);
			},
			loaded(current) {
				primeWorkspace(serializer, current);
			}
		});
		await E.store.init();
		E.dataDir = dir;
	};
})(EasySch);
