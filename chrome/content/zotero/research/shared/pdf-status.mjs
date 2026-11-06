/* SPDX-License-Identifier: AGPL-3.0-or-later */
// What a paper's full-text check or download came to, for one line on a result card:
// {state,label,reason}. state is 'pdf' (a file passed the %PDF- check or is saved),
// 'landing' (the address gives an article page, not a file), 'access' (the publisher asks
// for a login, an institution or a human check), 'none' (no source lists an open copy),
// 'checking' or 'failed' (a timeout, a busy server, a cancelled or unsaved download).
export const PDF_STATUS_LABELS=Object.freeze({pdf:'可下载',landing:'只有落地页',access:'需要机构权限',none:'没有公开全文',checking:'检查中',failed:'下载失败'});
const REASONS={pdf:'公开 PDF 已通过文件检查',landing:'来源只提供文章网页，没有可直接下载的 PDF',access:'出版社要求登录、机构订阅或人机验证；可在 Zotero 中配置机构代理后重试',none:'各开放获取来源都没有这篇论文的公开 PDF',checking:'正在查找并核验公开 PDF…',failed:'来源暂时无法访问，可稍后重试'};
const status=(state,reason)=>({state,label:PDF_STATUS_LABELS[state],reason:reason||REASONS[state]});
const ARXIV=/^https:\/\/(?:export\.|www\.)?arxiv\.org\//i;
const BOT=/人机验证|验证页面|captcha|cf-chl|challenge/i;
const tidy=text=>String(text||'').replace(/[，,]\s*(?:请重试|未保存为?附件)$/,'').replace(/；?文库(?:中的这条题录)?没有(?:变化|改动).*$/,'').trim();

// One error (or its message) from a probe, a download or a lookup.
export function pdfErrorStatus(error,{url='',transient=false}={}){
 const text=String(error?.message??error??'')+' '+String(error?.cached||'');
 if(error?.name==='AbortError'||/^已取消/.test(text))return status('failed','已取消');
 if(/撤稿/.test(text))return status('failed','该论文标记为撤稿，已停止自动下载');
 if(/（HTTP 40[13]）|HTTP 40[13]\b|需要登录|机构权限/.test(text)&&!ARXIV.test(url))return status('access');
 if(/人机验证/.test(text)||/返回网页或验证页面/.test(text)&&BOT.test(text.replace(/返回网页或验证页面/g,'')))return status('access');
 if(/返回网页或验证页面|只提供文章网页/.test(text))return status('landing');
 if(!transient&&/（HTTP 4(?:04|10)）|未找到公开 PDF|均未找到/.test(text))return status('none');
 const reason=tidy(error?.message??error);
 return status('failed',/\p{Script=Han}/u.test(reason)?reason:REASONS.failed);
}
// Several failed sources together: one asking for access says so before a landing page, a
// landing page before a transient failure, and only sources that answered with nothing give 'none'.
export function pdfFailuresStatus(failures=[],{transient=false}={}){
 const rows=failures.map(row=>({...row,status:pdfErrorStatus(row.error,{url:row.url,transient:row.transient})}));
 const named=state=>[...new Set(rows.filter(row=>row.status.state===state).map(row=>row.source).filter(Boolean))].slice(0,3).join('、');
 for(const state of ['access','landing'])if(rows.some(row=>row.status.state===state))return status(state,(named(state)?named(state)+'：':'')+REASONS[state]);
 const failed=rows.find(row=>row.status.state==='failed');
 if(failed||transient)return status('failed',failed?(failed.source?failed.source+'：':'')+failed.status.reason+(transient?'；可稍后重试':''):REASONS.failed);
 return status('none');
}
// Any outcome: an error from resolveOpenPDF/obtainPaper, their result, a probe result from
// verifyDiscoveryPDF, a search row ({pdf,pdfVerified,pdfUnavailable,pdfChecking}) or a state name.
export function pdfStatus(outcome){
 if(outcome===null||outcome===undefined)return status('none');
 if(typeof outcome==='string')return PDF_STATUS_LABELS[outcome]?status(outcome):pdfErrorStatus(outcome);
 if(outcome instanceof Error||outcome.name==='AbortError')return outcome.state&&PDF_STATUS_LABELS[outcome.state]?status(outcome.state,outcome.reason):pdfErrorStatus(outcome);
 if(outcome.state&&PDF_STATUS_LABELS[outcome.state])return status(outcome.state,outcome.reason);
 if(outcome.checking||outcome.pdfChecking)return status('checking');
 if(outcome.bytes||outcome.attachmentID||outcome.localPDF||outcome.available===true||outcome.pdfVerified)return status('pdf');
 if(outcome.available===false)return pdfErrorStatus(outcome.error,{url:outcome.url||outcome.finalURL||'',transient:outcome.transient});
 if(outcome.error)return pdfErrorStatus(outcome.error,{url:outcome.url||''});
 if(outcome.pdfUnavailable)return status('none','这个公开地址近一天内无法下载；下载时会再查其他开放获取来源');
 return outcome.pdf||outcome.pdfCandidates?.length?status('checking','公开地址尚未核验；下载时会先检查文件'):status('none');
}
