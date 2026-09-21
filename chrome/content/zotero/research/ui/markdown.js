Object.assign(EasySchUI, {
	renderMarkdown(target, markdown) {
		this.E.renderContent(target,markdown);
		// Display only images explicitly imported through the application file picker.
		const images=this.E.store.get().writingImages||{};
		for(const match of markdown.matchAll(/!\[([^\]]*)\]\(<([^>]+)>\)/g)){const entry=images[match[2]];if(!entry)continue;const figure=this.el('figure'),image=this.el('img');image.src=entry.uri;image.alt=match[1];image.style.cssText='max-width:100%;height:auto';figure.append(image,this.el('figcaption',match[1]));target.append(figure);}
	}
});
