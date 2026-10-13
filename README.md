# Host Imagus Bridge (HIB) v2.1.0

<p>
  <a href="https://github.com/molitar/host-imagus-bridge/releases/latest"><img src="https://img.shields.io/github/v/release/molitar/host-imagus-bridge?label=release&color=blue" alt="Release"></a>
  <a href="https://github.com/molitar/host-imagus-bridge/releases"><img src="https://img.shields.io/github/v/release/molitar/host-imagus-bridge?include_prereleases&label=preview&color=orange" alt="Preview"></a>
  <a href="https://github.com/molitar/host-imagus-bridge/blob/main/LICENSE"><img src="https://img.shields.io/github/license/molitar/host-imagus-bridge?color=orange" alt="License"></a>
  <a href="https://github.com/molitar/host-imagus-bridge/releases"><img src="https://img.shields.io/github/downloads/molitar/host-imagus-bridge/total?color=green" alt="Downloads"></a>
</p>

**A smarter media preview companion for Firefox and Imagus Reborn.**

Host Imagus Bridge (HIB) is a Firefox extension designed to make image galleries and video previews work on websites where **Imagus Reborn** cannot reliably access the original media.

Many websites use intermediate pages, JavaScript-based viewers, redirects, embedded video players, or image-hosting services that make it difficult for Imagus Reborn to retrieve the actual image or video.

**HIB bridges that gap.**

Instead of replacing Imagus Reborn, HIB works alongside it, helping resolve media that would otherwise fail to preview.

## What does Host Imagus Bridge actually do?

Imagine visiting a website containing links to an image gallery, an externally hosted picture, or a video.

Normally, Imagus Reborn attempts to retrieve and display the media using its built-in or custom Sieves.

However, some websites make this difficult:

- The image is behind an intermediate hosting page.
- A gallery contains multiple images that aren't directly exposed.
- A video uses an embedded player or streaming playlist.
- The host requires JavaScript to load before the actual media URL becomes available.
- A website changes how its images or videos are delivered, breaking existing preview rules.

HIB provides additional site-specific resolution capabilities to help retrieve the underlying media.

**The goal is simple: access more media previews directly from the original page, without manually opening every link.**

## Works alongside Imagus Reborn

One of HIB's most important features is its **Imagus-first approach**.

HIB is not intended to take over media previews that Imagus already handles correctly.

The workflow is:

1. Imagus Reborn receives the user's normal preview interaction.
2. Imagus attempts to display the media using its existing Sieves.
3. If Imagus successfully handles the preview, HIB stays out of the way.
4. If Imagus reaches a confirmed unsupported or failed resolver state, HIB can activate an appropriate fallback for supported sites.
5. The user receives a preview without needing to manually navigate through the hosting website.

This means users can continue using their existing Imagus Reborn settings and custom Sieves.

For example, if you have a working custom DLsite Sieve, Imagus can use it normally. If no working Sieve is available, HIB can provide its own gallery fallback.

**Existing working Sieves take priority over unnecessary fallback handling.**

## Native image gallery support

HIB v2.1.0 includes a native image gallery viewer.

This is particularly useful for websites where a single link points to a product page or gallery containing multiple images rather than one directly accessible picture.

For supported galleries, HIB can:

- Resolve the underlying image URLs.
- Assemble multiple images into a navigable gallery.
- Display images without opening the original hosting page manually.
- Provide previous and next navigation.
- Display the current image number and total image count.
- Close the gallery using Escape or its close button.
- Apply configurable gallery display-size limits while preserving aspect ratio.

The native gallery is a fallback, not a replacement for working Imagus gallery Sieves.

### Automatic fallback from Imagus failures

A major improvement in v2.1.0 is integration with Imagus Reborn's loading indicator.

Imagus uses different loader states while processing media. HIB can recognize a confirmed gray JavaScript resolver failure (`R_js`) and, when supported gallery images have already been resolved, open its own viewer.

HIB also dismisses the remaining gray loading indicator when its gallery takes over.

This avoids leaving the user with an indefinitely spinning preview indicator.

## Video preview support

HIB also supports site-specific video resolution.

Some websites deliver videos through embedded players rather than direct video URLs. HIB can help locate playable media and hand it off to the preview workflow.

Depending on the supported host, this may involve:

- Resolving embedded video-player pages.
- Identifying streaming media or playable sources.
- Working with playlist-based video delivery.
- Handling associated subtitles.
- Converting compatible subtitle formats for browser playback.

HIB has been developed and tested with AnimeID and NHPlayer-related workflows, including subtitle handling.

Actual video preview behavior depends on the host, browser capabilities, and Imagus Reborn integration.

## Supported website integrations

HIB uses dedicated handling for certain websites and hosting services, together with a more general fallback mechanism where applicable.

Development and testing have included:

| Website or service | HIB functionality |
|---|---|
| **DLsite** | Resolves product preview images and supports native multi-image galleries |
| **Sukebei** | Supports resolving eligible external media links on torrent detail pages |
| **Sankaku** | Uses native Imagus handling first, with fallback after confirmed resolver failure |
| **AnimeID** | Video-source resolution, preview handoff, and subtitle integration |
| **NHPlayer** | Embedded video resolution |
| **OUO** | Redirect and intermediate image-host resolution |
| **TurboImageHost** | Image-host resolution through supported intermediate-page workflows |
| **XXPICS** | Full-size image resolution |
| **Other supported hosts** | Host-dependent resolution and fallback behavior |

Support is not universal. A website may still fail because of authentication requirements, anti-bot protections, changed page structures, inaccessible media, or unsupported delivery methods.

## Preview activation follows Imagus

HIB's native fallback is intended to follow an actual Imagus preview attempt instead of imposing an unrelated activation method.

For example:

