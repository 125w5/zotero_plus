const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
exports.load = (...names) => {
	const context = vm.createContext({ EasySch: { setTimeout, clearTimeout }, URL, AbortController, setTimeout, clearTimeout });
	for (const name of names) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', `${name}.js`), 'utf8'), context);
	return context.EasySch;
};
