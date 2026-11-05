/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A PDF downloaded into a writing project's folder is split into article sections in the
// background and its section cards join that project's corpus, filed by section
// (corpus-library.mjs). Searching never changes a corpus; only a download or import does.
// The download itself is not delayed, and an indexing or corpus failure is only logged.
(function (E) {
	const running = new Map();
	const projectFor = ({ projectID, collectionID } = {}) => {
		if (projectID) return projectID;
		if (!collectionID) return '';
		let manuscripts = E.manuscripts, all = Object.values((manuscripts?.allView ? manuscripts.allView() : manuscripts?.all?.()) || {});
		return all.find(row => row?.paperCollectionID === collectionID)?.id || '';
	};
	E.corpusIntake = {
		projectFor,
		state: () => [...running.values()],
		afterDownload(result, target = {}) {
			let projectID = projectFor(target), attachmentID = Number(result?.attachmentID), itemID = Number(result?.itemID);
			if (!projectID || !attachmentID || !E.corpus?.prepareProject) return null;
			let key = projectID + ':' + attachmentID;
			if (running.has(key)) return running.get(key).promise;
			let entry = { projectID, attachmentID, itemID, stage: 'index' };
			entry.promise = (async () => {
				try {
					await E.manuscripts?.queueArticle?.(attachmentID);
					entry.stage = 'corpus';
					let ids = [itemID, attachmentID].filter(Boolean);
					entry.result = await E.corpus.prepareProject(projectID, { paperIDs: ids });
					entry.stage = 'done';
					return entry.result;
				}
				catch (error) { entry.stage = 'failed'; Zotero.logError(error); return null; }
				finally { E.setTimeout?.(() => running.delete(key), 60000); }
			})();
			running.set(key, entry);
			return entry.promise;
		}
	};
})(EasySch);
