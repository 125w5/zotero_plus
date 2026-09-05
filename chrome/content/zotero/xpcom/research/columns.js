/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function (R) {
	R.formatTime = function (value) {
		let date = value instanceof Date ? value : new Date(value);
		if (!Number.isFinite(date.getTime())) return '';
		let pad = n => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
	};
	R.renderColumn = function (tree, index, data, column, doc) {
		let cell = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span');
		cell.className = 'cell ' + column.className;
		cell.style.cssText = 'display:flex;gap:5px;align-items:center;overflow:hidden';
		let item = tree.getRow(index)?.ref;
		if (!item) return cell;
		let metric = R.metrics.get(R.issn(item))?.[0];
		let badge = (text, color = '#81609b') => {
			let node = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span');
			node.textContent = text;
			node.style.cssText = `border-radius:3px;padding:0 5px;white-space:nowrap;color:light-dark(${color},color-mix(in srgb, ${color} 45%, white));background:color-mix(in srgb, ${color} 17%, transparent)`;
			cell.append(node);
		};
		if (column.dataKey === 'research_tags') {
			let colors = Zotero.Tags.getColors(item.libraryID);
			for (let tag of item.getTags()) badge(tag.tag, colors.get(tag.tag)?.color || (/已读|精读/.test(tag.tag) ? '#a78312' : '#81609b'));
			cell.title = item.getTags().map(t => t.tag).join(' · ');
		}
		else if (column.dataKey === 'research_journalTags') {
			if (metric) {
				if (metric.impact_factor != null) badge('IF ' + metric.impact_factor, '#b15c46');
				for (let value of [metric.jcr_quartile, metric.cas_large_category, metric.indexing, metric.ccf]) if (value) badge(value, '#b15c46');
				cell.title = `${metric.metric_year} · ${metric.source} · ${R.formatTime(metric.fetched_at)}`;
			}
		}
		else if (data !== '') {
			let bar = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span');
			bar.style.cssText = `height:3px;background:#68a5a0;flex:0 0 ${Math.min(38, Math.max(3, Number(data)))}px`;
			cell.append(bar, doc.createTextNode(String(data)));
			cell.title = metric ? `${metric.metric_year} · ${metric.source}` : '';
		}
		return cell;
	};
})(Zotero.Research);
