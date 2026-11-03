(() => {
  const clean=u=>{try{const x=new URL(u,location.href);return {host:x.hostname,path:x.pathname.slice(0,100),queryPresent:!!x.search};}catch{return null;}};
  const results={frame:location.origin+location.pathname,media:[],players:[],resources:[],scripts:[],thumbnailCount:0,playerFamilies:[]};
  const found=new Set(), families=new Map();
  function mark(type,evidence,adapter){if(!families.has(type))families.set(type,{type,evidence:[],existingHIBPath:adapter||null});const list=families.get(type).evidence;if(list.length<6&&!list.includes(evidence))list.push(evidence);}
  function add(tag,url,detail="") {const c=clean(url);if(!c)return;const k=tag+":"+c.host+c.path;if(found.has(k)||results.media.length>=50)return;found.add(k);results.media.push({tag,...c,detail});}
  for(const v of document.querySelectorAll("video,audio")){
    mark("HTML5 video","video/audio element","Generic media resolver");
    if(v.currentSrc||v.src)add(v.tagName.toLowerCase(),v.currentSrc||v.src,`${v.videoWidth||0}x${v.videoHeight||0}`);
    for(const s of v.querySelectorAll("source"))if(s.src)add("source",s.src,s.type||"");
  }
  for(const f of [...document.querySelectorAll("iframe")].slice(0,35))if(f.src){const u=clean(f.src);if(u){results.players.push(u);if(/(^|\.)nhplayer\.com$/i.test(u.host))mark("NHPlayer",`iframe ${u.host}${u.path}`,"NHPlayer dedicated resolver");else if(/player|embed|video|watch/i.test(u.path))mark("Embedded iframe",`iframe ${u.host}${u.path}`,"Generic frame resolver (needs verification)");}}
  results.thumbnailCount=document.querySelectorAll("a img,button img,video[poster]").length;
  for(const r of performance.getEntriesByType("resource")){
    const u=clean(r.name);if(!u)continue;
    const m=/\.(m3u8|mpd|mp4|webm|m4v|ts)(?:$|\?)/i.exec(r.name);
    if(m && results.resources.length<40 && !results.resources.some(t=>t.host===u.host&&t.path===u.path))results.resources.push({...u,kind:m[1].toLowerCase()});
    if(m?.[1]?.toLowerCase()==="m3u8")mark("HLS stream",`resource ${u.host}${u.path}`,"Generic media resolver (needs verification)");
    if(m?.[1]?.toLowerCase()==="mpd")mark("MPEG-DASH stream",`resource ${u.host}${u.path}`,"Requires player compatibility test");
  }
  for(const s of [...document.scripts].slice(0,100)){
    const source=(s.textContent||"").slice(0,300000),scriptURL=s.src||"";
    const combined=(source+" "+scriptURL).toLowerCase();
    const keys=["videojs","jwplayer","hls.js","dashjs","playerjs","plyr","sources:","file:","m3u8","nhplayer"].filter(t=>combined.includes(t.toLowerCase()));
    if(keys.length && results.scripts.length<15)results.scripts.push({script:s.src?clean(s.src):"inline",hints:keys});
    if(keys.includes("jwplayer"))mark("JW Player","JW Player script/configuration","Generic frame/media resolver (not a dedicated JW Player adapter)");
    if(keys.includes("videojs"))mark("Video.js","Video.js script/configuration","Generic HTML5 media resolver");
    if(keys.includes("plyr"))mark("Plyr","Plyr script/configuration","Generic HTML5 media resolver");
    if(keys.includes("nhplayer"))mark("NHPlayer","NHPlayer script/configuration","NHPlayer dedicated resolver");
    if(keys.includes("playerjs"))mark("PlayerJS","PlayerJS script/configuration","Requires compatibility test");
  }
  if(document.querySelector('.jwplayer,[id^="jwplayer"]'))mark("JW Player","player DOM container","Generic frame/media resolver (needs verification)");
  if(document.querySelector('.video-js'))mark("Video.js","video-js DOM container","Generic HTML5 media resolver");
  results.playerFamilies=[...families.values()];
  return results;
})()
