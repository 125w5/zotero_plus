/* SPDX-License-Identifier: AGPL-3.0-or-later */
import ELK from 'elkjs/lib/elk.bundled.js';
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export async function layoutDiagram(spec,{reset=false,direction}={}) {
 const elk=new ELK();
 const graph=await elk.layout({id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':direction||(['classification_tree','multiscale','module_breakdown'].includes(spec.diagramType)?'DOWN':'RIGHT'),'elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':'44','elk.layered.spacing.nodeNodeBetweenLayers':'70','elk.padding':'[top=35,left=30,bottom=35,right=30]'},children:spec.nodes.map(n=>({id:n.id,width:170,height:n.detail?86:68})),edges:spec.edges.map((e,i)=>({id:'edge-'+i,sources:[e.source],targets:[e.target]}))});
 const nodes=graph.children.map(n=>({...n,...spec.nodes.find(s=>s.id===n.id)}));
 if(nodes.some(n=>![n.x,n.y,n.width,n.height].every(Number.isFinite)))throw Error('ELK 未返回有效节点坐标，请重新自动排列');
 if(!reset&&spec.positions)for(const n of nodes){const p=spec.positions[n.id];if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<10000&&Math.abs(p.y)<10000){n.x=p.x;n.y=p.y;}}
 const map=new Map(nodes.map(n=>[n.id,n]));
 const edges=spec.edges.map((e,i)=>{
  const a=map.get(e.source),b=map.get(e.target),sections=graph.edges[i]?.sections;
  if(!spec.positions&&sections?.length){const s=sections[0];return {...e,points:[s.startPoint,...s.bendPoints||[],s.endPoint]};}
  const right=b.x>=a.x,from={x:a.x+(right?a.width:0),y:a.y+a.height/2},to={x:b.x+(right?0:b.width),y:b.y+b.height/2},mid=(from.x+to.x)/2;
  return {...e,points:[from,{x:mid,y:from.y},{x:mid,y:to.y},to]};
 });
 const minX=Math.min(0,...nodes.map(n=>n.x-20)),minY=Math.min(0,...nodes.map(n=>n.y-20));
 for(const n of nodes){n.x-=minX;n.y-=minY;}for(const e of edges)for(const p of e.points){p.x-=minX;p.y-=minY;}
 return {nodes,edges,width:Math.max(...nodes.map(n=>n.x+n.width))+30,height:Math.max(...nodes.map(n=>n.y+n.height))+30};
}
export function diagramSVG(spec,g) {
 const edges=g.edges.map(e=>`<polyline points="${e.points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#477184" stroke-width="2" marker-end="url(#arrow)"/>${e.relation?`<text x="${e.points[Math.floor(e.points.length/2)].x+4}" y="${e.points[Math.floor(e.points.length/2)].y-6}" font-size="12" fill="#394F5C">${xml(e.relation)}</text>`:''}`).join('');
 const nodes=g.nodes.map(n=>`<g><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="5" fill="${n.userAdded?'#F0EAF7':'#EAF2F6'}" stroke="#477184"/><text x="${n.x+10}" y="${n.y+27}" fill="#203C4B" font-size="15">${xml(n.label)}</text>${n.detail?`<text x="${n.x+10}" y="${n.y+53}" fill="#526873" font-size="11">${xml(n.detail.slice(0,34))}</text>`:''}</g>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" role="img"><title>${xml(spec.title)}</title><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#477184"/></marker></defs>${edges}${nodes}</svg>`;
}
export function diagramDrawio(spec,g) {
 const nodes=g.nodes.map(n=>`<mxCell id="${xml(n.id)}" value="${xml(n.label+(n.detail?'\n'+n.detail:''))}" style="rounded=1;whiteSpace=wrap;html=0;fillColor=#EAF2F6;strokeColor=#477184" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" as="geometry"/></mxCell>`).join('');
 const edges=g.edges.map((e,i)=>`<mxCell id="edge-${i}" value="${xml(e.relation)}" edge="1" parent="1" source="${xml(e.source)}" target="${xml(e.target)}" style="edgeStyle=orthogonalEdgeStyle;endArrow=block;html=0"><mxGeometry relative="1" as="geometry"><Array as="points">${e.points.slice(1,-1).map(p=>`<mxPoint x="${p.x}" y="${p.y}"/>`).join('')}</Array></mxGeometry></mxCell>`).join('');
 return `<mxfile><diagram name="${xml(spec.title)}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${nodes}${edges}</root></mxGraphModel></diagram></mxfile>`;
}
