// Headless conversion and conservative mechanical QA; never labels facts as verified.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PNG } from 'pngjs';
const list = v => v ? Array.isArray(v) ? v : [v] : [];
async function run(command, args, signal) {
  return new Promise((resolve,reject) => {
    const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});
    child.stdout.resume(); child.stderr.resume();
    child.on('error',()=>reject(new Error('渲染工具启动失败或超时')));
    child.on('close',code=>code===0?resolve():reject(new Error(`渲染工具退出码 ${code}`)));
  });
}
export async function renderAndInspect(result, config) {
  if (!config?.soffice || !config?.pdftoppm) return {...result,renderStatus:'unconfigured'};
  for (const executable of [config.soffice, config.pdftoppm]) await fs.access(executable);
  const directory=path.dirname(result.path), profile=await fs.mkdtemp(path.join(directory,'lo-profile-'));
  const signal=AbortSignal.any([AbortSignal.timeout(120000),...(config.signal?[config.signal]:[])]);
  await run(config.soffice,[`-env:UserInstallation=${pathToFileURL(profile).href}`,'--headless','--nologo','--nodefault','--nofirststartwizard','--convert-to','pdf','--outdir',directory,result.path],signal);
  const pdf=path.join(directory,'presentation.pdf'), prefix=path.join(directory,'page');
  await fs.access(pdf);
  await run(config.pdftoppm,['-png','-scale-to','1280',pdf,prefix],signal);
  const loading=getDocument({data:new Uint8Array(await fs.readFile(pdf)),useSystemFonts:true,verbosity:0});
  const document=await loading.promise, pages=[], findings=[];
  try {for(let n=1;n<=document.numPages;n++) {
    const page=await document.getPage(n), viewport=page.getViewport({scale:1}), content=await page.getTextContent();
    pages.push({width:viewport.width,height:viewport.height,lines:content.items.filter(i=>i.str?.trim()).map(i=>({xMin:i.transform[4],xMax:i.transform[4]+i.width,yMin:viewport.height-i.transform[5]-i.height,yMax:viewport.height-i.transform[5]}))});
  }} finally {await loading.destroy();}
  const images=(await fs.readdir(directory)).filter(n=>/^page-\d+\.png$/.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if (images.length!==result.slides || pages.length!==result.slides) throw new Error('渲染页数与 PPTX 不一致');
  for (const [index,page] of pages.entries()) {
    const lines=page.lines;
    let warnings=[];
    for (const line of lines) {
      if (line.xMin < -1 || line.yMin < -1 || line.xMax > page.width+1 || line.yMax > page.height+1) warnings.push('文字超出页面边界');
      if (line.yMax-line.yMin < 7) warnings.push('存在过小文字，需核对字号');
    }
    for (let i=0;i<lines.length;i++) for(let j=i+1;j<lines.length;j++) {
      const a=lines[i],b=lines[j],w=Math.min(a.xMax,b.xMax)-Math.max(a.xMin,b.xMin),h=Math.min(a.yMax,b.yMax)-Math.max(a.yMin,b.yMin);
      if(w>3 && h>3 && w*h>0.3*Math.min((a.xMax-a.xMin)*(a.yMax-a.yMin),(b.xMax-b.xMin)*(b.yMax-b.yMin))) warnings.push('文字框可能重叠');
    }
    const png=PNG.sync.read(await fs.readFile(path.join(directory,images[index])));
    let ink=0;for(let i=0;i<png.data.length;i+=4) if(Math.min(png.data[i],png.data[i+1],png.data[i+2])<235) ink++;
    if(!lines.length || ink/(png.width*png.height)<0.001) warnings.push('疑似空白页');
    findings.push({page:index+1,warnings:[...new Set(warnings)],textLines:lines.length,inkRatio:ink/(png.width*png.height)});
  }
  const report={renderer:'LibreOffice + Poppler',status:findings.some(p=>p.warnings.length)?'needs_review':'mechanical_checks_passed',pages:findings,limitations:['文字边界检查不能证明图形未遮挡文字；仍需人工逐页核对。','不验证论文结论和引用事实。']};
  await fs.writeFile(path.join(directory,'render-report.json'),JSON.stringify(report,null,2));
  return {...result,pdf,previews:images.map(n=>path.join(directory,n)),renderStatus:report.status,renderReport:report,visualReview:'human_review_required'};
}
