/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 复制项目: a stored signature that is current for the original is recomputed
// for the copy with the functions the runtime compares with; a stale one is
// left as copied. Reads source, writes only target.
// source/target: {project, notebook, readings, taskPlan}.
import { threadContext, chapterBasis, threadDigest } from './research-thread.mjs';
import { DIRECTION_VERSION, directionThreadSignature, directionSignature, assertDraftBatchCurrent } from './assembly-direction.mjs';
import { frameworkStructure, frameworkUnitSignature, frameworkReviewSignature } from './writing-framework.mjs';
import { projectTaskBasis } from './manuscript-assessment.mjs';
import { captureWritingPreview, assertWritingPreviewCurrent } from './assembly-writing-preview.mjs';
import { layoutSnapshot, applyLayoutProposal } from './manuscript-layout.mjs';
import { selectionContextVersion, assertSelectionTargetCurrent } from '../manuscript/selection-target.mjs';

let attempt = (fn) => {
	try {
		return fn();
	}
	catch {
		return undefined;
	}
};
let passes = (fn) => {
	try {
		fn();
		return true;
	}
	catch {
		return false;
	}
};

// One record of p.proposals, as copied (row) and as the original stores it
// (old). Returns its replacement in the copy, or undefined to keep row as
// copied. A record the editor still acts on names the project: a pending one
// moves to the copy, so a stale one shows the original's message there, and
// the hash it stores is recomputed only where it is current for the original;
// the result must pass the same check in the copy. An adopted selection edit
// moves to the copy, so 撤回修改 works there; an adopted rewrite does not name it.
let restampProposal = (source, target, old, row) => {
	let p0 = source.project, p1 = target.project, next = JSON.parse(JSON.stringify(row));
	if (row.kind === 'assembly-writing-preview') {
		// A version 1 candidate keeps a fingerprint that is not recomputed here.
		if (row.status !== 'pending' || row.capture?.projectID !== p0.id || row.capture.version === 1) return undefined;
		next.capture.projectID = p1.id;
		if (!passes(() => assertWritingPreviewCurrent(p0, old.capture))) return next;
		let fresh = captureWritingPreview(p1, { blockID: row.capture.blockID, sectionID: row.capture.sectionID, instruction: row.capture.instruction });
		Object.assign(next.capture, { title: fresh.title, fingerprint: fresh.fingerprint });
		assertWritingPreviewCurrent(p1, next.capture);
		return next;
	}
	if (row.kind === 'layout') {
		if (row.status !== 'pending' || row.projectID !== p0.id) return undefined;
		next.projectID = p1.id;
		if (!passes(() => applyLayoutProposal(p0, old))) return next;
		next.documentSnapshot = layoutSnapshot(p1);
		applyLayoutProposal(p1, next);
		return next;
	}
	if (row.kind === 'assembly-selection-preview') {
		if (!['pending', 'accepted'].includes(row.status) || row.target?.projectID !== p0.id) return undefined;
		next.target.projectID = p1.id;
		// The chapter reads, as the editor passes them (readingOptions), decide
		// the context of a read point and of a chapter with a writing plan.
		if (row.status !== 'pending' || !passes(() => assertSelectionTargetCurrent(p0, old.target, { readings: source.readings }))) return next;
		next.target.contextVersion = selectionContextVersion(p1, next.target, { readings: target.readings });
		assertSelectionTargetCurrent(p1, next.target, { readings: target.readings });
		return next;
	}
	return undefined;
};

