/* ===== START IMAGE SECTION - WRAPPED-IMAGE RESOLVERS, BACKGROUND SIDE (hib_img_background.js) =====
 * Brought in from Host_Imagus_Bridge_v2.1.5 (background.js). Everything lives inside ONE function scope so none of its names can collide with the video
 * section's background scripts. Message types answered here: hib-v2-resolve-dlsite, -xxpics, -chain (ouo.io), -imgpv, -generic.
 * One HIB-owned resolver tab at a time (HIB-V218 queue); resolver tabs are inactive and are closed afterwards.
 * Removed from the 2.1.5 file: NHPlayer / 1hanime network capture, site manager, media modes and subtitle fetch (video; rc386 has its own).
 * The NHPlayer helper functions that stay inside the generic resolver are dormant: they only run for nhplayer.com addresses, which the image page script never sends.
 * The source-site list is HIB's image-site list (hibImageSiteHosts) - see the registrar at the end of this file.
 * ===== (original 2.1.5 code follows) ===== */
(() => {
"use strict";

/* ===== START DIAGNOSTIC LOG RING (Tools > Capture Diagnostics) =====
 * Keeps the last 400 add-on log lines ("[HIB ..." only, each cut to 300 characters) in memory so the Capture Diagnostics report can include what the add-on did
 * just before a problem. Memory only; nothing is written to disk and nothing is sent anywhere. The report asks for it with { type: "hib-diag-get-log" }. */
(function () {
  const ring = [];
  for (const k of ["log", "info", "warn", "error"]) {
    const orig = console[k] && console[k].bind(console);
    if (!orig) continue;
    console[k] = (...a) => {
      try {
        const t = a.map(x => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })())).join(" ");
        if (/^\[HIB/.test(t)) {
          ring.push(new Date().toISOString().slice(11, 23) + " " + k + " " + t.slice(0, 300));
          if (ring.length > 400) ring.splice(0, ring.length - 400);
        }
      } catch (e) {}
      return orig(...a);
    };
  }
  browser.runtime.onMessage.addListener(msg => (msg && msg.type === "hib-diag-get-log" ? Promise.resolve({ ok: true, lines: ring.slice() }) : undefined));
})();
/* ===== END DIAGNOSTIC LOG RING ===== */

/* One-card trace producer (store: hib_rc360_diag_bg.js, rc386Push). Records what the resolvers did for the link being worked on: start, retry, result. */
const hibImgTrace = (ev, detail) => { try { if (globalThis.rc386Push) globalThis.rc386Push("RC386_IMG_" + ev, Object.assign({ t: Math.round(performance.now()) }, detail || {})); } catch (e) {} };

/*
 * HIB-V218-GLOBAL-TAB-OWNER
 *
 * Global resolver invariant:
 *
 *   HIB-owned resolver roots <= 1
 *
 * All resolver classes share this queue.
 *
 * Resolver-page children created with target=_blank/window.open are closed.
 */


/* (video network capture / 1hanime Referer rules of 2.1.5 removed: the video section owns them) */
const hibV266NetworkMedia = new Map();

/* HIB-V267-DIAGNOSTIC-TRACKING */
let hibV267LastDiagnosticTabId = null;

const hibV218NativeCreate =
  browser.tabs.create.bind(
    browser.tabs
  );

const hibV218NativeRemove =
  browser.tabs.remove.bind(
    browser.tabs
  );

const hibV218NativeUpdate =
  browser.tabs.update.bind(
    browser.tabs
  );

let hibV218Busy =
  false;

let hibV218OwnedTabId =
  null;

let hibV218LastUserTabId =
  null;

let hibV218Watchdog =
  null;

const hibV218Waiters =
  [];

const hibV218Children =
  new Set();

/*
 * HIB-V221-NOOPENER-ORPHAN-GUARD
 *
 * Some image hosts use rel=noopener/window.open in a way that creates a
 * new tab with no openerTabId. Firefox therefore gives the tab no direct
 * parent relationship to the HIB resolver.
 *
 * We record only tabs born while HIB owns a resolver slot. When the root
 * closes, a candidate is removed only if it ended up on the same host as
 * the owned resolver target.
 */
const hibV221PossibleOrphans =
  new Set();

let hibV221OwnedHost =
  "";

let hibV221OwnedWindowId =
  null;

/* IMAGE SECTION - DLSITE TAB REPLACED BY ANOTHER ADD-ON (e.g. a container add-on closes the resolver tab and opens the page again in a new tab).
 * 2.1.5 saw its own tab vanish, released the slot at once and closed the replacement as an "orphan" - both tabs were gone after ~2 s and nothing was read.
 * While a DLsite resolve is running: the vanished owned tab only sets hibImgOwnedLost (no release, no orphan sweep), a tab opened beside the resolver is NOT
 * closed (the resolver adopts it), and the slot is released when the resolve ends (see resolveDlsite below). Without such an add-on nothing changes. */
let hibImgDlsiteBusy = 0;
let hibImgOwnedLost = false;

async function hibV218Acquire() {
  if (!hibV218Busy) {
    hibV218Busy =
      true;

    return;
  }

  console.log(
    "[HIB v2.1.5 owner] WAITING:",
    "queue=" +
      (hibV218Waiters.length + 1)
  );

  await new Promise(
    resolve => {
      hibV218Waiters.push(
        resolve
      );
    }
  );
}

function hibV218Release(reason) {
  hibImgScheduleSweep();                     /* IMAGE SECTION: stray-tab safety net (defined below) */
  if (hibV218Watchdog) {
    clearTimeout(
      hibV218Watchdog
    );

    hibV218Watchdog =
      null;
  }

  console.log(
    "[HIB v2.1.5 owner] RELEASE:",
    hibV218OwnedTabId,
    reason,
    "queue=" +
      hibV218Waiters.length
  );

  hibV218OwnedTabId =
    null;

  hibV218Children.clear();

  hibV221PossibleOrphans.clear();

  hibV221OwnedHost =
    "";

  hibV221OwnedWindowId =
    null;

  if (hibV218Waiters.length) {
    /* IMAGE SECTION: newest request first. Only one resolver tab runs at a time; the link the user is hovering NOW must not wait behind older
     * hovers from other pages (their spinners may already be gone). Older jobs still run afterwards (each has its own 10 s start check). */
    const next =
      hibV218Waiters.pop();

    next();

    return;
  }

  hibV218Busy =
    false;
}

async function hibV218CaptureUserTab() {
  try {
    const tabs =
      await browser.tabs.query({
        active:
          true,

        currentWindow:
          true
      });

    if (
      tabs &&
      tabs.length &&
      typeof tabs[0].id ===
        "number"
    ) {
      hibV218LastUserTabId =
        tabs[0].id;
    }
  }
  catch (error) {}
}

async function hibV218RestoreUserTab() {
  if (
    typeof hibV218LastUserTabId !==
      "number"
  ) {
    return;
  }

  try {
    await hibV218NativeUpdate(
      hibV218LastUserTabId,
      {
        active:
          true
      }
    );
  }
  catch (error) {}
}


/*
 * HIB-V270-NHPLAYER-POPUP-HELPER
 */
let hibV270CreatingPopup = false;
let hibV270OriginalWindowId = null;

async function hibV270CreateNHPlayerPopup(safe) {
  const originalUserTabId = hibV218LastUserTabId;
  let originalWindowId = null;

  try {
    if (typeof originalUserTabId === "number") {
      const userTab = await browser.tabs.get(
        originalUserTabId
      );

      originalWindowId = userTab.windowId;
    }
  }
  catch (error) {
    // The previously focused user tab was closed.
  }

  const options = {
    url: "about:blank",
    type: "popup",
    focused: false,
    width: 480,
    height: 320
  };

  if (typeof originalWindowId === "number") {
    try {
      const originalWindow = await browser.windows.get(
        originalWindowId
      );

      if (
        Number.isFinite(originalWindow.left) &&
        Number.isFinite(originalWindow.top)
      ) {
        options.left = originalWindow.left + 100;
        options.top = originalWindow.top + 100;
      }
    }
    catch (error) {
      // Browser chooses popup placement.
    }
  }

  hibV270CreatingPopup = true;
  hibV270OriginalWindowId = originalWindowId;

  let popup = null;
  let tab = null;

  try {
    popup = await browser.windows.create(options);

    tab = popup && Array.isArray(popup.tabs)
      ? popup.tabs[0]
      : null;

    if (
      !tab ||
      typeof tab.id !== "number" ||
      typeof popup.id !== "number" ||
      tab.windowId !== popup.id
    ) {
      throw new Error(
        "NHPlayer popup did not return its owned tab"
      );
    }

    /*
     * Establish root ownership before releasing
     * the popup-creation guard.
     */
    hibV218OwnedTabId = tab.id;

    /*
     * HIB-V271-NHPLAYER-TAB-MUTE
     * Apply Firefox tab muting BEFORE site navigation.
     */
    await browser.tabs.update(tab.id, {
      muted: true
    });

    const hibV271TabState = await browser.tabs.get(tab.id);

    if (
      !hibV271TabState.mutedInfo ||
      hibV271TabState.mutedInfo.muted !== true
    ) {
      throw new Error(
        "NHPlayer tab mute verification failed"
      );
    }

    console.log(
      "[HIB v2.1.5 NHPlayer] TAB MUTED:",
      JSON.stringify({
        tabId: tab.id,
        muted: true
      })
    );

    /*
     * HIB-V271-MUTED-NAVIGATION
     */
    await browser.tabs.update(tab.id, {
      url: safe.url
    });

    console.log(
      "[HIB v2.1.5 NHPlayer] MUTED NAVIGATION STARTED"
    );

    console.log(
      "[HIB v2.1.5 NHPlayer] POPUP CREATED:",
      JSON.stringify({
        tabId: tab.id,
        windowId: popup.id,
        width: 480,
        height: 320,
        active: tab.active === true,
        originalWindowKnown:
          typeof originalWindowId === "number"
      })
    );

    /*
     * Firefox may still focus a newly created
     * popup despite focused:false.
     *
     * Restore the previous window only if
     * the resolver popup received focus.
     */
    if (
      typeof originalWindowId === "number" &&
      originalWindowId !== popup.id
    ) {
      try {
        const focused = await browser.windows.getLastFocused();

        if (
          focused &&
          focused.id === popup.id
        ) {
          await browser.windows.update(
            originalWindowId,
            { focused: true }
          );

          console.log(
            "[HIB v2.1.5 NHPlayer] ORIGINAL WINDOW RESTORED"
          );
        }
      }
      catch (error) {
        console.warn(
          "[HIB v2.1.5 NHPlayer] Focus restoration unavailable:",
          error && error.name
            ? error.name
            : "UnknownError"
        );
      }
    }

    return tab;
  }
  catch (error) {
    /*
     * Close only the popup created by this attempt.
     * Never close an existing user window.
     */
    if (
      popup &&
      typeof popup.id === "number"
    ) {
      try {
        await browser.windows.remove(popup.id);
      }
      catch (closeError) {}
    }

    throw error;
  }
  finally {
    hibV218LastUserTabId = originalUserTabId;
    hibV270CreatingPopup = false;
    hibV270OriginalWindowId = null;
  }
}

/* ===== IMAGE SECTION - TAB-NEVER-STARTED RETRY (new in rc386) =====
 * With very many open tabs Firefox sometimes never starts loading a tab that was created unfocused, so the resolver waits for nothing. Every resolver tab goes
 * through hibV218CreateOwnedTab; right after it is created we wait up to 10 s for its navigation to START (webNavigation.onBeforeNavigate). If it did not, the
 * tab is closed and ONE fresh unfocused tab is opened (only one retry). The owner slot stays held the whole time (the id is cleared before the old tab closes
 * so its removal does not release the slot). */
const HIB_IMG_START_WAIT_MS = 10000;
const hibImgNavStarted = new Set();
browser.webNavigation.onBeforeNavigate.addListener(d => { if (d.frameId === 0) hibImgNavStarted.add(d.tabId); });
browser.tabs.onRemoved.addListener(id => { hibImgNavStarted.delete(id); });
async function hibImgWaitStarted(id) {
  const t0 = Date.now();
  while (Date.now() - t0 < HIB_IMG_START_WAIT_MS) {
    if (hibImgNavStarted.has(id)) return true;
    try { if ((await browser.tabs.get(id)).status === "complete") return true; } catch (e) { return true; }   // tab gone = another add-on (e.g. a container add-on) replaced it: NOT a failed start, the resolver adopts the replacement itself
    await new Promise(r => setTimeout(r, 250));
  }
  return hibImgNavStarted.has(id);
}
async function hibImgEnsureStarted(tab, props) {
  if (/nhplayer\.com|(^|[/.])dlsite\.com/i.test(String(props && props.url))) return tab;       // DLsite (and the dormant video helper): exactly as in 2.1.5, untouched       // dormant video helper path: untouched
  if (await hibImgWaitStarted(tab.id)) return tab;
  try { await browser.tabs.get(tab.id); } catch (e) { return tab; }            // already replaced / closed by someone else: do not open a second tab
  console.warn("[HIB image] resolver tab " + tab.id + " never started loading - reopening once:", props.url);
  hibV218OwnedTabId = null;                                                   // so the removal below does not release the owner slot
  try { await hibV218NativeRemove(tab.id); } catch (e) {}
  const fresh = await hibV218NativeCreate(props);
  if (!fresh || typeof fresh.id !== "number") throw new Error("HIB resolver tab re-creation returned no numeric ID");
  hibV218OwnedTabId = fresh.id;
  hibV221OwnedWindowId = typeof fresh.windowId === "number" ? fresh.windowId : null;
  await hibImgWaitStarted(fresh.id);                                          // second tab: no further retry, the resolver's own timeouts apply
  return fresh;
}

async function hibV218CreateOwnedTab(
  properties
) {
  await hibV218Acquire();

  /* site-down memory (see hibImgMarkDown): a host the probe found down gets no new resolver tab, whichever resolver asks, and a request that waited in the queue
   * gives the slot straight back instead of opening a tab to the dead host */
  if (window.hibImgIsDown && window.hibImgIsDown((properties || {}).url)) {
    hibV218Release("host down (recent probe)");
    throw new Error("Image host is down (recent probe); no resolver tab opened");
  }

  await hibV218CaptureUserTab();

  const safe =
    Object.assign(
      {},
      properties || {},
      {
        active:
          false
      }
    );

  let created;

  try {
    /*
     * HIB-V270-NHPLAYER-DEDICATED-WINDOW
     *
     * Other resolvers retain their previous tab creation.
     */
    const hibV270Host = (() => {
      try {
        return new URL(safe.url || "").hostname.toLowerCase();
      }
      catch (error) {
        return "";
      }
    })();

    created = hibV270Host === "nhplayer.com"
      ? await hibV270CreateNHPlayerPopup(safe)
      : await hibV218NativeCreate(safe);

    if (
      !created ||
      typeof created.id !==
        "number"
    ) {
      throw new Error(
        "HIB resolver tab creation returned no numeric ID"
      );
    }

    hibV218OwnedTabId =
      created.id;

    hibV221OwnedWindowId =
      typeof created.windowId === "number"
        ? created.windowId
        : null;

    hibV221OwnedHost =
      "";

    try {
      hibV221OwnedHost =
        new URL(
          safe.url || ""
        ).hostname.toLowerCase();
    }
    catch (error) {}
    hibImgNoteHost(hibV221OwnedHost);             /* IMAGE SECTION: remember the site for the stray-tab sweep */

    /*
     * HIB-V267-DIAGNOSTIC-ROTATION
     * Retain at most one old diagnostic NHPlayer tab.
     */
    if (
      hibV221OwnedHost === "nhplayer.com" &&
      typeof hibV267LastDiagnosticTabId === "number" &&
      hibV267LastDiagnosticTabId !== created.id
    ) {
      const previousDiagnosticId = hibV267LastDiagnosticTabId;
      hibV267LastDiagnosticTabId = null;

      try {
        await hibV218NativeRemove(previousDiagnosticId);
        console.log(
          "[HIB v2.1.5 NHPlayer] Previous diagnostic tab closed:",
          previousDiagnosticId
        );
      }
      catch (error) {
        // Already closed manually.
      }
    }

    console.log(
      "[HIB v2.1.5 owner] ACQUIRED:",
      created.id,
      safe.url || ""
    );

    console.log(
      "[HIB v2.1.5 owner] target host:",
      hibV221OwnedHost || "(none)"
    );

    /*
     * Emergency cleanup only.
     * Individual resolvers should normally close sooner.
     */
    hibV218Watchdog =
      setTimeout(
        async () => {
          if (
            typeof hibV218OwnedTabId !==
              "number"
          ) {
            return;
          }

          const staleId =
            hibV218OwnedTabId;

          console.warn(
            "[HIB v2.1.5 owner] WATCHDOG closing stale resolver:",
            staleId
          );

          try {
            await hibV218NativeRemove(
              staleId
            );
          }
          catch (error) {
            hibV218Release(
              "watchdog tab already gone"
            );
          }
        },
        /* HIB-V265-NHPLAYER-WATCHDOG-SLACK */
        hibV221OwnedHost === 'nhplayer.com' ? 120000 : 60000
      );

    /* IMAGE SECTION: make sure the unfocused tab really started loading (see hibImgEnsureStarted) */
    created = await hibImgEnsureStarted(created, safe);

    return created;
  }
  catch (error) {
    hibV218Release(
      "create failure"
    );

    throw error;
  }
}

/*
 * Keep track of the most recent real user tab.
 *
 * Resolver roots and resolver children do not replace this value.
 */
browser.tabs.onActivated.addListener(
  activeInfo => {
    /*
     * HIB-V270-POPUP-ACTIVATION-GUARD
     */
    if (
      hibV270CreatingPopup &&
      activeInfo.windowId !== hibV270OriginalWindowId
    ) {
      return;
    }
    if (
      typeof activeInfo.tabId !==
        "number"
    ) {
      return;
    }

    const isResolver =
      activeInfo.tabId ===
        hibV218OwnedTabId;

    const isChild =
      hibV218Children.has(
        activeInfo.tabId
      );

    if (
      !isResolver &&
      !isChild
    ) {
      hibV218LastUserTabId =
        activeInfo.tabId;

      return;
    }


    /*
     * HIB-V266-NHPLAYER-MANUAL-INSPECTION
     * An inactive tab becoming active is a user navigation
     * we must not immediately undo.
     */
    if (
      isResolver &&
      hibV221OwnedHost === "nhplayer.com"
    ) {
      console.log(
        "[HIB v2.1.5 owner] NHPlayer tab selected for inspection:",
        activeInfo.tabId
      );
      return;
    }

    console.warn(
      "[HIB v2.1.5 owner] resolver attempted focus:",
      activeInfo.tabId
    );

    hibV218RestoreUserTab();
  }
);

