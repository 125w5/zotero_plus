/* SPDX-License-Identifier: AGPL-3.0-or-later */
/** Keep actions in the visible reader when a PDF is open in several tabs. */
export function activeReaderForAttachment(readers,attachmentID,preferredWindow){
 const live=readers.filter(reader=>reader.itemID===attachmentID&&reader._window&&!reader._window.closed&&!reader._isTabClosed&&!reader._isUninitialized);
 const selected=reader=>!!reader.tabID&&reader._window.Zotero_Tabs?.selectedID===reader.tabID;
 return live.find(reader=>reader._window===preferredWindow&&selected(reader))
  ||live.find(selected)||live.find(reader=>reader._window===preferredWindow)||live[0];
}
