// Only supplied observations are plotted. No inferred samples or fitted curves.
export function renderDataChart(slide, d, type, box) {
  const base={x:.8,y:1.65,w:11.7,h:4.7,showLegend:d.series.length>1,catAxisLabelFontFace:'Microsoft YaHei',valAxisLabelFontFace:'Microsoft YaHei',catAxisLabelFontSize:14,valAxisLabelFontSize:14,showTitle:false,showValue:false,chartColors:['287B89','DB8753','725D9F'],catAxisTitle:d.xUnit||'',valAxisTitle:d.unit||'',showCatName:false};
  if(box)Object.assign(base,box,{catAxisLabelFontSize:10,valAxisLabelFontSize:10});
  if(type==='heatmap') {
    if(d.labels.length>10) throw new Error('热力图最多10行，请选取需要讲解的子矩阵');
    const values=d.series.flatMap(s=>s.values),min=Math.min(...values),max=Math.max(...values);
    const rows=[['',...d.series.map(s=>s.name)],...d.labels.map((label,i)=>[label,...d.series.map(s=>{
      const t=(s.values[i]-min)/(max-min||1),level=Math.round(245-t*105).toString(16).padStart(2,'0');
      return {text:String(s.values[i]),options:{fill:'D0'+level+'D5',color:'17364A'}};
    })])];
    slide.addTable(rows,{x:.8,y:1.65,w:11.7,h:4.7,...box,fontSize:box?11:16,border:{color:'FFFFFF',pt:1},margin:.08,autoPage:false});
    slide.addNotes('热力图：线性色阶；最小值 '+min+'；最大值 '+max+'；原始值保留于原生表格。');
  } else if(type==='scatter') {
    if(d.labels.some(v=>!String(v).trim()||!Number.isFinite(Number(v)))) throw new Error('散点图横坐标必须为用户提供的真实数值');
    slide.addChart('scatter',[{name:d.xUnit||'X',values:d.labels.map(Number)},...d.series.map(s=>({name:s.name,values:s.values}))],{...base,lineSize:0,lineDataSymbol:'circle',lineDataSymbolSize:6});
  } else slide.addChart(type,d.series.map(s=>({name:s.name,labels:d.labels,values:s.values})),base);
  slide.addText(`数据：${d.provenance.slice(0,110)}${d.unit?' · 单位 '+d.unit:''}${d.sampleSize?' · n='+d.sampleSize:''}`,{x:box?.x??.8,y:box?box.y+box.h+.1:6.15,w:box?.w??11.7,h:.35,fontSize:10,color:'446674',margin:0});
  slide.addNotes(JSON.stringify({provenance:d.provenance,unit:d.unit||'未提供',sampleSize:d.sampleSize||'未提供',data:d,parameters:{type,fit:false}},null,2));
}

