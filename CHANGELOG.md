# Changelog

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
