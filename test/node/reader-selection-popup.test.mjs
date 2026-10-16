/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import babel from '@babel/core';

const source=await readFile(new URL('../../reader/src/common/components/view-popup/selection-popup.js',import.meta.url),'utf8'),compiled=babel.transformSync(source,{babelrc:false,configFile:false,plugins:['transform-es2015-modules-commonjs'],presets:['@babel/preset-react']}).code;
function fixture(){
 const state=[],annotations=[],modes=[],colors=[['yellow','#ffd400'],['red','#ff6666'],['green','#5fb236'],['blue','#2ea8e5']];let cursor=0;
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const index=cursor++;if(state[index]===undefined)state[index]=initial;return[state[index],value=>state[index]=value];}},exports={},context=vm.createContext({exports,require:name=>name==='react'?React:name==='@fluent/react'?{useLocalization:()=>({l10n:{getString:key=>key}})}:name==='classnames'?((...values)=>values.flatMap(value=>typeof value==='string'?[value]:Object.keys(value).filter(key=>value[key])).join(' ')):name==='../../defines'?{ANNOTATION_COLORS:colors}:name.endsWith('/icons')?{IconColor16:()=>{}}:(()=>{})});vm.runInContext(compiled,context);
 const annotation={text:'Complete selected source paragraph.',position:{pageIndex:2,rects:[[10,20,300,40]]},sortIndex:'00002|000001|00000'},props={params:{rect:[10,20,300,40],annotation},textSelectionAnnotationMode:'highlight',onAddAnnotation:value=>annotations.push(value),onChangeTextSelectionAnnotationMode:value=>modes.push(value)},render=()=>{cursor=0;return exports.default(props);};
 const all=node=>[node,...(node?.props?.children||[]).flat(Infinity).filter(value=>value&&typeof value==='object').flatMap(all)];return{render,all,annotations,modes,annotation,props};
}

test('the actual reader popup lets color and underline be chosen in either order before adding one positioned annotation',()=>{
 const f=fixture();let tree=f.render(),controls=f.all(tree);controls.find(node=>node.props?.['data-annotation-color']==='#5fb236').props.onClick();assert.equal(f.annotations.length,0);tree=f.render();controls=f.all(tree);controls.find(node=>node.props?.['data-annotation-mode']==='underline').props.onClick();assert.equal(f.annotations.length,0);controls=f.all(f.render());assert.equal(controls.find(node=>node.props?.['data-annotation-color']==='#5fb236').props['aria-pressed'],true);assert.equal(controls.find(node=>node.props?.['data-annotation-mode']==='underline').props['aria-pressed'],true);controls.find(node=>node.props?.className?.includes('selection-annotation-save')).props.onClick();assert.equal(f.annotations.length,1);assert.equal(f.annotations[0].color,'#5fb236');assert.equal(f.annotations[0].type,'underline');assert.strictEqual(f.annotations[0].position,f.annotation.position);assert.equal(f.annotations[0].text,f.annotation.text);assert.deepEqual(f.modes,['underline']);
});

test('changing annotation styles preserves the selected color and applies to the current full text selection',()=>{
 const f=fixture();let controls=f.all(f.render());controls.find(node=>node.props?.['data-annotation-mode']==='underline').props.onClick();controls=f.all(f.render());controls.find(node=>node.props?.['data-annotation-color']==='#ff6666').props.onClick();controls=f.all(f.render());controls.find(node=>node.props?.['data-annotation-mode']==='highlight').props.onClick();f.props.params.annotation={...f.annotation,text:'Second full selected paragraph.',position:{pageIndex:3,rects:[[11,25,301,45]]}};controls=f.all(f.render());controls.find(node=>node.props?.className?.includes('selection-annotation-save')).props.onClick();assert.equal(f.annotations.length,1);assert.equal(f.annotations[0].text,'Second full selected paragraph.');assert.equal(f.annotations[0].position.pageIndex,3);assert.equal(f.annotations[0].type,'highlight');assert.equal(f.annotations[0].color,'#ff6666');
});
