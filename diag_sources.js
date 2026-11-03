(() => {
  const videos=[...document.querySelectorAll("video,audio")].map(v=>({tag:v.tagName.toLowerCase(),currentSrc:v.currentSrc||"",src:v.getAttribute("src")||"",sources:[...v.querySelectorAll("source")].map(s=>({src:s.src,type:s.type}))}));
  const resources=performance.getEntriesByType("resource").map(r=>r.name).filter(u=>/\.(mp4|webm|m3u8|mpd|m4v)(?:\?|$)/i.test(u)).slice(0,40);
  const result={url:location.origin+location.pathname,videos,resources};
  console.log("[HIB MEDIA SOURCES]",JSON.stringify(result,null,2));
  return result;
})()