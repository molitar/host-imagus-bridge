"use strict";
/* ================================================================================================================================
 * hib_rc411_capture_ui.js  -  HIB's hover / right-click gesture for pages that stream through MediaSource (Mega, Google Drive, ...).
 *
 * Background. For such pages HIB records the segments the page plays (hib_rc360_mse_observer.js) and can replay them in the HIB player
 * window (unified_player.js openCaptured). This script is the same front door HIB uses for every other video:
 *
 *   1. HOVER     over the page's playable preview (a <video> playing a blob: address) for the HOVER TIME set in the toolbar popup
 *                (storage hibHoverVideoDelaySeconds, 1-10 s, default 2).
 *   2. SPINNER   appears on the video while HIB checks that it holds what it needs: captured segments of this tab (an initialisation
 *                segment is what the segment player needs to start). The capture itself is already running: it began when the page
 *                started playing, so the spinner only waits for the first segments if the video was only just started.
 *   3. READY     the spinner turns into a round play badge ("HIB ready: right-click to play").
 *   4. RIGHT-CLICK on the video -> the HIB player window opens over the page (the page's own context menu is suppressed).
 *                A right click while the spinner still shows is remembered and opens the window as soon as the stream is ready.
 *
 * Where each case is handled:
 *   - Video in the TOP document of the tab (Mega):   where HIB's hover player (hover_video_player.js) is active the right-click is
 *     owned by it (claimRightClick -> openPageVideo), which now asks unified_player.js openCapturedHere() before it looks for a stream
 *     address. Where it is not active, this script handles the right-click itself (same path as for iframes, below).
 *     The spinner / badge are always drawn by this script.
 *   - Player inside an IFRAME (Google Drive plays in a cross-origin iframe and covers it with its own control layer in the top page, so
 *     the frame never sees the pointer): the TOP-document instance of this script recognises the large iframe under the pointer
 *     (playerTargetAt kind 'iframe'). Frames that do see the pointer handle their own <video> the same way. Opening always goes
 *     hib-rc387-open-captured -> background -> tabs.sendMessage(top frame, hib-rc387-open-window) -> unified_player.js.
 *
 * Switches / safety:
 *   - Runs only while "Capture streams" is on (storage hibRC360CaptureEnabled); otherwise it does nothing at all.
 *   - Acts only on <video> elements that are large enough to be a player (>= 200 x 120 CSS px) and play a blob: (MediaSource) address.
 *   - Never touches the page's video: no pause, no mute (the HIB window drives the source, muted, by itself).
 *   - Plain right-clicks elsewhere, with a modifier key, or on small videos are left to the page.
 *   - Per-site "video enabled" registration is NOT required: capturing is already an explicit, global opt-in (popup switch).
 * ============================================================================================================================== */
