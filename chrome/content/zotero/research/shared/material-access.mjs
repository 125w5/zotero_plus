/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The shared material library can hold tens of megabytes of cached paper text.
// These helpers read one entry, or the frozen shared library, instead of
// copying the whole library for every lookup, render or keystroke.

// A detached copy of one shared material, or undefined.
export function libraryAsset(A, id) {
	if (id === undefined || id === null) return undefined;
	return A.asset ? A.asset(id) : A.assetLibrary()[id];
}

// The frozen shared library, for lists, search and lookups. Never mutate it;
// take libraryAsset() before editing a material that came from it.
export function libraryView(A) {
	return A.assetLibraryView ? A.assetLibraryView() : A.assetLibrary();
}
