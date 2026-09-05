// Windows without Developer Mode: materialize only Git symlink placeholders for
// the duration of the official build, then restore those paths through Git.
import fs from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
let root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
let tracked = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8' })
	.split('\0').filter(line => line.startsWith('120000 ')).map(line => ({
		hash: line.split(' ')[1], name: line.slice(line.indexOf('\t') + 1)
	}));
let changed = [];
let exitCode = 1;
try {
	for (let entry of tracked) {
		let destination = path.resolve(root, entry.name);
		if (!destination.startsWith(root + path.sep)) throw Error('Unexpected tracked path');
		let stat = await fs.lstat(destination);
		if (stat.isSymbolicLink()) continue;
		let target = execFileSync('git', ['cat-file', 'blob', entry.hash], { cwd: root, encoding: 'utf8' }).trim();
		if (!stat.isFile() || (await fs.readFile(destination, 'utf8')).trim() !== target) {
			throw Error(`Refusing to change modified path: ${entry.name}`);
		}
		let resolved = path.resolve(path.dirname(destination), target);
		if (!resolved.startsWith(root + path.sep)) throw Error(`Link target outside repository: ${entry.name}`);
		await fs.access(resolved);
		await fs.unlink(destination);
		changed.push(entry.name);
		await fs.cp(resolved, destination, { recursive: true, dereference: true });
	}
	let env = { ...process.env, NODE_OPTIONS: '--openssl-legacy-provider' };
	if (process.platform === 'win32') {
		let key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
		env[key] += ';C:\\msys64\\usr\\bin;E:\\Git\\usr\\bin';
	}
	exitCode = await new Promise((resolve, reject) => {
		let proc = spawn(process.execPath, ['js-build/build.js'], { cwd: root, stdio: 'inherit', env });
		proc.on('exit', code => resolve(code ?? 1)); proc.on('error', reject);
	});
}
finally {
	for (let name of changed) {
		let destination = path.resolve(root, name);
		if (!destination.startsWith(root + path.sep) || !tracked.some(e => e.name === name)) throw Error('Unsafe cleanup path');
		await fs.rm(destination, { recursive: true, force: true });
		execFileSync('git', ['-c', 'core.symlinks=false', 'checkout-index', '--force', '--', name], { cwd: root });
	}
}
process.exitCode = exitCode;
