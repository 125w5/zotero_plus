/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {prepareReaderPaneStyles} from './reader-pane-styles.mjs';
// Share the recovery UI without changing translation acceptance or provider mode.
export function translationFailure(error) {
 const reason = String(error?.message || error || '翻译服务未返回译文');
 if (error?.name === 'AbortError') return {kind: 'cancelled', title: '翻译已取消', message: '可以重新翻译当前内容。', reason};
 if (error?.name === 'TimeoutError' || /超时|timeout/i.test(reason)) return {kind: 'timeout', title: '翻译超时', message: '请重试当前内容。', reason};
 if (/数学关系|数学符号|公式|数值|数字|引用.*(?:遗漏|改变|不一致)|译文.*(?:遗漏|改变)/.test(reason)) return {kind: 'quality', title: '译文未通过核对', message: '译文与原文的公式、数值或引用不一致，请重试或查看原文。', reason};
 if (/未配置|未设置|未填写|机器翻译暂不可用|凭据/.test(reason)) return {kind: 'configuration', title: '翻译服务尚未就绪', message: '请检查翻译设置，然后重试。', reason};
 if (/无法连接|网络|代理|HTTP|network|fetch/i.test(reason)) return {kind: 'connection', title: '暂时无法连接翻译服务', message: '请检查网络或代理后重试。', reason};
 return {kind: 'error', title: '暂时无法获取译文', message: '原文已保留，可以重试当前内容。', reason};
}

export function renderTranslationFeedback(host, error, {Zotero, onRetry, onOriginal, onError = () => {}} = {}) {
 const doc = host.ownerDocument, info = translationFailure(error);
 if (Zotero?.HTTP?.request) {
  void prepareReaderPaneStyles(doc,{Zotero,name:'translation-feedback',url:'chrome://zotero/content/research/shared/translation-feedback.css'}).catch(onError);
 } else if (!doc.querySelector('link[data-translation-feedback]')) {
  const link = doc.createElement('link');link.rel = 'stylesheet';link.href = 'chrome://zotero/content/research/shared/translation-feedback.css';link.dataset.translationFeedback = 'true';doc.head.append(link);
 }
 const el = (tag, value, cls) => {const node = doc.createElement(tag);if (value !== undefined) node.textContent = value;if (cls) node.className = cls;return node;};
 const card = el('section', undefined, 'translation-feedback');card.dataset.kind = info.kind;card.lang = 'zh-CN';card.setAttribute('aria-label', info.title);
 card.append(el('strong', info.title, 'translation-feedback-title'), el('p', info.message, 'translation-feedback-message'));
 const details = el('details', undefined, 'translation-feedback-details');details.append(el('summary', '查看原因'), el('p', info.reason));card.append(details);
 if (onRetry || onOriginal) {
  const actions = el('div', undefined, 'translation-feedback-actions');
  for (const [label, name, run] of [['重试', 'retry', onRetry], ['查看原文', 'original', onOriginal]]) {
   if (!run) continue;
   const button = el('button', label, 'translation-feedback-' + name);button.type = 'button';
   button.onclick = async event => {event.stopPropagation();if (button.disabled) return;button.disabled = true;try {await run();} catch (failure) {onError(failure);} finally {button.disabled = false;}};
   actions.append(button);
  }
  card.append(actions);
 }
 host.replaceChildren(card);return card;
}