/*
 * Any browser tab spawned by the resolver root is resolver fallout.
 * Close it immediately instead of allowing ad/landing/upload tabs to
 * escape HIB ownership.
 */
browser.tabs.onCreated.addListener(
  tab => {
    if (
      !hibV218Busy ||
      typeof tab.id !== "number"
    ) {
      return;
    }

    /*
     * The root onCreated event may occur before tabs.create() resolves and
     * before hibV218OwnedTabId is assigned. Do not classify anything until
     * the owned root ID exists.
     */
    if (
      typeof hibV218OwnedTabId !==
        "number"
    ) {
      return;
    }

    if (
      tab.id ===
        hibV218OwnedTabId
    ) {
      return;
    }

    const sameWindow =
      hibV221OwnedWindowId === null ||
      tab.windowId ===
        hibV221OwnedWindowId;

    const hasOpener =
      typeof tab.openerTabId ===
        "number";

    const rootChild =
      hasOpener &&
      tab.openerTabId ===
        hibV218OwnedTabId;

    const descendant =
      hasOpener &&
      hibV218Children.has(
        tab.openerTabId
      );

    if (
      (rootChild ||
      descendant) &&
      hibImgDlsiteBusy === 0          /* IMAGE SECTION: during DLsite a neighbour tab may be the replacement of the resolver tab - never close it here */
    ) {
      hibV218Children.add(
        tab.id
      );

      console.warn(
        "[HIB v2.1.5 owner] BLOCK CHILD:",
        tab.id,
        "opener=" +
          tab.openerTabId,
        tab.url || ""
      );

      hibV218NativeRemove(
        tab.id
      )
        .catch(
          () => {}
        )
        .finally(
          () => {
            hibV218Children.delete(
              tab.id
            );

            hibV218RestoreUserTab();
          }
        );

      return;
    }

    /*
     * A resolver page can spawn a rel=noopener target. There is no opener
     * relationship to test, so track it provisionally rather than closing
     * it immediately.
     *
     * It is considered resolver-owned only later, if its final hostname
     * matches the hostname of the HIB resolver target.
     */
    if (
      sameWindow &&
      !hasOpener
    ) {
      hibV221PossibleOrphans.add(
        tab.id
      );

      console.log(
        "[HIB v2.1.5 owner] TRACK POSSIBLE NO-OPENER CHILD:",
        tab.id,
        tab.url || ""
      );
    }
  }
);

async function hibV221SweepNoOpenerOrphans() {
  const ownedHost =
    hibV221OwnedHost;

  const candidates =
    Array.from(
      hibV221PossibleOrphans
    );

  hibV221PossibleOrphans.clear();

  if (
    !ownedHost ||
    !candidates.length
  ) {
    return;
  }

  /*
   * Allow a just-created about:blank/noopener tab enough time to navigate
   * to its image-host landing URL before classification.
   */
  await new Promise(
    resolve => {
      setTimeout(
        resolve,
        750
      );
    }
  );

  for (
    const tabId of
    candidates
  ) {
    let tab;

    try {
      tab =
        await browser.tabs.get(
          tabId
        );
    }
    catch (error) {
      continue;
    }

    if (
      !tab ||
      typeof tab.id !== "number"
    ) {
      continue;
    }

    let host =
      "";

    try {
      host =
        new URL(
          tab.url || ""
        ).hostname.toLowerCase();
    }
    catch (error) {}

    if (
      !host ||
      host !==
        ownedHost
    ) {
      console.log(
        "[HIB v2.1.5 owner] KEEP unrelated no-opener tab:",
        tabId,
        host || tab.url || ""
      );

      continue;
    }

    console.warn(
      "[HIB v2.1.5 owner] CLOSE escaped no-opener resolver tab:",
      tabId,
      host
    );

    try {
      await hibV218NativeRemove(
        tabId
      );
    }
    catch (error) {}
  }
}
browser.tabs.onRemoved.addListener(
  async tabId => {
    /* HIB-V267-DIAGNOSTIC-CLOSE-TRACKING */
    if (tabId === hibV267LastDiagnosticTabId) {
      hibV267LastDiagnosticTabId = null;
    }
    hibV266NetworkMedia.delete(tabId);
    hibV218Children.delete(
      tabId
    );

    hibV221PossibleOrphans.delete(
      tabId
    );

    if (
      tabId !==
        hibV218OwnedTabId
    ) {
      return;
    }

    if (hibImgDlsiteBusy > 0) {                 /* IMAGE SECTION: DLsite still running - decide at its end, keep the replacement tab */
      hibImgOwnedLost = true;
      return;
    }

    await hibV221SweepNoOpenerOrphans();

    hibV221OwnedHost =
      "";

    hibV221OwnedWindowId =
      null;

    hibV218Release(
      "owned resolver closed"
    );
  }
);

console.log(
  "[HIB v2.1.5 owner] global one-tab resolver lock loaded"
);
"use strict";

/*
 * Host Imagus Bridge v2.1.3
 *
 * Background resolver architecture:
 *
 * - No generic wrapper resolver.
 * - No page-load resolution.
 * - One requested target URL -> one inflight resolver.
 * - One HIB-created resolver tab per target.
 * - Poll target DOM every 500 ms.
 * - DLsite waits for a stable gallery.
 * - XXPICS waits for a stable real image.
 * - Resolver-owned tabs are always cleaned up.
 */

const dlsiteInflight =
  new Map();

const dlsiteCache =
  new Map();

const xxpicsInflight =
  new Map();

const xxpicsCache =
  new Map();

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function normalizeDlsiteUrl(value) {
  let url;

  try {
    url =
      new URL(value);
  }
  catch (error) {
    return null;
  }

  const host =
    url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

  if (host !== "dlsite.com") {
    return null;
  }

  const match =
    url.pathname.match(
      /\/product_id\/(RJ\d+)\.html/i
    );

  if (!match) {
    return null;
  }

  const productId =
    match[1].toUpperCase();

  return {
    productId,

    url:
      "https://www.dlsite.com/maniax/work/=/product_id/" +
      productId +
      ".html"
  };
}

function sameDlsiteProduct(a, b) {
  const aa =
    normalizeDlsiteUrl(a);

  const bb =
    normalizeDlsiteUrl(b);

  return (
    aa &&
    bb &&
    aa.url === bb.url
  );
}

async function snapshotExactDlsiteTabs(
  pageUrl
) {
  const tabs =
    await browser.tabs.query({});

  const ids =
    new Set();

  for (
    const tab of
    tabs
  ) {
    if (
      typeof tab.id === "number" &&
      sameDlsiteProduct(
        tab.url || "",
        pageUrl
      )
    ) {
      ids.add(
        tab.id
      );
    }
  }

  return ids;
}

async function adoptExactDlsiteTab(
  pageUrl,
  preexistingIds,
  ownedIds
) {
  const tabs =
    await browser.tabs.query({});

  const candidates =
    tabs.filter(tab => {
      if (
        typeof tab.id !== "number"
      ) {
        return false;
      }

      if (
        preexistingIds.has(
          tab.id
        )
      ) {
        return false;
      }

      if (
        ownedIds.has(
          tab.id
        )
      ) {
        return false;
      }

      return sameDlsiteProduct(
        tab.url || "",
        pageUrl
      );
    });

  if (!candidates.length) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      Number(b.id) -
      Number(a.id)
  );

  return candidates[0];
}

async function inspectDlsite(
  tabId,
  productId
) {
  const inspectPage = pid => {
    function absolute(value) {
      if (!value) {
        return null;
      }

      try {
        return new URL(
          value,
          location.href
        ).href;
      }
      catch (error) {
        return null;
      }
    }

    function filename(value) {
      try {
        return new URL(value)
          .pathname
          .split("/")
          .pop()
          .toUpperCase();
      }
      catch (error) {
        return "";
      }
    }

    function validExtension(name) {
      return (
        name.endsWith(".JPG") ||
        name.endsWith(".JPEG") ||
        name.endsWith(".PNG") ||
        name.endsWith(".WEBP") ||
        name.endsWith(".AVIF")
      );
    }

    const urls =
      new Set();

    function add(value) {
      const url =
        absolute(value);

      if (!url) {
        return;
      }

      if (
        !/^https:\/\/img\.dlsite\.jp\//i.test(
          url
        )
      ) {
        return;
      }

      if (
        !url
          .toUpperCase()
          .includes(
            pid.toUpperCase() +
            "_IMG_"
          )
      ) {
        return;
      }

      urls.add(
        url
      );
    }

    for (
      const img of
      document.querySelectorAll(
        "img"
      )
    ) {
      add(img.currentSrc);
      add(img.src);

      for (
        const attr of [
          "data-src",
          "data-lazy",
          "data-lazy-src",
          "data-original",
          "data-original-src"
        ]
      ) {
        add(
          img.getAttribute(
            attr
          )
        );
      }

      const srcset =
        img.getAttribute(
          "srcset"
        );

      if (srcset) {
        for (
          const item of
          srcset.split(",")
        ) {
          add(
            item
              .trim()
              .split(/\s+/)[0]
          );
        }
      }
    }

    for (
      const source of
      document.querySelectorAll(
        "source"
      )
    ) {
      const srcset =
        source.getAttribute(
          "srcset"
        );

      if (!srcset) {
        continue;
      }

      for (
        const item of
        srcset.split(",")
      ) {
        add(
          item
            .trim()
            .split(/\s+/)[0]
        );
      }
    }

    const productIdUpper =
      pid.toUpperCase();

    const main =
      Array.from(urls)
        .find(url => {
          const name =
            filename(url);

          return (
            name.startsWith(
              productIdUpper +
              "_IMG_MAIN."
            ) &&
            validExtension(name)
          );
        }) ||
      null;

    const gallery =
      [];

    if (main) {
      gallery.push({
        order:
          0,

        url:
          main
      });
    }

    const samplePrefix =
      productIdUpper +
      "_IMG_SMP";

    for (
      const url of
      urls
    ) {
      const name =
        filename(url);

      if (
        !name.startsWith(
          samplePrefix
        ) ||
        !validExtension(name)
      ) {
        continue;
      }

      const remainder =
        name.substring(
          samplePrefix.length
        );

      const dot =
        remainder.indexOf(".");

      if (dot <= 0) {
        continue;
      }

      const numberText =
        remainder.substring(
          0,
          dot
        );

      if (
        !/^\d+$/.test(
          numberText
        )
      ) {
        continue;
      }

      gallery.push({
        order:
          Number(numberText),

        url
      });
    }

    const unique =
      new Map();

    for (
      const item of
      gallery
    ) {
      if (
        !unique.has(
          item.url
        )
      ) {
        unique.set(
          item.url,
          item
        );
      }
    }

    const galleryUrls =
      Array.from(
        unique.values()
      )
        .sort(
          (a, b) =>
            a.order -
            b.order
        )
        .map(
          item =>
            item.url
        );

    return {
      href:
        location.href,

      title:
        document.title || "",

      readyState:
        document.readyState,

      mainUrl:
        main,

      galleryUrls,

      imageCount:
        document.images.length
    };
  };

  const code =
    "(" +
    inspectPage.toString() +
    ")(" +
    JSON.stringify(
      productId
    ) +
    ")";

  const result =
    await browser.tabs.executeScript(
      tabId,
      {
        runAt:
          "document_end",

        code
      }
    );

  return (
    result &&
    result.length
  )
    ? result[0]
    : null;
}

/* IMAGE SECTION: loads every picture address inside the resolver tab itself (so the browser has them in cache with the DLsite referrer) and answers when all are
 * loaded or failed, or after 15 s. Never throws: a problem here only means "do not wait". */
