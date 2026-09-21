export function arxivID(value){
 const text=String(value||'').trim().replace(/^arxiv\s*:\s*/i,'').replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i,'').replace(/\.pdf(?:[?#].*)?$/i,'').split(/[?#]/)[0];
 return /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v[1-9]\d*)?$/i.test(text)?text:null;
}
export function assertPDF(bytes){if(!ArrayBuffer.isView(bytes)||bytes.BYTES_PER_ELEMENT!==1||bytes.length<100||!Array.from(bytes.slice(0,1024)).map(x=>String.fromCharCode(x)).join('').includes('%PDF-'))throw Error('下载返回非 PDF 内容，未保存为附件');}
