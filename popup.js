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

    stateNode.textContent =
      currentEnabled
        ? "HIB is enabled on this site."
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

      await loadMain();
    }
  );

  async function addManualSite() {
    const site =
      normalizeSite(
        manualSite.value
      );

    if (!site) {
      sitesMessage.textContent =
        "Enter a valid hostname, for example: sukebei.nyaa.si";

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

  await loadMain();
})();