async function hibImgDlsiteWaitImages(tabId, mainUrl, gallery) {
  const t0 = Date.now();
  try {
    const urls = Array.from(new Set([mainUrl].concat(Array.isArray(gallery) ? gallery : []).filter(u => typeof u === "string" && /^https:\/\/img\.dlsite\.jp\//i.test(u))));
    if (!urls.length) return 0;
    const code = "new Promise(res => { const urls = " + JSON.stringify(urls) + "; let n = 0, ok = 0; const done = () => { if (++n >= urls.length) res(ok); }; " +
      "for (const u of urls) { const i = new Image(); i.onload = () => { ok++; done(); }; i.onerror = done; i.src = u; } setTimeout(() => res(ok), 14000); })";
    const out = await Promise.race([
      browser.tabs.executeScript(tabId, { code }),
      new Promise(r => setTimeout(() => r([-1]), 15000))
    ]);
    console.log("[HIB image] DLsite pictures loaded in the resolver tab:", out && out[0], "of", urls.length);
    const left = 5000 - (Date.now() - t0);                                     // the tab stays open at least 5 s after the pictures are found
    if (left > 0) await new Promise(r => setTimeout(r, left));
    return out && out[0];
  }
  catch (e) { return 0; }
}

async function resolveDlsite(pageUrl) {
  hibImgDlsiteBusy++;
  hibImgTrace("RESOLVE_START", { key: pageUrl, kind: "dlsite" });
  try {
    const r = await resolveDlsiteCore(pageUrl);
    hibImgTrace("RESOLVE_DONE", { key: pageUrl, kind: "dlsite", ok: !!(r && r.ok !== false), images: r && r.gallery ? r.gallery.length : undefined });
    return r;
  }
  catch (error) { hibImgTrace("RESOLVE_FAILED", { key: pageUrl, kind: "dlsite", error: String(error && error.message || error).slice(0, 160) }); throw error; }
  finally {
    hibImgDlsiteBusy--;
    if (hibImgOwnedLost && hibImgDlsiteBusy === 0) {      /* the owned tab vanished earlier and its release was postponed to here */
      hibImgOwnedLost = false;
      try { await hibV221SweepNoOpenerOrphans(); } catch (e) {}
      hibV221OwnedHost = "";
      hibV221OwnedWindowId = null;
      hibV218Release("dlsite owned tab replaced - resolve finished");
    }
  }
}
async function resolveDlsiteCore(
  pageUrl
) {
  const target =
    normalizeDlsiteUrl(
      pageUrl
    );

  if (!target) {
    throw new Error(
      "Invalid DLsite URL"
    );
  }

  if (
    dlsiteCache.has(
      target.url
    )
  ) {
    return dlsiteCache.get(
      target.url
    );
  }

  const preexistingIds =
    await snapshotExactDlsiteTabs(
      target.url
    );

  const created =
    await hibV218CreateOwnedTab({
      url:
        target.url,

      active:
        false
    });

  if (
    !created ||
    typeof created.id !==
      "number"
  ) {
    throw new Error(
      "DLsite resolver tab creation failed"
    );
  }

  let resolverTabId =
    created.id;

  const ownedIds =
    new Set([
      created.id
    ]);

  const started =
    Date.now();

  let lastSignature =
    "";

  let stablePolls =
    0;

  let lastInfo =
    null;

  console.log(
    "[HIB v2.1.5 background] DLsite polling started:",
    target.url
  );

  try {
    while (
      Date.now() - started <
      20000
    ) {
      let liveTab =
        null;

      try {
        liveTab =
          await browser.tabs.get(
            resolverTabId
          );
      }
      catch (error) {}

      if (
        !liveTab ||
        !sameDlsiteProduct(
          liveTab.url || "",
          target.url
        )
      ) {
        const adopted =
          await adoptExactDlsiteTab(
            target.url,
            preexistingIds,
            ownedIds
          );

        if (adopted) {
          resolverTabId =
            adopted.id;

          ownedIds.add(
            adopted.id
          );

          console.log(
            "[HIB v2.1.5 background] DLsite adopted replacement tab:",
            resolverTabId
          );
        }
      }

      try {
        const info =
          await inspectDlsite(
            resolverTabId,
            target.productId
          );

        if (info) {
          lastInfo =
            info;

          const gallery =
            Array.isArray(
              info.galleryUrls
            )
              ? info.galleryUrls
              : [];

          console.log(
            "[HIB v2.1.5 background] DLsite poll:",
            Math.floor(
              (
                Date.now() -
                started
              ) / 500
            ),
            "gallery=" +
              gallery.length,
            "main=" +
              Boolean(
                info.mainUrl
              )
          );

          if (
            info.mainUrl &&
            gallery.length > 0
          ) {
            const signature =
              JSON.stringify(
                gallery
              );

            if (
              signature ===
              lastSignature
            ) {
              stablePolls +=
                1;
            }
            else {
              lastSignature =
                signature;

              stablePolls =
                1;
            }

            /*
             * Three identical 500 ms observations means the actual
             * gallery has stopped changing for approximately 1.5 s.
             *
             * We publish immediately at that point instead of imposing
             * an arbitrary post-resolution sleep.
             */
            if (
              stablePolls >= 3
            ) {
              /* IMAGE SECTION (the ONLY change to the 2.1.5 DLsite resolver): keep the resolver tab open until the pictures have really LOADED in it
               * (main + gallery, 15 s at most, and never less than 5 s), then publish. Closing at once left the pictures unloaded so the popup could not show them. */
              await hibImgDlsiteWaitImages(resolverTabId, info.mainUrl, gallery);
              const result = {
                ok:
                  true,

                pageUrl:
                  target.url,

                productId:
                  target.productId,

                mainUrl:
                  info.mainUrl,

                galleryUrls:
                  gallery,

                pollCount:
                  Math.floor(
                    (
                      Date.now() -
                      started
                    ) / 500
                  ),

                resolverDocumentUrl:
                  info.href
              };

              dlsiteCache.set(
                target.url,
                result
              );

              console.log(
                "[HIB v2.1.5 background] DLsite ACTUAL PICTURES READY:",
                gallery.length,
                target.url
              );

              return result;
            }
          }
          else {
            lastSignature =
              "";

            stablePolls =
              0;
          }
        }
      }
      catch (error) {
        console.debug(
          "[HIB v2.1.5 background] DLsite poll waiting:",
          String(error)
        );
      }

      await sleep(
        500
      );
    }

    throw new Error(
      "DLsite pictures did not become ready before timeout. Last result: " +
      JSON.stringify(
        lastInfo
      )
    );
  }
  finally {
    for (
      const tabId of
      ownedIds
    ) {
      if (
        preexistingIds.has(
          tabId
        )
      ) {
        continue;
      }

      try {
        await browser.tabs.remove(
          tabId
        );
      }
      catch (error) {}
    }
  }
}

function normalizeXxPicsUrl(value) {
  let url;

  try {
    url =
      new URL(value);
  }
  catch (error) {
    return null;
  }

  const host =
    url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

  if (host !== "xxpics.org") {
    return null;
  }

  const match =
    url.pathname.match(
      /^\/cover-(rj\d+)\/?$/i
    );

  if (!match) {
    return null;
  }

  const productId =
    match[1].toUpperCase();

  return {
    productId,

    url:
      "https://xxpics.org/cover-" +
      productId.toLowerCase() +
      "/"
  };
}

async function inspectXxPics(
  tabId,
  productId
) {
  const inspectPage = pid => {
    function absolute(value) {
      if (!value) {
        return null;
      }

      try {
        const url =
          new URL(
            value,
            location.href
          );

        if (
          url.protocol !== "http:" &&
          url.protocol !== "https:"
        ) {
          return null;
        }

        return url.href;
      }
      catch (error) {
        return null;
      }
    }

    function imageLike(value) {
      return (
        /\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(
          value || ""
        )
      );
    }

    const candidates =
      new Map();

    function add(
      value,
      score,
      source,
      width,
      height
    ) {
      const url =
        absolute(value);

      if (
        !url ||
        !imageLike(url)
      ) {
        return;
      }

      let finalScore =
        Number(score || 0);

      const lower =
        url.toLowerCase();

      if (
        lower.includes(
          pid.toLowerCase()
        )
      ) {
        finalScore +=
          30000;
      }

      const w =
        Number(width || 0);

      const h =
        Number(height || 0);

      if (
        w >= 200 ||
        h >= 200
      ) {
        finalScore +=
          10000;
      }

      if (
        w > 0 &&
        h > 0
      ) {
        finalScore +=
          Math.min(
            20000,
            Math.floor(
              (w * h) /
              100
            )
          );
      }

      const existing =
        candidates.get(
          url
        );

      if (
        !existing ||
        finalScore >
          existing.score
      ) {
        candidates.set(
          url,
          {
            url,
            score:
              finalScore,

            source,

            width:
              w,

            height:
              h
          }
        );
      }
    }

    const og =
      document.querySelector(
        'meta[property="og:image"]'
      );

    if (og) {
      add(
        og.content,
        15000,
        "og:image",
        0,
        0
      );
    }

    const ogSecure =
      document.querySelector(
        'meta[property="og:image:secure_url"]'
      );

    if (ogSecure) {
      add(
        ogSecure.content,
        15500,
        "og:image:secure_url",
        0,
        0
      );
    }

    const twitter =
      document.querySelector(
        'meta[name="twitter:image"],meta[property="twitter:image"]'
      );

    if (twitter) {
      add(
        twitter.content,
        14000,
        "twitter:image",
        0,
        0
      );
    }

    for (
      const img of
      document.querySelectorAll(
        "img"
      )
    ) {
      const width =
        img.naturalWidth ||
        img.width ||
        0;

      const height =
        img.naturalHeight ||
        img.height ||
        0;

      add(
        img.currentSrc,
        5000,
        "img.currentSrc",
        width,
        height
      );

      add(
        img.src,
        4500,
        "img.src",
        width,
        height
      );

      for (
        const attr of [
          "data-src",
          "data-lazy-src",
          "data-original",
          "data-original-src"
        ]
      ) {
        add(
          img.getAttribute(
            attr
          ),
          4000,
          attr,
          width,
          height
        );
      }
    }

    for (
      const anchor of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      if (
        imageLike(
          anchor.href
        )
      ) {
        add(
          anchor.href,
          6000,
          "image-anchor",
          0,
          0
        );
      }
    }

    const ordered =
      Array.from(
        candidates.values()
      )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    return {
      href:
        location.href,

      title:
        document.title || "",

      readyState:
        document.readyState,

      fullUrl:
        ordered.length
          ? ordered[0].url
          : null,

      source:
        ordered.length
          ? ordered[0].source
          : null,

      candidates:
        ordered.slice(
          0,
          10
        )
    };
  };

  const code =
    "(" +
    inspectPage.toString() +
    ")(" +
    JSON.stringify(
      productId
    ) +
    ")";

  const result =
    await browser.tabs.executeScript(
      tabId,
      {
        runAt:
          "document_end",

        code
      }
    );

  return (
    result &&
    result.length
  )
    ? result[0]
    : null;
}

async function resolveXxPics(
  pageUrl
) {
  const target =
    normalizeXxPicsUrl(
      pageUrl
    );

  if (!target) {
    throw new Error(
      "Invalid XXPICS URL"
    );
  }

  if (
    xxpicsCache.has(
      target.url
    )
  ) {
    return xxpicsCache.get(
      target.url
    );
  }

  const tab =
    await hibV218CreateOwnedTab({
      url:
        target.url,

      active:
        false
    });

  if (
    !tab ||
    typeof tab.id !==
      "number"
  ) {
    throw new Error(
      "XXPICS resolver tab creation failed"
    );
  }

  const tabId =
    tab.id;

  const started =
    Date.now();

  let lastUrl =
    "";

  let stablePolls =
    0;

  let lastInfo =
    null;

  console.log(
    "[HIB v2.1.5 background] XXPICS polling started:",
    target.url
  );

  try {
    while (
      Date.now() - started <
      15000
    ) {
      try {
        const info =
          await inspectXxPics(
            tabId,
            target.productId
          );

        if (info) {
          lastInfo =
            info;

          console.log(
            "[HIB v2.1.5 background] XXPICS poll:",
            Math.floor(
              (
                Date.now() -
                started
              ) / 500
            ),
            info.fullUrl || "waiting"
          );

          if (
            info.fullUrl
          ) {
            if (
              info.fullUrl ===
              lastUrl
            ) {
              stablePolls +=
                1;
            }
            else {
              lastUrl =
                info.fullUrl;

              stablePolls =
                1;
            }

            /*
             * Two equal observations = stable for approximately 1 second.
             */
            if (
              stablePolls >= 2
            ) {
              const result = {
                ok:
                  true,

                pageUrl:
                  target.url,

                productId:
                  target.productId,

                fullUrl:
                  info.fullUrl,

                source:
                  info.source,

                candidates:
                  info.candidates
              };

              xxpicsCache.set(
                target.url,
                result
              );

              console.log(
                "[HIB v2.1.5 background] XXPICS ACTUAL PICTURE READY:",
                info.fullUrl
              );

              return result;
            }
          }
          else {
            lastUrl =
              "";

            stablePolls =
              0;
          }
        }
      }
      catch (error) {
        console.debug(
          "[HIB v2.1.5 background] XXPICS poll waiting:",
          String(error)
        );
      }

      await sleep(
        500
      );
    }

    throw new Error(
      "XXPICS picture did not become ready before timeout. Last result: " +
      JSON.stringify(
        lastInfo
      )
    );
  }
  finally {
    try {
      await browser.tabs.remove(
        tabId
      );
    }
    catch (error) {}
  }
}

browser.runtime.onMessage.addListener(
  message => {
    if (
      !message ||
      message.type !==
        "hib-v2-resolve-dlsite"
    ) {
      return undefined;
    }

    const target =
      normalizeDlsiteUrl(
        message.pageUrl
      );

    if (!target) {
      return Promise.resolve({
        ok:
          false,

        error:
          "Rejected non-DLsite URL"
      });
    }

    if (
      dlsiteInflight.has(
        target.url
      )
    ) {
      return dlsiteInflight.get(
        target.url
      );
    }

    const job =
      resolveDlsite(
        target.url
      )
        .catch(error => ({
          ok:
            false,

          error:
            String(error)
        }))
        .finally(() => {
          dlsiteInflight.delete(
            target.url
          );
        });

    dlsiteInflight.set(
      target.url,
      job
    );

    return job;
  }
);

browser.runtime.onMessage.addListener(
  message => {
    if (
      !message ||
      message.type !==
        "hib-v2-resolve-xxpics"
    ) {
      return undefined;
    }

    const target =
      normalizeXxPicsUrl(
        message.pageUrl
      );

    if (!target) {
      return Promise.resolve({
        ok:
          false,

        error:
          "Rejected non-XXPICS URL"
      });
    }

    if (
      xxpicsInflight.has(
        target.url
      )
    ) {
      return xxpicsInflight.get(
        target.url
      );
    }

    const job =
      resolveXxPics(
        target.url
      )
        .catch(error => ({
          ok:
            false,

          error:
            String(error)
        }))
        .finally(() => {
          xxpicsInflight.delete(
            target.url
          );
        });

    xxpicsInflight.set(
      target.url,
      job
    );

    return job;
  }
);

console.log(
  "[HIB v2.1.5 background] loaded"
);
/*
 * HIB-V211-CHAIN-BACKGROUND
 *
 * Isolated short-link chain resolver.
 *
 * Initial supported entry point:
 *   ouo.io
 *
 * Supported terminal/image hosts:
 *   TurboImageHost / turboimg.net
 *   imagehost.website
 *   OrangePix
 *   ImgPV
 *
 * Rules:
 * - one original URL -> one inflight job
 * - one HIB-created resolver tab
 * - poll every 500 ms
 * - maximum 5 distinct chain URLs
 * - loop detection
 * - never mutate the Sukebei page from background
 * - only return after a real direct image is found
 */

const hibV210ChainInflight =
  new Map();

const hibV210ChainCache =
  new Map();

function hibV210Sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function hibV210NormalizeOuo(value) {
  let url;

  try {
    url =
      new URL(value);
  }
  catch (error) {
    return null;
  }

  const host =
    url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

  if (host !== "ouo.io") {
    return null;
  }

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    return null;
  }

  return url.href;
}

function hibV210IsDirectImage(value) {
  try {
    const url =
      new URL(value);

    return (
      url.protocol === "https:" &&
      /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:$|[?#])/i.test(
        url.pathname +
        url.search +
        url.hash
      )
    );
  }
  catch (error) {
    return false;
  }
}

function hibV210Host(value) {
  try {
    return new URL(value)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  }
  catch (error) {
    return "";
  }
}

function hibV210SupportedDestination(value) {
  const host =
    hibV210Host(value);

  if (!host) {
    return false;
  }

  return (
    host === "ouo.io" ||
    host === "turboimagehost.com" ||
    host.endsWith(
      ".turboimg.net"
    ) ||
    host === "imagehost.website" ||
    host.endsWith(
      ".imagehost.website"
    ) ||
    host === "orangepix.is" ||
    host.endsWith(
      ".orangepix.is"
    ) ||
    host === "imgpv.com" ||
    host.endsWith(
      ".imgpv.com"
    )
  );
}

function hibV210TerminalImage(value) {
  if (
    !hibV210IsDirectImage(
      value
    )
  ) {
    return false;
  }

  const host =
    hibV210Host(value);

  if (
    host.endsWith(
      ".turboimg.net"
    )
  ) {
    return (
      /\/sp\//i.test(
        value
      ) ||
      /\/i\//i.test(
        value
      )
    );
  }

  if (
    host === "imagehost.website" ||
    host.endsWith(
      ".imagehost.website"
    )
  ) {
    return (
      !/\.th\.(?:jpe?g|png|gif|webp)(?:$|[?#])/i.test(
        value
      )
    );
  }

  if (
    host === "orangepix.is" ||
    host.endsWith(
      ".orangepix.is"
    )
  ) {
    return (
      !/\.th\.(?:jpe?g|png|gif|webp)(?:$|[?#])/i.test(
        value
      )
    );
  }

  if (
    host === "imgpv.com" ||
    host.endsWith(
      ".imgpv.com"
    )
  ) {
    return true;
  }

  return false;
}

async function hibV210InspectChainTab(
  tabId
) {
  const inspectPage = () => {
    function absolute(value) {
      if (!value) {
        return null;
      }

      try {
        return new URL(
          value,
          location.href
        ).href;
      }
      catch (error) {
        return null;
      }
    }

    function directImage(value) {
      return (
        /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:$|[?#])/i.test(
          String(
            value || ""
          )
        )
      );
    }

    function host(value) {
      try {
        return new URL(value)
          .hostname
          .toLowerCase()
          .replace(/^www\./, "");
      }
      catch (error) {
        return "";
      }
    }

    function supported(value) {
      const h =
        host(value);

      return (
        h === "ouo.io" ||
        h === "turboimagehost.com" ||
        h.endsWith(".turboimg.net") ||
        h === "imagehost.website" ||
        h.endsWith(".imagehost.website") ||
        h === "orangepix.is" ||
        h.endsWith(".orangepix.is") ||
        h === "imgpv.com" ||
        h.endsWith(".imgpv.com")
      );
    }

    const href =
      location.href;

    const title =
      document.title || "";

    const challenge =
      /__cf_chl_|\/cdn-cgi\/challenge-platform/i.test(
        href
      ) ||
      /just a moment|checking your browser|attention required|security verification|verify you are human/i.test(
        title
      ) ||
      !!document.querySelector(
        'iframe[src*="challenges.cloudflare.com"],' +
        'input[name="cf-turnstile-response"],' +
        '#challenge-running,' +
        '#challenge-stage,' +
        '.cf-turnstile'
      );

    /*
     * Proven TurboImageHost full-image marker.
     */
    const turboImage =
      document.querySelector(
        "img.uImage"
      );

    const turboFull =
      turboImage
        ? absolute(
            turboImage.currentSrc ||
            turboImage.src
          )
        : null;

    if (
      turboFull &&
      /\/sp\//i.test(
        turboFull
      )
    ) {
      return {
        href,
        title,
        challenge,
        fullUrl:
          turboFull,
        source:
          "TurboImageHost img.uImage /sp/",
        outbound:
          [],
        actionAvailable:
          false
      };
    }

    /*
     * Collect only strong image candidates.
     */
    const imageCandidates =
      [];

    function addImage(
      value,
      score,
      source,
      width,
      height
    ) {
      const url =
        absolute(value);

      if (
        !url ||
        !directImage(url)
      ) {
        return;
      }

      const h =
        host(url);

      let accepted =
        false;

      if (
        h.endsWith(
          ".turboimg.net"
        ) &&
        /\/sp\//i.test(
          url
        )
      ) {
        accepted =
          true;
        score +=
          50000;
      }

      if (
        (
          h === "imagehost.website" ||
          h.endsWith(
            ".imagehost.website"
          )
        ) &&
        !/\.th\./i.test(
          url
        )
      ) {
        accepted =
          true;
        score +=
          30000;
      }

      if (
        (
          h === "orangepix.is" ||
          h.endsWith(
            ".orangepix.is"
          )
        ) &&
        !/\.th\./i.test(
          url
        )
      ) {
        accepted =
          true;
        score +=
          30000;
      }

      if (
        h === "imgpv.com" ||
        h.endsWith(
          ".imgpv.com"
        )
      ) {
        accepted =
          true;
        score +=
          30000;
      }

      if (!accepted) {
        return;
      }

      const w =
        Number(width || 0);

      const hgt =
        Number(height || 0);

      if (
        w >= 300 ||
        hgt >= 300
      ) {
        score +=
          10000;
      }

      imageCandidates.push({
        url,
        score,
        source
      });
    }

    const og =
      document.querySelector(
        'meta[property="og:image"]'
      );

    if (og) {
      addImage(
        og.content,
        10000,
        "og:image",
        0,
        0
      );
    }

    const twitter =
      document.querySelector(
        'meta[name="twitter:image"],meta[property="twitter:image"]'
      );

    if (twitter) {
      addImage(
        twitter.content,
        9000,
        "twitter:image",
        0,
        0
      );
    }

    for (
      const img of
      document.querySelectorAll(
        "img"
      )
    ) {
      const width =
        img.naturalWidth ||
        img.width ||
        0;

      const height =
        img.naturalHeight ||
        img.height ||
        0;

      addImage(
        img.currentSrc,
        6000,
        "img.currentSrc",
        width,
        height
      );

      addImage(
        img.src,
        5500,
        "img.src",
        width,
        height
      );

      for (
        const attr of [
          "data-src",
          "data-lazy-src",
          "data-original",
          "data-original-src"
        ]
      ) {
        addImage(
          img.getAttribute(
            attr
          ),
          5000,
          attr,
          width,
          height
        );
      }
    }

    imageCandidates.sort(
      (a, b) =>
        b.score -
        a.score
    );

    /*
     * Collect only supported chain destinations.
     * Ad/tracker destinations are intentionally ignored.
     */
    const outbound =
      [];

    const seen =
      new Set();

    for (
      const anchor of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      const url =
        absolute(
          anchor.href
        );

      if (
        !url ||
        seen.has(url)
      ) {
        continue;
      }

      if (
        directImage(url) ||
        supported(url)
      ) {
        seen.add(
          url
        );

        outbound.push({
          url,

          text:
            (
              anchor.textContent ||
              ""
            )
              .trim()
              .slice(
                0,
                100
              )
        });
      }
    }

    /*
     * OUO often exposes a continuation control only after its timer/
     * verification state is ready.
     */
    let actionAvailable =
      false;

    const possibleActions =
      Array.from(
        document.querySelectorAll(
          "a,button,input[type=submit]"
        )
      );

    for (
      const element of
      possibleActions
    ) {
      let text =
        "";

      if (
        element.tagName ===
        "INPUT"
      ) {
        text =
          element.value || "";
      }
      else {
        text =
          element.textContent || "";
      }

      const idClass =
        (
          (element.id || "") +
          " " +
          (element.className || "")
        )
          .toLowerCase();

      if (
        /get\s*link|continue|proceed|skip|next|go\s*to|visit\s*link/i.test(
          text
        ) ||
        /btn-main|btn-main-two|get-link|continue-button/i.test(
          idClass
        )
      ) {
        const rect =
          element.getBoundingClientRect();

        const style =
          getComputedStyle(
            element
          );

        if (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        ) {
          actionAvailable =
            true;

          break;
        }
      }
    }

    return {
      href,
      title,
      challenge,

      fullUrl:
        imageCandidates.length
          ? imageCandidates[0].url
          : null,

      source:
        imageCandidates.length
          ? imageCandidates[0].source
          : null,

      outbound:
        outbound.slice(
          0,
          20
        ),

      actionAvailable
    };
  };

  const result =
    await browser.tabs.executeScript(
      tabId,
      {
        runAt:
          "document_end",

        code:
          "(" +
          inspectPage.toString() +
          ")()"
      }
    );

  return (
    result &&
    result.length
  )
    ? result[0]
    : null;
}