**If Imagus is configured for hover previews**, hovering can start the preview attempt and the corresponding HIB fallback.

**If Imagus is configured for right-click activation**, the fallback responds to the resulting Imagus failure state rather than simply opening its gallery whenever a link is hovered.

HIB does not require users to replace their Imagus preview preferences with a different set of gallery controls.

## Media display sizing

Version 2.1.0 introduces gallery sizing preferences with these choices:

- Automatic — fit the available screen
- 960 × 540 — compact viewing, useful on 1280-wide displays
- 1280 × 720 — HD
- 1920 × 1080 — Full HD
- 2560 × 1440 — QHD
- 3840 × 2160 — 4K
- Custom width and height

Images retain their aspect ratio and are constrained to the available browser viewport.

Video display sizing preferences are also included, although applying them to Imagus-managed video previews requires additional integration.

## Site controls and configuration

HIB includes a Firefox toolbar popup for managing supported-site behavior.

The extension has site enable/disable controls and media settings, allowing supported workflows to be configured without editing scripts manually.

Development-only diagnostic controls have been removed from the v2.1.0 popup to keep the interface focused on ordinary use.

## Does HIB replace Imagus Reborn?

**No.**

Imagus Reborn remains the primary preview extension.

HIB is an additional compatibility and resolution layer for media sources Imagus cannot handle on its own.

The two serve complementary purposes:

| Imagus Reborn | Host Imagus Bridge |
|---|---|
| General-purpose media preview engine | Site-specific media resolver and fallback companion |
| Uses built-in and custom Sieves | Extracts supported media from difficult hosts |
| Provides established preview controls | Adds a native gallery when the Imagus preview fails |
| Controls normal preview activation | Observes confirmed failure states for supported integrations |
| Handles working previews normally | Avoids interfering with successful Imagus previews |

Users can continue adding or maintaining custom Imagus Sieves. HIB can complement them rather than make them obsolete.

## Do users need PowerShell or additional software?

**No PowerShell script is required for normal HIB operation.**

PowerShell was used during development for source updates, backups, and testing. It is not part of the extension's runtime requirements.

The extension is packaged as a Firefox `.xpi`.

For public release, the extension must go through the appropriate Mozilla signing and review process. Unsigned development builds are intended for temporary testing in compatible Firefox environments.

## What's new in v2.1.0?

Version 2.1.0 represents a major improvement in how HIB integrates with Imagus Reborn.

Major highlights include:

- **Imagus-first handling:** Existing successful Sieves are respected.
- **Gray-spinner fallback:** HIB can recognize a confirmed Imagus JavaScript resolver failure.
- **Native gallery:** Multiple resolved images can be browsed directly without a custom Sieve.
- **Spinner dismissal:** Imagus's failed loading indicator is dismissed when the HIB gallery takes over.
- **Improved DLsite integration:** Product preview images are resolved and assembled into navigable galleries.
- **Video and subtitle workflows:** Continued support for embedded video resolution and subtitle handoff.
- **Configurable media preferences:** New gallery display-size settings and saved video size preferences.
- **Cleaner popup:** Obsolete development diagnostic controls removed.
- **Cleaner release packaging:** Development backups and installer scripts excluded from the distributable extension.

## Who is Host Imagus Bridge for?

HIB is particularly useful for:

- Imagus Reborn users who frequently encounter failed media previews.
- People who browse image-hosting websites and linked galleries.
- Users who want access to larger source images instead of thumbnails.
- Users who regularly encounter embedded videos or intermediate hosting pages.
- People who maintain custom Imagus Sieves but want additional fallback compatibility.
- Users who prefer viewing media without repeatedly opening new tabs.

## Current project status

**Version:** 2.1.0 release candidate  
**Platform:** Firefox / compatible Firefox-based environments  
**Integration:** Imagus Reborn companion  
**Distribution:** Firefox `.xpi`  
**Public Mozilla signing:** Pending

The previous v2.0.88 baseline was successfully tested on multiple DLsite pages, including Sieve-first operation and native gallery fallback with spinner dismissal.

The v2.1.0 release candidate has passed source syntax and package-integrity checks. Full runtime regression testing is still required before treating it as a production release.

## Installation

Download the latest `.xpi` from the [Releases](https://github.com/molitar/host-imagus-bridge/releases) page. Until Mozilla has signed a release, the file is an unsigned build: it installs in Firefox Developer Edition, Nightly or ESR with `xpinstall.signatures.required` set to `false`, or it can be loaded temporarily from `about:debugging`. Imagus Reborn must be installed for HIB to have anything to complement.

## Permissions

The extension asks for these permissions, and the manifest declares that it collects no data:

- **`tabs` and `storage`:** to resolve media in the background and to remember your site and size settings.
- **`webRequest` and `webRequestBlocking`:** to present the referrer the player page itself would send when a supported video host's files are requested, because those hosts otherwise refuse the request with HTTP 403.
- **Host access:** the supported sites listed above, plus access to all websites so media links on the pages you browse can be resolved.

## Source and releases

The extension is plain JavaScript with no build step: the `.xpi` is a zip of `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js` and `icons/`. The `sieves/` folder holds the custom Imagus Sieves that go with it. Releases are listed in [CHANGELOG.md](CHANGELOG.md).

## License

GNU General Public License version 3. See [LICENSE](LICENSE).

---

### In summary

**Host Imagus Bridge extends what Imagus Reborn can preview.**

When a website hides its media behind scripts, intermediate pages, galleries, or embedded players, HIB helps retrieve the underlying images or videos.

If Imagus can handle the media itself, HIB stays out of its way.

If Imagus encounters a supported failure, HIB can step in with additional resolution capabilities—including its own image gallery.

**More supported previews. Fewer broken links. Less manual browsing. Without replacing Imagus Reborn.**
