/* SPDX-License-Identifier: AGPL-3.0-or-later */
// EasySch is used mostly on 14-16 inch laptops. At the usual 150% Windows scaling a
// 1920x1200 panel gives the window 1280 CSS px, and every page then runs out of room. On
// such screens the whole interface (text, spacing, controls, icons) is drawn smaller,
// through layout.css.devPixelsPerPx, so the window has about 1536 CSS px, the space a
// 16 inch laptop gives. The arrangement of every page stays as it is. It never goes below
// 80% of the system scaling, and a scale the user set in about:config is left alone.
(function (E) {
	const PREF = 'layout.css.devPixelsPerPx';
	const TARGET_WIDTH = 1536, MIN_RATIO = 0.8;
	E.interfaceScale = function (device, system) {
		if (!(device > 0) || !(system > 0)) return 0;
		let scale = Math.min(system, Math.max(system * MIN_RATIO, device / TARGET_WIDTH));
		return system - scale < 0.03 ? 0 : Math.round(scale * 100) / 100;
	};
	E.applyInterfaceScale = function () {
		let current = Services.prefs.getStringPref(PREF, ''), ours = Zotero.Prefs.get('easysch.interfaceScale.applied', true) || '';
		let clear = () => {
			if (ours && current === ours) Services.prefs.clearUserPref(PREF);
			for (let key of ['applied', 'system', 'device']) Zotero.Prefs.clear('easysch.interfaceScale.' + key, true);
		};
		if (Zotero.Prefs.get('easysch.testProfile', true) || Zotero.Prefs.get('easysch.interfaceScale.auto', true) === false) return clear();
		// A value that is not ours came from the user.
		if (Services.prefs.prefHasUserValue(PREF) && current !== ours) return;
		let screen = Cc['@mozilla.org/gfx/screenmanager;1'].getService(Ci.nsIScreenManager).primaryScreen, x = {}, y = {}, w = {}, h = {};
		screen.GetRect(x, y, w, h);
		let device = w.value, active = ours && current === ours;
		// While our value is in effect Gecko reports it as the screen's scale; use the system
		// scaling recorded when it was set. A different screen is measured on the next start.
		if (active && Zotero.Prefs.get('easysch.interfaceScale.device', true) !== device) return clear();
		let system = active ? Number(Zotero.Prefs.get('easysch.interfaceScale.system', true)) : screen.defaultCSSScaleFactor;
		let scale = E.interfaceScale(device, system);
		if (!scale) return clear();
		let value = String(scale);
		if (current === value) return;
		Services.prefs.setStringPref(PREF, value);
		Zotero.Prefs.set('easysch.interfaceScale.applied', value, true);
		Zotero.Prefs.set('easysch.interfaceScale.system', String(system), true);
		Zotero.Prefs.set('easysch.interfaceScale.device', device, true);
	};
})(EasySch);
