# Changelog

## 3.0.0 — major release (upgrades 2.1.5; same add-on ID, same name)

3.0.0 is a different class of add-on from 2.1.5. **2.1.5 opened pictures** (wrapped-image links) and left video to Imagus Reborn's player. **3.0.0 adds HIB's own video player, video scanning, styled subtitles and a full Tools page**, and keeps the picture features.

> Review before publishing. Items marked ✔ were checked while preparing this release (code, or run in Firefox with the release package); the rest come from the build history and the code.

---

### 1. Video — new

**Finding and opening videos**
* ✔ **Hover a card → ready mark → right-click**: HIB scans the page behind the card and marks it with a **−** when the video is verified. Right-click opens the HIB player on top of the page (no new tab). `Ctrl + Right Shift` does the same for the card under the pointer; `Ctrl + right-click` stays with Imagus Reborn.
* ✔ **Hover delay** setting, 1–10 seconds (toolbar popup).
* ✔ **Scan Site for Videos**: a video site is registered for good only after a real playback has been verified, so a wrong guess never sticks. Learned rules are kept per site (player type: plain HTML5/MP4, HLS, DASH, and the common player libraries).
* ✔ **Pick Card**: point at the cards HIB should treat as videos on a page it did not recognise.
* During a scan HIB can press a player's play button (or its "Continue watching?" prompt) to get the stream started, accepts a stream as soon as its manifest is verified, and re-uses what it learned for a known episode so the next open is fast.
* Hot-link protected hosts: HIB sends the right *Referer* for addresses it has already verified.

**The HIB player**
* ✔ Plays **MP4, HLS and DASH**; seek bar with buffered range, cache progress, volume with percentage, mute, full screen.
* ✔ **Keyboard**: space = play/pause, ← / → = jump (5, 10, 15, 20, 25 or 30 s — your choice), ↑ / ↓ = volume (step set in the title bar).
* ✔ **Resume**: HIB remembers where you stopped each episode.
* ✔ **Bar** slider: control-bar opacity.
* Video pieces are kept in **memory only** (one video at a time) and cleared when the player closes; nothing is saved to disk.
* ✔ Player title bar shows only the version number — no "TEST" wording in the release.

**Subtitles**
* ✔ **Styled ASS / SSA subtitles drawn with libass** (colours, fonts, sizes, positions, fades), plus **SRT and VTT**.
* ✔ HIB finds a video's subtitles from the files the page loads, the files the page itself lists, and the usual names next to the video file; every track found is offered with its language ("English (styled)", …).
* ✔ **CC** switches subtitles on/off; **A− / A+** change their size.
* ✔ **Default subtitle language** (toolbar popup): English, first available, off, or one of 15 other languages.
* Language detection reads file names and folders strictly, so a foreign-language track is no longer picked as English.
* Long subtitle lines are no longer split into three because the caption box was too narrow.
* ✔ **Fonts**: a default font (Figtree, SIL Open Font License) is bundled in the add-on; if the video page loads its own fonts, HIB hands those to the renderer too. HIB no longer asks any fixed website for a font.

### 2. Beta features (Tools → *Beta features*) — both **off by default**
* ✔ **Capture streams that have no direct address** — for pages such as Mega or Google Drive whose video has no address HIB can read directly. Turn it on, reload the video page, start the video, then right-click the card as usual. It acts only on sites you added. Ordinary MP4, HLS and DASH videos play the same with it on or off (tested). *Upgrading from an earlier test build: a value you already stored is kept.*
* ✔ **HEVC video support** — for HEVC (H.265) videos. Firefox plays them with a decoder already on your computer. With the option on, HIB checks for one and, if none is found, points you to the Microsoft Store ("HEVC Video Extensions"). HIB installs nothing.

