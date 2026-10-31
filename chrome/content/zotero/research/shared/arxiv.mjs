export function arxivID(value){
 const text=String(value||'').trim().replace(/^arxiv\s*:\s*/i,'').replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i,'').replace(/\.pdf(?:[?#].*)?$/i,'').split(/[?#]/)[0];
 return /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v[1-9]\d*)?$/i.test(text)?text:null;
}
// The arXiv number of an arXiv record, else null. arXiv's own records keep it whatever DOI
// they name (arxivMetadata takes citation_doi); any other record counts by its id, url or pdf
// only without a DOI other than arXiv's 10.48550 one, so a journal article keeps its journal.
export function arxivRecordID(record={}){
 const id=arxivID(record.id)||arxivID(record.url)||arxivID(record.pdf);if(!id||record.source==='arXiv')return id;
 const doi=String(record.doi||'').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,'');
 return !doi||/^10\.48550\/arxiv\./i.test(doi)?id:null;
}
export function assertPDF(bytes){if(!ArrayBuffer.isView(bytes)||bytes.BYTES_PER_ELEMENT!==1||bytes.length<100||!Array.from(bytes.slice(0,1024)).map(x=>String.fromCharCode(x)).join('').includes('%PDF-'))throw Error('下载返回非 PDF 内容，未保存为附件');}
