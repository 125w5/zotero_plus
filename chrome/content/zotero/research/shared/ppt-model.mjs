/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const BLOCK_TYPES = {paper_fact:'论文事实',author_explanation:'作者解释',synthesis:'系统归纳',my_interpretation:'我的理解',my_experiment:'我的实验',unverified:'待验证观点'};
export const TYPE_COLORS = {paper_fact:'285B93',author_explanation:'285B93',synthesis:'526579',my_interpretation:'7952A3',my_experiment:'27794B',unverified:'AF6718'};
export const DIAGRAM_TYPES = {method_pipeline:'方法流水线',model_architecture:'模型架构',data_flow:'数据流',experiment_flow:'实验流程',causal_mechanism:'因果机制',module_breakdown:'模块分解',method_comparison:'多方法对比',classification_tree:'分类树',timeline:'时间演化',feedback_loop:'反馈循环',input_process_output:'输入—处理—输出',multiscale:'多尺度结构'};
const sections = s => s.split('|').map((title,i)=>({title,purpose:title,diagram:/方法总览|技术路线|关键模块|实验流程/.test(title),id:'section-'+i}));
export const CONTENT_TEMPLATES = {
 single:{name:'单篇论文精读',minutes:15,sections:sections('封面|一页结论|研究背景|问题与缺口|核心贡献|方法总览|关键模块|方法细节与公式|数据与实验设置|核心结果一|核心结果二|消融与敏感性|局限与质疑|研究启示|总结|讨论与展望')},
 review:{name:'多篇文献综述',minutes:20,sections:sections('封面|研究范围与结论|分类标准|技术路线演变|代表论文一|代表论文二|方法对比|数据与指标对比|争议与未解决问题|研究空白|我的判断|未来研究方向')},
 progress:{name:'个人研究进展',minutes:15,sections:sections('封面|上次目标|本次完成|当前技术路线|实验设置|实验结果|失败实验|问题分析|与论文对比|当前阻塞|下阶段计划|待讨论问题')},
 mixed:{name:'论文＋个人实验',minutes:20,sections:sections('封面|论文问题与贡献|方法总览|关键模块|论文实验与结果|论文局限|我的理解|我的复现设置|我的实验结果|与论文结果对比|失败原因分析|下一步改进')},
 proposal:{name:'开题汇报',minutes:20,sections:sections('封面|研究背景与意义|问题定义|相关工作|研究缺口|研究目标|当前技术路线|关键模块|实验方案|可行性与风险|进度计划|预期贡献')},
 midterm:{name:'中期汇报',minutes:20,sections:sections('封面|研究目标|前期计划|已完成工作|当前技术路线|阶段实验|关键结果|尚未解决问题|调整方案|后续实验计划|预期成果')},
 defense:{name:'答辩汇报',minutes:20,sections:sections('封面|研究背景|研究问题|主要贡献|方法总览|关键模块|实验设置|核心结果|对比与消融|局限与展望|研究总结|备用问题')}
};
export const THEMES = {
 light:{id:'light',name:'学术浅色',bg:'FFFFFF',text:'243746',accent:'285B93',muted:'586F81',soft:'EDF3F8',font:'Microsoft YaHei'},
 dark:{id:'dark',name:'学术深色',bg:'17212B',text:'EAF0F5',accent:'76BCED',muted:'AAC0D2',soft:'243544',font:'Microsoft YaHei'},
 journal:{id:'journal',name:'期刊配色',bg:'FFFFFF',text:'263C3D',accent:'367F81',muted:'5D7475',soft:'EAF4F1',font:'Microsoft YaHei'},
 experiment:{id:'experiment',name:'实验汇报',bg:'FBFBF8',text:'273640',accent:'447255',muted:'667466',soft:'EFF2E9',font:'Microsoft YaHei'}
};
export const normalize = s => String(s||'').normalize('NFKC').replace(/([a-z])-\s*\n\s*([a-z])/g,'$1$2').replace(/-\s*\n\s*/g,'-').replace(/\s+/g,' ').trim();
export function themeFor(draft) { return draft.theme?.bg ? draft.theme : THEMES[draft.themeID] || THEMES.light; }
export function initialOutline(templateID='single') {return structuredClone(CONTENT_TEMPLATES[templateID]||CONTENT_TEMPLATES.single).sections;}
export function density(slide) {return (slide.explanation||'').length+(slide.blocks||[]).reduce((n,b)=>n+b.text.length,0);}
export function validateDiagram(d,evidence=[],{allowManual=false}={}) {
 if(!d||!DIAGRAM_TYPES[d.diagramType])throw Error('请选择有效示意图类型');
 if(!Array.isArray(d.nodes)||d.nodes.length<2||d.nodes.length>18)throw Error('示意图需有 2–18 个节点；模型返回空节点时不能保存');
 if(!Array.isArray(d.edges)||d.edges.length<1||d.edges.length>30)throw Error('示意图缺少关系或关系过多');
 const ids=new Set(),sourceIDs=new Set(evidence.map(e=>e.id));
 for(const n of d.nodes){if(!/^[\w-]{1,60}$/.test(n.id)||ids.has(n.id)||!n.label?.trim()||n.label.length>60)throw Error('节点 ID 重复、名称为空或过长');ids.add(n.id);
  if(['x','y','width','height'].some(k=>k in n))throw Error('AI 只需提供语义节点，坐标由 ELK 计算');
  if(!Array.isArray(n.evidenceIDs)||n.evidenceIDs.some(id=>!sourceIDs.has(id)))throw Error('节点来源不存在');
  if(!n.evidenceIDs.length&&!allowManual)throw Error('方法证据不足：节点没有原文来源');
 }
 for(const e of d.edges)if(!ids.has(e.source)||!ids.has(e.target)||e.source===e.target||String(e.relation||'').length>50)throw Error('示意图存在断边、自连或过长关系标签');
 return d;
}
export {bindEvidenceBlocks,balancedSources} from './ppt-evidence.mjs';
export function validateStudioSlide(s,evidence,assets=[],{requireContent=true}={}) {
 if(!s.id||!s.title?.trim()||s.title.length>80)throw Error('页面标题为空或超过 80 字');
 if(!['balanced','text','visual','comparison'].includes(s.layout||'balanced'))throw Error('未知页面布局');
 if(!Array.isArray(s.blocks)||s.blocks.length>6||(requireContent&&!s.blocks.length))throw Error('内容页需要论证内容，最多六条');
 const known=new Map(evidence.map(e=>[e.id,e]));
 for(const b of s.blocks){if(!BLOCK_TYPES[b.kind]||!b.text?.trim()||b.text.length>260)throw Error('正文类型无效、为空或过长');
  if(!Array.isArray(b.evidenceIDs)||b.evidenceIDs.some(id=>!known.has(id)))throw Error('正文引用了不存在的证据');
  if(['paper_fact','author_explanation'].includes(b.kind)){
   if(!b.evidenceIDs.length||!normalize(b.quote)||!b.evidenceIDs.some(id=>normalize(known.get(id).text).includes(normalize(b.quote))))throw Error('这条论文事实缺少可核对的原文证据。请重新生成本页，或将内容来源改为“待验证观点”。');
  }
 }
 if((s.assetIDs||[]).some(id=>!assets.some(a=>a.id===id)))throw Error('所选图片已不存在，请重新选择');
 if(String(s.explanation||'').length>180||String(s.notes||'').length>3000)throw Error('核心解释或讲稿过长，请分成两页');
 if(s.diagram)validateDiagram(s.diagram,evidence,{allowManual:true});
 return s;
}
export function validateStudioPlan(plan,evidence,assets) {
 if(!plan.title?.trim()||!Array.isArray(plan.slides)||!plan.slides.length||plan.slides.length>50)throw Error('汇报需要标题和 1–50 页内容');
 for(const s of plan.slides)validateStudioSlide(s,evidence,assets||plan.assets||[]);
 return true;
}

// Adapt legacy presentation framing for a meeting where all participants are present.
// Applied to presentation copy, never to quoted source evidence or the saved draft.
export function meetingText(text){
 return String(text||'')
  .replace(/(?:本节|本页)预判导师对(.+?)的追问，并给出证据回答与承认边界[。.]?/g,'本节讨论$1，结合证据说明适用边界。')
  .replace(/导师(?:可能(?:会)?|预计(?:会)?|将会|会)?(?:提问|追问)(?:预判|预测|预演)?|(?:预判|预测|预演)导师(?:的)?(?:提问|追问)|希望导师回答的问题/g,'待讨论问题');
}
