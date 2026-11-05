/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The canvas page is always laid out at A4 width (794 CSS px) and scaled to the canvas,
// as a word processor's page width view: a 14 inch laptop shows the same lines and page
// breaks as a 27 inch monitor, only smaller, with the canvas margins around the page.
export const PAPER_WIDTH = 794;
export function paperFit(available, minimum = .5) {
	if (!(available > 0)) return 1;
	return Math.max(minimum, Math.min(1, Math.floor(available / PAPER_WIDTH * 100) / 100));
}
// The user's Ctrl+wheel zoom is relative to the fitted page.
export function paperScale(ui = {}, fit = 1) {
	return Math.round((ui.paperZoom || 1) * (fit || 1) * 1000) / 1000;
}
