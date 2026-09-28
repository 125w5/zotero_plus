'use strict';

const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const execFile = util.promisify(require('child_process').execFile);
const { getSignatures, writeSignatures, onSuccess, onError } = require('./utils');
const { buildsURL } = require('./config');

// EasySch reader commits can change only the webpack source while retaining
// the exact PDF.js submodule. In that case a cached parent archive provides
// the identical PDF.js runtime and the locally built reader.js is overlaid.
async function compatibleLocalArchive(modulePath, tmpDir, hash) {
	if (!await fs.pathExists(path.join(modulePath, 'build', 'zotero', 'reader.js'))) return null;
	const { stdout: revisions } = await exec('git rev-list --first-parent HEAD', { cwd: modulePath });
	const { stdout: currentPDF } = await exec(`git rev-parse ${hash}:pdfjs/pdf.js`, { cwd: modulePath });
	for (const revision of revisions.trim().split(/\s+/)) {
		if (!/^[0-9a-f]{40}$/.test(revision)) continue;
		const archive = path.join(tmpDir, revision + '.zip');
		if (!await fs.pathExists(archive)) continue;
		const { stdout: candidatePDF } = await exec(`git rev-parse ${revision}:pdfjs/pdf.js`, { cwd: modulePath });
		if (candidatePDF.trim() === currentPDF.trim()) return { archive, revision };
	}
	return null;
}

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

			let archive = path.join(tmpDir, filename);
			if (!await fs.pathExists(archive)) {
				const compatible = await compatibleLocalArchive(modulePath, tmpDir, hash);
				if (compatible) {
					archive = compatible.archive;
					console.log(`Using cached reader runtime ${compatible.revision}; identical PDF.js submodule, local reader bundle overlaid`);
				}
				else await execFile('curl', ['-fL', url, '-o', archive]);
			}
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
	
	// EasySch builds the modified reader locally. The upstream commit hash does
	// not change for uncommitted source edits, so overlay the actual webpack
	// output instead of silently shipping a cached upstream reader.
	const localDir = path.join(modulePath, 'build', 'zotero');
	if (await fs.pathExists(path.join(localDir, 'reader.js'))) {
		async function copyChanged(dir, relative = '') {
			for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
				const rel = path.join(relative, entry.name), source = path.join(dir, entry.name), destination = path.join(targetDir, rel);
				if (entry.isDirectory()) { await copyChanged(source, rel); continue; }
				if (!entry.isFile()) continue;
				const bytes = await fs.readFile(source);
				if (!await fs.pathExists(destination) || !bytes.equals(await fs.readFile(destination))) {
					await fs.ensureDir(path.dirname(destination));await fs.writeFile(destination, bytes);
				}
			}
		}
		await copyChanged(localDir);
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
