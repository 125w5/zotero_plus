/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {discoveryPDFCandidate,discoveryMetricLabel} from './shared/discovery-presentation.mjs';
import {observeListEnd} from './shared/infinite-scroll.mjs';

export async function openPaperSearch(E,initial,{projectID,host,status=()=>{}}={}){
 const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 let destination=projectID?await E.notebook.ensureProjectCollection(projectID,{}):null;
 const inline=!!host;document.getElementById('paper-search-dialog')?.close();host?.querySelector('.project-paper-search')?.remove();
 const d=el(inline?'section':'dialog',undefined,'project-paper-search');if(!inline)d.id='paper-search-dialog';
 const header=el('div',undefined,'search-dialog-header'),close=el('button','收起');header.append(el('h3','搜集项目论文'),close);d.append(header);
 const folder=el('p',destination?'保存到：'+destination.name:'下载时新建“论文搜集”','discovery-destination');d.append(folder);
 const form=el('form'),input=el('input'),submit=el('button','查找论文');input.value=initial||'';input.placeholder='研究主题、方法名称或关键词';input.setAttribute('aria-label','查找项目论文');submit.type='submit';form.append(input,submit);d.append(form);
 const filters=el('div',undefined,'discovery-feed-filters'),kind=el('select'),sort=el('select');kind.setAttribute('aria-label','项目期刊筛选');sort.setAttribute('aria-label','项目论文排序');for(const [value,label]of [['','全部文献'],['journal','仅期刊论文'],['top','已核验顶刊']]){const option=el('option',label);option.value=value;kind.append(option);}for(const [value,label]of [['date','发表日期'],['citations','引用量'],['impact','影响因子']]){const option=el('option',label);option.value=value;sort.append(option);}filters.append(kind,sort);d.append(filters);
 const info=el('p','点击论文下载 PDF；保存后再次点击打开。','muted'),list=el('div',undefined,'online-paper-list');info.setAttribute('role','status');d.append(info,list);(host||document.body).append(d);if(!inline)d.showModal();
 let page=1,provider='',cursor,query='',busy=false,hasMore=false,epoch=0,controller=new AbortController(),seen=new Set(),off;
 const dispose=()=>{off?.();controller.abort();epoch++;d.remove();};close.onclick=()=>inline?dispose():d.close();if(!inline)d.addEventListener('close',dispose);
 const resolve=async()=>{if(destination)return destination;const target=await E.createDiscoveryCollection('论文搜集',{});destination={collectionID:target.id,libraryID:target.libraryID,name:target.name};folder.textContent='保存到：'+destination.name;return destination;};
 async function load(reset=false){if(busy&&!reset)return;if(!input.value.trim())return;const token=reset?++epoch:epoch;busy=true;submit.disabled=true;
  try{if(reset){off?.();controller.abort();controller=new AbortController();page=1;provider='';cursor=undefined;query=input.value.trim();seen=new Set();list.replaceChildren();info.textContent='正在检索可获取 PDF 的论文…';}
   const result=await E.searchPaperPage(query,{provider,page,cursor,filters:{journalOnly:!!kind.value,topOnly:kind.value==='top',sort:sort.value},limit:20,signal:controller.signal});if(token!==epoch||!d.isConnected)return;provider=result.provider;page=result.nextPage||(result.page||page)+1;cursor=result.nextCursor;hasMore=result.hasMore===true;
   for(const row of result.records||[]){if(!discoveryPDFCandidate(row))continue;const identity=String(row.doi||row.url||row.id).toLowerCase();if(seen.has(identity))continue;seen.add(identity);const card=el('article',undefined,'online-paper'),title=el('button',row.title,'discovery-collection-title'),meta=el('small',[row.date,row.journal||row.source,discoveryMetricLabel(row)?.text].filter(Boolean).join(' · ')),feedback=el('span','','discovery-download-feedback');card.append(title,meta);const details=el('details');details.append(el('summary','摘要与来源'),el('p',row.abstract||'来源未提供摘要'));card.append(details);
    let pending=false,saved=row.attachmentID?{attachmentID:row.attachmentID}:null;const actions=el('div',undefined,'source-actions'),download=el('button',saved?'打开 PDF':'下载 PDF');actions.append(download,feedback);if(row.url){const source=el('button','出版来源');source.onclick=()=>E.notebook.openSource({url:row.url});actions.append(source);}card.append(actions);list.append(card);
    const acquire=async()=>{if(pending)return;if(saved)return E.library.openSource({attachmentID:saved.attachmentID});pending=true;title.disabled=download.disabled=true;try{const target=await resolve();feedback.textContent='正在获取 PDF…';saved=await E.obtainPaper(row,{collectionID:target.collectionID,libraryID:target.libraryID,open:false,onProgress:progress=>feedback.textContent=progress.text});download.textContent='打开 PDF';feedback.textContent='已保存至项目文件夹';card.classList.remove('download-failed');status('项目论文已保存，可继续选择与分析。');if(projectID)await E.notebook.ensureProjectCollection(projectID,{collectionID:target.collectionID}).catch(error=>status('PDF 已保存；项目范围未刷新：'+error.message));}catch(error){feedback.textContent=error.message;download.textContent='重试获取';card.classList.add('download-failed');details.open=false;}finally{pending=false;title.disabled=download.disabled=false;}};title.onclick=download.onclick=acquire;
   }
   info.textContent=`已显示 ${seen.size} 篇可获取 PDF 的论文${hasMore?' · 下滑继续加载':''}${result.limitations?.length?' · '+result.limitations.join('；'):''}`;
  }catch(error){if(token!==epoch||controller.signal.aborted)return;info.textContent=error.message+'，已有结果保留。';hasMore=false;}
  finally{if(token===epoch){busy=false;submit.disabled=false;off?.();if(hasMore){const end=el('div',undefined,'list-end-sentinel');end.setAttribute('aria-hidden','true');list.append(end);off=observeListEnd(end,{root:inline?host.closest('.assembly-details')||host:null,load:()=>load(),onError:error=>info.textContent=error.message});}}}
 }
 form.onsubmit=event=>{event.preventDefault();if(!event.isComposing)load(true);};kind.onchange=sort.onchange=()=>load(true);
 if(input.value.trim())await load(true);else input.focus();return d;
}
