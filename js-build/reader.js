'use strict';

const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const execFile = util.promisify(require('child_process').execFile);
const { getSignatures, writeSignatures, onSuccess, onError } = require('./utils');
const { buildsURL } = require('./config');

async function getReader(signatures) {
	const t1 = Date.now();

	const modulePath = path.join(__dirname, '..', 'reader');
	
	const { stdout } = await exec('git rev-parse HEAD', { cwd: modulePath });
	const hash = stdout.trim();
	
	const targetDir = path.join(__dirname, '..', 'build', 'resource', 'reader');
	const required = ['reader.html', 'reader.js', 'pdf/build/pdf.mjs', 'pdf/build/pdf.worker.mjs',
		'pdf/web/viewer.html', 'pdf/web/viewer.mjs', 'pdf/web/standard_fonts/LiberationSans-Regular.ttf'];
	const complete = (await Promise.all(required.map(file => fs.pathExists(path.join(targetDir, file))))).every(Boolean);
	if (!('reader' in signatures) || signatures['reader'].hash !== hash || !complete) {
		try {
			const filename = hash + '.zip';
			const tmpDir = path.join(__dirname, '..', 'tmp', 'builds', 'reader');
			const url = buildsURL + 'reader/' + filename;

			await fs.remove(targetDir);
			await fs.ensureDir(targetDir);
			await fs.ensureDir(tmpDir);

			const archive = path.join(tmpDir, filename);
			if (!await fs.pathExists(archive)) await execFile('curl', ['-fL', url, '-o', archive]);
			// Windows unzip glob matching can omit descendants of zotero/pdf/.
			// Extract the archive without a mask, then copy the selected platform.
			const unpacked = path.join(tmpDir, 'unpacked-' + hash);
			await fs.ensureDir(unpacked);
			await execFile('unzip', ['-o', archive, '-d', unpacked], { maxBuffer: 16 * 1024 * 1024 });
			await fs.copy(path.join(unpacked, 'zotero'), targetDir);
			await fs.remove(unpacked);
		}
		catch (e) {
			if (!e.message?.includes('The requested URL returned error: 403')) {
				console.error(e);
			}
			await exec('npm ci', { cwd: modulePath });
			await exec('npm run build:zotero', { cwd: modulePath });
			if (!await fs.pathExists(path.join(modulePath, 'build', 'zotero', 'pdf', 'build', 'pdf.mjs'))) {
				throw new Error('pdf.js build failed to produce output');
			}
			await fs.copy(path.join(modulePath, 'build', 'zotero'), targetDir);
		}
		for (let file of required) {
			if (!await fs.pathExists(path.join(targetDir, file))) throw new Error(`Incomplete reader build: ${file}`);
		}
		signatures['reader'] = { hash };
	}
	
	const t2 = Date.now();

	return {
		action: 'reader',
		count: 1,
		totalCount: 1,
		processingTime: t2 - t1
	};
}

module.exports = getReader;

if (require.main === module) {
	(async () => {
		try {
			const signatures = await getSignatures();
			onSuccess(await getReader(signatures));
			await writeSignatures(signatures);
		}
		catch (err) {
			process.exitCode = 1;
			global.isError = true;
			onError(err);
		}
	})();
}
