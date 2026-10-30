/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A live preview of a streamed reply for a progress line: the label and the
// tail of the text so far, at most once per `step` new characters. Partial
// model text is shown as in progress only; nothing is saved from it.
// S.request sends '' before a format repair, and a retry streams from the
// start again, so shorter text starts a new preview instead of waiting until
// it outgrows the earlier attempt.
export function streamPreview(show, { step = 40, tail = 60 } = {}) {
	let shown = 0, label = '';
	return (value, nextLabel = label) => {
		let content = String(value || '').replace(/\s+/g, ' ').trim();
		if (nextLabel !== label || content.length < shown) {
			label = nextLabel;
			shown = 0;
		}
		if (!content || content.length - shown < step) return;
		shown = content.length;
		show(label + '…' + content.slice(-tail));
	};
}