async function hibV210AdvanceOuo(
  tabId
) {
  const advance = () => {
    function absolute(value) {
      if (!value) {
        return null;
      }

      try {
        return new URL(
          value,
          location.href
        ).href;
      }
      catch (error) {
        return null;
      }
    }

    function host(value) {
      try {
        return new URL(value)
          .hostname
          .toLowerCase()
          .replace(/^www\./, "");
      }
      catch (error) {
        return "";
      }
    }

    function supported(value) {
      const h =
        host(value);

      return (
        h === "turboimagehost.com" ||
        h.endsWith(".turboimg.net") ||
        h === "imagehost.website" ||
        h.endsWith(".imagehost.website") ||
        h === "orangepix.is" ||
        h.endsWith(".orangepix.is") ||
        h === "imgpv.com" ||
        h.endsWith(".imgpv.com")
      );
    }

    /*
     * Prefer an already-exposed supported outbound URL.
     */
    for (
      const anchor of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      const url =
        absolute(
          anchor.href
        );

      if (
        url &&
        supported(url)
      ) {
        location.href =
          url;

        return {
          acted:
            true,

          action:
            "navigate-supported-link",

          target:
            url
        };
      }
    }

    /*
     * Otherwise activate only a visible continuation-looking control.
     * This happens inside the HIB-owned OUO resolver tab only.
     */
    const elements =
      Array.from(
        document.querySelectorAll(
          "a,button,input[type=submit]"
        )
      );

    for (
      const element of
      elements
    ) {
      let text =
        "";

      if (
        element.tagName ===
        "INPUT"
      ) {
        text =
          element.value || "";
      }
      else {
        text =
          element.textContent || "";
      }

      const idClass =
        (
          (element.id || "") +
          " " +
          (element.className || "")
        )
          .toLowerCase();

      if (
        !(
          /get\s*link|continue|proceed|skip|next|go\s*to|visit\s*link/i.test(
            text
          ) ||
          /btn-main|btn-main-two|get-link|continue-button/i.test(
            idClass
          )
        )
      ) {
        continue;
      }

      const rect =
        element.getBoundingClientRect();

      const style =
        getComputedStyle(
          element
        );

      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        continue;
      }

      element.click();

      return {
        acted:
          true,

        action:
          "click-continuation",

        text:
          text
            .trim()
            .slice(
              0,
              100
            )
      };
    }

    return {
      acted:
        false
    };
  };

  const result =
    await browser.tabs.executeScript(
      tabId,
      {
        runAt:
          "document_end",

        code:
          "(" +
          advance.toString() +
          ")()"
      }
    );

  return (
    result &&
    result.length
  )
    ? result[0]
    : null;
}

async function hibV210SurfaceResolverTab(
  tabId
) {
  /*
   * HIB-V211-NO-FOCUS
   *
   * Resolver tabs must never steal focus from the user's active tab.
   * This function intentionally performs no activation or window focus.
   */
  console.log(
    "[HIB v2.1.5 chain] resolver remains inactive:",
    tabId
  );
}

/* ===== IMAGE SECTION - LOAD-STALL RETRY (new in rc386) =====
 * If the resolver tab makes no progress for 10 s (nothing loaded, or a page loaded but the chain did not move on), the tab is closed (by the resolver's own cleanup) and ONE
 * fresh unfocused tab is opened for a second try. Only one retry; a second stall is reported as a normal failure. */
const HIB_IMG_LOAD_STALL_MS = 10000;
/* ouo.io sets cookies on every visit. After many resolves they pile up and ouo.io answers "400 Request Header Or Cookie Too Large" - the resolver tab then sits on
 * that error page forever. Clearing ouo.io's cookies fixes it at once. Done (a) before a resolve when there are already many, (b) when that error page is seen,
 * (c) before the one retry. Only ouo.io cookies are touched. */
