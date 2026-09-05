import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let root = fileURLToPath(new URL('../../..', import.meta.url));
let checks = [ ['Node', process.version], ['Source version', readFileSync(resolve(root, 'version'), 'utf8').trim()] ];
for (let args of [['--version'], ['lfs', 'version'], ['rev-parse', '--short', 'HEAD'], ['submodule', 'status', '--recursive']]) {
	let result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	checks.push(['git ' + args.join(' '), result.status === 0 ? result.stdout.trim() : result.stderr?.trim() || 'Unavailable']);
}
for (let path of ['reader/package.json', 'note-editor/package.json', 'document-worker/package.json', 'node_modules']) {
	checks.push([path, existsSync(resolve(root, path)) ? 'OK' : 'MISSING']);
}
for (let [name, result] of checks) console.log(`${name}: ${result}`);
