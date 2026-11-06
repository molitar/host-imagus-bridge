/* ===== START IMAGE SECTION - WRAPPED-IMAGE OPENING, PAGE SIDE (hib_img_content.js) =====
 * Brought in from Host_Imagus_Bridge_v2.1.5 (content.js) for IMAGE pages such as https://sukebei.nyaa.si/view/<id> whose thumbnails link to image-host
 * "wrapper" pages (imgpv, ouo.io chains, imagetwist, turboimg / imagehost, xxpics, DLsite galleries and generic wrapper pages).
 * It is injected ONLY into the image sites (hibImageSiteHosts) (registered by hib_img_background.js), top frame only, at document_idle.
 * What it does: on hover / right-click of a wrapped link it shows a small spinner, asks the background resolver (hib-v2-resolve-*) for the real picture
 * and then nudges the separate Imagus extension to show it. It never blocks normal clicks. Sukebei rule: wrapper discovery runs only on /view/<id> pages and
 * links to sukebei itself are navigation, never wrappers.
 * Left out on purpose (VIDEO, handled by the video section): the 2.1.5 AnimeID card adapter / subtitle bridge.
 * ===== (original 2.1.5 code follows; the matching END marker is at the end of this file) ===== */

/* ===== IMAGE SECTION - SITE-DOWN FLAG (new in rc386) =====
 * When a resolver (hib-v2-resolve-*) fails, the background is asked to probe the wrapper address. If the host answers with a server / Cloudflare error
 * (502-504, 520-530, e.g. imagetwist "522 connection timed out") or does not answer at all, the link gets a small red "site down" tag (tooltip: the status)
 * and data-hib-site-down="1", so a dead image host is not mistaken for a HIB failure. The wrapper below only observes the answer; it changes nothing else. */
(() => {
  const realSend = browser.runtime.sendMessage.bind(browser.runtime);
  function flagDown(url, status, gone, dead) {
    for (const a of document.querySelectorAll("a[href]")) {
      if (a.href !== url && a.dataset.tihOriginalHref !== url) continue;
      if (a.dataset.hibSiteDown === "1") continue;
      a.dataset.hibSiteDown = "1";
      if (a.nextElementSibling && a.nextElementSibling.dataset.hibSiteDownTag) continue;
      const tag = document.createElement("span");
      tag.dataset.hibSiteDownTag = "1";
      tag.textContent = dead ? "link dead (" + status + ")" : gone ? "not available" : "site down" + (status ? " (" + status + ")" : "");
      tag.title = dead ? "The host answers " + status + ": this picture was removed (broken / dead link)." : gone ? "The host redirects this item to its front page: it was removed or is not offered here." : "The image host did not answer (" + (status || "no response") + "). Try again later.";
      tag.style.cssText = "margin-left:4px;padding:0 5px;border-radius:3px;background:#b00020;color:#fff;font:600 11px sans-serif;vertical-align:middle";
      a.after(tag);
    }
  }
  // Links that already look like a plain picture are never sent to a resolver, so a dead host would stay silent. Hovering such an external link probes its host
  // once per minute (the probe reads only the status line) and flags every link of that host when it is down.
  const hostProbe = new Map();
  /* START SITE-DOWN STOP: once a host is flagged down, its resolves end at once (the callers' own failure paths then remove the spinner), new ones are refused for
   * 60 s without bothering the background, and spinners already shown next to that host's links are removed. */
  const downHosts = new Map(), downWaiters = new Map();
  const hostOf = u => { try { return new URL(u, location.href).hostname; } catch (e) { return ""; } };
  const isDown = h => { const t = downHosts.get(h); return !!t && Date.now() - t < 60000; };
  function hostDown(host) {
    downHosts.set(host, Date.now());
    for (const r of (downWaiters.get(host) || [])) r({ ok: false, error: "site down" });
    downWaiters.delete(host);
    for (const a of document.querySelectorAll("a[href]")) {
      if (a.hostname !== host) continue;
      for (let n = a.nextElementSibling, i = 0; n && i < 3; n = n.nextElementSibling, i++) if (n.classList && n.classList.contains("hib-v208-spinner")) n.remove();
    }
  }
  /* END SITE-DOWN STOP */
  document.addEventListener("mouseover", ev => {
    const a = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
    if (!a || !/^https?:$/.test(a.protocol) || a.hostname === location.hostname || a.dataset.hibSiteDown || /(^|\.)dlsite\.com$/.test(a.hostname)) return;   // DLsite links: no probe, untouched
    const last = hostProbe.get(a.hostname);
    if (last && Date.now() - last < 60000) return;
    hostProbe.set(a.hostname, Date.now());
    realSend({ type: "hib-img-probe-site", url: a.href }).then(p => {
      if (!p || !(p.down || p.dead)) return;
      if (p.dead && !p.down) { flagDown(a.href, p.status, false, true); return; }       // "link dead" belongs to this one item only
      for (const b of document.querySelectorAll("a[href]")) if (b.hostname === a.hostname) flagDown(b.href, p.status, false, false);
      hostDown(a.hostname);
    }).catch(() => {});
  }, true);
  browser.runtime.sendMessage = async function (msg) {
    /* One-card trace: every resolve request starts (or continues) the trace of the link being worked on. */
    try {
      if (msg && /^hib-v2-resolve-/.test(String(msg.type))) {
        realSend({ type: "hib-rc360-log", event: "RC386_IMG_TRIGGER", detail: { t: Math.round(performance.now()), key: String(msg.pageUrl || msg.url || msg.originalUrl || "").slice(0, 220), resolver: String(msg.type).replace("hib-v2-resolve-", ""), host: location.hostname } }).catch(() => {});
      }
    } catch (e) {}
    const resolveHost = (msg && /^hib-v2-resolve-/.test(String(msg.type)) && !/dlsite|xxpics/.test(String(msg.type))) ? hostOf(msg.pageUrl || msg.url || msg.originalUrl) : "";
    if (resolveHost && isDown(resolveHost)) return { ok: false, error: "site down (recent probe)" };
    let reply;
    if (resolveHost) {
      let wake;
      const early = new Promise(r => { wake = r; (downWaiters.get(resolveHost) || downWaiters.set(resolveHost, []).get(resolveHost)).push(r); });
      try { reply = await Promise.race([realSend(msg), early]); }
      finally { const list = downWaiters.get(resolveHost); if (list) { const i = list.indexOf(wake); if (i >= 0) list.splice(i, 1); } }
    } else reply = await realSend(msg);
    try {
      if (msg && /^hib-v2-resolve-/.test(String(msg.type)) && !/dlsite|xxpics/.test(String(msg.type)) && msg.pageUrl && reply && reply.ok === false && !/^site down/.test(String(reply.error || ""))) {
        const probe = await realSend({ type: "hib-img-probe-site", url: msg.pageUrl });
        if (probe && (probe.down || probe.dead)) flagDown(msg.pageUrl, probe.status, false, probe.dead);
        if (probe && probe.down && !probe.dead) hostDown(hostOf(msg.pageUrl));
      }
    } catch (e) {}
    return reply;
  };
})();

"use strict";

/*
 * Host Imagus Bridge v2.1.3
 *
 * Interaction model:
 *
 * 1. User interaction is NEVER blocked.
 * 2. Hover OR contextmenu can start resolution.
 * 3. A spinner appears immediately next to that exact target.
 * 4. Background resolver polls every 500 ms.
 * 5. When actual picture data is ready:
 *      - metadata is attached
 *      - spinner disappears
 *      - target anchor is refreshed
 *      - Imagus is nudged to inspect the fresh ready element
 * 6. Failures leave original navigation untouched.
 */

