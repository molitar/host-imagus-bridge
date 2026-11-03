(() => {
  const siteFrames = [...document.querySelectorAll("iframe")].filter(f => !/^moz-extension:\/\//i.test(f.src || "") && !/\/hib101_player\.html(?:[?#]|$)/i.test(f.src || ""));
  const frames = siteFrames.slice(0, 60).map(f => ({
    src: f.getAttribute("src") || "", loadedSrc: f.src || "", id: f.id || "",
    sandbox: f.getAttribute("sandbox") || "", width: f.width || "", height: f.height || ""
  }));
  const result = {url:location.origin+location.pathname,iframeCount:siteFrames.length,excludedExtensionFrames:document.querySelectorAll("iframe").length-siteFrames.length,frames};
  console.log("[HIB PLAYER FRAMES]",JSON.stringify(result,null,2));
  return result;
})()