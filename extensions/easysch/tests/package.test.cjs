const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');
const root = path.join(__dirname, '..');

test('release package has a valid Zotero 7 manifest and every workspace asset', () => {
	execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
	const zip = unzipSync(readFileSync(path.join(root, 'dist/easysch-0.1.0.xpi')));
	const manifest = JSON.parse(strFromU8(zip['manifest.json']));
	for (const key of ['id', 'update_url', 'strict_min_version', 'strict_max_version']) assert.ok(manifest.applications.zotero[key]);
	assert.equal(manifest.applications.zotero.id, 'easysch@local.research');
	assert.ok(!zip['tests/runtime-smoke.js'], 'test automation must not be in production');
	const html = strFromU8(zip['content/workspace.html']);
	for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
		if (match[1] === 'easysch.ftl') continue;
		assert.ok(zip['content/' + match[1]], 'Missing resource: ' + match[1]);
	}
	for (const name of ['MARKED-LICENSE.txt', 'DOMPURIFY-LICENSE.txt', 'KATEX-LICENSE.txt']) assert.ok(zip['content/vendor/' + name]);
});
