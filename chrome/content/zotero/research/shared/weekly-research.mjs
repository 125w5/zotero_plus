/* SPDX-License-Identifier: AGPL-3.0-or-later */
const stamp=value=>{let text=String(value||'');if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text))text=text.replace(' ','T')+'Z';const number=Date.parse(text);return Number.isFinite(number)?number:0;};
const clean=value=>String(value||'').replace(/<\/?[a-z][^>]*>/gi,' ').replace(/\s+/g,' ').trim();
export function weeklyResearchEntries(state={},items=[],{now=Date.now(),days=7,scope}={}){
 const end=now instanceof Date?now.getTime():typeof now==='string'?stamp(now):Number(now);if(!Number.isFinite(end)||end<=0)throw Error('周报截止时间无效');days=Math.max(1,Math.min(30,Number(days)||7));const start=end-days*86400000,rows=[],seen=new Set(),papers=new Map(items.filter(item=>item.kind==='paper').map(item=>[item.id,item]));
	const selected=scope?new Set((scope.paperIDs||[]).map(String)):null;
	const projects=new Set((scope?.projectIDs||[]).map(String));
	const inScope=row=>!selected||selected.has(String(row.paperItemID))||(row.paperItemIDs||[]).some(id=>selected.has(String(id)))||projects.has(String(row.projectID));
	const add=row=>{const date=stamp(row.at);if(date<start||date>end||!row.text?.trim()||seen.has(row.id)||!inScope(row))return;seen.add(row.id);rows.push({...row,text:clean(row.text).slice(0,5000)});};
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
		if(content)add({id:'writing-'+project.id,type:'writing',title:project.title,text:content,at:project.updatedAt,projectID:project.id,paperItemIDs:(project.papers||[]).map(row=>row.id||row.paperItemID||row)});
	}
	// A contribution keeps its own type and date. An undated legacy entry is not
	// dated by its draft, which changes whenever anything in the draft is edited.
	const contributionTypes={'my_experiment':'experiment',unverified:'plan',synthesis:'discussion'};
	for(const draft of Object.values(state.pptDrafts||{}))for(const entry of draft.contributions||[])add({id:'contribution-'+entry.id,type:contributionTypes[entry.kind]||'interpretation',title:entry.title||draft.title,text:entry.text||entry.content,at:entry.createdAt||entry.updatedAt,derived:entry.kind==='synthesis',paperItemIDs:(draft.papers||[]).map(row=>row.id||row.paperItemID||row)});
	return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),entries:rows.sort((a,b)=>stamp(b.at)-stamp(a.at)).slice(0,120),papers:[...papers.values()].filter(row=>!selected||selected.has(String(row.id))),scope:scope?{label:scope.label||scope.folder||'当前文件夹',paperIDs:[...selected]}:{label:'整个文库'}};
}
export function weeklyPresentation(report,{minutes=15}={}){
	const rows=report.entries||[],labels={reading:'本周阅读',import:'新增文献',note:'研究笔记',annotation:'批注与观察',analysis:'阅读整理',writing:'写作进展',experiment:'实验记录',interpretation:'我的理解',discussion:'研究讨论',plan:'计划与待验证'};
 const sources=rows.map(row=>({id:row.id,label:row.title,text:row.text,uri:row.uri,paperItemID:row.paperItemID,sourceType:row.type,derived:!!row.derived,at:row.at,projectID:row.projectID}));
	const slides=[],groups=Object.keys(labels).map(type=>({type,rows:rows.filter(row=>row.type===type)})).filter(group=>group.rows.length);
	// A weekly talk is a digest. Keep every record in sources, rather than
	// copying thousands of words into notes and creating an unpresentable deck.
	const budget=Math.max(groups.length,Math.min(10,Math.floor((Number(minutes)||15)/1.25))),allocations=groups.map(()=>1);
	while(allocations.reduce((sum,n)=>sum+n,0)<budget){let best=-1,weight=0;groups.forEach((group,index)=>{const score=group.rows.length/allocations[index];if(group.rows.length>allocations[index]*3&&score>weight){weight=score;best=index;}});if(best<0)break;allocations[best]++;}
	const excerpt=(value,limit)=>{const text=clean(value);return text.length>limit?text.slice(0,limit-1)+'…':text;};
	for(const [index,{type,rows:group}]of groups.entries()){
		const size=Math.ceil(group.length/allocations[index]);for(let offset=0;offset<group.length;offset+=size){const part=group.slice(offset,offset+size),number=slides.length,visible=part.slice(0,3),rest=part.length-visible.length;
   const explanation=`${report.scope?.label||'本次资料'} · ${part.length} 条记录${rest?'，本页摘录 '+visible.length+' 条':''}；完整内容见来源`;
   slides.push({id:'weekly-'+number,outlineID:'weekly-outline-'+number,title:labels[type]+(offset?' · 续':''),section:labels[type],layout:'text',explanation,blocks:visible.map(row=>({kind:row.derived?'synthesis':type==='experiment'?'my_experiment':type==='plan'?'unverified':'my_interpretation',text:excerpt(row.title,20)+'：'+excerpt(row.text,55),evidenceIDs:[row.id],quote:''})),notes:`${labels[type]}：${part.length} 条保存记录。${rest?'另 '+rest+' 条保留在本页来源中。':''}这里只摘录记录，不代表完成了新的实验；具体数值和条件请按来源核对。`,assetIDs:[],status:'user',weeklySourceIDs:part.map(row=>row.id)});
		}
	}
	return {sources,slides,outline:slides.map(slide=>({id:slide.outlineID,title:slide.title,purpose:slide.explanation,diagram:false,sourceIDs:slide.weeklySourceIDs}))};
}