export function restampProjectCopy(source, target) {
	let report = { restamped: [], failed: [] }, p0 = source.project, p1 = target.project, d0 = p0.directionDiscussion, d1 = p1.directionDiscussion;
	let step = (name, fn) => {
		try {
			if (fn()) report.restamped.push(name);
		}
		catch (error) {
			report.failed.push(name + ': ' + error.message);
		}
	};
	step('direction', () => {
		if (!d1 || !(d0?.version >= DIRECTION_VERSION) || !Array.isArray(d0.questions)) return false;
		if (d0.threadSignature !== directionThreadSignature(p0, threadContext(p0), d0.questions)) return false;
		d1.threadSignature = directionThreadSignature(p1, threadContext(p1), d1.questions);
		return true;
	});
	step('direction-legacy', () => {
		if (!d1 || d0?.signature !== directionSignature(p0)) return false;
		d1.signature = directionSignature(p1);
		return true;
	});
	// Per part. corpusRows [] on both sides: no corpus id is remapped, so the
	// corpus part keeps its saved value.
	step('reads', () => {
		let chapters = target.readings?.chapters, touched = false;
		if (!chapters) return false;
		let t0 = threadContext(p0, source.notebook), t1 = threadContext(p1, target.notebook);
		for (let [sectionID, read] of Object.entries(chapters)) {
			let saved = source.readings.chapters?.[sectionID]?.basis;
			if (!saved?.digests || !read?.basis?.digests) continue;
			let b0 = attempt(() => chapterBasis(p0, source.notebook, sectionID, { thread: t0, corpusRows: [] }));
			let b1 = attempt(() => chapterBasis(p1, target.notebook, sectionID, { thread: t1, corpusRows: [] }));
			if (!b0 || !b1) continue;
			let changed = false;
			for (let key of Object.keys(b1.digests)) {
				if (saved.digests[key] !== b0.digests[key] || b0.digests[key] === b1.digests[key]) continue;
				read.basis.digests[key] = b1.digests[key];
				changed = true;
			}
			if (changed) {
				read.basis.hash = threadDigest(read.basis.digests);
				touched = true;
			}
		}
		return touched;
	});
	// After reads: readsDigest hashes each read's basis.hash.
	step('taskPlan', () => {
		let saved = source.taskPlan?.basis, plan = target.taskPlan, touched = false;
		if (!saved || !plan?.basis) return false;
		let b0 = projectTaskBasis(p0, source.notebook, source.readings), b1 = projectTaskBasis(p1, target.notebook, target.readings);
		for (let key of Object.keys(b1)) {
			if (saved[key] !== b0[key] || b0[key] === b1[key]) continue;
			plan.basis[key] = b1[key];
			touched = true;
		}
		return touched;
	});
	// Stored dirty flags are copied as they are.
	step('frameworks', () => {
		let touched = false;
		for (let [sectionID, frame] of Object.entries(p1.writingFrameworks || {})) {
			let old = p0.writingFrameworks?.[sectionID];
			if (!old || !Array.isArray(frame?.nodes)) continue;
			if (old.structureSignature && old.structureSignature === frameworkStructure(p0, sectionID)) {
				frame.structureSignature = frameworkStructure(p1, sectionID);
				touched = true;
			}
			for (let [index, node] of frame.nodes.entries()) {
				let previous = old.nodes?.[index];
				for (let [n0, n1] of [[previous, node], [previous?.pendingUpdate, node?.pendingUpdate]]) {
					if (!n0?.sourceSignature || !n1 || n0.sourceSignature !== frameworkUnitSignature(p0, sectionID, n0)) continue;
					n1.sourceSignature = frameworkUnitSignature(p1, sectionID, n1);
					touched = true;
				}
			}
		}
		return touched;
	});
	step('review', () => {
		let review = p1.writingDigestReview;
		if (!review || p0.writingDigestReview?.signature !== frameworkReviewSignature(p0)) return false;
		review.signature = frameworkReviewSignature(p1);
		return true;
	});
	// A pending batch is restamped only if it is current for the original, and
	// replaces the copy's batch only if the result passes the same check. A batch
	// that is already stale in the original stays stale, like every other step.
	step('draftBatch', () => {
		let b0 = p0.draftBatch, b1 = p1.draftBatch;
		if (!b1 || b0?.projectID !== p0.id) return false;
		if (b1.status === 'accepted') {
			b1.projectID = p1.id;
			return true;
		}
		if (b1.status !== 'pending') return false;
		try {
			assertDraftBatchCurrent(p0, b0);
		}
		catch {
			return false;
		}
		let next = JSON.parse(JSON.stringify(b1)), prints = new Map();
		let recapture = row => captureWritingPreview(p1, { blockID: row.blockID, sectionID: row.sectionID, instruction: row.instruction ?? next.instruction });
		Object.assign(next, { projectID: p1.id, signature: directionSignature(p1) });
		for (let preview of next.previews) {
			let fresh = recapture(preview.capture);
			prints.set(preview.capture.fingerprint, fresh.fingerprint);
			Object.assign(preview.capture, { projectID: fresh.projectID, title: fresh.title, fingerprint: fresh.fingerprint });
		}
		for (let gap of next.gaps || []) {
			if (gap.code !== 'WRITING_EVIDENCE_GAP') continue;
			let fresh = recapture(gap);
			prints.set(gap.fingerprint, fresh.fingerprint);
			gap.fingerprint = fresh.fingerprint;
		}
		for (let row of next.targetManifest) row.fingerprint = prints.get(row.fingerprint) ?? row.fingerprint;
		assertDraftBatchCurrent(p1, next);
		p1.draftBatch = next;
		return true;
	});
	// Last, on the copy as the steps above leave it, which is what the editor
	// checks. Rows pair by index (remap keeps the order) and by id; a row that
	// fails is reported and kept as copied, and the other rows go on.
	step('proposals', () => {
		let rows = p1.proposals, touched = false;
		if (!Array.isArray(rows)) return false;
		for (let [index, row] of rows.entries()) {
			let old = p0.proposals?.[index];
			if (!row || !old || old.id !== row.id || old.kind !== row.kind) continue;
			try {
				let next = restampProposal(source, target, old, row);
				if (!next) continue;
				rows[index] = next;
				touched = true;
			}
			catch (error) {
				report.failed.push('proposals ' + row.id + ': ' + error.message);
			}
		}
		return touched;
	});
	return report;
}