(() => {
  if (
    window.__hibV213Installed
  ) {
    return;
  }

  window.__hibV213Installed =
    true;

  const VERSION =
    "2.1.2";

  const states =
    new Map();

  const STYLE_ID =
    "hib-v208-style";

  function installStyle() {
    if (
      document.getElementById(
        STYLE_ID
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      STYLE_ID;

    style.textContent =
      `
      @keyframes hib-v208-spin {
        from {
          transform: rotate(0deg);
        }

        to {
          transform: rotate(360deg);
        }
      }

      .hib-v208-spinner {
        display: inline-block !important;
        width: 20px !important;
        height: 20px !important;
        margin-left: 8px !important;
        vertical-align: middle !important;
        border: 3px solid rgba(120,120,120,.35) !important;
        border-top-color: currentColor !important;
        border-radius: 50% !important;
        animation: hib-v208-spin .65s linear infinite !important;
        box-sizing: border-box !important;
        pointer-events: none !important;
      }
      `;

    (
      document.head ||
      document.documentElement
    ).appendChild(
      style
    );
  }

  installStyle();

  function normalizeDlsiteUrl(value) {
    let url;

    try {
      url =
        new URL(
          value,
          location.href
        );
    }
    catch (error) {
      return null;
    }

    const host =
      url.hostname
        .toLowerCase()
        .replace(/^www\./, "");

    if (
      host !==
      "dlsite.com"
    ) {
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
      kind:
        "dlsite",

      productId,

      key:
        "dlsite:" +
        productId,

      url:
        "https://www.dlsite.com/maniax/work/=/product_id/" +
        productId +
        ".html"
    };
  }

  function normalizeXxPicsUrl(value) {
    let url;

    try {
      url =
        new URL(
          value,
          location.href
        );
    }
    catch (error) {
      return null;
    }

    const host =
      url.hostname
        .toLowerCase()
        .replace(/^www\./, "");

    if (
      host !==
      "xxpics.org"
    ) {
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
      kind:
        "xxpics",

      productId,

      key:
        "xxpics:" +
        productId,

      url:
        "https://xxpics.org/cover-" +
        productId.toLowerCase() +
        "/"
    };
  }

  function normalizeTarget(value) {
    return (
      normalizeDlsiteUrl(
        value
      ) ||
      normalizeXxPicsUrl(
        value
      )
    );
  }

  function findTarget(node) {
    if (
      !(node instanceof Element)
    ) {
      return null;
    }

    const anchor =
      node.closest(
        "a[href]"
      );

    if (!anchor) {
      return null;
    }

    const target =
      normalizeTarget(
        anchor.href
      );

    if (!target) {
      return null;
    }

    return {
      anchor,
      target
    };
  }

  function matchingAnchors(target) {
    const matches =
      [];

    for (
      const anchor of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      const candidate =
        normalizeTarget(
          anchor.href
        );

      if (
        candidate &&
        candidate.key ===
          target.key
      ) {
        matches.push(
          anchor
        );
      }
    }

    return matches;
  }

  function spinnerSelector(key) {
    return (
      '.hib-v208-spinner[data-hib-key="' +
      CSS.escape(key) +
      '"]'
    );
  }

  function showSpinner(
    anchor,
    target
  ) {
    if (
      !anchor ||
      !anchor.isConnected
    ) {
      return;
    }

    if (
      anchor.nextElementSibling &&
      anchor.nextElementSibling.classList &&
      anchor.nextElementSibling.classList.contains(
        "hib-v208-spinner"
      ) &&
      anchor.nextElementSibling.dataset.hibKey ===
        target.key
    ) {
      return;
    }

    const spinner =
      document.createElement(
        "span"
      );

    spinner.className =
      "hib-v208-spinner";

    spinner.dataset.hibKey =
      target.key;

    spinner.title =
      "Host Imagus Bridge is loading preview images";

    anchor.insertAdjacentElement(
      "afterend",
      spinner
    );
  }

  function removeSpinners(
    target
  ) {
    const nodes =
      document.querySelectorAll(
        spinnerSelector(
          target.key
        )
      );

    for (
      const node of
      nodes
    ) {
      node.remove();
    }
  }

  /* HIB-V210-SIZED-NATIVE-GALLERY */
  let hibV210GallerySize = {preset:"auto",width:960,height:540};
  const hibV210Presets = new Set(["auto","960x540","1280x720","1920x1080","2560x1440","3840x2160","custom"]);
  const hibV210LoadSize = async () => {
    try {
      const stored = (await browser.storage.local.get("hibV210GalleryDisplaySize")).hibV210GalleryDisplaySize;
      if (!stored || !hibV210Presets.has(stored.preset)) return;
      hibV210GallerySize = stored;
    } catch (error) { /* Storage unavailable: use automatic fit. */ }
  };
  hibV210LoadSize();
  browser.storage.onChanged.addListener((changes,area) => {
    if (area === "local" && changes.hibV210GalleryDisplaySize) hibV210LoadSize();
  });
  function hibV210ImageLimits() {
    const option = hibV210GallerySize || {};
    if (option.preset === "auto") return [1100, 99999];
    let pair = option.preset === "custom"
      ? [Number(option.width),Number(option.height)]
      : String(option.preset).split("x").map(Number);
    if (!pair.every(Number.isFinite) || pair[0] < 160 || pair[1] < 90) pair = [1100,99999];
    return pair;
  }

  /*
   * HIB-V285-NATIVE-DLSITE-GALLERY
   * Isolated native viewer. Does not modify Imagus preferences.
   */
  /* One-card trace producer (store: hib_rc360_diag_bg.js). Sent to the background, which keeps only the current card's events in memory. */
  function hibImgTrace(ev, detail) {
    try { browser.runtime.sendMessage({ type: "hib-rc360-log", event: "RC386_IMG_" + ev, detail: Object.assign({ t: Math.round(performance.now()) }, detail || {}) }).catch(() => {}); } catch (e) {}
  }
  function hibV285OpenGallery(anchor) {
    hibImgTrace("GALLERY_OPEN", { key: String(anchor && (anchor.dataset.hibOriginalHref || anchor.dataset.tihOriginalHref || anchor.href) || ""), images: (() => { try { return JSON.parse(anchor.dataset.hibGallery || "[]").length; } catch (e) { return 0; } })() });
    let urls;

    try {
      urls = JSON.parse(anchor.dataset.hibGallery || "[]");
    } catch (error) {
      console.warn("[HIB v2.1.5] Invalid DLsite gallery", error);
      return;
    }

    if (!Array.isArray(urls)) return;

    urls = Array.from(new Set(urls.filter(url =>
      typeof url === "string" &&
      /^https:\/\/img\.dlsite\.jp\//i.test(url)
    ))).slice(0, 100);

    if (!urls.length) return;

    const old = document.getElementById("hib-v285-native-gallery");
    if (old && old.hibAnchor === anchor) return;          /* IMAGE SECTION: already open for this very link (hover / click / Imagus-failure gate all ask) - keep it as it is */

    if (old && typeof old.hibCloseGallery === "function") {
      old.hibCloseGallery();
    } else if (old) {
      old.remove();
    }

    const overlay = document.createElement("div");
    overlay.id = "hib-v285-native-gallery";
    overlay.hibAnchor = anchor;

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none",
      background: "transparent"
    });

    const frame = document.createElement("div");

    Object.assign(frame.style, {
      position: "relative",
      width: "max-content",
      maxWidth: "calc(100vw - 132px)",
      maxHeight: "calc(100vh - 130px)",
      pointerEvents: "auto"
    });

    const image = document.createElement("img");
    const [hibV210Width,hibV210Height] = hibV210ImageLimits();

    // Explicit presets set the viewer dimensions. Automatic fills the
    // available viewport while object-fit keeps the actual image undistorted.
    const hibGalleryAuto = (hibV210GallerySize?.preset || "auto") === "auto";
    // Navigation controls now overlay the image, so Automatic only needs
    // a narrow viewport margin rather than reserving 57px on each side.
    if (hibGalleryAuto) frame.style.maxWidth = "calc(100vw - 24px)";
    Object.assign(image.style, {
      display: "block",
      width: hibGalleryAuto ? "calc(100vw - 24px)" : `min(${hibV210Width}px, calc(100vw - 132px))`,
      height: hibGalleryAuto ? "calc(100vh - 130px)" : `min(${hibV210Height}px, calc(100vh - 130px))`,
      maxWidth: hibGalleryAuto ? "calc(100vw - 24px)" : `min(${hibV210Width}px, calc(100vw - 132px))`,
      maxHeight: hibGalleryAuto ? "calc(100vh - 130px)" : `min(${hibV210Height}px, calc(100vh - 130px))`,
      objectFit: "contain",
      border: "3px solid #333",
      borderRadius: "6px",
      background: "#171717",
      boxShadow: "0 8px 35px rgba(0,0,0,.8)"
    });

    image.alt = "DLsite gallery image";

    const counter = document.createElement("div");

    Object.assign(counter.style, {
      position: "absolute",
      top: "-43px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "6px 12px",
      borderRadius: "7px",
      background: "#252525",
      color: "#fff",
      font: "15px Arial, sans-serif",
      whiteSpace: "nowrap"
    });

    const makeButton = (label, styles, callback) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;

      Object.assign(button.style, {
        position: "absolute",
        padding: "8px 12px",
        border: "1px solid #555",
        borderRadius: "7px",
        background: "#303030",
        color: "#fff",
        font: "22px Arial, sans-serif",
        cursor: "pointer",
        pointerEvents: "auto",
        zIndex: "3",
        ...styles
      });

      if (label === "❮" || label === "❯") {
        button.style.background = "rgba(20, 20, 20, 0.42)";
        button.style.borderColor = "rgba(255,255,255,0.25)";
        button.style.transition = "background 140ms ease";
        button.setAttribute("aria-label", label === "❮" ? "Previous image" : "Next image");
        button.addEventListener("mouseenter", () => {
          button.style.background = "rgba(20, 20, 20, 0.78)";
        });
        button.addEventListener("mouseleave", () => {
          button.style.background = "rgba(20, 20, 20, 0.42)";
        });
      }

      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        callback();
      });

      frame.appendChild(button);
      return button;
    };

    let index = 0;
    let closed = false;

    const render = () => {
      counter.textContent = `${index + 1} / ${urls.length}`;
      image.src = urls[index];
    };

    const move = delta => {
      if (closed) return;
      index = (index + delta + urls.length) % urls.length;
      render();
    };

    const onKey = event => {
      if (closed) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(1);
      }
    };

    const close = () => {
      if (closed) return;

      closed = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      hibV288RestoreImagusLoader();
    };

    overlay.hibCloseGallery = close;

    makeButton("❮", {
      left: "12px",
      top: "50%",
      transform: "translateY(-50%)"
    }, () => move(-1));

    makeButton("❯", {
      right: "12px",
      top: "50%",
      transform: "translateY(-50%)"
    }, () => move(1));

    makeButton("×", {
      right: "-8px",
      top: "-45px"
    }, close);

    frame.appendChild(image);
    frame.appendChild(counter);
    overlay.appendChild(frame);
    document.body.appendChild(overlay);

    document.addEventListener("keydown", onKey, true);

    image.addEventListener("error", () => {
      console.warn(
        "[HIB v2.1.5] Image load failed:",
        urls[index]
      );
    });

    render();

    console.log("[HIB v2.1.5] Native gallery opened", {
      images: urls.length,
      productId: anchor.dataset.hibV2ProductId
    });
  }

  /*
   * HIB-V287-DLSITE-IMAGUS-FAILURE-GATE
   * Prepare gallery data independently. Open only after a fresh,
   * visible Imagus gray R_js failure associated with the current link.
   * Never open on hover alone, a missing loader, or a stale gray loader.
   */
  const hibV287Attempts = new Map();
  let hibV287ActiveAttempt = null;
  let hibV287Sequence = 0;

  function hibV287FindLoader(root, visited = new Set()) {
    if (!root || visited.has(root)) return null;
    visited.add(root);
    try {
      if (typeof root.querySelector === "function") {
        const direct = root.querySelector("#imagus-loader");
        if (direct) return direct;
        for (const node of root.querySelectorAll("*")) {
          if (!node.shadowRoot) continue;
          const nested = hibV287FindLoader(node.shadowRoot, visited);
          if (nested) return nested;
        }
      }
    } catch (error) {}
    return null;
  }

  function hibV287LoaderState() {
    const loader = hibV287FindLoader(document);
    if (!loader) return { reset: true, state: "missing", active: false };
    let style;
    try { style = getComputedStyle(loader); } catch (error) {}
    const display = String((style && style.display) || loader.style.display || "");
    const visibility = String((style && style.visibility) || "");
    const rawOpacity = parseFloat((style && style.opacity) || loader.style.opacity);
    const opacity = Number.isFinite(rawOpacity) ? rawOpacity : 1;
    const color = String((style && style.backgroundColor) ||
      loader.style.backgroundColor || "").replace(/\s+/g, " ").trim();
    const reset = display === "none" || visibility === "hidden" || opacity <= 0.05;
    const states = {
      "rgb(255, 255, 255)": "load",
      "rgb(255, 204, 204)": "R_load",
      "rgb(222, 255, 205)": "res",
      "rgb(255, 234, 128)": "R_res",
      "rgb(200, 200, 200)": "R_js"
    };
    return { reset, state: states[color] || "other", active: !reset };
  }

  function hibV287ReadyAnchor(key) {
    const attempt = hibV287Attempts.get(key);
    if (!attempt) return null;
    for (const anchor of document.querySelectorAll('a[data-hib-v2-ready="1"]')) {
      if (anchor.dataset.hibV2ProductId === attempt.productId &&
          anchor.dataset.hibGallery) return anchor;
    }
    return null;
  }

  /* HIB-V288-DLSITE-GRAY-LOADER-DISMISS
   * A verified DLsite fallback owns the preview after R_js. Hide only
   * that visible failure loader, never an active/new Imagus preview.
   * Preserve inline display and its priority, restoring on gallery
   * dismissal or when the user starts another DLsite interaction.
   */
  let hibV288SuppressedLoader = null;

  function hibV288RestoreImagusLoader() {
    const saved = hibV288SuppressedLoader;
    if (!saved) return;
    hibV288SuppressedLoader = null;
    try {
      if (saved.value) {
        saved.element.style.setProperty("display", saved.value, saved.priority);
      } else {
        saved.element.style.removeProperty("display");
      }
    } catch (error) {
      console.warn("[HIB v2.1.5 DLsite] Loader restoration failed:", error);
    }
  }

  function hibV288DismissGrayLoader() {
    const loader = hibV287FindLoader(document);
    if (!loader) return false;
    let style;
    try { style = getComputedStyle(loader); } catch (error) { return false; }
    if (style.display === "none" || style.visibility === "hidden" ||
        Number(style.opacity) <= 0.05 ||
        style.backgroundColor.replace(/\s+/g, " ").trim() !== "rgb(200, 200, 200)") {
      return false;
    }
    hibV288RestoreImagusLoader();
    hibV288SuppressedLoader = {
      element: loader,
      value: loader.style.getPropertyValue("display"),
      priority: loader.style.getPropertyPriority("display")
    };
    loader.style.setProperty("display", "none", "important");
    console.log("[HIB v2.1.5 DLsite] Dismissed current gray Imagus loader");
    return true;
  }

  function hibV287TryOpen(attempt) {
    if (!attempt || !attempt.failed || attempt.opened ||
        hibV287ActiveAttempt !== attempt) return;
    const anchor = hibV287ReadyAnchor(attempt.key);
    if (!anchor) return;
    attempt.opened = true;
    hibV285OpenGallery(anchor);
    if (document.getElementById("hib-v285-native-gallery")) {
      hibV288DismissGrayLoader();
    }
    console.log("[HIB v2.1.5 DLsite] Imagus R_js fallback gallery:", {
      productId: attempt.productId, trigger: attempt.trigger
    });
  }

  function hibV287ObserveAttempt(anchor, target, trigger) {
    if (target.kind !== "dlsite") return;
    hibV288RestoreImagusLoader();
    if (hibV287ActiveAttempt && hibV287ActiveAttempt.timer) {
      clearInterval(hibV287ActiveAttempt.timer);
      hibV287ActiveAttempt.timer = null;
    }
    const initial = hibV287LoaderState();
    const attempt = {
      key: target.key, productId: target.productId, trigger,
      sequence: ++hibV287Sequence, opened: false, failed: false,
      resetSeen: initial.reset, activitySeen: false,
      started: Date.now(), timer: null
    };
    hibV287Attempts.set(target.key, attempt);
    hibV287ActiveAttempt = attempt;

    const poll = () => {
      if (hibV287ActiveAttempt !== attempt) {
        clearInterval(attempt.timer);
        attempt.timer = null;
        return;
      }
      const loader = hibV287LoaderState();
      if (loader.reset) attempt.resetSeen = true;
      if (loader.active && loader.state !== "R_js") {
        attempt.activitySeen = true;
      }
      // The reset or fresh non-gray activity distinguishes this
      // attempt from a gray spinner left over from the previous link.
      if (loader.active && loader.state === "R_js" &&
          (attempt.resetSeen || attempt.activitySeen)) {
        attempt.failed = true;
        clearInterval(attempt.timer);
        attempt.timer = null;
        hibV287TryOpen(attempt);
        console.log("[HIB v2.1.5 DLsite] Fresh Imagus gray failure:",
          target.productId);
        return;
      }
      if (Date.now() - attempt.started >= 18000) {
        clearInterval(attempt.timer);
        attempt.timer = null;
      }
    };
    attempt.timer = setInterval(poll, 100);
    poll();
  }

  function hibV287AttachGallery(anchor) {
    // Viewer activation is controlled by the Imagus failure observer.
    // No mouseenter, mouseleave, or timeout closes an opened gallery.
    if (!anchor || anchor.dataset.hibV2Ready !== "1") return;
    const key = "dlsite:" + anchor.dataset.hibV2ProductId;
    hibV287TryOpen(hibV287Attempts.get(key));
  }
  function attachDlsite(
    target,
    result
  ) {
    const gallery =
      Array.isArray(
        result.galleryUrls
      )
        ? Array.from(
            new Set(
              result.galleryUrls
            )
          )
        : [];

    const anchors =
      matchingAnchors(
        target
      );

    const freshAnchors =
      [];

    for (
      const anchor of
      anchors
    ) {
      anchor.dataset.hibV2State =
        "resolved";

      anchor.dataset.hibV2Ready =
        "1";

      anchor.dataset.hibV2ProductId =
        target.productId;

      anchor.dataset.hibOriginalHref =
        target.url;

      anchor.dataset.hibFullImage =
        result.mainUrl || "";

      anchor.dataset.hibGallery =
        JSON.stringify(
          gallery
        );

      anchor.dataset.hibGalleryCount =
        String(
          gallery.length
        );

      /*
       * HIB-V284-DLSITE-GALLERY-URL-TRANSITION
       *
       * Reproduce the confirmed working Console operation
       * after HIB has populated the full gallery metadata.
       *
       * The final href remains the original DLsite URL,
       * allowing the gallery Sieve to match normally.
       */
      const hibV284OriginalHref =
        anchor.dataset.hibOriginalHref || anchor.href;

      const hibV284DirectImage =
        result.mainUrl || "";

      if (
        gallery.length > 0 &&
        /^https:\/\/img\.dlsite\.jp\//i.test(hibV284DirectImage) &&
        /^https:\/\/www\.dlsite\.com\//i.test(hibV284OriginalHref)
      ) {
        anchor.href =
          hibV284DirectImage;

        anchor.href =
          hibV284OriginalHref;

        console.log(
          '[HIB v2.1.5 DLsite] GALLERY URL TRANSITION:',
          JSON.stringify({
            productId: target.productId,
            galleryCount: gallery.length,
            restoredOriginalHref: anchor.href === hibV284OriginalHref
          })
        );
      }

      const fresh =
        anchor.cloneNode(
          true
        );

      anchor.replaceWith(
        fresh
      );

      freshAnchors.push(
        fresh
      );
      hibV287AttachGallery(fresh);
    }

    removeSpinners(
      target
    );

    console.log(
      "[HIB v2.1.5] DLsite ACTUAL PICTURES READY:",
      {
        productId:
          target.productId,

        galleryCount:
          gallery.length,

        mainUrl:
          result.mainUrl,

        pollCount:
          result.pollCount,

        anchorCount:
          freshAnchors.length
      }
    );

    /* IMAGE SECTION: no Imagus nudge for DLsite - HIB's own gallery is the only viewer and it opens on right-click only (see below). */
  }

  function attachXxPics(
    target,
    result
  ) {
    const anchors =
      matchingAnchors(
        target
      );

    const freshAnchors =
      [];

    for (
      const anchor of
      anchors
    ) {
      anchor.dataset.hibV2XxPicsState =
        "resolved";

      anchor.dataset.hibV2XxPicsReady =
        "1";

      anchor.dataset.hibV2ProductId =
        target.productId;

      /*
       * HIB-V209-XXPICS-DIRECT-HANDOFF
       *
       * Preserve the original XXPICS wrapper for diagnostics/navigation
       * history, but expose the successfully verified cover image as the
       * live anchor href so Imagus sees a normal direct-image target.
       *
       * This behavior is XXPICS-only. DLsite product hrefs remain intact.
       */

      anchor.dataset.tihOriginalHref =
        target.url;

      anchor.dataset.tihFullImage =
        result.fullUrl || "";

      anchor.href =
        result.fullUrl;

      const fresh =
        anchor.cloneNode(
          true
        );

      /*
       * Explicitly preserve both URLs on the fresh node.
       */
      fresh.dataset.tihOriginalHref =
        target.url;

      fresh.dataset.tihFullImage =
        result.fullUrl;

      anchor.replaceWith(
        fresh
      );

      freshAnchors.push(
        fresh
      );
    }

    removeSpinners(
      target
    );

    console.log(
      "[HIB v2.1.5] XXPICS ACTUAL PICTURE READY:",
      {
        productId:
          target.productId,

        fullUrl:
          result.fullUrl,

        source:
          result.source,

        anchorCount:
          freshAnchors.length
      }
    );

    rearmImagus(
      freshAnchors,
      target
    );
  }

  function rearmImagus(
    anchors,
    target
  ) {
    /*
     * Imagus may have rejected the old DOM node while the resolver
     * was still working. The anchor clone gives it a fresh node.
     *
     * If the pointer is still physically over the fresh anchor,
     * send a normal mouseover notification so Imagus gets another
     * opportunity automatically. No click or contextmenu is faked.
     */

    setTimeout(
      () => {
        for (
          const anchor of
          anchors
        ) {
          if (
            !anchor.isConnected
          ) {
            continue;
          }

          let hovered =
            false;

          try {
            hovered =
              anchor.matches(
                ":hover"
              );
          }
          catch (error) {}

          if (!hovered) {
            continue;
          }

          try {
            anchor.dispatchEvent(
              new MouseEvent(
                "mouseover",
                {
                  bubbles:
                    true,

                  cancelable:
                    false,

                  view:
                    window
                }
              )
            );

            console.log(
              "[HIB v2.1.5] Imagus re-check requested:",
              target.url
            );
          }
          catch (error) {}
        }
      },
      50
    );
  }

  function startWaitTicker(
    state
  ) {
    if (
      state.waitTimer
    ) {
      return;
    }

    state.waitPoll =
      0;

    state.waitTimer =
      setInterval(
        () => {
          if (
            state.status !==
            "resolving"
          ) {
            clearInterval(
              state.waitTimer
            );

            state.waitTimer =
              null;

            return;
          }

          state.waitPoll +=
            1;

          console.log(
            "[HIB v2.1.5] waiting for actual pictures:",
            state.target.key,
            "poll=" +
              state.waitPoll,
            "500ms"
          );
        },
        500
      );
  }

  async function resolveTarget(
    anchor,
    target,
    trigger
  ) {
    hibImgTrace("TRIGGER", { key: String((target && target.key) || anchor.href || "").slice(0, 200), trigger: String(trigger || ""), host: (() => { try { return new URL(anchor.href).hostname; } catch (e) { return ""; } })() });
    let state =
      states.get(
        target.key
      );

    if (
      state &&
      state.status ===
        "resolved"
    ) {
      return;
    }

    if (
      state &&
      state.status ===
        "resolving"
    ) {
      showSpinner(
        anchor,
        target
      );

      return;
    }

    state = {
      target,
      status:
        "resolving",
      waitTimer:
        null,
      waitPoll:
        0
    };

    states.set(
      target.key,
      state
    );

    showSpinner(
      anchor,
      target
    );

    startWaitTicker(
      state
    );

    console.log(
      "[HIB v2.1.5] IMMEDIATE INTERACTION -> resolver:",
      trigger,
      target.url
    );

    let result;

    try {
      result =
        await browser.runtime.sendMessage({
          type:
            target.kind ===
              "dlsite"
              ? "hib-v2-resolve-dlsite"
              : "hib-v2-resolve-xxpics",

          pageUrl:
            target.url,

          productId:
            target.productId
        });
    }
    catch (error) {
      state.status =
        "failed";

      if (
        state.waitTimer
      ) {
        clearInterval(
          state.waitTimer
        );
      }

      removeSpinners(
        target
      );

      states.delete(
        target.key
      );

      console.warn(
        "[HIB v2.1.5] resolver message failed; original link untouched:",
        target.url,
        String(error)
      );

      return;
    }

    if (
      !result ||
      !result.ok
    ) {
      state.status =
        "failed";

      if (
        state.waitTimer
      ) {
        clearInterval(
          state.waitTimer
        );
      }

      removeSpinners(
        target
      );

      states.delete(
        target.key
      );

      console.warn(
        "[HIB v2.1.5] resolver failed; original link untouched:",
        target.url,
        result && result.error
          ? result.error
          : "unknown error"
      );

      return;
    }

    state.status =
      "resolved";

    if (
      state.waitTimer
    ) {
      clearInterval(
        state.waitTimer
      );

      state.waitTimer =
        null;
    }

    if (
      target.kind ===
      "dlsite"
    ) {
      if (
        !result.mainUrl ||
        !Array.isArray(
          result.galleryUrls
        ) ||
        !result.galleryUrls.length
      ) {
        removeSpinners(
          target
        );

        states.delete(
          target.key
        );

        console.warn(
          "[HIB v2.1.5] DLsite returned without actual pictures:",
          target.url
        );

        return;
      }

      attachDlsite(
        target,
        result
      );
    }
    else {
      if (
        !result.fullUrl
      ) {
        removeSpinners(
          target
        );

        states.delete(
          target.key
        );

        console.warn(
          "[HIB v2.1.5] XXPICS returned without an actual picture:",
          target.url
        );

        return;
      }

      attachXxPics(
        target,
        result
      );
    }
  }

  function handleInteraction(
    event,
    trigger
  ) {
    const found =
      findTarget(
        event.target
      );

    if (!found) {
      return;
    }

    /*
     * Intentionally no preventDefault().
     * Intentionally no stopPropagation().
     *
     * Right-click and normal link behavior remain native.
     */

    hibV287ObserveAttempt(found.anchor, found.target, trigger);

    resolveTarget(
      found.anchor,
      found.target,
      trigger
    );
  }

  document.addEventListener(
    "pointerover",
    event => {
      const found =
        findTarget(
          event.target
        );

      if (!found) {
        return;
      }

      const from =
        event.relatedTarget;

      if (
        from instanceof Node &&
        found.anchor.contains(
          from
        )
      ) {
        return;
      }

      handleInteraction(
        event,
        "hover"
      );
    },
    true
  );

  document.addEventListener(
    "contextmenu",
    event => {
      handleInteraction(
        event,
        "right-click"
      );
    },
    true
  );

  /* ===== IMAGE SECTION - ONE GALLERY FOR DLSITE LINKS (new in rc386) =====
   * HIB's gallery is the ONLY viewer for DLsite (RJ) links and it opens ONLY on a RIGHT-CLICK on the link (the user's Imagus Reborn setting is "right click, not
   * hover"). Never on hover, never on a plain click. The picture data is stored under HIB's own attribute names (data-hib-gallery ...) so Imagus's gallery rule has
   * nothing to show, and three more guards make sure Imagus's own popup cannot win:
   *   1. the right-click (mousedown / mouseup / contextmenu, button 2) on a DLsite link is stopped at the window, before Imagus's handlers further down;
   *   2. for 6 s after the right-click (and while HIB's gallery is open) any Imagus popup / loader that still appears is hidden at once;
   *   3. the browser's own context menu is suppressed for that click only.
   * Right-click on a link that is not ready yet: the resolver is already running (started by the hover / right-click handler above); the gallery opens the
   * moment it is ready (25 s at most). */
  function hibImgFindById(root, id, seen = new Set()) {
    if (!root || seen.has(root)) return null;
    seen.add(root);
    try {
      const direct = root.querySelector("#" + id);
      if (direct) return direct;
      for (const node of root.querySelectorAll("*")) {
        if (!node.shadowRoot) continue;
        const nested = hibImgFindById(node.shadowRoot, id, seen);
        if (nested) return nested;
      }
    } catch (error) {}
    return null;
  }
  let hibImgSuppressUntil = 0;
  let hibImgSuppressTimer = null;
  function hibImgSuppressImagus(ms) {
    hibImgSuppressUntil = Math.max(hibImgSuppressUntil, Date.now() + ms);
    if (hibImgSuppressTimer) return;
    hibImgSuppressTimer = setInterval(() => {
      if (document.getElementById("hib-v285-native-gallery")) hibImgSuppressUntil = Math.max(hibImgSuppressUntil, Date.now() + 1500);
      if (Date.now() > hibImgSuppressUntil) { clearInterval(hibImgSuppressTimer); hibImgSuppressTimer = null; return; }
      for (const id of ["imagus-popup", "imagus-loader"]) {
        const el = hibImgFindById(document, id);
        if (el) el.style.setProperty("display", "none", "important");
      }
    }, 50);
  }
  const hibImgIsDlsiteRightButton = event => {
    if (event.button !== 2 && event.type !== "contextmenu") return null;
    const found = findTarget(event.target);
    return found && found.target.kind === "dlsite" ? found : null;
  };
  /* window capture = before any document / element listener of Imagus that sits lower in the event path */
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick"]) {
    window.addEventListener(type, event => {
      if (hibImgIsDlsiteRightButton(event)) { event.stopPropagation(); hibImgSuppressImagus(6000); }
    }, true);
  }
  window.addEventListener(
    "contextmenu",
    event => {
      const found = hibImgIsDlsiteRightButton(event);
      if (!found) return;
      event.preventDefault();
      event.stopPropagation();
      hibImgSuppressImagus(6000);
      const productId = found.target.productId || "";
      const readyAnchor = () => {
        const live = document.querySelector('a[data-hib-v2-product-id="' + productId + '"][data-hib-v2-ready="1"]');
        return live && live.dataset.hibGallery ? live : null;
      };
      const now = readyAnchor();
      if (now) { hibV285OpenGallery(now); return; }
      resolveTarget(found.anchor, found.target, "right-click");        /* (the 2.1.5 right-click handler below the window never sees this event) */
      const t0 = Date.now();
      const timer = setInterval(() => {
        const live = readyAnchor();
        if (live) { clearInterval(timer); hibV285OpenGallery(live); }
        else if (Date.now() - t0 > 25000) clearInterval(timer);
      }, 300);
    },
    true
  );

  console.log(
    "[HIB v2.1.5] loaded",
    VERSION,
    location.href
  );
})();
/*
 * HIB-V210-OUO-CHAIN
 *
 * OUO entry-point handler.
 *
 * - no page-load resolution
 * - hover/contextmenu can start the resolver
 * - interaction is never blocked
 * - spinner is attached only to the exact OUO anchor
 * - original OUO URL preserved in data-tih-original-href
 * - href becomes the final direct image only after verified success
 */

