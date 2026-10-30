/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {installWorkspaceLoading} from './workspace-loading.mjs';

// Run independently of the editor's larger import graph, before it is ready.
// The editor settles this indicator on either successful or failed startup.
const loading = installWorkspaceLoading(document, window, document.body, {placement: 'page'});
loading.begin('writing');
const failed = event => {
	if (event.target === window || event.target?.localName === 'script') settled();
};
const settled = () => {
	window.removeEventListener('research-workspace-settled', settled);
	window.removeEventListener('error', failed, true);
	loading.dispose();
};
window.addEventListener('research-workspace-settled', settled, {once: true});
window.addEventListener('error', failed, true);
window.addEventListener('pagehide', settled, {once: true});