async function hibImgClearOuoCookies(onlyIfMany) {
  try {
    const list = await browser.cookies.getAll({ domain: "ouo.io" });
    if (onlyIfMany && list.length < 25) return;
    for (const c of list) {
      try { await browser.cookies.remove({ url: (c.secure ? "https://" : "http://") + c.domain.replace(/^\./, "") + c.path, name: c.name, storeId: c.storeId }); } catch (e) {}
    }
    console.log("[HIB image] cleared " + list.length + " ouo.io cookies");
  } catch (e) {}
}
async function hibV210ResolveChain(originalUrl) {
  hibImgTrace("RESOLVE_START", { key: originalUrl, kind: "ouo chain" });
  await hibImgClearOuoCookies(true);
  try {
    const r = await hibV210ResolveChainOnce(originalUrl);
    hibImgTrace("RESOLVE_DONE", { key: originalUrl, kind: "ouo chain", ok: !!(r && r.ok !== false), image: String((r && (r.fullUrl || r.fullImage || r.image)) || "").slice(0, 160).replace(/[?#].*$/, "") });
    return r;
  }
  catch (error) {
    if (!(error && error.hibLoadStall)) { hibImgTrace("RESOLVE_FAILED", { key: originalUrl, kind: "ouo chain", error: String(error && error.message || error).slice(0, 160) }); throw error; }
    hibImgTrace("RESOLVE_STALL_RETRY", { key: originalUrl, kind: "ouo chain", why: "resolver tab made no progress in 10 s; cookies cleared, one retry" });
    console.log("[HIB image] resolver tab made no progress - clearing ouo.io cookies and retrying once:", originalUrl);
    await hibImgClearOuoCookies(false);
    try {
      const r = await hibV210ResolveChainOnce(originalUrl);
      hibImgTrace("RESOLVE_DONE", { key: originalUrl, kind: "ouo chain (retry)", ok: !!(r && r.ok !== false) });
      return r;
    }
    catch (e2) { hibImgTrace("RESOLVE_FAILED", { key: originalUrl, kind: "ouo chain (retry)", error: String(e2 && e2.message || e2).slice(0, 160) }); throw e2; }
  }
}
async function hibV210ResolveChainOnce(
  originalUrl
) {
  const startUrl =
    hibV210NormalizeOuo(
      originalUrl
    );

  if (!startUrl) {
    throw new Error(
      "Rejected non-OUO chain URL"
    );
  }

  if (
    hibV210ChainCache.has(
      startUrl
    )
  ) {
    return hibV210ChainCache.get(
      startUrl
    );
  }

  const tab =
    await hibV218CreateOwnedTab({
      url:
        startUrl,

      active:
        false
    });

  if (
    !tab ||
    typeof tab.id !==
      "number"
  ) {
    throw new Error(
      "OUO resolver tab creation failed"
    );
  }

  const tabId =
    tab.id;

  const started =
    Date.now();

  const visited =
    new Set();

  let lastDocumentUrl =
    "";

  let lastProgressAt =
    Date.now();

  let surfaced =
    false;

  let lastActionAt =
    0;

  let poll =
    0;

  console.log(
    "[HIB v2.1.5 chain] START:",
    startUrl,
    "tab=" +
      tabId
  );

  try {
    while (
      Date.now() - started <
      45000
    ) {
      poll +=
        1;

      /* IMAGE SECTION: no progress for 10 s (nothing loaded, or the page loaded but the chain did not advance to a new page / the picture) -> stall;
       * hibV210ResolveChain closes this tab and tries ONE fresh unfocused tab. lastProgressAt moves on every new hop. */
      if (Date.now() - lastProgressAt > HIB_IMG_LOAD_STALL_MS) {
        const stall = new Error("Resolver made no progress for 10 s");
        stall.hibLoadStall = true;
        throw stall;
      }

      let currentTab =
        null;

      try {
        currentTab =
          await browser.tabs.get(
            tabId
          );
      }
      catch (error) {
        throw new Error(
          "Resolver tab disappeared before chain completion"
        );
      }

      const tabUrl =
        currentTab.url || "";

      /* IMAGE SECTION: ouo.io "400 Request Header Or Cookie Too Large" page -> stall at once (the retry clears the cookies first) */
      if (/^400 /.test(currentTab.title || "") || /Cookie Too Large/i.test(currentTab.title || "")) {
        const bad = new Error("ouo.io answered 400 cookie too large");
        bad.hibLoadStall = true;
        throw bad;
      }


      if (
        hibV210TerminalImage(
          tabUrl
        )
      ) {
        const result = {
          ok:
            true,

          originalUrl:
            startUrl,

          fullUrl:
            tabUrl,

          source:
            "terminal tab URL",

          chain:
            Array.from(
              visited
            ),

          pollCount:
            poll
        };

        hibV210ChainCache.set(
          startUrl,
          result
        );

        console.log(
          "[HIB v2.1.5 chain] READY from tab URL:",
          tabUrl
        );

        return result;
      }

      let info =
        null;

      try {
        info =
          await hibV210InspectChainTab(
            tabId
          );
      }
      catch (error) {
        /*
         * Expected briefly during redirects/document replacement.
         */
      }

      if (info) {
        const documentUrl =
          info.href ||
          tabUrl;

        if (
          documentUrl &&
          documentUrl !==
            lastDocumentUrl
        ) {
          if (
            visited.has(
              documentUrl
            )
          ) {
            console.log(
              "[HIB v2.1.5 chain] revisited document:",
              documentUrl
            );
          }
          else {
            visited.add(
              documentUrl
            );

            lastProgressAt =
              Date.now();

            console.log(
              "[HIB v2.1.5 chain] HOP",
              visited.size,
              documentUrl
            );
          }

          lastDocumentUrl =
            documentUrl;

          if (
            visited.size >
            5
          ) {
            throw new Error(
              "Maximum chain depth of 5 exceeded"
            );
          }
        }

        if (
          info.fullUrl &&
          hibV210TerminalImage(
            info.fullUrl
          )
        ) {
          const result = {
            ok:
              true,

            originalUrl:
              startUrl,

            fullUrl:
              info.fullUrl,

            source:
              info.source ||
              "chain inspector",

            chain:
              Array.from(
                visited
              ),

            pollCount:
              poll
          };

          hibV210ChainCache.set(
            startUrl,
            result
          );

          console.log(
            "[HIB v2.1.5 chain] ACTUAL PICTURE READY:",
            result
          );

          return result;
        }

        /*
         * If the current page exposes an explicit supported downstream
         * destination, follow the first one that is not already visited.
         */
        if (
          Array.isArray(
            info.outbound
          )
        ) {
          const next =
            info.outbound.find(
              item =>
                item &&
                item.url &&
                hibV210SupportedDestination(
                  item.url
                ) &&
                !visited.has(
                  item.url
                ) &&
                hibV210Host(
                  item.url
                ) !==
                  "ouo.io"
            );

          if (next) {
            console.log(
              "[HIB v2.1.5 chain] following supported outbound:",
              next.url
            );

            visited.add(
              next.url
            );

            if (
              visited.size >
              5
            ) {
              throw new Error(
                "Maximum chain depth of 5 exceeded"
              );
            }

            lastProgressAt =
              Date.now();

            await browser.tabs.update(
              tabId,
              {
                url:
                  next.url
              }
            );

            await hibV210Sleep(
              500
            );

            continue;
          }
        }

        /*
         * Give OUO's own page logic time to expose the continuation.
         * At most one automatic action is attempted every 2 seconds.
         */
        if (
          hibV210Host(
            documentUrl
          ) ===
            "ouo.io" &&
          info.actionAvailable &&
          (
            Date.now() -
            lastActionAt
          ) >=
            2000
        ) {
          lastActionAt =
            Date.now();

          try {
            const action =
              await hibV210AdvanceOuo(
                tabId
              );

            if (
              action &&
              action.acted
            ) {
              console.log(
                "[HIB v2.1.5 chain] OUO continuation:",
                action
              );

              lastProgressAt =
                Date.now();
            }
          }
          catch (error) {
            console.debug(
              "[HIB v2.1.5 chain] OUO continuation not ready:",
              String(error)
            );
          }
        }

        /*
         * Cloudflare/verification remains the only reason to make the
         * HIB-owned resolver tab active.
         */
        if (
          !surfaced &&
          info.challenge &&
          (
            Date.now() -
            started
          ) >=
            1500
        ) {
          surfaced =
            true;

          await hibV210SurfaceResolverTab(
            tabId
          );
        }
      }

      /*
       * TurboImageHost historically sometimes stalls without presenting a
       * recognizable challenge DOM. Surface only after several seconds of
       * no progress and only if the chain is already on TurboImageHost.
       */
      const currentHost =
        hibV210Host(
          lastDocumentUrl ||
          tabUrl
        );

      if (
        !surfaced &&
        currentHost ===
          "turboimagehost.com" &&
        (
          Date.now() -
          lastProgressAt
        ) >=
          4000
      ) {
        surfaced =
          true;

        console.log(
          "[HIB v2.1.5 chain] TurboImageHost stalled; surfacing resolver tab"
        );

        await hibV210SurfaceResolverTab(
          tabId
        );
      }

      await hibV210Sleep(
        500
      );
    }

    throw new Error(
      "Timed out after 45 seconds waiting for chained image resolution"
    );
  }
  finally {
    try {
      await browser.tabs.remove(
        tabId
      );

      console.log(
        "[HIB v2.1.5 chain] resolver tab closed:",
        tabId
      );
    }
    catch (error) {}
  }
}

browser.runtime.onMessage.addListener(
  message => {
    if (
      !message ||
      message.type !==
        "hib-v2-resolve-chain"
    ) {
      return undefined;
    }

    const startUrl =
      hibV210NormalizeOuo(
        message.pageUrl
      );

    if (!startUrl) {
      return Promise.resolve({
        ok:
          false,

        error:
          "Rejected non-OUO URL"
      });
    }

    if (
      hibV210ChainInflight.has(
        startUrl
      )
    ) {
      return hibV210ChainInflight.get(
        startUrl
      );
    }

    const job =
      hibV210ResolveChain(
        startUrl
      )
        .catch(error => ({
          ok:
            false,

          error:
            String(error)
        }))
        .finally(() => {
          hibV210ChainInflight.delete(
            startUrl
          );
        });

    hibV210ChainInflight.set(
      startUrl,
      job
    );

    return job;
  }
);

console.log(
  "[HIB v2.1.5 chain] isolated OUO resolver loaded"
);
/*
 * HIB-V212-IMGPV-BACKGROUND
 *
 * Direct ImgPV wrapper resolver:
 *
 *   imgpv.com/.../picture.jpg.html
 *        ->
 *   sN.imgpv.com/cgi-bin/dl.cgi/.../picture.jpg
 *
 * The content script later converts the CGI URL to a WordPress proxy.
 *
 * - no page-load resolution
 * - one wrapper -> one inactive resolver tab
 * - poll every 500 ms
 * - never focus resolver tab
 */

const hibV212ImgPvInflight =
  new Map();

const hibV212ImgPvCache =
  new Map();

function hibV212NormalizeImgPv(value) {
  let url;

  try {
    url =
      new URL(value);
  }
  catch (error) {
    return null;
  }

  const host =
    url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

  if (
    host !== "imgpv.com" &&
    !host.endsWith(".imgpv.com")
  ) {
    return null;
  }

  if (
    !/\.html(?:$|[?#])/i.test(
      url.pathname +
      url.search +
      url.hash
    )
  ) {
    return null;
  }

  return url.href;
}

function hibV212IsImgPvCgi(value) {
  /* IMGPV 2026-11: the full picture is now sN.imgpv.com/i/NNNNN/<id>.jpg (the wrapper page names it in its ImageObject / og:image); the old
   * /cgi-bin/dl.cgi/ path is still accepted. Thumbnails (<id>_t.jpg) never count. */
  try {
    const url =
      new URL(value);

    const host =
      url.hostname
        .toLowerCase();

    return (
      /(^|\.)imgpv\.com$/i.test(
        host
      ) &&
      (
        /^\/cgi-bin\/dl\.cgi\//i.test(url.pathname) ||
        (/^\/i\/\d+\/[^\/]+\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname) && !/_t\.[a-z0-9]+$/i.test(url.pathname))
      )
    );
  }
  catch (error) {
    return false;
  }
}

/* ===== IMAGE SECTION - SHARED PICTURE FINDER (new in 3.0.0) =====
 * A wrapper page names its picture in several standard ways, and sites change them. A host-specific resolver tries its own exact pattern first; when that finds
 * nothing it asks this finder, which reads every common signal on the page and ranks them:
 *   schema.org ImageObject (JSON-LD)  >  og:image / twitter:image / image_src / itemprop=image  >  large <img> (incl. lazy-load and srcset)  >  image links  >  image
 *   addresses inside the page's own scripts.
 * Thumbnails, logos, icons, sprites, avatars and banners are dropped. It reads the DOM only (no request, no click) and runs inside the wrapper tab. The caller
 * confirms the picture really is one (hibImgVerifyPicture) before using it, and records "layout changed" in the log so a site change is noticed. */
const HIB_IMG_FINDER = () => {
  const out = { href: location.href, title: document.title || "", readyState: document.readyState, candidates: [], best: null };
  const abs = v => {
    if (!v || typeof v !== "string") return null;
    try { const u = new URL(v.trim().replace(/\\\//g, "/"), location.href); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (e) { return null; }
  };
  const IMG = /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:$|[?#])/i;
  const BAD = /(?:favicon|\/(?:logos?|icons?|sprites?|avatars?|banners?|ads?|adv|badges?|emoji|flags?|smilies)\b|[_\-.](?:logo|icon|sprite|avatar|banner|badge)\b|\/thumbs?\/|\/thumbnails?\/|[_.\-](?:t|th|thumb|tn|small|sm|mini|xs)\.[a-z0-9]+(?:$|[?#]))/i;
  const found = new Map();
  const add = (value, source, weight, area, lowConfidence) => {
    const url = abs(value);
    if (!url || url === location.href || /^data:/i.test(url)) return;
    if (lowConfidence && (!IMG.test(url) || BAD.test(url))) return;
    const score = weight + Math.min(30, Math.floor((area || 0) / 100000));
    const cur = found.get(url);
    if (!cur || score > cur.score) found.set(url, { url, source, score, area: area || 0 });
  };
  // 1) schema.org JSON-LD: contentUrl / image of an ImageObject
  try {
    const walk = node => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node.contentUrl === "string") add(node.contentUrl, "json-ld contentUrl", 100, 0, false);
      if (/ImageObject/i.test(String(node["@type"] || ""))) {
        if (typeof node.url === "string") add(node.url, "json-ld ImageObject url", 95, 0, false);
      }
      if (typeof node.image === "string") add(node.image, "json-ld image", 90, 0, false);
      else if (node.image && typeof node.image === "object") {
        const list = Array.isArray(node.image) ? node.image : [node.image];
        for (const i of list) if (i && typeof i === "object" && typeof i.url === "string") add(i.url, "json-ld image.url", 90, 0, false);
      }
      for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k]);
    };
    for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(sc.textContent)); } catch (e) {} }
  } catch (e) {}
  // 2) page metadata
  for (const [sel, name, w] of [
    ['meta[property="og:image:secure_url"]', "og:image:secure_url", 82], ['meta[property="og:image"]', "og:image", 80],
    ['meta[name="twitter:image"],meta[property="twitter:image"]', "twitter:image", 78], ['meta[name="twitter:image:src"]', "twitter:image:src", 78],
    ['meta[itemprop="image"]', "itemprop image", 76]]) {
    for (const m of document.querySelectorAll(sel)) add(m.content, name, w, 0, false);
  }
  for (const l of document.querySelectorAll('link[rel="image_src"]')) add(l.href, "link image_src", 77, 0, false);
  for (const e of document.querySelectorAll('img[itemprop="image"],a[itemprop="image"]')) add(e.currentSrc || e.src || e.href, "itemprop image element", 74, 0, false);
  // 3) the pictures on the page: the larger the better; lazy-load attributes and srcset included
  for (const img of document.querySelectorAll("img")) {
    const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
    const rw = img.width || 0, rh = img.height || 0;
    if ((nw && nh && (nw < 160 || nh < 160)) || (!nw && rw && rh && (rw < 60 || rh < 60))) continue;
    const area = (nw * nh) || (rw * rh);
    add(img.currentSrc || img.src, "img", 50, area, true);
    for (const attr of ["data-src", "data-original", "data-lazy-src", "data-original-src", "data-full", "data-large-src", "data-zoom-src", "data-file", "data-url"]) add(img.getAttribute(attr), "img " + attr, 55, area, true);
    const set = img.getAttribute("srcset") || img.getAttribute("data-srcset");
    if (set) {
      let top = null, topW = 0;
      for (const part of set.split(",")) { const [u, d] = part.trim().split(/\s+/); const w = parseInt(d, 10) || 0; if (u && w >= topW) { top = u; topW = w; } }
      if (top) add(top, "img srcset", 52, topW * topW, true);
    }
  }
  // 4) links straight to a picture
  for (const a of document.querySelectorAll("a[href]")) add(a.href, a.querySelector("img") ? "a[href] around img" : "a[href]", a.querySelector("img") ? 44 : 38, 0, true);
  // 5) picture addresses written inside the page's own scripts
  try {
    let n = 0;
    for (const sc of document.scripts) {
      if (sc.src || sc.type === "application/ld+json") continue;
      const text = (sc.textContent || "").slice(0, 300000);
      for (const m of text.matchAll(/https?:(?:\\?\/){2}(?:[^"'\s\\<>()]|\\\/)+?\.(?:jpe?g|png|webp|gif|avif)(?:\?(?:[^"'\s\\<>()]|\\\/)*)?/gi)) {
        add(m[0], "inline script", 30, 0, true);
        if (++n > 30) break;
      }
      if (n > 30) break;
    }
  } catch (e) {}
  out.candidates = [...found.values()].sort((a, b) => b.score - a.score).slice(0, 12);
  out.best = out.candidates.length ? out.candidates[0] : null;
  return out;
};

const hibImgFinderSticky = new Map();   // tabId -> { url, source, score } : a finder result that was verified (generic resolver)
async function hibImgFindPicture(tabId) {
  try {
    const result = await browser.tabs.executeScript(tabId, { runAt: "document_end", code: "(" + HIB_IMG_FINDER.toString() + ")()" });
    return result && result.length ? result[0] : null;
  }
  catch (error) { return null; }
}

/* Confirm a found address is really a picture of a useful size (not an icon or a page): one small ranged request, 8 s limit. A host that refuses the request
 * (hot-link protection: 401/403) is not held against the candidate; only a clear "not a picture" / "too small" / "gone" is. */
async function hibImgVerifyPicture(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(String(url), { headers: { Range: "bytes=0-1023" }, cache: "no-store", credentials: "omit", signal: ctl.signal });
    try { r.body && r.body.cancel(); } catch (e) {}
    if (r.status === 404 || r.status === 410) return false;
    if (r.status === 401 || r.status === 403 || r.status >= 500) return true;
    const type = String(r.headers.get("content-type") || "").toLowerCase();
    if (type && !/^image\//.test(type) && !/octet-stream/.test(type)) return false;
    const range = String(r.headers.get("content-range") || "").match(/\/(\d+)\s*$/);
    const size = range ? Number(range[1]) : Number(r.headers.get("content-length") || 0);
    if (size && size < 12000) return false;
    return true;
  }
  catch (error) { return true; }
  finally { clearTimeout(timer); }
}
window.hibImgFindPicture = hibImgFindPicture; window.HIB_IMG_FINDER = HIB_IMG_FINDER; window.hibImgVerifyPicture = hibImgVerifyPicture;   /* reachable for diagnostics */
/* ===== END IMAGE SECTION - SHARED PICTURE FINDER ===== */

async function hibV212InspectImgPvTab(
  tabId
) {
  const inspect = () => {
    function absolute(value) {
      if (!value) {
        return null;
      }

      try {
        return new URL(
          value,
          location.href
        ).href;
      }
      catch (error) {
        return null;
      }
    }

    function isCgi(value) {
      if (!value) {
        return false;
      }

      try {
        const url =
          new URL(
            value,
            location.href
          );

        return (
          /(^|\.)imgpv\.com$/i.test(
            url.hostname
          ) &&
          (
            /^\/cgi-bin\/dl\.cgi\//i.test(url.pathname) ||
            (/^\/i\/\d+\/[^\/]+\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname) && !/_t\.[a-z0-9]+$/i.test(url.pathname))
          )
        );
      }
      catch (error) {
        return false;
      }
    }

    const candidates =
      [];

    function add(
      value,
      source,
      width,
      height
    ) {
      const url =
        absolute(value);

      if (
        !url ||
        !isCgi(url)
      ) {
        return;
      }

      candidates.push({
        url,
        source,
        width:
          Number(width || 0),
        height:
          Number(height || 0)
      });
    }

    for (
      const img of
      document.querySelectorAll(
        "img"
      )
    ) {
      const width =
        img.naturalWidth ||
        img.width ||
        0;

      const height =
        img.naturalHeight ||
        img.height ||
        0;

      add(
        img.currentSrc,
        "img.currentSrc",
        width,
        height
      );

      add(
        img.src,
        "img.src",
        width,
        height
      );

      for (
        const attr of [
          "data-src",
          "data-original",
          "data-lazy-src",
          "data-original-src"
        ]
      ) {
        add(
          img.getAttribute(
            attr
          ),
          attr,
          width,
          height
        );
      }
    }

    for (
      const anchor of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      add(
        anchor.href,
        "a[href]",
        0,
        0
      );
    }

    const og =
      document.querySelector(
        'meta[property="og:image"]'
      );

    if (og) {
      add(
        og.content,
        "og:image",
        0,
        0
      );
    }

    /* IMGPV 2026-11: the page lists the picture in a schema.org ImageObject (contentUrl). It sits in the page head, so it is there long before a slow
     * page has finished loading. Read it first. */
    try {
      const want = [];
      const walk = node => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (typeof node.contentUrl === "string") want.push(node.contentUrl);
        for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k]);
      };
      for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { walk(JSON.parse(sc.textContent)); } catch (e) {}
      }
      for (const u of want) {
        add(u, "json-ld contentUrl", 1000000, 1000000);
      }
    }
    catch (error) {}

    candidates.sort(
      (a, b) => {
        const areaA =
          a.width *
          a.height;

        const areaB =
          b.width *
          b.height;

        return areaB - areaA;
      }
    );

    return {
      href:
        location.href,

      title:
        document.title || "",

      readyState:
        document.readyState,

      fullUrl:
        candidates.length
          ? candidates[0].url
          : null,

      source:
        candidates.length
          ? candidates[0].source
          : null,

      candidates:
        candidates.slice(
          0,
          10
        )
    };
  };

  const result =
    await browser.tabs.executeScript(
      tabId,
      {
        runAt:
          "document_end",

        code:
          "(" +
          inspect.toString() +
          ")()"
      }
    );

  return (
    result &&
    result.length
  )
    ? result[0]
    : null;
}

/* IMAGE SECTION: ImgPV normally answers in 2-3 s. No picture after 10 s -> the tab is closed and ONE fresh unfocused tab is tried (see hibV210ResolveChain). */
async function hibV212ResolveImgPv(pageUrl) {
  hibImgTrace("RESOLVE_START", { key: pageUrl, kind: "imgpv" });
  try {
    const r = await hibV212ResolveImgPvOnce(pageUrl);
    hibImgTrace("RESOLVE_DONE", { key: pageUrl, kind: "imgpv", ok: !!(r && r.ok !== false) });
    return r;
  }
  catch (error) {
    if (!(error && error.hibLoadStall)) { hibImgTrace("RESOLVE_FAILED", { key: pageUrl, kind: "imgpv", error: String(error && error.message || error).slice(0, 160) }); throw error; }
    hibImgTrace("RESOLVE_STALL_RETRY", { key: pageUrl, kind: "imgpv", why: "no progress in 10 s, one retry" });
    console.log("[HIB image] ImgPV tab made no progress in 10 s - retrying once:", pageUrl);
    try {
      const r = await hibV212ResolveImgPvOnce(pageUrl);
      hibImgTrace("RESOLVE_DONE", { key: pageUrl, kind: "imgpv (retry)", ok: !!(r && r.ok !== false) });
      return r;
    }
    catch (e2) { hibImgTrace("RESOLVE_FAILED", { key: pageUrl, kind: "imgpv (retry)", error: String(e2 && e2.message || e2).slice(0, 160) }); throw e2; }
  }
}
async function hibV212ResolveImgPvOnce(
  pageUrl
) {
  const target =
    hibV212NormalizeImgPv(
      pageUrl
    );

  if (!target) {
    throw new Error(
      "Rejected non-ImgPV wrapper"
    );
  }

  if (
    hibV212ImgPvCache.has(
      target
    )
  ) {
    return hibV212ImgPvCache.get(
      target
    );
  }

  const tab =
    await hibV218CreateOwnedTab({
      url:
        target,

      active:
        false
    });

  if (
    !tab ||
    typeof tab.id !==
      "number"
  ) {
    throw new Error(
      "ImgPV resolver tab creation failed"
    );
  }

  const tabId =
    tab.id;

  const started =
    Date.now();

  let poll =
    0;

  let lastInfo =
    null;

  console.log(
    "[HIB v2.1.5 ImgPV background] polling started:",
    target
  );

  try {
    while (
      Date.now() - started <
      20000
    ) {
      poll +=
        1;

      if (window.hibImgIsDown && window.hibImgIsDown(target)) {
        throw new Error("Image host is down (recent probe); resolver stopped");
      }
      if (Date.now() - started > HIB_IMG_LOAD_STALL_MS) {
        const stall = new Error("ImgPV resolver made no progress for 10 s");
        stall.hibLoadStall = true;
        throw stall;
      }

      try {
        const info =
          await hibV212InspectImgPvTab(
            tabId
          );

        if (info) {
          lastInfo =
            info;

          console.log(
            "[HIB v2.1.5 ImgPV background] poll:",
            poll,
            info.fullUrl ||
              "waiting"
          );

          if (
            info.fullUrl &&
            hibV212IsImgPvCgi(
              info.fullUrl
            )
          ) {
            const result = {
              ok:
                true,

              pageUrl:
                target,

              fullUrl:
                info.fullUrl,

              source:
                info.source,

              pollCount:
                poll
            };

            hibV212ImgPvCache.set(
              target,
              result
            );

            console.log(
              "[HIB v2.1.5 ImgPV background] CGI READY:",
              info.fullUrl
            );

            return result;
          }
        }
      }
      catch (error) {
        console.debug(
          "[HIB v2.1.5 ImgPV background] waiting:",
          String(error)
        );
      }

      /* Layout fallback: the exact imgpv address pattern did not appear (the site changed its pages again?). After a short grace period, ask the shared picture
       * finder; a verified result is used and "layout changed" is written to the log so the change is noticed. */
      if (Date.now() - started > 3500 && poll % 4 === 0) {
        const fb = await hibImgFindPicture(tabId);
        const best = fb && fb.best;
        if (best && /^https:/i.test(best.url) && await hibImgVerifyPicture(best.url)) {
          const result = {
            ok: true,
            pageUrl: target,
            fullUrl: best.url,
            source: "layout-fallback: " + best.source,
            layoutFallback: true,
            pollCount: poll
          };
          console.warn("[HIB LAYOUT CHANGED] imgpv wrapper no longer matches the known address pattern; used the shared finder:", best.source, best.url);
          hibV212ImgPvCache.set(target, result);
          return result;
        }
      }

      await sleep(
        500
      );
    }

    throw new Error(
      "ImgPV CGI URL did not appear before timeout. Last inspection: " +
      JSON.stringify(
        lastInfo
      )
    );
  }
  finally {
    try {
      await browser.tabs.remove(
        tabId
      );
    }
    catch (error) {}
  }
}

browser.runtime.onMessage.addListener(
  message => {
    if (
      !message ||
      message.type !==
        "hib-v2-resolve-imgpv"
    ) {
      return undefined;
    }

    const target =
      hibV212NormalizeImgPv(
        message.pageUrl
      );

    if (!target) {
      return Promise.resolve({
        ok:
          false,

        error:
          "Rejected non-ImgPV wrapper"
      });
    }

    if (
      hibV212ImgPvInflight.has(
        target
      )
    ) {
      return hibV212ImgPvInflight.get(
        target
      );
    }

    const job =
      hibV212ResolveImgPv(
        target
      )
        .catch(error => ({
          ok:
            false,

          error:
            String(error)
        }))
        .finally(() => {
          hibV212ImgPvInflight.delete(
            target
          );
        });

    hibV212ImgPvInflight.set(
      target,
      job
    );

    return job;
  }
);

console.log(
  "[HIB v2.1.5 ImgPV background] isolated resolver loaded"
);
/*
 * HIB-V213-GENERIC-BACKGROUND
 *
 * Last-resort image-wrapper resolver.
 *
 * This does NOT replace specialized handlers.
 *
 * Rules:
 * - one URL -> one inflight job
 * - one inactive resolver tab
 * - never focus the resolver tab
 * - poll every 500 ms
 * - maximum 4 document hops
 * - loop detection
 * - only accept strong image candidates
 * - only follow image-looking outbound links
 */

const hibV213GenericInflight =
  new Map();

const hibV213GenericCache =
  new Map();

function hibV213Sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function hibV213NormalizeUrl(value) {
  try {
    const url =
      new URL(value);

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return null;
    }

    return url.href;
  }
  catch (error) {
    return null;
  }
}

function hibV213DirectImage(value) {
  try {
    const url =
      new URL(value);

    return /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:$|[?#])/i.test(
      url.pathname +
      url.search +
      url.hash
    );
  }
  catch (error) {
    return false;
  }
}

/*
 * HIB-V250-NHPLAYER-DIAGNOSTICS
 *
 * Read-only runtime logging.
 * No changes to resolver ownership, scoring or navigation.
 */
function hibV250IsNH(value) {
  try {
    return /^(?:www\.)?nhplayer\.com$/i.test(
      new URL(String(value || "")).hostname
    );
  }
  catch (error) {
    return false;
  }
}

function hibV250SafeURL(value) {
  try {
    const u = new URL(String(value || ""));
    return u.origin + u.pathname +
      (u.search ? "?[QUERY REDACTED]" : "");
  }
  catch (error) {
    return "[unavailable]";
  }
}

function hibV250Log(original, label, details) {
  if (!hibV250IsNH(original)) {
    return;
  }

  console.log(
    "[HIB v2.1.5 NHPlayer] " + label,
    details
  );
}
async function hibV213InspectGenericTab(
  tabId
) {
  const inspect = () => {
    function absolute(value) {
      if (!value) {
        return null;
      }

      try {
        return new URL(
          value,
          location.href
        ).href;
      }
      catch (error) {
        return null;
      }
    }

    function directImage(value) {
      if (!value) {
        return false;
      }

      try {
        const url =
          new URL(
            value,
            location.href
          );

        return /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:$|[?#])/i.test(
          url.pathname +
          url.search +
          url.hash
        );
      }
      catch (error) {
        return false;
      }
    }

    function directMedia(value) {
      if (!value) {
        return false;
      }

      try {
        const url =
          new URL(
            value,
            location.href
          );

        return /\.(?:mp4|webm|m4v|mov|m3u8|mpd|mp3|ogg|wav|m4a)(?:$|[?#])/i.test(
          url.pathname +
          url.search +
          url.hash
        );
      }
      catch (error) {
        return false;
      }
    }
    function badImage(value) {
      const text =
        String(value || "")
          .toLowerCase();

      return (
        /(?:logo|favicon|avatar|emoji|icon|sprite|tracking|pixel|banner|advert|ads?\/)/i.test(
          text
        )
      );
    }

    const images =
      new Map();

    /*
     * HIB-V223-MEDIA-CANDIDATES
     *
     * Real playable media is collected independently from still images.
     * If playable media exists, it takes precedence over preview/poster
     * images.
     */
    const media =
      new Map();

    function addMedia(
      value,
      baseScore,
      source
    ) {
      const url =
        absolute(
          value
        );

      if (
        !url ||
        !directMedia(
          url
        )
      ) {
        return;
      }

      const score =
        Number(
          baseScore || 0
        );

      const current =
        media.get(
          url
        );

      if (
        !current ||
        score >
          current.score
      ) {
        media.set(
          url,
          {
            url,
            score,
            source,
            width:
              0,
            height:
              0,
            media:
              true
          }
        );
      }
    }

    /*
     * HIB-V251-NHPLAYER-IFRAME-INIT
     *
     * Initialize NHPlayer using its existing Main Player selector.
     * Keep the original /v/ document in the owned inactive tab.
     *
     * The same-origin player iframe exposes the authorized media
     * through video.currentSrc without requiring playback.
     *
     * Never activate the resolver tab or create another tab.
     */
    try {
      const hibV251Page = new URL(location.href);

      const hibV251Eligible =
        /^(?:www\.)?nhplayer\.com$/i.test(
          hibV251Page.hostname
        ) &&
        /^\/v\/[^/]+\/?$/i.test(
          hibV251Page.pathname
        );

      if (hibV251Eligible) {
        const hibV251Root = document.documentElement;
        const hibV251Selector =
          document.querySelector("li[data-id]");

        if (
          hibV251Root &&
          hibV251Selector &&
          document.readyState === "complete" &&
          !hibV251Root.dataset.hibV251Activated
        ) {
          const hibV251Target = new URL(
            hibV251Selector.getAttribute("data-id"),
            location.href
          );

          if (
            hibV251Target.origin === hibV251Page.origin &&
            /^\/player\.php$/i.test(
              hibV251Target.pathname
            )
          ) {
            /*
             * HIB-V254-NHPLAYER-PAGE-CONTEXT
             *
             * Firefox-specific diagnostic.
             *
             * Wait until the parent document is complete.
             * Invoke the existing Main Player selector through
             * Firefox's unwrapped page object.
             *
             * No focus change, direct media play, or new tab.
             *
             * This tests whether the page-object execution
             * path differs from the isolated DOM click.
             */
            hibV251Root.dataset.hibV251Activated = "1";

            /*
             * HIB-V256-NHPLAYER-CONDITIONAL-DOUBLE-CLICK
             *
             * NHPlayer-only experiment.
             *
             * Dispatch one page-realm synthetic click.
             * After 300 ms, dispatch a second click only
             * if no player.php iframe navigation is visible.
             *
             * Never focus the tab or initiate playback.
             */

            const hibV256PageWindow = window.wrappedJSObject;

            if (
              hibV256PageWindow &&
              hibV256PageWindow.document &&
              typeof hibV256PageWindow.MouseEvent === "function"
            ) {
              try {
                const hibV256Document =
                  hibV256PageWindow.document;

                const hibV256Selector =
                  hibV256Document.querySelector("li[data-id]");

                const hibV256PlayerStarted = () => {
                  for (
                    const frame of
                    hibV256Document.querySelectorAll("iframe")
                  ) {
                    try {
                      const src =
                        frame.getAttribute("src") || "";

                      if (
                        /\/player\.php(?:\?|$)/i.test(src)
                      ) {
                        return true;
                      }

                      const frameLocation =
                        frame.contentWindow.location.pathname;

                      if (
                        frameLocation === "/player.php"
                      ) {
                        return true;
                      }
                    }
                    catch (error) {
                      // A cross-origin iframe is not proof
                      // of NHPlayer initialization.
                    }
                  }

                  return false;
                };

                const hibV256Click = number => {
                  /* HIB-V257-NHPLAYER-CLONED-MOUSE-EVENT */
                  if (typeof cloneInto !== "function") {
                    throw new Error(
                      "Firefox cloneInto unavailable in extension context"
                    );
                  }

                  const hibV257EventOptions = cloneInto(
                    {
                      bubbles: true,
                      cancelable: true,
                      composed: true,
                      button: 0
                    },
                    hibV256PageWindow
                  );

                  const event =
                    new hibV256PageWindow.MouseEvent(
                      "click",
                      hibV257EventOptions
                    );

                  hibV256Selector.dispatchEvent(event);

                  console.log(
                    "[HIB v2.1.5 NHPlayer] CLICK:",
                    JSON.stringify({
                      number: number,
                      trusted: event.isTrusted,
                      visibility:
                        document.visibilityState,
                      focused:
                        document.hasFocus(),
                      playerStarted:
                        hibV256PlayerStarted()
                    })
                  );
                };

                if (!hibV256Selector) {
                  console.warn(
                    "[HIB v2.1.5 NHPlayer] SELECTOR MISSING"
                  );
                }
                else if (hibV256PlayerStarted()) {
                  console.log(
                    "[HIB v2.1.5 NHPlayer] PLAYER ALREADY STARTED"
                  );
                }
                else {
                  hibV256Click(1);

                  setTimeout(() => {
                    try {
                      if (
                        !hibV256Document.documentElement ||
                        hibV256PlayerStarted()
                      ) {
                        console.log(
                          "[HIB v2.1.5 NHPlayer] SECOND CLICK SKIPPED: player already started"
                        );
                        return;
                      }

                      hibV256Click(2);

                      setTimeout(() => {
                        console.log(
                          "[HIB v2.1.5 NHPlayer] FINAL STATE:",
                          JSON.stringify({
                            playerStarted:
                              hibV256PlayerStarted(),
                            visibility:
                              document.visibilityState,
                            focused:
                              document.hasFocus()
                          })
                        );
                      }, 1000);
                    }
                    catch (error) {
                      console.warn(
                        "[HIB v2.1.5 NHPlayer] RETRY ERROR:",
                        String(error)
                      );
                    }
                  }, 300);
                }
              }
              catch (error) {
                console.warn(
                  "[HIB v2.1.5 NHPlayer] INIT ERROR:",
                  String(error)
                );
              }
            }
            else {
              console.warn(
                "[HIB v2.1.5 NHPlayer] PAGE CONTEXT UNAVAILABLE"
              );
            }
          }
        }

        for (
          const hibV251Frame of
          document.querySelectorAll("iframe")
        ) {
          try {
            const hibV251Doc =
              hibV251Frame.contentDocument;

            if (
              !hibV251Doc ||
              hibV251Doc.location.pathname !==
                "/player.php"
            ) {
              continue;
            }

            for (
              const hibV251Video of
              hibV251Doc.querySelectorAll("video")
            ) {
              const hibV251Media =
                hibV251Video.currentSrc ||
                hibV251Video.src;

              if (
                hibV251Media &&
                /[?&]verify=/i.test(
                  hibV251Media
                ) &&
                directMedia(hibV251Media)
              ) {
                addMedia(
                  hibV251Media,
                  90000,
                  "NHPlayer verified iframe video"
                );
              }
            }
          }
          catch (error) {
            // The frame may still be navigating.
          }
        }
      }
    }
    catch (error) {
      console.log(
        "[HIB v2.1.5 NHPlayer] INITIALIZATION ERROR:",
        error && error.name ? error.name : "Error"
      );
    }
    function addImage(
      value,
      baseScore,
      source,
      width,
      height
    ) {
      const url =
        absolute(value);

      if (
        !url ||
        !directImage(url) ||
        badImage(url)
      ) {
        return;
      }

      const w =
        Number(width || 0);

      const h =
        Number(height || 0);

      let score =
        Number(baseScore || 0);

      if (
        w >= 300 ||
        h >= 300
      ) {
        score +=
          6000;
      }

      if (
        w > 0 &&
        h > 0
      ) {
        score +=
          Math.min(
            18000,
            Math.floor(
              (w * h) /
              100
            )
          );
      }

      if (
        /(?:full|original|large|source|upload|image|photo|picture)/i.test(
          url
        )
      ) {
        score +=
          2500;
      }

      const current =
        images.get(url);

      if (
        !current ||
        score >
          current.score
      ) {
        images.set(
          url,
          {
            url,
            score,
            source,
            width:
              w,
            height:
              h
          }
        );
      }
    }

    for (
      const video of
      document.querySelectorAll(
        "video"
      )
    ) {
      addMedia(
        video.currentSrc,
        70000,
        "video.currentSrc"
      );

      addMedia(
        video.src ||
          video.getAttribute(
            "src"
          ),
        69000,
        "video.src"
      );

      for (
        const source of
        video.querySelectorAll(
          "source[src]"
        )
      ) {
        addMedia(
          source.src ||
            source.getAttribute(
              "src"
            ),
          68000,
          "video source"
        );
      }
    }

    for (
      const audio of
      document.querySelectorAll(
        "audio"
      )
    ) {
      addMedia(
        audio.currentSrc,
        67000,
        "audio.currentSrc"
      );

      addMedia(
        audio.src ||
          audio.getAttribute(
            "src"
          ),
        66000,
        "audio.src"
      );

      for (
        const source of
        audio.querySelectorAll(
          "source[src]"
        )
      ) {
        addMedia(
          source.src ||
            source.getAttribute(
              "src"
            ),
          65000,
          "audio source"
        );
      }
    }

    for (
      const source of
      document.querySelectorAll(
        "source[src]"
      )
    ) {
      addMedia(
        source.src ||
          source.getAttribute(
            "src"
          ),
        64000,
        "source.src"
      );
    }

    const mediaMetaSelectors =
      [
        [
          'meta[property="og:video"]',
          63000,
          "og:video"
        ],
        [
          'meta[property="og:video:url"]',
          63000,
          "og:video:url"
        ],
        [
          'meta[property="og:video:secure_url"]',
          63500,
          "og:video:secure_url"
        ],
        [
          'meta[name="twitter:player:stream"]',
          62500,
          "twitter:player:stream"
        ],

        /*
         * Sankaku video posts currently expose their signed MP4 URL
         * through og:image. addMedia() accepts it only when it is truly
         * a media URL, so ordinary JPEG/PNG/AVIF og:image values are not
         * affected.
         */
        [
          'meta[property="og:image"]',
          62000,
          "og:image media"
        ]
      ];

    for (
      const entry of
      mediaMetaSelectors
    ) {
      const node =
        document.querySelector(
          entry[0]
        );

      if (!node) {
        continue;
      }

      addMedia(
        node.content,
        entry[1],
        entry[2]
      );
    }

    /*
     * HIB-V248-ENCODED-PLAYER-MEDIA
     *
     * Read explicit player.php?vid=Base64 media declarations.
     * Submit decoded media to the existing generic media pipeline.
     *
     * No additional tabs, clicks, or network interception.
     */
    function hibV248DecodePlayerMedia(raw) {
      if (!raw || typeof raw !== "string") {
        return null;
      }

      try {
        const wrapper = new URL(raw, location.href);

        if (!/^https?:$/.test(wrapper.protocol)) {
          return null;
        }

        if (!/\/player\.php$/i.test(wrapper.pathname)) {
          return null;
        }

        const encoded = wrapper.searchParams.get("vid");

        if (!encoded || encoded.length > 16384) {
          return null;
        }

        const normalized = encoded.trim()
          .replace(/-/g, "+")
          .replace(/_/g, "/");

        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
          return null;
        }

        const decoded = atob(normalized);
        const separator = decoded.indexOf("|");

        const first = (
          separator >= 0
            ? decoded.slice(0, separator)
            : decoded
        ).trim();

        if (!first || first.length > 8192) {
          return null;
        }

        const mediaUrl = new URL(first);

        if (!/^https?:$/.test(mediaUrl.protocol)) {
          return null;
        }

        if (!directMedia(mediaUrl.href)) {
          return null;
        }

        return mediaUrl.href;
      }
      catch (error) {
        return null;
      }
    }

    const hibV248Attributes = [
      "data-id",
      "data-url",
      "data-src",
      "data-video",
      "data-stream"
    ];

    for (const attribute of hibV248Attributes) {
      const selector = "[" + attribute + "]";

      for (const element of document.querySelectorAll(selector)) {
        const raw = element.getAttribute(attribute);
        const decoded = hibV248DecodePlayerMedia(raw);

        if (!decoded) {
          continue;
        }

        /*
         * HIB-V249-NHPLAYER-VERIFIED-WRAPPER
         *
         * NHPlayer's /v/ page exposes a Base64 declaration whose
         * first field is an unsigned MP4.
         *
         * Do not promote that MP4 into the media candidate list.
         *
         * The existing v2.1.3 outbound resolver will instead follow
         * the data-id player.php wrapper using its one owned tab.
         *
         * player.php initializes JWPlayer and exposes the authorized
         * MP4 with its verify query through video.currentSrc.
         *
         * This exception applies only to NHPlayer /v/ documents.
         * Generic encoded-player handling remains unchanged elsewhere.
         */
        if (
          /^(?:www\.)?nhplayer\.com$/i.test(location.hostname) &&
          /^\/v\/[^/]+\/?$/i.test(location.pathname) &&
          /^\/player\.php$/i.test(
            new URL(raw, location.href).pathname
          )
        ) {
          continue;
        }

        addMedia(
          decoded,
          72000,
          "encoded player vid"
        );
      }
    }
    for (
      const anchor of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      addMedia(
        anchor.href,
        60000,
        "a[href=media]"
      );
    }
    const og =
      document.querySelector(
        'meta[property="og:image"]'
      );

    if (og) {
      addImage(
        og.content,
        18000,
        "og:image",
        0,
        0
      );
    }

    const ogSecure =
      document.querySelector(
        'meta[property="og:image:secure_url"]'
      );

    if (ogSecure) {
      addImage(
        ogSecure.content,
        18500,
        "og:image:secure_url",
        0,
        0
      );
    }

    const twitter =
      document.querySelector(
        'meta[name="twitter:image"],meta[property="twitter:image"]'
      );

    if (twitter) {
      addImage(
        twitter.content,
        16000,
        "twitter:image",
        0,
        0
      );
    }

    for (
      const img of
      document.querySelectorAll(
        "img"
      )
    ) {
      const width =
        img.naturalWidth ||
        img.width ||
        0;

      const height =
        img.naturalHeight ||
        img.height ||
        0;

      addImage(
        img.currentSrc,
        5000,
        "img.currentSrc",
        width,
        height
      );

      addImage(
        img.src,
        4500,
        "img.src",
        width,
        height
      );

      for (
        const attr of [
          "data-src",
          "data-lazy-src",
          "data-original",
          "data-original-src",
          "data-image",
          "data-full",
          "data-fullsrc"
        ]
      ) {
        addImage(
          img.getAttribute(
            attr
          ),
          4800,
          "img." +
            attr,
          width,
          height
        );
      }

      const srcset =
        img.getAttribute(
          "srcset"
        );

      if (srcset) {
        for (
          const item of
          srcset.split(",")
        ) {
          addImage(
            item
              .trim()
              .split(/\s+/)[0],
            5000,
            "img.srcset",
            width,
            height
          );
        }
      }
    }

    /*
     * Full image links are usually stronger than arbitrary DOM images.
     */
    for (
      const anchor of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      if (
        directImage(
          anchor.href
        )
      ) {
        addImage(
          anchor.href,
          15000,
          "a[href=image]",
          0,
          0
        );
      }
    }

    const orderedMedia =
      Array.from(
        media.values()
      )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    const orderedImages =
      Array.from(
        images.values()
      )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    /*
     * Collect plausible image-wrapper continuation links.
     *
     * We deliberately do not follow every link on an unknown page.
     */
    const outbound =
      [];

    const seenOutbound =
      new Set();

    for (
      const anchor of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      const url =
        absolute(
          anchor.href
        );

      if (
        !url ||
        seenOutbound.has(
          url
        ) ||
        url ===
          location.href
      ) {
        continue;
      }

      let score =
        0;

      const text =
        (
          anchor.textContent ||
          ""
        )
          .trim()
          .toLowerCase();

      const pathText =
        url.toLowerCase();

      if (
        directImage(url)
      ) {
        score +=
          20000;
      }

      if (
        anchor.querySelector(
          "img"
        )
      ) {
        score +=
          5000;
      }

      if (
        /full\s*(?:size|image)|original|view\s*(?:image|photo)|open\s*(?:image|photo)|download\s*(?:image|photo)/i.test(
          text
        )
      ) {
        score +=
          5000;
      }

      if (
        /\.(?:jpe?g|png|gif|webp|avif|bmp)\.(?:html?|php)(?:$|[?#])/i.test(
          pathText
        )
      ) {
        score +=
          4500;
      }

      if (
        /\/(?:image|images|img|photo|picture|pic|view|full|original|gallery|cover|p)\//i.test(
          pathText
        )
      ) {
        score +=
          2500;
      }

      /*
       * Require a meaningful image signal.
       */
      if (
        score <
        2500
      ) {
        continue;
      }

      seenOutbound.add(
        url
      );

      outbound.push({
        url,
        score,
        text:
          text.slice(
            0,
            100
          )
      });
    }

    /*
     * HIB-V247-DATA-ID-MEDIA-WRAPPER
     *
     * Some media hosts expose their playable continuation through a
     * JavaScript-controlled data-* attribute rather than an <a href>.
     *
     * NHPlayer is a concrete example:
     *
     *   <li data-id="/player.php?vid=...">
     *
     * Do not decode the embedded media token here. The player.php wrapper
     * may contain expiry/signature information required by the host.
     *
     * Instead, treat an HTTP(S) data-id URL containing a player-style path
     * and a media token parameter as a strong wrapper continuation.
     *
     * The existing generic resolver will navigate its one owned inactive
     * resolver tab to that wrapper and then inspect the resulting document
     * for real video/source/meta media.
     */
    for (
      const element of
      document.querySelectorAll(
        '[data-id]'
      )
    ) {
      const raw =
        element.getAttribute(
          'data-id'
        );

      if (!raw) {
        continue;
      }

      const url =
        absolute(
          raw
        );

      if (
        !url ||
        seenOutbound.has(
          url
        ) ||
        url ===
          location.href
      ) {
        continue;
      }

      let parsed =
        null;

      try {
        parsed =
          new URL(
            url
          );
      }
      catch (error) {
        parsed =
          null;
      }

      if (!parsed) {
        continue;
      }

      const path =
        parsed.pathname
          .toLowerCase();

      const hasMediaToken =
        parsed.searchParams.has(
          'vid'
        ) ||
        parsed.searchParams.has(
          'video'
        ) ||
        parsed.searchParams.has(
          'media'
        ) ||
        parsed.searchParams.has(
          'file'
        ) ||
        parsed.searchParams.has(
          'source'
        );

      const playerLike =
        /(?:^|\/)(?:player|embed|watch)(?:\.php)?(?:\/|$)/i.test(
          path
        );

      if (
        !playerLike ||
        !hasMediaToken
      ) {
        continue;
      }

      seenOutbound.add(
        url
      );

      outbound.push({
        url,

        score:
          60000,

        text:
          'data-id media wrapper'
      });
    }

    /*
     * HIB-V251-NHPLAYER-IFRAME-OUTBOUND-HOLD
     *
     * Once normal NHPlayer iframe initialization has begun,
     * remain on /v/ and allow the iframe media to become ready.
     * Do not replace the parent with player.php.
     */
    if (
      /^(?:www\.)?nhplayer\.com$/i.test(
        location.hostname
      ) &&
      /^\/v\/[^/]+\/?$/i.test(
        location.pathname
      ) &&
      document.documentElement &&
      document.documentElement.dataset.hibV251Activated
    ) {
      outbound.length = 0;
    }
    outbound.sort(
      (a, b) =>
        b.score -
        a.score
    );

    const challenge =
      /__cf_chl_|\/cdn-cgi\/challenge-platform/i.test(
        location.href
      ) ||
      /just a moment|checking your browser|attention required|security verification|verify you are human/i.test(
        document.title || ""
      ) ||
      !!document.querySelector(
        'iframe[src*="challenges.cloudflare.com"],' +
        'input[name="cf-turnstile-response"],' +
        '#challenge-running,' +
        '#challenge-stage,' +
        '.cf-turnstile'
      );

    return {
      href:
        location.href,

      title:
        document.title || "",

      readyState:
        document.readyState,

      challenge,

      best:
        orderedMedia.length
          ? orderedMedia[0]
          : (
              orderedImages.length
                ? orderedImages[0]
                : null
            ),

      media:
        orderedMedia.slice(
          0,
          12
        ),

      images:
        orderedImages.slice(
          0,
          12
        ),

      outbound:
        outbound.slice(
          0,
          12
        )
    };
  };

  /*
   * HIB-V258-NHPLAYER-FRAME-MEDIA
   *
   * Inspect all frames only for NHPlayer.
   * Select the /player.php frame only when it exposes
   * a signed MP4. Other sites retain result[0].
   */
  const hibV258Tab = await browser.tabs.get(tabId);
  const hibV258IsNH = !!(
    hibV258Tab &&
    hibV250IsNH(hibV258Tab.url || "")
  );

  const result = await browser.tabs.executeScript(
    tabId,
    {
      runAt: "document_end",
      allFrames: hibV258IsNH,
      code: "(" + inspect.toString() + ")()"
    }
  );

  if (!result || !result.length) {
    return null;
  }

  /*
   * HIB-V259-NHPLAYER-FRAME-DIAGNOSTICS
   *
   * NHPlayer-only frame inventory and verified MP4 selection.
   * Retains generic top-level behavior for other hosts.
   * Never log the full signed media URL.
   */
  if (hibV258IsNH) {
    const hibV259Frames = [];

    let hibV259Selected = null;

    for (const entry of result) {
      if (!entry || typeof entry.href !== "string") {
        hibV259Frames.push({
          frame: "[invalid]",
          mediaCount: 0,
          hasVerify: false
        });
        continue;
      }

      let hibV259Path = "[invalid-url]";
      let hibV259PlayerFrame = false;

      try {
        const hibV259URL = new URL(entry.href);

        hibV259Path = hibV259URL.pathname;

        hibV259PlayerFrame = (
          hibV259URL.protocol === "https:" &&
          hibV259URL.hostname === "nhplayer.com" &&
          hibV259URL.pathname === "/player.php"
        );
      }
      catch (error) {
        // Ignore malformed document URLs.
      }

      const hibV259Media =
        Array.isArray(entry.media) ? entry.media : [];

      let hibV259Signed = null;

      if (hibV259PlayerFrame) {
        for (const candidate of hibV259Media) {
          if (!candidate || typeof candidate.url !== "string") {
            continue;
          }

          try {
            const hibV259MediaURL = new URL(candidate.url);

            if (
              hibV259MediaURL.protocol === "https:" &&
              /\.mp4$/i.test(hibV259MediaURL.pathname) &&
              hibV259MediaURL.searchParams.has("verify") &&
              hibV259MediaURL.searchParams.get("verify")
            ) {
              if (
                !hibV259Signed ||
                Number(candidate.score || 0) >
                  Number(hibV259Signed.score || 0)
              ) {
                hibV259Signed = candidate;
              }
            }
          }
          catch (error) {
            // Ignore malformed media candidates.
          }
        }
      }

      hibV259Frames.push({
        frame: hibV259Path,
        ready: entry.readyState || "unknown",
        mediaCount: hibV259Media.length,
        hasVerify: !!hibV259Signed
      });

      if (hibV259Signed && !hibV259Selected) {
        entry.best = hibV259Signed;
        hibV259Selected = entry;
      }
    }

    const hibV259Signature =
      JSON.stringify(hibV259Frames);

    if (
      typeof hibV213InspectGenericTab.hibV259LastSignature !==
        "string" ||
      hibV213InspectGenericTab.hibV259LastSignature !==
        hibV259Signature
    ) {
      hibV213InspectGenericTab.hibV259LastSignature =
        hibV259Signature;

      console.log(
        "[HIB v2.1.5 NHPlayer] FRAME STATE:",
        hibV259Signature
      );
    }

    if (hibV259Selected) {
      const hibV259URL = new URL(
        hibV259Selected.best.url
      );

      console.log(
        "[HIB v2.1.5 NHPlayer] VERIFIED FRAME MEDIA:",
        JSON.stringify({
          frame: "/player.php",
          host: hibV259URL.hostname,
          path: hibV259URL.pathname,
          verified: true,
          score: hibV259Selected.best.score,
          source: hibV259Selected.best.source
        })
      );

      /* HIB-V277-NHPLAYER-SELECTED-FRAME-SUBTITLE */
      hibV259Selected.subtitleURL = null;

      try {
        const playerPage = new URL(hibV259Selected.href);

        if (
          playerPage.protocol === "https:" &&
          playerPage.hostname === "nhplayer.com" &&
          playerPage.pathname === "/player.php"
        ) {
          const encoded = playerPage.searchParams.get("s");

          if (encoded) {
            const decoded = atob(encoded);
            const subtitle = new URL(decoded);

            if (
              subtitle.protocol === "https:" &&
              /\.(srt|vtt)$/i.test(subtitle.pathname) &&
              !subtitle.username &&
              !subtitle.password
            ) {
              hibV259Selected.subtitleURL = subtitle.href;
            }
          }
        }
      } catch (error) {
        // Subtitle failures must never block MP4 playback.
      }

      console.log(
        "[HIB v2.1.5 NHPlayer] SELECTED FRAME SUBTITLE:",
        JSON.stringify({
          found: !!hibV259Selected.subtitleURL,
          format: hibV259Selected.subtitleURL
            ? new URL(hibV259Selected.subtitleURL)
                .pathname.split(".").pop().toLowerCase()
            : null
        })
      );
      return hibV259Selected;
    }
  }

  /*
   * HIB-V260-NHPLAYER-DIRECT-MEDIA
   *
   * NHPlayer-only direct iframe fallback.
   * Preserve v2.1.3 generic result selection.
   * Never activate, focus, or play media.
   */
  if (hibV258IsNH) {
    try {
      const hibV260Probe = () => {
        let page;

        try {
          page = new URL(location.href);
        }
        catch (error) {
          return null;
        }

        if (
          page.protocol !== "https:" ||
          page.hostname !== "nhplayer.com" ||
          page.pathname !== "/player.php"
        ) {
          return null;
        }


        /*
         * HIB-V268-NHPLAYER-SILENT-PLAYBACK
         *
         * Muted playback initialization.
         * One attempt per video DOM element.
         */
        function hibV268TrySilentPlayback(video) {
          if (!video || video.nodeName !== "VIDEO") {
            return;
          }

          if (
            video.hasAttribute(
              "data-hib-v268-silent-attempt"
            )
          ) {
            return;
          }

          video.setAttribute(
            "data-hib-v268-silent-attempt",
            "started"
          );

          try {
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            video.autoplay = true;
            video.setAttribute("muted", "");
            video.setAttribute("autoplay", "");

            console.log(
              "[HIB v2.1.5 NHPlayer] SILENT PLAY REQUEST:",
              JSON.stringify({
                visibility: document.visibilityState,
                focused: document.hasFocus(),
                pausedBeforePlay: video.paused,
                muted: video.muted,
                readyState: video.readyState
              })
            );

            const result = video.play();

            if (
              result &&
              typeof result.then === "function"
            ) {
              result.then(
                () => {
                  video.setAttribute(
                    "data-hib-v268-silent-attempt",
                    "accepted"
                  );

                  console.log(
                    "[HIB v2.1.5 NHPlayer] SILENT PLAY ACCEPTED:",
                    JSON.stringify({
                      visibility: document.visibilityState,
                      focused: document.hasFocus(),
                      paused: video.paused,
                      muted: video.muted,
                      readyState: video.readyState,
                      hasCurrentSrc: !!video.currentSrc
                    })
                  );
                },
                error => {
                  video.setAttribute(
                    "data-hib-v268-silent-attempt",
                    "rejected"
                  );

                  console.warn(
                    "[HIB v2.1.5 NHPlayer] SILENT PLAY REJECTED:",
                    JSON.stringify({
                      name: error && error.name
                        ? error.name
                        : "UnknownError",
                      message: error && error.message
                        ? String(error.message).slice(0, 180)
                        : "",
                      visibility: document.visibilityState,
                      focused: document.hasFocus()
                    })
                  );
                }
              );
            }
          }
          catch (error) {
            video.setAttribute(
              "data-hib-v268-silent-attempt",
              "exception"
            );

            console.warn(
              "[HIB v2.1.5 NHPlayer] SILENT PLAY EXCEPTION:",
              String(error).slice(0, 180)
            );
          }
        }

        const candidateURLs = [];

        for (const video of document.querySelectorAll("video")) {
          hibV268TrySilentPlayback(video);
          candidateURLs.push(video.currentSrc);
          candidateURLs.push(video.src);
          candidateURLs.push(video.getAttribute("src"));

          for (const source of video.querySelectorAll("source")) {
            candidateURLs.push(source.src);
          }
        }

        for (const resource of performance.getEntriesByType("resource")) {
          candidateURLs.push(resource.name);
        }

        let selected = null;

        for (const value of candidateURLs) {
          if (typeof value !== "string" || !value) {
            continue;
          }

          try {
            const url = new URL(value, location.href);

            if (
              url.protocol === "https:" &&
              /\.mp4$/i.test(url.pathname) &&
              !!url.searchParams.get("verify")
            ) {
              selected = url.href;
              break;
            }
          }
          catch (error) {
            // Ignore non-URL media references.
          }
        }

        return {
          href: location.href,
          readyState: document.readyState,
          videoCount: document.querySelectorAll("video").length,
          /* HIB-V275-NHPLAYER-SUBTITLE-CAPTURE */
          subtitleReference: !!page.searchParams.get("s"),
          subtitleURL: (() => {
            const encoded = page.searchParams.get("s");
            if (!encoded) return null;

            try {
              const decoded = atob(encoded);
              const url = new URL(decoded);

              if (
                url.protocol !== "https:" ||
                !/\.(srt|vtt)$/i.test(url.pathname) ||
                url.username ||
                url.password
              ) {
                return null;
              }

              return url.href;
            } catch (error) {
              return null;
            }
          })(),
          mediaURL: selected
        };
      };

      const hibV260Results = await browser.tabs.executeScript(
        tabId,
        {
          allFrames: true,
          runAt: "document_idle",
          code: "(" + hibV260Probe.toString() + ")()"
        }
      );

      const hibV260Player = (
        Array.isArray(hibV260Results)
          ? hibV260Results
          : []
      ).find(entry =>
        entry &&
        typeof entry.href === "string" &&
        /^https:\/\/nhplayer\.com\/player\.php(?:\?|$)/i.test(
          entry.href
        )
      );

      const hibV260State = hibV260Player
        ? {
            playerFound: true,
            videoCount: hibV260Player.videoCount,
            subtitleReference:
              hibV260Player.subtitleReference,
            hasVerifiedMP4: !!hibV260Player.mediaURL
          }
        : {
            playerFound: false,
            videoCount: 0,
            subtitleReference: false,
            hasVerifiedMP4: false
          };

      const hibV260Signature = JSON.stringify(
        hibV260State
      );

      if (
        hibV213InspectGenericTab.hibV260LastSignature !==
        hibV260Signature
      ) {
        hibV213InspectGenericTab.hibV260LastSignature =
          hibV260Signature;

        console.log(
          "[HIB v2.1.5 NHPlayer] DIRECT PROBE:",
          hibV260Signature
        );
      }

      if (hibV260Player && hibV260Player.mediaURL) {
        const hibV260URL = new URL(
          hibV260Player.mediaURL
        );

        if (
          hibV260URL.protocol === "https:" &&
          /\.mp4$/i.test(hibV260URL.pathname) &&
          !!hibV260URL.searchParams.get("verify")
        ) {
          const hibV260Candidate = {
            url: hibV260URL.href,
            score: 70000,
            source: "nhplayer iframe video.currentSrc"
          };

          console.log(
            "[HIB v2.1.5 NHPlayer] DIRECT MEDIA FOUND:",
            JSON.stringify({
              host: hibV260URL.hostname,
              path: hibV260URL.pathname,
              verified: true,
              score: hibV260Candidate.score
            })
          );

          return {
            href: hibV260Player.href,
            title: "",
            readyState: hibV260Player.readyState,
            challenge: false,
            /* HIB-V276-NHPLAYER-SUBTITLE-PROPAGATION */
            subtitleURL: hibV260Player.subtitleURL || null,
            best: hibV260Candidate,
            media: [hibV260Candidate],
            images: [],
            outbound: []
          };
        }
      }
    }
    catch (error) {
      console.warn(
        "[HIB v2.1.5 NHPlayer] DIRECT PROBE ERROR:",
        String(error)
      );
    }
  }
  return result[0];
}

async function hibV213ResolveGeneric(
  pageUrl
) {
  const original =
    hibV213NormalizeUrl(
      pageUrl
    );

  if (!original) {
    throw new Error(
      "Invalid generic wrapper URL"
    );
  }

  if (
    hibV213DirectImage(
      original
    )
  ) {
    return {
      ok:
        true,

      originalUrl:
        original,

      fullUrl:
        original,

      source:
        "already-direct",

      chain:
        [
          original
        ]
    };
  }

  if (
    /* HIB-V271-NHPLAYER-FRESH-CACHE-READ */
    !hibV250IsNH(original) &&
    hibV213GenericCache.has(original)
  ) {
    return hibV213GenericCache.get(
      original
    );
  }

  /* site-down memory: do not open a helper tab for a host the probe has just found down */
  if (window.hibImgIsDown && window.hibImgIsDown(original)) {
    throw new Error("Image host is down (recent probe); no helper tab opened");
  }

  const tab =
    await hibV218CreateOwnedTab({
      url:
        original,

      active:
        false
    });

  if (
    !tab ||
    typeof tab.id !==
      "number"
  ) {
    throw new Error(
      "Generic resolver tab creation failed"
    );
  }

  const tabId =
    tab.id;

  const visited =
    new Set();

  const started =
    Date.now();

  let lastDocumentUrl =
    "";

  let lastCandidateUrl =
    "";

  let candidateStablePolls =
    0;

  let poll =
    0;

  let lastInfo =
    null;

  /*
   * HIB-V265-NHPLAYER-ADJUSTABLE-TIMEOUT
   * Read saved setting once per resolver attempt.
   */
  let hibV265NHTimeoutMs = 30000;

  /* HIB-V269-DIAGNOSTIC-STORAGE-FIX */
  /* HIB-V267-DIAGNOSTIC-MODE */
  let hibV267KeepDiagnosticTab = false;

  if (hibV250IsNH(original)) {
    try {
      const settings = await browser.storage.local.get([
        "hibV265NHPlayerTimeoutSeconds",
        "hibV267DiagnosticMode"
      ]);

      hibV267KeepDiagnosticTab =
        settings.hibV267DiagnosticMode === true;

      const seconds = Number(
        settings.hibV265NHPlayerTimeoutSeconds
      );

      if (
        Number.isInteger(seconds) &&
        seconds >= 10 &&
        seconds <= 90 &&
        seconds % 10 === 0
      ) {
        hibV265NHTimeoutMs = seconds * 1000;
      }
    }
    catch (error) {
      console.warn(
        "[HIB v2.1.5 NHPlayer] Settings unavailable; using 30s."
      );
    }

    console.log(
      "[HIB v2.1.5 NHPlayer] TIMEOUT CONFIG:",
      JSON.stringify({
        seconds: hibV265NHTimeoutMs / 1000,
        keepFailedTab: true
      })
    );
  }
  console.log(
    "[HIB v2.1.5 generic background] START:",
    original
  );

  try {
    while (
      /* HIB-V261-NHPLAYER-EXTENDED-READINESS */
      Date.now() - started <
      (hibV250IsNH(original) ? hibV265NHTimeoutMs : 30000)
    ) {
      poll +=
        1;

      /* site-down memory: a probe found this host down while the helper tab was loading: stop at once (the tab is closed by the cleanup below) */
      if (window.hibImgIsDown && window.hibImgIsDown(original)) {
        throw new Error("Image host is down (recent probe); resolver stopped");
      }

      let tabInfo =
        null;

      try {
        tabInfo =
          await browser.tabs.get(
            tabId
          );
      }
      catch (error) {
        throw new Error(
          "Generic resolver tab disappeared"
        );
      }

      const tabUrl =
        tabInfo &&
        tabInfo.url
          ? tabInfo.url
          : "";

      if (
        hibV213DirectImage(
          tabUrl
        )
      ) {
        const result = {
          ok:
            true,

          originalUrl:
            original,

          fullUrl:
            tabUrl,

          source:
            "direct tab URL",

          chain:
            Array.from(
              visited
            ),

          pollCount:
            poll
        };

        /* HIB-V271-NHPLAYER-FRESH-CACHE-WRITE */
        if (!hibV250IsNH(original)) {
          hibV213GenericCache.set(original, result);
        }

        return result;
      }

      let info =
        null;

      try {
        info =
          await hibV213InspectGenericTab(
            tabId
          );
      }
      catch (error) {
        /*
         * Normal while redirects replace the document.
         */
        hibV250Log(original, "INSPECTION ERROR", {
          poll: poll,
          tab: hibV250SafeURL(tabUrl),
          name: error && error.name ? error.name : "Error",
          message: error && error.message
            ? String(error.message).slice(0, 200)
            : "[no message]"
        });
      }


      /*
       * HIB-V266-NHPLAYER-NETWORK-FALLBACK
       */
      if (
        hibV250IsNH(original) &&
        (
          !info ||
          !info.best ||
          !info.best.url ||
          info.best.score < 12000
        )
      ) {
        const captured = hibV266NetworkMedia.get(tabId);

        if (captured) {
          try {
            const media = new URL(captured);

            if (
              media.protocol === "https:" &&
              (
                media.hostname === "1hanime.com" ||
                media.hostname.endsWith(".1hanime.com")
              ) &&
              /\.mp4$/i.test(media.pathname) &&
              media.searchParams.get("verify")
            ) {
              const candidate = {
                url: media.href,
                source: "nhplayer verified network request",
                score: 70000
              };

              info = {
                href: tabUrl,
                title: "",
                readyState: "network-captured",
                challenge: false,
                best: candidate,
                media: [candidate],
                images: [],
                outbound: []
              };

              console.log(
                "[HIB v2.1.5 NHPlayer] NETWORK FALLBACK READY:",
                JSON.stringify({
                  host: media.hostname,
                  path: media.pathname,
                  hasVerify: true,
                  poll: poll
                })
              );
            }
          }
          catch (error) {
            // Ignore invalid or incomplete captured URLs.
          }
        }
      }

      /* Shared picture finder: the generic scoring found nothing strong; read the common signals (JSON-LD ImageObject, og:image, twitter:image, image_src,
       * large img, image links). A verified result is given a strong score and then goes through the same "same candidate twice" check as any other. */
      if (
        !hibV250IsNH(original) &&
        (!info || !info.best || !info.best.url || info.best.score < 12000)
      ) {
        if (poll >= 3 && poll % 3 === 0 && !hibImgFinderSticky.get(tabId)) {
          const fb = await hibImgFindPicture(tabId);
          const best = fb && fb.best;
          if (best && /^https?:/i.test(best.url) && await hibImgVerifyPicture(best.url)) {
            if (hibImgFinderSticky.size > 40) hibImgFinderSticky.clear();
            hibImgFinderSticky.set(tabId, best);
            console.warn("[HIB LAYOUT CHANGED] generic wrapper: used the shared finder:", best.source, best.url);
          }
        }
        const kept = hibImgFinderSticky.get(tabId);
        if (kept) {
          info = Object.assign({}, info || { href: tabUrl, title: "", readyState: "", challenge: false, media: [], images: [], outbound: [] },
            { best: { url: kept.url, source: "layout-fallback: " + kept.source, score: 12000 + kept.score } });
        }
      }

      if (hibV250IsNH(original)) {
        hibV250Log(original, "INSPECT", {
          poll: poll,
          tab: hibV250SafeURL(tabUrl),
          document: hibV250SafeURL(info && info.href),
          ready: info ? info.readyState : "no result",
          mediaCount: info && Array.isArray(info.media)
            ? info.media.length : 0,
          bestScore: info && info.best
            ? info.best.score : null,
          bestSource: info && info.best
            ? info.best.source : null,
          bestURL: hibV250SafeURL(
            info && info.best ? info.best.url : ""
          ),
          hasVerify: !!(
            info &&
            info.best &&
            /[?&]verify=/i.test(info.best.url || "")
          )
        });
      }

      if (info) {
        lastInfo =
          info;

        const current =
          info.href ||
          tabUrl;

        if (
          current &&
          current !==
            lastDocumentUrl
        ) {
          lastDocumentUrl =
            current;

          if (
            !visited.has(
              current
            )
          ) {
            visited.add(
              current
            );

            console.log(
              "[HIB v2.1.5 generic background] HOP",
              visited.size,
              current
            );

            if (
              visited.size >
              4
            ) {
              throw new Error(
                "Generic maximum chain depth of 4 exceeded"
              );
            }
          }
        }

        if (
          info.best &&
          info.best.url &&
          info.best.score >=
            12000
        ) {
          if (
            info.best.url ===
            lastCandidateUrl
          ) {
            candidateStablePolls +=
              1;
          }
          else {
            lastCandidateUrl =
              info.best.url;

            candidateStablePolls =
              1;
          }

          console.log(
            "[HIB v2.1.5 generic background] candidate:",
            info.best.score,
            info.best.url,
            "stable=" +
              candidateStablePolls
          );

          /*
           * Require the same strong image candidate twice, 500ms apart.
           */
          if (
            candidateStablePolls >=
              2
          ) {
            const result = {
              ok:
                true,

              originalUrl:
                original,

              fullUrl:
                info.best.url,

              source:
                info.best.source,

              score:
                info.best.score,

              /* HIB-V276-NHPLAYER-FINAL-SUBTITLE */
              subtitleURL: hibV250IsNH(original) &&
                typeof info.subtitleURL === "string"
                  ? info.subtitleURL
                  : null,

              chain:
                Array.from(
                  visited
                ),

              pollCount:
                poll
            };

            /* HIB-V271-NHPLAYER-FRESH-CACHE-WRITE */
            if (!hibV250IsNH(original)) {
              hibV213GenericCache.set(original, result);
            }

            if (hibV250IsNH(original)) {
              hibV250Log(original, "SUCCESS", {
                poll: poll,
                media: hibV250SafeURL(result.fullUrl),
                hasVerify: /[?&]verify=/i.test(
                  result.fullUrl || ""
                ),
                source: result.source,
                score: result.score
              });
            }
            else {
              console.log(
                "[HIB v2.1.5 generic background] STRONG MEDIA READY:",
                result
              );
            }

            return result;
          }
        }
        else {
          lastCandidateUrl =
            "";

          candidateStablePolls =
            0;
        }
        /*
         * HIB-V224-SANKAKU-POST-HOLD
         *
         * Sankaku post pages are SPA/media pages. While the requested
         * post is still loading, generic outbound scoring sees the site
         * homepage and recommendation cards as plausible continuations.
         *
         * Never leave the requested /posts/<id> page merely because its
         * media has not appeared yet. Keep polling that exact document.
         *
         * Once video/image media becomes available, the normal strong
         * candidate path above returns it.
         */
        let hibV224HoldSankakuPost =
          false;

        try {
          const hibV224Url =
            new URL(
              info &&
              info.href
                ? info.href
                : current
            );

          hibV224HoldSankakuPost =
            /(^|\.)sankakucomplex\.com$/i.test(
              hibV224Url.hostname
            ) &&
            /^\/posts\/[^/]+\/?$/i.test(
              hibV224Url.pathname
            );
        }
        catch (error) {
          hibV224HoldSankakuPost =
            false;
        }

        if (
          hibV224HoldSankakuPost
        ) {
          if (
            poll === 1 ||
            poll % 5 === 0
          ) {
            console.log(
              "[HIB v2.1.5 generic background] SANKAKU POST HOLD - waiting for requested post media:",
              info &&
              info.href
                ? info.href
                : current
            );
          }

          await hibV213Sleep(
            500
          );

          continue;
        }

        /*
         * If no strong image has appeared after the page has had a moment,
         * follow only the highest-scoring image-like outbound link.
         */
        if (
          poll >= 3 &&
          Array.isArray(
            info.outbound
          ) &&
          info.outbound.length
        ) {
          const next =
            info.outbound.find(
              item =>
                item &&
                item.url &&
                !visited.has(
                  item.url
                )
            );

          if (
            next &&
            next.score >=
              2500
          ) {
            visited.add(
              next.url
            );

            if (
              visited.size >
              4
            ) {
              throw new Error(
                "Generic maximum chain depth of 4 exceeded"
              );
            }

            if (hibV250IsNH(original)) {
              hibV250Log(original, "NAVIGATE", {
                poll: poll,
                destination: hibV250SafeURL(next.url),
                score: next.score
              });
            }
            else {
              console.log(
                "[HIB v2.1.5 generic background] following wrapper outbound:",
                next.score,
                next.url
              );
            }

            await browser.tabs.update(
              tabId,
              {
                url:
                  next.url
              }
            );

            hibV250Log(original, "NAVIGATION ACCEPTED", {
              poll: poll,
              destination: hibV250SafeURL(next.url)
            });

            lastCandidateUrl =
              "";

            candidateStablePolls =
              0;

            await hibV213Sleep(
              500
            );

            continue;
          }
        }
      }

      await hibV213Sleep(
        500
      );
    }

    hibV250Log(original, "TIMEOUT", {
      poll: poll,
      lastDocument: hibV250SafeURL(lastDocumentUrl),
      lastReady: lastInfo ? lastInfo.readyState : "none",
      lastMediaCount:
        lastInfo && Array.isArray(lastInfo.media)
          ? lastInfo.media.length
          : 0
    });

    /*
     * HIB-V252-NHPLAYER-RETAIN-TIMEOUT
     * Diagnostic only: retain NHPlayer on timeout.
     */
    var hibV252RetainOnTimeout = hibV250IsNH(original);

    /*
     * HIB-V265-NHPLAYER-TIMEOUT-METRICS
     * Do not reference an unverified polling counter.
     */
    if (hibV250IsNH(original)) {
      console.warn(
        "[HIB v2.1.5 NHPlayer] TIMEOUT METRICS:",
        JSON.stringify({
          elapsedSeconds: +((Date.now() - started) / 1000).toFixed(2),
          configuredSeconds: hibV265NHTimeoutMs / 1000,
          diagnosticTabExpectedToRemain: true
        })
      );
    }
    throw new Error(
      "Generic resolver timed out after " + (hibV250IsNH(original) ? hibV265NHTimeoutMs / 1000 : 30) + " seconds. Last inspection: " +
      JSON.stringify(
        lastInfo
      )
    );
  }
  finally {
    /* HIB-V267-SUCCESS-RETENTION */
    if (
      hibV252RetainOnTimeout ||
      (hibV250IsNH(original) && hibV267KeepDiagnosticTab)
    ) {
      if (hibV250IsNH(original) && hibV267KeepDiagnosticTab) {
        hibV267LastDiagnosticTabId = tabId;

        console.log(
          "[HIB v2.1.5 NHPlayer] DIAGNOSTIC TAB RETAINED:",
          JSON.stringify({
            tabId: tabId,
            reason: hibV252RetainOnTimeout
              ? "timeout"
              : "resolution finished",
            ownerReleaseRequired: true
          })
        );
      }

      hibV266NetworkMedia.delete(tabId);
      /*
       * HIB-V252-NHPLAYER-RETAIN-TIMEOUT-CLEANUP
       * Outer owner queue releases normally.
       * Only the timed-out NHPlayer tab is preserved.
       */
      console.warn(
        "[HIB v2.1.5 NHPlayer] RETAINED TAB FOR INSPECTION:",
        tabId,
        "Wait for owner RELEASE before selecting"
      );
      /*
       * HIB-V253-NHPLAYER-DETACH-OWNER
       *
       * Preserve the NHPlayer diagnostic tab after timeout.
       * Complete the normal orphan sweep, then release ownership.
       * Release also cancels the 60-second watchdog.
       *
       * The retained tab is no longer subject to resolver
       * activation protection.
       */
      if (hibV218OwnedTabId === tabId) {
        await hibV221SweepNoOpenerOrphans();

        hibV218Release(
          "NHPlayer diagnostic tab detached"
        );

        console.warn(
          "[HIB v2.1.5 NHPlayer] DETACHED:",
          tabId,
          "Safe to inspect manually"
        );
      }
    }
    else {
      try {
        await browser.tabs.remove(tabId);
      }
      catch (error) {}
    }
  }
}

browser.runtime.onMessage.addListener(
  message => {
    if (
      !message ||
      message.type !==
        "hib-v2-resolve-generic"
    ) {
      return undefined;
    }

    const target =
      hibV213NormalizeUrl(
        message.pageUrl
      );

    if (!target) {
      return Promise.resolve({
        ok:
          false,

        error:
          "Invalid generic wrapper URL"
      });
    }

    if (
      hibV213GenericInflight.has(
        target
      )
    ) {
      return hibV213GenericInflight.get(
        target
      );
    }

    const job =
      hibV213ResolveGeneric(
        target
      )
        .catch(error => ({
          ok:
            false,

          error:
            String(error)
        }))
        .finally(() => {
          hibV213GenericInflight.delete(
            target
          );
        });

    hibV213GenericInflight.set(
      target,
      job
    );

    return job;
  }
);

console.log(
  "[HIB v2.1.5 generic background] fallback resolver loaded"
);

/* ===== IMAGE SECTION - STRAY-TAB SAFETY NET (new in rc386) =====
 * Wrapper sites sometimes leave a second tab of their own site behind (a redirect to the site's home page, a window.open that the opener checks cannot see).
 * Tabs born while a resolver owned the slot are remembered; 1.2 s after the LAST resolver is done, every remembered tab that is still open, is NOT the tab the
 * user is looking at, and belongs to the same site (base domain) as a resolver tab, is closed. Nothing is touched while another resolver is running. */
const hibImgBorn = new Set();
const hibImgSites = new Set();
const hibImgBase = host => String(host || "").split(".").slice(-2).join(".");
function hibImgNoteHost(host) { if (host && !/(^|\.)dlsite\.com$/.test(host)) hibImgSites.add(hibImgBase(host)); }   // DLsite is never swept: it stays exactly as in 2.1.5
browser.tabs.onCreated.addListener(tab => { if (hibV218Busy && typeof tab.id === "number") hibImgBorn.add(tab.id); });
let hibImgSweepTimer = null;
function hibImgScheduleSweep() {
  clearTimeout(hibImgSweepTimer);
  hibImgSweepTimer = setTimeout(async () => {
    if (hibV218Busy) return;                                                  // another resolver took the slot: its release sweeps later
    for (const id of Array.from(hibImgBorn)) {
      hibImgBorn.delete(id);
      try {
        const t = await browser.tabs.get(id);
        if (t.active) continue;
        let host = "";
        try { host = new URL(t.url || t.pendingUrl || "").hostname; } catch (e) {}
        if (host && !hibImgSites.has(hibImgBase(host))) continue;             // other sites (the user's own tabs) are left alone
        console.log("[HIB image] closing stray tab:", id, t.url);
        await browser.tabs.remove(id);
      } catch (e) {}
    }
  }, 1200);
}

/* ===== IMAGE SECTION - EXTRA-TAB SWEEP (new in rc386) =====
 * Some wrapper pages open a second tab (window.open / target=_blank, also with noopener, which the 2.1.5 opener check cannot see). While a resolver owns the slot,
 * every tab that the owned tab (or one of its children) opens is closed at once, so no stray tab is left behind when the resolver tab itself closes. */
browser.webNavigation.onCreatedNavigationTarget.addListener(d => {
  if (!hibV218Busy || typeof d.tabId !== "number") return;
  if (/(^|\.)dlsite\.com$/.test(hibV221OwnedHost)) return;                  // DLsite: replacement tabs are adopted, not closed (see the owner listener)
  if (d.sourceTabId === hibV218OwnedTabId || hibV218Children.has(d.sourceTabId)) {
    hibV218Children.add(d.tabId);
    console.log("[HIB image] closing extra tab opened by the resolver:", d.tabId, d.url);
    browser.tabs.remove(d.tabId).catch(() => {});
  }
});

/* ===== IMAGE SECTION - SOURCE-SITE REGISTRAR (new in rc386) =====
 * IMAGE sites have their OWN gate, separate from the video gate: the sites marked as image sites in HIB ("Add Image Site", storage 'hibImageSiteHosts',
 * { host: true }). The video list (enabledSites / siteMediaModes / scan hosts) is never read here. The image page script is registered for every image
 * site and follows the list live (add / remove a site and it appears / disappears at once). */
const hibImgRegs = new Map();
const hibImgNorm = x => String(x || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "").replace(/^www\./, "");
async function hibImgSync() {
  let s = {};
  try { s = await browser.storage.local.get("hibImageSiteHosts"); } catch (e) { return; }
  const wanted = new Set();
  for (const [k, v] of Object.entries(s.hibImageSiteHosts || {})) {
    const h = hibImgNorm(k);
    if (v !== true || !h || !/^[a-z0-9.-]+$/.test(h) || h.includes("..")) continue;
    wanted.add(h);
  }
  for (const [h, reg] of Array.from(hibImgRegs)) {
    if (!wanted.has(h)) { try { await reg.unregister(); } catch (e) {} hibImgRegs.delete(h); }
  }
  for (const h of wanted) {
    if (hibImgRegs.has(h)) continue;
    try {
      hibImgRegs.set(h, await browser.contentScripts.register({
        matches: ["https://" + h + "/*", "https://www." + h + "/*", "http://" + h + "/*", "http://www." + h + "/*"],
        js: [{ file: "hib_img_content.js" }],
        runAt: "document_idle"
      }));
    } catch (e) { console.warn("[HIB image] register failed", h, e); }
  }
  console.log("[HIB image] image sites:", Array.from(wanted));
}
let hibImgSyncTimer = null;
browser.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.hibImageSiteHosts) return;
  clearTimeout(hibImgSyncTimer);
  hibImgSyncTimer = setTimeout(hibImgSync, 300);
});
hibImgSync();
/* ===== IMAGE SECTION - SITE-DOWN PROBE (new in rc386) =====
 * hib-img-probe-site {url}: one plain request (8 s limit) to the wrapper address. down = no answer at all, or 502/503/504/520-530 (Cloudflare "origin down"). */
