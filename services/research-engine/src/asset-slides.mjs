// Paper pixels stay unchanged. Titles, explanations, callouts and links remain editable.
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';
export const assetLayouts = ['original','zoom','panels','compare','method','formula','results','table-focus','limitations','question'];
export function validateAssetSlide(s) {
  if (!assetLayouts.includes(s.layoutType) || !Array.isArray(s.assetIDs) || !s.assetIDs.length || s.assetIDs.length>4) throw new Error('请选择有效的原图布局与 1–4 个素材');
  for (const key of ['slidePurpose','claim','assetReason','speakerFocus']) if (typeof s[key]!=='string' || !s[key].trim() || s[key].length>500) throw new Error('原图页缺少用途、依据或讲述重点');
  if (!Array.isArray(s.bullets) || s.bullets.length>3 || s.bullets.some(v=>typeof v!=='string'||v.length>120)) throw new Error('原图页最多三条简短说明');
  if (['compare','zoom','panels'].includes(s.layoutType) && s.assetIDs.length<2) throw new Error('对比、放大和多面板布局需要至少两个已确认素材');
}
async function imageData(asset) {
  const bytes=await fs.readFile(asset.path);
  if(bytes.length>20_000_000 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw new Error('只接受已提取的 PNG 论文素材');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width*height>25_000_000) throw new Error('原图过大，请先裁切');
  PNG.sync.read(bytes); // Fully validate our canonical PNG, not arbitrary image formats.
  return {data:'image/png;base64,'+bytes.toString('base64'),width,height};
}
export async function renderAssetSlide(ppt,slide,spec,assets) {
  validateAssetSlide(spec);
  const selected=spec.assetIDs.map(id=>assets.find(a=>a.id===id));
  if(selected.some(a=>!a || a.needsReview || !a.page || !a.uri)) throw new Error('素材不存在或尚未确认图注、裁切与来源');
  if(spec.layoutType==='zoom' && selected[1].parentID!==selected[0].id) throw new Error('放大页第二个素材必须是原图的手动子图');
  const warnings=[], boxes=[];
  const place=async(a,x,y,w,h)=>{
    const image=await imageData(a), scale=Math.min(w/image.width,h/image.height), iw=image.width*scale, ih=image.height*scale;
    slide.addImage({data:image.data,x:x+(w-iw)/2,y:y+(h-ih)/2,w:iw,h:ih});
    const dpi=image.width/iw; if(dpi<130) warnings.push(`${a.label} 分辨率偏低（${Math.round(dpi)} DPI）`);
    boxes.push({assetID:a.id,x,y,w,h,dpi,aspectPreserved:true});
  };
  const note=(text,x,y,w,h,size=20)=>slide.addText(text,{x,y,w,h,fontSize:size,color:'243B4A',margin:0,breakLine:false});
  if(['compare','zoom','panels'].includes(spec.layoutType)) {
    const count=selected.length, cols=2, rows=Math.ceil(count/2), height=4.5/rows;
    for(const [i,a] of selected.entries()) {let x=.65+(i%cols)*6.2,y=1.5+Math.floor(i/cols)*height;await place(a,x,y,5.9,height-.4);note(`${a.label} · 第 ${a.page} 页`,x,y+height-.35,5.9,.3,13);}
    note(spec.bullets.join(' · '),.7,6.05,11.8,.4,17);
  } else if(['method','formula','table-focus','results'].includes(spec.layoutType)) {
    await place(selected[0],.65,1.5,12,4.3);
    note(spec.bullets.slice(0,2).join(' · '),.7,5.95,11.8,.5,18);
  } else {
    await place(selected[0],.65,1.5,8.3,4.8);
    note(spec.layoutType==='question'?'讨论问题':spec.layoutType==='results'?'读图重点':'证据与解释',9.2,1.6,3.4,.5,22);
    spec.bullets.forEach((t,i)=>note(t,9.2,2.35+i*1.15,3.35,1,19));
  }
  // Source is assembled from the asset record, never trusted to the language model.
  const runs=selected.map(a=>({text:`${a.paperTitle?.slice(0,65)||'论文'} · ${a.label} · PDF ${a.page}  `,options:{hyperlink:{url:a.uri}}}));
  slide.addText(runs,{x:.65,y:6.65,w:11.8,h:.45,fontSize:11,color:'446674',margin:0});
  slide.addNotes(JSON.stringify({slidePurpose:spec.slidePurpose,claim:spec.claim,assetReason:spec.assetReason,speakerFocus:spec.speakerFocus,assets:selected.map(a=>({id:a.id,caption:a.caption,source:a.uri,bbox:a.bbox,pdfHash:a.pdfHash,method:a.method}))},null,2));
  return {warnings,boxes};
}