### 3. Pictures (carried over from 2.1.5, reworked)
* Sites are **yours**: Manage Sites has an **Image** and a **Video** checkbox per site (2.1.5 shipped with a fixed list of site permissions).
* Picture links are resolved through one controlled queue (at most one HIB helper tab at a time; helper tabs that pages open are closed); a generic fallback resolver and an isolated resolver for link-shortener pages are included.
* The resolver no longer starves other requests, and the hover spinner no longer hangs on pages with many links.
* Gallery size (automatic fit, fit screen, original, custom) is set in Tools.
* The picture popup itself still comes from Imagus Reborn.
* ✔ **Wrapper pages that change their layout.** Resolvers keep their exact address pattern for a known host (fastest), and when that finds nothing they now fall back to a **shared picture finder** that reads the common signals on the page: the schema.org `ImageObject`, `og:image` / `twitter:image` / `image_src`, large images (including lazy-load and `srcset`), links to a picture, and picture addresses inside the page's own scripts. Thumbnails, logos, icons and banners are ignored and a picture is checked (image type, not tiny) before it is used. When a fallback is used, the log (and the Report Issue file) says **"LAYOUT CHANGED"**, so a site change is noticed. In a test on eight different wrapper layouts the generic resolver now finds the picture on all eight (it handled six before) and still rejects a page with no real picture; on the real imgpv pages the fallback alone also finds the picture. Applies to imgpv and to the generic (unknown-host) resolver; the ouo.io, xxpics and turboimg resolvers keep their exact patterns.

### 4. Tools and toolbar — new
* ✔ **Manage Sites**: the short list of sites HIB may act on, with a plain-language note on what HIB loads and what it does not.
* ✔ **Save / Restore Settings inside the toolbar**: dated backups kept as **bookmarks** in one HIB folder you choose (default *Other Bookmarks / Host Imagus Bridge Backups*). Restore lists only HIB backups, newest first, with the number of sites in each. No file chooser, no copy and paste; a backup survives reinstalling the add-on. Restoring removes a setting that the backup covers but did not contain, so an obsolete value cannot linger. HIB touches only bookmarks whose title starts with `HIB settings `.
* ✔ **Report Issue** and **Submit Request → Request Site / Request Feature**: open a pre-filled GitHub issue and save a diagnostic report on your computer for you to attach. Nothing is posted by HIB; address query parts are removed; cookies, logins and passwords are never collected.
* ✔ **Media display size** (gallery / video) and **Preferred source** (automatic, MP4, HLS).
* Developer diagnostics are hidden and off in the public build (unlock: click the Tools title five times or press Alt + Shift + D).

### 5. Permissions — what changed since 2.1.5 (Firefox may ask you to approve them when updating)

| | 2.1.5 | 3.0.0 |
|---|---|---|
| All-sites access | yes (`https://*/*`, `http://*/*` plus a fixed site list) | yes (`<all_urls>`); the page scripts act only on sites you added |
| tabs, storage, webRequest, webRequestBlocking | yes | yes |
| **bookmarks** | – | **new** — settings backup only (`HIB settings …` bookmarks) |
| **downloads** | – | **new** — only files you ask for (report file, settings backup, diagnostic capture) |
| **webNavigation** | – | **new** — close stray helper tabs |
| **cookies** | – | **new** — read a protected video's own cookie for its key; clear oversized link-shortener cookies |
| **activeTab, alarms, unlimitedStorage** | – | **new** — toolbar actions, in-memory cache timer, large settings |
| Data collection | – | declared *none* |

Not requested: management (other add-ons / themes), clipboard. Minimum Firefox: 115.

### 6. Privacy
* HIB works **only on the sites you add**. It sends nothing to its developer or to any server of its own; no tracking, analytics or account.
* The Mozilla build contains no remote code and no network request to a fixed font site.

