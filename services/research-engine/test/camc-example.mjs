// Reproducible acceptance deck for the user-supplied C-AMC paper; no invented data.
import fs from 'node:fs/promises';
import { renderDeck } from '../src/deck.mjs';
import { renderAndInspect } from '../src/render.mjs';
const [indexPath,directory]=process.argv.slice(2);
await fs.mkdir(directory,{recursive:true});
const index=JSON.parse((await fs.readFile(indexPath,'utf8')).trim().split('\n').at(-1)).value;
const assets=['Fig. 1','Fig. 4','Fig. 5','Fig. 7'].map(label=>({...index.assets.find(a=>a.label===label),needsReview:false,paperTitle:'Hunmin Lee · C-AMC',uri:''}));
for(const a of assets){if(!a.id)throw new Error('Required original figure missing');a.uri=`zotero://open-pdf/library/items/YK7KSJN5?page=${a.page}`;}
const titles=['C-AMC：原型空间中的闭环适配','跨数据集迁移具有方向差异','适配过程：同时观察变化与稳定区间','非 IID 结果：比较条件是否公平？'];
const bullets=[
 ['双输出主干、开放集检测与自监督适配协同工作','图中闭环包含原型和阈值的再次校准'],
 ['两个迁移方向分别比较，不能混成一个平均结果','同时阅读 Accuracy 与 MSE；它们使用不同纵轴'],
 ['原图保留 100 次迭代轨迹与不同 K 的比较','局部插图显示第 70–100 次迭代，汇报时应单独解释'],
 ['三种条件分别为样本、SNR 和类别不平衡','追问：比较方法是否具有相同数据与适配预算？','“多数配置领先”不等于每种条件均领先']
];
const layouts=['method','results','original','question'];
const evidence=assets.map(a=>({id:'A-'+a.id,label:a.label+' · PDF '+a.page,text:a.caption,uri:a.uri}));
const slides=assets.map((a,i)=>({kind:'asset',title:titles[i],assetIDs:[a.id],sources:['A-'+a.id],layoutType:layouts[i],slidePurpose:titles[i],claim:bullets[i][0],candidateAssets:[a.id],selectedAsset:a.id,assetReason:'直接采用论文 '+a.label+'，保留结构、坐标轴、图例和原始结果；不重造统计数据',speakerFocus:bullets[i].join('；'),fallback:'原图缺失时停止导出',bullets:bullets[i],notes:a.caption}));
slides.push({kind:'text',role:'limitations',title:'组会讨论：需要继续核对的证据',bullets:['误差与稳定性：原文如何定义波动，是否提供重复实验信息？','迁移与公平性：样本预算、适配预算和基线设置能否直接比较？','外推边界：这些 RadioML 结果在目标场景中是否仍然成立？'],sources:evidence.map(e=>e.id),notes:'这些是基于当前图表的核查问题，不是认定论文遗漏相应实验。'});
const plan={version:2,title:'C-AMC 论文原图组会示例',slides};
await fs.writeFile(directory+'/visual-plan.json',JSON.stringify({plan,evidence,assets},null,2));
const deck=await renderDeck({plan,evidence,assets,directory});
const result=await renderAndInspect(deck,{soffice:process.env.EASYSCH_TEST_SOFFICE,pdftoppm:process.env.EASYSCH_TEST_PDFTOPPM});
await fs.writeFile(directory+'/verification.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({path:result.path,previews:result.previews,status:result.renderStatus}));
