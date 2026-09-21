import {searchMaterials} from './material-catalog.mjs';
import {arxivID} from './arxiv.mjs';
export const doiKey=value=>String(value||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').toLowerCase();
export function paperIdentity(r){const ax=arxivID(r.id)||arxivID(r.url)||arxivID(r.pdf);return ax?'arxiv:'+ax.toLowerCase():doiKey(r.doi)?'doi:'+doiKey(r.doi):r.url?'url:'+r.url:null;}
export function screenPaper(record,query=''){
 const retracted=record.retracted===true||record.isRetracted===true,verified=!!(doiKey(record.doi)||arxivID(record.id)||arxivID(record.url)||/^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov|europepmc\.org)\//.test(record.url||''));
 const direct=arxivID(query)&&arxivID(query)===arxivID(record.id),hits=searchMaterials([{...record,id:String(record.id||record.url||'candidate'),summary:record.abstract}],query),relevant=!!direct||!!query.trim()&&hits.length>0,complete=!!record.abstract?.trim();
 return {autoDownload:!retracted&&verified&&relevant&&complete,retracted,citations:Number.isFinite(record.citationCount)?record.citationCount:null,reason:retracted?'已标记撤稿，默认不自动下载':!verified?'来源尚不可核验，暂未下载':!relevant?'与当前主题关联较弱，暂未下载':!complete?'匹配主题，但缺少摘要信息，暂未自动下载':'标题或摘要匹配当前主题，来源可核验',retractionStatus:retracted?'已撤稿':record.retracted===false||record.isRetracted===false?'来源未标记撤稿':'撤稿状态未知'};
}
