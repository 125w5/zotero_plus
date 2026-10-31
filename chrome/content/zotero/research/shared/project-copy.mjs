/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 复制项目: a stored signature that is current for the original is recomputed
// for the copy with the functions the runtime compares with; a stale one is
// left as copied. Reads source, writes only target.
// source/target: {project, notebook, readings, taskPlan}.
import { threadContext, chapterBasis, threadDigest } from './research-thread.mjs';
import { DIRECTION_VERSION, directionThreadSignature, directionSignature, assertDraftBatchCurrent } from './assembly-direction.mjs';
import { frameworkStructure, frameworkUnitSignature, frameworkReviewSignature } from './writing-framework.mjs';
import { projectTaskBasis } from './manuscript-assessment.mjs';
import { captureWritingPreview } from './assembly-writing-preview.mjs';

let attempt = (fn) => {
	try {
		return fn();
	}
	catch {
		return undefined;
	}
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
	return report;
}
