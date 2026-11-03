(() => {
  const videos = [...document.querySelectorAll("video")];
  const playerGlobal = (() => { try { return Boolean(window.videojs || window.wrappedJSObject?.videojs); } catch (_) { return false; } })();
  const flowplayerSources = [...document.querySelectorAll(".freedomplayer.flowplayer[data-item]")].map(root => {
    let data = null;
    try { data = JSON.parse(root.getAttribute("data-item") || ""); } catch (_) {}
    return {id:root.id || "", sources: Array.isArray(data?.sources) ? data.sources.map(x => ({src: String(x.src || ""), type: String(x.type || "")})).slice(0, 8) : []};
  });
  const result = {
    url: location.origin + location.pathname,
    flowplayerSources,
    videoCount: videos.length,
    players: videos.map(v => ({
      currentSrc: (() => { try { return v.currentSrc ? new URL(v.currentSrc).hostname : ""; } catch (_) { return ""; } })(),
      src: v.getAttribute("src"),
      sourceCount: v.querySelectorAll("source").length,
      readyState: v.readyState,
      paused: v.paused,
      preload: v.preload,
      poster: Boolean(v.poster)
    })),
    videoJsDetected: playerGlobal,
    videoJsElements: document.querySelectorAll(".video-js").length
  };
  console.log("[HIB PLAYER INITIALIZATION]", JSON.stringify(result, null, 2));
  return result;
})()