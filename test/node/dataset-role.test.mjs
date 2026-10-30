/* SPDX-License-Identifier: AGPL-3.0-or-later */
// F11: an imported table carries its data role, and protocol or planned
// tables never read as measured results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import { datasetMaterial, dataRoleLabel, DATA_ROLES } from '../../chrome/content/zotero/research/manuscript/dataset-role.mjs';

test('the data role is stored and shown in the title, the 说明 and the labels', () => {
	let data = { sheet: 'Sheet1', rows: [['参数', '值'], ['采样率', '20 Hz']] };
	let measured = datasetMaterial(M, data, '/data.csv', 'measured'), protocol = datasetMaterial(M, data, '/data.csv', 'protocol'), planned = datasetMaterial(M, data, '/data.csv', 'planned');
	assert.deepEqual([measured.dataRole, measured.title, measured.kind], ['measured', 'Sheet1', 'experiment']);
	assert.equal(protocol.title, 'Sheet1 · 协议参数（非实验结果）');
	assert.match(protocol.summary, /不是实验结果/);
	assert.match(planned.summary, /尚未执行/);
	assert.equal(protocol.sourceText, JSON.stringify(data.rows), 'the source text stays the exact table');
	assert.equal(dataRoleLabel(protocol), DATA_ROLES.protocol.label);
	assert.equal(dataRoleLabel({ kind: 'experiment' }), '实验数据', 'older tables keep their label');
	assert.equal(datasetMaterial(M, data, '/x.csv', 'unknown').dataRole, 'measured');
});

test('both CSV/XLSX import paths take the data role from the chooser beside the button', async () => {
	let read = name => readFile(new URL('../../chrome/content/zotero/research/manuscript/' + name, import.meta.url), 'utf8');
	let [main, table, details, tools] = await Promise.all(['main.mjs', 'table.mjs', 'module-details.mjs', 'writing-tools.mjs'].map(read));
	assert.match(main, /const dataRole=dataRoleSelect\(document\);row\.append\(dataRole\);button\('导入 CSV \/ XLSX'/);
	assert.match(main, /await importData\(f,dataRole\.value\)/);
	assert.match(main, /export async function importData\(file,role='measured'\)\{const data=await U\.A\.dataset\(file\);const m=datasetMaterial\(M,data,file,role\)/);
	assert.match(table, /const dataRole=dataRoleSelect\(document\);binding\.append\(dataRole\);button\('从文件选择数据'/, 'the role is chosen next to the button; importing stays one click');
	assert.match(table, /const role=dataRole\.value,file=await U\.E\.pick\(/, 'the role is read before the file dialog, so a later block change cannot alter it');
	assert.match(table, /datasetMaterial\(U\.M,data,file,role\)/);
	assert.match(details, /dataRoleLabel\(material\)/);
	assert.match(tools, /dataRoleLabel\(m\)/);
});

test('importing the same file again with another data role gives a separate card; measured imports keep their ids (FLOW-F11-03)', async () => {
	let state = {}, E = { manuscripts: { model: M }, assets: { key: value => JSON.stringify(value) }, store: { update: async fn => fn(state) } };
	let code = await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-writing.js', import.meta.url), 'utf8');
	vm.runInNewContext(code, { Zotero: { Research: E }, ChromeUtils: { importESModule: () => ({}) } });
	let data = { sheet: 'Sheet1', rows: [['参数', '值'], ['采样率', '20 Hz']] }, publish = async role => (await E.manuscripts.publishMaterials([datasetMaterial(M, data, '/data.csv', role)])).cards[0];
	let measured = await publish('measured'), protocol = await publish('protocol'), planned = await publish('planned');
	assert.equal(new Set([measured.id, protocol.id, planned.id]).size, 3, 'each role is its own card');
	assert.deepEqual([protocol.dataRole, protocol.title], ['protocol', 'Sheet1 · 协议参数（非实验结果）']);
	assert.equal((await publish('protocol')).id, protocol.id, 'the same role reuses its card');
	let older = datasetMaterial(M, data, '/data.csv', 'measured');
	delete older.dataRole;
	assert.equal((await E.manuscripts.publishMaterials([older])).cards[0].id, measured.id, 'a table imported before F11 keeps the id of the measured card');
});
