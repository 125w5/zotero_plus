import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';

let root = fileURLToPath(new URL('..', import.meta.url));
let files = {};
async function add(path) {
	for (let entry of await readdir(path, { withFileTypes: true })) {
		let full = join(path, entry.name);
		if (entry.isDirectory()) await add(full);
		else files[relative(root, full).replaceAll('\\', '/')] = new Uint8Array(await readFile(full));
	}
}
for (let folder of ['src', 'content', 'locale']) await add(join(root, folder));
for (let [name, source] of Object.entries({
	'marked.js': 'marked/lib/marked.umd.js', 'purify.js': 'dompurify/dist/purify.min.js',
	'katex.js': 'katex/dist/katex.min.js', 'auto-render.js': 'katex/dist/contrib/auto-render.min.js',
	'katex.min.css': 'katex/dist/katex.min.css',
	'MARKED-LICENSE.txt': 'marked/LICENSE.md', 'DOMPURIFY-LICENSE.txt': 'dompurify/LICENSE',
	'KATEX-LICENSE.txt': 'katex/LICENSE'
})) files['content/vendor/' + name] = new Uint8Array(await readFile(join(root, 'node_modules', source)));
for (let name of await readdir(join(root, 'node_modules/katex/dist/fonts'))) {
	if (name.endsWith('.woff2')) files['content/vendor/fonts/' + name] = new Uint8Array(await readFile(join(root, 'node_modules/katex/dist/fonts', name)));
}
for (let name of ['manifest.json', 'bootstrap.js']) files[name] = new Uint8Array(await readFile(join(root, name)));
files['LICENSE.txt'] = new Uint8Array(await readFile(resolve(root, '../../COPYING')));
if (process.argv.includes('--dev')) files['tests/runtime-smoke.js'] = new Uint8Array(await readFile(join(root, 'tests/runtime-smoke.js')));
let manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
let output = resolve(root, 'dist', `easysch-${manifest.version}${process.argv.includes('--dev') ? '-dev' : ''}.xpi`);
await mkdir(resolve(root, 'dist'), { recursive: true });
// Stable ZIP timestamps make releases reproducible on the same source tree.
let archive = zipSync(Object.fromEntries(Object.entries(files).sort().map(([key, data]) => [key, [data, { mtime: new Date('2020-01-01T00:00:00Z') }]])), { level: 6 });
await writeFile(output, archive);
await writeFile(output + '.sha256', createHash('sha256').update(archive).digest('hex') + '\n');
console.log(`${output}\n${Object.keys(files).length} files, ${archive.length} bytes`);