### 7. Fixed since the last test builds
* ✔ The toolbar popup header showed "TEST" after the version number — removed.
* Subtitle language and caption-width issues (above).
* Several hover / resolve problems on picture pages (spinner hanging, link not found, helper tab not opening).
* ✔ **imgpv.com pages work again.** imgpv changed its wrapper pages in November 2026: the full picture is no longer a `/cgi-bin/dl.cgi/…` download link but `sN.imgpv.com/i/NNNNN/<id>.jpg`, named in the page's schema.org `ImageObject` (and `og:image`). HIB now reads that (both forms are accepted; `_t` thumbnails are never used) and no longer waits for the slow page to finish loading. Tested on three real imgpv links: each resolved in about 1 s; before, each failed after 20–60 s.
* ✔ **A picture host that is down no longer blocks everything else.** When HIB finds the host of a link is not answering (the red "site down" tag), it now stops that resolve at once, closes the helper tab it had opened for it, frees the single resolver slot, removes the spinner and leaves that host alone for a minute (queued requests for the same host open no tab at all), so you can open another image straight away. Before, the dead link held the slot for a full minute; in a test the next (working) link now answers in about 11 s instead of 60 s.

* **Manage Sites**: a site can no longer be left with neither Image nor Video ticked (that made its row vanish, so unticking Image first looked like "it unticks itself"); the page now explains it and says to tick the other box first. Quick consecutive clicks no longer draw the list twice.

### 8. Not in the Mozilla build
* The HEVC *software* decoder (WebAssembly lab and its lab pages): its source is not available, so only the computer's own decoder is used.
* "Play with HIB" (one-time takeover from the toolbar) has no button in this release; its code is not reachable from the interface.

### 9. Third-party code in the package
dash.js 4.7.4 (BSD-3), hls.js 1.7.3 (Apache-2.0), @jellyfin/libass-wasm 4.2.4 — official files (libass ISC, FreeType FTL, HarfBuzz MIT, FriBidi LGPL-2.1+, and others as listed by that package), Figtree font (SIL OFL 1.1).

## 2.1.5 - 2026-10-13

Polish for the built-in image gallery. This version is signed by Mozilla.

### Improved

- **Automatic gallery size now fills the window.** The gallery frame uses the available browser window (with a narrow margin) and the picture keeps its proportions, instead of shrinking to the image's own size. Preset sizes (960x540 up to 4K) and custom sizes work as before.
- **Previous / next arrows sit on top of the image** (semi-transparent, brighter on hover) instead of outside the frame, so they no longer need extra room on narrow windows. They have screen-reader labels ("Previous image", "Next image").
- Version labels in the extension's console messages now read 2.1.5.

## 2.1.0 - 2026-10-13

A major improvement in how Host Imagus Bridge works with Imagus Reborn. This is a release candidate: Mozilla signing is pending and full runtime regression testing is still required.

### Highlights

- **Imagus-first handling:** existing working Sieves are respected.
- **Gray-spinner fallback:** HIB recognises a confirmed Imagus JavaScript resolver failure (`R_js`) and, when supported gallery images are already resolved, opens its own viewer.
- **Native gallery:** multiple resolved images can be browsed directly, with previous/next, an image counter, and Escape or a close button, without needing a custom Sieve.
- **Spinner dismissal:** Imagus's failed loading indicator is dismissed when the HIB gallery takes over.
- **Improved DLsite integration:** product preview images are resolved and assembled into navigable galleries.
- **Video and subtitle workflows:** continued support for embedded video resolution (AnimeID, NHPlayer) and subtitle handoff.
- **Configurable media preferences:** new gallery display-size settings (automatic, 960x540 up to 4K, or custom) and saved video size preferences.
- **Cleaner popup:** obsolete development diagnostic controls removed.
- **Cleaner packaging:** development backups and installer scripts are no longer part of the distributable extension.

### Installation

Unsigned build: install in Firefox Developer Edition, Nightly or ESR with `xpinstall.signatures.required` set to `false`, or load temporarily from `about:debugging`. Imagus Reborn must be installed.
