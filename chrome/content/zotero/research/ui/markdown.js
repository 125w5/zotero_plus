Object.assign(EasySchUI, {
	renderMarkdown(target, markdown) {
		// The renderer has no permission to execute AI HTML or fetch remote images.
		// Protect TeX escapes (e.g. \\{ and \\_) from Markdown's punctuation rules.
		let math = [], prefix = 'EASYMATH' + Math.random().toString(36).slice(2) + 'TOKEN';
		let protectedText = markdown.replace(/\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\\n])+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, value => {
			math.push(value); return prefix + (math.length - 1) + 'END';
		});
		let html = marked.parse(protectedText, { async: false, breaks: true });
		let safe = DOMPurify.sanitize(html, {
			RETURN_DOM_FRAGMENT: true,
			ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
				'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'],
			ALLOWED_ATTR: []
		});
		target.replaceChildren(document.importNode(safe, true));
		let walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT), node;
		while ((node = walker.nextNode())) node.nodeValue = node.nodeValue.replace(new RegExp(prefix + '(\\d+)END', 'g'), (_, index) => math[Number(index)]);
		renderMathInElement(target, { trust: false, throwOnError: false,
			delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
				{ left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }] });
	}
});
