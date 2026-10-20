/* SPDX-License-Identifier: AGPL-3.0-or-later */
const stamp=value=>{let text=String(value||'');if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text))text=text.replace(' ','T')+'Z';const number=Date.parse(text);return Number.isFinite(number)?number:0;};
const clean=value=>String(value||'').replace(/<\/?[a-z][^>]*>/gi,' ').replace(/\s+/g,' ').trim();
export function weeklyResearchEntries(state={},items=[],{now=Date.now(),days=7}={}){
 const end=now instanceof Date?now.getTime():typeof now==='string'?stamp(now):Number(now);if(!Number.isFinite(end)||end<=0)throw Error('周报截止时间无效');days=Math.max(1,Math.min(30,Number(days)||7));const start=end-days*86400000,rows=[],seen=new Set(),papers=new Map(items.filter(item=>item.kind==='paper').map(item=>[item.id,item]));
	const add=row=>{const date=stamp(row.at);if(date<start||date>end||!row.text?.trim()||seen.has(row.id))return;seen.add(row.id);rows.push({...row,text:clean(row.text).slice(0,5000)});};
	for(const entry of state.researchActivity||[])add({...entry,type:'reading',title:entry.title||'阅读记录',text:entry.text||'打开并阅读论文'});
	for(const item of items){
		if(item.kind==='note'||item.kind==='annotation')add({id:'item-'+item.id,type:item.kind,title:item.title||'研究笔记',text:item.text,paperItemID:item.paperItemID,uri:item.uri,at:item.dateModified||item.dateAdded});
		else if(stamp(item.dateAdded)>=start)add({id:'import-'+item.id,type:'import',title:item.title,text:'新增文献：'+item.title,paperItemID:item.id,uri:item.uri,at:item.dateAdded});
	}
	const records=new Set();for(const paper of Object.values(state.papers||{}))for(const record of paper.records||[]){
		if(records.has(record.id))continue;records.add(record.id);
		for(const [index,section] of (record.result?.sections||[]).entries())add({id:'analysis-'+record.id+'-'+index,type:'analysis',title:section.heading||'论文阅读整理',text:section.body,at:record.at,paperItemID:record.sources?.find(source=>source.paperItemID)?.paperItemID,uri:record.sources?.find(source=>source.uri)?.uri,derived:true});
	}
	for(const project of Object.values(state.manuscripts||{})){
		const content=(project.blocks||[]).filter(block=>block.text?.trim()).map(block=>block.text).join('\n');
		if(content)add({id:'writing-'+project.id,type:'writing',title:project.title,text:content,at:project.updatedAt,projectID:project.id});
	}
	for(const draft of Object.values(state.pptDrafts||{}))for(const entry of draft.contributions||[])add({id:'contribution-'+entry.id,type:'experiment',title:entry.title||draft.title,text:entry.text||entry.content,at:entry.updatedAt||entry.createdAt||draft.updatedAt});
	return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),entries:rows.sort((a,b)=>stamp(b.at)-stamp(a.at)).slice(0,120),papers:[...papers.values()]};
}
export function weeklyPresentation(report){
	const rows=report.entries||[],labels={reading:'本周阅读',import:'新增文献',note:'研究笔记',annotation:'批注与观察',analysis:'阅读整理',writing:'写作进展',experiment:'实验记录'};
 const sources=rows.map(row=>({id:row.id,label:row.title,text:row.text,uri:row.uri,paperItemID:row.paperItemID,sourceType:row.type,derived:!!row.derived,at:row.at,projectID:row.projectID}));
	const slides=[];let serial=0;
	for(const type of Object.keys(labels)){
		const group=rows.filter(row=>row.type===type);for(let offset=0;offset<group.length;offset+=4){const part=group.slice(offset,offset+4),number=serial++;
   slides.push({id:'weekly-'+number,outlineID:'weekly-outline-'+number,title:labels[type]+(offset?' · 续':''),section:labels[type],layout:'text',explanation:'依据本周保存的记录整理；完整内容保留在来源中',blocks:part.map(row=>({kind:row.derived?'synthesis':type==='experiment'?'my_experiment':'my_interpretation',text:(row.title+'：'+row.text).slice(0,250),evidenceIDs:[row.id],quote:''})),notes:part.map(row=>String(row.title||'').slice(0,80)+'\n'+row.text.slice(0,600)).join('\n\n'),assetIDs:[],status:'user',weeklySourceIDs:part.map(row=>row.id)});
		}
	}
	return {sources,slides,outline:slides.map(slide=>({id:slide.outlineID,title:slide.title,purpose:slide.explanation,diagram:false,sourceIDs:slide.weeklySourceIDs}))};
}
