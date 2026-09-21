/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 async pptCrop(parent,slide,asset){
  parent.querySelector('.ppt-crop-editor')?.remove();const panel=this.el('section');panel.className='ppt-crop-editor';panel.append(this.el('p','在原图上拖动框选子图。保存为独立素材，原图保留；可用撤销恢复。'));parent.append(panel);
  const canvas=this.el('canvas');canvas.style.cssText='width:100%;height:auto;cursor:crosshair;touch-action:none';panel.append(canvas);
  const img=new Image();img.src=await this.E.previewImage(asset.path);await img.decode();canvas.width=800;canvas.height=Math.round(img.height/img.width*800);const ctx=canvas.getContext('2d');let start,rect;
  const draw=()=>{ctx.drawImage(img,0,0,canvas.width,canvas.height);if(rect){ctx.strokeStyle='#E07327';ctx.lineWidth=3;ctx.strokeRect(...rect);}};draw();
  const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(canvas.width,(e.clientX-r.left)/r.width*canvas.width)),Math.max(0,Math.min(canvas.height,(e.clientY-r.top)/r.height*canvas.height))];};
  canvas.onpointerdown=e=>{start=point(e);canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!start)return;const p=point(e);rect=[Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.abs(p[0]-start[0]),Math.abs(p[1]-start[1])];draw();};canvas.onpointerup=()=>start=null;
  this.pptButton('保存子图并用于当前页',()=>this.pptTask(async(status,signal)=>{if(!rect||rect[2]<10||rect[3]<10)throw Error('请先拖动框选需要讲解的区域');const [x0,y0,x1,y1]=asset.bbox,bbox=[x0+rect[0]/canvas.width*(x1-x0),y0+rect[1]/canvas.height*(y1-y0),x0+(rect[0]+rect[2])/canvas.width*(x1-x0),y0+(rect[1]+rect[3])/canvas.height*(y1-y0)];const crop=await this.E.assets.crop(asset,bbox,status,signal);crop.label=asset.label+' · 我的裁切';await this.pptPatch(d=>{d.assets.push(crop);d.slides.find(s=>s.id===slide.id).assetIDs=[crop.id];},true);}),panel,'primary');
  this.pptButton('取消裁切',()=>panel.remove(),panel);panel.scrollIntoView({block:'nearest'});
 }
});
