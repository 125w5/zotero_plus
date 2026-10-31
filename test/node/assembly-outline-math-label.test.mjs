/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The left rail's paper structure shows one plain-text line per block. TeX in a
// block (inline $...$ or \(...\), or a formula block's source) is shown as
// readable characters, and the 70-character cut never leaves a $ or a
// backslash behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import {outlineLabel} from '../../chrome/content/zotero/research/manuscript/assembly-navigation.mjs';

let label=(block,materials=[])=>outlineLabel({materials},block);
let noTeX=(value,message)=>assert.doesNotMatch(value,/[$\\]/,message);

test('inline math and formula blocks read as text in the structure',()=>{
	assert.equal(label({type:'paragraph',text:'人工正文：独立批次结果及变量 $x_i^2$。'}),'人工正文：独立批次结果及变量 xᵢ²。');
	assert.equal(label({type:'formula',text:String.raw`E_{\mathrm{F}}=\sum_{i=1}^{n}x_i^2`}),'E_F=∑xᵢ²');
	assert.equal(label({type:'paragraph',text:String.raw`人工正文保留：训练与验证来自独立采集批次。变量 \(x_i\) 表示采集结果。`}),'人工正文保留：训练与验证来自独立采集批次。变量 xᵢ 表示采集结果。');
	assert.equal(label({type:'paragraph',text:String.raw`比率 $\frac{a+b}{2}$、$\sqrt{x^2+1}$、$\alpha\leq\beta$、$e^{i\pi}$、$x_{\max}$、$30^\circ$`}),'比率 (a+b)/2、√(x²+1)、α≤β、e^(iπ)、xₘₐₓ、30°');
	assert.equal(label({type:'formula',text:String.raw`\left\{x\mid x\in A\right\} \text{ 且 } \int_0^1 f(x)\,dx \approx 1`}),'{x| x∈ A} 且 ∫ f(x) dx ≈ 1');
	assert.equal(label({type:'paragraph',text:String.raw`$a\&b$ 与 $a\_b$`}),'a&b 与 a_b');
	assert.equal(label({type:'heading',title:'第 3 章 $\\alpha$ 衰变',text:''}),'第 3 章 α 衰变');
	assert.equal(label({type:'paragraph',text:'',materials:[{id:'m'}]},[{id:'m',title:String.raw`参数 \(\beta\) 的估计`}]),'参数 β 的估计');
	assert.equal(label({type:'formula',text:''}),'公式');
});

test('the same formula in either delimiter gives the same label',()=>{
	assert.equal(label({type:'paragraph',text:'变量 $x_i$'}),label({type:'paragraph',text:String.raw`变量 \(x_i\)`}));
});

test('a long label is cut after the math is converted, never inside it',()=>{
	let text='说明'.repeat(30)+String.raw`信噪比 $\mathrm{SNR}_{\max}=\frac{P_s}{P_n}$ 结束`,value=label({type:'paragraph',text});
	assert.equal(value.length,70);assert.ok(value.endsWith('信噪比 SNRₘₐₓ'),value);noTeX(value);
	for(let block of [{type:'paragraph',text:'人工正文保留：训练与验证来自独立采集批次。变量 \\(x_i\\) 表示采集结果，'.repeat(3)},{type:'formula',text:String.raw`\Delta G=\Delta H-T\Delta S+\sum_{k}\nu_k\mu_k^{\circ}`}])noTeX(label(block),block.text);
});
