"use strict";

(async () => {
  const mainView =
    document.getElementById("mainView");

  const sitesView =
    document.getElementById("sitesView");

  const siteNode =
    document.getElementById("site");

  const stateNode =
    document.getElementById("state");

  const toggle =
    document.getElementById("toggle");

  const sitesButton =
    document.getElementById("sitesButton");

  const sitesList =
    document.getElementById("sitesList");

  const manualSite =
    document.getElementById("manualSite");

  /* HIB-V273-POPUP-MEDIA-MODES */
  const hibV273ManualMode =
    document.getElementById("hibV273ManualMode");

  const manualAdd =
    document.getElementById("manualAdd");

  const sitesMessage =
    document.getElementById("sitesMessage");

  const backButton =
    document.getElementById("backButton");

  let activeTab =
    null;

  let currentSite =
    null;

  let currentEnabled =
    false;

  function normalizeSite(value) {
    let text =
      String(value || "")
        .trim()
        .toLowerCase();

    if (!text) {
      return null;
    }

    try {
      if (text.includes("://")) {
        text =
          new URL(text)
            .hostname
            .toLowerCase();
      }
      else {
        text =
          text
            .replace(/^\/+/, "")
            .split("/")[0]
            .split("?")[0]
            .split("#")[0]
            .replace(/:\d+$/, "");
      }
    }
    catch (error) {
      return null;
    }

    text =
      text.replace(
        /^\.+|\.+$/g,
        ""
      );

    if (
      !text ||
      !/^[a-z0-9.-]+$/i.test(text) ||
      text.includes("..")
    ) {
      return null;
    }

    return text;
  }

  /* RC136 / TEST SITE STATUS RESET
   * Remove only per-destination landing records and verified card/player hints
   * for the active host. Preserve permissions, registrations, media mode,
   * playback preferences and every other site's learned results.
   * A tab reload discards session-local hover results and visible badges.
   * This UI is intentionally temporary until the toolbar redesign.
   */
  const rc136Reset = document.getElementById("hibRc136ResetSite");
  rc136Reset.addEventListener("click", async () => {
    const site = currentSite;
    if (!site || !/^https?:/i.test(activeTab?.url || "")) return;
    const group = site.replace(/^www\./, "");
    const matchesHost = (value) => {
      try { return new URL(value).hostname.replace(/^www\./, "") === group; }
      catch (_) { return false; }
    };
    if (!confirm(`Reset all TEST detection results for ${site}?\n\nThis clears landing/video status and learned player/card rules for this site. It keeps site registration, permissions, and settings. Matching tabs will reload.`)) return;
    rc136Reset.disabled = true;
    try {
      const keys = ["hibRc122LandingPages", "hibRc133VerifiedSiteRules", "hibRc78VideoProfiles"];
      const old = await browser.storage.local.get(keys);
      // LANDING CLASSIFICATIONS: stored by complete destination URL.
      const landing = { ...(old.hibRc122LandingPages || {}) };
      for (const url of Object.keys(landing)) if (matchesHost(url) || String(landing[url]?.host || "").replace(/^www\./, "") === group) delete landing[url];
      // VERIFIED RULES & LEGACY PLAYER PROFILES: stored by site hostname.
      const rules = { ...(old.hibRc133VerifiedSiteRules || {}) };
      const profiles = { ...(old.hibRc78VideoProfiles || {}) };
      for (const db of [rules, profiles]) for (const hostname of Object.keys(db)) {
        if (hostname.replace(/^www\./, "") === group) delete db[hostname];
      }
      await browser.storage.local.set({
        hibRc122LandingPages: landing,
        hibRc133VerifiedSiteRules: rules,
        hibRc78VideoProfiles: profiles
      });
      // Session-only video/failed/unsupported/section-hint results are reset
      // by reloading matching website tabs. Do not reload other sites.
      const tabs = await browser.tabs.query({});
      const matching = tabs.filter(t => t.id != null && matchesHost(t.url || ""));
      await Promise.all(matching.map(t => browser.tabs.reload(t.id).catch(() => {})));
      stateNode.textContent = `TEST detection results reset for ${site}; ${matching.length} matching tab(s) reloaded.`;
    } catch (error) {
      stateNode.textContent = `Reset failed: ${String(error)}`;
    } finally {
      rc136Reset.disabled = false;
    await rc139LoadControls();
    }
  });

  /* RC139 / TEMPORARY TOOLBAR TEST CONTROLS
   * Hover delay is global for generic video discovery (1-10 seconds).
   * Scan-for-video is a per-host TEST override, not permanent site registration.
   * Neither control changes production settings or removes user permissions.
   */
  const rc139Delay = document.getElementById('hibRc139HoverDelay');
  const rc139Label = document.getElementById('hibRc139HoverLabel');
  const rc139Scan = document.getElementById('hibRc139ScanVideo');
  let rc139Host = '';
  let rc139Hydrating = false;
  // RC148 TEST SITE STATUS: use one canonical host key for checkbox and
  // displayed state. This changes only TEST UI, never registers the site.
  function rc148RefreshTestStatus(testEnabled) {
    if (!currentSite) return;
    if (currentEnabled) {
      stateNode.textContent = 'HIB is enabled on this site.';
    } else {
      stateNode.textContent = testEnabled
        ? 'Video scanning enabled (TEST) — site not registered.'
        : 'HIB is disabled on this site.';
    }
  }
  async function rc139LoadControls() {
    rc139Hydrating = true;
    try {
      rc139Host = currentSite ? currentSite.replace(/^www\./, '').toLowerCase() : '';
      const data = await browser.storage.local.get(['hibRc139HoverDelaySeconds','hibRc139ScanVideoHosts']);
      const seconds = Math.max(1, Math.min(10, Number(data.hibRc139HoverDelaySeconds) || 2));
      rc139Delay.value = String(seconds);
      rc139Label.textContent = String(seconds);
      rc139Scan.disabled = !rc139Host || !/^https?:/i.test(activeTab?.url || '');
      rc139Scan.checked = !!(data.hibRc139ScanVideoHosts || {})[rc139Host];
      rc148RefreshTestStatus(rc139Scan.checked);
    } finally { rc139Hydrating = false; }
  }
  // RC140 / PERSISTENT HOVER CONTROL: save each slider movement while popup is open.
  // Do not wait for `change`: Firefox closes toolbar popups on focus changes.
  let rc140SliderWrite = Promise.resolve();
  rc139Delay.addEventListener('input', () => {
    rc139Label.textContent = rc139Delay.value;
    const seconds = Number(rc139Delay.value);
    rc140SliderWrite = rc140SliderWrite.catch(() => {}).then(() =>
      browser.storage.local.set({hibRc139HoverDelaySeconds: seconds})
    );
  });
  rc139Scan.addEventListener('change', async () => {
    if (rc139Hydrating || !rc139Host) return;
    const stored = await browser.storage.local.get('hibRc139ScanVideoHosts');
    const hosts = {...(stored.hibRc139ScanVideoHosts || {})};
    if (rc139Scan.checked) hosts[rc139Host] = true; else delete hosts[rc139Host];
    await browser.storage.local.set({hibRc139ScanVideoHosts:hosts});
    // RC140 / SCANNER OVERRIDE: refresh active content script immediately.
    // The scanner also observes storage.onChanged for other tabs.
    if (activeTab?.id != null) {
      await browser.tabs.sendMessage(activeTab.id, {type:'hib-rc140-refresh-test-scanner'}).catch(() => {});
    }
    // Existing content scripts receive the storage change without reloading.
    rc148RefreshTestStatus(rc139Scan.checked);
  });

  async function getStatus(site) {
    return browser.runtime.sendMessage({
      type:
        "hib-v2-site-status",

      site
    });
  }

  async function loadMain() {
    const tabs =
      await browser.tabs.query({
        active:
          true,

        currentWindow:
          true
      });

    activeTab =
      tabs &&
      tabs.length
        ? tabs[0]
        : null;

    if (
      !activeTab ||
      !activeTab.url
    ) {
      siteNode.textContent =
        "Unavailable";

      stateNode.textContent =
        "This tab cannot be managed.";

      toggle.disabled =
        true;

      return;
    }

    let parsed;

    try {
      parsed =
        new URL(
          activeTab.url
        );
    }
    catch (error) {
      siteNode.textContent =
        "Unavailable";

      stateNode.textContent =
        "This is not a normal website tab.";

      toggle.disabled =
        true;

      return;
    }

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      currentSite =
        null;

      siteNode.textContent =
        parsed.hostname ||
        parsed.protocol;

      stateNode.textContent =
        "HIB can only be enabled on HTTP/HTTPS websites.";

      toggle.disabled =
        true;

      return;
    }

    currentSite =
      parsed.hostname
        .toLowerCase();
    rc136Reset.disabled = false;

    siteNode.textContent =
      currentSite;

    const result =
      await getStatus(
        currentSite
      );

    if (
      !result ||
      !result.ok
    ) {
      stateNode.textContent =
        "Unable to read HIB site status.";

      toggle.disabled =
        true;

      return;
    }

    currentEnabled =
      !!result.enabled;

    // RC147 / TEST OVERRIDE STATUS: temporary video_scan counts as enabled
    // for scanner UX, but never enrolls the hostname in enabledSites.
    const testSaved = await browser.storage.local.get('hibRc139ScanVideoHosts');
    const testHost = currentSite.replace(/^www\./, '').toLowerCase();
    const testEnabled = testSaved.hibRc139ScanVideoHosts?.[testHost] === true;
    stateNode.textContent = currentEnabled
      ? "HIB is enabled on this site."
      : testEnabled
        ? "Video scanning enabled (TEST) — site not registered."
        : "HIB is disabled on this site.";

    toggle.textContent =
      currentEnabled
        ? "Remove this site"
        : "Add this site";

    toggle.disabled =
      false;
  }

  async function renderSites() {
    sitesMessage.textContent =
      "";

    sitesList.replaceChildren();

    const result =
      await getStatus(
        currentSite || ""
      );

    if (
      !result ||
      !result.ok
    ) {
      sitesMessage.textContent =
        "Unable to read enabled sites.";

      return;
    }

    const sites =
      Array.isArray(
        result.enabledSites
      )
        ? result.enabledSites
        : [];

    if (!sites.length) {
      const empty =
        document.createElement(
          "div"
        );

      empty.id =
        "emptySites";

      empty.textContent =
        "No sites are enabled.";

      sitesList.appendChild(
        empty
      );

      return;
    }

    const profileReply=await browser.runtime.sendMessage({type:'hib-rc78-profiles-get'}).catch(()=>null);
    const discovered=profileReply?.profiles||{};
    for (const site of sites) {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "siteEntry";

      const name =
        document.createElement(
          "div"
        );

      name.className =
        "siteName";

      name.textContent =
        site;

      /* HIB-V273-EXISTING-SITE-MODE */
      const modeSelect = document.createElement("select");

      modeSelect.className = "hibV273SiteMode";
      modeSelect.setAttribute(
        "aria-label",
        "Media mode for " + site
      );

      for (const [value, label] of [
        ["automatic", "Automatic"],
        ["video", "Video Site"]
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        modeSelect.appendChild(option);
      }

      const modeResponse =
        await browser.runtime.sendMessage({
          type: "hib-v2-site-mode-get",
          site
        });

      modeSelect.value =
        modeResponse &&
        modeResponse.ok &&
        modeResponse.mode === "video"
          ? "video"
          : "automatic";

      modeSelect.disabled = !modeResponse || !modeResponse.ok;

      modeSelect.addEventListener("change", async () => {
        const selected = modeSelect.value;
        const previous =
          selected === "video" ? "automatic" : "video";

        modeSelect.disabled = true;

        try {
          const saved =
            await browser.runtime.sendMessage({
              type: "hib-v2-site-mode-set",
              site,
              mode: selected
            });

          if (!saved || !saved.ok) {
            throw new Error(
              saved && saved.error
                ? saved.error
                : "Unable to save media mode."
            );
          }

          sitesMessage.textContent =
            site + " media mode: " + selected + ".";
        }
        catch (error) {
          modeSelect.value = previous;
          sitesMessage.textContent = String(error);
        }
        finally {
          modeSelect.disabled = false;
        }
      });

      const remove =
        document.createElement(
          "button"
        );

      remove.className =
        "removeSite";

      remove.textContent =
        "Remove";

      remove.addEventListener(
        "click",
        async () => {
          remove.disabled =
            true;

          sitesMessage.textContent =
            "Removing " +
            site +
            "...";

          const response =
            await browser.runtime.sendMessage({
              type:
                "hib-v2-site-remove",

              site
            });

          if (
            !response ||
            !response.ok
          ) {
            sitesMessage.textContent =
              response &&
              response.error
                ? response.error
                : "Remove failed.";

            remove.disabled =
              false;

            return;
          }

          sitesMessage.textContent =
            site +
            " removed.";

          await renderSites();

          if (
            currentSite ===
            site
          ) {
            currentEnabled =
              false;
          }
        }
      );

      if(discovered[site]){
        const format=document.createElement('span');
        format.className='hibRc78Format';
        format.textContent='Video · '+discovered[site].type;
        format.title='Discovered via '+discovered[site].method+' on '+discovered[site].verifiedAt;
        row.appendChild(format);
      }
      row.appendChild(name);
      row.appendChild(modeSelect);
      row.appendChild(remove);
      sitesList.appendChild(row);
    }
  }

  toggle.addEventListener(
    "click",
    async () => {
      if (
        !currentSite ||
        !activeTab
      ) {
        return;
      }

      toggle.disabled =
        true;

      const response =
        await browser.runtime.sendMessage({
          type:
            currentEnabled
              ? "hib-v2-site-remove"
              : "hib-v2-site-add",

          site:
            currentSite
        });

      if (
        !response ||
        !response.ok
      ) {
        stateNode.textContent =
          response &&
          response.error
            ? response.error
            : "Site change failed.";

        toggle.disabled =
          false;

        return;
      }

      await browser.tabs.reload(
        activeTab.id
      );

      window.close();
    }
  );

  sitesButton.addEventListener(
    "click",
    async () => {
      mainView.style.display =
        "none";

      sitesView.style.display =
        "block";

      await renderSites();

      manualSite.focus();
    }
  );

  backButton.addEventListener(
    "click",
    async () => {
      sitesView.style.display =
        "none";

      mainView.style.display =
        "block";

      document.getElementById("hibTestScanner").addEventListener("click", async () => {
    const [source] = await browser.tabs.query({active:true,currentWindow:true});
    if (!source || !/^https?:\/\//i.test(source.url || "")) {
      alert("Open the video page in a regular browser tab and try again.");
      return;
    }
    const target = new URL(browser.runtime.getURL("scanner.html"));
    target.searchParams.set("tabId", String(source.id));
    target.searchParams.set("url", source.url);
    await browser.tabs.create({url:target.href});
  });
  document.getElementById("hibTestBackups").addEventListener("click", () => browser.tabs.create({url:browser.runtime.getURL("backup.html")}));
  await loadMain();
  await rc139LoadControls();
    }
  );

  async function addManualSite() {
    const site =
      normalizeSite(
        manualSite.value
      );

    if (!site) {
      sitesMessage.textContent =
        "Enter a valid hostname, for example: example.com";

      return;
    }

    manualAdd.disabled =
      true;

    sitesMessage.textContent =
      "Adding " +
      site +
      "...";

    const response =
      await browser.runtime.sendMessage({
        type:
          "hib-v2-site-add",

        site
      });

    manualAdd.disabled =
      false;

    if (
      !response ||
      !response.ok
    ) {
      sitesMessage.textContent =
        response &&
        response.error
          ? response.error
          : "Add failed.";

      return;
    }

    /* HIB-V273-SAVE-NEW-SITE-MODE */
    const selectedMode = hibV273ManualMode.value;

    const modeResponse =
      await browser.runtime.sendMessage({
        type: "hib-v2-site-mode-set",
        site,
        mode: selectedMode
      });

    if (!modeResponse || !modeResponse.ok) {
      sitesMessage.textContent =
        site + " added, but media mode save failed: " +
        (
          modeResponse && modeResponse.error
            ? modeResponse.error
            : "Unknown error."
        );

      await renderSites();
      return;
    }

    hibV273ManualMode.value = "automatic";

    manualSite.value =
      "";

    sitesMessage.textContent =
      site +
      " added.";

    await renderSites();
  }

  manualAdd.addEventListener(
    "click",
    addManualSite
  );

  manualSite.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter"
      ) {
        addManualSite();
      }
    }
  );

  /* HIB-V210-POPUP-SIZE-PREFERENCES */
  const hibV210Options = [
    ["auto", "Automatic (fit screen)"],
    ["960x540", "960 × 540"],
    ["1280x720", "1280 × 720"],
    ["1920x1080", "1920 × 1080"],
    ["2560x1440", "2560 × 1440"],
    ["3840x2160", "3840 × 2160"],
    ["custom", "Custom dimensions"]
  ];
  const hibV210Status = document.getElementById("hibV210MediaStatus");
  for (const kind of ["Gallery", "Video"]) {
    const prefix = "hibV210" + kind;
    const select = document.getElementById(prefix + "Size");
    const custom = document.getElementById(prefix + "Custom");
    const width = document.getElementById(prefix + "Width");
    const height = document.getElementById(prefix + "Height");
    const key = kind === "Gallery" ? "hibV210GalleryDisplaySize" : "hibV210VideoDisplaySize";
    const options = hibV210Options.map(([value,label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    });
    select.append(...options);
    try {
      const saved = (await browser.storage.local.get(key))[key] || {};
      select.value = hibV210Options.some(([v]) => v === saved.preset) ? saved.preset : "auto";
      width.value = String(saved.width || 960);
      height.value = String(saved.height || 540);
    } catch (error) {
      select.value = "auto";
    }
    const save = async () => {
      custom.style.display = select.value === "custom" ? "block" : "none";
      const w = Number(width.value), h = Number(height.value);
      if (select.value === "custom" &&
          (!Number.isInteger(w) || !Number.isInteger(h) ||
           w < 160 || w > 7680 || h < 90 || h > 4320)) {
        hibV210Status.textContent = "Custom dimensions must be between 160–7680 × 90–4320.";
        return;
      }
      try {
        await browser.storage.local.set({[key]: {preset:select.value,width:w,height:h}});
        hibV210Status.textContent = kind + " preference saved.";
      } catch (error) {
        hibV210Status.textContent = "Unable to save " + kind.toLowerCase() + " preference.";
      }
    };
    custom.style.display = select.value === "custom" ? "block" : "none";
    select.addEventListener("change", save);
    width.addEventListener("change", save);
    height.addEventListener("change", save);
  }
  hibV210Status.textContent = "Preferences are saved locally.";
  // Unified playback defaults, shared by direct and HLS player instances.
  const audioKey='hibTestVideoPlaybackDefaults', qualityKey='hibTestVideoQualityPreference';
  const audioSlider=document.getElementById('hibTestAudioVolume');
  const audioLevel=document.getElementById('hibTestAudioLevel');
  const audioMuted=document.getElementById('hibTestAudioMuted');
  const quality=document.getElementById('hibTestQualityDefault');
  try {
    const saved=await browser.storage.local.get([audioKey,qualityKey]);
    const a=saved[audioKey]||{};
    audioSlider.value=String(Math.round(100*(Number.isFinite(a.volume)?Math.min(1,Math.max(0,a.volume)):1)));
    audioMuted.checked=typeof a.muted==='boolean'?a.muted:false;
    quality.value=saved[qualityKey]==='auto'?'auto':'highest';
  }catch(_){}
  const saveAudio=()=>{audioLevel.textContent=audioSlider.value+'%';
    browser.storage.local.set({[audioKey]:{volume:Number(audioSlider.value)/100,muted:audioMuted.checked}}).catch(()=>{
      hibV210Status.textContent='Audio preference could not be saved.';
    });};
  audioLevel.textContent=audioSlider.value+'%';
  audioSlider.addEventListener('input',()=>{audioLevel.textContent=audioSlider.value+'%';});
  audioSlider.addEventListener('change',saveAudio);
  audioMuted.addEventListener('change',saveAudio);
  quality.addEventListener('change',()=>browser.storage.local.set({[qualityKey]:quality.value}).catch(()=>{}));


  document.getElementById("hibTestScanner").addEventListener("click", async () => {
    const [source] = await browser.tabs.query({active:true,currentWindow:true});
    if (!source || !/^https?:\/\//i.test(source.url || "")) {
      alert("Open the video page in a regular browser tab and try again.");
      return;
    }
    const target = new URL(browser.runtime.getURL("scanner.html"));
    target.searchParams.set("tabId", String(source.id));
    target.searchParams.set("url", source.url);
    await browser.tabs.create({url:target.href});
  });
  document.getElementById("hibTestBackups").addEventListener("click", () => browser.tabs.create({url:browser.runtime.getURL("backup.html")}));
  await loadMain();
  await rc139LoadControls();
})();

/* RC346: clear the HIB video cache */
document.getElementById('hibTestClearCache')?.addEventListener('click',async e=>{
 const b=e.currentTarget;
 try{const r=await browser.runtime.sendMessage({type:'hib-rc346-clear-cache'});b.textContent='Video cache cleared ('+((r&&r.tabs)||0)+' tabs)';}
 catch(_){b.textContent='Clear failed';}
 setTimeout(()=>{b.textContent='Clear HIB video cache';},2500);
});
