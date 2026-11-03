"use strict";
/* ================================================================================================================================
 * hib_rc410_embed.js  -  loaded by hib_rc363_player.html AFTER hib_rc363_player.js.
 *
 * hib_rc363_player.html / .js is the captured-segment player: it replays the MediaSource segments captured from a source tab
 * (hib_rc360_mse_observer.js -> hib_rc360_diag_bg.js) into its own <video>. It started life as a DIAGNOSTIC page with many buttons and a
 * log. This file lets that same code run in two clearly separated roles, selected by the URL:
 *
 *   1. EMBEDDED PLAYER  (?embed=1&tab=<sourceTabId>)       <- the normal, user-facing role
 *        Loaded in an <iframe> inside the HIB player window that unified_player.js (openCaptured) draws over the source page.
 *        The page chrome (headings, diagnostic buttons, log) is hidden by CSS (html.hib-embed in hib_rc363_player.html), the video fills
 *        the frame, Smooth Buffer and source driving are forced on, and playback starts by itself (the user pressed "Play with HIB").
 *
 *   2. DIAGNOSTICS PAGE  (?tab=<sourceTabId>, opened as a browser tab)     <- support tool only
 *        Marked "DIAGNOSTICS ONLY" and DISABLED unless the user switched on "Diagnostics mode" (storage key hibDiagMode, set from the
 *        toolbar popup). Kept so that a bug report can be reproduced and traced: switch Diagnostics mode on, open the page, press
 *        "Copy Capture Log". Nothing in normal use opens this page any more.
 *
 * Messages (window.postMessage, bridge name 'hib-rc410'), see unified_player.js openCaptured():
 *   this iframe -> parent page : {type:'aspect', width, height}   sent once the real video size is known
 *   parent page -> this iframe : {type:'destroy'}                 close request: cleanup() releases the source video and MediaSource
 *
 * Failure handling: if the player cannot start (nothing captured yet, capture lost, ...) its message is shown over the video, because
 * the log panel is hidden in embedded mode. The log itself is still collected; with Diagnostics mode on a "Log" button reveals it.
 * ============================================================================================================================== */
