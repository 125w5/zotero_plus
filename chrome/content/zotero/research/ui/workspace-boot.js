/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Set the host layout before the first paint; async service initialization must
// not briefly display the standalone navigation inside the native workspace.
if(window.frameElement?.researchLibraryMode){
 document.documentElement.dataset.libraryEmbedded='true';
 document.documentElement.dataset.libraryView=window.frameElement.researchLibraryView||'discovery';
}
