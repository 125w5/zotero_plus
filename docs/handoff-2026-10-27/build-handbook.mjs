// Build a portable, offline handbook from source and isolated test screenshots.
// This does not read the daily library, credentials, or application settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(dir,'../..');
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const text=value=>typeof value==='string'?value:JSON.stringify(value);
const packages=[];
for(const [file,group]of [['design-system.json','设计语言与交互规范'],['workspace.json','工作台、资料与对话'],['reader.json','阅读器与证据'],['writing-ppt.json','论文写作、PPT与工程']]){
 const data=JSON.parse(await fs.readFile(path.join(dir,'data',file),'utf8'));
 const sections=Array.isArray(data)?data:data.sections;
 if(!Array.isArray(sections))throw Error(file+' must provide sections');
 packages.push({group,sections:sections.map(section=>({...section,title:section.title.replace(/^\d+\s*·\s*/,''),group:section.group||group}))});
}
const intro=packages[0].sections.find(section=>section.id==='manual-start');
if(intro)intro.group='阅读指南';
const sections=[intro,...packages.slice(1).flatMap(pack=>pack.sections),...packages[0].sections.filter(section=>section!==intro)].filter(Boolean);
const ids=new Set();for(const section of sections){if(!section.id||ids.has(section.id))throw Error('Missing/duplicate section ID: '+section.id);ids.add(section.id);}
const sourceIndex=new Map(),missing=[];
for(const section of sections){
 section.sources=(section.sources||[]).map(source=>typeof source==='string'?{path:source}:source);
 for(const source of section.sources){
  const rel=String(source.path||'').replaceAll('\\','/').replace(/^E:\/workspace\/zotero-main\/zotero-client\//i,'');source.path=rel;
  if(!rel||path.isAbsolute(rel)||rel.split('/').includes('..'))throw Error('Nonportable source path '+rel);
  let digest;
  try{const body=await fs.readFile(path.join(repo,rel),'utf8');digest=createHash('sha256').update(body).digest('hex');if(!source.line&&source.symbol&&body.includes(source.symbol))source.line=body.slice(0,body.indexOf(source.symbol)).split('\n').length;source.exists=true;}
  catch{source.exists=false;missing.push(rel);}
  const entry=sourceIndex.get(rel)||{path:rel,sha256:digest||null,sections:[]};entry.sections.push({id:section.id,title:section.title,symbol:source.symbol||'',line:source.line||null});sourceIndex.set(rel,entry);
 }
}
const table=(headers,rows)=>`<div class="table-wrap" tabindex="0" aria-label="可横向滚动的数据表"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(text(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const list=(items,cls='')=>`<ul class="${cls}">${items.map(item=>`<li>${esc(text(item))}</li>`).join('')}</ul>`;
const h3=(title,body)=>body?`<div class="content-block"><h3>${esc(title)}</h3>${body}</div>`:'';
function renderReason(item){
 if(typeof item==='string')return `<p>${esc(item)}</p>`;
 const raw=item.basis||'设计解释',colon=raw.search(/[：:]/),kind=colon<0?raw:raw.slice(0,colon),detail=colon<0?'':raw.slice(colon+1).trim();
 const label=kind.replace('源码事实与设计解释','事实＋解释').replace('源码事实与迁移建议','事实＋建议');
 const cls=/建议/.test(kind)?'suggestion':/解释|推断/.test(kind)?'interpretation':'';
 return `<div><span class="basis ${cls}">${esc(label)}</span><p>${esc(item.point||item.text||'')}${detail?`<span class="reason-detail">依据：${esc(detail)}</span>`:''}</p></div>`;
}
function renderSection(section,index){
 let body=(section.paragraphs||[]).map(p=>`<p>${esc(text(p))}</p>`).join('');
 if(section.flow?.length)body+=h3('任务如何衔接',`<ol class="flow">${section.flow.map((step,i)=>`<li><b>${String(i+1).padStart(2,'0')}</b><span>${esc(text(step))}</span></li>`).join('')}</ol>`);
 if(section.areas?.length)body+=h3('各区域的职责',`<dl class="areas">${section.areas.map((area,i)=>`<div><dt><span>${i+1}</span>${esc(area.name||area.title||'区域')}</dt><dd>${esc(area.role||area.description||'')}</dd></div>`).join('')}</dl>`);
 if(section.operations?.length)body+=h3('操作、结果与保存范围',table(['操作 / 触发','执行结果','保存在哪里 / 作用范围','状态与注意'],section.operations.map(op=>[op.action,op.result,op.saved||op.scope||'见对应业务对象',op.state||'按当前对象与阶段处理'])));
 for(const data of section.tables||[])body+=h3(data.title||'规则与参数',table(data.headers||[],data.rows||[]));
 if(section.design?.length)body+=h3('为什么这样设计',`<div class="reason-list">${section.design.map(renderReason).join('')}</div>`);
 if(section.states?.length)body+=h3('状态与反馈',table(['状态','界面与处理'],section.states.map(item=>[item.state,item.behavior||item.description])));
 if(section.handoff?.length)body+=h3('接手与维护要点',list(section.handoff,'handoff-list'));
 if(section.limitations?.length)body+=`<aside class="boundary"><h3>当前边界与限制</h3>${list(section.limitations)}</aside>`;
 if(section.snippets?.length)for(const snippet of section.snippets)body+=h3(snippet.title||'实现示例',`<pre><code>${esc(snippet.code||snippet)}</code></pre>`);
 if(section.code)body+=h3('实现示例',`<pre><code>${esc(text(section.code))}</code></pre>`);
 // Retain unfamiliar agent fields in the appendix instead of silently losing them.
 const recognized=new Set(['id','title','lead','summary','group','paragraphs','flow','areas','operations','tables','tablesExtra','design','states','handoff','sources','limitations','snippets','code','eyebrow','tags']);
 const extra=Object.entries(section).filter(([key,value])=>!recognized.has(key)&&value!=null);
 if(extra.length)body+=h3('补充说明',extra.map(([key,value])=>`<div class="extra"><h4>${esc(key)}</h4><pre>${esc(typeof value==='string'?value:JSON.stringify(value,null,2))}</pre></div>`).join(''));
 const sources=(section.sources||[]).map(source=>`<li><a href="../../${encodeURI(source.path)}" title="仓库内相对链接">${esc(source.path)}${source.line?`<span>:${source.line}</span>`:''}</a>${source.symbol?`<p>${esc(source.symbol)}</p>`:''}${!source.exists?'<em>本快照未找到该文件</em>':''}</li>`).join('');
 return `<article class="chapter" id="${esc(section.id)}" data-group="${esc(section.group)}" aria-labelledby="heading-${esc(section.id)}"><header class="chapter-head"><span class="chapter-number">${String(index+1).padStart(2,'0')}</span><div><span class="eyebrow">${esc(section.group)}</span><h2 id="heading-${esc(section.id)}">${esc(section.title)}</h2><p class="lead">${esc(section.lead||section.summary||'')}</p></div></header>${body}${sources?`<details class="sources"><summary>源码定位与依据 <span>${section.sources.length} 项</span></summary><ul>${sources}</ul><p class="source-note">链接在仓库目录中有效；单独移交 HTML 时，仍可按上述路径与符号检索源码。行号按本次快照定位，后续修改可能变化。</p></details>`:''}<div class="chapter-foot"><a href="#top">回到目录与总览 ↑</a><span>${String(index+1).padStart(2,'0')} / ${sections.length}</span></div></article>`;
}
const groups=[];for(const section of sections){let group=groups.find(g=>g.title===section.group);if(!group){group={title:section.group,sections:[]};groups.push(group);}group.sections.push(section);}
const toc=groups.map((group,index)=>`<section class="toc-group"><h3>${String(index+1).padStart(2,'0')} / ${esc(group.title)}</h3>${group.sections.map(section=>`<a href="#${esc(section.id)}" data-id="${esc(section.id)}">${esc(section.title)}</a>`).join('')}</section>`).join('');
const tokens=[['--ui-canvas','#f1f2f4','画布'],['--ui-tray','#f5f6f8','工具托盘'],['--ui-card','#ffffff','内容表面'],['--ui-text','#24282f','主要文字'],['--ui-secondary','#606976','辅助文字'],['--ui-border','#dfe3e9','边界'],['--ui-hover','#eceff3','悬停'],['--ui-selection','#e9f2ff','选中'],['--ui-primary','#e8f0fb','主要操作'],['--ui-primary-text','#405e82','主要操作文字']];
const tokenHTML=tokens.map(([name,color,label])=>`<button class="swatch" data-copy="${esc(name+': '+color+';')}" title="复制此令牌"><span style="background:${color}"></span><strong>${label}</strong><code>${color}</code><small>${name}</small></button>`).join('');
const media=[];
for(const [file,title,caption]of [
 ['rapid-reading-native-acceptance/rapid-docked-conversation-settled.png','速读与阅读对话栏','2026-10-27 原生隔离文库验收截图。它展示当前白色阅读纸面、独立概览、图表位置和借用的右侧 AI 栏。样例正文受控，不作为真实论文内容质量示例。'],
 ['image-rows-acceptance/inline-figure-complete-explanation-below-image.png','图片证据展开后的内容位置','同轮深色原生验收截图，使用受控文本图检查完整长说明的位置。临时文献与解释是隔离测试数据；该图不作为真实图表提取质量示例。']
]){
 const source=path.resolve(repo,'../.tools/research-native-test-data-reader-repair-1027-final',file);
 try{const data=(await fs.readFile(source)).toString('base64');media.push(`<figure class="real-shot"><button class="shot-open" data-shot="${esc(title)}" aria-label="放大查看：${esc(title)}"><img src="data:image/png;base64,${data}" alt="${esc(title)}" loading="lazy" width="1000" height="706"></button><figcaption><strong>${esc(title)}</strong><p>${esc(caption)}</p></figcaption></figure>`);}catch{console.warn('Screenshot not included:',file);}
}
const sourceRows=[...sourceIndex.values()].sort((a,b)=>a.path.localeCompare(b.path)).map(entry=>`<tr><td><a href="../../${encodeURI(entry.path)}"><code>${esc(entry.path)}</code></a></td><td>${entry.sections.map(s=>`<a class="ref-link" href="#${esc(s.id)}">${esc(s.title)}</a>`).join('')}</td></tr>`).join('');
const css=await fs.readFile(path.join(dir,'handbook.css'),'utf8');
const script=await fs.readFile(path.join(dir,'handbook.js'),'utf8');
const operationCount=sections.reduce((sum,s)=>sum+(s.operations?.length||0),0);
const corpus=sections.map(s=>`${s.title}\n${s.lead||''}\n${JSON.stringify(s)}`).join('\n');
if(/\bsk-[A-Za-z0-9_-]{16,}/.test(corpus))throw Error('Credential-like string in handbook source');
const metadata={title:'EasySch · 设计、操作与工程交接手册',date:'2026-10-27',sections:sections.map(s=>({id:s.id,title:s.title,group:s.group})),sources:[...sourceIndex.values()]};
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="EasySch 研究工作台的操作逻辑、设计系统、字体材质、状态交互、数据缓存与源码交接手册。离线独立HTML。"><title>${esc(metadata.title)}</title><style>${css}</style></head><body><a class="skip" href="#main">跳到正文</a>
<header class="topbar"><a class="identity" href="#top"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m6 24 8-17 3 10 9-11-7 20-4-6-9 4Z" fill="currentColor"/></svg><span>EasySch <small>Design & Operations</small></span></a><div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="search" type="search" placeholder="搜索操作、功能、字体、缓存或源码…" aria-label="搜索手册全文" autocomplete="off"><kbd>Ctrl K</kbd></div><div class="top-actions"><button id="toc-toggle" aria-expanded="false" aria-controls="sidebar">目录</button><button id="print">打印 / PDF</button><button id="source-download" title="下载章节与源码定位索引">源码索引 ↓</button></div></header>
<aside class="sidebar" id="sidebar" aria-label="手册目录"><div class="sidebar-intro"><span class="eyebrow">REFERENCE MANUAL</span><h2>设计与操作交接</h2><p>实现快照 · 2026.10.27</p><div class="reading-progress"><span id="reading-fill"></span></div><div class="reading-meta"><span id="reading-text">阅读总览</span><button id="resume" hidden>继续上次阅读 ↗</button></div></div><nav>${toc}<section class="toc-group"><h3>附录 / 快速索引</h3><a href="#visual-lab">可操作的样式标本</a><a href="#native-screens">原生验收截图</a><a href="#source-index">源码文件索引</a><a href="#handoff-package">移交时带走什么</a></section></nav><footer>离线可读 · 无模型调用<br>内容按源码事实、设计解释与迁移建议区分</footer></aside>
<main id="main"><section class="hero" id="top"><div class="hero-top"><span class="edition">FIELD GUIDE / 2026.10</span><span class="stamp">SOURCE-BASED HANDBOOK</span></div><h1>一套科研工作台，<br>如何被使用与维护。</h1><p class="hero-lead">从文件夹到论文，从一次选择到一份成稿。<br>把每个区域的职责、每次操作的后果、每一种样式的理由写清楚。</p><div class="hero-stats"><div><strong>${sections.length}</strong><span>详细章节</span></div><div><strong>${operationCount}</strong><span>操作说明</span></div><div><strong>${sourceIndex.size}</strong><span>源码定位文件</span></div><div><strong>01</strong><span>可独立移交的 HTML</span></div></div><p class="hero-note">基于当前 EasySch / Zotero 源码与已记录验收整理。页面中的交互标本只演示设计规则；不会访问你的文库、模型或密钥。</p></section>
<section class="reader-routes" aria-label="阅读路线"><div><span class="eyebrow">START WITH A QUESTION</span><h2>你准备怎样使用这份手册？</h2></div><div class="route-buttons"><button data-route="operator" aria-pressed="false">我要上手操作 <span>按任务读</span></button><button data-route="designer" aria-pressed="false">我要学习设计 <span>按规则读</span></button><button data-route="developer" aria-pressed="false">我要接手开发 <span>按对象与源码读</span></button></div><div id="route-output" hidden></div></section>
<section class="legend"><span class="basis">源码事实</span><p>可在对应文件找到的行为或参数。</p><span class="basis interpretation">设计解释</span><p>从当前结构解释其使用价值。</p><span class="basis suggestion">迁移建议</span><p>给下一款软件的可复用做法。</p></section><section id="search-results" hidden aria-live="polite"></section>
<section id="visual-lab" class="lab"><div class="section-label">INTERACTIVE SPECIMENS / 样式标本</div><h2>先触摸规则，再看完整说明。</h2><p class="lab-intro">这里展示真实令牌与交互规则的教学样例。它不是另一版产品页面，也不会对软件执行任何操作。</p>
<div class="specimen"><header><span>01 / 布局职责</span><h3>框架保持稳定，当前对象改变。</h3></header><div class="demo-page-tabs" role="group" aria-label="切换布局职责示意"><button data-map="research" aria-pressed="true">研究对话</button><button data-map="search" aria-pressed="false">文献检索</button><button data-map="writing" aria-pressed="false">论文装配</button><button data-map="ppt" aria-pressed="false">组会 PPT</button></div><div class="workspace-map"><div class="map-native"><b>原生菜单 / 窗口层</b><span>就绪</span><i></i></div><div class="map-global"><b>01</b><span>全局导航<br>文库与工作区</span></div><div class="map-objects"><b>02</b><strong id="map-object-title">会话与本次资料</strong><span id="map-object-copy">当前对话的论文、文件、精选与搜索</span><i></i><i></i><i></i><i></i></div><div class="map-main"><header><b>03</b><strong id="map-main-title">研究对话</strong></header><div class="map-lines"><i></i><i></i><i></i></div><p id="map-main-copy">主任务在这里发生；切会话不应丢草稿与资料范围。</p><div class="map-bottom" id="map-bottom">持续显示的研究对话输入区</div></div><div class="map-context"><b>04</b><strong id="map-context-title">文件预览</strong><span id="map-context-copy">按当前选择呈现内容与上下文</span></div></div><p class="spec-note">结构示意，不是实际截图。窄窗口下允许局部滚动或按需收起上下文，不能用改变所有操作位置来换取宽度。</p></div>
<div class="specimen"><header><span>02 / 色彩与表面</span><h3>同一种语义，使用同一个颜色名字。</h3></header><div class="swatches">${tokenHTML}</div><p class="spec-note">点击色票可复制令牌。色值来自当前 surface-tokens.css，未额外加载字体或配色库。</p></div>
<div class="specimen"><header><span>03 / 字体标本</span><h3>中文、拉丁字母、数字与公式各就其位。</h3></header><div class="type-spec"><p class="type-title">研究目标与主要发现 <span>22 / 600</span></p><p class="type-body">研究问题决定证据如何组织。局部修改应保留原有的来源关系，并说明本次修改作用于哪个段落。<span>15 / 1.85 · 阅读正文标本</span></p><p class="type-ui">文献检索　全部期刊　2026　12.4　PDF　Methods & Results <span>14 / 1.6 · UI 标本</span></p><code>rapidReadDocuments → rapidReads → rapidReadEdits</code></div><p class="spec-note">当前系统可用的字体会影响最后字形。UI字体栈：Bahnschrift → Noto Sans SC → Microsoft YaHei UI → PingFang SC → sans-serif。</p></div>
<div class="specimen"><header><span>04 / 控件状态</span><h3>执行、选择、悬停、禁用有不同的含义。</h3></header><div class="control-demo"><button class="demo-primary" id="demo-save">保存方案</button><button id="demo-normal">查看来源</button><button disabled>处理中…</button><label>第一关键词<input id="demo-keyword" placeholder="例如：量子材料" aria-label="示例第一关键词"></label><div class="popover-demo"><button id="demo-menu-trigger" aria-expanded="false" aria-controls="demo-menu">全部年份 ▾</button><div id="demo-menu" class="demo-menu" hidden><button data-year="全部年份">全部年份</button><button data-year="近一年">近一年</button><button data-year="近五年">近五年</button><button data-year="自定义范围">自定义范围（示意）</button></div></div></div><div class="demo-feedback" id="demo-feedback" aria-live="polite">试着输入、打开菜单，或按 Tab 看焦点。</div><p class="spec-note">这是状态语言样例，不代表检索页所有实际筛选项；实际来源、期刊和年份行为见文献检索章节。</p></div>
<div class="specimen"><header><span>05 / 对话层级与收起方向</span><h3>对话从底边出现，也回到底边。</h3></header><div class="chat-demo-tools"><button id="demo-expand">展开对话</button><button id="demo-collapse">收回底边</button><button id="demo-pin" aria-pressed="false">固定</button><span id="demo-chat-state">当前：收起</span></div><div class="chat-demo-stage" id="chat-stage"><div class="stage-paper"><strong>你的资料和工作区</strong><p>这块内容保持原位置。单击此处让对话变暗，双击此处将其收回底边。</p><i></i><i></i><i></i></div><div class="sample-chat" id="sample-chat" data-open="false" data-dimmed="false"><button class="sample-reveal" id="sample-reveal"><i></i>研究对话</button><div class="sample-shell"><header>当前研究 · 示例 <span>⌄</span></header><div class="sample-messages"><div>所选资料会随会话保留。</div><p>这份回复只演示消息层与输入层的关系。切换模型不会重新生成已经保存的速读。</p></div></div><div class="sample-input"><span>结合当前资料提问…</span><div><small>＋　模型　思考强度</small><b>↑</b></div></div></div></div><p class="spec-note">教学演示采用同类玻璃、托盘与内外圆角关系；真实阅读器还有两侧停靠、可调高度与栏位恢复，详见对话章节。</p></div></section>
<div id="chapters">${sections.map(renderSection).join('')}</div>
<section class="appendix" id="native-screens"><div class="section-label">NATIVE ACCEPTANCE / 原生验收画面</div><h2>用实际运行画面校验规则。</h2><p>截图来自隔离测试文库，不含日常文库资料。它们记录的是该轮验收状态，不能代替后续版本的实际运行检查。</p>${media.join('')}</section>
<section class="appendix" id="source-index"><div class="section-label">IMPLEMENTATION MAP / 源码索引</div><h2>从问题找到负责的文件。</h2><p>每章列出直接相关实现；下表将它们合并，方便接手者按文件回查。目录中保留路径是为了定位，不代表这些文件可以脱离宿主独立运行。</p><div class="table-wrap source-index"><table><thead><tr><th>文件</th><th>本手册中的对应主题</th></tr></thead><tbody>${sourceRows}</tbody></table></div></section>
<section class="appendix handoff-package" id="handoff-package"><div class="section-label">HANDOFF / 最后装进交接包</div><h2>让下一位接手者能复现，而不只会浏览。</h2><ol><li><strong>这份 HTML</strong><p>保存完整文件即可离线查看文字、标本和内嵌截图；打印可另存 PDF。</p></li><li><strong>对应源码快照与版本说明</strong><p>记录分支、提交或工作区快照日期，尤其说明尚未提交的修改。源码链接以当前仓库目录为基准。</p></li><li><strong>匿名样例与环境说明</strong><p>准备可分发的PDF、图片、表格与一套可复现项目，说明Node/Python/渲染器等依赖。</p></li><li><strong>数据备份与设置迁移说明</strong><p>文库、附件、工作区与受保护图片需要一并考虑。API凭据通过独立受控方式配置，不写在这份手册或共享仓库里。</p></li><li><strong>已知限制与验收入口</strong><p>明确哪些路径在真实服务、哪些在受控测试中验证；失败恢复、关闭取消与重启缓存必须可复查。</p></li></ol><aside class="boundary"><h3>本手册的检查范围</h3><p>已检查章节、目录锚点、离线资源、源码路径及摘要指纹，并使用离线 DOM 模型检查搜索、菜单和对话标本等脚本。内置浏览器的本地文件策略阻止了本轮画面复验，实际字体换行、玻璃合成和打印分页仍需在接收者的浏览器中确认。产品历史验收与本手册检查是两类不同记录。</p></aside><p class="end-note">设计的交接单位，应是一条能被理解、执行、观察和维护的操作链。</p></section><footer class="document-footer"><span>EasySch · Design & Operations Handbook</span><span>2026.10.27 / 本地独立文档</span></footer></main><div class="toast" id="toast" role="status" hidden></div><button class="back-top" id="back-top" title="回到总览" aria-label="回到总览">↑</button><dialog id="shot-dialog" aria-label="验收截图大图"><header><strong id="shot-title"></strong><button id="shot-close">关闭大图 ×</button></header><img id="shot-image" alt=""></dialog><script id="handbook-metadata" type="application/json">${JSON.stringify(metadata).replaceAll('<','\\u003c')}</script><script>${script}</script></body></html>`;
await fs.writeFile(path.join(dir,'index.html'),html,'utf8');
await fs.writeFile(path.join(dir,'source-index.json'),JSON.stringify(metadata,null,2),'utf8');
await fs.writeFile(path.join(dir,'build-report.json'),JSON.stringify({date:metadata.date,sections:sections.length,operations:operationCount,sources:sourceIndex.size,missingSources:[...new Set(missing)],bytes:Buffer.byteLength(html),screenshots:media.length},null,2),'utf8');
console.log(JSON.stringify({sections:sections.length,operations:operationCount,sources:sourceIndex.size,missingSources:[...new Set(missing)],bytes:Buffer.byteLength(html),screenshots:media.length},null,2));