(() => {
  const BRIDGE = 'hib-rc410';
  const params = new URLSearchParams(location.search);
  const embed = params.get('embed') === '1';
  const $ = id => document.getElementById(id);

  /* Diagnostics mode is a support switch (popup -> Diagnostics). Default OFF. */
  browser.storage.local.get('hibDiagMode').then(d => {
    const diag = !!(d && d.hibDiagMode === true);   // RC510: diagnostics OFF unless switched on
    if (embed) startEmbedded(diag); else markDiagnosticsPage(diag);
  }).catch(() => { if (embed) startEmbedded(false); else markDiagnosticsPage(false); });

  /* ---- role 2: the stand-alone page is diagnostics only ------------------------------------------------------------------- */
  function markDiagnosticsPage(diag) {
    document.title = 'HIB DIAGNOSTICS ONLY - captured-stream player';
    const bar = document.createElement('div');
    bar.id = 'hib-diag-banner';
    bar.style.cssText = 'position:sticky;top:0;z-index:10;margin:-18px -12px 12px;padding:9px 14px;font:13px system-ui;font-weight:700;color:#fff;background:' + (diag ? '#7a4b00' : '#7a1f1f');
    bar.textContent = diag
      ? 'DIAGNOSTICS ONLY - support tool for reproducing bug reports. Normal playback opens inside the page: use "Play with HIB".'
      : 'DIAGNOSTICS ONLY - DISABLED. Turn on "Diagnostics mode" in the HIB toolbar popup to use this page when troubleshooting a bug report. Normal playback opens inside the page: use "Play with HIB".';
    document.body.prepend(bar);
    if (!diag) for (const el of document.querySelectorAll('button, input, select')) el.disabled = true;   // page stays readable, nothing runs
  }

  /* ---- role 1: embedded player -------------------------------------------------------------------------------------------- */
  function startEmbedded(diag) {
    /* RC418: take the SOURCE HOLD: the page's own player is muted while this window plays and is restored (paused if it was paused) when
     * this window closes (the player's pagehide handler sends the release). See hib-rc387-source-hold in hib_rc360_diag_bg.js. */
    const srcTab = Number(params.get('tab'));
    if (Number.isInteger(srcTab)) browser.runtime.sendMessage({ type: 'hib-rc387-source-hold', tabId: srcTab }).catch(() => {});
    document.documentElement.classList.add('hib-embed');

    // Smooth Buffer (length-aware pre-buffer, adaptive cache) is the only sensible mode for users: force it on. The player's own
    // change handler (hib_rc363_player.js) applies the setting. Source driving ("Drive source playback") is already checked in the HTML.
    const smooth = $('rc385kSmooth');
    if (smooth) { smooth.checked = true; smooth.dispatchEvent(new Event('change')); }

    // Message shown over the video when the player cannot start. Fed by the log (see watchLog below).
    const note = document.createElement('div');
    note.id = 'hib-embed-note';
    note.style.cssText = 'position:fixed;left:0;right:0;bottom:48px;z-index:6;margin:0 auto;max-width:90%;padding:8px 12px;border-radius:6px;background:rgba(0,0,0,.78);color:#fff;font:13px system-ui;text-align:center;display:none';
    document.body.append(note);

    // Support builds only: a "Log" button that reveals the (otherwise hidden) log for a bug report.
    if (diag) {
      const b = document.createElement('button');
      b.textContent = 'Log';
      b.style.cssText = 'position:fixed;left:6px;top:6px;z-index:7;opacity:.6';
      b.onclick = () => { const l = $('log'); l.style.cssText = l.style.display === 'block' ? '' : 'display:block!important;position:fixed;inset:34px 0 0 0;z-index:6;background:#000d;margin:0;max-height:none'; };
      document.body.append(b);
    }

    // Tell the HIB window the real video shape (it resizes to match).
    const video = $('video');
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) {
        try { parent.postMessage({ bridge: BRIDGE, type: 'aspect', width: video.videoWidth, height: video.videoHeight }, '*'); } catch (_) {}
      }
    });

    // Close request from the window: release the source video (drive) and the MediaSource. cleanup() is defined in hib_rc363_player.js.
    window.addEventListener('message', e => {
      if (e.source !== parent || !e.data || e.data.bridge !== BRIDGE) return;
      if (e.data.type === 'destroy') { try { cleanup(); } catch (_) {} }
    });

    // The Quality selector (hib_rc398_quality.js) only makes sense for adaptive players (hls.js / dash.js / Shaka). When the source offers no
    // choice it stays disabled, so hide the whole control instead of showing "Not available". Polled because the selector is filled later.
    const q = $('rc398q'), qLabel = q && q.closest('label');
    if (qLabel) {
      qLabel.style.display = 'none';
      setInterval(() => { qLabel.style.display = q.disabled ? 'none' : 'inline-flex'; }, 1000);
    }

    watchLog(note);

    // Start by itself. A short delay lets hib_rc363_player.js finish wiring its buttons.
    setTimeout(() => { const load = $('load'); if (load) load.click(); }, 60);
  }

  /* Over-the-video status. Fed by the player's own log lines (the log panel itself is hidden in embedded mode).
   *   "nothing captured yet"  -> BUFFERING state: a spinner and "Buffering...", and Load is retried every RETRY_MS (up to RETRY_MAX_MS).
   *        This is the normal state right after a right-click opened the window before anything was captured: the player's Load asks the
   *        page for the first segments (as the old diagnostic tab did) and they take a moment to arrive. The first good Load ends it.
   *   any other error line     -> a readable message instead (the player stops retrying).
   * The window never makes the user press anything: it keeps trying until the stream starts or the time is up. */
  const RETRY_MS = 800, RETRY_MAX_MS = 45000;
  let retryStart = 0, retryTimer = 0;
  function watchLog(note) {
    const log = $('log'), video = $('video');
    if (!log) return;
    const spin = document.createElement('span');
    spin.style.cssText = 'display:inline-block;width:14px;height:14px;margin-right:8px;vertical-align:-2px;border-radius:50%;border:2px solid #888;border-top-color:#fff;animation:hibEmbSpin .7s linear infinite';
    const css = document.createElement('style');
    css.textContent = '@keyframes hibEmbSpin{to{transform:rotate(360deg)}}';
    document.head.append(css);
    const buffering = () => { note.replaceChildren(spin, document.createTextNode('Buffering...')); note.style.display = 'block'; };
    const show = () => {
      if (video.readyState > 0 && !video.error) { note.style.display = 'none'; clearTimeout(retryTimer); retryTimer = 0; return; }   // started: done
      const lines = log.textContent.split('\n');
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
        const l = lines[i];
        if (!/STREAM ERROR|NO MEDIA|Capture lost|INTERACTION REQUIRED/.test(l)) continue;
        if (/No captured initialization|NO MEDIA|INTERACTION/.test(l)) {
          if (!retryStart) retryStart = Date.now();
          if (Date.now() - retryStart > RETRY_MAX_MS) {
            note.textContent = 'Nothing could be captured. Start the video on the page, then right-click it again.';
            note.style.display = 'block';
            return;
          }
          buffering();
          if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = 0; const load = $('load'); if (load) load.click(); }, RETRY_MS);   // RETRY
          return;
        }
        note.textContent = 'Playback problem: ' + l.replace(/^.*?(STREAM ERROR|Capture lost)\s*/, '').slice(0, 140);
        note.style.display = 'block';
        return;
      }
      if (!video.readyState) buffering(); else note.style.display = 'none';     // loading normally, or already playing
    };
    new MutationObserver(show).observe(log, { childList: true, characterData: true, subtree: true });
    video.addEventListener('loadedmetadata', show);
    video.addEventListener('playing', show);
    buffering();                                                                  // initial state right after the window opened
  }
})();
