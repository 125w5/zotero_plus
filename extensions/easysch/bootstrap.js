var EasySch;
var chromeHandle;

async function startup({ id, rootURI }) {
	EasySch = { id, rootURI };
	let aom = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup);
	chromeHandle = aom.registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [
		['content', 'easysch', 'content/']
	]);
	let scope = { EasySch, Zotero, Services, Cc, Ci, ChromeUtils, IOUtils, PathUtils, URL };
	for (let name of ['core', 'storage', 'zotero', 'ai', 'export', 'app']) {
		Services.scriptloader.loadSubScript(rootURI + `src/${name}.js`, scope);
	}
	await EasySch.start();
}

function onMainWindowLoad({ window }) { EasySch?.addWindow(window); }
function onMainWindowUnload({ window }) { EasySch?.removeWindow(window); }

async function shutdown() {
	await EasySch?.stop();
	chromeHandle?.destruct();
	chromeHandle = null;
	EasySch = null;
}
function install() {}
function uninstall() {}