/* START SITE-DOWN MEMORY: a host the probe found down is remembered for 60 s. The generic resolver neither opens a helper tab for it nor keeps polling one it already
 * has open, so a dead image host cannot keep HIB "scanning" for the whole 30 s (and again on every hover). */
window.hibImgDownHosts = window.hibImgDownHosts || new Map();
window.hibImgMarkDown = url => {
  try {
    const host = new URL(String(url)).hostname;
    window.hibImgDownHosts.set(host, Date.now());
    /* If the resolver tab that holds the single resolver slot is for this very host, close it now: its page cannot answer, and the slot (and so every other
     * image on the page) would otherwise stay blocked until the 60 s watchdog. Closing the owned tab releases the slot through the normal path. */
    const owned = String(hibV221OwnedHost || "").toLowerCase(), h = host.toLowerCase();
    if (typeof hibV218OwnedTabId === "number" && owned && (owned === h || owned.endsWith("." + h) || h.endsWith("." + owned))) {
      const id = hibV218OwnedTabId;
      console.warn("[HIB site-down] closing the resolver tab of a host that does not answer:", host, id);
      hibV218NativeRemove(id).catch(() => {});
    }
  } catch (e) {}
};
window.hibImgIsDown = url => {
  try { const h = new URL(String(url)).hostname, t = window.hibImgDownHosts.get(h); if (t && Date.now() - t < 60000) return true; if (t) window.hibImgDownHosts.delete(h); } catch (e) {}
  return false;
};
/* END SITE-DOWN MEMORY */
browser.runtime.onMessage.addListener(message => {
  if (!message || message.type !== "hib-img-probe-site") return undefined;
  return (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(String(message.url), { cache: "no-store", signal: ctl.signal });
      const st = r.status;
      try { r.body && r.body.cancel(); } catch (e) {}                       // only the status line is needed
      const out = { down: st === 502 || st === 503 || st === 504 || (st >= 520 && st <= 530), status: st, dead: st === 404 || st === 410 };
      if (out.down) window.hibImgMarkDown(message.url);
      return out;
    }
    catch (e) { window.hibImgMarkDown(message.url); return { down: true, status: 0 }; }
    finally { clearTimeout(timer); }
  })();
});
})();
/* ===== END IMAGE SECTION - hib_img_background.js ===== */