(() => {
  if (window.__hibRc411) return;           // one instance per frame
  window.__hibRc411 = true;

  const isTop = window === window.top;
  const MIN_W = 200, MIN_H = 120;          // smaller videos are previews/ads, not the player the user wants
  const POLL_MS = 700;                     // how often the spinner re-checks for captured segments
  const GIVE_UP_MS = 25000;                // stop waiting (and remove the spinner) if nothing was captured by then
  const DELAY_KEY = 'hibHoverVideoDelaySeconds';
  let delaySec = 2;                        // hover time; kept in sync with the toolbar setting

  /* ---- helpers ------------------------------------------------------------------------------------------------------------ */

  /* Breadcrumbs for bug reports: appear as RC411_* lines in the tab diagnostics (popup -> Diagnostics mode -> Copy Current Tab Diagnostics). */
  const trace = (event, detail) => { try { browser.runtime.sendMessage({ type: 'hib-rc360-log', event: 'RC411_' + event, detail: Object.assign({ top: isTop, host: location.hostname }, detail || {}) }).catch(() => {}); } catch (_) {} };

  /* What is under the pointer that can be "the playable preview"?  Returns {el, kind} or null.
   *   kind 'video'  - a <video> playing a blob: (MediaSource) address, >= 200 x 120 CSS px. Found in any frame.
   *   kind 'iframe' - TOP DOCUMENT ONLY: a large (>= 320 x 180) <iframe> under the pointer. Needed for Google Drive: its player is a
   *                   cross-origin iframe and Drive lays its own control layer over it in the top page, so the frame itself never
   *                   receives the mouse events. Whether that iframe really plays a captured stream is decided by the background
   *                   (hib-rc387-capture-info): the hover indicator only ever becomes "ready" when segments of this tab were captured. */
  function playerTargetAt(e) {
    const direct = e.target instanceof Element ? e.target.closest('video') : null;
    const list = direct ? [direct] : (document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : []);
    for (const el of list) {
      if (el instanceof HTMLVideoElement && el.isConnected) {
        const src = el.currentSrc || el.src || '';
        // MediaSource-backed (blob:) videos only; plain files are handled by the URL player. A video with NO address yet, inside an
        // iframe, is an embedded player that has not been started (Google Drive before play): it counts, because hovering it is what
        // starts it. A not-yet-started video in the top document does not (the page may be about to give it a plain address).
        if (!(src.startsWith('blob:') || (!isTop && src === ''))) continue;
        const r = el.getBoundingClientRect();
        // RC424: where HIB's own hover player is active (a site registered in HIB) the URL player owns the video: no outline, no captured window here.
        if (r.width >= MIN_W && r.height >= MIN_H) { if (isTop && window.__HIB_HOVER_VIDEO__) return null; return { el, kind: 'video' }; }
      }
    }
    if (isTop && document.elementsFromPoint) {
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (el instanceof HTMLIFrameElement && el.isConnected) {
          const r = el.getBoundingClientRect();
          if (r.width >= 320 && r.height >= 180) return { el, kind: 'iframe' };
        }
      }
    }
    /* RC416 kind 'region' - TOP DOCUMENT ONLY: a large element that the PAGE itself labels as a video player (aria-label / role description
     * containing "video player" or "media player"), e.g. a player that has not created its <video>/<iframe> yet. This is the "no player
     * detected" case: the outline still shows so the user knows a right-click will try to load it (wait mode opens the window and starts
     * the page's player). Generic accessibility labels only, no site names. */
    if (isTop && e.target instanceof Element) {
      for (let n = e.target; n && n !== document.documentElement; n = n.parentElement) {
        const label = (n.getAttribute('aria-label') || n.getAttribute('aria-roledescription') || '');
        if (!/(video|media)\s*player/i.test(label)) continue;
        const r = n.getBoundingClientRect();
        if (r.width >= 320 && r.height >= 180) return { el: n, kind: 'region' };
      }
    }
    return null;
  }

  /* Does HIB hold captured segments for this tab? (a RAM lookup in the background; cheap) */
  const captureInfo = () => browser.runtime.sendMessage({ type: 'hib-rc387-capture-info' }).catch(() => null);
  const capturedReady = () => captureInfo().then(r => !!(r && r.ok && r.hasInit));

  /* ---- indicator: spinner -> ready badge -----------------------------------------------------------------------------------------
   * One indicator at a time, anchored to the top-right corner of the video it belongs to (like HIB's other hover indicators) and
   * re-positioned while it is shown because the page can move or resize the player. */
  let ind = null;                          // {video, el, kind:'spinner'|'ready', follow}

  function ensureSpinCss() {
    if (document.getElementById('hib-rc411-spin-css')) return;
    const css = document.createElement('style');
    css.id = 'hib-rc411-spin-css';
    css.textContent = '@keyframes hib-rc411-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
    (document.head || document.documentElement).append(css);
  }
  function place(i) {
    const r = i.video.getBoundingClientRect();
    i.el.style.setProperty('left', Math.max(0, Math.round(r.right - 38)) + 'px', 'important');
    i.el.style.setProperty('top', Math.max(0, Math.round(r.top + 8)) + 'px', 'important');
    if (i.frame) {                                    // dashed outline hugs the video's box
      const f = i.frame.style;
      f.setProperty('left', Math.round(r.left) + 'px', 'important');
      f.setProperty('top', Math.round(r.top) + 'px', 'important');
      f.setProperty('width', Math.round(r.width) + 'px', 'important');
      f.setProperty('height', Math.round(r.height) + 'px', 'important');
    }
  }
  function show(video, kind) {
    clearIndicator();
    ensureSpinCss();
    const el = document.createElement('span');
    el.dataset.hibRc411 = kind;
    if (kind === 'outline') el.style.display = 'none';           // outline only: nothing but the dashed frame is drawn
    const base = 'all:initial!important;position:fixed!important;pointer-events:none!important;z-index:2147483643!important;' +
      'width:28px!important;height:28px!important;border-radius:50%!important;box-sizing:border-box!important;';
    if (kind === 'spinner') {
      el.title = 'Host Imagus Bridge is loading this video';
      el.style.cssText = base + 'background:rgba(12,12,12,.9)!important;border:3px solid rgba(170,170,170,.7)!important;border-top-color:#fff!important;' +
        'animation:hib-rc411-spin .65s linear infinite!important;';
    } else {
      el.title = 'HIB ready: right-click to play';
      el.textContent = '▶';
      el.style.cssText = base + 'display:grid!important;place-items:center!important;background:#111d!important;color:#fff!important;' +
        'border:2px solid #fff!important;font:bold 14px sans-serif!important;';
    }
    document.documentElement.append(el);
    /* READY and OUTLINE (RC415: the frame appears as soon as the hover time has passed, even before anything is captured): an outline around the whole video tells the user "this one can be right-clicked to play in HIB". The style is Imagus
     * Reborn's own "dashed outline" mark-on-hover look (same values as its settings preview): 2px dashed salmon, a white 2px ring, 2px radius.
     * It sits just outside the video's box and never takes mouse events. */
    let frame = null;
    {                                                  // the outline accompanies every state (outline, spinner, ready)
      frame = document.createElement('div');
      frame.dataset.hibRc411 = 'frame';
      frame.style.cssText = 'all:initial!important;position:fixed!important;pointer-events:none!important;z-index:2147483642!important;' +
        'box-sizing:border-box!important;outline:3px dashed rgb(255,120,120)!important;box-shadow:0 0 0 3px #fff!important;border-radius:2px!important;';
      document.documentElement.append(frame);
    }
    ind = { video, el, frame, kind, follow: 0 };
    place(ind);
    ind.follow = setInterval(() => { if (ind && ind.video.isConnected) place(ind); else clearIndicator(); }, 250);
  }
  function clearIndicator() {
    if (!ind) return;
    clearInterval(ind.follow);
    ind.el.remove();
    if (ind.frame) ind.frame.remove();
    ind = null;
  }

  /* ---- hover state machine ------------------------------------------------------------------------------------------------------
   * idle --pointer over a player video--> waiting (hover timer = delaySec)
   *      --timer elapsed--> loading (spinner, polling capture-info)
   *      --captured segments present--> ready (badge)
   *  pointer leaves the video at any step -> idle (everything cancelled). A video is not re-armed while it keeps the pointer. */
  let cur = null;                          // {video, timer, poll, startedAt, openWhenReady}

  function cancel() {
    if (!cur) return;
    clearTimeout(cur.timer);
    clearInterval(cur.poll);
    cur = null;
    clearIndicator();
  }

  function beginLoading(c) {
    // RC415: the dashed outline is drawn as soon as the hover time has passed, on ANY playable preview, even one that was never started
    // (nothing captured yet). It is the "this can be right-clicked to play in HIB" hint; right-click works in every state (wait mode).
    show(c.video, 'outline');
    c.startedAt = Date.now();
    // Spinner/badge are only for a capture that is under way: they are added on top of the outline when capture-info says so.
    captureInfo().then(info => {
      if (cur !== c || !(info && info.ok)) return;
      if (info.hasInit) { trace('READY', {}); show(c.video, 'ready'); }
      else if (info.segments) show(c.video, 'spinner');
    });
    c.poll = setInterval(async () => {
      if (cur !== c) return;
      if (!c.video.isConnected) { cancel(); return; }
      if (Date.now() - c.startedAt > GIVE_UP_MS) { clearInterval(c.poll); c.poll = 0; return; }   // stop polling; the outline stays while hovered
      if (await capturedReady()) {
        clearInterval(c.poll); c.poll = 0;
        if (cur !== c) return;
        trace('READY', {});
        show(c.video, 'ready');
        if (c.openWhenReady) requestOpen();
      }
    }, POLL_MS);
  }

  let moveTraces = 0;                      // first few pointer moves are traced (bug reports: shows whether this frame sees the pointer at all)
  function onMove(e) {
    const t = playerTargetAt(e);
    const v = t && t.el;
    if (moveTraces < 3) { moveTraces++; trace('MOVE', { tag: e.target && e.target.tagName, found: t ? t.kind : null, x: Math.round(e.clientX), y: Math.round(e.clientY) }); }
    if (!v) { cancel(); return; }
    if (cur && cur.video === v) return;               // same video, already armed
    cancel();
    const c = cur = { video: v, timer: 0, poll: 0, startedAt: 0, openWhenReady: false };
    trace('HOVER_ARMED', { delaySec });
    c.timer = setTimeout(() => { if (cur === c) beginLoading(c); }, delaySec * 1000);
  }

  /* ---- right-click inside an iframe -------------------------------------------------------------------------------------------- */
  const requestOpen = () => browser.runtime.sendMessage({ type: 'hib-rc387-open-captured' }).catch(() => {});

  function onRightClick(e) {
    if (e.button !== 2 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    const t = playerTargetAt(e);
    if (!t) return;
    // A real <video> in the TOP document is owned by hover_video_player.js when it is active (site enabled in HIB, see header).
    // Everything else (video in an iframe, a player iframe seen from the top page, top documents where it is not active) is handled here.
    if (isTop && t.kind === 'video' && window.__HIB_HOVER_VIDEO__) return;
    const v = t.el;
    // The page's context menu must be suppressed synchronously, before any asynchronous check answers.
    e.preventDefault();
    e.stopImmediatePropagation();
    trace('RIGHT_CLICK', { type: e.type, kind: t.kind });
    if (e.type !== 'pointerdown') return;             // act once per click (pointerdown); swallow the contextmenu event that follows
    // RC413: open the HIB window AT ONCE (wait mode, see unified_player.js openCapturedHere). It shows "Buffering" and keeps retrying
    // until the first segments exist, then plays. No waiting on the page, whether or not the spinner/badge had finished.
    cancel();
    requestOpen();
  }

  /* ---- start / settings -------------------------------------------------------------------------------------------------------- */
  Promise.all([browser.storage.local.get('hibRC360CaptureEnabled'), browser.storage.local.get(DELAY_KEY)]).then(async ([cap, dl]) => {
    if (!cap || cap.hibRC360CaptureEnabled !== true) return;      // capture switch off: do nothing in this frame
    if (!(await browser.runtime.sendMessage({ type: 'hib-rc462-site-active' }).then(r => !!(r && r.active)).catch(() => false))) return;   // RC462: only on sites in the user's list
    trace('ACTIVE', {});
    const d = Number(dl && dl[DELAY_KEY]);
    if (Number.isInteger(d) && d >= 1 && d <= 10) delaySec = d;
    browser.storage.onChanged.addListener((ch, area) => {          // hover time changed in the popup: follow it live
      if (area !== 'local' || !ch[DELAY_KEY]) return;
      const n = Number(ch[DELAY_KEY].newValue);
      delaySec = Number.isInteger(n) && n >= 1 && n <= 10 ? n : 2;
    });
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('pointerdown', onRightClick, true);
    window.addEventListener('contextmenu', onRightClick, true);
  }).catch(() => {});
})();
