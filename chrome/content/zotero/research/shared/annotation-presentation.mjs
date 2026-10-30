/* SPDX-License-Identifier: AGPL-3.0-or-later */
/** Display cleanup only. The saved comment, its tags and the original quotation
 * remain intact unless the user explicitly edits the comment. */
export function annotationPresentation(annotation, link) {
 const raw = String(annotation?.comment || ''), tags = (annotation?.tags || []).map(tag => tag.name || tag.tag || tag);
 const translation = tags.includes('机器翻译') || /^机器翻译(?:（请核对）|\(请核对\))?\s*\n/.test(raw) && link?.generatedComment === raw;
 const generated = translation || link?.generatedComment === raw;
 let display = raw, prefix = '';
 if (translation) {
  let body = raw.replace(/^机器翻译(?:（请核对）|\(请核对\))?\s*\n/, '').replace(/^选段译文\s*\n/, '');
  display = body.trim();
  prefix = raw.slice(0, raw.length - body.trimStart().length);
 }
 return {text:display, prefix, raw, translation, generated, color:/^#[0-9a-f]{6}$/i.test(annotation?.color || '') ? annotation.color : '#87aaca'};
}

/** The comment to store after the user edits presentation.text. The hidden
 * '机器翻译（请核对）' header stays with a translation that keeps its text. */
export function editedAnnotationComment(presentation, value) {
 let text = String(value ?? '');
 if (text === presentation.text) return presentation.raw;
 return text.trim() ? presentation.prefix + text : text;
}
