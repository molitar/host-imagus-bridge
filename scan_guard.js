/* Registered only while a scan window exists. Blocks window.open until the background says this tab is NOT the scan tab. */
(() => {
  try {
    const w = window.wrappedJSObject;
    if (!w || w.__hibScanGuard) return;
    w.__hibScanGuard = true;
    const original = w.open;
    let block = true;
    w.open = exportFunction(function () { return block ? null : original.apply(w, arguments); }, window);
    browser.runtime.sendMessage({type: 'hib-scan-is-probe'}).then(r => {
      if (!(r && r.probe)) { block = false; try { w.open = original; } catch (_) { /* keep the wrapper */ } }
    }).catch(() => { block = false; });
  } catch (_) { /* no guard */ }
})();
