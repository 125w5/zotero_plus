/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {Graph} from '@antv/x6';
import {layoutDiagram} from './studio-diagram.mjs';
export async function mount(container,spec,onChange){
 // Native Zotero services return objects from another JavaScript compartment.
 // Layout libraries must receive plain objects and arrays in this window.
 spec=JSON.parse(JSON.stringify(spec));
 const geometry=await layoutDiagram(spec,{direction:container.clientWidth<500?'DOWN':undefined}),graph=new Graph({container,width:Math.max(250,container.clientWidth),height:350,grid:{visible:true,size:10},background:{color:'#FFFFFF'},panning:true,mousewheel:{enabled:true,modifiers:['ctrl','meta']},connecting:{allowBlank:false,allowLoop:false,router:'manhattan',connector:'rounded',snap:true,createEdge(){return graph.createEdge({attrs:{line:{stroke:'#477184',targetMarker:'block'}}});}}});
 for(const n of geometry.nodes)graph.addNode({id:n.id,x:n.x,y:n.y,width:n.width,height:n.height,label:n.label,attrs:{body:{fill:n.userAdded?'#F0EAF7':'#EAF2F6',stroke:'#477184',rx:4,ry:4},label:{fill:'#203C4B',fontSize:14,textWrap:{width:-14,height:-12,ellipsis:true}}},ports:{groups:{in:{position:'left',attrs:{circle:{r:4,magnet:true,stroke:'#477184',fill:'#FFFFFF'}}},out:{position:'right',attrs:{circle:{r:4,magnet:true,stroke:'#477184',fill:'#FFFFFF'}}}},items:[{id:'in',group:'in'},{id:'out',group:'out'}]}});
 for(const [i,e] of geometry.edges.entries())graph.addEdge({id:'edge-'+i,source:{cell:e.source,port:'out'},target:{cell:e.target,port:'in'},vertices:e.points.slice(1,-1),labels:e.relation?[{attrs:{label:{text:e.relation,fontSize:11}}}]:[],attrs:{line:{stroke:'#477184',strokeWidth:1.5,targetMarker:'block'}}});
 // X6 may not have painted SVG cells yet in a freshly selected Zotero tab.
 // Fit using ELK's finite geometry instead of an empty DOM bounding box.
 const width=Math.max(250,container.clientWidth),scale=Math.min(1,(width-30)/geometry.width,320/geometry.height);
 graph.scale(scale,scale);graph.translate((width-geometry.width*scale)/2,(350-geometry.height*scale)/2);
 const save=()=>{const positions={};for(const n of graph.getNodes())positions[n.id]=n.getPosition();const edges=graph.getEdges().map((e,i)=>({source:e.getSourceCellId(),target:e.getTargetCellId(),relation:e.getLabels()?.[0]?.attrs?.label?.text||spec.edges[i]?.relation||'关联'}));onChange({...spec,positions,edges});};
 graph.on('node:moved',save);graph.on('edge:connected',save);
 return graph;
}
