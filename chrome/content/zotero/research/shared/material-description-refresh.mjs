/* SPDX-License-Identifier: AGPL-3.0-or-later */
// When a store commit changed only materialDescriptions (the Chinese 说明 that
// arrive in bursts while papers are indexed), the visible material cards get
// their new name and 说明 in place instead of a full library render.

export function descriptionOnlyChange(branches) {
	let changed = [...(branches || [])];
	return changed.length > 0 && changed.every(key => key === 'materialDescriptions');
}

// Patches the cards materialDisplay drew in summary mode. Returns false when a
// full render is still needed: an unexpected card shape, or a changed selected
// material whose detail pane shows the same text.
export function refreshMaterialDescriptions(list, materialFor, { E, selectedID } = {}) {
	let A = E?.manuscripts, cards = list ? [...list.querySelectorAll('[data-material]')] : [];
	if (!A?.summaryFor || !cards.length) return false;
	let updates = [];
	for (let card of cards) {
		let m = materialFor(card.dataset.material);
		if (!m) return false;
		if (card.dataset.display !== 'summary') return false;
		let heading = card.querySelector('.material-heading'), excerpt = card.querySelector('.material-excerpt');
		if (!heading || !excerpt) return false;
		let name = A.titleFor?.(m) || heading.textContent, summary = A.summaryFor(m), oldName = heading.textContent, oldSummary = excerpt.title || '';
		if (name === oldName && summary === oldSummary) continue;
		if (selectedID && m.id === selectedID) return false;
		updates.push({ card, heading, excerpt, name, summary, oldName, oldSummary });
	}
	for (let { card, heading, excerpt, name, summary, oldName, oldSummary } of updates) {
		heading.textContent = name;
		E.renderContent ? E.renderContent(excerpt, summary) : (excerpt.textContent = summary);
		excerpt.title = summary;
		for (let attribute of ['title', 'aria-label']) {
			let value = card.getAttribute(attribute);
			if (!value) continue;
			if (oldSummary) value = value.replace(oldSummary, summary);
			if (oldName) value = value.replace(oldName, name);
			card.setAttribute(attribute, value);
		}
	}
	return true;
}