(() => {
  if (
    window.__hibV210OuoInstalled
  ) {
    return;
  }

  window.__hibV210OuoInstalled =
    true;

  const states =
    new Map();

  function normalizeOuo(value) {
    let url;

    try {
      url =
        new URL(
          value,
          location.href
        );
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

    return {
      key:
        "ouo:" +
        url.href,

      url:
        url.href
    };
  }

  function findOuo(node) {
    if (
      !(node instanceof Element)
    ) {
      return null;
    }

    const anchor =
      node.closest(
        "a[href]"
      );

    if (!anchor) {
      return null;
    }

    const target =
      normalizeOuo(
        anchor.href
      );

    if (!target) {
      return null;
    }

    return {
      anchor,
      target
    };
  }

  function spinnerSelector(key) {
    return (
      '.hib-v208-spinner[data-hib-chain-key="' +
      CSS.escape(key) +
      '"]'
    );
  }

  function showSpinner(
    anchor,
    target
  ) {
    if (
      !anchor ||
      !anchor.isConnected
    ) {
      return;
    }

    const existing =
      anchor.nextElementSibling;

    if (
      existing &&
      existing.classList &&
      existing.classList.contains(
        "hib-v208-spinner"
      ) &&
      existing.dataset.hibChainKey ===
        target.key
    ) {
      return;
    }

    const spinner =
      document.createElement(
        "span"
      );

    spinner.className =
      "hib-v208-spinner";

    spinner.dataset.hibChainKey =
      target.key;

    spinner.title =
      "Host Imagus Bridge is resolving chained image link";

    anchor.insertAdjacentElement(
      "afterend",
      spinner
    );
  }

  function removeSpinner(
    target
  ) {
    for (
      const spinner of
      document.querySelectorAll(
        spinnerSelector(
          target.key
        )
      )
    ) {
      spinner.remove();
    }
  }

  async function resolveOuo(
    anchor,
    target,
    trigger
  ) {
    const existing =
      states.get(
        target.key
      );

    if (
      existing ===
        "resolving" ||
      existing ===
        "resolved"
    ) {
      showSpinner(
        anchor,
        target
      );

      return;
    }

    states.set(
      target.key,
      "resolving"
    );

    showSpinner(
      anchor,
      target
    );

    console.log(
      "[HIB v2.1.5 chain] IMMEDIATE INTERACTION -> OUO:",
      trigger,
      target.url
    );

    let result;

    try {
      result =
        await browser.runtime.sendMessage({
          type:
            "hib-v2-resolve-chain",

          pageUrl:
            target.url
        });
    }
    catch (error) {
      removeSpinner(
        target
      );

      states.delete(
        target.key
      );

      console.warn(
        "[HIB v2.1.5 chain] message failed; original OUO link untouched:",
        String(error)
      );

      return;
    }

    if (
      !result ||
      !result.ok ||
      !result.fullUrl
    ) {
      removeSpinner(
        target
      );

      states.delete(
        target.key
      );

      console.warn(
        "[HIB v2.1.5 chain] resolution failed; original OUO link untouched:",
        result && result.error
          ? result.error
          : "unknown error"
      );

      return;
    }

    /*
     * Find the still-live original OUO anchor. There may be more than one
     * identical URL on the page, but only exact URL matches are rewritten.
     */
    const anchors =
      [];

    for (
      const candidate of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      const normalized =
        normalizeOuo(
          candidate.href
        );

      if (
        normalized &&
        normalized.url ===
          target.url
      ) {
        anchors.push(
          candidate
        );
      }
    }

    let rewritten =
      0;

    for (
      const liveAnchor of
      anchors
    ) {
      liveAnchor.dataset.tihOriginalHref =
        target.url;

      liveAnchor.dataset.tihFullImage =
        result.fullUrl;

      liveAnchor.dataset.hibV2ChainState =
        "resolved";

      liveAnchor.dataset.hibV2ChainReady =
        "1";

      /*
       * Same successful direct-image handoff that fixed XXPICS:
       * only after a verified terminal image exists.
       */
      liveAnchor.href =
        result.fullUrl;

      const fresh =
        liveAnchor.cloneNode(
          true
        );

      fresh.dataset.tihOriginalHref =
        target.url;

      fresh.dataset.tihFullImage =
        result.fullUrl;

      fresh.dataset.hibV2ChainState =
        "resolved";

      fresh.dataset.hibV2ChainReady =
        "1";

      liveAnchor.replaceWith(
        fresh
      );

      rewritten +=
        1;
    }

    removeSpinner(
      target
    );

    states.set(
      target.key,
      "resolved"
    );

    console.log(
      "[HIB v2.1.5 chain] ACTUAL PICTURE READY:",
      {
        originalUrl:
          target.url,

        fullUrl:
          result.fullUrl,

        source:
          result.source,

        chain:
          result.chain,

        pollCount:
          result.pollCount,

        rewrittenAnchors:
          rewritten
      }
    );
  }

  function interact(
    event,
    trigger
  ) {
    const found =
      findOuo(
        event.target
      );

    if (!found) {
      return;
    }

    /*
     * Deliberately no preventDefault / stopPropagation.
     */
    resolveOuo(
      found.anchor,
      found.target,
      trigger
    );
  }

  document.addEventListener(
    "pointerover",
    event => {
      const found =
        findOuo(
          event.target
        );

      if (!found) {
        return;
      }

      const from =
        event.relatedTarget;

      if (
        from instanceof Node &&
        found.anchor.contains(
          from
        )
      ) {
        return;
      }

      interact(
        event,
        "hover"
      );
    },
    true
  );

  document.addEventListener(
    "contextmenu",
    event => {
      interact(
        event,
        "right-click"
      );
    },
    true
  );

  console.log(
    "[HIB v2.1.5 chain] OUO hover handler loaded"
  );
})();
/*
 * HIB-V212-IMGPV
 *
 * Hover/right-click driven ImgPV wrapper support.
 *
 * - interaction is never blocked
 * - spinner appears immediately
 * - original wrapper URL stays preserved
 * - resolver discovers real CGI URL
 * - CGI URL is converted to wp.com proxy
 * - proxy is verified before handoff
 * - fresh anchor/image objects are installed after success
 */

(() => {
  if (
    window.__hibV212ImgPvInstalled
  ) {
    return;
  }

  window.__hibV212ImgPvInstalled =
    true;

  const states =
    new Map();

  function normalizeImgPv(
    value
  ) {
    let url;

    try {
      url =
        new URL(
          value,
          location.href
        );
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
      !host.endsWith(
        ".imgpv.com"
      )
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

    return {
      key:
        "imgpv:" +
        url.href,

      url:
        url.href
    };
  }

  function findImgPv(
    node
  ) {
    if (
      !(node instanceof Element)
    ) {
      return null;
    }

    const anchor =
      node.closest(
        "a[href]"
      );

    if (!anchor) {
      return null;
    }

    const target =
      normalizeImgPv(
        anchor.href
      );

    if (!target) {
      return null;
    }

    return {
      anchor,
      target
    };
  }

  function getWpHost(
    anchor
  ) {
    const img =
      anchor
        ? anchor.querySelector(
            "img"
          )
        : null;

    if (img) {
      const src =
        img.currentSrc ||
        img.src ||
        "";

      try {
        const host =
          new URL(
            src,
            location.href
          ).hostname;

        if (
          /^i\d+\.wp\.com$/i.test(
            host
          )
        ) {
          return host;
        }
      }
      catch (error) {}
    }

    return "i1.wp.com";
  }

  function makeWpProxy(
    cgiUrl,
    anchor
  ) {
    let source;

    try {
      source =
        new URL(
          cgiUrl
        );
    }
    catch (error) {
      return null;
    }

    if (
      !/(^|\.)imgpv\.com$/i.test(
        source.hostname
      ) ||
      !(
        /^\/cgi-bin\/dl\.cgi\//i.test(source.pathname) ||
        /* IMGPV 2026-11: sN.imgpv.com/i/NNNNN/<id>.jpg (never a _t thumbnail) */
        (/^\/i\/\d+\/[^\/]+\.(?:jpe?g|png|gif|webp|avif)$/i.test(source.pathname) && !/_t\.[a-z0-9]+$/i.test(source.pathname))
      )
    ) {
      return null;
    }

    const wpHost =
      getWpHost(
        anchor
      );

    let proxyText =
      "https://" +
      wpHost +
      "/" +
      source.hostname +
      source.pathname;

    if (source.search) {
      proxyText +=
        source.search;
    }

    let proxy;

    try {
      proxy =
        new URL(
          proxyText
        );

      proxy.searchParams.set(
        "ssl",
        "1"
      );
    }
    catch (error) {
      return null;
    }

    return proxy.href;
  }

  function hibV223IsDirectMediaUrl(
    url
  ) {
    return /\.(?:mp4|webm|m4v|mov|m3u8|mpd|mp3|ogg|wav|m4a)(?:[?#]|$)/i.test(
      String(url || "")
    );
  }

  function hibV223VerifyMedia(
    url,
    timeoutMs
  ) {
    return new Promise(resolve => {
      const isAudio =
        /\.(?:mp3|ogg|wav|m4a)(?:[?#]|$)/i.test(
          String(url || "")
        );

      const media =
        document.createElement(
          isAudio
            ? "audio"
            : "video"
        );

      let finished =
        false;

      const done =
        result => {
          if (finished) {
            return;
          }

          finished =
            true;

          clearTimeout(
            timer
          );

          try {
            media.pause();
          }
          catch (error) {}

          media.removeAttribute(
            "src"
          );

          try {
            media.load();
          }
          catch (error) {}

          resolve(
            result
          );
        };

      media.preload =
        "metadata";

      media.muted =
        true;

      media.onloadedmetadata =
        () => {
          done({
            ok:
              true,

            kind:
              isAudio
                ? "audio"
                : "video",

            duration:
              Number.isFinite(
                media.duration
              )
                ? media.duration
                : null,

            width:
              Number(
                media.videoWidth || 0
              ),

            height:
              Number(
                media.videoHeight || 0
              )
          });
        };

      media.onerror =
        () => {
          done({
            ok:
              false,

            kind:
              isAudio
                ? "audio"
                : "video",

            error:
              "media-load-error"
          });
        };

      const timer =
        setTimeout(
          () => {
            done({
              ok:
                false,

              kind:
                isAudio
                  ? "audio"
                  : "video",

              error:
                "media-timeout"
            });
          },
          timeoutMs
        );

      media.src =
        url;
    });
  }
  function verifyImage(
    url,
    timeoutMs
  ) {
    return new Promise(
      resolve => {
        const image =
          new Image();

        let finished =
          false;

        const finish =
          result => {
            if (finished) {
              return;
            }

            finished =
              true;

            clearTimeout(
              timer
            );

            image.onload =
              null;

            image.onerror =
              null;

            resolve(
              result
            );
          };

        const timer =
          setTimeout(
            () => {
              finish({
                ok:
                  false,

                reason:
                  "timeout"
              });
            },
            timeoutMs
          );

        image.onload =
          () => {
            const width =
              image.naturalWidth ||
              0;

            const height =
              image.naturalHeight ||
              0;

            finish({
              ok:
                width > 0 &&
                height > 0,

              width,

              height
            });
          };

        image.onerror =
          () => {
            finish({
              ok:
                false,

              reason:
                "load-error"
            });
          };

        image.src =
          url;
      }
    );
  }

  function spinnerSelector(
    key
  ) {
    return (
      '.hib-v208-spinner[data-hib-imgpv-key="' +
      CSS.escape(key) +
      '"]'
    );
  }

  function showSpinner(
    anchor,
    target
  ) {
    if (
      !anchor ||
      !anchor.isConnected
    ) {
      return;
    }

    const next =
      anchor.nextElementSibling;

    if (
      next &&
      next.classList &&
      next.classList.contains(
        "hib-v208-spinner"
      ) &&
      next.dataset.hibImgpvKey ===
        target.key
    ) {
      return;
    }

    const spinner =
      document.createElement(
        "span"
      );

    spinner.className =
      "hib-v208-spinner";

    spinner.dataset.hibImgpvKey =
      target.key;

    spinner.title =
      "Host Imagus Bridge is resolving ImgPV";

    anchor.insertAdjacentElement(
      "afterend",
      spinner
    );
  }

  function removeSpinner(
    target
  ) {
    for (
      const spinner of
      document.querySelectorAll(
        spinnerSelector(
          target.key
        )
      )
    ) {
      spinner.remove();
    }
  }

  async function resolveImgPv(
    anchor,
    target,
    trigger
  ) {
    const existing =
      states.get(
        target.key
      );

    if (
      existing ===
        "resolving" ||
      existing ===
        "resolved"
    ) {
      showSpinner(
        anchor,
        target
      );

      return;
    }

    states.set(
      target.key,
      "resolving"
    );

    showSpinner(
      anchor,
      target
    );

    console.log(
      "[HIB v2.1.5 ImgPV] IMMEDIATE INTERACTION:",
      trigger,
      target.url
    );

    let result;

    try {
      result =
        await browser.runtime.sendMessage({
          type:
            "hib-v2-resolve-imgpv",

          pageUrl:
            target.url
        });
    }
    catch (error) {
      states.delete(
        target.key
      );

      removeSpinner(
        target
      );

      console.warn(
        "[HIB v2.1.5 ImgPV] resolver message failed:",
        String(error)
      );

      return;
    }

    if (
      !result ||
      !result.ok ||
      !result.fullUrl
    ) {
      states.delete(
        target.key
      );

      removeSpinner(
        target
      );

      console.warn(
        "[HIB v2.1.5 ImgPV] resolver failed; original link untouched:",
        result && result.error
          ? result.error
          : "unknown error"
      );

      return;
    }

    let proxyUrl =
      makeWpProxy(
        result.fullUrl,
        anchor
      );

    /* a result found by the shared picture finder (the site's pages changed): use the picture address itself */
    if (!proxyUrl && result.layoutFallback && /^https:\/\//i.test(String(result.fullUrl))) {
      proxyUrl = result.fullUrl;
    }

    if (!proxyUrl) {
      states.delete(
        target.key
      );

      removeSpinner(
        target
      );

      console.warn(
        "[HIB v2.1.5 ImgPV] invalid CGI result:",
        result.fullUrl
      );

      return;
    }

    console.log(
      "[HIB v2.1.5 ImgPV] VERIFYING:",
      proxyUrl
    );

    const verification =
      await verifyImage(
        proxyUrl,
        12000
      );

    if (
      !verification ||
      !verification.ok
    ) {
      states.delete(
        target.key
      );

      removeSpinner(
        target
      );

      console.warn(
        "[HIB v2.1.5 ImgPV] proxy verification failed:",
        proxyUrl,
        verification
      );

      return;
    }

    console.log(
      "[HIB v2.1.5 ImgPV] VERIFIED:",
      verification.width +
      "x" +
      verification.height
    );

    const anchors =
      [];

    for (
      const candidate of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      const normalized =
        normalizeImgPv(
          candidate.href
        );

      if (
        normalized &&
        normalized.url ===
          target.url
      ) {
        anchors.push(
          candidate
        );
      }
    }

    let replaced =
      0;

    for (
      const oldAnchor of
      anchors
    ) {
      oldAnchor.dataset.tihOriginalHref =
        target.url;

      oldAnchor.dataset.tihFullImage =
        proxyUrl;

      oldAnchor.dataset.hibV2ImgPvState =
        "resolved";

      oldAnchor.dataset.hibV2ImgPvReady =
        "1";

      oldAnchor.href =
        proxyUrl;

      const oldImg =
        oldAnchor.querySelector(
          "img"
        );

      const freshAnchor =
        oldAnchor.cloneNode(
          true
        );

      freshAnchor.href =
        proxyUrl;

      freshAnchor.dataset.tihOriginalHref =
        target.url;

      freshAnchor.dataset.tihFullImage =
        proxyUrl;

      freshAnchor.dataset.hibV2ImgPvState =
        "resolved";

      freshAnchor.dataset.hibV2ImgPvReady =
        "1";

      if (oldImg) {
        const freshImg =
          oldImg.cloneNode(
            true
          );

        freshImg.dataset.tihFullImage =
          proxyUrl;

        /*
         * Replace the cloned image too so Imagus sees a completely fresh
         * image/anchor pair, matching the previously proven ImgPV behavior.
         */
        const clonedImg =
          freshAnchor.querySelector(
            "img"
          );

        if (clonedImg) {
          clonedImg.replaceWith(
            freshImg
          );
        }
      }

      oldAnchor.replaceWith(
        freshAnchor
      );

      replaced +=
        1;
    }

    states.set(
      target.key,
      "resolved"
    );

    removeSpinner(
      target
    );

    console.log(
      "[HIB v2.1.5 ImgPV] ACTUAL PICTURE READY:",
      {
        originalUrl:
          target.url,

        cgiUrl:
          result.fullUrl,

        proxyUrl,

        width:
          verification.width,

        height:
          verification.height,

        replacedAnchors:
          replaced
      }
    );
  }

  function interact(
    event,
    trigger
  ) {
    const found =
      findImgPv(
        event.target
      );

    if (!found) {
      return;
    }

    /*
     * No preventDefault.
     * No stopPropagation.
     */
    resolveImgPv(
      found.anchor,
      found.target,
      trigger
    );
  }

  document.addEventListener(
    "pointerover",
    event => {
      const found =
        findImgPv(
          event.target
        );

      if (!found) {
        return;
      }

      const from =
        event.relatedTarget;

      if (
        from instanceof Node &&
        found.anchor.contains(
          from
        )
      ) {
        return;
      }

      interact(
        event,
        "hover"
      );
    },
    true
  );

  document.addEventListener(
    "contextmenu",
    event => {
      interact(
        event,
        "right-click"
      );
    },
    true
  );

  console.log(
    "[HIB v2.1.5 ImgPV] isolated handler loaded"
  );
})();
/*
 * HIB-V213-GENERIC-FALLBACK
 *
 * Generic wrapper fallback.
 *
 * Specialized handlers remain first choice.
 *
 * Unknown wrapper-looking links:
 *   resolve immediately on real user interaction.
 *
 * Known single-image handlers:
 *   XXPICS / ImgPV / OUO receive this fallback only if their original
 *   anchor is still present and unresolved after 8 seconds.
 *
 * DLsite is deliberately excluded because its gallery semantics require
 * the specialized DLsite resolver.
 */

(() => {
  /*
   * HIB-V215-SUKEBEI-PAGE-GATE
   *
   * Generic wrapper discovery is allowed ONLY on an individual
   * Sukebei torrent detail page:
   *
   *   /view/<numeric torrent id>
   *
   * Listing/category/search/index pages are excluded completely.
   */
  /*
   * HIB-V216-ENABLED-SITE-PAGE-GATE
   *
   * content.js is injected only on source sites explicitly enabled by
   * the user through the HIB toolbar popup.
   *
   * Sukebei keeps its additional /view/<id> restriction because its
   * listing/search pages contain many internal torrent links.
   *
   * Other explicitly enabled sites may use the generic resolver normally.
   */
  const hibV216GenericPageAllowed =
    location.hostname !== "sukebei.nyaa.si" ||
    /^\/view\/\d+\/?$/.test(
      location.pathname
    );

  if (
    !hibV216GenericPageAllowed
  ) {
    console.log(
      "[HIB v2.1.5 generic] disabled on Sukebei non-detail page:",
      location.pathname +
        location.search
    );

    return;
  }

  if (
    window.__hibV213GenericInstalled
  ) {
    return;
  }

  window.__hibV213GenericInstalled =
    true;

  const states =
    new Map();

  const scheduled =
    new WeakSet();

  function normalizeHttp(
    value
  ) {
    try {
      const url =
        new URL(
          value,
          location.href
        );

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

  function hostOf(
    value
  ) {
    try {
      return new URL(
        value,
        location.href
      )
        .hostname
        .toLowerCase()
        .replace(/^www\./, "");
    }
    catch (error) {
      return "";
    }
  }

  function directImage(
    value
  ) {
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

  function knownKind(
    value
  ) {
    const host =
      hostOf(
        value
      );

    if (
      host === "dlsite.com"
    ) {
      return "dlsite";
    }

    if (
      host === "xxpics.org"
    ) {
      return "xxpics";
    }

    if (
      host === "ouo.io"
    ) {
      return "ouo";
    }

    if (
      host === "imgpv.com" ||
      host.endsWith(
        ".imgpv.com"
      )
    ) {
      return "imgpv";
    }

    return null;
  }

  /*
   * HIB-V3021-GENERIC-TEXT-LINK
   *
   * Text-only external links with an opaque address (a bare "host/aB3dE5fG7hJ9"
   * with no picture, no file name and no image-looking folder) were never
   * eligible for generic resolution, so image hosts that are linked as plain
   * text could not be previewed.
   *
   * This is NOT a host list. An anchor becomes a CANDIDATE only when all of the
   * following hold:
   *   - it is an external http(s) link (same-site links are rejected earlier),
   *   - it is not a site's front page, not inside navigation, not a direct file
   *     (archives, documents, torrents, audio...), and no folder name in its
   *     path says "directory / download / list / account..." (download
   *     directories, listings and account pages are not picture wrappers),
   *   - the last part of its path is an opaque identifier (8-24 plain letters
   *     and digits with at least one digit, optionally ending in .html/.php;
   *     words, dated slugs with dashes and CamelCase page names do not count),
   *   - its visible text is short or is the address itself.
   *
   * Being a candidate only lets the link reach the normal Imagus-first path.
   * Nothing is rewritten and no popup is shown unless the background resolver
   * finds a picture or video that the browser then verifies.
   *
   * Bounded discovery: an address whose resolver run found no usable media is
   * not tried again for 30 minutes, and an origin that gave 3 such answers in a
   * row is left alone until the page is reloaded.
   */
  const hibV3021FileExt =
    /\.(?:zip|rar|7z|tar|gz|tgz|bz2|xz|iso|exe|msi|apk|dmg|pdf|epub|mobi|cbz|cbr|torrent|txt|srt|ass|ssa|vtt|docx?|xlsx?|csv|json|xml|mp3|flac|wav|ogg|m4a)$/i;

  const hibV3021ListingWord =
    /^(?:dir|dirs|directory|directories|folder|folders|download|downloads|dl|archive|archives|zip|torrent|torrents|magnet|list|lists|collection|collections|file|files|users?|profiles?|login|logout|register|signup|account|search|tags?|categor(?:y|ies)|forum|forums|threads?|topics?|watch|embed|redirect|out|go|away|link|links)$/i;

  const hibV3021NoMedia =
    new Map();

  const hibV3021OriginMisses =
    new Map();

  const hibV3021NoMediaTtlMs =
    30 * 60 * 1000;

  const hibV3021OriginMissLimit =
    3;

  function hibV3021TextWrapperCandidate(
    anchor
  ) {
    let url;

    try {
      url =
        new URL(
          anchor.href,
          location.href
        );
    }
    catch (error) {
      return false;
    }

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return false;
    }

    if (
      url.username ||
      url.password
    ) {
      return false;
    }

    const path =
      url.pathname || "/";

    if (
      path === "/" &&
      !url.search
    ) {
      return false;
    }

    if (
      hibV3021FileExt.test(
        path
      )
    ) {
      return false;
    }

    const segments =
      path
        .split("/")
        .filter(Boolean);

    if (
      !segments.length ||
      segments.length > 3 ||
      segments.some(
        segment =>
          hibV3021ListingWord.test(
            segment
          )
      )
    ) {
      return false;
    }

    const token =
      segments[
        segments.length - 1
      ].replace(
        /\.(?:html?|php)$/i,
        ""
      );

    if (
      !/^[A-Za-z0-9]{8,24}$/.test(
        token
      ) ||
      !/\d/.test(
        token
      )
    ) {
      return false;
    }

    const text =
      (
        anchor.textContent ||
        ""
      ).trim();

    if (
      text.length > 80
    ) {
      return false;
    }

    if (
      anchor.closest &&
      anchor.closest(
        'nav,header,footer,[role="navigation"],[role="menu"],[role="menubar"],.menu,.navbar,.nav,.breadcrumb'
      )
    ) {
      return false;
    }

    return true;
  }

  function hibV3021MayProbe(
    url
  ) {
    let origin;

    try {
      origin =
        new URL(
          url
        ).origin;
    }
    catch (error) {
      return false;
    }

    const when =
      hibV3021NoMedia.get(
        url
      );

    if (
      when &&
      Date.now() - when <
        hibV3021NoMediaTtlMs
    ) {
      return false;
    }

    if (
      (
        hibV3021OriginMisses.get(
          origin
        ) || 0
      ) >=
        hibV3021OriginMissLimit
    ) {
      return false;
    }

    return true;
  }

  function hibV3021NoteMiss(
    url
  ) {
    hibV3021NoMedia.set(
      url,
      Date.now()
    );

    try {
      const origin =
        new URL(
          url
        ).origin;

      hibV3021OriginMisses.set(
        origin,
        (
          hibV3021OriginMisses.get(
            origin
          ) || 0
        ) + 1
      );
    }
    catch (error) {}
  }

  function hibV3021NoteHit(
    url
  ) {
    hibV3021NoMedia.delete(
      url
    );

    try {
      hibV3021OriginMisses.delete(
        new URL(
          url
        ).origin
      );
    }
    catch (error) {}
  }

  function wrapperLooking(
    anchor
  ) {
    if (
      !anchor ||
      !anchor.href
    ) {
      return false;
    }

    /*
     * HIB-V215-SUKEBEI-INTERNAL-LINK-GUARD
     *
     * A Sukebei torrent/title/detail link is navigation, never an
     * external image wrapper. Reject every same-site anchor before
     * generic wrapper heuristics inspect words such as "/view/".
     */
    if (
      hostOf(
        anchor.href
      ) ===
        location.hostname.toLowerCase()
    ) {
      return false;
    }

    if (
      directImage(
        anchor.href
      )
    ) {
      return false;
    }

    if (
      anchor.querySelector(
        "img"
      )
    ) {
      return true;
    }

    const href =
      anchor.href;

    return (
      /\.(?:jpe?g|png|gif|webp|avif|bmp)\.(?:html?|php)(?:$|[?#])/i.test(
        href
      ) ||
      /\/(?:image|images|img|photo|picture|pic|view|full|original|gallery|cover|p)\//i.test(
        href
      ) ||
      hibV3021TextWrapperCandidate(
        anchor
      )
    );
  }

  function findAnchor(
    node
  ) {
    if (
      !(node instanceof Element)
    ) {
      return null;
    }

    return node.closest(
      "a[href]"
    );
  }

  function spinnerSelector(
    key
  ) {
    return (
      '.hib-v208-spinner[data-hib-generic-key="' +
      CSS.escape(key) +
      '"]'
    );
  }

  function showSpinner(
    anchor,
    key
  ) {
    if (
      !anchor ||
      !anchor.isConnected
    ) {
      return;
    }

    /*
     * Reuse an existing specialized spinner if one is already present.
     */
    const next =
      anchor.nextElementSibling;

    if (
      next &&
      next.classList &&
      next.classList.contains(
        "hib-v208-spinner"
      )
    ) {
      return;
    }

    const spinner =
      document.createElement(
        "span"
      );

    spinner.className =
      "hib-v208-spinner";

    spinner.dataset.hibGenericKey =
      key;

    spinner.title =
      "Host Imagus Bridge generic image resolver";

    anchor.insertAdjacentElement(
      "afterend",
      spinner
    );
  }

  function removeSpinner(
    key
  ) {
    for (
      const spinner of
      document.querySelectorAll(
        spinnerSelector(
          key
        )
      )
    ) {
      spinner.remove();
    }
  }

  /*
   * HIB-V221-RESOLVED-SPINNER-SWEEP
   *
   * A specialized resolver and the generic fallback can both have observed
   * the same wrapper before one of them succeeds. The successful generic
   * handoff therefore clears not only its key-specific spinner, but any HIB
   * spinner immediately associated with the newly resolved anchor.
   */
  function hibV221SweepResolvedSpinners(
    originalUrl,
    fullUrl
  ) {
    const wanted =
      new Set(
        [
          String(
            originalUrl || ""
          ),

          String(
            fullUrl || ""
          )
        ].filter(Boolean)
      );

    if (!wanted.size) {
      return;
    }

    for (
      const spinner of
      document.querySelectorAll(
        ".hib-v208-spinner"
      )
    ) {
      const previous =
        spinner.previousElementSibling;

      if (
        !previous ||
        previous.tagName !==
          "A"
      ) {
        continue;
      }

      const original =
        previous.dataset
          ? previous.dataset.tihOriginalHref || ""
          : "";

      const full =
        previous.dataset
          ? previous.dataset.tihFullImage || ""
          : "";

      const href =
        previous.href || "";

      if (
        wanted.has(
          original
        ) ||
        wanted.has(
          full
        ) ||
        wanted.has(
          href
        )
      ) {
        spinner.remove();
      }
    }
  }
  /*
   * HIB-V228-RESOLVE-STATE-LOCK
   *
   * Generic interaction states:
   *
   * resolving:
   *   spinner is active and this exact anchor is temporarily locked.
   *
   * resolved:
   *   spinner remains in place but is frozen as the ready indicator.
   *
   * Resolver completion only re-arms Imagus when this exact tile is
   * still physically hovered.
   */
  function hibV228SpinnerForAnchor(
    anchor
  ) {
    if (
      !anchor
    ) {
      return null;
    }

    const next =
      anchor.nextElementSibling;

    if (
      next &&
      next.classList &&
      next.classList.contains(
        "hib-v208-spinner"
      )
    ) {
      return next;
    }

    return null;
  }

  function hibV228IsResolvingAnchor(
    anchor
  ) {
    if (
      !anchor ||
      !anchor.dataset ||
      anchor.dataset.hibV2GenericState !==
        "resolving"
    ) {
      return false;
    }

    /*
     * HIB-V237-SANKAKU-CLEAN-VISUALS
     *
     * Sankaku resolution is intentionally invisible, so its interaction lock
     * must be driven by state rather than by the existence of a HIB spinner.
     */
    const originalUrl =
      anchor.dataset.tihOriginalHref ||
      anchor.href ||
      "";

    if (
      hibV233IsSankakuPostUrl(
        originalUrl
      )
    ) {
      return true;
    }

    const spinner =
      hibV228SpinnerForAnchor(
        anchor
      );

    return Boolean(
      spinner &&
      spinner.dataset.hibV228State !==
        "ready"
    );
  }

  function hibV228MarkAnchorResolving(
    anchor,
    originalUrl
  ) {
    if (
      !anchor
    ) {
      return;
    }

    anchor.dataset.hibV2GenericState =
      "resolving";

    anchor.dataset.hibV2GenericReady =
      "0";

    anchor.dataset.tihOriginalHref =
      originalUrl;

    const spinner =
      hibV228SpinnerForAnchor(
        anchor
      );

    if (
      spinner
    ) {
      spinner.dataset.hibV228State =
        "resolving";
    }
  }

  /*
   * HIB-V231-DASHED-READY
   *
   * Visual state contract:
   *
   *   spinner       = HIB is actively resolving
   *   no spinner    = HIB is no longer working
   *   dashed image  = HIB resolution succeeded and this tile is ready
   *
   * The dashed marker is CSS-driven from data-hib-v2-generic-ready="1".
   * Sankaku SPA replacement code already reapplies that ready attribute,
   * so the visual marker survives replacement without keeping a fake
   * spinner in the DOM.
   */
  function hibV231EnsureReadyStyle() {
    /*
     * HIB-V237-SANKAKU-CLEAN-VISUALS
     *
     * Sankaku's SPA can reapply data-hib-v2-generic-ready after resolution.
     * Do not install the dashed-ready stylesheet on Sankaku at all. This
     * guarantees that those later SPA writes cannot move/outline the tile.
     */
    if (
      /(^|\.)sankakucomplex\.com$/i.test(
        location.hostname
      )
    ) {
      return;
    }

    if (
      document.getElementById(
        "hib-v231-ready-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "hib-v231-ready-style";

    style.textContent = `
      a[data-hib-v2-generic-ready="1"] img {
        outline: 2px dashed currentColor !important;
        outline-offset: 2px !important;
      }

      a[data-hib-v2-generic-ready="1"]:not(:has(img)) {
        outline: 2px dashed currentColor !important;
        outline-offset: 2px !important;
      }
    `;

    (
      document.head ||
      document.documentElement
    ).appendChild(
      style
    );
  }

  hibV231EnsureReadyStyle();

  function hibV228MarkReady(
  originalUrl,
  fullUrl
) {
  /*
   * HIB-V236-SANKAKU-NO-DASH
   *
   * Sankaku now relies entirely on Imagus loader-state feedback and the
   * resolved-link handoff. Do not apply the v2.1.3 dashed-ready decoration
   * on Sankaku because it causes unnecessary layout movement.
   *
   * The resolved-state metadata and unlock behavior remain intact.
   * Other sites retain the existing dashed-ready behavior.
   */

  let readyCount =
    0;

  let removedSpinners =
    0;

  for (
    const live of
    document.querySelectorAll(
      'a[href]'
    )
  ) {
    const liveOriginal =
      live.dataset.hibV2OriginalHref ||
      live.href ||
      "";

    if (
      liveOriginal !==
        originalUrl &&
      live.href !==
        originalUrl
    ) {
      continue;
    }

    live.dataset.hibV2GenericState =
      "resolved";

    live.dataset.hibV2Ready =
      "1";

    /*
     * Keep the original v2.1.3 ready metadata, but suppress the visual dash
     * on Sankaku only.
     */
    if (
      !hibV233IsSankakuPostUrl(
        originalUrl
      )
    ) {
      live.dataset.hibV2GenericReady =
        "1";
    }
    else {
      delete live.dataset.hibV2GenericReady;
    }

    if (
      fullUrl
    ) {
      live.href =
        fullUrl;
    }

    readyCount++;

    const key =
      "generic:" +
      originalUrl;

    for (
      const spinner of
      document.querySelectorAll(
        '.hib-v208-spinner[data-hib-generic-key="' +
        CSS.escape(key) +
        '"]'
      )
    ) {
      spinner.remove();

      removedSpinners++;
    }
  }

  console.log(
    hibV233IsSankakuPostUrl(
      originalUrl
    )
      ? "[HIB v2.1.5 generic] RESOLVED - NO DASH / READY:"
      : "[HIB v2.1.5 generic] RESOLVED - SPINNER REMOVED / DASHED READY:",
    {
      originalUrl,
      fullUrl,
      readyCount,
      removedSpinners
    }
  );
}
  function hibV228BlockWhileResolving(
    event
  ) {
    let node =
      event.target;

    if (
      node &&
      node.nodeType !==
        1
    ) {
      node =
        node.parentElement;
    }

    if (
      !node ||
      !node.closest
    ) {
      return;
    }

    const anchor =
      node.closest(
        "a[href]"
      );

    if (
      !hibV228IsResolvingAnchor(
        anchor
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    console.log(
      "[HIB v2.1.5 generic] BLOCKED WHILE RESOLVING:",
      event.type,
      anchor.dataset.tihOriginalHref ||
        anchor.href
    );
  }

  for (
    const eventName of
    [
      "click",
      "auxclick",
      "contextmenu"
    ]
  ) {
    document.addEventListener(
      eventName,
      hibV228BlockWhileResolving,
      true
    );
  }

  /*
   * HIB-V243-LEFT-MIDDLE-NATIVE
   *
   * Preserve the known-working v2.1.3 Sankaku resolver exactly as-is.
   *
   * After HIB has resolved a tile, href may point to the resolved media URL
   * because that is required by the working Imagus/right-click handoff.
   *
   * Interaction contract:
   *
   *   left button   -> original Sankaku post URL
   *   middle button -> original Sankaku post URL
   *   right button  -> untouched v2.1.3 HIB/media behavior
   *
   * No HIB resolver code is invoked here.
   * No right-click/contextmenu event is handled here.
   * No event is cancelled or stopped.
   */
  function hibV243UseOriginalForLeftMiddle(
    event
  ) {
    const isLeft =
      event.type ===
        "click" &&
      event.button ===
        0;

    const isMiddle =
      event.type ===
        "auxclick" &&
      event.button ===
        1;

    if (
      !isLeft &&
      !isMiddle
    ) {
      return;
    }

    let node =
      event.target;

    if (
      node &&
      node.nodeType !==
        1
    ) {
      node =
        node.parentElement;
    }

    if (
      !node ||
      !node.closest
    ) {
      return;
    }

    const anchor =
      node.closest(
        "a[href]"
      );

    if (
      !anchor ||
      !anchor.dataset ||
      anchor.dataset.hibV2GenericState !==
        "resolved"
    ) {
      return;
    }

    const originalUrl =
      anchor.dataset.tihOriginalHref ||
      "";

    const mediaUrl =
      anchor.dataset.tihFullImage ||
      "";

    if (
      !originalUrl ||
      !mediaUrl ||
      !hibV233IsSankakuPostUrl(
        originalUrl
      )
    ) {
      return;
    }

    /*
     * Change only the link destination for the browser's normal navigation.
     * Do NOT preventDefault or synthesize navigation.
     */
    anchor.href =
      originalUrl;

    console.log(
      isLeft
        ? "[HIB v2.1.5] LEFT -> original Sankaku post:"
        : "[HIB v2.1.5] MIDDLE -> original Sankaku post:",
      originalUrl
    );

    /*
     * If the listing remains alive, restore the verified media href after
     * the browser has consumed the native click.
     */
    setTimeout(
      () => {
        if (
          anchor.isConnected &&
          anchor.dataset &&
          anchor.dataset.hibV2GenericState ===
            "resolved" &&
          anchor.dataset.tihOriginalHref ===
            originalUrl &&
          anchor.dataset.tihFullImage ===
            mediaUrl
        ) {
          anchor.href =
            mediaUrl;
        }
      },
      0
    );
  }

  document.addEventListener(
    "click",
    hibV243UseOriginalForLeftMiddle,
    true
  );

  document.addEventListener(
    "auxclick",
    hibV243UseOriginalForLeftMiddle,
    true
  );
  /*
   * HIB-V227-CLEAN-MEDIA-HANDOFF
   *
   * Sankaku currentSrc commonly includes #t=0.1. That fragment is useful
   * inside the source page but Imagus/VideoJS currently mangles it into the
   * signed query string and appends "mp4", producing a 403 URL.
   *
   * Preserve the signed query exactly and remove only the fragment before
   * handing verified direct media to Imagus.
   */
  function hibV227CleanMediaUrl(
    url
  ) {
    try {
      const parsed =
        new URL(
          String(
            url || ""
          )
        );

      parsed.hash =
        "";

      return parsed.href;
    }
    catch (error) {
      return String(
        url || ""
      ).replace(
        /#.*$/,
        ""
      );
    }
  }
  /*
   * HIB-V226-GENERIC-MEDIA-SCOPE
   *
   * v2.1.3 originally placed its media verification helpers inside a
   * different isolated handler IIFE. The generic fallback therefore
   * raised ReferenceError at runtime even though node --check passed.
   *
   * Keep these helpers inside the generic handler scope that actually
   * consumes the background resolver result.
   */
  function hibV226IsDirectMediaUrl(
    url
  ) {
    return /\.(?:mp4|webm|m4v|mov|m3u8|mpd|mp3|ogg|wav|m4a)(?:[?#]|$)/i.test(
      String(
        url || ""
      )
    );
  }

  function hibV226VerifyMedia(
    url,
    timeoutMs
  ) {
    return new Promise(resolve => {
      const text =
        String(
          url || ""
        );

      const isAudio =
        /\.(?:mp3|ogg|wav|m4a)(?:[?#]|$)/i.test(
          text
        );

      const media =
        document.createElement(
          isAudio
            ? "audio"
            : "video"
        );

      let finished =
        false;

      let timer =
        null;

      const cleanup =
        () => {
          if (timer) {
            clearTimeout(
              timer
            );

            timer =
              null;
          }

          media.onloadedmetadata =
            null;

          media.onerror =
            null;

          media.onabort =
            null;
        };

      const done =
        result => {
          if (
            finished
          ) {
            return;
          }

          finished =
            true;

          cleanup();

          resolve(
            result
          );
        };

      media.preload =
        "metadata";

      media.muted =
        true;

      media.onloadedmetadata =
        () => {
          done({
            ok:
              true,

            width:
              isAudio
                ? 0
                : Number(
                    media.videoWidth || 0
                  ),

            height:
              isAudio
                ? 0
                : Number(
                    media.videoHeight || 0
                  ),

            duration:
              Number.isFinite(
                media.duration
              )
                ? media.duration
                : 0,

            kind:
              isAudio
                ? "audio"
                : "video"
          });
        };

      media.onerror =
        () => {
          done({
            ok:
              false,

            error:
              "media metadata load failed"
          });
        };

      media.onabort =
        () => {
          done({
            ok:
              false,

            error:
              "media metadata load aborted"
          });
        };

      timer =
        setTimeout(
          () => {
            done({
              ok:
                false,

              error:
                "media metadata verification timed out"
            });
          },
          Number(
            timeoutMs || 12000
          )
        );

      try {
        media.src =
          url;

        media.load();
      }
      catch (error) {
        done({
          ok:
            false,

          error:
            String(
              error
            )
        });
      }
    });
  }
  /*
   * HIB-V222-NATIVE-FIRST-GATE
   *
   * Generic HIB resolution is FALLBACK ONLY.
   *
   * On an unknown wrapper, first give Imagus Reborn a short opportunity
   * to handle the original link normally.
   *
   * During this grace period HIB:
   *   - creates NO resolver tab
   *   - shows NO spinner
   *   - rewrites NOTHING
   *
   * Only when no visible Imagus popup appears does generic HIB resolution
   * begin.
   */

  /*
   * HIB-V230-NATIVE-GRACE-2500
   *
   * Known-native Sankaku videos take approximately 2 seconds for Imagus
   * VideoJS metadata to become ready. Give native handling a 500ms margin
   * before HIB fallback is permitted.
   */
  const hibV222NativeGraceMs =
    2500;

  const hibV222NativePollMs =
    80;

  function hibV222IsVisible(
    element
  ) {
    if (
      !element ||
      !element.isConnected
    ) {
      return false;
    }

    let style;

    try {
      style =
        getComputedStyle(
          element
        );
    }
    catch (error) {
      return false;
    }

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity || 1) === 0
    ) {
      return false;
    }

    const rect =
      element.getBoundingClientRect();

    return (
      rect.width > 20 &&
      rect.height > 20
    );
  }

  function hibV222FindImagusPopupInRoot(
    root
  ) {
    if (
      !root ||
      typeof root.querySelector !==
        "function"
    ) {
      return null;
    }

    const direct =
      root.querySelector(
        "#imagus-popup"
      );

    if (direct) {
      return direct;
    }

    let elements;

    try {
      elements =
        root.querySelectorAll(
          "*"
        );
    }
    catch (error) {
      return null;
    }

    for (
      const element of
      elements
    ) {
      if (
        !element.shadowRoot
      ) {
        continue;
      }

      const nested =
        hibV222FindImagusPopupInRoot(
          element.shadowRoot
        );

      if (nested) {
        return nested;
      }
    }

    return null;
  }

  /*
   * HIB-V223-MEDIA-AWARE
   *
   * A visible Imagus popup is not enough to prove success.
   * Spinner-only/loading popups must not suppress HIB fallback.
   */
  function hibV222NativePreviewVisible() {
    const popup =
      hibV222FindImagusPopupInRoot(
        document
      );

    if (
      !hibV222IsVisible(
        popup
      )
    ) {
      return false;
    }

    const images =
      popup.querySelectorAll
        ? popup.querySelectorAll("img")
        : [];

    for (
      const image of
      images
    ) {
      if (
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0
      ) {
        return true;
      }
    }

    const videos =
      popup.querySelectorAll
        ? popup.querySelectorAll("video")
        : [];

    for (
      const video of
      videos
    ) {
      if (
        video.readyState >= 1 &&
        (
          video.currentSrc ||
          video.src ||
          video.querySelector("source[src]")
        )
      ) {
        return true;
      }
    }

    const audios =
      popup.querySelectorAll
        ? popup.querySelectorAll("audio")
        : [];

    for (
      const audio of
      audios
    ) {
      if (
        audio.readyState >= 1 &&
        (
          audio.currentSrc ||
          audio.src ||
          audio.querySelector("source[src]")
        )
      ) {
        return true;
      }
    }

    return false;
  }

  function hibV222AnchorStillHovered(
    anchor
  ) {
    if (
      !anchor ||
      !anchor.isConnected
    ) {
      return false;
    }

    try {
      return anchor.matches(
        ":hover"
      );
    }
    catch (error) {
      return true;
    }
  }

  /*
   * HIB-V229-NATIVE-MEDIA-CHANGE
   *
   * Imagus Reborn keeps its VideoJS player inside #imagus-popup even when
   * the outer popup reports display:none, opacity:0 and a 0x0 rectangle.
   *
   * Therefore native video success cannot depend solely on the outer popup
   * being visibly sized.
   *
   * Track the loaded media signature inside Imagus instead. A new loaded
   * image/video/audio source means Imagus handled the current interaction
   * natively. A stale source from a previous tile does not count.
   */
  function hibV229NativeMediaSignature() {
    const popup =
      hibV222FindImagusPopupInRoot(
        document
      );

    if (!popup) {
      return "";
    }

    const parts =
      [];

    for (
      const video of
      popup.querySelectorAll(
        "video"
      )
    ) {
      const src =
        video.currentSrc ||
        video.src ||
        (
          video.querySelector(
            "source[src]"
          )
            ? video.querySelector(
                "source[src]"
              ).src
            : ""
        );

      if (
        video.readyState >= 1 &&
        src
      ) {
        parts.push(
          "video|" +
          src +
          "|" +
          Number(
            video.videoWidth || 0
          ) +
          "x" +
          Number(
            video.videoHeight || 0
          )
        );
      }
    }

    for (
      const audio of
      popup.querySelectorAll(
        "audio"
      )
    ) {
      const src =
        audio.currentSrc ||
        audio.src ||
        (
          audio.querySelector(
            "source[src]"
          )
            ? audio.querySelector(
                "source[src]"
              ).src
            : ""
        );

      if (
        audio.readyState >= 1 &&
        src
      ) {
        parts.push(
          "audio|" +
          src
        );
      }
    }

    for (
      const image of
      popup.querySelectorAll(
        "img"
      )
    ) {
      const src =
        image.currentSrc ||
        image.src ||
        "";

      if (
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0 &&
        src
      ) {
        parts.push(
          "image|" +
          src +
          "|" +
          image.naturalWidth +
          "x" +
          image.naturalHeight
        );
      }
    }

    parts.sort();

    return parts.join(
      "\n"
    );
  }

  const hibV229NativeSuccessUrls =
    new Set();

  let hibV229LastNativeMediaSignature =
    hibV229NativeMediaSignature();

  function hibV229NativePreviewSucceeded(
    originalUrl
  ) {
    if (
      hibV229NativeSuccessUrls.has(
        originalUrl
      )
    ) {
      return true;
    }

    if (
      hibV222NativePreviewVisible()
    ) {
      hibV229LastNativeMediaSignature =
        hibV229NativeMediaSignature();

      hibV229NativeSuccessUrls.add(
        originalUrl
      );

      console.log(
        "[HIB v2.1.5 generic] NATIVE MEDIA VISIBLE:",
        originalUrl
      );

      return true;
    }

    const currentSignature =
      hibV229NativeMediaSignature();

    if (
      currentSignature &&
      currentSignature !==
        hibV229LastNativeMediaSignature
    ) {
      hibV229LastNativeMediaSignature =
        currentSignature;

      hibV229NativeSuccessUrls.add(
        originalUrl
      );

      console.log(
        "[HIB v2.1.5 generic] NATIVE MEDIA CHANGED - resolver not needed:",
        originalUrl
      );

      return true;
    }

    return false;
  }
  /*
   * HIB-V232-NATIVE-ANCHOR-SIGNAL
   *
   * On Sankaku, Imagus Reborn marks post anchors it successfully accepts
   * with an inline cursor: crosshair transition roughly 1.7 seconds after
   * hover. Known failing links do not receive this transition and instead
   * fall through to HIB.
   *
   * Only a transition that occurs after this hover begins counts. A link
   * that already had crosshair state beforehand is not automatically
   * treated as native success.
   */
  function hibV232AnchorHasNativeSignal(
    anchor
  ) {
    if (
      !anchor ||
      !anchor.isConnected
    ) {
      return false;
    }

    try {
      if (
        String(
          anchor.style.cursor || ""
        ).toLowerCase() ===
          "crosshair"
      ) {
        return true;
      }
    }
    catch (error) {}

    return false;
  }
  /*
   * HIB-V233-SANKAKU-LIVE-NATIVE-SIGNAL
   *
   * Sankaku native handling is identified by Imagus Reborn placing
   * cursor: crosshair on the live post anchor.
   *
   * Unlike v2.1.3, an already-present signal is valid. This matters when
   * hover successfully activated Imagus and the user subsequently
   * right-clicks the same tile.
   *
   * For Sankaku /posts/... links this signal is authoritative. Do not use
   * the global v2.1.3 media-signature detector because media loaded for a
   * different tile can otherwise be credited to the wrong waiting URL.
   */
  function hibV233IsSankakuPostUrl(
    url
  ) {
    try {
      const parsed =
        new URL(
          String(
            url || ""
          ),
          location.href
        );

      return (
        /(^|\.)sankakucomplex\.com$/i.test(
          parsed.hostname
        ) &&
        /^\/posts\/[^/?#]+\/?$/i.test(
          parsed.pathname
        )
      );
    }
    catch (error) {
      return false;
    }
  }

  function hibV233SameSankakuPost(
    left,
    right
  ) {
    try {
      const a =
        new URL(
          String(
            left || ""
          ),
          location.href
        );

      const b =
        new URL(
          String(
            right || ""
          ),
          location.href
        );

      return (
        a.hostname.toLowerCase() ===
          b.hostname.toLowerCase() &&
        a.pathname.replace(
          /\/+$/,
          ""
        ) ===
          b.pathname.replace(
            /\/+$/,
            ""
          )
      );
    }
    catch (error) {
      return false;
    }
  }

  function hibV233AnchorHasCrosshair(
    anchor
  ) {
    if (
      !anchor ||
      !anchor.isConnected
    ) {
      return false;
    }

    try {
      if (
        String(
          anchor.style.cursor || ""
        ).toLowerCase() ===
          "crosshair"
      ) {
        return true;
      }
    }
    catch (error) {}

    try {
      const inlineStyle =
        String(
          anchor.getAttribute(
            "style"
          ) || ""
        );

      if (
        /(?:^|;)\s*cursor\s*:\s*crosshair\s*(?:;|$)/i.test(
          inlineStyle
        )
      ) {
        return true;
      }
    }
    catch (error) {}

    return false;
  }

  function hibV233FindLiveSankakuNativeSignal(
    anchor,
    originalUrl
  ) {
    if (
      !hibV233IsSankakuPostUrl(
        originalUrl
      )
    ) {
      return null;
    }

    const candidates =
      [];

    if (anchor) {
      candidates.push(
        anchor
      );
    }

    for (
      const candidate of
      document.querySelectorAll(
        'a[href*="/posts/"]'
      )
    ) {
      if (
        candidate !==
        anchor
      ) {
        candidates.push(
          candidate
        );
      }
    }

    for (
      const candidate of
      candidates
    ) {
      if (
        !candidate ||
        !candidate.isConnected ||
        !hibV233SameSankakuPost(
          candidate.href,
          originalUrl
        )
      ) {
        continue;
      }

      if (
        hibV233AnchorHasCrosshair(
          candidate
        )
      ) {
        return candidate;
      }
    }

    return null;
  }

  function hibV233NativePreviewSucceeded(
    anchor,
    originalUrl
  ) {
    if (
      hibV233IsSankakuPostUrl(
        originalUrl
      )
    ) {
      const signalAnchor =
        hibV233FindLiveSankakuNativeSignal(
          anchor,
          originalUrl
        );

      if (!signalAnchor) {
        return false;
      }

      hibV229NativeSuccessUrls.add(
        originalUrl
      );

      console.log(
        "[HIB v2.1.5 generic] SANKAKU NATIVE SIGNAL - resolver not needed:",
        originalUrl
      );

      return true;
    }

    return hibV229NativePreviewSucceeded(
      originalUrl
    );
  }
  /*
 * HIB-V234-IMAGUS-LOADER-STATE
 *
 * Sankaku native-first handling now follows Imagus Reborn's own loader
 * state instead of inferring success from elapsed time or crosshair state.
 *
 * Imagus Reborn 2026.9.27 palette:
 *
 *   load   = rgb(255, 255, 255)  - normal media load
 *   R_load = rgb(255, 204, 204)  - resolver load
 *   res    = rgb(222, 255, 205)  - resolver processing
 *   R_res  = rgb(255, 234, 128)  - resolver/iffy processing
 *   R_js   = rgb(200, 200, 200)  - JavaScript resolver failure/stall
 *
 * Important:
 *
 * The loader is global to Imagus. A GRAY loader from the previous tile may
 * still be fading out when the pointer enters another post. Therefore GRAY
 * is accepted as a failure signal only after the loader has reset/faded or
 * the current attempt has produced fresh loader activity.
 */

function hibV234FindInOpenRoots(
  root,
  selector,
  seen
) {
  if (
    !root
  ) {
    return null;
  }

  const visited =
    seen ||
    new Set();

  if (
    visited.has(
      root
    )
  ) {
    return null;
  }

  visited.add(
    root
  );

  try {
    const direct =
      root.querySelector &&
      root.querySelector(
        selector
      );

    if (direct) {
      return direct;
    }
  }
  catch (error) {}

  let nodes =
    [];

  try {
    nodes =
      root.querySelectorAll
        ? root.querySelectorAll("*")
        : [];
  }
  catch (error) {
    nodes =
      [];
  }

  for (
    const node of
    nodes
  ) {
    if (
      !node ||
      !node.shadowRoot
    ) {
      continue;
    }

    const nested =
      hibV234FindInOpenRoots(
        node.shadowRoot,
        selector,
        visited
      );

    if (nested) {
      return nested;
    }
  }

  return null;
}

function hibV234ReadImagusLoaderState() {
  const loader =
    hibV234FindInOpenRoots(
      document,
      "#imagus-loader"
    );

  if (!loader) {
    return {
      found:
        false,

      active:
        false,

      reset:
        true,

      color:
        "",

      state:
        "missing",

      display:
        "",

      opacity:
        0
    };
  }

  let style =
    null;

  try {
    style =
      getComputedStyle(
        loader
      );
  }
  catch (error) {}

  const display =
    style
      ? String(
          style.display ||
          ""
        )
      : String(
          loader.style.display ||
          ""
        );

  const visibility =
    style
      ? String(
          style.visibility ||
          ""
        )
      : "";

  const opacityRaw =
    style
      ? parseFloat(
          style.opacity
        )
      : parseFloat(
          loader.style.opacity
        );

  const opacity =
    Number.isFinite(
      opacityRaw
    )
      ? opacityRaw
      : 1;

  const color =
    String(
      (
        style &&
        style.backgroundColor
      ) ||
      loader.style.backgroundColor ||
      ""
    ).replace(
      /\s+/g,
      " "
    ).trim();

  let state =
    "other";

  if (
    color ===
      "rgb(255, 255, 255)"
  ) {
    state =
      "load";
  }
  else if (
    color ===
      "rgb(255, 204, 204)"
  ) {
    state =
      "R_load";
  }
  else if (
    color ===
      "rgb(222, 255, 205)"
  ) {
    state =
      "res";
  }
  else if (
    color ===
      "rgb(255, 234, 128)"
  ) {
    state =
      "R_res";
  }
  else if (
    color ===
      "rgb(200, 200, 200)"
  ) {
    state =
      "R_js";
  }

  const active =
    display !==
      "none" &&
    visibility !==
      "hidden";

  const reset =
    display ===
      "none" ||
    opacity <=
      0.05;

  return {
    found:
      true,

    active,

    reset,

    color,

    state,

    display,

    opacity
  };
}

async function hibV234WaitForSankakuImagus(
  anchor,
  originalUrl,
  reason
) {
  const requireHover =
    !/^(?:contextmenu|right-click)/.test(reason);

  const started =
    Date.now();

  /*
   * Normal detection window.
   *
   * If Imagus shows actual activity, allow it considerably longer because
   * R_res/yellow is explicitly a slow/iffy native resolver state.
   */
  const initialDeadline =
    started +
    hibV222NativeGraceMs;

  const activeDeadline =
    started +
    15000;

  let deadline =
    initialDeadline;

  let sawReset =
    false;

  let sawCurrentActivity =
    false;

  let lastState =
    "";

  let lastColor =
    "";

  const initial =
    hibV234ReadImagusLoaderState();

  /*
   * Hidden loader or almost-zero opacity means previous Imagus state is no
   * longer active and a subsequent visible state belongs to a fresh attempt.
   */
  if (
    initial.reset
  ) {
    sawReset =
      true;
  }

  while (
    Date.now() <
      deadline
  ) {
    const loader =
      hibV234ReadImagusLoaderState();

    if (
      loader.reset
    ) {
      sawReset =
        true;
    }

    if (
      loader.state !==
        lastState ||
      loader.color !==
        lastColor
    ) {
      console.debug(
        "[HIB v2.1.5 generic] IMAGUS STATE:",
        {
          originalUrl,
          state:
            loader.state,
          color:
            loader.color,
          display:
            loader.display,
          opacity:
            loader.opacity,
          active:
            loader.active,
          resetSeen:
            sawReset
        }
      );

      lastState =
        loader.state;

      lastColor =
        loader.color;
    }

    /*
     * A visible WHITE/GREEN/YELLOW/PINK loader is fresh Imagus activity.
     *
     * Once seen, extend the wait window so a legitimate slow native resolver
     * is not preempted by HIB merely because it exceeded 2.5 seconds.
     */
    if (
      loader.active &&
      (
        loader.state ===
          "load" ||
        loader.state ===
          "R_load" ||
        loader.state ===
          "res" ||
        loader.state ===
          "R_res"
      )
    ) {
      sawCurrentActivity =
        true;

      sawReset =
        true;

      deadline =
        activeDeadline;
    }

    /*
     * R_js / GRAY is the Imagus JavaScript-resolver failure state.
     *
     * Do not react to stale GRAY left behind by the previous post. It must
     * occur after a reset or after fresh activity from this attempt.
     */
    if (
      loader.active &&
      loader.state ===
        "R_js" &&
      (
        sawReset ||
        sawCurrentActivity
      ) &&
      loader.opacity >
        0.10
    ) {
      console.log(
        "[HIB v2.1.5 generic] IMAGUS GRAY / R_js - HIB fallback permitted:",
        originalUrl
      );

      return {
        handled:
          false,

        reason:
          "imagus-r-js"
      };
    }

    /*
     * For normal hover, leaving the post means there is no reason for HIB to
     * open a resolver tab. This preserves the existing hover-cancel behavior.
     */
    if (
      requireHover &&
      !hibV222AnchorStillHovered(
        anchor
      )
    ) {
      console.log(
        "[HIB v2.1.5 generic] hover ended while Imagus owned attempt; resolver cancelled:",
        originalUrl
      );

      return {
        handled:
          true,

        reason:
          "hover-ended"
      };
    }

    /*
     * If Imagus had an active native/resolver attempt and has now returned
     * to a hidden/reset loader without ever reaching R_js, native handling
     * completed or was dismissed normally. HIB should stay out.
     *
     * Give it a small minimum age so the first fade frame is not mistaken for
     * immediate completion.
     */
    if (
      sawCurrentActivity &&
      loader.reset &&
      Date.now() - started >
        500
    ) {    /*
     * HIB-V244-DELAYED-RJS-WATCH
     *
     * Some Sankaku videos finish Imagus' visible resolver-processing phase,
     * briefly reset/hide the loader, and only then surface rule 617 / R_js.
     *
     * Fast native previews are NOT delayed visually. Imagus may open them
     * immediately as before. HIB simply keeps its observer alive for an
     * additional two seconds before declaring that fallback is unnecessary.
     *
     * If exact R_js appears during this settle window, allow the existing
     * v2.1.3 HIB fallback path to continue on this same hover.
     */
    {
      const hibV244DelayedRjsDeadline =
        Date.now() +
        2000;

      while (
        Date.now() <
          hibV244DelayedRjsDeadline
      ) {
        const hibV244Loader =
          hibV234ReadImagusLoaderState();

        if (
          hibV244Loader &&
          hibV244Loader.state ===
            "R_js"
        ) {
          console.log(
            "[HIB v2.1.5 generic] DELAYED GRAY / R_js - HIB fallback permitted:",
            originalUrl
          );

          return {
            handled:
              false,

            reason:
              "imagus-delayed-r-js"
          };
        }

        /*
         * Preserve the existing hover ownership rule. If the user really
         * leaves the tile, do not launch a resolver for an abandoned hover.
         */
        if (
          !/^(?:contextmenu|right-click)/.test(reason) &&
          !hibV222AnchorStillHovered(
            anchor
          )
        ) {
          console.log(
            "[HIB v2.1.5 generic] hover ended during delayed R_js watch; resolver cancelled:",
            originalUrl
          );

          return {
            handled:
              true,

            reason:
              "hover-ended-delayed-watch"
          };
        }

        await new Promise(
          resolve => {
            setTimeout(
              resolve,
              100
            );
          }
        );
      }
    }

      console.log(
        "[HIB v2.1.5 generic] IMAGUS native attempt completed without R_js - resolver not needed:",
        originalUrl
      );

      hibV229NativeSuccessUrls.add(
        originalUrl
      );

      return {
        handled:
          true,

        reason:
          "imagus-completed"
      };
    }

    await new Promise(
      resolve => {
        setTimeout(
          resolve,
          hibV222NativePollMs
        );
      }
    );
  }

  /*
   * If Imagus demonstrably took ownership but never produced R_js, do not
   * preempt a slow/yellow native request just because the extended watchdog
   * expired.
   */
  if (
    sawCurrentActivity
  ) {
    console.log(
      "[HIB v2.1.5 generic] IMAGUS remained active without R_js - resolver not needed:",
      originalUrl
    );

    return {
      handled:
        true,

      reason:
        "imagus-active-no-r-js"
    };
  }

  console.log(
    "[HIB v2.1.5 generic] no active Imagus loader state detected; HIB fallback permitted:",
    originalUrl
  );

  return {
    handled:
      false,

    reason:
      "imagus-no-active-state"
  };
}

async function hibV222WaitForNativePreview(
  anchor,
  originalUrl,
  reason
) {
  /*
   * Sankaku now uses Imagus Reborn's actual loader status rather than the
   * v2.1.3 media signature or v2.1.3/v2.1.3 crosshair heuristics.
   */
  if (
    hibV233IsSankakuPostUrl(
      originalUrl
    )
  ) {
    return hibV234WaitForSankakuImagus(
      anchor,
      originalUrl,
      reason
    );
  }

  /*
   * Preserve the existing non-Sankaku native-first behavior unchanged.
   */
  const requireHover =
    !/^(?:contextmenu|right-click)/.test(reason);

  const started =
    Date.now();

  while (
    Date.now() - started <
      hibV222NativeGraceMs
  ) {
    if (
      hibV229NativePreviewSucceeded(
        originalUrl
      )
    ) {
      console.log(
        "[HIB v2.1.5 generic] NATIVE SUCCESS - resolver not needed:",
        originalUrl
      );

      return {
        handled:
          true,

        reason:
          "imagus-popup-visible"
      };
    }

    if (
      requireHover &&
      !hibV222AnchorStillHovered(
        anchor
      )
    ) {
      console.log(
        "[HIB v2.1.5 generic] hover ended during native grace; resolver cancelled:",
        originalUrl
      );

      return {
        handled:
          true,

        reason:
          "hover-ended"
      };
    }

    await new Promise(
      resolve => {
        setTimeout(
          resolve,
          hibV222NativePollMs
        );
      }
    );
  }

  if (
    hibV229NativePreviewSucceeded(
      originalUrl
    )
  ) {
    console.log(
      "[HIB v2.1.5 generic] NATIVE SUCCESS at grace boundary - resolver not needed:",
      originalUrl
    );

    return {
      handled:
        true,

      reason:
        "imagus-popup-visible"
    };
  }

  console.log(
    "[HIB v2.1.5 generic] no native preview after grace; FALLBACK resolver permitted:",
    originalUrl
  );

  return {
    handled:
      false,

    reason:
      "native-preview-not-found"
  };
}
  function verifyImage(
    url,
    timeoutMs
  ) {
    return new Promise(
      resolve => {
        const image =
          new Image();

        let complete =
          false;

        const finish =
          result => {
            if (complete) {
              return;
            }

            complete =
              true;

            clearTimeout(
              timer
            );

            image.onload =
              null;

            image.onerror =
              null;

            resolve(
              result
            );
          };

        const timer =
          setTimeout(
            () => {
              finish({
                ok:
                  false,

                reason:
                  "timeout"
              });
            },
            timeoutMs
          );

        image.onload =
          () => {
            const width =
              image.naturalWidth ||
              0;

            const height =
              image.naturalHeight ||
              0;

            finish({
              ok:
                width > 0 &&
                height > 0,

              width,

              height
            });
          };

        image.onerror =
          () => {
            finish({
              ok:
                false,

              reason:
                "load-error"
            });
          };

        image.src =
          url;
      }
    );
  }

  async function resolveGeneric(
    anchor,
    originalUrl,
    reason
  ) {
    if (
      !anchor ||
      !anchor.isConnected
    ) {
      return;
    }

    /*
     * If another specialized resolver already replaced/repointed this
     * element, there is nothing left for the fallback to do.
     */
    if (
      anchor.href !==
        originalUrl
    ) {
      return;
    }

    if (
      anchor.dataset.hibV2Ready ===
        "1" ||
      anchor.dataset.hibV2XxPicsReady ===
        "1" ||
      anchor.dataset.hibV2ImgPvReady ===
        "1" ||
      anchor.dataset.hibV2ChainReady ===
        "1"
    ) {
      return;
    }

    const key =
      "generic:" +
      originalUrl;

    const existing =
      states.get(
        key
      );

    if (
      existing === "resolving" ||
      existing === "resolved"
    ) {
      return;
    }

    /*
     * HIB v2.1.3:
     *
     * Do NOT commit to HIB resolution yet.
     *
     * Let Imagus inspect the untouched original wrapper first.
     */
    const nativeResult =
      await hibV222WaitForNativePreview(
        anchor,
        originalUrl,
        reason
      );

    if (
      nativeResult &&
      nativeResult.handled
    ) {
      /*
       * No HIB state, spinner, tab or rewrite was created.
       *
       * A later hover can test again if necessary.
       */
      return;
    }

    /*
     * HIB-V281-SHARED-CONFIRMED-FAILURE-GUARD
     *
     * The generic resolver is a recovery mechanism, not an
     * automatic response to every hover.
     *
     * Require a failure detected by the Imagus loader observer.
     * Missing, white, pink, green and yellow loader states
     * are not sufficient reasons to open a resolver tab.
     */
    const hibV281Reason =
      nativeResult && nativeResult.reason
        ? nativeResult.reason
        : '';

    const hibV281ConfirmedFailure =
      hibV281Reason === 'imagus-r-js' ||
      hibV281Reason === 'imagus-delayed-r-js';

    /*
     * HIB-V3021-NO-PREVIEW-FALLBACK
     *
     * hibV222WaitForNativePreview() answers "native-preview-not-found" when
     * the whole native grace period passed (the pointer stayed on the link, or
     * the user right-clicked) and Imagus showed nothing. Imagus never
     * recognised such a link, so no R_js failure will ever be reported and the
     * link could never reach the HIB resolver.
     *
     * That answer now also permits the fallback, but only
     *   - for links that came through the unknown-wrapper path (the known
     *     DLsite / IMGPV / xxpics / ouo paths and the Sankaku path keep their
     *     existing rules),
     *   - when the address is not in the "no media found" memory (see
     *     hibV3021MayProbe).
     * A visible native preview and a hover that ended still return before this
     * point, and nothing is rewritten unless the resolved media is verified.
     */
    const hibV3021ViaNoPreview =
      !hibV281ConfirmedFailure &&
      hibV281Reason === 'native-preview-not-found' &&
      /-unknown-wrapper$/.test(reason) &&
      hibV3021MayProbe(originalUrl);

    if (
      !hibV281ConfirmedFailure &&
      !hibV3021ViaNoPreview
    ) {
      console.debug(
        '[HIB v2.1.5 generic] FALLBACK SKIPPED:',
        JSON.stringify({
          reason: hibV281Reason || 'no-confirmed-failure',
          confirmedFailure: false
        })
      );

      return;
    }

    console.log(
      hibV3021ViaNoPreview
        ? '[HIB v3.0.2.1 generic] NO NATIVE PREVIEW AFTER GRACE - bounded fallback permitted:'
        : '[HIB v2.1.5 generic] CONFIRMED IMAGUS FAILURE:',
      JSON.stringify({
        reason: hibV281Reason,
        fallbackPermitted: true
      })
    );

    /*
     * Native handling reported confirmed failure.
     * NOW HIB becomes the fallback resolver.
     */
    states.set(
      key,
      "resolving"
    );

    /*
     * A direct playable media URL is already terminal.
     * Do not send it through generic resolution again.
     */
    if (
      hibV226IsDirectMediaUrl(
        originalUrl
      )
    ) {
      states.set(
        key,
        "resolved"
      );

      removeSpinner(
        key
      );

      console.log(
        "[HIB v2.1.5 generic] DIRECT MEDIA TERMINAL:",
        originalUrl
      );

      return;
    }

    /*
     * HIB-V237-SANKAKU-CLEAN-VISUALS
     *
     * Sankaku already exposes Imagus Reborn's loader state. When R_js/gray
     * hands control to HIB, resolution remains invisible.
     *
     * Other generic wrapper sites retain their existing HIB spinner.
     */
    if (
      !hibV233IsSankakuPostUrl(
        originalUrl
      )
    ) {
      showSpinner(
        anchor,
        key
      );
    }
    else {
      console.log(
        "[HIB v2.1.5 generic] Sankaku fallback resolving invisibly:",
        originalUrl
      );
    }

    hibV228MarkAnchorResolving(
      anchor,
      originalUrl
    );

    console.log(
      "[HIB v2.1.5 generic] RESOLVING:",
      originalUrl
    );

    console.log(
      "[HIB v2.1.5 generic] FALLBACK START:",
      reason,
      originalUrl
    );

    let result;

    try {
      result =
        await browser.runtime.sendMessage({
          type:
            "hib-v2-resolve-generic",

          pageUrl:
            originalUrl
        });
    }
    catch (error) {
      states.delete(
        key
      );

      removeSpinner(
        key
      );

      console.warn(
        "[HIB v2.1.5 generic] message failed:",
        String(error)
      );

      return;
    }

    if (
      !result ||
      !result.ok ||
      !result.fullUrl
    ) {
      states.delete(
        key
      );

      removeSpinner(
        key
      );

      if (
        hibV3021ViaNoPreview
      ) {
        hibV3021NoteMiss(
          originalUrl
        );
      }

      console.warn(
        "[HIB v2.1.5 generic] no verified candidate; original link untouched:",
        originalUrl,
        result && result.error
          ? result.error
          : "unknown error"
      );

      return;
    }

    const isDirectMedia =
      hibV226IsDirectMediaUrl(
        result.fullUrl
      );

    if (
      isDirectMedia
    ) {
      result.fullUrl =
        hibV227CleanMediaUrl(
          result.fullUrl
        );
    }

    /*
     * HIB-V3023-IMAGE-ONLY-NO-PREVIEW-PATH
     * The no-native-preview fallback was added for picture wrappers. If it
     * comes back with a video/audio file, it is not a picture wrapper (or
     * the page's own advert clip was chosen): leave the link untouched.
     */
    if (
      hibV3021ViaNoPreview &&
      isDirectMedia
    ) {
      states.delete(
        key
      );

      removeSpinner(
        key
      );

      hibV3021NoteMiss(
        originalUrl
      );

      console.warn(
        "[HIB v3.0.2.3 generic] video/audio result ignored for a picture wrapper; link untouched:",
        result.fullUrl
      );

      return;
    }

    const verification =
      isDirectMedia
        ? await hibV226VerifyMedia(
            result.fullUrl,
            12000
          )
        : await verifyImage(
            result.fullUrl,
            12000
          );

    if (
      !verification ||
      !verification.ok
    ) {
      states.delete(
        key
      );

      removeSpinner(
        key
      );

      if (
        hibV3021ViaNoPreview
      ) {
        hibV3021NoteMiss(
          originalUrl
        );
      }

      console.warn(
        "[HIB v2.1.5 generic] candidate failed browser media verification:",
        result.fullUrl,
        verification
      );

      return;
    }

    if (
      hibV3021ViaNoPreview
    ) {
      hibV3021NoteHit(
        originalUrl
      );
    }

    /*
     * Re-find all exact copies of the original wrapper URL.
     */
    const matching =
      [];

    for (
      const candidate of
      document.querySelectorAll(
        "a[href]"
      )
    ) {
      if (
        candidate.href ===
        originalUrl
      ) {
        matching.push(
          candidate
        );
      }
    }

    let replaced =
      0;

    for (
      const oldAnchor of
      matching
    ) {
      oldAnchor.dataset.tihOriginalHref =
        originalUrl;

      oldAnchor.dataset.tihFullImage =
        result.fullUrl;

      oldAnchor.dataset.hibV2GenericState =
        "resolved";

      oldAnchor.dataset.hibV2GenericReady =
        "1";

      /*
       * Install only after browser-level image verification succeeds.
       */
      oldAnchor.href =
        result.fullUrl;

      const oldImg =
        oldAnchor.querySelector(
          "img"
        );

      const freshAnchor =
        oldAnchor.cloneNode(
          true
        );

      freshAnchor.href =
        result.fullUrl;

      freshAnchor.dataset.tihOriginalHref =
        originalUrl;

      freshAnchor.dataset.tihFullImage =
        result.fullUrl;

      freshAnchor.dataset.hibV2GenericState =
        "resolved";

      freshAnchor.dataset.hibV2GenericReady =
        "1";

      if (oldImg) {
        const cloned =
          freshAnchor.querySelector(
            "img"
          );

        if (cloned) {
          const freshImg =
            oldImg.cloneNode(
              true
            );

          freshImg.dataset.tihFullImage =
            result.fullUrl;

          cloned.replaceWith(
            freshImg
          );
        }
      }

      oldAnchor.replaceWith(
        freshAnchor
      );

      replaced +=
        1;
    }

    /*
     * HIB-V225-SANKAKU-SPA-HANDOFF
     *
     * Sankaku is React-driven and can replace the freshly rewritten
     * anchor immediately after HIB resolves it. The generic resolver
     * has already verified result.fullUrl at this point.
     *
     * For direct playable media on an exact Sankaku /posts/<id> link:
     *
     * - keep the handoff alive briefly
     * - reapply the verified media URL if React recreates the anchor
     * - preserve the original post URL in metadata
     * - give each live replacement node one Imagus mouseover re-arm
     *
     * This is intentionally Sankaku + direct-media only.
     */
    if (
      isDirectMedia
    ) {
      let hibV225SankakuPost =
        false;

      try {
        const hibV225Original =
          new URL(
            originalUrl
          );

        hibV225SankakuPost =
          /(^|\.)sankakucomplex\.com$/i.test(
            hibV225Original.hostname
          ) &&
          /^\/posts\/[^/]+\/?$/i.test(
            hibV225Original.pathname
          );
      }
      catch (error) {
        hibV225SankakuPost =
          false;
      }

      if (
        hibV225SankakuPost
      ) {
        const hibV225Until =
          Date.now() +
          1500;

        const hibV225Rearmed =
          new WeakSet();

        const hibV225Pulse =
          () => {
            let liveAnchor =
              null;

            for (
              const candidate of
              document.querySelectorAll(
                "a[href],a[data-tih-original-href]"
              )
            ) {
              const remembered =
                candidate.dataset
                  ? candidate.dataset.tihOriginalHref
                  : "";

              if (
                candidate.href ===
                  originalUrl ||
                remembered ===
                  originalUrl ||
                candidate.href ===
                  result.fullUrl
              ) {
                liveAnchor =
                  candidate;

                break;
              }
            }

            if (
              liveAnchor
            ) {
              liveAnchor.dataset.tihOriginalHref =
                originalUrl;

              liveAnchor.dataset.tihFullImage =
                result.fullUrl;

              liveAnchor.dataset.hibV2GenericState =
                "resolved";

              liveAnchor.dataset.hibV2GenericReady =
                "1";

              liveAnchor.href =
                result.fullUrl;

              const liveImage =
                liveAnchor.querySelector(
                  "img"
                );

              if (
                liveImage
              ) {
                liveImage.dataset.tihFullImage =
                  result.fullUrl;
              }

              if (
                !hibV225Rearmed.has(
                  liveAnchor
                ) &&
                liveAnchor.matches(
                  ":hover"
                )
              ) {
                hibV225Rearmed.add(
                  liveAnchor
                );

                liveAnchor.dispatchEvent(
                  new MouseEvent(
                    "mouseover",
                    {
                      bubbles:
                        true,

                      cancelable:
                        true,

                      view:
                        window
                    }
                  )
                );

                console.log(
                  "[HIB v2.1.5 generic] HOVERED MEDIA HANDOFF:",
                  result.fullUrl
                );
              }
            }

            if (
              Date.now() <
              hibV225Until
            ) {
              setTimeout(
                hibV225Pulse,
                75
              );
            }
          };

        hibV225Pulse();
      }
    }

    states.set(
      key,
      "resolved"
    );

    hibV228MarkReady(
      originalUrl,
      result.fullUrl
    );

    /*
     * HIB-V3024-SPINNER-STOP
     * hibV228MarkReady() only finds anchors whose original address still
     * equals the wrapper URL. The anchor was just replaced by a copy that
     * already points at the picture, so the spinner next to it was never
     * removed. Remove it by key and by the resolved anchor's metadata.
     */
    removeSpinner(
      key
    );

    hibV221SweepResolvedSpinners(
      originalUrl,
      result.fullUrl
    );

    console.log(
      "[HIB v2.1.5 generic] ACTUAL MEDIA READY:",
      {
        originalUrl,

        fullUrl:
          result.fullUrl,

        source:
          result.source,

        score:
          result.score,

        chain:
          result.chain,

        width:
          verification.width,

        height:
          verification.height,

        replacedAnchors:
          replaced
      }
    );
  }

  function scheduleKnownFallback(
    anchor,
    url,
    kind
  ) {
    if (
      scheduled.has(
        anchor
      )
    ) {
      return;
    }

    scheduled.add(
      anchor
    );

    console.log(
      "[HIB v2.1.5 generic] fallback armed:",
      kind,
      "8000ms",
      url
    );

    setTimeout(
      () => {
        /*
         * The original DOM node being gone means the specialized resolver
         * already succeeded and re-armed/replaced it.
         */
        if (
          !anchor.isConnected
        ) {
          return;
        }

        if (
          anchor.href !==
            url
        ) {
          return;
        }

        resolveGeneric(
          anchor,
          url,
          kind +
            "-timeout-fallback"
        );
      },
      8000
    );
  }

  function handle(
    event,
    reason
  ) {
    const anchor =
      findAnchor(
        event.target
      );

    if (
      !anchor ||
      !anchor.href
    ) {
      return;
    }

    const url =
      normalizeHttp(
        anchor.href
      );

    if (
      !url ||
      directImage(
        url
      )
    ) {
      return;
    }

    /*
     * HIB-V215-SUKEBEI-INTERNAL-HANDLE-GUARD
     *
     * Defense in depth: generic resolution must never process a
     * Sukebei navigation link, even if wrapper heuristics change later.
     */
    if (
      hostOf(
        url
      ) ===
        location.hostname.toLowerCase()
    ) {
      return;
    }

    const known =
      knownKind(
        url
      );

    /*
     * Never generic-fallback DLsite. Its gallery path is intentionally
     * specialized and a single-image generic result would be a downgrade.
     */
    if (
      known === "dlsite"
    ) {
      return;
    }

    /*
     * Known single-image paths get first chance to finish normally.
     */
    if (
      known === "xxpics" ||
      known === "imgpv" ||
      known === "ouo"
    ) {
      scheduleKnownFallback(
        anchor,
        url,
        known
      );

      return;
    }

    /*
     * Unknown hosts only enter generic resolution when the link actually
     * looks like an image wrapper.
     */
    if (
      !wrapperLooking(
        anchor
      )
    ) {
      return;
    }

    resolveGeneric(
      anchor,
      url,
      reason +
        "-unknown-wrapper"
    );
  }

  document.addEventListener(
    "pointerover",
    event => {
      const anchor =
        findAnchor(
          event.target
        );

      if (!anchor) {
        return;
      }

      const from =
        event.relatedTarget;

      if (
        from instanceof Node &&
        anchor.contains(
          from
        )
      ) {
        return;
      }

      handle(
        event,
        "hover"
      );
    },
    true
  );

  document.addEventListener(
    "contextmenu",
    event => {
      handle(
        event,
        "right-click"
      );
    },
    true
  );

  console.log(
    "[HIB v2.1.5 generic] fallback handler loaded"
  );
})();

/* ===== END IMAGE SECTION - hib_img_content.js ===== */
