"use strict";
/* ===== START SECTION 3C — SITE ACTIVATION PROBE ===== */

/* RC153 / ACTIVATION_PROBE — read-only page-resident heartbeat.
 * Executes on every HTTP(S) site regardless of HIB registration.
 * NO DOM event handlers, card recognition, media detection or popup scans.
 * The diagnostic monitor uses ping to verify content-script activation.
 */
browser.runtime.onMessage.addListener(message => {
  if (message?.type !== 'hib-rc153-activation-ping') return;
  return Promise.resolve({alive:true,host:location.hostname,url:location.href,readyState:document.readyState,probe:'RC153_ACTIVATION_PROBE'});
});

/* ===== END SECTION 3C — SITE ACTIVATION PROBE ===== */
