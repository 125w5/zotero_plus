/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
	renderAssetControls(card, slide, plan, meeting, index) {
		let details=this.el('details');details.className='asset-slide-controls';details.append(this.el('summary','调整本页布局与讲述重点'));
		let label=this.el('label',`第 ${index+1} 页布局`),select=this.el('select');select.setAttribute('aria-label',`第 ${index+1} 页布局`);
		for(let [value,text] of [['original','原图与解释'],['zoom','原图与局部放大'],['panels','多面板实验图'],['compare','两篇论文对比'],['method','方法结构全图'],['formula','公式与含义'],['results','实验结果大图'],['table-focus','表格重点'],['limitations','边界与失败案例'],['question','原图与导师追问']]){let option=this.el('option',text);option.value=value;select.append(option);}
		select.value=slide.layoutType;label.append(select);details.append(label);
		let otherLabel=this.el('label','对比素材或已裁切子图'),other=this.el('select');let empty=this.el('option','不使用第二张图');empty.value='';other.append(empty);
		for(let asset of meeting.assets||[]){if(asset.id===slide.assetIDs[0])continue;let o=this.el('option',`${asset.label} · 第 ${asset.page} 页${asset.userModified?' · 手动裁切':''}`);o.value=asset.id;other.append(o);}
		other.value=slide.assetIDs[1]||'';otherLabel.append(other);details.append(otherLabel);
		let purposeLabel=this.el('label','这一页要让听众理解什么'),purpose=this.el('input');purpose.value=slide.slidePurpose;purpose.maxLength=200;purposeLabel.append(purpose);details.append(purposeLabel);
		let focusLabel=this.el('label','讲述重点'),focus=this.el('input');focus.value=slide.speakerFocus;focus.maxLength=200;focusLabel.append(focus);details.append(focusLabel);
		let save=this.el('button','应用本页调整'),undo=this.el('button','撤销本次调整');undo.hidden=true;details.append(save,undo);
		let original;
		const apply=async next=>{
			plan.slides[index]=next;this.$('meeting-slide-plan').value=JSON.stringify(plan,null,2);
			await this.E.store.update(s=>{s.meetings[meeting.id].slidePlan=plan;});
			this.$('meeting-plan').querySelectorAll('.actual-slide-previews h3').forEach(h=>h.textContent='上次渲染 · 布局已修改，请重新渲染');
			this.status('本页调整已保存；点击“渲染实际 PPTX 逐页预览”核对');
		};
		save.onclick=async()=>{
			try{let next={...plan.slides[index],layoutType:select.value,assetIDs:[slide.assetIDs[0],...(other.value?[other.value]:[])],slidePurpose:purpose.value.trim(),speakerFocus:focus.value.trim()};next.sources=next.assetIDs.map(id=>'A-'+id);
				if(['zoom','compare','panels'].includes(next.layoutType)&&!other.value)throw new Error('这个布局需要选择第二张原图或已裁切子图');
				if(!next.slidePurpose||!next.speakerFocus)throw new Error('请填写本页用途与讲述重点');
				original=structuredClone(plan.slides[index]);await apply(next);undo.hidden=false;
			}catch(e){this.status(e.message,true);}
		};
		undo.onclick=async()=>{if(original){await apply(original);select.value=original.layoutType;purpose.value=original.slidePurpose;focus.value=original.speakerFocus;undo.hidden=true;}};
		card.append(details);
	}
});
