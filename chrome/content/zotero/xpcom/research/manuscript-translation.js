/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const A=E.manuscripts,VERSION='fulltext-zh-v5',LAYOUT='pymupdf-translation-layout-v5';
 const documents=new Map(),layouts=new Map(),sourcePages=new WeakMap(),pages=new Map(),jobs=new Map(),listeners=new Map(),failures=new Map();
 const preparing=new Map(),indexing=new Map(),writing=new Map(),editing=new Map();
 const sourceControllers=new Set();
 let queue=Promise.resolve(),folderPromise,stopping=false,backgroundAbortController;
 const sourceController=()=>{
  if(stopping||Zotero.closing)throw Error('软件正在关闭，已停止准备原文');
  let Controller=globalThis.AbortController;
  // PDF import/preparation is independent of a visible library window.
  // Reuse a system-owned constructor if the script global lacks the DOM API.
  if(typeof Controller!=='function'){
   if(!backgroundAbortController){const services=typeof Services==='object'?Services:ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services;backgroundAbortController=new Components.utils.Sandbox(services.scriptSecurityManager.getSystemPrincipal(),{sandboxName:'EasySch translation preparation',wantGlobalProperties:['AbortController']}).AbortController;}
   Controller=backgroundAbortController;
  }
  return new Controller();
 };
 const documentFor=id=>{
  const index=E.store.get('manuscriptIndex',String(id));if(!index?.documentKey)return null;
  let document=documents.get(index.documentKey);
  if(!document){document=E.store.get('manuscriptDocuments',index.documentKey);if(document)documents.set(index.documentKey,document);}
  return document?{key:index.documentKey,document}:null;
 };
 const formulaLine=text=>{
  const line=text.trim();if(line.length>180)return false;
  const symbols=(line.match(/[=≤≥≠∑∫∈∥∞√∂±×÷∝⊤Σλθταβκ∇]/g)||[]).length;
  const words=(line.match(/[A-Za-z]{3,}/g)||[]).length;
  return symbols>0&&words<=8&&(line.includes('=')||symbols>=2||/\(\d{1,3}\)\s*$/.test(line));
 };
 const mathCanonical=text=>String(text||'').normalize('NFKC')
  .replace(/\\(gg|ll|geq?|leq?|neq?|notin|in|subseteq|subset|supseteq|supset|approx|sim|propto|times|cdot|sum|int|partial|nabla|infty|sqrt|sigma|Sigma|theta|Theta|lambda|Lambda|alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|phi|varphi|Phi|tau|kappa|eta|mu|nu|pi|Pi|rho|omega|Omega|top|perp|min|max|log|exp)(?![A-Za-z])/g,(_,command)=>({gg:'≫',ll:'≪',ge:'≥',geq:'≥',le:'≤',leq:'≤',ne:'≠',neq:'≠',notin:'∉',in:'∈',subseteq:'⊆',subset:'⊂',supseteq:'⊇',supset:'⊃',approx:'≈',sim:'∼',propto:'∝',times:'×',cdot:'·',sum:'∑',int:'∫',partial:'∂',nabla:'∇',infty:'∞',sqrt:'√',sigma:'σ',Sigma:'Σ',theta:'θ',Theta:'Θ',lambda:'λ',Lambda:'Λ',alpha:'α',beta:'β',gamma:'γ',Gamma:'Γ',delta:'δ',Delta:'Δ',epsilon:'ε',varepsilon:'ε',phi:'φ',varphi:'φ',Phi:'Φ',tau:'τ',kappa:'κ',eta:'η',mu:'μ',nu:'ν',pi:'π',Pi:'Π',rho:'ρ',omega:'ω',Omega:'Ω',top:'⊤',perp:'⊥',min:'min',max:'max',log:'log',exp:'exp'}[command]))
  // Known font wrappers change presentation, not the enclosed operands.
  // Keep their contents so distribution names and parameters stay guarded.
  .replace(/\\(?:mathrm|mathit|mathbf|mathcal|mathbb|mathscr|operatorname|text)(?![A-Za-z])\s*/g,'')
  .replace(/\\(?:left|right)\s*/g,'').replace(/[{}_$]/g,'')
  .replace(/(?:\u0338|\u0337)\s*=/g,'≠').replace(/\\not\s*=/g,'≠')
  .replace(/!\s*=/g,'≠').replace(/>\s*=/g,'≥').replace(/<\s*=/g,'≤')
  .replace(/>\s*>/g,'≫').replace(/<\s*</g,'≪').replace(/\|\s*\|/g,'∥')
  .replace(/‖/g,'∥').replace(/(^|[^A-Za-zΑ-Ωα-ω0-9])~(?=\s*(?:=|[A-Za-zΑ-Ωα-ω\d]))/g,'$1∼')
  .replace(/[−–]/g,'-').replace(/∆/g,'Δ').replace(/[‘’']/g,'′').replace(/([A-Za-zΑ-Ωα-ω])\s+′/g,'$1′').replace(/\^\s*T\b/g,'⊤');
 const mathRelations=text=>{
  // PDF text often separates a function/distribution name from its argument
  // list. Include that list on both sides rather than comparing only N.
  const normalized=mathCanonical(text).replace(/https?:\/\/\S+/g,''),identifier='[A-Za-zΑ-Ωα-ω][A-Za-zΑ-Ωα-ω0-9]*[\\u2032\\u2033]*(?:\\s*\\([A-Za-zΑ-Ωα-ω0-9+*/.,\\s\\u2032\\u2033-]*\\))?',atom='(?:∥'+identifier+'∥|\\|'+identifier+'\\||'+identifier+'|[+-]?\\d+(?:\\.\\d+)?)';
  const operators='≫|≪|≥|≤|≠|≈|∼|∝|∈|∉|⊆|⊂|⊇|⊃|=|>|<',pattern=new RegExp('('+atom+')\\s*('+operators+')\\s*('+atom+')','g'),relations=[];
  for(const match of normalized.matchAll(pattern)){
   const left=match[1],right=match[3];
   // Ordinary prose around a comparison glyph is not a formula. Preserve
   // variable/function/numeric relations, including their two operands.
   if(!/^[A-Za-z]$|^[A-Z]{2,}$|[Α-Ωα-ω()∥|]|^[+-]?\d/.test(left))continue;
   relations.push({signature:left.replace(/\s+/g,'')+match[2]+right.replace(/\s+/g,''),display:match[0]});
  }
  // Prose such as "held at ≤ 0.02" has a unary bound, not a variable named
  // "at". Retain the bound and value while permitting its surrounding prose
  // to be translated into Chinese.
  for(const match of normalized.matchAll(new RegExp('('+operators+')\\s*('+atom+')','g')))
   if(/^[A-Za-z]$|^[A-Z]{2,}$|[Α-Ωα-ω()∥|]|^[+-]?\d/.test(match[2]))
    relations.push({signature:match[1]+match[2].replace(/\s+/g,''),display:match[0]});
  return relations;
 };
 const mathIntegrityIssue=(source,translation)=>{
  const original=mathCanonical(source),value=mathCanonical(translation),translated=new Set(mathRelations(value).map(relation=>relation.signature));
  for(const relation of mathRelations(original))if(!translated.has(relation.signature))return '译文改变或遗漏数学关系：'+relation.display;
  for(const symbol of new Set(original.match(/[Α-Ωα-ω∑∫∂∇∞√∥⊤⊥∪∩≫≪≥≤≠∈∉⊆⊂⊇⊃∝≈∼✓×±÷]/g)||[]))
   if(!value.includes(symbol))return '译文遗漏关键数学符号：'+symbol;
  const numbers=text=>[...new Set(text.replace(/[一二三四五六七八九十]维/g,word=>(['一','二','三','四','五','六','七','八','九','十'].indexOf(word[0])+1)+'维')
   .replace(/(\d),(?=\d{3}(?:\D|$))/g,'$1').replace(/(\d)\s*-\s*(?=\d)/g,'$1 ').replace(/([+-])\s+(?=\d)/g,'$1')
   .match(/(?<![\dA-Za-z])[-+]\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\s*%?|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\s*%?/g)||[])]
   .map(number=>{const clean=number.replace(/\s+/g,''),percent=clean.endsWith('%');return String(Number(percent?clean.slice(0,-1):clean))+(percent?'%':'');});
  const targetNumbers=new Set(numbers(value));
  for(const number of numbers(original))if(!targetNumbers.has(number))return '译文遗漏或改变原文数值：'+number;
  return null;
 };
 // A model returning one Chinese sentence followed by untranslated English is
 // not a completed translation. Keep this check conservative around acronyms,
 // names, formulas and reference numbers, which can legitimately stay Latin.
 const mathTokens=text=>String(text||'').match(/\bZXQMATH[A-Z0-9]*ZXQ\b/g)||[];
 const inlineMathIssue=(source,translation)=>{
  const expected=mathTokens(source),actual=mathTokens(translation);
  if(actual.some(token=>!expected.includes(token)))return '译文包含其他段落或未知的公式标记';
  for(const token of new Set(expected))if(actual.filter(value=>value===token).length!==1)
   return '译文遗漏或重复行内公式，请保留公式位置';
  if(/ZXQ\s*MATH/i.test(String(translation||'').replace(/\bZXQMATH[A-Z0-9]*ZXQ\b/g,'')))
   return '译文的行内公式标记损坏';
  return null;
 };
 const translationQualityIssue=(source,translation)=>{
  const markerIssue=inlineMathIssue(source,translation);if(markerIssue)return markerIssue;
  // Native equation runs are already protected by the markers. Do not ask
  // the model to recreate their superscripts, subscripts or numeric content.
  const original=String(source||'').replace(/\bZXQMATH[A-Z0-9]*ZXQ\b/g,' '),value=String(translation||'').replace(/\bZXQMATH[A-Z0-9]*ZXQ\b/g,' ').trim();
  if(!original.trim()&&mathTokens(source).length)return null;
  if(!value)return '译文为空';
  // A missing reference number is actionable as a broken citation, rather
  // than a generic numeric error; numerical/formula checks still follow.
  const cited=[...new Set(original.match(/\[\s*\d+(?:\s*[,，、–-]\s*\d+)*\s*\]/g)||[])];
  for(const cite of cited){const digits=cite.match(/\d+/g)||[];
   if(!digits.every(number=>new RegExp('\\b'+number+'\\b').test(value)))return '译文丢失原文引用编号';}
  const mathIssue=mathIntegrityIssue(original,value);if(mathIssue)return mathIssue;
  if(/\bTransformer(?:[- ]based|\s+models?)\b/i.test(original)||/\bTransformer\b/i.test(original)&&/\b(?:CNN|attention|neural|encoder|decoder|network)\b/i.test(original))
   if(/变压器/.test(value))return '神经网络 Transformer 被误译成电气变压器';
  if(/\bfew[-\u2010-\u2015 ]shot\b/i.test(original)&&/少镜头/.test(value))return 'few-shot 被误译为少镜头，应核对少样本学习术语';
  if(/\bProposition\s+\d+/i.test(original)&&/提案/.test(value))return '数学命题 Proposition 被误译为提案';
  const han=(value.match(/[\u3400-\u9fff]/g)||[]).length;
  const sourceLatin=(original.match(/[A-Za-z]/g)||[]).length;
  if(sourceLatin<20){if(!han&&/[a-z]{4,}/.test(original)&&value===original.trim())return '短标题或标签尚未译成中文';return null;}
  if(!han)return '没有生成中文译文';
  const prose=value.replace(/https?:\/\/\S+|\b(?:doi:)?10\.\d{4,9}\/\S+/gi,'');
  const latin=(prose.match(/[A-Za-z]/g)||[]).length;
  if(/[A-Za-z]{28,}/.test(prose))return '出现连续粘连的英文，译文可能损坏';
  if(/(?:\b[a-z]{3,}\b[\s-]+){4,}/.test(prose))return '译文仍包含未翻译的英文句子';
  if(sourceLatin>=60&&latin>Math.max(38,han*3)&&latin/sourceLatin>0.3)
   return '译文仍包含大段英文原文';
  const quantities=[...new Set(original.match(/(?<![A-Za-z])\d+\.\d+\s*%?/g)||[])];
  for(const quantity of quantities)if(!value.includes(quantity.trim()))return '译文丢失原文数值';
  if(sourceLatin>=100&&(original.match(/\b[a-z]{3,}\b/g)||[]).length>=12&&han<sourceLatin*.14)
   return '译文过短，可能只返回摘要';
  if(value.split(/\n+/).filter(line=>/[\u3400-\u9fff]/.test(line)&&line.trim().length<=5).length>=3)
   return '译文被错误拆成零碎短行';
  return null;
 };
 A.translationQualityIssue=translationQualityIssue;
 const proseSource=text=>String(text||'').replace(/([A-Za-z])[-\u00ad]\s*\n\s*(?=[a-z])/g,'$1').replace(/\s*\n\s*/g,' ').replace(/[ \t]+/g,' ').trim();
 const sameSource=(a,b)=>typeof a==='string'&&typeof b==='string'&&proseSource(a)===proseSource(b);
 const originalSource=block=>block.originalText||String(block.sourceText||'').replace(/\bZXQMATH[A-Z0-9]*ZXQ\b/g,
  token=>block.inlineMath?.find(run=>run.placeholder===token)?.sourceText||token);
 const sourceMetadata=block=>({sourceText:block.sourceText,originalText:originalSource(block),inlineMath:block.inlineMath||[],sourceRole:block.sourceRole,translatable:block.translatable,kind:block.kind});
 const mathBindings=block=>JSON.stringify((block.inlineMath||[]).map(run=>({placeholder:run.placeholder,sourceText:proseSource(run.sourceText),
  width:Number(run.width).toFixed(4),height:Number(run.height).toFixed(4),baselineOffset:Number(run.baselineOffset).toFixed(4)})));
 const sameMathBindings=(a,b)=>mathBindings(a)===mathBindings(b);
 const goodRecord=(block,record)=>record?.status==='complete'&&
  (!record.sourceText||record.sourceText===block.sourceText||record.userEdited&&sameSource(record.sourceText,block.sourceText))&&
  (record.userEdited?!inlineMathIssue(record.legacyInlinePlaintext?'':block.sourceText,record.translatedText):sameMathBindings(block,record)&&!translationQualityIssue(block.sourceText,record.translatedText));
 const protectedBlock=block=>['formula','image','table'].includes(block.kind)||block.translatable===false;
 const sourceBlocks=(document,pageIndex)=>{
  let byPage=sourcePages.get(document);
  if(!byPage){byPage=new Map();const source=document.pages?
   document.pages.flatMap(page=>(page.blocks||[]).map(block=>({...block,pageIndex:page.pageIndex}))):document.paragraphs||[];
   for(const [index,p]of source.entries()){
   if(!p.sourceText?.trim()&&!['image','table'].includes(p.kind))continue;
   const block={id:p.sourceRecordID||'P'+index,sourceText:p.sourceText?.trim()||'',originalText:p.originalText?.trim()||p.sourceText?.trim()||'',inlineMath:p.inlineMath||[],position:p.position,
    kind:p.kind||(!p.kind&&formulaLine(p.sourceText)?'formula':'text'),translatable:p.translatable,sourceRole:p.sourceRole,
    visualAsset:p.visualAsset,
    fontSize:p.fontSize,fontFamily:p.fontFamily,fontWeight:p.fontWeight,fontStyle:p.fontStyle,lineHeight:p.lineHeight,
    serif:p.serif,monospace:p.monospace,readingOrder:p.readingOrder};
   const sourcePage=Number.isInteger(p.pageIndex)?p.pageIndex:p.position?.pageIndex;
   if(!Number.isInteger(sourcePage)||sourcePage<0)continue;
   if(!byPage.has(sourcePage))byPage.set(sourcePage,[]);byPage.get(sourcePage).push(block);
  }sourcePages.set(document,byPage);}
  return byPage.get(pageIndex)||[];
 };
 const notify=(key,pageIndex,status)=>{for(const [id,subscribers]of listeners){
  if(documentFor(id)?.key!==key)continue;for(const fn of subscribers)try{fn({pageIndex,status});}catch(error){Zotero.logError(error);}
 }};
 const pageKey=(key,pageIndex)=>key+':'+pageIndex;
 const pageFolder=()=>folderPromise||=(async()=>{const dir=PathUtils.join(E.dataDir,'translation-cache');await IOUtils.makeDirectory(dir,{ignoreExisting:true});return dir;})();
 const pageFile=async(key,pageIndex,version=VERSION)=>PathUtils.join(await pageFolder(),E.assets.key([key,version,pageIndex])+'.json');
 const validLayout=(layout,pdfHash)=>layout?.extractorVersion===LAYOUT&&layout.pdfHash===pdfHash&&
  Array.isArray(layout.pages)&&layout.pageCount===layout.pages.length&&
  layout.pages.every((page,index)=>page.pageIndex===index&&Array.isArray(page.blocks));
 const rebindUserEdits=(key,pageIndex,record)=>{
  const document=layouts.get(key);if(!document||!record)return record;
  const source=new Map(sourceBlocks(document,pageIndex).map(block=>[block.id,block]));
  let changed=false;const recovery=[...(record.recoveryEdits||[])];
  const blocks=record.blocks.flatMap(entry=>{
   const current=source.get(entry.id);
   if(current&&sameSource(originalSource(entry),originalSource(current))&&
    !(entry.userEdited&&mathTokens(entry.translatedText).length&&!sameMathBindings(entry,current))){
    // Correct prose caches need no new API call. Old manually edited prose
    // remains exactly as written, even when it predates native math tokens.
    const legacyInlinePlaintext=!!(entry.userEdited&&mathTokens(current.sourceText).length&&!mathTokens(entry.translatedText).length);
    // Automatic tokens may still spell identically after a crop regrouping,
    // while referring to different equations. Reuse only unchanged bindings.
    if(!entry.userEdited&&!sameMathBindings(entry,current))return [entry];
    const rebound={...entry,...sourceMetadata(current),legacyInlinePlaintext};
    if(JSON.stringify(rebound)!==JSON.stringify(entry)){changed=true;return [rebound];}
    return [entry];
   }
   if(!entry.userEdited)return [entry];
   changed=true;
   if(!recovery.some(old=>old.id===entry.id&&old.revision===entry.revision&&old.translatedText===entry.translatedText))
    recovery.push({...entry,...sourceMetadata(entry),recoveryReason:current&&sameSource(originalSource(entry),originalSource(current))?'行内公式分组已变化，用户译文已保留，请核对后恢复':'原文版式或位置已变化，用户译文已保留，请核对后恢复'});
   return [];
  });
  if(!changed)return record;
  return {...record,blocks,recoveryEdits:recovery,status:'partial'};
 };
 const loadPage=async(key,pageIndex)=>{
  const cacheKey=pageKey(key,pageIndex);if(pages.has(cacheKey)){
   const old=pages.get(cacheKey),current=rebindUserEdits(key,pageIndex,old);
   if(current!==old){pages.set(cacheKey,current);await savePage(key,pageIndex,current);}return current;
  }
  const file=await pageFile(key,pageIndex);let record;
  try{if(await IOUtils.exists(file)){record=JSON.parse(await IOUtils.readUTF8(file));
   if(record.documentKey!==key||record.version!==VERSION||record.pageIndex!==pageIndex||!Array.isArray(record.blocks))record=null;}}
  catch(error){Zotero.logError(error);record=null;}
  let migrated=false;
  if(!record)for(const version of ['fulltext-zh-v4','fulltext-zh-v3'])try{
   const legacy=await pageFile(key,pageIndex,version);
   if(await IOUtils.exists(legacy)){const old=JSON.parse(await IOUtils.readUTF8(legacy));
    if(old.documentKey===key&&old.pageIndex===pageIndex&&Array.isArray(old.blocks)){
     record={...old,version:VERSION,status:'partial',blocks:version==='fulltext-zh-v4'?old.blocks:old.blocks.filter(b=>b.userEdited)};
     migrated=true;break;
    }
   }
  }catch(error){Zotero.logError(error);}
  if(record){const current=rebindUserEdits(key,pageIndex,record);pages.set(cacheKey,current);
   if(migrated||current!==record)await savePage(key,pageIndex,current);else notify(key,pageIndex,current.status);return current;
  }return record;
 };
 const savePage=async(key,pageIndex,record)=>{
  const file=await pageFile(key,pageIndex);
  const cacheKey=pageKey(key,pageIndex),latest=pages.get(cacheKey);
  // A background response cannot overwrite a user edit made while the API
  // request was running. Writes for a page share one durable transaction queue.
  if(latest)record={...record,blocks:record.blocks.map(block=>{
   const current=latest.blocks.find(b=>b.id===block.id);
   return current?.userEdited&&sameSource(current.sourceText,block.sourceText)&&Number(current.revision||0)>=Number(block.revision||0)?current:block;
  })};
  const source=sourceBlocks(layouts.get(key)||documents.get(key)||{},pageIndex);
  if(source.length&&source.every(block=>protectedBlock(block)||goodRecord(block,record.blocks.find(entry=>entry.id===block.id))))record={...record,status:'complete',error:null};
  pages.set(cacheKey,record);notify(key,pageIndex,record.status);
  const write=(writing.get(cacheKey)||Promise.resolve()).catch(()=>{}).then(()=>IOUtils.writeUTF8(file,JSON.stringify(record),{tmpPath:file+'.tmp'}));
  writing.set(cacheKey,write);try{await write;}finally{if(writing.get(cacheKey)===write)writing.delete(cacheKey);}
  return record;
 };
 A.translationPage=(attachmentID,pageIndex)=>{
  const ref=documentFor(attachmentID);if(!ref)return {blocks:[],status:'pending'};
  const layout=layouts.get(ref.key),source=sourceBlocks(layout||ref.document,Number(pageIndex));
  const metadata=layout?.pages?.[Number(pageIndex)]||{};
  if(!source.length)return {documentKey:ref.key,pdfHash:ref.document.pdfHash,pageIndex:Number(pageIndex),width:metadata.width,height:metadata.height,rotation:metadata.rotation,visualAsset:metadata.visualAsset,blocks:[],recoveryEdits:pages.get(pageKey(ref.key,Number(pageIndex)))?.recoveryEdits||[],status:layout?'empty':'pending'};
  const saved=pages.get(pageKey(ref.key,Number(pageIndex))),translated=new Map(saved?.blocks?.map(b=>[b.id,b])||[]);
  const blocks=source.map(block=>{const record=translated.get(block.id),invalid=!protectedBlock(block)&&record?.status==='complete'&&!goodRecord(block,record);
   return {...block,...record,...sourceMetadata(block),...(protectedBlock(block)&&block.kind==='text'?{status:'source',translatedText:undefined,error:null}:invalid?{status:'failed',translatedText:null,error:'缓存译文需要重新核验'}:{})};});
  const sourceMatches=source.every(block=>protectedBlock(block)||translated.has(block.id));
  const pageComplete=saved?.status==='complete'&&source.every(block=>protectedBlock(block)||goodRecord(block,translated.get(block.id)));
  const failed=!pageComplete&&failures.get(ref.key);
  const pageMetadata=layout?.pages?.[Number(pageIndex)]||saved||{};
  return {documentKey:ref.key,pdfHash:ref.document.pdfHash,pageIndex:Number(pageIndex),width:pageMetadata.width,height:pageMetadata.height,rotation:pageMetadata.rotation,visualAsset:pageMetadata.visualAsset,blocks,recoveryEdits:saved?.recoveryEdits||[],
   status:pageComplete?'complete':failed?'failed':sourceMatches&&saved?.status!=='complete'?saved?.status||'pending':'pending',
   error:failed?.message||saved?.error||null};
 };
 A.observeTranslation=(attachmentID,callback)=>{
  const id=Number(attachmentID);if(!listeners.has(id))listeners.set(id,new Set());listeners.get(id).add(callback);
  return ()=>{listeners.get(id)?.delete(callback);if(!listeners.get(id)?.size)listeners.delete(id);};
 };
 const translationText=text=>String(text||'').replace(/\s*\n\s*/g,' ').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1').trim();
 const academicBlock=block=>!!block.inlineMath?.length||mathRelations(block.sourceText).length>0;
 const translateBatch=async(batch,signal)=>{
  const forceAcademic=batch.some(academicBlock);
  if(batch.length===1)return [(await E.quickTranslate(proseSource(batch[0].sourceText),signal,{persist:false,forceAcademic})).text];
  // Local IDs restart at zero in each source block. Scope them only for this
  // request so a response cannot move a formula into a neighbouring passage.
  const scoped=batch.map((block,index)=>{
   const tokens=mathTokens(block.sourceText),map=new Map(tokens.map(token=>[token,token.slice(0,-3)+'B'+index+'ZXQ']));
   return {map,text:proseSource(block.sourceText).replace(/\bZXQMATH[A-Z0-9]*ZXQ\b/g,token=>map.get(token))};
  });
  const input=scoped.map((request,i)=>`ZXQBLOCK${i}ZXQ\n${request.text}`).join('\n\n');
  const reply=(await E.quickTranslate(input,signal,{persist:false,forceAcademic})).text;
  const markers=[...reply.matchAll(/ZXQ\s*BLOCK\s*(\d+)\s*ZXQ/gi)];
  if(markers.length===batch.length&&markers.every((m,i)=>Number(m[1])===i))
   return markers.map((m,i)=>{
    const reverse=new Map([...scoped[i].map].map(([local,request])=>[request,local]));
    const value=reply.slice(m.index+m[0].length,markers[i+1]?.index).trim(),markerIssue=inlineMathIssue(scoped[i].text,value);
    if(markerIssue)return {text:value,markerIssue};
    return value.replace(/\bZXQMATH[A-Z0-9]*ZXQ\b/g,token=>reverse.get(token)||token);
   });
  // A changed delimiter must never bind one paper passage to another.
  const output=[];for(const block of batch)output.push((await E.quickTranslate(proseSource(block.sourceText),signal,{persist:false,forceAcademic:academicBlock(block)})).text);return output;
 };
 const processPage=async(job,pageIndex)=>{
  const {key}=job,source=sourceBlocks(job.layout||job.document,pageIndex);if(!source.length)return;
  const previous=await loadPage(key,pageIndex),old=new Map(previous?.blocks?.map(b=>[b.id,b])||[]);
  if(previous&&source.every(b=>protectedBlock(b)||goodRecord(b,old.get(b.id)))){
   if(previous.status!=='complete')await savePage(key,pageIndex,{...previous,status:'complete',error:null});
   return;
  }
  const next=source.map(b=>protectedBlock(b)?{id:b.id,...sourceMetadata(b),status:'source'}:goodRecord(b,old.get(b.id))?old.get(b.id):{id:b.id,...sourceMetadata(b),status:'pending',revision:Number(old.get(b.id)?.revision||0)});
  const remaining=source.filter(b=>!protectedBlock(b)&&!goodRecord(b,old.get(b.id)));
  const batches=[];let batch=[],length=0;
  for(const block of remaining){if(batch.length&&(batch.length===8||length+block.sourceText.length>4000)){batches.push(batch);batch=[];length=0;}
   batch.push(block);length+=block.sourceText.length;}
  if(batch.length)batches.push(batch);
  const persistProgress=async()=>{
   const complete=next.every(x=>x.status==='complete'||x.status==='source'),metadata=job.layout?.pages?.[pageIndex]||{};
   await savePage(key,pageIndex,{version:VERSION,documentKey:key,pageIndex,width:metadata.width,height:metadata.height,rotation:metadata.rotation,visualAsset:metadata.visualAsset,
    status:complete?'complete':next.some(x=>x.status==='failed')||failures.has(key)?'failed':'partial',
    blocks:next,recoveryEdits:previous?.recoveryEdits||[],updatedAt:new Date().toISOString(),error:next.find(x=>x.status==='failed')?.error||null});
  };
  for(const group of batches){if(stopping||Zotero.closing||job.controller.signal.aborted)throw Error('已停止全文翻译');
   try{const output=await translateBatch(group,job.controller.signal);
    for(let i=0;i<group.length;i++){const block=group[i],record=next.find(x=>x.id===block.id);
     const candidate=output[i];let value=(typeof candidate==='string'?candidate:candidate?.text)?.trim(),issue=candidate?.markerIssue||translationQualityIssue(block.sourceText,value);
     if(issue){try{
      // Retry only the malformed passage with academic translation. Good
      // neighbouring passages remain untouched and keep their source IDs.
      value=(await E.quickTranslate(proseSource(block.sourceText),job.controller.signal,{persist:false,forceAcademic:true})).text?.trim();
      issue=translationQualityIssue(block.sourceText,value);
     }catch(error){if(job.controller.signal.aborted)throw error;issue=error.message||issue;}}
     if(issue){record.status='failed';record.error=issue;continue;}
     record.translatedText=translationText(value);Object.assign(record,sourceMetadata(block));record.status='complete';delete record.error;}
   }catch(error){if(job.controller.signal.aborted)throw error;
    for(const block of group){const record=next.find(x=>x.id===block.id);if(record.status==='complete')continue;record.status='failed';record.error=error.message;}
    if(/配置|密钥|未提供|模型不可用|429|限流|quota|余额|支付|Too Many Requests|401|403|连接失败|超时/i.test(error.message)){
     failures.set(key,{message:error.message,at:Date.now()});break;
    }
   }
   finally{
    // Persist each completed batch, including successful blocks preceding a
    // cancellation. Pending work stays pending; user edits retain priority.
    await persistProgress();
   }
   // Return control to Zotero before the next network batch.
   await Zotero.Promise.delay(15);
  }
  if(!batches.length)await persistProgress();
 };
 const loadLayout=async job=>{
  if(stopping||Zotero.closing||job.controller.signal.aborted)throw Error('软件正在关闭，已停止准备原文');
  if(layouts.has(job.key)){job.layout=layouts.get(job.key);return;}
  const file=PathUtils.join(await pageFolder(),E.assets.key([job.key,LAYOUT])+'.layout.json');let layout;
  try{if(await IOUtils.exists(file)){layout=JSON.parse(await IOUtils.readUTF8(file));
   if(!validLayout(layout,job.document.pdfHash))layout=null;
   if(layout)for(const page of layout.pages)if(page.visualAsset?.path&&!await IOUtils.exists(page.visualAsset.path)){layout=null;break;}
  }}
  catch(error){Zotero.logError(error);layout=null;}
   if(!layout){let attachment=await Zotero.Items.getAsync(job.attachmentID),path=await attachment?.getFilePathAsync?.();
   if(path&&!await IOUtils.exists(path))path=null;
   if(!path)for(const [id,index]of Object.entries(E.store.get('manuscriptIndex')||{})){
    if(index.documentKey!==job.key||Number(id)===job.attachmentID)continue;
     attachment=await Zotero.Items.getAsync(Number(id));const candidate=await attachment?.getFilePathAsync?.();
    if(candidate&&await IOUtils.exists(candidate)){path=candidate;break;}
   }
   if(path){const outputDir=PathUtils.join(await pageFolder(),E.assets.key([job.key,LAYOUT,'visuals']));
    if(stopping||Zotero.closing||job.controller.signal.aborted)throw Error('软件正在关闭，已停止准备原文');
    layout=await E.runArtifactEngine({operation:'manuscript-translation-layout',python:Zotero.Prefs.get('extensions.easysch.assetPython',true),file:path,outputDir},()=>{},job.controller.signal);
    if(stopping||Zotero.closing||job.controller.signal.aborted)throw Error('软件正在关闭，已停止准备原文');
    if(layout.pdfHash!==job.document.pdfHash)throw Error('来源 PDF 已更新，请先重新整理附件');
    if(!validLayout(layout,job.document.pdfHash))throw Error('译文版式提取结果无效');
    await IOUtils.writeUTF8(file,JSON.stringify(layout),{tmpPath:file+'.tmp'});
   }}
  if(layout){layouts.set(job.key,layout);job.layout=layout;
   for(const page of layout.pages)notify(job.key,page.pageIndex,'pending');}
 };
 const ensureDocument=async id=>{
  const current=documentFor(id);if(current)return current;
  if(stopping||Zotero.closing)throw Error('软件正在关闭，已停止准备原文');
  if(indexing.has(id))return indexing.get(id);
  const controller=sourceController();sourceControllers.add(controller);
  const promise=(async()=>{
   const attachment=await Zotero.Items.getAsync(id),file=await attachment?.getFilePathAsync?.();
   if(!file||!await IOUtils.exists(file))throw Error('附件尚未下载到本机，无法准备译文');
   if(stopping||Zotero.closing||controller.signal.aborted)throw Error('软件正在关闭，已停止准备原文');
   // This deterministic text pass has its own queue. Translation must not wait
   // behind every preceding paper's semantic AI/material-analysis request.
   const parsed=await E.runArtifactEngine({operation:'manuscript-index',python:Zotero.Prefs.get('extensions.easysch.assetPython',true),file},()=>{},controller.signal);
   if(stopping||Zotero.closing||controller.signal.aborted)throw Error('软件正在关闭，已停止准备原文');
   if(!parsed.pdfHash||!parsed.paragraphs?.length)throw Error('PDF 原文尚未提取成功，无法后台翻译');
   const key=parsed.pdfHash+':pymupdf-blocks-v2',document={paragraphs:parsed.paragraphs,pdfHash:parsed.pdfHash,parseVersion:'pymupdf-blocks-v2'};
   await E.store.update(s=>{if(stopping||Zotero.closing||controller.signal.aborted)throw Error('软件正在关闭，已停止准备原文');s.manuscriptDocuments||={};s.manuscriptDocuments[key]||=document;s.manuscriptIndex||={};
    s.manuscriptIndex[id]={...s.manuscriptIndex[id],documentKey:key,pdfHash:parsed.pdfHash,parseVersion:'pymupdf-blocks-v2'};});
   documents.set(key,E.store.get('manuscriptDocuments',key)||document);return documentFor(id);
  })().finally(()=>{indexing.delete(id);sourceControllers.delete(controller);});indexing.set(id,promise);return promise;
 };
 const prepare=async(id,{allowClosing=false}={})=>{
  // Admitted edits use their already loaded source and keep draining to disk.
  // Closing must not begin another extraction to serve a late read request.
  const cached=documentFor(id),cachedLayout=cached&&layouts.get(cached.key);
  if(allowClosing&&cached&&cachedLayout)return {...cached,layout:cachedLayout,pageCount:cachedLayout.pageCount};
  if(stopping||Zotero.closing){if(allowClosing&&cached)return {...cached,pageCount:0};throw Error('软件正在关闭，已停止准备原文');}
  const ref=await ensureDocument(id);if(!ref)return null;
  if(stopping)throw Error('软件正在关闭，已停止准备原文');
  if(preparing.has(ref.key))return preparing.get(ref.key);
  let controller;
  const promise=(async()=>{
   controller=sourceController();sourceControllers.add(controller);
   const job={...ref,attachmentID:id,controller};await loadLayout(job);
   if(stopping||Zotero.closing||controller.signal.aborted)throw Error('软件正在关闭，已停止准备原文');
   const count=job.layout?.pageCount||Math.max(0,...(ref.document.paragraphs||[]).map(p=>p.pageIndex+1));
   // Populate every durable page at open/import time, not just the page the
   // user happens to scroll to. File reads are bounded to avoid blocking UI.
   for(let start=0;start<count;start+=8){if(stopping||Zotero.closing||controller.signal.aborted)throw Error('软件正在关闭，已停止准备原文');await Promise.all(Array.from({length:Math.min(8,count-start)},(_,offset)=>loadPage(ref.key,start+offset)));}
   return {...ref,layout:job.layout,pageCount:count};
  })().finally(()=>{preparing.delete(ref.key);if(controller)sourceControllers.delete(controller);});preparing.set(ref.key,promise);return promise;
 };
 A.prepareTranslation=async(attachmentID,{priorityPages=[]}={})=>{
  const id=Number(attachmentID);if(stopping||Zotero.closing)return {pages:[],pageCount:0};
  const ready=await prepare(id);if(!ready)return {pages:[],pageCount:0};
  // Resolve after local data is ready. The network job is deliberately not
  // awaited; its completion arrives through observeTranslation.
  A.queueTranslation(id,{priorityPages}).catch(error=>{if(!stopping&&!Zotero.closing)Zotero.logError(error);});
  return {documentKey:ready.key,pdfHash:ready.document.pdfHash,layoutVersion:ready.layout?.extractorVersion,pageCount:ready.pageCount,
   pages:Array.from({length:ready.pageCount},(_,pageIndex)=>A.translationPage(id,pageIndex))};
 };
 const saveTranslationEdit=async(attachmentID,pageIndex,blockID,text,expected={})=>{
  const id=Number(attachmentID),ref=await ensureDocument(id);if(!ref)throw Error('来源文档不可用');
  if(expected.documentKey&&expected.documentKey!==ref.key)throw Error('来源文档已更新，译文草稿已保留，请核对后重新保存');
  await prepare(id,{allowClosing:true});const source=sourceBlocks(layouts.get(ref.key)||ref.document,Number(pageIndex));
  const block=source.find(b=>b.id===blockID);if(!block||protectedBlock(block))throw Error('该位置不是可编辑译文');
  if(expected.sourceText!==undefined&&expected.sourceText!==block.sourceText)throw Error('原文位置已更新，译文草稿已保留');
  const previous=await loadPage(ref.key,Number(pageIndex));
  const old=previous?.blocks.find(b=>b.id===blockID),revision=Number(old?.revision||0);
  if(expected.expectedRevision!==undefined&&Number(expected.expectedRevision)!==revision)throw Error('译文已在其他位置修改，当前草稿已保留');
  const value=String(text||'').trim();if(!value)throw Error('译文不能为空');
  const legacyInlinePlaintext=!!(old?.legacyInlinePlaintext&&!mathTokens(value).length),issue=inlineMathIssue(legacyInlinePlaintext?'':block.sourceText,value);
  if(issue)throw Error(issue+'，当前草稿已保留');
  const updated={id:blockID,...sourceMetadata(block),translatedText:value,status:'complete',userEdited:true,legacyInlinePlaintext,revision:revision+1,updatedAt:new Date().toISOString()};
  const records=source.map(b=>b.id===blockID?updated:previous?.blocks.find(record=>record.id===b.id)||{id:b.id,...sourceMetadata(b),status:protectedBlock(b)?'source':'pending',revision:0});
  const complete=source.every(b=>protectedBlock(b)||goodRecord(b,records.find(record=>record.id===b.id)));
  await savePage(ref.key,Number(pageIndex),{...previous,version:VERSION,documentKey:ref.key,pageIndex:Number(pageIndex),status:complete?'complete':'partial',blocks:records,updatedAt:updated.updatedAt});
  return {...block,...updated};
 };
 A.saveTranslationEdit=(attachmentID,pageIndex,blockID,text,expected={})=>{
  if(stopping||Zotero.closing)return Promise.reject(Error('软件正在关闭，请重新打开后保存译文'));
  const key=pageKey(documentFor(attachmentID)?.key||String(attachmentID),Number(pageIndex));
  const job=(editing.get(key)||Promise.resolve()).catch(()=>{}).then(()=>saveTranslationEdit(attachmentID,pageIndex,blockID,text,expected));
  editing.set(key,job);return job.finally(()=>{if(editing.get(key)===job)editing.delete(key);});
 };
 const run=async job=>{
  await loadLayout(job);
  const count=job.layout?.pageCount||Math.max(0,...job.document.paragraphs.map(p=>p.pageIndex+1));
  const remaining=new Set(Array.from({length:count},(_,i)=>i));
  while(remaining.size&&!stopping&&!job.controller.signal.aborted&&!failures.has(job.key)){
   const priority=[...job.priorityPages].find(p=>remaining.has(p));const pageIndex=priority??remaining.values().next().value;
   remaining.delete(pageIndex);job.priorityPages.delete(pageIndex);
   await processPage(job,pageIndex);
  }
 };
 A.queueTranslation=async(attachmentID,{priorityPages=[],retry=false}={})=>{
  const id=Number(attachmentID);if(stopping||Zotero.closing)return Promise.resolve();
  const ref=await prepare(id);if(stopping||Zotero.closing||!ref)return;
  const existing=jobs.get(ref.key);
  if(existing){for(const p of priorityPages)if(Number.isInteger(p)&&p>=0)existing.priorityPages.add(p);
   return retry?existing.promise.then(()=>A.queueTranslation(id,{priorityPages,retry:true})):existing.promise;}
  const failure=failures.get(ref.key);
  if(retry||failure&&Date.now()-failure.at>=60000)failures.delete(ref.key);
  else if(failure)return Promise.resolve();
  const job={...ref,attachmentID:id,priorityPages:new Set(priorityPages.filter(p=>Number.isInteger(p)&&p>=0)),controller:sourceController()};
  jobs.set(ref.key,job);
  job.promise=queue=queue.catch(()=>{}).then(()=>run(job)).catch(error=>{if(!stopping){failures.set(ref.key,{message:error.message,at:Date.now()});notify(ref.key,-1,'failed');Zotero.logError(error);}})
   .finally(()=>jobs.delete(ref.key));
  return job.promise;
 };
 Zotero.addShutdownListener(async()=>{
  stopping=true;for(const job of jobs.values())job.controller.abort();for(const controller of sourceControllers)controller.abort();
  const shutdownCounts=()=>`jobs=${jobs.size} preparing=${preparing.size} indexing=${indexing.size} editing=${editing.size} writing=${writing.size} sourceControllers=${sourceControllers.size}`;
  let previousCounts=shutdownCounts();Zotero.debug?.('[EasySch translation shutdown] begin '+previousCounts);
  // A successful save must be on disk before Zotero tears down IO. Work
  // already admitted may create a final cache write while settling, so drain
  // the tracked promises again until no pending operation remains.
  while(jobs.size||preparing.size||indexing.size||editing.size||writing.size){
   await Promise.allSettled([...jobs.values()].map(job=>job.promise).concat(
    [...preparing.values()],[...indexing.values()],[...editing.values()],[...writing.values()]));
   const counts=shutdownCounts();if(counts!==previousCounts){previousCounts=counts;Zotero.debug?.('[EasySch translation shutdown] drain '+counts);}
  }
  Zotero.debug?.('[EasySch translation shutdown] complete '+shutdownCounts());
 });
})(Zotero.Research);
