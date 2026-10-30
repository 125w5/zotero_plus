/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (E) {
	const Evidence=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-evidence.mjs');
	const pending = new Map(), remembered = new Map(), projectWrites = new Map();
	const asset = id => E.manuscripts.assetLibrary()[id];
	const persist = async (id, value) => {
		remembered.set(id, value);
		await E.store.update(state => { state.researchMessageNotes ||= {}; state.researchMessageNotes[id] = value; });
	};
	const sourceLinks = async sources => {
		const links = new Map();
		for (const row of sources) {
			let uri = row.uri || row.anchor?.uri || row.url || row.anchor?.url;
			if (!uri && E.library?.uri) {
				const id = row.attachmentID || row.anchor?.attachmentID || row.paperItemID || row.anchor?.paperItemID;
				if (id) try {
					const item = await Zotero.Items.getAsync(Number(id));
					if (item && !item.deleted) uri = E.library.uri(item, row.pageIndex ?? row.anchor?.pageIndex);
				} catch (_) { /* Preserve the answer even if a source has disappeared. */ }
			}
			if (typeof uri !== 'string' || !/^(?:zotero:\/\/|https:\/\/)/.test(uri) || /[\u0000-\u001f]/.test(uri)) continue;
			if (!links.has(uri)) links.set(uri, '<a href="' + E.core.escapeHTML(uri) + '">' + E.core.escapeHTML(row.title || row.label || '来源') + '</a>');
		}
		return [...links.values()];
	};
	const associate = async (projectID, saved) => {
		if (!projectID) return;
		if (!E.notebook.project(projectID)) throw Error('笔记已保存；关联项目已经不存在，请重新选择');
		const material = asset(saved.materialID);
		if (!material) throw Error('笔记已保存；素材尚未入库，请重试保存');
		// Catalog saves cloned projects. Serialize additions to the same project.
		const previous = projectWrites.get(projectID) || Promise.resolve();
		const task = previous.catch(() => {}).then(() => E.notebook.catalog(projectID, p => {
			p.materials ||= [];
			if (!p.materials.some(row => row.id === material.id)) p.materials.push(material);
		}));
		projectWrites.set(projectID, task);
		try { await task; }
		catch (_) { throw Error('笔记和素材已保存；加入项目未完成，请重试保存'); }
		finally { if (projectWrites.get(projectID) === task) projectWrites.delete(projectID); }
	};
	E.saveResearchMessageNote = async (message, { sessionID = '', projectID = '' } = {}) => {
		if (!message?.id || typeof message.text !== 'string' || !message.text.trim()) throw Error('这条消息没有可保存的正文');
		message=Evidence.answerWithQuestion(E.workbenchConversations?.get(sessionID)?.messages||[],message);
		const question=message.question,noteText=(question?'问题：'+question+'\n\n回答：\n':'')+message.text;
		// One message remains one research asset across several projects. JSON
		// avoids key collisions when an existing session or message ID has colons.
		const stableID = JSON.stringify([String(sessionID), String(message.id)]);
		let task = pending.get(stableID);
		if (!task) {
		task = (async () => {
			const registry = E.store.get('researchMessageNotes') || {};
			const legacyID = [sessionID, message.id, projectID].join(':');
			const old = Object.entries(registry).find(([, value]) => value?.sessionID === sessionID && value?.messageID === message.id);
			const legacy = registry[legacyID];
			const matchedID = registry[stableID] ? stableID : legacy?.sessionID === sessionID && legacy?.messageID === message.id ? legacyID : old?.[0];
			const previous = remembered.get(stableID) || registry[matchedID];
			let existingNote;
			if (previous?.noteID) existingNote = await Zotero.Items.getAsync(previous.noteID);
			if (existingNote && !existingNote.deleted && previous.materialID && asset(previous.materialID)) {
				await persist(stableID, previous); return { ...previous, reused: true };
			}
			const sources = (Array.isArray(message.sources) ? message.sources : []).filter(row => row && typeof row === 'object');
			const paperID = sources.find(row => row.paperItemID || row.anchor?.paperItemID)?.paperItemID || sources.find(row => row.anchor?.paperItemID)?.anchor?.paperItemID;
			const paper = paperID ? await Zotero.Items.getAsync(Number(paperID)) : null;
			const displayText = Evidence.numberedCitationText(message);
			const compactTitle = displayText.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, '公式').replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32) || '研究笔记';
			const title = question || compactTitle;
			const note = existingNote && !existingNote.deleted ? existingNote : new Zotero.Item('note');
			if (!existingNote || existingNote.deleted) {
				note.libraryID = paper && !paper.deleted ? paper.libraryID : Zotero.Libraries.userLibraryID;
				if (paper?.isRegularItem() && !paper.deleted) note.parentID = paper.id;
				const citations = await sourceLinks(sources);
				// Store the answer once, with source links. Original source text and
				// annotations remain at their existing locations.
				// Keep the original question once in the note body. Its exact text
				// names the material; a short answer label remains the note heading.
				note.setNote('<h2>' + E.core.escapeHTML(compactTitle) + '</h2>' + (question?'<p><strong>问题</strong></p>'+E.noteContentHTML(question)+'<p><strong>回答</strong></p>':'') + E.noteContentHTML(displayText) + (citations.length ? '<p>来源：' + citations.join(' · ') + '</p>' : ''));
				await note.saveTx({ skipSelect: true });
			}
			// A retry must never rewrite a note that the user has since edited.
			const sourceRecordID = previous?.sourceRecordID || 'research-message:' + (matchedID || stableID);
			const partial = { noteID: note.id, sessionID, messageID: message.id, sourceRecordID };
			try { await persist(stableID, partial); }
			catch (_) { throw Error('笔记已保存；保存关联信息未完成，请重试保存'); }
			const M = E.manuscripts.model;
			// Card previews already render Markdown/LaTeX and clamp visually. Do
			// not slice the stored preview through a formula or expose raw source
			// identifiers. The original answer/anchor remain untouched below.
			const material = M.material({ kind: 'note', category: '用户笔记', title, summary: displayText, sourceText: noteText,
				sourceItemID: note.id, sourceRecordID, sourceType: 'ai-discussion', aiGenerated: true, verification: 'unverified', generationStatus: 'completed', coverage: 'AI 研究讨论；推断与建议需核验',
				anchor: { noteID: note.id, paperItemID: note.parentID || null, sourceText: message.text }, conversationID: sessionID, messageID: message.id,
				sourceRefs: sources.map(row => ({ id: row.stableID || row.id, paperItemID: row.paperItemID || row.anchor?.paperItemID,
					attachmentID: row.attachmentID || row.anchor?.attachmentID, pageIndex: row.pageIndex ?? row.anchor?.pageIndex,
					position: row.position || row.anchor?.position, uri: row.uri || row.anchor?.uri || row.url || row.anchor?.url, coverage: row.coverage })),
			});
			let saved;
			try {
				// Older publishers used different hash inputs for discussion notes.
				// Recover an already-published asset after a partial registry write.
				const existing = Object.values(E.manuscripts.assetLibrary()).find(row => row.sourceItemID === note.id && row.sourceRecordID === sourceRecordID);
				const result = existing ? { cards: [existing] } : await E.manuscripts.publishMaterials([material]);
				if (!result.cards?.[0]?.id) throw Error('没有返回入库素材');
				saved = { ...partial, materialID: result.cards[0].id }; await persist(stableID, saved);
			} catch (_) { throw Error('笔记已保存；素材入库未完成，可在文库打开笔记并重试保存'); }
			E.manuscripts.notifyAssetsChanged?.(); return saved;
		})();
		pending.set(stableID, task);
		}
		let saved;
		try { saved = await task; } finally { if (pending.get(stableID) === task) pending.delete(stableID); }
		await associate(projectID, saved);
		const conversations=E.workbenchConversations,current=conversations?.get(sessionID);
		if(current?.messages?.some(row=>row.id===message.id)&&conversations.update)await conversations.update(sessionID,{messages:[{id:message.id,savedNoteID:saved.noteID,savedMaterialID:saved.materialID}]},{origin:'note'});
		return saved;
	};
})(Zotero.Research);
