/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2024 Corporation for Digital Scholarship
					 Vienna, Virginia, USA
					 https://www.zotero.org
	
	This file is part of Zotero.
	
	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
	
	***** END LICENSE BLOCK *****
*/

{
	const { ItemPaneContainerBase } = ChromeUtils.importESModule(
		"chrome://zotero/content/elements/itemPaneContainerBase.mjs",
		{ global: "current" }
	);
	const ResearchNavigation = ChromeUtils.importESModule(
		"chrome://zotero/content/research/shared/reader-navigation.mjs"
	);

	class ItemDetails extends ItemPaneContainerBase {
		content = MozXULElement.parseXULToFragment(`
			<hbox id="zotero-view-item-container" class="zotero-view-item-container" flex="1">
				<html:div class="zotero-view-item-main">
					<item-pane-header id="zotero-item-pane-header" />
					
					<html:div id="zotero-view-item" class="zotero-view-item" tabindex="0" data-l10n-id="item-details-pane">
						<info-box id="zotero-editpane-info-box" data-pane="info"/>
						
						<abstract-box id="zotero-editpane-abstract" class="zotero-editpane-abstract" data-pane="abstract"/>

						<attachments-box id="zotero-editpane-attachments" data-pane="attachments"/>

						<notes-box id="zotero-editpane-notes" class="zotero-editpane-notes" data-pane="notes"/>

						<note-box id="zotero-note-box" data-pane="note-info" hidden="true"/>

						<attachment-box id="zotero-attachment-box" data-pane="attachment-info" data-use-preview="true" hidden="true"/>
						
						<attachment-annotations-box id="zotero-editpane-attachment-annotations" data-pane="attachment-annotations" hidden="true"/>
						
						<libraries-collections-box id="zotero-editpane-libraries-collections" class="zotero-editpane-libraries-collections" data-pane="libraries-collections"/>

						<tags-box id="zotero-editpane-tags" class="zotero-editpane-tags" data-pane="tags"/>

						<related-box id="zotero-editpane-related" class="zotero-editpane-related" data-pane="related"/>
					</html:div>
				</html:div>
			</hbox>
		`);

		get item() {
			return this._item;
		}

		set item(item) {
			this._item = item;
		}

		get extraItems() {
			return this._extraItems ?? [];
		}

		set extraItems(val) {
			if (!Array.isArray(val)) {
				return;
			}

			this._extraItems = val.filter(item => item instanceof Zotero.Item && item.isRegularItem());
		}

		/*
		 * For contextPane update
		 */
		get parentID() {
			return this._cachedParentID;
		}

		set parentID(parentID) {
			this._cachedParentID = parentID;
		}

		get editable() {
			return this._editable;
		}

		set editable(editable) {
			this._editable = editable;
			this.toggleAttribute('readonly', !editable);
		}

		get tabID() {
			return this._tabID;
		}
	
		set tabID(tabID) {
			this._tabID = tabID;
		}

		get collectionTreeRows() {
			return this._collectionTreeRows;
		}
		
		set collectionTreeRows(collectionTreeRows) {
			this._collectionTreeRows = collectionTreeRows;
		}

		get supportsPinning() {
			return !this.researchPaperNavigation;
		}

		get supportsReorder() {
			return !this.researchPaperNavigation;
		}

		get researchPaperNavigation() {
			return !!this.item && (this.item.isRegularItem() || this.item.isPDFAttachment())
				&& !!this.getCustomPanes().find(pane => ResearchNavigation.researchPaneKind(pane.dataset.pane) === 'overview');
		}

		get researchActivePane() {
			if (!this.researchPaperNavigation) return null;
			if (this.sidenav?._contextNotesPaneVisible) return 'context-notes';
			return ResearchNavigation.resolvePaperPaneID(
				this.getPanes().map(pane => pane.dataset.pane), this._researchActivePane || 'info'
			);
		}

		_isResearchPaneSelected(pane) {
			return !this.researchPaperNavigation || pane.classList.contains('paper-metadata-editor')
				|| pane.dataset.pane === this.researchActivePane;
		}

		_syncResearchPaneSelection() {
			const paper = this.researchPaperNavigation;
			let active = this.researchActivePane;
			if (paper && active !== 'context-notes' && !this.getEnabledPane(active)) {
				this._researchActivePane = ResearchNavigation.resolvePaperPaneID(
					this.getPanes().map(pane => pane.dataset.pane), 'info'
				);
				active = this.researchActivePane;
			}
			for (const pane of this.getPanes()) {
				const section = pane._section || pane.querySelector('collapsible-section');
				if (!paper) {
					delete pane.dataset.easyschSelected;
					if (section && pane._researchSectionState) {
						const prior = pane._researchSectionState;
						if (prior.noCollapse === null) section.removeAttribute('no-collapse');
						else section.setAttribute('no-collapse', prior.noCollapse);
						section.toggleAttribute('open', prior.open);
						section.style.setProperty('--open-height', 'auto');
						pane._researchSectionState = null;
					}
					continue;
				}
				pane.dataset.easyschSelected = String(pane.dataset.pane === active);
				if (section && pane.dataset.easyschSelected === 'true') {
					pane._researchSectionState ||= { noCollapse: section.getAttribute('no-collapse'), open: section.hasAttribute('open') };
					// Opening a feature is transient display state, not an accordion
					// preference. Leave native preferences and source nodes intact.
					section.setAttribute('no-collapse', 'true');
					section.toggleAttribute('open', true);
					section.style.setProperty('--open-height', 'auto');
				}
			}
			if (paper) {
				this.dataset.easyschActivePane = active || '';
				if (ResearchNavigation.researchPaneKind(active) !== 'workstation') this.classList.remove('academic-focus');
				this._paneParent.style.paddingBottom = '';
				this._minScrollHeight = 0;
			}
			else delete this.dataset.easyschActivePane;
		}

		async selectResearchPane(id, { focus = false } = {}) {
			if (!this.researchPaperNavigation) return super.scrollToPane(id, 'instant');
			this._closeResearchMetadataEditor?.();
			if (id === 'context-notes' && this.sidenav?.contextNotesPaneEnabled && this.sidenav.contextNotesPane) {
				this.dispatchEvent(new CustomEvent('easysch-research-pane-changing', {
					bubbles: true, detail: { paneID: 'context-notes' }
				}));
				this.sidenav._contextNotesPaneVisible = true;
				this._syncResearchPaneSelection();
				return this.sidenav.contextNotesPane;
			}
			const paneID = ResearchNavigation.resolvePaperPaneID(this.getPanes().map(pane => pane.dataset.pane), id);
			const pane = paneID && this.getEnabledPane(paneID);
			if (!pane || !this.isPaneInSidenav(paneID) && ResearchNavigation.researchPaneKind(paneID) !== 'overview') return null;
			// Scoped features restore borrowed native UI before the new pane is
			// selected or rendered, including programmatic navigation.
			this.dispatchEvent(new CustomEvent('easysch-research-pane-changing', {
				bubbles: true, detail: { paneID }
			}));
			const request = this._researchPaneRequest = (this._researchPaneRequest || 0) + 1;
			this._researchActivePane = paneID;
			if (this.sidenav?._contextNotesPaneVisible) this.sidenav._contextNotesPaneVisible = false;
			this._collapsed = false;
			this._syncResearchPaneSelection();
			this._paneParent.scrollTo(0, 0);
			this.sidenav?.render();
			pane.render?.();
			if (pane.asyncRender) await pane.asyncRender();
			if (request !== this._researchPaneRequest || this.researchActivePane !== paneID) return null;
			this._syncResearchPaneSelection();
			if (ResearchNavigation.researchPaneKind(paneID) === 'workstation') pane.querySelector('.academic-chat')?._expand?.();
			this._paneParent.scrollTo(0, 0);
			if (focus) pane.focus();
			return pane;
		}

		async scrollToPane(id, behavior = 'smooth') {
			if (this.researchPaperNavigation) return !!await this.selectResearchPane(id);
			return super.scrollToPane(id, behavior);
		}

		getEnabledPane(id) {
			const pane = super.getEnabledPane(id);
			return pane?.dataset.easyschMetadata === 'hidden' ? null : pane;
		}

		getEnabledPanes() {
			return super.getEnabledPanes().filter(pane => pane.dataset.easyschMetadata !== 'hidden');
		}

		isPaneInSidenav(id) {
			return !this.researchPaperNavigation || ResearchNavigation.paperRailPaneVisible(
				id, !!this.sidenav?.contextNotesPane && this.sidenav.contextNotesPaneEnabled
			);
		}

		_syncResearchNavigation() {
			const paper = this.researchPaperNavigation;
			if (!paper || this._researchMetadataItem !== this.item?.id) {
				this._closeResearchMetadataEditor?.({ sync: false, restoreFocus: false });
			}
			if (paper) this.dataset.easyschNavigation = 'paper';
			else delete this.dataset.easyschNavigation;
			if (this._researchMetadataItem !== this.item?.id) {
				this._researchMetadataItem = this.item?.id;
				this._researchMetadataPane = null;
			}
			for (const id of [...ResearchNavigation.metadataPaneIDs, 'info', ...ResearchNavigation.paperHiddenPaneIDs]) {
				const pane = this.getPane(id);
				if (!pane) continue;
				if (paper) pane.dataset.easyschMetadata = this._researchMetadataPane === id ? 'shown' : 'hidden';
				else delete pane.dataset.easyschMetadata;
			}
			this._syncResearchPaneSelection();
			const info = this.getPane('info');
			let advanced = info?.querySelector('.research-metadata-details');
			if (!paper) {
				const edit = advanced?.querySelector('.research-fields-toggle');
				if (edit) info.querySelector('collapsible-section > .head')?.append(edit);
				advanced?.remove();
				return;
			}
			if (!advanced && info) {
				const ns = 'http://www.w3.org/1999/xhtml';
				advanced = document.createElementNS(ns, 'details');
				advanced.className = 'research-metadata-details section-custom-button';
				const summary = document.createElementNS(ns, 'summary');
				summary.textContent = '⋯';
				summary.title = '更多信息';
				summary.setAttribute('aria-label', '更多信息');
				const menu = document.createElementNS(ns, 'div');
				menu.className = 'research-metadata-menu';
				const edit = info.querySelector('.research-fields-toggle');
				if (edit) {
					edit.addEventListener('click', () => { advanced.open = false; });
					menu.append(edit);
				}
				for (const [id, label] of [['libraries-collections', '文库归属'], ['tags', '标签'], ['related', '关联文献']]) {
					const button = document.createElementNS(ns, 'button');
					button.type = 'button';
					button.textContent = label;
					button.dataset.metadataPane = id;
					button.addEventListener('click', async () => {
						advanced.open = false;
						await this.showResearchPaperMetadata(id);
					});
					menu.append(button);
				}
				advanced.append(summary, menu);
				advanced.addEventListener('focusout', event => {
					if (event.relatedTarget && !advanced.contains(event.relatedTarget)) advanced.open = false;
				});
				advanced.addEventListener('keydown', event => {
					if (event.key === 'Escape' && !event.isComposing) {
						advanced.open = false;
						summary.focus();
						event.preventDefault();
					}
					if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
						advanced.open = true;
						const buttons = [...menu.querySelectorAll('button:not([disabled])')];
						const at = buttons.indexOf(document.activeElement);
						buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
						event.preventDefault();
					}
				});
				// Keep the title's native collapse handler from consuming this menu.
				for (const type of ['mousedown', 'click', 'keydown']) advanced.addEventListener(type, event => event.stopPropagation());
				info.querySelector('collapsible-section > .head')?.append(advanced);
			}
			for (const button of advanced?.querySelectorAll('[data-metadata-pane]') || []) {
				button.disabled = !this.getPane(button.dataset.metadataPane) || !!this.getPane(button.dataset.metadataPane).hidden;
			}
		}

		async showResearchPaperMetadata(id = 'info') {
			if (!this.researchPaperNavigation) return;
			if (id === 'attachments') return;
			this._closeResearchMetadataEditor?.({ sync: false, restoreFocus: false });
			this._researchMetadataPane = id;
			this._syncResearchNavigation();
			const pane = this.getEnabledPane(id);
			if (!pane) return;
			pane.open = true;
			await pane.render?.();
			const doc = this.ownerDocument, win = doc.defaultView;
			const backdrop = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
			backdrop.className = 'paper-metadata-backdrop';
			const closeButton = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
			closeButton.type = 'button'; closeButton.className = 'paper-metadata-close'; closeButton.textContent = '×';
			closeButton.title = '关闭信息编辑'; closeButton.setAttribute('aria-label', closeButton.title);
			const prior = { role: pane.getAttribute('role'), modal: pane.getAttribute('aria-modal'), label: pane.getAttribute('aria-label') };
			const returnFocus = doc.activeElement;
			pane.classList.add('paper-metadata-editor'); pane.setAttribute('role', 'dialog'); pane.setAttribute('aria-modal', 'true');
			pane.setAttribute('aria-label', id === 'info' ? '编辑论文信息' : '编辑来源信息');
			pane.append(closeButton); doc.documentElement.append(backdrop);
			const keydown = event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close(); } };
			const close = ({ sync = true, restoreFocus = true } = {}) => {
				if (this._closeResearchMetadataEditor !== close) return;
				this._closeResearchMetadataEditor = null;
				if (pane.contains(doc.activeElement)) doc.activeElement.blur?.();
				win.removeEventListener('keydown', keydown, true); backdrop.remove(); closeButton.remove();
				pane.classList.remove('paper-metadata-editor');
				for (const [attribute, value] of [['role', prior.role], ['aria-modal', prior.modal], ['aria-label', prior.label]]) {
					if (value === null) pane.removeAttribute(attribute); else pane.setAttribute(attribute, value);
				}
				this._researchMetadataPane = null;
				if (sync && this.isConnected) this._syncResearchNavigation();
				if (restoreFocus && returnFocus?.isConnected) returnFocus.focus?.();
			};
			this._closeResearchMetadataEditor = close;
			backdrop.onclick = () => close(); closeButton.onclick = () => close(); win.addEventListener('keydown', keydown, true);
			closeButton.focus();
		}

		get pinnedPane() {
			return this.getAttribute('pinnedPane');
		}
		
		set pinnedPane(val) {
			if (val && !this.getEnabledPane(val)) {
				// Store pinned pane because custom sections may not be ready yet
				this._pendingPinnedPane = val;
				val = '';
			}
			this.setAttribute('pinnedPane', val || '');
			if (val) {
				this._pendingPinnedPane = '';
				this._pinnedPaneMinScrollHeight = this._getMinScrollHeightForPane(this.getEnabledPane(val));
			}
			this.sidenav.updatePaneStatus(val);
			this._savePinnedPane();
		}

		get sidenav() {
			return super.sidenav;
		}

		set sidenav(sidenav) {
			super.sidenav = sidenav;
			// Manually update once and further changes will be synced automatically to sidenav
			this.forceUpdateSideNav();
		}

		get skipRender() {
			return this._skipRender;
		}

		set skipRender(val) {
			this._skipRender = val;
			let panes = this.getPanes();
			for (let pane of [this._header, ...panes]) {
				pane.skipRender = val;
			}
		}

		static get observedAttributes() {
			return ['pinnedPane'];
		}

		init() {
			this._container = this.querySelector('#zotero-view-item-container');
			this._header = this.querySelector('#zotero-item-pane-header');
			this._paneParent = this.querySelector('#zotero-view-item');

			this._container.addEventListener("keydown", this._handleKeydown);
			this._paneParent.addEventListener('scroll', this._handleContainerScroll);

			this._paneHiddenOb = new MutationObserver(this._handlePaneStatus);
			this._paneHiddenOb.observe(this._paneParent, {
				attributes: true,
				attributeFilter: ["hidden"],
				subtree: true,
			});
			this._initIntersectionObserver();

			this._notifierID = Zotero.Notifier.registerObserver(
				this, ['item', 'itempane', 'tab'], 'ItemDetails');
			this._prefsObserverID = Zotero.Prefs.registerObserver('pinnedPane', this._restorePinnedPane.bind(this));

			this._disableScrollHandler = false;
			this._pinnedPaneMinScrollHeight = 0;

			this._lastUpdateCustomSection = "";

			this._lastScrollTop = 0;
			this._lastScrollPaneID = '';

			// If true, will render on tab select
			this._pendingRender = false;
			// If true, will skip render
			this._skipRender = false;
		}

		destroy() {
			this._closeResearchMetadataEditor?.({ sync: false, restoreFocus: false });
			this._container.removeEventListener("keydown", this._handleKeydown);
			this._paneParent.removeEventListener('scroll', this._handleContainerScroll);

			this._paneHiddenOb.disconnect();
			this._intersectionOb.disconnect();

			Zotero.Notifier.unregisterObserver(this._notifierID);
			Zotero.Prefs.unregisterObserver(this._prefsObserverID);
		}

		async render() {
			if (!this.initialized || !this.item) {
				return;
			}

			if (this.skipRender) {
				this._pendingRender = true;
				return;
			}
			this._pendingRender = false;

			let item = this.item;
			Zotero.debug('Viewing item');
			this._isRendering = true;
			// For tests
			let resolve;
			if (Zotero.test) {
				this._renderPromise = new Promise(r => resolve = r);
			}

			this.renderCustomSections();
			this._syncResearchNavigation();
			// A single policy controls both the content and the rail. Re-applying a
			// stale native preference after a click must not move evidence sections.
			this.initPaneOrder(this.sidenav?.getPersistedOrder() || []);
			this._restorePinnedPane();

			let panes = this.getPanes();

			// Unobserve intersection to prevent unwanted rendering.
			// Checking flags in _handleIntersection is not reliable because it's async.
			this._toggleIntersectionObserver(false);

			let collapsed = this._collapsed;

			for (let box of [this._header, ...panes]) {
				box.editable = this.editable;
				box.tabID = this.tabID;
				box.tabType = this.tabType;
				box.item = item;
				box.extraItems = this.extraItems;
				box.collectionTreeRows = this.collectionTreeRows;
				if (this.extraItems.length > 0) {
					// mark everything, except the header and the info pane, as hidden
					box.hidden = box.dataset.pane !== 'info' && box !== this._header;
				}
				// Discard hidden panes
				if (box.hidden && box.discard) {
					box.discard();
				}
				// Execute sync render immediately
				if (!collapsed && !box.hidden && box.dataset.easyschMetadata !== 'hidden' && this._isResearchPaneSelected(box) && box.render) {
					box.render();
				}
			}
			this._syncResearchNavigation();
			this.sidenav?.render();

			if (!collapsed) {
				let scrollPaneElem = this.getEnabledPane(this._lastScrollPaneID);
				// If the last scroll pane is not found, try the pinned pane
				if (!scrollPaneElem) {
					scrollPaneElem = this.getEnabledPane(this.pinnedPane);
				}

				let scrollPaneIndex = panes.indexOf(scrollPaneElem);
				
				this._paneParent.style.paddingBottom = '';

				if (scrollPaneIndex > -1) {
					let paneID = scrollPaneElem.dataset.pane;
					await this.scrollToPane(paneID, 'instant');
					this._lastScrollPaneID = '';
				}
				else {
					// Keep the scroll position after reordering
					this._paneParent.scrollTo(0, this._lastScrollTop);
					this._lastScrollTop = 0;
				}

				// Only execute async render for visible panes
				for (let box of panes) {
					if (!box.asyncRender) {
						continue;
					}
					if (scrollPaneIndex > -1 && panes.indexOf(box) < scrollPaneIndex) {
						continue;
					}
					if (!this.isPaneVisible(box.dataset.pane)) {
						continue;
					}
					await this._waitNoLongerThan(box.asyncRender(), 500);
					// Make sure the layout is updated for next isPaneVisible check
					await this._waitDOMUpdate();
				}
			}

			if (this.item.id == item.id) {
				this._isRendering = false;
			}

			// Re-enable intersection observer
			this._toggleIntersectionObserver(true);

			if (Zotero.test) {
				resolve();
			}
		}

		renderCustomSections() {
			let { options: targetPanes, updateID } = Zotero.ItemPaneManager.customSectionData;
			if (this._lastUpdateCustomSection == updateID) return;
			this._lastUpdateCustomSection = updateID;

			let currentPaneElements = this.getCustomPanes();
			// Remove
			for (let elem of currentPaneElements) {
				let elemPaneID = elem.dataset.pane;
				if (targetPanes.find(pane => pane.paneID == elemPaneID)) continue;
				this._intersectionOb.unobserve(elem);
				elem.remove();
				this.sidenav.removePane(elemPaneID);
			}
			// Create
			let currentPaneIDs = currentPaneElements.map(elem => elem.dataset.pane);
			for (let section of targetPanes) {
				let { paneID, header, sidenav, bodyXHTML,
					onInit, onDestroy, onItemChange, onRender, onAsyncRender, onToggle,
					sectionButtons } = section;
				if (currentPaneIDs.includes(paneID)) continue;
				let elem = document.createXULElement("item-pane-custom-section");
				elem.dataset.sidenavOptions = JSON.stringify(sidenav || {});
				elem.paneID = paneID;
				elem.bodyXHTML = bodyXHTML;
				elem.registerSectionIcon({ icon: header.icon, darkIcon: header.darkIcon });
				elem.registerHook({ type: "init", callback: onInit });
				elem.registerHook({ type: "destroy", callback: onDestroy });
				elem.registerHook({ type: "itemChange", callback: onItemChange });
				elem.registerHook({ type: "render", callback: onRender });
				elem.registerHook({ type: "asyncRender", callback: onAsyncRender });
				elem.registerHook({ type: "toggle", callback: onToggle });
				if (sectionButtons) {
					for (let buttonOptions of sectionButtons) {
						elem.registerSectionButton(buttonOptions);
					}
				}
				if (this._pendingRender) {
					elem.pendingRender = true;
				}
				this._paneParent.append(elem);
				elem.setL10nID(header.l10nID);
				elem.setL10nArgs(header.l10nArgs);
				this._intersectionOb.observe(elem);
				this.sidenav.addPane(paneID);
				this.sidenav.updatePaneStatus(paneID);
			}
			// Update pending pinned pane
			if (this._pendingPinnedPane && this.getEnabledPane(this._pendingPinnedPane)) {
				this.pinnedPane = this._pendingPinnedPane;
			}

			if (this.sidenav) {
				this.initPaneOrder(this.sidenav.getPersistedOrder());
			}
		}

		renderCustomHead(callback) {
			this._header.renderCustomHead(callback);
		}

		notify = async (action, type, ids, _extraData) => {
			if (action == 'refresh' && this.item) {
				if (type == 'itempane') {
					this.renderCustomSections();
				}
				// Keep the scroll position after refresh
				this._lastScrollTop = this._paneParent.scrollTop;
				await this.render();
			}

			if (action == 'select' && type == 'tab') {
				this._handleTabSelect(ids);
			}
		};

		getVisiblePanes() {
			let panes = this.getPanes();
			let visiblePanes = [];
			for (let paneElem of panes) {
				if (this.isPaneVisible(paneElem.dataset.pane)) {
					visiblePanes.push(paneElem);
				}
				else if (visiblePanes.length > 0) {
					// Early stop at first invisible pane after some visible panes
					break;
				}
			}
			return visiblePanes;
		}

		getCustomPanes() {
			return Array.from(this._paneParent.querySelectorAll(':scope > item-pane-custom-section[data-pane]'));
		}

		isPaneVisible(paneID) {
			let paneElem = this.getEnabledPane(paneID);
			if (!paneElem) return false;
			if (!this._isResearchPaneSelected(paneElem)) return false;
			let paneRect = paneElem.getBoundingClientRect();
			let containerRect = this._paneParent.getBoundingClientRect();
			if (paneRect.top >= containerRect.bottom || paneRect.bottom <= containerRect.top) {
				return false;
			}
			return true;
		}

		forceUpdateSideNav() {
			this.getPanes().forEach(elem => this._sidenav.updatePaneStatus(elem.dataset.pane));
		}

		initPaneOrder(order) {
			let panes = this.getPanes();
			let paneIDs = panes.map(elem => elem.dataset.pane);
			if (this.researchPaperNavigation) order = ResearchNavigation.paperPaneOrder(paneIDs);

			// Compare the order of paneIDs with the given order
			let isOrderDifferent = false;
			let lastOrderIdx = -1;
			for (let paneID of paneIDs) {
				let idx = order.indexOf(paneID);
				if (idx == -1) {
					continue;
				}
				if (idx < lastOrderIdx) {
					isOrderDifferent = true;
					break;
				}
				lastOrderIdx = idx;
			}

			if (!isOrderDifferent) {
				return;
			}

			// Rearrange panes according to the given order. Unordered panes will stay at the end
			for (let i = order.length - 1; i >= 0; i--) {
				let paneID = order[i];
				let idx = paneIDs.indexOf(paneID);
				if (idx == -1) {
					continue;
				}
				this._paneParent.prepend(panes[idx]);
			}
		}

		/**
		 * Change the order of panes
		 * @param {string} paneID
		 * @param {number} newIdx
		 * @param {Object} options
		 * @param {boolean} options.render - Whether to rerender panes after reordering
		 */
		async changePaneOrder(paneID, newIdx, options = {}) {
			if (!this.supportsReorder) return;
			let panes = this.getPanes();
			let paneIDs = panes.map(elem => elem.dataset.pane);
			let currentIndex = paneIDs.indexOf(paneID);
			if (currentIndex == -1) return;
			if (currentIndex == newIdx || currentIndex == newIdx - 1) return;
			let currentPane = panes[currentIndex];
			if (newIdx < panes.length) {
				this._paneParent.insertBefore(currentPane, panes[newIdx]);
			}
			else {
				this._paneParent.appendChild(currentPane);
			}

			// Rerender panes after reordering
			if (options.render !== false) {
				this._lastScrollTop = this._paneParent.scrollTop;
				await this.render();
			}
		}

		_beforeScrollToPane(_pane) {
			// Suspend the intersection observer for the duration of the scroll so
			// the pane we're scrolling toward (and any panes that swing through
			// the viewport on the way) don't trigger lazy renders mid-flight.
			this._toggleIntersectionObserver(false);
		}

		async _afterScrollToPane(_pane, panes, paneIndex) {
			// After the scroll settles, async-render the pane we landed on and
			// any visible panes below it, then re-enable the intersection observer
			for (let i = paneIndex; i < panes.length; i++) {
				let nextPane = panes[i];
				// Stop at the first pane no longer in view
				if (!this.isPaneVisible(nextPane.dataset.pane)) {
					break;
				}
				if (nextPane.asyncRender) {
					await nextPane.asyncRender();
					// Wait for the next DOM update to make sure the layout is updated
					await this._waitDOMUpdate();
				}
			}
			this._toggleIntersectionObserver(true);
		}

		async blurOpenField() {
			let panes = [this._header, ...this.getPanes()];
			for (let pane of panes) {
				if (pane.blurOpenField && pane.contains(document.activeElement)) {
					await pane.blurOpenField();
					break;
				}
			}
			this._paneParent.focus();
		}

		_initIntersectionObserver() {
			if (this._intersectionOb) {
				this._intersectionOb.disconnect();
			}
			this._intersectionOb = new IntersectionObserver(this._handleIntersection);
			this._toggleIntersectionObserver(true);
		}

		_toggleIntersectionObserver(enabled) {
			let panes = this.getPanes();
			if (enabled) {
				panes.forEach(elem => {
					if (this._isResearchPaneSelected(elem)) this._intersectionOb.observe(elem);
					else this._intersectionOb.unobserve(elem);
				});
			}
			else {
				panes.forEach(elem => this._intersectionOb.unobserve(elem));
			}
		}

		_handleContainerScroll = () => {
			// Don't scroll hidden pane
			if (this.hidden || this._disableScrollHandler) return;

			let minHeight = this._minScrollHeight;
			if (minHeight) {
				let newMinScrollHeight = this._paneParent.scrollTop + this._paneParent.clientHeight;
				// Ignore overscroll (which generates scroll events on Windows 11, unlike on macOS)
				// and don't shrink below the pinned pane's min scroll height
				if (newMinScrollHeight > this._paneParent.scrollHeight
						|| this.getEnabledPane(this.pinnedPane) && newMinScrollHeight < this._pinnedPaneMinScrollHeight) {
					return;
				}
				this._minScrollHeight = newMinScrollHeight;
			}
		};

		// Keyboard navigation within the itemPane. Also handles contextPane keyboard nav
		_handleKeydown = (event) => {
			let stopEvent = () => {
				event.preventDefault();
				event.stopPropagation();
			};
			let isLibraryTab = Zotero_Tabs.selectedIndex == 0;

			// Tab from the scrollable area focuses the pinned pane if it exists
			if (event.target.classList.contains("zotero-view-item") && event.key == "Tab" && !event.shiftKey && this.pinnedPane) {
				let pane = this.getPane(this.pinnedPane);
				pane.firstChild._head.focus();
				stopEvent();
				return;
			}
			// On Escape/Enter on editable-text, return focus to the item tree or reader
			if (event.key == "Escape" || (event.key == "Enter" && event.target.classList.contains('input'))) {
				if (isLibraryTab) {
					document.querySelector('#zotero-items-tree .virtualized-table').focus();
				}
				else {
					let reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
					if (reader) {
						reader.focus();
					}
				}
			}
		};

		_handlePaneStatus = (muts) => {
			for (let mut of muts) {
				let paneID = mut.target.dataset.pane;
				if (paneID) {
					this.sidenav.updatePaneStatus(paneID);
				}
			}
		};

		/**
		 * This function handles the intersection of panes with the viewport.
		 * It triggers rendering and discarding of panes based on their visibility.
		 * Panes are not rendered until they become visible in the viewport.
		 * This approach prevents unnecessary rendering of all panes at once when switching items,
		 * which can lead to slow performance and excessive battery usage,
		 * especially for slow panes, e.g. attachment preview.
		 * @param {IntersectionObserverEntry[]} entries
		 * @returns {Promise<void>}
		 */
		_handleIntersection = async (entries) => {
			if (this._isRendering) return;
			let needsRefresh = [];
			let needsDiscard = [];
			entries.forEach((entry) => {
				let targetPaneElem = entry.target;
				if (!this._isResearchPaneSelected(targetPaneElem)) return;
				if (entry.isIntersecting
						&& (targetPaneElem.render || targetPaneElem.asyncRender)) {
					needsRefresh.push(targetPaneElem);
				}
				else if (targetPaneElem.discard) {
					needsDiscard.push(targetPaneElem);
				}
			});
			let needsCheckVisibility = false;
			// Sidenav is in smooth scrolling mode
			if (this._disableScrollHandler) {
				// Wait for scroll to finish
				await this._waitForScroll();
				needsCheckVisibility = true;
			}
			if (needsRefresh.length > 0) {
				needsRefresh.forEach(async (paneElem) => {
					if (needsCheckVisibility && !this.isPaneVisible(paneElem.dataset.pane)) {
						return;
					}
					if (paneElem.render) paneElem.render();
					if (paneElem.asyncRender) await paneElem.asyncRender();
				});
			}
			if (needsDiscard.length > 0) {
				needsDiscard.forEach((paneElem) => {
					if (needsCheckVisibility && this.isPaneVisible(paneElem.dataset.pane)) {
						return;
					}
					if (paneElem.discard) paneElem.discard();
				});
			}
		};

		_handleTabSelect(tabIDs) {
			if (!this.tabID || typeof Zotero_Tabs === 'undefined') {
				return;
			}
			let isTabSelected = tabIDs.includes(this.tabID);
			this.skipRender = !isTabSelected;
			if (isTabSelected && this._pendingRender) {
				this.render();
			}
		}

		_savePinnedPane() {
			if (this.tabType !== 'library') {
				return;
			}
			let pinnedPane = this.pinnedPane;
			if (pinnedPane) {
				Zotero.Prefs.set('pinnedPane', pinnedPane);
			}
			else {
				Zotero.Prefs.clear('pinnedPane');
			}
		}

		_restorePinnedPane() {
			if (this.researchPaperNavigation) return;
			if (this.tabType !== 'library') {
				return;
			}
			let pinnedPane = Zotero.Prefs.get('pinnedPane') || '';
			if (this.pinnedPane !== pinnedPane) {
				this.pinnedPane = pinnedPane;
			}
		}
	}

	customElements.define("item-details", ItemDetails);
}
