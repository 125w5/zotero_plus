/* SPDX-License-Identifier: AGPL-3.0-or-later */
// F11: an imported table says what it is. Only measured data is an experiment
// result; protocol parameters and planned settings are labeled as such in the
// title, the 说明 and every excerpt the assistant reads.
export const DATA_ROLES = Object.freeze({
	measured: { label: '实测数据', summary: '用户导入的实测数据表；数值来自已完成的实验或测量。' },
	protocol: { label: '协议参数（非实验结果）', summary: '用户导入的实验协议参数表，不是实验结果；不能写成已测得的数据。' },
	planned: { label: '计划设置（未执行）', summary: '用户导入的计划实验设置，实验尚未执行；不能写成已取得的结果。' }
});

export function datasetMaterial(M, data, file, role = 'measured') {
	let value = DATA_ROLES[role] ? role : 'measured', text = JSON.stringify(data.rows);
	return M.material({ title: value === 'measured' ? data.sheet : data.sheet + ' · ' + DATA_ROLES[value].label, kind: 'experiment', dataRole: value, summary: DATA_ROLES[value].summary, file, sourceText: text, data, anchor: { sourceText: text } });
}

export function dataRoleLabel(material) {
	return DATA_ROLES[material?.dataRole]?.label || (material?.kind === 'experiment' ? '实验数据' : '');
}

// The role chooser shown next to each import button; read at import time.
export function dataRoleSelect(doc) {
	let select = doc.createElement('select');
	select.className = 'dataset-role-select'; select.setAttribute('aria-label', '数据类型'); select.title = '只有实测数据会被当作实验结果；协议参数和计划设置会标明“非实验结果”';
	for (let [role, row] of Object.entries(DATA_ROLES)) {
		let option = doc.createElement('option');
		option.value = role; option.textContent = row.label;
		select.append(option);
	}
	select.value = 'measured';
	return select;
}
