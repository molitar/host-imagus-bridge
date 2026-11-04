/* ===== START VIDEO SECTION - BACKGROUND (video parts of background.js) - VIDEO FINAL (RC507) =====
 * Where the video work lives in this file (search these names):
 *   scan loop (hibRc133ResolveMedia, 'RC448 TICK'): detection of a playing / verified source; PLAY_ACTIVATION clicks (play buttons, labelled play, and a player's own
 *     'Continue watching?' prompt inside a player container, RC501); FAST REFRESH of a known episode (hibKnownPath / hibFileKey, RC468/RC471); early accept of a verified
 *     stream manifest (hibManifestAlive, RC495).
 *   hib-rc326-verify-url: is a saved address still alive (2.5 s limit, Range probe, Referer retry, RC465/RC496).
 *   Referer handling: hib101MediaOriginHints, hibRefererListener, hibRefererNeedProbe, hib-rc468-need-referer.
 *   subtitles: hib-rc332-get-subs (observed files, next to the media, the episode page itself), hibRc440Lang (file name first, RC472/RC475).
 *   site profiles / player type: HIBRC150 (hib_rc150_registry.js), hibRc78SaveProfile, PLAYER_TYPE_STORED.
 * ===== */
console.info('[HIB RC346] background loaded: referrer for embedded players, cached tags, landing confirm');

/* hibV218RestoreUserTab removed: the detection code never activates a tab */


// RC293: one owner for HIB-created discovery windows, including about:blank
// while a window is being navigated. Reservation is synchronous, before
// windows.create begins, so two entrypoints cannot race through URL inspection.
const hibRc293Owned = new Map();
function hibRc293Key(raw){try{return new URL(raw).href;}catch(_){return null;}}
async function hibRc293Acquire(raw, options) {
 const key=hibRc293Key(raw);
 if(!key)throw new Error('RC293 invalid discovery target');
 const existing=hibRc293Owned.get(key);
 if(existing){
  try {
   const old=await existing;
   const live=await browser.windows.get(old.id,{populate:true});
   if(live?.id===old.id && live.tabs?.length){
    console.info('[HIB RC293]',{status:'WINDOW_REUSED',key,windowId:live.id});
    return {win:live,reused:true};
   }
  }catch(e){console.warn('[HIB RC293]',{status:'STALE_OWNER',key,error:String(e)});}
  if(hibRc293Owned.get(key)===existing)hibRc293Owned.delete(key);
 }
 // Installing the promise in the map happens without an await.
 const creation=Promise.resolve().then(()=>browser.windows.create(options));
 hibRc293Owned.set(key,creation);
 try{
  const win=await creation;
  console.info('[HIB RC293]',{status:'WINDOW_CREATED',key,windowId:win.id});
  return {win,reused:false};
 }catch(e){if(hibRc293Owned.get(key)===creation)hibRc293Owned.delete(key);throw e;}
}
function hibRc293ForgetWindow(id){
 for(const [key,promise] of hibRc293Owned){
  Promise.resolve(promise).then(w=>{if(w?.id===id&&hibRc293Owned.get(key)===promise)hibRc293Owned.delete(key);}).catch(()=>{});
 }
}
browser.windows.onRemoved.addListener(hibRc293ForgetWindow);

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}


/* HIB 1.0.1 RC18: narrow, expiring media-origin hints for the shared player.
 * Only URLs observed in a real embedded video frame are eligible.
 * Do not alter requests for other websites or unrelated resources.
 */
const hib101MediaOriginHints = new Map();
/* RC297: a verified episode can be opened long after discovery (the card keeps it for 24 h). Every time the player is
 * opened the content script re-arms the exact-URL referrer hint, so a hotlink-protected CDN still gets the site's own page. */
/* RC468: error-driven Referer. The HIB player reports a playlist / segment that was refused (401/403/404/410/412) before anything played; every saved address on that
 * registrable domain is flagged so the Referer hook adds the page that verified it, and the player restarts its loading. Self-healing for hosts the open-time probe could not judge. */
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-rc468-need-referer')return undefined;
 try{
  if(!String(sender?.url||'').startsWith(browser.runtime.getURL('')))return Promise.resolve({ok:false});
  const dom=h=>h.split('.').slice(-2).join('.');
  const d=dom(new URL(msg.url).hostname);let n=0;
  for(const [k,hh] of hib101MediaOriginHints){try{if(hh&&Date.now()<hh.until&&dom(new URL(k).hostname)===d){hh.needsReferer=true;n++;}}catch(_){}}
  if(n)hibRefererSync();
  return Promise.resolve({ok:n>0,flagged:n});
 }catch(_){return Promise.resolve({ok:false});}
});
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-rc297-media-hint')return undefined;
 try{
  const media=new URL(msg.url),ref=new URL(msg.referrer),tab=new URL(sender?.tab?.url||'');
  if(media.protocol!=='https:'||ref.protocol!=='https:'||!tab.hostname)return Promise.resolve({ok:false});   // RC459: the referrer may be the embed's address on another site (saved with the card)
  const had=hib101MediaOriginHints.get(media.href);
  if(!had||Date.now()>had.until)hib101MediaOriginHints.set(media.href,{referrer:ref.href,until:Date.now()+30*60*1000,source:'verified-popup'});
  return Promise.resolve({ok:true});
 }catch(_){return Promise.resolve({ok:false});}
});
/* 3.0.1: the resolution list of a KVS player page (video_url / video_alt_url / video_alt_url2 + the _text labels). Fetched fresh when the HIB player opens, because the
 * addresses carry short-lived tokens. Read-only: only an https page, 12 s limit, nothing stored. */
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-kvs-variants')return undefined;
 return (async()=>{
  try{
   const page=new URL(msg.page);if(page.protocol!=='https:')return {ok:false,error:'not https'};
   const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),12000);
   const r=await fetch(page.href,{credentials:'include',cache:'no-store',signal:ctl.signal});clearTimeout(tm);
   const html=(await r.text()).slice(0,1500000).split(String.fromCharCode(92)+'/').join('/');
   const out=[],seen=new Set();
   const re=/video_((?:alt_)?url[0-9]*):\s*'(https?:[^']+)'/g;let m;
   while((m=re.exec(html))){
    const url=m[2];if(seen.has(url))continue;seen.add(url);
    const lm=new RegExp('video_'+m[1]+'_text:\\s*\'([^\']*)\'').exec(html);
    const label=lm?lm[1].trim():'';
    const rn=/([0-9]{3,4})p?/.exec(label)||/_([0-9]{3,4})p?[.]mp4/.exec(url);
    out.push({url,label,res:rn?Number(rn[1]):0});
   }
   out.sort((a,b)=>b.res-a.res);
   return {ok:true,variants:out.slice(0,8)};
  }catch(e){return {ok:false,error:String(e)};}
 })();
});
/* 3.0.1: hands the video address the HIB player plays (and the page's other resolutions) to the Universal Media Downloader add-on, which cannot see this player's requests. */
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-umd-offer')return undefined;
 const tabId=sender&&sender.tab?sender.tab.id:-1;
 if(!(tabId>=0)||!Array.isArray(msg.items))return Promise.resolve({ok:false});
 const items=msg.items.slice(0,12).filter(x=>x&&typeof x.url==='string'&&/^https:/i.test(x.url)).map(x=>({url:x.url,label:String(x.label||'').slice(0,40),kind:['hls','dash','video'].includes(x.kind)?x.kind:'video',referrer:String((hib101MediaOriginHints.get(x.url)||{}).referrer||'').slice(0,2000)}));   // 3.0.1: the referrer HIB verified for this address
 const payload={action:'hib-offer',tabId,items,title:String(msg.title||'').slice(0,200),referrer:String(msg.referrer||'').slice(0,2000)};
 return (async()=>{
  for(const id of ['umd@molitar.local']){try{await browser.runtime.sendMessage(id,payload);return {ok:true};}catch(_){}}
  return {ok:false};
 })();
});
/*
 * HIB-V216-SITE-MANAGER
 *
 * This allowlist controls SOURCE sites where unified_player.js executes.
 *
 * Resolver destinations are separate: arbitrary image hosts may still be
 * opened by the background resolver without being added to enabledSites.
 */

const hibV216Registrations =
  new Map();

function hibV216NormalizeSite(value) {
  const site =
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, "");

  if (
    !site ||
    !/^[a-z0-9.-]+$/i.test(site) ||
    site.includes("..")
  ) {
    return null;
  }

  return site;
}

async function hibV216ReadSites() {
  const stored =
    await browser.storage.local.get(
      "enabledSites"
    );

  /*
   * Upgrade migration:
   * v2.1.3 was a single-site installation, so retain that site
   * automatically the first time v2.1.3 starts.
   */
  if (
    !Object.prototype.hasOwnProperty.call(
      stored,
      "enabledSites"
    )
  ) {
    const initial = []; // TEST build: do not silently recreate a truncated site list.

    await browser.storage.local.set({
      enabledSites:
        initial
    });

    return initial;
  }

  const source =
    Array.isArray(
      stored.enabledSites
    )
      ? stored.enabledSites
      : [];

  const result =
    [];

  const seen =
    new Set();

  for (
    const value of
    source
  ) {
    const site =
      hibV216NormalizeSite(
        value
      );

    if (
      site &&
      !seen.has(site)
    ) {
      seen.add(site);
      result.push(site);
    }
  }

  return result;
}

async function hibV216WriteSites(sites) {
  const clean =
    [];

  const seen =
    new Set();

  for (
    const value of
    sites
  ) {
    const site =
      hibV216NormalizeSite(
        value
      );

    if (
      site &&
      !seen.has(site)
    ) {
      seen.add(site);
      clean.push(site);
    }
  }

  clean.sort();

  await browser.storage.local.set({
    enabledSites:
      clean
  });

  return clean;
}

async function hibV216RegisterSite(site) {
  const clean =
    hibV216NormalizeSite(
      site
    );

  if (!clean) {
    throw new Error(
      "Invalid source-site hostname"
    );
  }

  if (
    hibV216Registrations.has(
      clean
    )
  ) {
    return;
  }

  const registration =
    await browser.contentScripts.register({
      matches: [
        "https://" +
          clean +
          "/*",
        "http://" +
          clean +
          "/*"
      ],

      js: [{ file: "unified_player.js" }],

      runAt:
        "document_idle"
    });

  hibV216Registrations.set(
    clean,
    registration
  );

  console.log(
    "[HIB v2.1.5 sites] registered:",
    clean
  );
}

async function hibV216UnregisterSite(site) {
  const clean =
    hibV216NormalizeSite(
      site
    );

  if (!clean) {
    return;
  }

  const registration =
    hibV216Registrations.get(
      clean
    );

  if (!registration) {
    return;
  }

  try {
    await registration.unregister();
  }
  finally {
    hibV216Registrations.delete(
      clean
    );
  }

  console.log(
    "[HIB v2.1.5 sites] unregistered:",
    clean
  );
}

async function hibV216SyncSites() {
  const sites =
    await hibV216ReadSites();

  const wanted =
    new Set(
      sites
    );

  for (
    const existing of
    Array.from(
      hibV216Registrations.keys()
    )
  ) {
    if (
      !wanted.has(existing)
    ) {
      await hibV216UnregisterSite(
        existing
      );
    }
  }

  for (
    const site of
    sites
  ) {
    await hibV216RegisterSite(
      site
    );
  }

  console.log(
    "[HIB v2.1.5 sites] enabled source sites:",
    sites
  );

  return sites;
}

/* HIB-V273-SITE-MEDIA-MODES */
function hibV273ValidMode(value) {
  return value === "video" ? "video" : "automatic";
}

async function hibV273ReadModes() {
  const stored = await browser.storage.local.get("siteMediaModes");
  const source = stored.siteMediaModes;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return Object.create(null);
  }

  const result = Object.create(null);

  for (const [key, value] of Object.entries(source)) {
    const site = hibV216NormalizeSite(key);

    if (site && value === "video") {
      result[site] = "video";
    }
  }

  return result;
}

async function hibV273GetMode(value) {
  const site = hibV216NormalizeSite(value);

  if (!site) {
    throw new Error("Invalid source-site hostname");
  }

  const modes = await hibV273ReadModes();
  return hibV273ValidMode(modes[site]);
}

async function hibV273SetMode(value, requestedMode) {
  const site = hibV216NormalizeSite(value);

  if (!site) {
    throw new Error("Invalid source-site hostname");
  }

  if (requestedMode !== "automatic" && requestedMode !== "video") {
    throw new Error("Invalid site media mode");
  }

  const sites = await hibV216ReadSites();

  if (!sites.includes(site)) {
    throw new Error("Site must be enabled before setting its media mode");
  }

  const modes = await hibV273ReadModes();

  if (requestedMode === "automatic") {
    delete modes[site];
  } else {
    modes[site] = "video";
  }

  await browser.storage.local.set({
    siteMediaModes: modes
  });

  return requestedMode;
}

async function hibV273DeleteMode(value) {
  const site = hibV216NormalizeSite(value);
  if (!site) return;

  const modes = await hibV273ReadModes();
  delete modes[site];

  await browser.storage.local.set({
    siteMediaModes: modes
  });
}

async function hibV216AddSite(value) {
  const site =
    hibV216NormalizeSite(
      value
    );

  if (!site) {
    throw new Error(
      "Invalid source-site hostname"
    );
  }

  const sites =
    await hibV216ReadSites();

  if (
    !sites.includes(site)
  ) {
    sites.push(site);

    await hibV216WriteSites(
      sites
    );
  }

  await hibV216RegisterSite(
    site
  );

  return site;
}

async function hibV216RemoveSite(value) {
  const site =
    hibV216NormalizeSite(
      value
    );

  if (!site) {
    throw new Error(
      "Invalid source-site hostname"
    );
  }

  const sites =
    await hibV216ReadSites();

  const remaining =
    sites.filter(
      item =>
        item !== site
    );

  await hibV216WriteSites(
    remaining
  );

  await hibV216UnregisterSite(
    site
  );

  await hibV273DeleteMode(site);
  const existing=await browser.storage.local.get('hibRc78VideoProfiles');
  const profiles=existing.hibRc78VideoProfiles||{};
  if(Object.prototype.hasOwnProperty.call(profiles,site)){
   delete profiles[site];await browser.storage.local.set({hibRc78VideoProfiles:profiles});
  }

  return site;
}

browser.runtime.onMessage.addListener(
  message => {
    if (
      !message ||
      typeof message.type !==
        "string"
    ) {
      return undefined;
    }

    /* HIB-V273-SITE-MEDIA-MESSAGE-HANDLERS */
    if (message.type === "hib-v2-site-mode-get") {
      return hibV273GetMode(message.site)
        .then(mode => ({ ok: true, mode }))
        .catch(error => ({ ok: false, error: String(error) }));
    }

    if (message.type === "hib-v2-site-mode-set") {
      return hibV273SetMode(message.site, message.mode)
        .then(mode => ({ ok: true, mode }))
        .catch(error => ({ ok: false, error: String(error) }));
    }

    if (
      message.type ===
        "hib-v2-site-status"
    ) {
      return hibV216ReadSites()
        .then(sites => {
          const site =
            hibV216NormalizeSite(
              message.site
            );

          return {
            ok:
              true,

            site,

            enabled:
              !!site &&
              sites.includes(site),

            enabledSites:
              sites
          };
        });
    }

    if (
      message.type ===
        "hib-v2-site-add"
    ) {
      return hibV216AddSite(
        message.site
      )
        .then(site => ({
          ok:
            true,

          site,

          enabled:
            true
        }))
        .catch(error => ({
          ok:
            false,

          error:
            String(error)
        }));
    }

    if (
      message.type ===
        "hib-v2-site-remove"
    ) {
      return hibV216RemoveSite(
        message.site
      )
        .then(site => ({
          ok:
            true,

          site,

          enabled:
            false
        }))
        .catch(error => ({
          ok:
            false,

          error:
            String(error)
        }));
    }

    return undefined;
  }
);
Promise.resolve(window.hibBackupReady).then(() => hibV216SyncSites())
  .catch(error => {
    console.error(
      "[HIB v2.1.5 sites] startup sync failed:",
      error
    );
  });

console.log(
  "[HIB v2.1.5 sites] site manager loaded"
);
async function hibExtractObservedVtt(capture,baseUrl,domCandidates=[],tabId=null) {
  const list=[...new Set([...domCandidates,...capture.urls])];
  const candidates=list.filter(item=>{try {
    const u=new URL(item,baseUrl);
    return u.protocol==='https:' && (/\.vtt(?:[/?#]|$)/i.test(u.href)||/(?:subtitle|caption)/i.test(u.pathname));
  }catch(_){return false;}});
  // RC440: ENGLISH FIRST, ENGLISH ONLY. Candidates are tried English-named ones first (en / eng / english in the address), and a file whose dialogue
  // letters are mostly not Latin (Arabic, Cyrillic, CJK ...) is skipped (hibRc439LooksLatin), so another language track can never win just by being first.
  const enRank=item=>/(?:^|[\/._=-])(?:en|eng|english)(?:[\/._&?=-]|$)/i.test(item)?0:1;
  candidates.sort((x,y)=>enRank(x)-enRank(y));
  for(const candidate of candidates.slice(0,16)) {
    let url=null;
    try {
      url=new URL(candidate,baseUrl);
      const response=await fetch(url.href,{credentials:'include',referrer:baseUrl});
      if(!response.ok){console.info('[HIB global captions] VTT_HTTP',response.status,url.pathname);continue;}
      const text=await response.text();
      if(text.length<=2000000 && text.replace(/^\uFEFF/,'').trimStart().startsWith('WEBVTT') && hibRc439LooksLatin(text)) {
        console.info('[HIB global captions] VTT_READY',url.pathname);
        return {text,label:/\.eng(?:\.|$)/i.test(url.pathname)?'English':'Subtitles'};
      }
      console.info('[HIB global captions] INVALID_VTT',url.pathname);
    }catch(error){
      console.info('[HIB global captions] VTT_FETCH_FAILED',String(error));
      if(tabId != null && url) {
        // Page-origin fallback for subtitle servers that require first-party requests.
        try {
          const fetched = await browser.tabs.executeScript(tabId,{
            code:`(async () => {
              const r=await fetch(${JSON.stringify(url.href)},{credentials:'include'});
              if(!r.ok)return null;
              const t=await r.text();
              return t.length <= 2000000 && t.replace(/^\uFEFF/,'').trimStart().startsWith('WEBVTT') ? t : null;
            })()`
          });
          if(typeof fetched?.[0] === 'string' && hibRc439LooksLatin(fetched[0])) {
            console.info('[HIB global captions] VTT_READY_PAGE',url.pathname);
            return {text:fetched[0],label:/\.eng(?:\.|$)/i.test(url.pathname)?'English':'Subtitles'};
          }
        }catch(e){console.info('[HIB global captions] VTT_PAGE_FETCH_FAILED',String(e));}
      }
    }
  }
  console.info('[HIB global captions] TRACKS_NOT_FOUND',{observed:capture.urls.size,candidates:candidates.length});
  return null;
}

/* RC73 TEST: temporary focused popup playback experiment. Never claims a
 * source verified simply because a URL exists. Player API calls may be blocked
 * by browser policy; log that explicitly. No OS-level/trusted click simulated.
 */
// RC108: one global discovery or permission probe. Do not queue other cards.
let hibRc108Busy=false;
let hibRc108PermissionTab=null;
let hibRc111Handoff=null;
let hibRc111HandoffTimer=null;
// RC111: Probe the actual episode origin BEFORE Dismiss closes its tab.
// WebExtensions cannot directly read Firefox's stored autoplay site permission.
let hibRc111PermissionResult='unknown';
const hibRc111PlaybackCode = `(async()=>{
 const a=document.createElement('audio'),rate=8000,count=800,length=44+count*2;
 const bytes=new Uint8Array(length),dv=new DataView(bytes.buffer);
 const wr=(p,v)=>{for(let i=0;i<v.length;i++)bytes[p+i]=v.charCodeAt(i)};
 wr(0,'RIFF');dv.setUint32(4,length-8,true);wr(8,'WAVEfmt ');
 dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);
 dv.setUint32(24,rate,true);dv.setUint32(28,rate*2,true);
 dv.setUint16(32,2,true);dv.setUint16(34,16,true);
 wr(36,'data');dv.setUint32(40,count*2,true);
 let raw='';for(const x of bytes)raw+=String.fromCharCode(x);
 a.src='data:audio/wav;base64,'+btoa(raw);a.muted=false;a.volume=1;
 try{await a.play();a.pause();return 'allowed';}
 catch(e){return e?.name||'unknown';}finally{a.remove();}
})()`;
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type==='hib-rc108-probe-state')return Promise.resolve({busy:hibRc108Busy,permissionTabId:hibRc108PermissionTab});
 return undefined;
});
/* RC133 / PLAYER ADAPTER REGISTRY
 * AUTO DETECTION: the rendered media resolver remains the global fallback for every site.
 * PLAYER TYPES: framework engine and transport format are separate dimensions.
 * To add a player: introduce a named adapter; never embed new site-specific tests in
 * the card detector or landing detector. Profiles are advice, not proof of playback.
 */
const HIB_RC133_RULES='hibRc133VerifiedSiteRules';
const hibRc133PlayerAdapters=Object.freeze({
 jwplayer:{label:'JW Player'},videojs:{label:'Video.js'},flowplayer:{label:'Flowplayer'},
 plyr:{label:'Plyr'},shaka:{label:'Shaka'},hlsjs:{label:'hls.js'},
 dashjs:{label:'dash.js'},nplayer:{label:'NPlayer'},html5:{label:'HTML5'},
 custom:{label:'Custom / universal'}
});
// RC133 / MEDIA FORMAT CLASSIFIER: classify the verified URL, never infer playability.
function hibRc133MediaFormat(url){try{const p=new URL(url).pathname.toLowerCase();return p.endsWith('.m3u8')?'hls':p.endsWith('.mpd')?'dash':/\.webm$/.test(p)?'webm':'mp4';}catch(_){return 'unknown';}}
// RC133 / ENGINE CLASSIFIER: keep uncertain engines marked custom until positively observed.
function hibRc133EngineFromDiscovery(data){
 const hint=String(data?.playerEngine||data?.engine||data?.playerType||'').toLowerCase();
 return Object.keys(hibRc133PlayerAdapters).find(k=>hint.includes(k))||'custom';
}
// RC133 / VERIFIED SITE PROFILE CACHE: persist framework/transport only after playback.
// Never persist transient signed media URLs or authorization headers in profiles.
async function hibRc133StoreVerifiedRule(target,engine,format){
 const all=await browser.storage.local.get(HIB_RC133_RULES);
 const db=all[HIB_RC133_RULES]||{};
 const key=target.hostname;
 const record=db[key]||{cards:{},verifiedAt:0};
 // Generic path-family key; no domain-specific /3d/ or /videos/ rules.
 const family=target.pathname.split('/').filter(Boolean)[0]||'/';
 record.cards[family]={engine,format,verified:true,checkedAt:Date.now()};
 record.verifiedAt=Date.now();db[key]=record;
 await browser.storage.local.set({[HIB_RC133_RULES]:db});
 console.info('[HIB RC133 / PROFILE CACHE] VERIFIED_RULE_SAVED',{host:key,engine,format});
}
/* RC297: does an observed video candidate look like an advertisement rather than the episode?
 * Small player, a standard ad size in its address, or a known ad network. */
function hibRc297LooksLikeAd(h){
 try{
  // RC447: the scan popup is small (560x360), so a real player can render only ~419x209 (xanimeporn): that is 87,571 px^2 and was dropped as an "ad"
  // by the old 120,000 px^2 floor, although the video played. The floor is 80,000 now (a 300x250 banner ad is 75,000 and is still caught).
  if(h.w>0&&h.h>0&&(h.w<200||h.h<120||h.w*h.h<80000))return true;
  // RC346: an episode is longer than a minute; a clip whose duration is known and shorter is an ad
  // RC448: a known duration under a minute is suspicious (ads are short) -> it was held back for 20 s. nhentai34.com's rule34video embeds are SHORT CLIPS that start
  // playing at once in a big player (513x289): they waited the full 20 s (24 s per hover, the "spins forever" complaint). A video that fills the player area
  // (>= 80,000 px^2; banner ads are 300x250 = 75,000) and whose address is not ad-like is accepted after 5 s instead of 20 s.
  if(h.kind!=='hlsManifest'&&h.kind!=='configSource'&&h.maxDuration>0&&h.maxDuration<60&&Date.now()-(h.seenAtWall||0)<((h.w*h.h>=80000)?5000:20000))return true; // still short after the grace period with nothing longer: a genuinely short episode
  const hay=(String(h.url||'')+' '+String(h.frame||'')).toLowerCase();
  if(/(?:^|[^0-9])(?:300x250|728x90|160x600|300x600|320x50|970x250|468x60|360x70|300x100)(?:[^0-9]|$)/.test(hay))return true;
  if(/(?:adshow|adserver|doubleclick|googlesyndication|imasdk|exoclick|trafficjunky|juicyads|jads[.]co|emberglade|storagexhd|sadbaguette|greentrafsa|trackwilltrk|popunder|preroll|syndication|banner|mmcdn|roomad|chaturbate|bkcdn|bxcdn|sacdnssedge|havenclick|flixcdn|realsrv|tsyndicate|clickadu|adsterra|propeller|popcash|livejasmin|stripcdn)/.test(hay))return true;
  // A preview / teaser / trailer / hover thumbnail clip is not the episode (a landing page that needs a Watch click).
  const path=(()=>{try{return new URL(h.url).pathname.toLowerCase();}catch(_){return String(h.url||'').toLowerCase();}})();
  // RC448: ...unless it is the PAGE'S MAIN PLAYER and it really plays: watchhentai.net serves a non-member only "<name>-preview.mp4" in its one big player (the
  // site's own player plays nothing else), and HIB must hand that to its player instead of spinning until the scan gives up. A preview that merely sits in a
  // card/hero (small, not advancing) is still dropped.
  const mainPlayerPlaying=(h.kind==='currentSrc'&&h.maxAdvance>=1&&h.w*h.h>=80000)||(h.kind==='configSource'&&h.maxAdvance>=3&&!(h.w*h.h)&&(h.readyState||0)>=2);
  if(!mainPlayerPlaying&&/(?:^|[^a-z])(?:preview|previews|teaser|trailer|heatmap|thumb|thumbs|sample)(?:[^a-z]|$)/.test(path))return true;
  if(/[/](?:ads?|bnr|banners?)[/]/.test(path))return true;
 }catch(_){}
 return false;
}
/* RC297: how many words (or a numeric id) of the PAGE's own address does this source's address share?
 * The real episode usually carries the page's slug or id (rosalina-animation -> Rosalina Animation.mp4,
 * watch?v=405865 -> 405865-1080p.mp4); an advertisement never does. */
const HIB_RC297_STOP=new Set(['http','https','html','watch','video','videos','episode','episodes','english','hentai','anime','subbed','player','embed','free','online','stream','page','search','genres','latest']);
function hibRc297Tokens(s){
 const out=new Set();
 for(const w of String(s||'').toLowerCase().split(/[^a-z0-9]+/)){
  if(w.length>=4||(w.length>=3&&/^[0-9]+$/.test(w)))out.add(w);
 }
 return out;
}
function hibRc297SlugScore(candidateUrl,target){
 try{
  const page=[...hibRc297Tokens(target.pathname+' '+target.search)].filter(w=>!HIB_RC297_STOP.has(w));
  if(!page.length)return 0;
  const cand=hibRc297Tokens(decodeURIComponent(new URL(candidateUrl).pathname));
  let n=0;
  for(const w of page)if(cand.has(w))n+=/^[0-9]{4,}$/.test(w)?2:1;
  return n;
 }catch(_){return 0;}
}
/* RC297: resolution label in a URL (720p -> 720), used to pick the best of several configured qualities. */
function hibRc297Res(u){const t=String(u),m=/(?:^|[^0-9])([0-9]{3,4})p(?![a-z0-9])/.exec(t)||/_([0-9]{3,4})[.](?:mp4|webm)/.exec(t);return m?Number(m[1]):0;}   /* 3.0.1: also name_360.mp4 */
/* RC297: a configured source counts only if the server really answers a 2-byte range request with video. */
async function hibRc297RangeOk(url){
 try{
  const c=new AbortController();const t=setTimeout(()=>c.abort(),2500);
  const r=await fetch(url,{headers:{Range:'bytes=0-1'},cache:'no-store',signal:c.signal});clearTimeout(t);
  const ct=(r.headers.get('content-type')||'').toLowerCase();
  try{if(r.body)r.body.cancel();}catch(_){}
  // 403/401: the file exists but is hotlink-protected; the player sends the site's own page as Referer (hint), so it can still play.
  return (r.status===200||r.status===206)?(/video|octet-stream|mpegurl/.test(ct)||!ct):(r.status===403||r.status===401);
 }catch(_){return false;}
}

const hibRc133ResolveMedia=(msg,sender)=>{
 if(msg?.type!=='hib-test-global-rendered-media')return undefined;
 const owner=sender?.tab?.id;
 const matchingHandoff=Boolean(msg.permissionRetry && hibRc111Handoff &&
  hibRc111Handoff.owner===owner && hibRc111Handoff.pageUrl===msg.pageUrl);
 if(hibRc108Busy && !matchingHandoff)return Promise.resolve({ok:false,busy:true,error:'HIB discovery is occupied; no queue created'});
 if(matchingHandoff){
  hibRc111Handoff=null;
  if(hibRc111HandoffTimer!==null){clearTimeout(hibRc111HandoffTimer);hibRc111HandoffTimer=null;}
 }
 hibRc108Busy=true;hibRc108BusySince=Date.now();
 return (async()=>{
  let target;try{target=new URL(msg.pageUrl);}catch(_){return {ok:false,error:'invalid URL'};}
  if(!/^https?:$/.test(target.protocol))return {ok:false,error:'non-web URL'};
  let popup=null,priorWindow=null,priorTab=null,framesExamined=0;
  // RC105: only observe VTT URLs for the short-lived discovery popup tab.
  const popupVtt={urls:new Set()};
  const popupFonts=new Set();   // font files the episode page loads itself (ASS subtitles may name them)
  let popupVttListener=null,popupFontListener=null;let hibPopListener=null,hibStrayUpd=null,hibStrayAct=null,hibGuardReg=null,hibGuardProbe=null;
  // RC295: MSE players play from a blob: URL and the real playlist is often missing from the page's
  // resource-timing list (buffer full / worker requests). Watch the discovery tab's network requests instead.
  let popupManifestListener=null;const popupNetManifests=new Set();let popupMediaListener=null;const popupNetMedia=new Set();
  const observedOrigins=new Set([target.origin]);
  const history=new Map(), errors=new Set();let last={}, diagnosticSnapshots=[], tick=0;
  // RC126: referenced after the polling loop as well as within it.
  let rc114PermissionState='unknown';
  const popupDomCaptions=new Set();
  try{
   priorTab=Number.isInteger(sender?.tab?.id)?sender.tab.id:null;
   let hibStore=null,hibOrigIndex=null;
   if(priorTab!==null){const tab=await browser.tabs.get(priorTab).catch(()=>null);priorWindow=tab?.windowId??null;hibStore=tab?.cookieStoreId||null;hibOrigIndex=Number.isInteger(tab?.index)?tab.index:null;}
   // RC119: restore the RC110 background pop-under for verified discovery.
   // RC133 / POPUP OWNERSHIP: reuse the landing detector's already-open browser window.
   // Historical standalone entrypoint remains available as rollback only.
   let hibGeo=null,hibBlankStart=false;
   try{if(!msg.rc133Popup&&priorWindow!==null){const pw=await browser.windows.get(priorWindow);if(pw&&pw.state!=='minimized'&&pw.state!=='fullscreen'&&pw.width>500&&pw.height>400)hibGeo={l:pw.left,t:pw.top,w:pw.width,h:pw.height,f:!!pw.focused};}}catch(_){}
   hibBlankStart=!msg.rc133Popup;
   // The scan window keeps this size for its whole life (never grown over the browser): wide enough for a player to lay out at >=200x110.
   // Placed fully INSIDE the browser window, 30 px in from its upper-left, so no edge shows outside the browser.
   const hibSmall=hibGeo?{width:Math.min(560,hibGeo.w-60),height:Math.min(360,hibGeo.h-60),left:hibGeo.l+30,top:hibGeo.t+30}:{width:560,height:360};
   // The scan window opens in the SAME container as the tab the card is in: container / proxy / VPN extensions route a site to its container,
   // and a tab opened in another one is closed and reopened by them as a new focused tab.
   let hibPrevFocus=null;
   try{const lf=await browser.windows.getLastFocused();if(lf&&lf.focused&&lf.id!==undefined)hibPrevFocus=lf.id;}catch(_){}
   const hibWinOpts={url:'about:blank',type:(typeof HIB_DEBUG_WINDOW_TYPE==='string'?HIB_DEBUG_WINDOW_TYPE:'popup'),focused:false,...hibSmall};
   const hibWithStore=hibStore&&hibStore!=='firefox-default'?{...hibWinOpts,cookieStoreId:hibStore}:hibWinOpts;
   console.info('[HIB scan window]',{cookieStoreId:hibStore||'none',usingStore:hibWithStore!==hibWinOpts});
   // Scan surface: a background TAB (never active) next to the tab the card is in, in its container; closing it returns to that tab.
   const hibUseTab=!msg.rc133Popup&&priorTab!==null&&priorWindow!==null&&(typeof HIB_DEBUG_SCAN_SURFACE==='string'?HIB_DEBUG_SCAN_SURFACE:'tab')==='tab';
   if(hibUseTab){
    const tabOpts={url:'about:blank',active:false,windowId:priorWindow,openerTabId:priorTab,...(hibOrigIndex!==null?{index:hibOrigIndex+1}:{})};
    const withStore=hibStore&&hibStore!=='firefox-default'?{...tabOpts,cookieStoreId:hibStore}:tabOpts;
    console.info('[HIB scan tab]',{cookieStoreId:hibStore||'none',index:tabOpts.index,usingStore:withStore!==tabOpts});
    let t;try{t=await browser.tabs.create(withStore);}catch(e){console.warn('[HIB scan tab] container open failed, default container used',String(e));t=await browser.tabs.create(tabOpts);}
    popup={isTab:true,tabs:[t]};
   }
   else try{popup=msg.rc133Popup||(await hibRc293Acquire(target.href,hibWithStore)).win;}
   catch(e){console.warn('[HIB scan window] container open failed, default container used',String(e));hibRc293Owned.delete(hibRc293Key(target.href));popup=await hibRc293Acquire(target.href,hibWinOpts).then(r=>r.win);}
   // A new window takes OS focus and sits on top. If the user's browser window had focus, it is raised again over the scan window
   // (the same window, same tab: no tab or window is activated), so the scan window stays behind it.
   if(hibPrevFocus!==null&&popup?.id!=null){
    // The new window takes OS focus and sits on top. The browser window is raised over it (so the scan window stays behind the browser),
    // then the window the user was actually in (the browser itself, or their Settings window) gets focus back. If another PROGRAM had focus
    // (no Firefox window was focused) nothing is raised, so focus is never taken from it.
    const hibRaise=async()=>{
     if(priorWindow!==null)await browser.windows.update(priorWindow,{focused:true}).catch(()=>{});
     if(hibPrevFocus!==priorWindow)await browser.windows.update(hibPrevFocus,{focused:true}).catch(()=>{});
    };
    hibRaise();setTimeout(hibRaise,250);setTimeout(hibRaise,900);
   }
   const probe=popup?.tabs?.[0]?.id;
   if(!Number.isInteger(probe))throw new Error('popup tab unavailable');
   // From the first script of every document in the scan tab, window.open is blocked: a site that opens its own page in a new tab
   // (pop-under) would otherwise put that tab, focused, in the user's browser window. Other tabs only wait for the answer below.
   hibGuardProbe=probe;hibScanProbes.add(probe);
   try{hibGuardReg=await browser.contentScripts.register({matches:['<all_urls>'],allFrames:true,matchAboutBlank:true,runAt:'document_start',js:[{file:'scan_guard.js'}]});}catch(e){console.warn('[HIB scan guard] not registered',String(e));}
   hibPopListener=tab=>{
    if(tab.id===probe)return;
    if(tab.openerTabId===probe||(popup&&tab.windowId===popup.id)){
     console.info('[HIB RC346]',{status:'AD_TAB_CLOSED',url:String(tab.url||tab.pendingUrl||'').slice(0,80)});
     browser.tabs.remove(tab.id).catch(()=>{});
    }
   };
   browser.tabs.onCreated.addListener(hibPopListener);
   const hibIsEpisode=u=>{try{const x=new URL(u),t=new URL(target.href);const np=q=>q.pathname.replace(/[/]+$/,'');return x.origin===t.origin&&np(x)===np(t)&&x.search===t.search;}catch(_){return false;}};
   const hibKillStray=(tabId,why)=>{console.info('[HIB RC346]',{status:'STRAY_EPISODE_TAB_CLOSED',why});browser.tabs.remove(tabId).catch(()=>{});
   };
   hibStrayUpd=(tabId,change,tab)=>{if(tabId===probe||!change.url||tabId===priorTab)return;if(popup&&tab.windowId===popup.id)return;if(hibIsEpisode(change.url))hibKillStray(tabId,'updated');};
   hibStrayAct=a=>{if(a.tabId===probe||a.tabId===priorTab)return;browser.tabs.get(a.tabId).then(t=>{if(popup&&t.windowId===popup.id)return;if(hibIsEpisode(t.url||''))hibKillStray(a.tabId,'activated');}).catch(()=>{});};
   browser.tabs.onUpdated.addListener(hibStrayUpd);browser.tabs.onActivated.addListener(hibStrayAct);
   popupVttListener=details=>{
    if(details.tabId!==probe)return;
    try{const u=new URL(details.url);if(u.protocol==='https:' && (/[.](?:vtt|srt|ass|ssa)$/i.test(u.pathname)||/(?:subtitle|captions?|[/]subs?[/])/i.test(u.pathname)))popupVtt.urls.add(u.href);}catch(_){}
   };
   browser.webRequest.onBeforeRequest.addListener(popupVttListener,{urls:['<all_urls>']});
   /* START page fonts: styled (ASS) subtitles can name fonts the video page ships; remember those files so the player can use them (https only, at most 8) */
   popupFontListener=details=>{
    if(details.tabId!==probe||popupFonts.size>=8)return;
    try{const u=new URL(details.url);if(u.protocol==='https:'&&(details.type==='font'||/[.](?:woff2?|ttf|otf)$/i.test(u.pathname)))popupFonts.add(u.href);}catch(_){}
   };
   browser.webRequest.onBeforeRequest.addListener(popupFontListener,{urls:['<all_urls>']});
   /* END page fonts */
   popupManifestListener=details=>{
    if(details.tabId!==probe)return;
    try{const u=new URL(details.url);const p=u.pathname.toLowerCase();
     if(/^https?:$/.test(u.protocol)&&(p.endsWith('.m3u8')||p.endsWith('.mpd')||(p.startsWith('/hls/')&&(u.hostname===target.hostname||u.hostname.endsWith('.'+target.hostname))))){if(!popupNetManifests.has(u.href))console.info('[HIB RC295]',{status:'NET_MANIFEST_SEEN',host:u.hostname,path:u.pathname.slice(0,80)});popupNetManifests.add(u.href);}}catch(_){}
   };
   browser.webRequest.onBeforeRequest.addListener(popupManifestListener,{urls:['<all_urls>']});
   popupMediaListener=details=>{
    if(details.tabId!==probe)return;
    try{const u=new URL(details.url);const p=u.pathname.toLowerCase();
     if(/^https?:$/.test(u.protocol)&&(p.endsWith('.mp4')||p.endsWith('.webm')||p.endsWith('.m4v'))&&hibRc297SlugScore(u.href,target)>=2)popupNetMedia.add(u.href);}catch(_){}
   };
   browser.webRequest.onBeforeRequest.addListener(popupMediaListener,{urls:['<all_urls>']});
   // Muting applies to the tab even when the website creates additional media.
   // RC119: restore RC110 muted background discovery.
   await browser.tabs.update(probe,{muted:true}).catch(()=>{});
   if(hibBlankStart){
    await browser.tabs.update(probe,{url:target.href}).catch(()=>{});
   }
   // RC150 / TARGETED FIRST, FASTEST-FIRST UNIVERSAL PROBE.
   // This is a read-only preflight. The RC149 live playback loop below
   // retains exclusive responsibility for verifying playable media.
   let hibRc150Probe={engine:'custom',probes:[]};
   try{
    const saved=await HIBRC150.readProfile(target.hostname,target.pathname);
    const order=HIBRC150.buildPlan(saved);
    // RC284: do not run every engine when a previously identified engine exists.
    // A failed targeted probe may fall back to the original universal discovery.
    if(saved?.engine){
      hibRc150Probe=await HIBRC150.probeTab(probe,[saved.engine]);
      console.info('[HIB RC284]',{status:'SITE_PROFILE_TARGETED_PROBE',engine:saved.engine,detected:hibRc150Probe.engine});
      if(hibRc150Probe.engine==='custom'){
        hibRc150Probe=await HIBRC150.probeTab(probe,order.filter(id=>id!==saved.engine));
        console.info('[HIB RC284]',{status:'SITE_PROFILE_FALLBACK',detected:hibRc150Probe.engine});
      }
    }else hibRc150Probe=await HIBRC150.probeTab(probe,order);
    console.info('[HIB RC150 / ADAPTER DISPATCH]',{
     host:target.hostname,preferred:saved?.engine||null,
     detected:hibRc150Probe.engine,probes:hibRc150Probe.probes,
     elapsedMs:hibRc150Probe.elapsedMs});
   }catch(error){console.warn('[HIB RC150 / ADAPTER DISPATCH] FALLBACK',String(error));}
   if(HIB_DEBUG_STOP_AFTER){
    try{const ex=await browser.management.getAll();console.info('[HIB DEBUGSTOP]','extensions-that-can-touch-tabs',JSON.stringify(ex.filter(x=>x.enabled&&x.type==='extension'&&x.id!==browser.runtime.id&&(x.permissions||[]).some(q=>/^(tabs|webRequestBlocking|contextualIdentities|proxy)$/.test(q))).map(x=>x.name+' ['+x.id+'] '+(x.permissions||[]).filter(q=>/^(tabs|webRequestBlocking|contextualIdentities|proxy|webNavigation)$/.test(q)).join('/'))));}catch(e){console.info('[HIB DEBUGSTOP]','management unavailable',String(e));}
    const stages=['html5','jwplayer','videojs','plyr','hlsjs','dashjs','shaka','flowplayer','nplayer','iframe'];
    const snap=async label=>{try{const ws=await browser.windows.getAll({populate:true});console.info('[HIB DEBUGSTOP]',label,JSON.stringify(ws.map(w=>({id:w.id,type:w.type,focused:w.focused,tabs:(w.tabs||[]).map(t=>(t.active?'*':'')+t.id+' '+String(t.url||'').slice(0,60))}))));}catch(e){console.info('[HIB DEBUGSTOP]',label,'snapshot failed',String(e));}};
    await snap('before-load');
    for(let i=0;i<40;i++){try{const t=await browser.tabs.get(probe);if(t.status==='complete'&&/^https?:/.test(t.url||''))break;}catch(_){}await sleep(500);}
    await snap('page-loaded');
    // What the page shows, per frame: media elements, player markers, player libraries, iframes (no URLs beyond host+path).
    try{
     const ev=await browser.tabs.executeScript(probe,{allFrames:true,code:`(()=>{try{
      const w=window.wrappedJSObject||window;
      const q=s=>document.querySelectorAll(s).length;
      const allV=[...document.querySelectorAll('video,audio')];const vids={total:allV.length,live:allV.filter(v=>v.currentSrc||v.getAttribute('src')||v.readyState>0||v.getBoundingClientRect().width>0).slice(0,4).map(v=>({tag:v.tagName,src:(v.currentSrc||v.getAttribute('src')||'').slice(0,70),blob:String(v.src||'').startsWith('blob:'),ready:v.readyState,paused:v.paused,w:Math.round(v.getBoundingClientRect().width),h:Math.round(v.getBoundingClientRect().height)}))};
      const libs={};for(const k of ['jwplayer','videojs','Hls','dashjs','shaka','flowplayer','Plyr','DPlayer','NPlayer','Artplayer','MediaElementPlayer','fluidPlayer','Clappr','OpenPlayer'])try{if(typeof w[k]!=='undefined')libs[k]=typeof w[k];}catch(e){}
      const marks={jw:q('.jwplayer,.jw-video,[data-jwplayer-id]'),videojs:q('video-js,.video-js'),plyr:q('.plyr'),flow:q('.flowplayer,.fp-player'),nplayer:q('[class*=nplayer]'),dash:q('.dashjs-player,[class*=dash-]'),shaka:q('.shaka-video-container'),genericPlayer:q('[class*=player],[id*=player]'),iframes:q('iframe')};
      const frames=[...document.querySelectorAll('iframe')].slice(0,6).map(f=>{try{const u=new URL(f.src,location.href);return u.host+u.pathname.slice(0,40)+' '+Math.round(f.getBoundingClientRect().width)+'x'+Math.round(f.getBoundingClientRect().height);}catch(e){return 'bad';}});
      const scriptsHint=/jwplayer|videojs|hls\.js|dash\.js|shaka|flowplayer|plyr/i.exec([...document.scripts].map(x=>(x.src||'')+' '+(x.textContent||'').slice(0,3000)).join(' '));
      return {frame:location.host+location.pathname.slice(0,30),top:window.top===window,state:document.readyState,vids,libs,marks,frames,scriptHint:scriptsHint&&scriptsHint[0]};
     }catch(e){return {error:String(e)};}})()`});
     console.info('[HIB DEBUGSTOP]','page-evidence',JSON.stringify((ev||[]).map(x=>x?.result??x)));
    }catch(e){console.info('[HIB DEBUGSTOP]','page-evidence failed',String(e));}
    // Autoplay check (the same play test the full scan runs ~1 s in): does this origin allow media to start?
    try{const ap=await browser.tabs.executeScript(probe,{code:hibRc111PlaybackCode});console.info('[HIB DEBUGSTOP]','autoplay-preflight',JSON.stringify(ap?.[0]?.result??ap?.[0]??null));}catch(e){console.info('[HIB DEBUGSTOP]','autoplay-preflight inconclusive',String(e));}
    let stopProbe=null;
    try{stopProbe=await HIBRC150.probeTab(probe,stages.slice(0,stages.indexOf(HIB_DEBUG_STOP_AFTER)+1));}catch(e){stopProbe={error:String(e)};}
    console.info('[HIB DEBUGSTOP]','probe-done',{stopAfter:HIB_DEBUG_STOP_AFTER,detected:stopProbe.engine,probes:stopProbe.probes});
    await sleep(3000);
    await snap('3s-after-probe');
    hibTabLogUntil=Date.now()+15000;
    return {error:'debug stop after '+HIB_DEBUG_STOP_AFTER,debugStop:true,detected:stopProbe.engine,sources:[],frames:0,observations:[],autoplayPermission:null};
   }
   // RC134 / VIDEO HANDOFF: the independent landing observer already classified this popup.
   // Do not rescan landing, restart navigation, or create a replacement window.
   if(msg.rc133Popup)console.info('[HIB RC134 / VIDEO HANDOFF] EXISTING_POPUP_ADOPTED',{path:target.pathname,tabId:probe});
   // RC128: classify navigation-only pages in the SAME rendered discovery popup.
   // An uncertain page continues to the normal player-activation/verification loop.
   let landingDecisionMade=Boolean(msg.rc133Popup);
   let landingSeenAt=0; // RC134: landing-only observer already decided this popup
   // RC294 FIX: this injected script is a template string. Without String.raw, JavaScript consumed the
   // backslashes in its regexes (\s became s, \( became a bare paren), so the script had a syntax error,
   // every injection threw 'unterminated group' and the resolver looped for 60 s (popup discovery exhausted).
   // Only the NHPlayer path, which skips this classifier, still worked. Keep String.raw, and write line
   // breaks inside it as a backslash followed by n.
   const renderedLandingCode=String.raw`(() => {
    if(window.top!==window)return {inconclusive:true};
    const title=document.title||'';
    const frames=[...document.querySelectorAll('iframe[src],embed[src],object[data]')];
    const mediaFrame=frames.some(f=>{
     const raw=f.getAttribute('src')||f.getAttribute('data')||'';
     if(!raw||raw==='about:blank')return false;
     let u;try{u=new URL(raw,location.href);}catch(_){return false;}
     const hint=[u.pathname,f.id,f.className,f.title||'',f.getAttribute('allow')||''].join(' ').toLowerCase();
     if(/(?:adserver|magsrv|pemsrv|doubleclick|popunder|banner)/i.test(u.hostname))return false;
     if(/(?:player|embed|stream|video|jwplayer|hls)/i.test(hint))return true;
     const r=f.getBoundingClientRect();return r.width>=360&&r.height>=200&&r.width/r.height>=1.3;
    });
    const player=Boolean(document.querySelector('video,audio,source[src],video-js,.video-js,.jwplayer,.jw-video,[data-jwplayer-id],.plyr,.plyr__video-wrapper,.flowplayer,.fp-player,.dplayer,.art-video-player'));
    const scripts=[...document.scripts].map(s=>(s.textContent||'').slice(0,50000)).join('\n');
    const bootstrap=/(?:jwplayer\s*\(|videojs\s*\(|new\s+Plyr\s*\(|new\s+Hls\s*\(|new\s+DPlayer\s*\(|\.setup\s*\(\s*\{[\s\S]{0,1000}(?:sources|file)\s*:)/i.test(scripts);
    const links=new Set([...document.querySelectorAll('a[href]')].map(a=>{
     try{const u=new URL(a.getAttribute('href'),location.href);return u.origin===location.origin&&/\/videos\/[^/]+\/?$/i.test(u.pathname)?u.href:null;}catch(_){return null;}
    }).filter(Boolean));
    const heading=[...document.querySelectorAll('h1,h2,h3,h4,h5,[role="heading"]')].some(h=>/(?:episode\s*(?:list|selection|guide)|select\s+(?:an?\s+)?episode)/i.test(h.textContent||''));
    const selector=Boolean(document.querySelector('.episode-list,.episodes-list,.episode-listing,.episodelist,[id*="episode-list"],[class*="episode-list"],[class*="episodes-list"]'));
    const evidence=!player&&!mediaFrame&&links.size>=1&&(heading||selector);
    return {complete:document.readyState!=='loading' && Boolean(document.body),evidence,player:player||mediaFrame,scriptHint:bootstrap,episodeCount:links.size,title,href:location.href};
   })()`;
   const began=Date.now(),deadline=began+30000;/* RC448: was 45 s (a scan that cannot find a video gave up after 45-50 s: spins for a minute) */let hibScrolls=0;let usableSince=0;let hibAutoplayChecked=false,hibForcePermission=false;let hibClicks=0,hibClickTries=0,hibNextClickAt=began+1200;let hibKnownPath=null;try{const k=new URL(msg.knownSource);hibKnownPath=hibFileKey(k.href);}catch(_){}   /* RC467: REFRESH of an episode HIB already verified once (its saved address ran out): the same file with a new signature is accepted as soon as the page's player config names it, without waiting for the video to play again */
   const hibKnownHit=h=>{if(!hibKnownPath||h.kind!=='configSource')return false;try{return hibFileKey(h.url)===hibKnownPath;}catch(_){return false;}};
      /* RC465: first click round at 1.2 s (was 3 s); a round that finds no play control is not counted */let hibFramePrep=0;let hibRetry=0;let hibProbeTries=0;
   /* RC468: FAST REFRESH. An episode HIB already verified keeps its player type, page and file path (the saved address only lost its short-lived signature).
    * Instead of the full discovery loop (each round samples playback for ~1.5 s), a light probe runs every ~150 ms in every frame: it clicks the player's play control
    * (at most every 700 ms, never while a video is already moving) and returns the moment a <video> shows the SAME file path with a new signature. That address is put
    * into the history as the player's configured source; the normal checks below still run on it (reachability, ad filter). Nothing is accepted from a different file. */
   if(hibKnownPath){
    const fastEnd=Date.now()+14000;let lastFastClick=0;
    const fastCode=(known,doClick)=>"(()=>{try{const known="+JSON.stringify(known)+";let playing=false,hit=null;for(const v of document.querySelectorAll('video')){const s=v.currentSrc||v.src||'';if(!s)continue;if(v.currentTime>0.3&&!v.paused)playing=true;try{const u=new URL(s,location.href);if(u.origin+'|'+u.pathname.split('/').filter(Boolean).slice(-2).join('/')===known&&!hit)hit={src:u.href,frame:location.href,rs:v.readyState,dur:Number.isFinite(v.duration)?v.duration:0,w:v.videoWidth||0,h:v.videoHeight||0};}catch(e){}}"+
     "if(hit)return hit;if("+(doClick?"true":"false")+"&&!playing){const sel=['.play','.jw-icon-display','.jw-display-icon-container','.vjs-big-play-button','.fp-play','.plyr__control--overlay','button[aria-label*=Play i]','[class*=play-btn i]','[class*=bigplay i]'];for(const q of sel){const e=document.querySelector(q);if(!e)continue;const r=e.getBoundingClientRect();if(r.width<8||r.height<8)continue;for(const ev of ['pointerdown','mousedown','pointerup','mouseup','click'])e.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true,view:window}));try{e.click();}catch(x){}break;}}return null;}catch(e){return null;}})()";
    while(Date.now()<fastEnd){
     const doClick=Date.now()-lastFastClick>=700;if(doClick)lastFastClick=Date.now();
     let rows=[];try{rows=await browser.tabs.executeScript(probe,{allFrames:true,code:fastCode(hibKnownPath,doClick)});}catch(_){}
     const hit=(rows||[]).map(x=>x&&typeof x==='object'&&'result' in x?x.result:x).find(x=>x&&x.src);
     if(hit){
      history.set(hit.src,{url:hit.src,kind:'configSource',frame:hit.frame,firstSeenMs:Date.now()-began-400,seenAtWall:Date.now()-400,observations:1,maxMediaTime:0,maxAdvance:0,playAttempts:0,readyState:hit.rs||0,maxDuration:hit.dur||0,w:hit.w,h:hit.h,visibility:true});
      console.info('[HIB RC346]',{status:'FAST_REFRESH_SOURCE',elapsedMs:Date.now()-began,path:hibKnownPath.slice(-40)});
      break;
     }
     await new Promise(r=>setTimeout(r,150));
    }
   }
   while(Date.now()<deadline){
    // RC131: do not invoke the video scanner until a ONE-TIME DOM classification.
    // A page that has not rendered its body is not classified yet.
    await new Promise(r=>setTimeout(r,180));
    if(!landingDecisionMade){
     let info;
     try{
      const landingRows=await browser.tabs.executeScript(probe,{code:renderedLandingCode});
      info=landingRows?.[0]?.result ?? landingRows?.[0];
     }catch(e){
      // Firefox may reject injection while the destination navigates. Wait for DOM.
      console.info('[HIB RC131] LANDING_WAIT_DOM',String(e));
      continue;
     }
     if(!info?.complete)continue;
     // Ignore stale/redirected snapshots; the destination must be the requested page.
     let samePage=false;
     try{const u=new URL(info.href);samePage=u.origin===target.origin && u.pathname.replace(/\/$/,'')===target.pathname.replace(/\/$/,'');}catch(_){}
     if(!samePage)continue;
     if(info.evidence&&!info.player&&!landingSeenAt)landingSeenAt=Date.now();
     if(info.evidence&&!info.player&&Date.now()-landingSeenAt<10000){continue;}
     landingDecisionMade=true;
     console.info('[HIB RC131] LANDING_CLASSIFIED_ONCE',{
      path:target.pathname,landing:!!info.evidence,episodes:info.episodeCount,
      player:!!info.player,scriptHint:!!info.scriptHint,elapsedMs:Date.now()-began
     });
     if(info.evidence && !info.player){
      console.info('[HIB RC131] LANDING_EARLY_EXIT',{path:target.pathname,episodes:info.episodeCount,elapsedMs:Date.now()-began});
      return {...last,ok:false,landing:true,verified:false,episodeCount:info.episodeCount,
       popupAttempted:true,error:null};
     }
     // Otherwise run the existing player activation / media discovery loop.
    }
    if(hibScrolls<2&&Date.now()-began>(hibScrolls?6000:1500)&&(hibScrolls===0||history.size===0)){hibScrolls++;
     await browser.tabs.executeScript(probe,{code:`(()=>{try{const el=document.querySelector('video,iframe[src*="player"],iframe[src*="embed"],iframe[src*="stream"],.video-js,.jwplayer,.plyr,#player,.player');if(el)el.scrollIntoView({block:'center'});else window.scrollBy(0,Math.round(innerHeight*0.6));window.dispatchEvent(new Event('scroll'));return !!el;}catch(e){return false;}})()`}).catch(()=>{});
     console.info('[HIB RC346]',{status:'LAZY_PLAYER_SCROLL_DONE',elapsedMs:Date.now()-began});
    }
    if(tick%3===0)browser.tabs.update(probe,{muted:true}).catch(()=>{});
    browser.tabs.executeScript(probe,{allFrames:true,code:"(()=>{try{const w=window.wrappedJSObject;if(w&&!w.__hibNoPop){w.__hibNoPop=true;w.open=exportFunction(function(){return null;},window);}}catch(e){}})()"}).catch(()=>{});
    if(tick%2===1&&tick<24)browser.tabs.executeScript(probe,{allFrames:true,code:"(()=>{try{ if(window.__hibAdClosedAt&&Date.now()-window.__hibAdClosedAt<15000)return false; const exact=/^(?:skip|skip ad|skip ads|close|close ad|dismiss|no thanks|continue to video|continue|x|\u00d7|\u2715)$/i; const phrase=/(?:close ads?\\b|close ad\\s*&|continue to (?:the )?(?:site|video|website)|skip (?:the )?ads?\\b|enter site|i am 18|i'm 18|enter)/i; for(const el of document.querySelectorAll('button,[role=button],a,div,span')){ if(el.children.length>3)continue; const t=(el.innerText||el.getAttribute('aria-label')||el.title||'').replace(/\\s+/g,' ').trim(); if(!t||t.length>60)continue; const isPhrase=phrase.test(t)&&!/^(?:enter)$/i.test(t); if(!isPhrase&&!exact.test(t))continue; const cs=getComputedStyle(el),r=el.getBoundingClientRect(); if(r.width<8||r.height<8||cs.visibility==='hidden'||cs.display==='none')continue; if(!isPhrase&&(r.width>220||r.height>90))continue; if(isPhrase&&(r.width>700||r.height>150))continue; let ov=false;for(let p=el;p&&p!==document.body;p=p.parentElement){const ps=getComputedStyle(p).position;if(ps==='fixed'||ps==='absolute'||ps==='sticky'){const b=p.getBoundingClientRect();if(b.width*b.height>=0.5*innerWidth*innerHeight){ov=true;break;}}} if(!ov)continue; if(el.tagName==='A'&&el.href){try{if(new URL(el.href,location.href).origin!==location.origin)continue;}catch(e){continue;}} const tgt=el.matches('button,[role=button],a')?el:(el.querySelector('button,[role=button],a')||el); for(const ev of ['pointerdown','mousedown','pointerup','mouseup','click'])tgt.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true,view:window})); try{tgt.click();}catch(e){} window.__hibAdClosedAt=Date.now(); return t;}}catch(e){}return false;})()"}).then(r=>{const hit=(r||[]).map(x=>x?.result??x).find(x=>x);if(hit)console.info('[HIB RC322]',{status:'AD_OVERLAY_CLOSED',text:hit});}).catch(()=>{});
    if(tick%3===0)browser.tabs.executeScript(probe,{allFrames:true,code:"(()=>{try{for(const v of document.querySelectorAll('video,audio')){v.muted=true;v.volume=0;}}catch(e){}})()"}).catch(()=>{});
    if(hibRetry<2&&Date.now()-began>(hibRetry?8000:3000)&&![...history.values()].some(h=>h.maxAdvance>=0.5)){hibRetry++;browser.tabs.executeScript(probe,{allFrames:true,code:"(()=>{try{let n=0;const pw=window.wrappedJSObject||window; for(const v of document.querySelectorAll('video,audio')){ if(v.currentTime>0.3&&!v.paused)continue; n++;try{v.muted=true;v.volume=0;v.pause();}catch(e){} setTimeout(()=>{try{v.muted=true;v.volume=0;const pr=v.play();if(pr&&pr.catch)pr.catch(()=>{});}catch(e){}},1000); } try{if(typeof pw.jwplayer==='function'){const j=pw.jwplayer();if(j&&j.getState&&j.getState()!=='playing'){n++;j.pause&&j.pause(true);setTimeout(()=>{try{j.play&&j.play(true);}catch(e){}},1000);}}}catch(e){} return n;}catch(e){return -1;}})()"}).then(r=>console.info('[HIB RC346]',{status:'PAUSE_PLAY_RETRY',attempt:hibRetry,frames:(r||[]).map(x=>x?.result??x)})).catch(()=>{});}
    if(hibRc150Probe.engine==='custom'&&hibProbeTries<3&&Date.now()-began>(1400+hibProbeTries*3500)){hibProbeTries++;
     try{const sv=await HIBRC150.readProfile(target.hostname,target.pathname);hibRc150Probe=await HIBRC150.probeTab(probe,HIBRC150.buildPlan(sv));
      console.info('[HIB RC346]',{status:'PLAYER_TYPE_PROBE',attempt:hibProbeTries,detected:hibRc150Probe.engine,probes:hibRc150Probe.probes.map(x=>x.id+':'+x.status).join(',')});}catch(_){}}
    if(hibFramePrep<2&&Date.now()-began>(hibFramePrep?2200:800)){hibFramePrep++;browser.tabs.executeScript(probe,{code:"(()=>{let n=0;try{for(const f of document.querySelectorAll('iframe')){const a=(f.getAttribute('allow')||'');if(/autoplay/i.test(a))continue;const bb=f.getBoundingClientRect();if(bb.width<360||bb.height<200)continue;f.setAttribute('allow',(a?a+'; ':'')+'autoplay; fullscreen; encrypted-media');const src=f.getAttribute('src');if(src&&src!=='about:blank'&&f.getBoundingClientRect().width>=200){f.setAttribute('src','about:blank');setTimeout(()=>f.setAttribute('src',src),60);}n++;}}catch(e){}return n;})()"}).then(r=>console.info('[HIB RC346]',{status:'IFRAMES_AUTOPLAY_ALLOWED',count:r&&r[0]})).catch(()=>{});}
    // RC448: click rounds are counted only when something was really clicked (a round that finds no play control, e.g. while a heavy iframe embed is still
    // loading, used to use up the 3 rounds by 9 s and nothing was ever clicked again). Rounds repeat every 2.5 s, at most 14 tries, 3 real clicks.
    if(hibClicks<3&&hibClickTries<14&&Date.now()>=hibNextClickAt&&![...history.values()].some(h=>h.maxAdvance>=1)){hibClickTries++;hibNextClickAt=Date.now()+1800;browser.tabs.executeScript(probe,{allFrames:true,code:"(()=>{try{ const big=el=>{const r=el.getBoundingClientRect();return r.width>=200&&r.height>=110;}; const fire=(el,x,y)=>{for(const ev of ['pointerdown','mousedown','pointerup','mouseup','click'])el.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true,clientX:x,clientY:y,view:window}));try{el.click();}catch(e){}}; const vids=[...document.querySelectorAll('video')]; const v=vids.find(big); /* RC447: a play/pause button is a TOGGLE. Never click while a video is already playing (a second round used to pause xanimeporn's video that the first round had just started), and a big video that has its source loaded but sits paused is started with play(), not with another toggle click. */ if(vids.some(x=>!x.paused&&!x.ended&&x.readyState>=2))return false; const loadedPaused=vids.find(x=>big(x)&&x.currentSrc&&x.readyState>=2&&x.paused&&!x.ended); if(loadedPaused){try{loadedPaused.play().catch(()=>{});}catch(e){} return 'play-loaded-video';} const sels=['.vjs-big-play-button','.jw-display-icon-container','.jw-icon-display','.plyr__control--overlaid','[class*=\"big-play\"]','[class*=\"play-button\"]','[class*=\"playbutton\"]','[class*=\"play-overlay\"]','[class*=\"play_button\"]','[aria-label=\"Play\"]','button[title=\"Play\"]','.fp-play','.play-btn','#play','.play']; for(const q of sels){const el=document.querySelector(q);if(el&&el.getBoundingClientRect().width>8){el.click();return 'clicked '+q;}} const emptyVideo=vids.length>0&&vids.every(x=>!x.currentSrc&&x.readyState===0); if(!vids.length&&window.top!==window&&innerWidth<200)return false; /* RC501: a player's own 'Continue watching? You were at 0:29 [Continue] [Restart]' prompt (nhentai34) has to be answered before the video starts: such a button is clicked, but only inside a player / video container (never a site-level 'Continue' of an age gate or consent banner). */ const inPlayer=el=>{const c=el.closest('[class*=player],[id*=player],[class*=video],[id*=video],.plyr,.jwplayer,.video-js,.fp-ui,[class*=embed]');return !!c&&c!==document.body&&c!==document.documentElement;}; let labelled=null; for(const el of document.querySelectorAll('div,span,button,a,svg,i')){const t=(el.innerText||el.getAttribute('aria-label')||el.title||'').trim();if((/^(play|watch|click to play|play video)$/i.test(t)||(/^(continue|resume|continue watching|restart)$/i.test(t)&&inPlayer(el)))&&el.children.length<4){const r=el.getBoundingClientRect();if(r.width>8&&r.height>8&&r.width<innerWidth+5){labelled=el;break;}}} if(labelled){const r=labelled.getBoundingClientRect();fire(labelled,r.left+r.width/2,r.top+r.height/2);return 'clicked-label';} if(emptyVideo||(v&&!v.currentSrc&&v.readyState===0)){ const cx=Math.round(innerWidth/2),cy=Math.round(innerHeight/2); const top=document.elementFromPoint(cx,cy)||v; fire(top,cx,cy); try{(v||vids[0]).play().catch(()=>{});}catch(e){} return 'clicked-center:'+(top&&top.tagName)+'.'+String(top&&top.className).slice(0,30);} return false;}catch(e){return 'err';}})()"}).then(r=>{const res=(r||[]).map(x=>x?.result??x);if(res.some(Boolean))hibClicks++;console.info('[HIB RC346]',{status:'PLAY_ACTIVATION',clicks:hibClicks,tries:hibClickTries,result:res});}).catch(()=>{});}
    if(Date.now()-began>8000&&![...history.values()].some(h=>!hibRc297LooksLikeAd(h))){
     try{
      // SOURCE DOWN: the player (or the page itself) shows an error page such as "404 - Not found". Nothing can be played now,
      // but the source may come back, so report it like a landing page (apostrophe) and let the card be retried later.
      const deadRows=await browser.tabs.executeScript(probe,{allFrames:true,code:`(() => {
       const t=((document.body&&document.body.innerText)||'').replace(/ +/g,' ').trim().slice(0,400);
       const bad=/(404|not found|file not found|no longer available|unavailable|has been removed|was deleted|does not exist)/i.test((document.title||'')+' '+t);
       return bad&&t.length<350&&(window.top===window||(innerWidth>=300&&innerHeight>=150))?{down:true,text:t.slice(0,80),href:location.href,top:window.top===window}:null;
      })()`});
      const dead=(deadRows||[]).map(r=>r?.result??r).find(r=>r&&r.down);
      if(dead){
       console.info('[HIB RC297]',{status:'SOURCE_DOWN',frame:dead.href,text:dead.text,elapsedMs:Date.now()-began});
       return {...last,ok:false,landing:true,reason:'source-down',verified:false,episodeCount:0,popupAttempted:true,error:null};
      }
      const res=await browser.tabs.executeScript(probe,{code:`(() => {
       const ok=/^(watch|play|stream|start watching)([ ]+[a-z0-9]+){0,3}[ !>]*$/i;
       const inMenu=el=>!!el.closest('nav,header,footer,[role="navigation"],.menu,.navbar,.nav,.sidebar');
       const txt=el=>(el.innerText||el.textContent||'').replace(/[^A-Za-z0-9 ]+/g,' ').replace(/ +/g,' ').trim();
       const visible=el=>{const r=el.getBoundingClientRect();return r.width>20&&r.height>10&&getComputedStyle(el).visibility!=='hidden';};
       const big=el=>{const r=el.getBoundingClientRect();return r.width>=300&&r.height>=170;};
       const notPreview=el=>!/(preview|teaser|trailer|thumb|[/]ads?[/])/i.test((el.currentSrc||el.getAttribute('src')||'')+' '+[...el.querySelectorAll('source[src]')].map(s=>s.getAttribute('src')).join(' '));
       const players=[...document.querySelectorAll('video,video-js,.video-js,.jwplayer,.jw-video,[data-jwplayer-id],.plyr,.plyr__video-wrapper,.flowplayer,.fp-player,.dplayer,.art-video-player')].filter(el=>big(el)&&notPreview(el));
       const frames=[...document.querySelectorAll('iframe[src],embed[src],object[data]')].filter(f=>{const r=f.getBoundingClientRect();return r.width>=360&&r.height>=200&&/(player|embed|stream|video)/i.test((f.getAttribute('src')||f.getAttribute('data')||'')+' '+(f.className||'')+' '+(f.id||''));});
       if(players.length||frames.length)return {landing:false};
       const button=[...document.querySelectorAll('a[href],button,[role="button"],.btn,.button')].filter(el=>{const t=txt(el);return t&&t.length<=30&&ok.test(t)&&visible(el)&&!inMenu(el);})[0];
       const eps=new Set();
       for(const a of document.querySelectorAll('a[href]')){
        const t=(a.textContent||'')+' '+(a.getAttribute('title')||'')+' '+(a.querySelector('img')?.alt||'');
        if(/episode[ ]*[0-9]+/i.test(t)){try{const u=new URL(a.href);if(u.origin===location.origin&&u.pathname!==location.pathname)eps.add(u.href);}catch(e){}}
       }
       const gated=/(premium members only|members only|(log ?in|sign ?in|subscribe) to (watch|view|play))/i.test((document.body&&document.body.innerText)||'');
       return {landing:gated||!!button||eps.size>=3,gated:gated,button:button?txt(button):null,episodes:eps.size};
      })()`});
      const info=res&&res[0];
      if(info&&info.landing&&(info.gated||Date.now()-began>15000)){
       // LANDING PAGE: no video is ready to play (no real-size player), and the page offers a Watch / Play button or a list
       // of episodes. Report it at once: the bridge closes this popup and the card is marked with an apostrophe.
       console.info('[HIB RC297]',{status:'LANDING_PAGE',button:info.button,episodes:info.episodes,elapsedMs:Date.now()-began});
       return {...last,ok:false,landing:true,reason:info.gated?'members-only':'no-video-ready',verified:false,episodeCount:info.episodes||0,popupAttempted:true,error:null};
      }
     }catch(_){}
    }
    let rows;
    try{await browser.tabs.executeScript(probe,{code:'window.__hibNetManifests='+JSON.stringify([...popupNetManifests].slice(-12))+';window.__hibNetMedia='+JSON.stringify([...popupNetMedia].slice(-6))+';'});}catch(_){}
    try{rows=await browser.tabs.executeScript(probe,{allFrames:true,code:`(async()=>{
     const items=[];const add=(raw,kind,el)=>{if(!raw)return;try{
      const u=new URL(raw,location.href);if(!/^https?:$/.test(u.protocol))return;
      items.push({url:u.href,kind,readyState:el?.readyState??null,
       currentTime:el?.currentTime??null,duration:Number.isFinite(el?.duration)?el.duration:null,
       paused:el?.paused??null,w:Math.round(el?.getBoundingClientRect?.().width||0),h:Math.round(el?.getBoundingClientRect?.().height||0)});}catch(_){}};
     const els=[...document.querySelectorAll('video,audio')];
     // RC295: the playing / MSE element, not simply the first (empty) one.
     const hibMainEl=els.find(e=>!e.paused&&e.readyState>=2)||els.find(e=>String(e.src||'').startsWith('blob:'))||els[0]||null;
     for(const el of els){
      // RC116: preserve website/player audio state during diagnostics.
      const key='__hibRC73';let state=el[key];
      if(!state)state=el[key]={attempts:0,lastTry:0,errors:[],originTime:el.currentTime||0,maxAdvance:0};
      state.maxAdvance=Math.max(state.maxAdvance,Math.max(0,(el.currentTime||0)-state.originTime));
      // RC114: a site player can leave paused=false while never attaching a
      // source (readyState=0). After a grace period retry pause/play once,
      // replicating the user's working manual recovery. Never claim success
      // until the existing currentTime/readyState verification passes.
      // RC115 TEST: stage an initial paused period rather than issuing play()
      // immediately while an embedded player is still initializing.
      if(!state.firstSeen){
       state.firstSeen=Date.now();
       state.initialPauseUntil=state.firstSeen+1000;
       if(el.readyState<2 || !el.currentSrc){
        try{el.pause();console.info('[HIB RC115] INITIAL_PAUSE',location.origin);}catch(_){}
       }else{
        // Do not interrupt media that has already initialized and is playing.
        state.initialPauseUntil=state.firstSeen;
       }
      }
      const initialPauseElapsed=Date.now()>=state.initialPauseUntil;
      // RC117: JW Player owns source attachment. Native video.play() cannot
      // activate a configured JW playlist while its media element is empty.
      // Use the public player API once on an idle, configured instance, and
      // leave existing HTML5/video.js and verified-playing media unchanged.
      let jwActivationPending=false;
      if(initialPauseElapsed && !el.currentSrc && el.readyState===0 &&
         !state.jwActivationTried){
       try{
        // Firefox MV2 tabs.executeScript runs in an isolated extension world.
        // JW Player is created by the PAGE inside its own iframe, so window.jwplayer
        // can be absent here despite being present in the developer console.
        // Firefox's wrappedJSObject provides explicit access to the page world.
        const pageWindow=window.wrappedJSObject||window;
        const jw=typeof pageWindow.jwplayer==='function'?pageWindow.jwplayer:null;
        if(jw){
         const player=jw();
         const item=player?.getPlaylistItem?.();
         const sources=item?.sources;
         const sourceConfigured=Boolean(item?.file || (sources && Array.from(sources).some(s=>s?.file)));
         let ownsVideo=false;
         try{ownsVideo=Boolean(player?.getContainer?.()?.contains(el));}catch(_){}
         // This code is already injected into every frame. Never act on a JW
         // player from another frame, nor on an unrelated player in this frame.
         if(ownsVideo && sourceConfigured && player?.getState?.()==='idle' && typeof player.play==='function'){
          state.jwActivationTried=true;
          state.jwActivationAt=Date.now();
          jwActivationPending=true;
          console.info('[HIB RC118] JW_IDLE_ACTIVATE',location.href);
          const requested=player.play();
          if(requested && typeof requested.then==='function'){
           Promise.resolve(requested).catch(e=>state.errors.push((e?.name||'Error')+': '+(e?.message||String(e))));
          }
         }
        }
       }catch(e){state.errors.push('JW frame activation: '+(e?.message||String(e)));}
      }
      // Give JW Player time to attach its source after activation. Avoid
      // counteracting it with an immediate empty-video pause/play.
      if(state.jwActivationAt && Date.now()-state.jwActivationAt<5000)jwActivationPending=true;
      const stalledWithoutSource=!el.paused && !el.currentSrc &&
       !el.getAttribute('src') && el.readyState===0 &&
       Date.now()-state.firstSeen>=4500 && !state.sourceRecoveryDone;
      if(stalledWithoutSource && !jwActivationPending){
       state.sourceRecoveryDone=true;
       try{el.pause();console.info('[HIB RC114] SOURCELESS_PAUSE_PLAY_RETRY',location.origin);}catch(_){}
      }
      if(initialPauseElapsed && !jwActivationPending && state.attempts<3 && (el.paused || stalledWithoutSource) && Date.now()-state.lastTry>=2200){
       state.attempts++;state.lastTry=Date.now();
       const p=Object.values(window.videojs?.getPlayers?.()||{}).find(p=>{try{return p?.el?.()?.contains(el);}catch(_){return false;}});
       try{const result=p?.play?.()??el.play();
        Promise.resolve(result).catch(e=>{state.errors.push((e?.name||'Error')+': '+(e?.message||String(e)));});}
       catch(e){state.errors.push((e?.name||'Error')+': '+(e?.message||String(e)));}
      }
      add(el.currentSrc,'currentSrc',el);add(el.getAttribute('src'),'src',el);
      for(const child of el.querySelectorAll('source[src]'))add(child.getAttribute('src'),'source',el);
     }
     // Video MSE players expose blob: URLs. The HLS manifest is in resource timing.
     for(const item of performance.getEntriesByType('resource')){
      try{const u=new URL(item.name);if(/^https?:$/.test(u.protocol)&&/\.m3u8$/i.test(u.pathname))add(u.href,'hlsManifest',hibMainEl);}catch(_){}
     }
     // RC297: the Freedom/Flowplayer WordPress plugin keeps the episode in data-item; ads may play first in the same <video>.
     for(const root of document.querySelectorAll('.flowplayer[data-item]')){
      try{const cfg=JSON.parse(root.getAttribute('data-item')||'null');
       for(const s of ((cfg&&cfg.sources)||[]))if(s&&s.src&&/mp4|webm|m3u8|mpd/i.test(String(s.type||'')+' '+String(s.src)))add(s.src,'configSource',root);
      }catch(_){}
     }
     for(const m of (window.__hibNetMedia||[]))add(m,'netMedia',null);
     try{const pwj=window.wrappedJSObject||window;if(typeof pwj.jwplayer==='function'){const jp=pwj.jwplayer();const pl=(jp&&jp.getPlaylist&&jp.getPlaylist())||[];
      for(const it of Array.from(pl)){for(const so of Array.from((it&&it.sources)||[])){if(so&&so.file)add(String(so.file),'configSource',null);}if(it&&it.file)add(String(it.file),'configSource',null);}}}catch(_){}
     try{let sn=0;const seenS=new Set();const bs=String.fromCharCode(92);
      for(const sc of document.scripts){const raw=sc.textContent||'';if(raw.length<30||raw.length>900000)continue;
       const tx=raw.split(bs+'/').join('/');
       for(const m of (tx.match(/https?:[/][/][A-Za-z0-9%_.~:/?#@!$&()*+,;=-]+/g)||[])){
        if(sn>=30)break;
        try{const u=new URL(m);if(/[.](?:mp4|m3u8|webm|mpd)[/]?$/i.test(u.pathname)&&!seenS.has(u.href))   /* 3.0.1: a trailing slash is allowed (KVS players: .../video_720p.mp4/?token) - before, the other resolutions listed in the page were never seen and only the playing 360p was left */{seenS.add(u.href);add(u.href,'scriptSource',null);sn++;}}catch(_){}
       }}
     }catch(_){}
     // RC295: playlists seen on the network. some players serve HLS from an extension-less path, so
     // anything without a known extension must really start with #EXTM3U before it counts.
     const netOk=window.__hibNetVerified||(window.__hibNetVerified=new Map());
     for(const m of (window.__hibNetManifests||[])){
      let ok=true;
      try{const pn=new URL(m).pathname.toLowerCase();
       if(!pn.endsWith('.m3u8')&&!pn.endsWith('.mpd')){
        if(!netOk.has(m)){let good=false;
         try{const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),3500);
          const r=await fetch(m,{credentials:'same-origin',cache:'force-cache',signal:ctl.signal});clearTimeout(tm);
          if(r.ok){const txt=(await r.text()).slice(0,64);good=txt.trimStart().startsWith('#EXTM3U');}}catch(_){}
         netOk.set(m,good);}
        ok=netOk.get(m);}
      }catch(_){ok=false;}
      if(ok)add(m,'hlsManifest',hibMainEl);
     }
     for(const p of Object.values(window.videojs?.getPlayers?.()||{})){
      try{const el=p?.el?.()?.querySelector('video,audio');add(p?.currentSrc?.(),'videojs',el);}catch(_){}}
     // Discover subtitle URLs from real player elements and resource requests.
     // URLs remain in memory only during this popup's discovery session.
     const captionUrls=new Set();
     const addCaption=raw=>{try{const u=new URL(raw,location.href);if(u.protocol==='https:' && (/[.](?:vtt|srt|ass|ssa)$/i.test(u.pathname)||/(?:caption|subtitle|[/]subs?[/])/i.test(u.pathname)))captionUrls.add(u.href);}catch(_){}};
     for(const t of document.querySelectorAll('track[src],a[href*=".vtt"],source[type="text/vtt"]'))addCaption(t.src||t.href||t.getAttribute('src'));
     for(const e of performance.getEntriesByType('resource'))addCaption(e.name);
     return {href:location.href,visibility:document.visibilityState,ready:document.readyState,
      captionUrls:[...captionUrls].slice(0,30),
      playerError:(()=>{try{const pe=document.querySelector('.vjs-error-display .vjs-modal-dialog-content,.vjs-error-display,.jw-error-msg,.jw-error .jw-title-primary,[class*="player-error"],[class*="video-error"]');return pe&&pe.getBoundingClientRect().width>0?String(pe.textContent||'').replace(/ +/g,' ').trim().slice(0,160):'';}catch(e){return '';}})(),
      videoCount:els.length,sources:items,playback:els.map(el=>({
       attempts:el.__hibRC73?.attempts||0,errors:[...(el.__hibRC73?.errors||[]),...(el.error?['MediaError code '+el.error.code+': '+String(el.error.message||'').slice(0,80)]:[])],
       advanced:el.__hibRC73?.maxAdvance||0,paused:el.paused,readyState:el.readyState}))};
    })()`});}
    catch(e){errors.add(String(e));continue;}
    // RC75: run the existing diagnostics in every accessible frame while the
    // actual popup player is alive. Preserve their results for later inspection.
    if(++tick%4===0){
     const snapshot={atMs:Date.now()-began,frames:[]};
     for(const [name,file] of [['player','diag_player.js'],['sources','diag_sources.js']]){
      try{
       const diagRows=await browser.tabs.executeScript(probe,{allFrames:true,file});
       snapshot[name]=(diagRows||[]).map(x=>x?.result??x);
      }catch(e){snapshot[name+'Error']=String(e);errors.add(name+': '+String(e));}
     }
     diagnosticSnapshots.push(snapshot);
     if(diagnosticSnapshots.length>25)diagnosticSnapshots.shift();
    }
    if(!hibAutoplayChecked&&Date.now()-began>1000){hibAutoplayChecked=true;
     try{const okAt=hibRc312AutoplayOk.get(target.origin);
      if(!(okAt&&Date.now()-okAt<10*60*1000)){
       const pr=await browser.tabs.executeScript(probe,{code:hibRc111PlaybackCode});const st=pr?.[0]?.result??pr?.[0];
       if(st==='allowed')hibRc312AutoplayOk.set(target.origin,Date.now());
       else if(st==='NotAllowedError'){
        rc114PermissionState='NotAllowedError';hibForcePermission=true;
        const blockedAnswer={...last,ok:false,verified:false,autoplayPermission:{status:'site-allow-required',requestedOrigin:target.origin},popupAttempted:true};
        console.info('[HIB RC346]',{status:'AUTOPLAY_BLOCKED_PREFLIGHT',origin:target.origin});
        if(msg.permissionRetry||(hibPermTried.has(target.origin)&&Date.now()-hibPermTried.get(target.origin)<600000))return blockedAnswer;
        const after=await hibRc108PermissionFlow({target,priorWindow,priorTab,store:hibStore,closeScan:async()=>{
          if(popup?.id!=null)await browser.windows.remove(popup.id).catch(()=>{});
          else if(popup?.isTab&&hibGuardProbe!==null)await browser.tabs.remove(hibGuardProbe).catch(()=>{});
          popup=null;}});
        if(after==='allowed')return {...last,ok:false,verified:false,autoplayPermission:{status:'allowed-after-close',requestedOrigin:target.origin},popupAttempted:true};
        if(after==='NotAllowedError')return blockedAnswer;
        return {...last,ok:false,verified:false,autoplayPermission:{status:'recheck-after-close',requestedOrigin:target.origin,probeResult:after},popupAttempted:true};
       }
      }
     }catch(_){}
    }
    const frames=rows.map(x=>x?.result??x).filter(Boolean);
    framesExamined=Math.max(framesExamined,frames.length);
    for(const f of frames){
     for(const u of f.captionUrls||[])popupDomCaptions.add(u);
     try { const u=new URL(f.href);if(/^https?:$/.test(u.protocol))observedOrigins.add(u.origin); }catch(_){}
     for(const p of f.playback||[])for(const e of p.errors||[])errors.add(e);
     if(f.playerError)errors.add('PlayerError: '+f.playerError);
     for(const item of f.sources||[]){
      if(!history.has(item.url))history.set(item.url,{...item,frame:f.href,firstSeenMs:Date.now()-began,seenAtWall:Date.now(),
       observations:0,maxMediaTime:0,maxAdvance:0,playAttempts:0,visibility:f.visibility});
      const h=history.get(item.url);h.observations++;
      h.readyState=Math.max(h.readyState||0,item.readyState||0);
      h.maxDuration=Math.max(h.maxDuration||0,item.duration||0);
      h.maxMediaTime=Math.max(h.maxMediaTime,item.currentTime||0);
      h.lastSeenMs=Date.now()-began;
      for(const p of f.playback||[]){h.maxAdvance=Math.max(h.maxAdvance,p.advanced||0);h.playAttempts=Math.max(h.playAttempts,p.attempts||0);}
     }
    }
    // RC448 diagnostics: one line every ~2 s describing what the scan sees (visible in HIB_SCANLOG.txt)
    if(!window.__hibTickLog||Date.now()-window.__hibTickLog>1900){window.__hibTickLog=Date.now();
     console.info('[HIB RC448 TICK]',{t:Date.now()-began,clicks:hibClicks,tries:hibClickTries,frames:frames.length,hist:[...history.values()].slice(0,4).map(h=>({k:h.kind,u:String(h.url).slice(-26),adv:Math.round((h.maxAdvance||0)*10)/10,rs:h.readyState,w:h.w,h:h.h}))});}
    /* RC495: a manifest seen for 2.5 s is checked once in the background (hibManifestAlive); a verified one may be accepted below after 6 s if nothing else has moved. */
    for(const h of history.values()){
     if(h.kind!=='hlsManifest'||h.mTried)continue;if((Date.now()-began)-(h.firstSeenMs||0)<2500)continue;
     h.mTried=true;hibManifestAlive(h.url).then(ok=>{h.mVerified=ok;console.info('[HIB RC495]',{status:'MANIFEST_CHECK',ok,url:String(h.url).slice(-50),atMs:Date.now()-began});}).catch(()=>{});
    }
    // RC106: Autoplay denial is not media failure. Open an actionable episode tab
    // so the user can change Firefox/Floorp's site-specific permission.
    // Browser WebExtensions cannot programmatically grant autoplay permission.
    const permissionDenied=[...errors].some(e=>/NotAllowedError|autoplay.*(?:denied|block)|not allowed by the user agent/i.test(e));
    // RC114: a previous frame's autoplay error is not proof the episode
    // origin is blocked. An explicit successful origin playback probe wins.
    // Probe failure/inconclusive is not interpreted as a new denial.
    if(permissionDenied && tick>=2){
      try{
        const probeRows=await browser.tabs.executeScript(probe,{code:hibRc111PlaybackCode});
        rc114PermissionState=probeRows?.[0]?.result||'unknown';
      }catch(e){console.info('[HIB RC114] PERMISSION_PROBE_INCONCLUSIVE',String(e));}
      console.info('[HIB RC114] EFFECTIVE_AUTOPLAY',rc114PermissionState,target.origin);
    }
    if(((permissionDenied && tick>=2)||hibForcePermission) && rc114PermissionState==='NotAllowedError'){
     const blockedAnswer2={...last,ok:false,verified:false,autoplayPermission:{status:'site-allow-required',requestedOrigin:target.origin},autoplayBlocked:true,popupAttempted:true};
     // RC420: RESTORED. Autoplay detected as blocked -> open the site's tab with the permission tip (top right) so the user can pick
     // "Allow Audio and Video" from the autoplay/permissions icon next to the shield, then Dismiss; HIB verifies and resumes. This branch used to
     // just return the "blocked" answer (bottom-right notice only), which is why the tab and the icon stopped appearing. Same 10-minute
     // once-per-origin guard as the preflight branch above, so it can never loop.
     if(msg.permissionRetry||(hibPermTried.has(target.origin)&&Date.now()-hibPermTried.get(target.origin)<600000))return blockedAnswer2;
     const after2=await hibRc108PermissionFlow({target,priorWindow,priorTab,store:hibStore,closeScan:async()=>{
       if(popup?.id!=null)await browser.windows.remove(popup.id).catch(()=>{});
       else if(popup?.isTab&&hibGuardProbe!==null)await browser.tabs.remove(hibGuardProbe).catch(()=>{});
       popup=null;}});
     if(after2==='allowed')return {...last,ok:false,verified:false,autoplayPermission:{status:'allowed-after-close',requestedOrigin:target.origin},popupAttempted:true};
     if(after2==='NotAllowedError')return blockedAnswer2;
     return {...last,ok:false,verified:false,autoplayPermission:{status:'recheck-after-close',requestedOrigin:target.origin,probeResult:after2},popupAttempted:true};
    }
    /* the autoplay-permission tab was removed: nothing in the detection path opens or activates a tab */
    last={framesExamined,videoCount:frames.reduce((n,f)=>n+(f.videoCount||0),0),
     sourceAttached:history.size>0,focusedPopup:true,openerTabId:priorTab};
    // RC76: early handoff to the *originating hover job*. Require the same
    // video-bound URL on consecutive observations, and never select a URL
    // explicitly identified as advertising. This is extraction, not verification.
    // RC295: an ad banner player (e.g. a 360x70 ad iframe) is never the episode.
    // UNSUPPORTED MODE: the player's play() was rejected as "not supported" (a codec / container this browser cannot decode) and nothing has
    // advanced. From 5 s on, a candidate URL the player exposes is accepted WITHOUT playback (it is handed to the HIB player, not played here);
    // from 8 s with no candidate the scan stops instead of spinning on.
    const hibUnsupported=[...errors].some(e=>/NotSupportedError|not suitable|SRC_NOT_SUPPORTED|not supported|unsupported|did not support|MediaError code [34]|MEDIA_ERR_(?:DECODE|SRC_NOT_SUPPORTED)/i.test(e));
    const hibNoneAdvanced=![...history.values()].some(x=>x.maxAdvance>=1);
    const hibUnsupportedMode=hibUnsupported&&hibNoneAdvanced&&Date.now()-began>=5000;
     // RC453: an ADAPTIVE (DASH / HLS) page player that is fully loaded and big but does not advance in this background window (the site's own player needs a real
     // gesture; hstream) is accepted after 8 s, like the 'unsupported' case: the manifest is handed to the HIB player, which plays it with dash.js / hls.js.
     const hibIdleReady=h=>hibNoneAdvanced&&Date.now()-began>=8000&&(h.kind==='currentSrc'||h.kind==='source')&&/\.(?:mpd|m3u8)(?:[?#]|$)/i.test(String(h.url).split('?')[0]+'')&&(h.readyState||0)>=3&&h.w*h.h>=80000;
    const usable=[...history.values()].filter(h=>
      !hibRc297LooksLikeAd(h) &&
      (h.observations>=1) && ((h.maxAdvance>=1 && h.maxMediaTime>=1 && h.readyState>=2) || (h.kind==='hlsManifest'&&h.mVerified===true&&Date.now()-began>=6000&&hibNoneAdvanced) || (hibUnsupportedMode&&/^(?:currentSrc|src|videojs|source|configSource|scriptSource|netMedia)$/.test(h.kind)) || hibIdleReady(h) || hibKnownHit(h) || ((h.kind==='configSource'||h.kind==='netMedia'||h.kind==='scriptSource') && [...history.values()].some(x=>x.maxAdvance>=1&&x.maxMediaTime>=1&&x.readyState>=2))) &&
      (Date.now()-began-h.firstSeenMs)>=((h.kind==='configSource'||hibRc297SlugScore(h.url,target)>=2)?250:1000) && /^(?:currentSrc|src|videojs|source|hlsManifest|configSource|netMedia|scriptSource)$/.test(h.kind) &&
      !/(?:^|[\/_-])(?:ad|ads|advert|advertising|promo|preroll)(?:[\/_-]|$)/i.test(new URL(h.url).pathname));
    let usablePref=usable;
    try{
     // (no 'own frame first' rule: many sites keep the real player in an iframe and put native ads in the page itself)
     // The player's own configured episode source beats whatever is playing (ads often play first).
     const cfg=usablePref.filter(h=>h.kind==='configSource');
     if(cfg.length){
      const best=[...cfg].sort((a,b)=>hibRc297Res(b.url)-hibRc297Res(a.url))[0];
      if(await hibRc297RangeOk(best.url)){usablePref=[best];console.info('[HIB RC297]',{status:'CONFIG_SOURCE_PREFERRED',url:best.url});}
      else{usablePref=usablePref.filter(h=>h.kind!=='configSource');console.warn('[HIB RC297]',{status:'CONFIG_SOURCE_NOT_PLAYABLE',url:best.url});}
     }
     // A source that carries the page's own slug / id is the episode, even while an ad plays first.
     const matched=usablePref.filter(h=>h.kind!=='hlsManifest'&&h.kind!=='configSource'&&hibRc297SlugScore(h.url,target)>=2);
     if(matched.length&&!usablePref.some(h=>h.kind==='configSource')){
      // Try every matching source in turn (a site may list a dead mirror and a live one); best match / resolution first.
      const rankedMatches=[...matched].sort((a,b)=>hibRc297SlugScore(b.url,target)-hibRc297SlugScore(a.url,target)||hibRc297Res(b.url)-hibRc297Res(a.url));
      let bestMatch=null;
      const rangeResults=await Promise.all(rankedMatches.slice(0,4).map(cand=>hibRc297RangeOk(cand.url)));
      bestMatch=rankedMatches.slice(0,4).find((cand,i)=>rangeResults[i])||null;
      if(bestMatch){usablePref=[bestMatch];console.info('[HIB RC297]',{status:'PAGE_MATCHED_SOURCE_PREFERRED',url:bestMatch.url,score:hibRc297SlugScore(bestMatch.url,target),elapsedMs:Date.now()-began});}
      else{usablePref=usablePref.filter(h=>h.kind!=='netMedia');console.warn('[HIB RC297]',{status:'PAGE_MATCHED_SOURCE_NOT_REACHABLE',tried:rankedMatches.slice(0,4).map(h=>h.url)});}
     }
     const nonManifest=usablePref.filter(h=>h.kind!=='hlsManifest');
     const playingNow=nonManifest.filter(h=>h.kind==='currentSrc');
     if(!usablePref.some(h=>h.kind==='hlsManifest')&&playingNow.length===1&&nonManifest.length>1){
      usablePref=playingNow;
      console.info('[HIB RC297]',{status:'PLAYING_SOURCE_PREFERRED',url:playingNow[0].url});
     }
     // Still several different videos (a native ad next to the real player): the main player is the largest
     // visible video, in any frame.
     const rivals=usablePref.filter(h=>h.kind!=='hlsManifest'&&h.kind!=='configSource');
     if(rivals.length>1&&!usablePref.some(h=>h.kind==='hlsManifest'||h.kind==='configSource')){
      const bySize=[...rivals].sort((a,b)=>(b.w*b.h)-(a.w*a.h));
      const first=(bySize[0].w*bySize[0].h)||0,second=(bySize[1].w*bySize[1].h)||0;
      if(first>0&&first>=1.5*second){usablePref=[bySize[0]];console.info('[HIB RC297]',{status:'LARGEST_VIDEO_PREFERRED',url:bySize[0].url,area:first,runnerUp:second});}
     }
    }catch(_){}
    const manifests=usablePref.filter(h=>h.kind==='hlsManifest');
    const primary=manifests.filter(h=>!/(?:\/audio\/|\/media-\d+\/|\/segment-)/i.test(new URL(h.url).pathname));
    let primarySel=primary;
    if(primary.length>1){
     const seen=[...popupNetManifests];
     const rank=u=>{const i=seen.indexOf(u);return i<0?1e9:i;};
     primarySel=[[...primary].sort((a,b)=>rank(a.url)-rank(b.url))[0]];
     console.info('[HIB RC295]',{status:'MULTIPLE_PLAYLISTS_FIRST_OBSERVED_CHOSEN',count:primary.length,url:primarySel[0].url});
    }
    let chosen=primarySel.length===1?primarySel:usablePref.filter(h=>h.kind!=='hlsManifest');
    if(chosen.length&&chosen.every(h=>h.kind==='scriptSource')){
     const ranked=[...chosen].sort((a,b)=>hibRc297Res(b.url)-hibRc297Res(a.url)||b.url.length-a.url.length).slice(0,3);
     let okOne=null;for(const cand of ranked){if(await hibRc297RangeOk(cand.url)){okOne=cand;break;}}
     chosen=okOne?[okOne]:[];
     if(okOne)console.info('[HIB RC346]',{status:'SCRIPT_SOURCE_CHOSEN',url:okOne.url});
    }else chosen=chosen.filter(h=>h.kind!=='scriptSource');
    const distinct=[...new Set(chosen.map(h=>h.url))];
    let pickUrl=distinct.length===1?distinct[0]:null;
    if(!pickUrl&&distinct.length>1){
     if(!usableSince)usableSince=Date.now();
     if(Date.now()-usableSince>2500){
      const score=h=>(h.maxAdvance>0?1000:0)+(h.kind==='currentSrc'?500:0)+Math.min(h.maxDuration||0,7200)+((h.w||0)*(h.h||0))/1000-(h.firstSeenMs||0)/1000;
      const best=[...chosen].sort((a,b)=>score(b)-score(a))[0];pickUrl=best.url;
      console.info('[HIB RC346]',{status:'MULTIPLE_CANDIDATES_BEST_CHOSEN',count:distinct.length,url:pickUrl,elapsedMs:Date.now()-began});
     }
    }
    if(!pickUrl&&hibUnsupportedMode&&Date.now()-began>=8000){
     console.info('[HIB RC346]',{status:'UNSUPPORTED_VIDEO_NO_SOURCE',elapsedMs:Date.now()-began,errors:[...errors].slice(0,3)});
     return {...last,ok:false,landing:true,reason:'unsupported-video',verified:false,episodeCount:0,popupAttempted:true,error:null};
    }
    if(pickUrl){
      const picked=chosen.find(h=>h.url===pickUrl);
      if(hibUnsupportedMode&&!(picked.maxAdvance>=1))console.info('[HIB RC346]',{status:'UNSUPPORTED_VIDEO_SOURCE_HANDED_OVER',url:picked.url,kind:picked.kind,elapsedMs:Date.now()-began});
      const hibFormat=/[.]m3u8(?:$|[?#])/i.test(picked.url)||picked.kind==='hlsManifest'||/(?:^|\/)hls(?:\/|$)/i.test(new URL(picked.url).pathname)?'hls':/[.]mpd(?:$|[?#])/i.test(picked.url)?'dash':'direct';
      const result={...last,mediaFormat:hibFormat,rc150DetectedEngine:hibRc150Probe.engine,ok:true,verified:true,playbackUnverified:!!(hibUnsupportedMode&&!(picked.maxAdvance>=1)),url:picked.url,candidateUrl:picked.url,
       candidateCount:1,candidates:[picked],extractionOnly:true,
       diagnosticSnapshots,autoplayErrors:[...errors],
       error:null};
      await browser.storage.local.set({hibRc75LastDiscovery:result}).catch(()=>{});
      await hibRc78SaveProfile(target.hostname,picked.url,picked.frame,'rendered-popup/live-video').catch(e=>console.warn('[HIB RC78] PROFILE_SAVE_FAILED',String(e)));
      try{let eng=hibRc150Probe.engine;
       if(eng==='custom'){let cross=false;try{cross=new URL(picked.frame).origin!==target.origin;}catch(_){}eng=cross?'iframe':'html5';}
       const fmt=hibFormat;
       await HIBRC150.recordVerified(target.hostname,target.pathname,eng,fmt);
       console.info('[HIB RC346]',{status:'PLAYER_TYPE_STORED',host:target.hostname,engine:eng,format:fmt});}catch(_){}
      // RC126: only an actually played source receives a narrowly scoped
      // exact-URL referrer hint. Do not copy cookies or authentication headers.
      try {
       const source=new URL(picked.url),frame=new URL(picked.frame);
       /* RC459: ANY https frame that played the file is the right Referer for it (a video served to an embed on another site: page -> embed host -> media host needs the EMBED's address, not the page's). */
       if(source.protocol==='https:' && frame.protocol==='https:'){
        hib101MediaOriginHints.set(source.href,{referrer:frame.href,until:Date.now()+30*60*1000,source:'verified-popup'});
        console.info('[HIB RC126] VERIFIED_MEDIA_REFERER_HINT',{mediaHost:source.hostname,referrerHost:frame.hostname});
       }
      }catch(_){}
      console.log('[HIB TEST RC77] POPUP_SOURCE_CAPTURED',{
       page:target.pathname,frame:picked.frame,source:picked.url,verified:true,maxAdvance:picked.maxAdvance});
      // RC119: no diagnostic linger; collect available subtitle tracks immediately.
      // Closure is handled in finally after the subtitle handoff.
      // VTT is frequently requested after the video begins rather than with the HLS master.
      // Re-read accessible frames once before popup teardown.
      try{
       const tracks=msg.rc276Bridge?[]:await browser.tabs.executeScript(probe,{allFrames:true,code:`(() => {
        const urls=new Set();const add=x=>{try{const u=new URL(x,location.href);if(u.protocol==='https:' && (/[.](?:vtt|srt|ass|ssa)$/i.test(u.pathname)||/(?:caption|subtitle|[/]subs?[/])/i.test(u.pathname)))urls.add(u.href);}catch(_){}};
        for(const t of document.querySelectorAll('track[src],a[href*=".vtt"],source[type="text/vtt"]'))add(t.src||t.href||t.getAttribute('src'));
        for(const e of performance.getEntriesByType('resource'))add(e.name);
        return [...urls].slice(0,30);
       })()`});
       for(const row of tracks||[])for(const u of (row?.result??row??[]))popupDomCaptions.add(u);
      }catch(_){}
      const captions=msg.rc276Bridge?null:await hibExtractObservedVtt(popupVtt,target.href,[...popupDomCaptions],probe);
      if(captions)result.subtitles=captions;
      console.info('[HIB RC105] POPUP_VTT_HANDOFF',{network:popupVtt.urls.size,dom:popupDomCaptions.size,ready:!!captions});
      try{hibRc329SubCandidates.set(picked.url,{urls:[...new Set([...popupDomCaptions,...popupVtt.urls])],fonts:[...popupFonts],page:target.href,at:Date.now()});if(hibRc329SubCandidates.size>40)hibRc329SubCandidates.delete(hibRc329SubCandidates.keys().next().value);}catch(_){}
      return result;
    }
   }
   const candidates=[...history.values()];
   // RC114: only an explicit denial on the target origin is permission-blocked.
   // No source/readyState=0 and legacy errors are media-initialization failures.
   const blocked=rc114PermissionState==='NotAllowedError';
   // Firefox's WebExtension API cannot write site autoplay permissions.
   // Never claim a temporary grant or silently modify browser-wide settings.
   const autoplayPermission={status:blocked?'site-allow-required':'undetermined',
    automaticGrantAvailable:false,requestedOrigin:target.origin,
    observedOrigins:[...observedOrigins],
    manualSetting:'Page Info > Permissions > Autoplay > Allow Audio and Video',
    retainedGrant:false,rolledBack:false,
    note:'No autoplay permission was changed by HIB. Site permission requires Firefox UI or an independently installed privileged helper.'};
   const result={...last,ok:false,verified:false,candidateCount:candidates.length,candidates,
    diagnosticSnapshots,autoplayErrors:[...errors],autoplayPermission,
    candidateUrl:candidates.length===1?candidates[0].url:null, popupAttempted:true,
    error:'popup discovery exhausted; do not open a legacy background tab'};
   // Saved across popup closure; user can inspect without racing the tab.
   await browser.storage.local.set({hibRc75LastDiscovery:result}).catch(()=>{});
   console.log('[HIB TEST RC75] POPUP_DIAGNOSTICS_SAVED',result);
   return result;
  }catch(e){return {...last,ok:false,autoplayErrors:[...errors],autoplayPermission:{status:'not-modified',automaticGrantAvailable:false,requestedOrigin:target.origin},error:String(e)};}
  finally{
   // Reserve discovery exclusively for the same card's immediate retry.
   // Timeout releases the lock if the initiating tab disappeared.
   if(hibRc111Handoff){
    if(hibRc111HandoffTimer!==null)clearTimeout(hibRc111HandoffTimer);
    hibRc111HandoffTimer=setTimeout(()=>{
     hibRc111Handoff=null;hibRc108Busy=false;hibRc111HandoffTimer=null;
    },12000);
   }else hibRc108Busy=false;
   if(popupVttListener)browser.webRequest.onBeforeRequest.removeListener(popupVttListener);
   if(popupFontListener)browser.webRequest.onBeforeRequest.removeListener(popupFontListener);
   if(popupManifestListener)browser.webRequest.onBeforeRequest.removeListener(popupManifestListener);
   if(popupMediaListener)browser.webRequest.onBeforeRequest.removeListener(popupMediaListener);
   if(hibPopListener)browser.tabs.onCreated.removeListener(hibPopListener);
   if(hibGuardProbe!==null)hibScanProbes.delete(hibGuardProbe);
   try{if(hibGuardReg)await hibGuardReg.unregister();}catch(_){}
   hibRc343ScheduleLogWrite();
   if(hibStrayUpd)browser.tabs.onUpdated.removeListener(hibStrayUpd);
   if(hibStrayAct)browser.tabs.onActivated.removeListener(hibStrayAct);
   // The scan tab is closed as soon as the scan ends; the browser then returns to the tab it was opened from.
   if(popup?.isTab&&hibGuardProbe!==null)await browser.tabs.remove(hibGuardProbe).catch(()=>{});
   // RC119: release the temporary pop-under on success, failure, or cancellation.
   if(msg.rc276Bridge && popup?.id!=null){
      // TEST: retain the actual browser window, independent of the discovery busy lock.
      hibRc276Windows.set(popup.id,{owner:priorTab,pageUrl:target.href,resultAt:Date.now()});
      console.info('[HIB RC276]',{status:'RESOLVER_RETAINED_PENDING_DELIVERY',windowId:popup.id});
    }else if(popup?.id!=null)await browser.windows.remove(popup.id).catch(()=>{});
   // RC81: Do not activate or re-focus any window/tab on cleanup.
    // The user's focus and active tab are never changed by this resolver.
  }
 })();
};
browser.runtime.onMessage.addListener(hibRc133ResolveMedia);

/* RC78: Persist a successful player METHOD, never short-lived signed media URLs. */
const HIB_RC78_PROFILE_KEY = 'hibRc78VideoProfiles';
function hibRc78Format(url) {
 try { const u=new URL(url); const x=u.pathname.toLowerCase();
  if(x.endsWith('.m3u8'))return 'HLS';
  if(x.endsWith('.mpd'))return 'DASH';
  if(/\.(?:mp4|m4v|webm|ogg)$/.test(x))return x.split('.').pop().toUpperCase();
  return 'HTML5 (extensionless)';
 } catch(_){return 'Unknown';}
}
async function hibRc78SaveProfile(site, mediaUrl, frame, method) {
 const host=hibV216NormalizeSite(site);
 if(!host || !/^https?:\/\//.test(mediaUrl))return null;
 const data=await browser.storage.local.get(HIB_RC78_PROFILE_KEY);
 const profiles=data[HIB_RC78_PROFILE_KEY]||{};
 const profile={site:host,type:hibRc78Format(mediaUrl),method:method||'rendered-popup',
  frameOrigin:(()=>{try{return new URL(frame).origin}catch(_){return ''}})(),
  windowMode:'foreground-popup',verifiedAt:new Date().toISOString()};
 profiles[host]=profile;
 await browser.storage.local.set({[HIB_RC78_PROFILE_KEY]:profiles});
 return profile;
}
browser.runtime.onMessage.addListener(message=>{
 if(message?.type==='hib-rc78-profiles-get')
  return browser.storage.local.get(HIB_RC78_PROFILE_KEY).then(x=>({ok:true,profiles:x[HIB_RC78_PROFILE_KEY]||{}}));
 if(message?.type==='hib-rc78-scan-episode')return (async()=>{
  const u=new URL(message.url);if(!/^https?:$/.test(u.protocol))throw Error('Unsupported site');
  const response=await browser.runtime.sendMessage({type:'hib-test-global-rendered-media',pageUrl:u.href});
  return {ok:!!response?.ok,sourceFound:!!response?.candidateUrl,
   profile:response?.ok?(await browser.storage.local.get(HIB_RC78_PROFILE_KEY))[HIB_RC78_PROFILE_KEY]?.[u.hostname]||null:null,
   error:response?.error||null};
 })().catch(e=>({ok:false,error:String(e)}));
 return undefined;
});

/* RC74: per-origin autoplay permission preflight only; no unsupported permission mutation. */

// RC92: Managed, verified trace downloads, with explicit failure reporting.
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-rc91-download-player-trace')return undefined;
 return (async()=>{
  if(!String(sender?.url||'').startsWith(browser.runtime.getURL('')))throw Error('Export denied: not an extension frame');
  const report=msg.report;
  if(!report||!['hib-player-trace-v1','hib-player-trace-v2'].includes(report.schema)||!Array.isArray(report.history))throw Error('Invalid trace report: '+String(report?.schema||'missing schema'));
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const filename='HIB_Player_Trace_'+stamp+'.json';
  const payload=JSON.stringify({...report,keyRequestContext:{capturedAt:new Date().toISOString(),requests:hibRc98KeyRequests.slice(-25)}},null,2);
  // A Blob URL avoids encoded data: URLs growing several megabytes with large traces.
  const url=URL.createObjectURL(new Blob([payload],{type:'application/json'}));
  let id=null, timer=null, listener=null;
  try{
   const finish=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('Download did not complete within 30 seconds')),30000);
    listener=delta=>{
     if(id===null||delta.id!==id)return;
     if(delta.state?.current==='complete')resolve();
     else if(delta.error?.current||delta.state?.current==='interrupted')reject(Error(delta.error?.current||'Download interrupted'));
    };
    browser.downloads.onChanged.addListener(listener);
   });
   id=await browser.downloads.download({url,filename,saveAs:false,conflictAction:'uniquify'});
   // Check the completed state too: the event can precede receipt of the download ID.
   const existing=await browser.downloads.search({id});
   const item=existing&&existing[0];
   if(item?.state==='interrupted')throw Error(item.error||'Download interrupted');
   if(item?.state!=='complete')await finish;
   const verified=(await browser.downloads.search({id}))[0];
   if(!verified||verified.state!=='complete')throw Error('File completion could not be verified');
   console.info('[HIB RC92] PLAYER_TRACE_DOWNLOAD_VERIFIED',{id,path:verified.filename,bytes:payload.length});
   return {ok:true,id,filename,path:verified.filename};
  }catch(e){
   console.error('[HIB RC92] PLAYER_TRACE_DOWNLOAD_FAILED',String(e));
   return {ok:false,error:String(e)};
  }finally{
   if(timer!==null)clearTimeout(timer);
   if(listener)browser.downloads.onChanged.removeListener(listener);
   // Retain Blob URL long enough for the browser download process to finish releasing it.
   setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
 })().catch(e=>({ok:false,error:String(e)}));
});


// RC99+RC77: Set correct Referer AND inject session cookies for signed AES-128 key
// requests made by HIB's extension iframe. The key server requires a valid session
// cookie — without it the server returns a PNG error page instead of the 16-byte key.
browser.webRequest.onBeforeSendHeaders.addListener(d=>{
 try{
  const u=new URL(d.url);
  if(u.protocol!=='https:'||!/(?:^|\/)(?:key|[^\/]+\.key|key\.bin)$/i.test(u.pathname))return {};
  const initiator=String(d.originUrl||d.documentUrl||'');
  if(!initiator.startsWith(browser.runtime.getURL('')))return {};
  return browser.cookies.getAll({url:u.origin+'/',firstPartyDomain:null})
   .catch(()=>browser.cookies.getAll({url:u.origin+'/'}))
   .then(cookies=>{
    const headers=(d.requestHeaders||[]).slice();
    const set=(name,val)=>{const h=headers.find(x=>x.name.toLowerCase()===name.toLowerCase());if(h)h.value=val;else headers.push({name,value:val});};
    set('Referer',(()=>{const dom=h=>h.split('.').slice(-2).join('.');for(const [,hint] of hib101MediaOriginHints){try{if(Date.now()<hint.until&&dom(new URL(hint.referrer).hostname)===dom(u.hostname))return hint.referrer;}catch(_){}}return u.origin+'/';})());
    if(cookies.length){
     const ci=headers.findIndex(h=>h.name.toLowerCase()==='cookie');
     if(ci>=0)headers.splice(ci,1);
     headers.push({name:'Cookie',value:cookies.map(c=>c.name+'='+c.value).join('; ')});
    }
    console.info('[HIB RC77] KEY_COOKIE_INJECT',{host:u.hostname,cookies:cookies.length});
    return {requestHeaders:headers};
   }).catch(e=>{console.warn('[HIB RC77] KEY_COOKIE_ERROR',String(e));return {};});
 }catch(e){console.warn('[HIB RC77] KEY_ERROR',String(e));return {};}
},{urls:['https://*/*']},['blocking','requestHeaders']);

/* RC449: a hotlink-protected file (watchhentai's hstorage.xyz answers 403 without a Referer) requested by the HIB player page itself gets the
 * site page that the scan verified it on as its Referer. Only requests whose address has a hint, made by the extension's own player page. */
const hibRefererListener=d=>{
 try{
  const initiator=String(d.originUrl||d.documentUrl||'');
  if(!initiator.startsWith(browser.runtime.getURL('')))return {};
  let hint=hib101MediaOriginHints.get(d.url);
  /* RC460: playlist segments / keys / init files are other addresses on the same host: a host that refused the playlist without a Referer refuses them too. */
  if(!hint||!hint.needsReferer){hint=null;try{const dom=h=>h.split('.').slice(-2).join('.');const host=dom(new URL(d.url).hostname);for(const [k,hh] of hib101MediaOriginHints){if(hh&&hh.needsReferer&&Date.now()<hh.until&&dom(new URL(k).hostname)===host){hint=hh;break;}}   /* RC464: same registrable domain (playlist on one CDN host, segments on a sibling host) */}catch(_){}}
  if(!hint||Date.now()>hint.until||!hint.needsReferer)return {};
  const headers=(d.requestHeaders||[]).slice();
  const h=headers.find(x=>x.name.toLowerCase()==='referer');
  if(h)h.value=hint.referrer;else headers.push({name:'Referer',value:hint.referrer});
  return {requestHeaders:headers};
 }catch(_){return {};}
};
/* RC453: registered ONLY while some verified address needs it (a file that answered 401/403 to a Referer-less request) and removed again when
 * none is left, so ordinary playback never pays for a blocking request hook. hibRefererSync() runs when a hint is flagged and every minute. */
let hibRefererOn=false;
/* RC471: identity of a media FILE across fresh signatures: host + the last two path segments (a token or a time stamp earlier in the path changes every time: /<token>/<unix>/videos/70574.mp4) */
function hibFileKey(u){const x=new URL(u);return x.origin+'|'+x.pathname.split('/').filter(Boolean).slice(-2).join('/');}
function hibRefererSync(){
 let need=false;
 for(const [,hint] of hib101MediaOriginHints)if(hint&&hint.needsReferer&&Date.now()<hint.until){need=true;break;}
 if(need&&!hibRefererOn){browser.webRequest.onBeforeSendHeaders.addListener(hibRefererListener,{urls:['https://*/*'],types:['media','xmlhttprequest','other']},['blocking','requestHeaders']);hibRefererOn=true;}
 else if(!need&&hibRefererOn){browser.webRequest.onBeforeSendHeaders.removeListener(hibRefererListener);hibRefererOn=false;}
}
setInterval(hibRefererSync,60000);

// RC98: narrow, privacy-safe comparison of AES-128 key requests.
// Capture only request metadata, never cookies, tokens, or key bodies.
const hibRc98KeyRequests=[];
const hibRc98Pending=new Map();
function hibRc98IsKeyRequest(url){try{return /^https?:$/.test(new URL(url).protocol)&&/\/key\.bin$/i.test(new URL(url).pathname)}catch(_){return false}}
function hibRc98UrlHost(url){try{return new URL(url).hostname}catch(_){return null}}
function hibRc98Referrer(headers){const h=(headers||[]).find(x=>x.name?.toLowerCase()==='referer');return h?hibRc98UrlHost(h.value):null}
browser.webRequest.onBeforeSendHeaders.addListener(d=>{
 if(!hibRc98IsKeyRequest(d.url))return;
 const u=new URL(d.url);
 hibRc98Pending.set(d.requestId,{at:new Date().toISOString(),keyHost:u.hostname,hasQuery:u.search.length>1,queryParameterNames:[...u.searchParams.keys()].slice(0,8),initiatorHost:hibRc98UrlHost(d.originUrl||d.documentUrl||''),refererHost:hibRc98Referrer(d.requestHeaders),tabId:d.tabId,method:d.method});
}, {urls:['<all_urls>']},['requestHeaders']);
function hibRc98Finish(d,status){const r=hibRc98Pending.get(d.requestId);if(!r)return;hibRc98Pending.delete(d.requestId);hibRc98KeyRequests.push({...r,status});if(hibRc98KeyRequests.length>35)hibRc98KeyRequests.shift();}
browser.webRequest.onCompleted.addListener(d=>hibRc98Finish(d,d.statusCode),{urls:['<all_urls>']});
browser.webRequest.onErrorOccurred.addListener(d=>hibRc98Finish(d,d.error||'network-error'),{urls:['<all_urls>']});


/* RC276 / MINIMAL CARD TO ORIGINAL VIDEO RESOLVER ADAPTER.
   No replacement player, media-source detector or permission state machine. */
const hibRc276Windows=new Map();
const hibScanProbes=new Set();
/* NO DISK CACHE FOR HIB VIDEO. Firefox stores every played video / playlist / segment in its disk cache, which fills the drive. Responses to
 * media requests made by a scan tab (hibScanProbes) or by a tab that shows the HIB player (hibPlayerTabs) are marked no-store, so only HIB's small
 * records (episode url, player type) remain: nothing has to be emptied afterwards. */
const hibPlayerTabs=new Set();
browser.webRequest.onHeadersReceived.addListener(d=>{
 if(!(hibScanProbes.has(d.tabId)||hibPlayerTabs.has(d.tabId)))return undefined;
 const headers=(d.responseHeaders||[]).filter(x=>!/^(?:cache-control|expires|pragma)$/i.test(x.name));
 headers.push({name:'Cache-Control',value:'no-store, no-cache, must-revalidate'});
 return {responseHeaders:headers};
},{urls:['<all_urls>'],types:['media','xmlhttprequest','other']},['blocking','responseHeaders']);
browser.tabs.onRemoved.addListener(id=>{hibPlayerTabs.delete(id);});
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-player-tab')return undefined;
 const id=sender?.tab?.id;
 if(Number.isInteger(id)){if(msg.open)hibPlayerTabs.add(id);else hibPlayerTabs.delete(id);}
 return Promise.resolve({ok:true});
});
browser.runtime.onMessage.addListener(msg=>{
 if(msg?.type!=='hib-still-log'||typeof msg.text!=='string')return undefined;
 hibTabLogUntil=Date.now()+20000;
 console.info(msg.text);
 hibRc343ScheduleLogWrite();
 return undefined;
});
/* A video playing in the page itself (no card, often a blob: address fed by a streaming library): the tab's own manifest / media
 * requests are remembered so a right-click on that video can hand the real address to the HIB player. Kept per tab, dropped when the
 * tab closes or navigates; only the address is stored. */
const hibTabMedia=new Map();
browser.webRequest.onBeforeRequest.addListener(d=>{
 if(d.tabId<0)return;
 if(d.type==='main_frame'){hibTabMedia.delete(d.tabId);return;}
 let p;try{p=new URL(d.url).pathname.toLowerCase();}catch(_){return;}
 const kind=/\.m3u8$/.test(p)?'hls':/\.mpd$/.test(p)?'dash':/\.(?:mp4|m4v|webm|ogv)$/.test(p)?'direct':'';
 if(!kind)return;
 const list=hibTabMedia.get(d.tabId)||[];
 list.push({url:d.url,kind,t:Date.now()});
 if(list.length>20)list.shift();
 hibTabMedia.set(d.tabId,list);
},{urls:['<all_urls>'],types:['xmlhttprequest','media','other']});
/* RC358: generic response MIME capture for media endpoints without filename extensions.
 * No website/CDN logic, tokens, headers or cookies persisted. MIME must actually be media. */
browser.webRequest.onHeadersReceived.addListener(d=>{
 if(d.tabId<0||!/^https:/i.test(d.url))return;
 const ct=(d.responseHeaders||[]).find(h=>h.name.toLowerCase()==='content-type')?.value?.split(';')[0]?.trim()?.toLowerCase()||'';
 const kind=/^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/(?:mpegurl|x-mpegurl))$/.test(ct)?'hls':ct==='application/dash+xml'?'dash':/^(?:video\/(?:mp4|x-m4v|webm|ogg|quicktime|x-matroska)|application\/octet-stream)$/.test(ct)&&d.type==='media'?'direct':/^video\/(?:mp4|webm|ogg|quicktime|x-matroska)$/.test(ct)?'direct':'';
 if(!kind)return;
 const list=hibTabMedia.get(d.tabId)||[];
 if(!list.some(x=>x.url===d.url)){list.push({url:d.url,kind,t:Date.now(),mime:ct});if(list.length>30)list.shift();hibTabMedia.set(d.tabId,list);}
},{urls:['<all_urls>'],types:['media','xmlhttprequest','other']},['responseHeaders']);
browser.tabs.onRemoved.addListener(id=>hibTabMedia.delete(id));
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-tab-media')return undefined;
 const list=hibTabMedia.get(sender.tab?.id)||[];
 // A master manifest beats segments / variants: prefer the earliest manifest, otherwise the newest direct file.
 const manifest=list.find(x=>x.kind==='hls'||x.kind==='dash');
 const pick=manifest||[...list].reverse().find(x=>x.kind==='direct')||null;
 return Promise.resolve(pick?{url:pick.url,format:pick.kind==='direct'?undefined:pick.kind}:null);
});
/* RC359: HOSTED PLAYERS is an evidence category in the EXISTING detector.
 * It is NOT a resolver or a playable URL: never hand encrypted chunks / UMP
 * directly to the HTML5, DASH, HLS or HEVC decoder.
 * Keep only bounded sanitized metadata per tab, never URLs, keys, cookies or bodies. */
const hibHostedCandidates = new Map();
function hibHostedRecord(d, mime, evidence) {
 if (!Number.isInteger(d.tabId) || d.tabId < 0) return;
 const now=Date.now();
 const list=(hibHostedCandidates.get(d.tabId)||[]).filter(x=>now-x.time<120000);
 const host=(()=>{try{return new URL(d.url).hostname;}catch(_){return 'unknown';}})();
 const matching=list.find(x=>x.host===host&&x.mime===mime&&x.evidence===evidence&&x.method===d.method);
 if(matching){matching.count++;matching.time=now;matching.status=d.statusCode||0;}
 else list.push({category:'Hosted Players',host,mime,evidence,method:d.method||'',frameId:d.frameId??-1,status:d.statusCode||0,count:1,time:now,playable:false});
 hibHostedCandidates.set(d.tabId,list.slice(-30));
}
browser.webRequest.onHeadersReceived.addListener(d=>{
 if (!/^https:/i.test(d.url)||!['xmlhttprequest','media','other'].includes(d.type)) return;
 const mime=((d.responseHeaders||[]).find(h=>h.name.toLowerCase()==='content-type')?.value||'').split(';')[0].trim().toLowerCase();
 const path=(()=>{try{return new URL(d.url).pathname;}catch(_){return '';}})();
 // UMP is a framed transport; octet-stream is only a candidate when the
 // URL ends with a numeric byte interval (generic chunk evidence).
 const evidence=mime==='application/vnd.yt-ump'?'framed-media-transport':
   mime==='application/octet-stream' && /\/\d+-\d+\/?$/.test(path)?'binary-byte-chunks':null;
 if(evidence) hibHostedRecord(d,mime,evidence);
},{urls:['<all_urls>'],types:['xmlhttprequest','media','other']},['responseHeaders']);
browser.webRequest.onBeforeRequest.addListener(d=>{if(d.type==='main_frame'&&d.tabId>=0)hibHostedCandidates.delete(d.tabId);},{urls:['<all_urls>'],types:['main_frame']});
browser.tabs.onRemoved.addListener(id=>hibHostedCandidates.delete(id));
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-hosted-player-candidates') return undefined;
 const list=(hibHostedCandidates.get(sender.tab?.id)||[]).filter(x=>Date.now()-x.time<120000);
 return Promise.resolve({category:'Hosted Players',candidates:list.map(x=>({...x})) ,playable:false});
});
/* RC108 / RC111 autoplay permission module. Runs ONLY for a site whose audible-autoplay probe was refused (NotAllowedError); a site that
 * already allows autoplay never reaches it. Firefox does not always show its own autoplay prompt, so the episode tab is opened once with a
 * tip. While it is open discovery is locked (hibPermTab). Closing it proves nothing: the origin is probed again (Dismiss probes before it
 * closes the tab), then the original discovery is resumed. A site that stays blocked is not opened again for 10 minutes. */
let hibPermTab=null,hibPermResult='unknown';
const hibPermTried=new Map();
const hibRc108TipCode=`(()=>{
 const id='hib-rc106-permission-tip';
 // RC419: make a REAL play() attempt now. Firefox/Floorp only shows its autoplay icon (address bar) for a tab whose page actually tried to play and was
 // blocked; without this call there was no icon to click and the user could not change the permission.
 try{const a=document.createElement('audio');a.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';a.style.display='none';(document.body||document.documentElement).appendChild(a);const p=a.play();if(p&&p.catch)p.catch(()=>{});setTimeout(()=>a.remove(),3000);}catch(_){}
 if(document.getElementById(id))return 'already-shown';
 const el=document.createElement('div');el.id=id;
 el.style.cssText='position:fixed!important;top:15px!important;right:15px!important;z-index:2147483647!important;max-width:390px!important;background:#151b2b!important;color:#fff!important;border:2px solid #f6bd53!important;border-radius:10px!important;padding:12px 14px!important;font:13px/1.4 sans-serif!important;box-shadow:0 6px 24px #000a!important;';
 const h=document.createElement('strong');h.textContent='HIB: Autoplay blocked';
 const i=document.createElement('div');i.style.marginTop='8px';
 i.textContent='Floorp is blocking audio and video for this site. Click the blocked-autoplay icon at the left of the address bar and choose Allow Audio and Video, then click Dismiss: this tab closes and HIB verifies.';
 const c=document.createElement('button');c.textContent='Dismiss';c.style.cssText='display:block;margin-top:10px;padding:5px 12px;cursor:pointer;';
 c.onclick=()=>{el.remove();browser.runtime.sendMessage({type:'hib-rc109-dismiss-permission'}).catch(()=>{});};
 el.append(h,i,c);(document.body||document.documentElement).appendChild(el);return 'shown';
})()`;
async function hibRc108PermissionFlow({target,priorWindow,priorTab,store,closeScan}){
 hibPermTried.set(target.origin,Date.now());hibPermResult='unknown';
 let tab;
 try{
  const base={url:target.href,active:true,...(priorWindow!==null?{windowId:priorWindow}:{}),...(Number.isInteger(priorTab)?{openerTabId:priorTab}:{})};
  try{tab=await browser.tabs.create(store&&store!=='firefox-default'?{...base,cookieStoreId:store}:base);}catch(_){tab=await browser.tabs.create(base);}
 }catch(e){console.info('[HIB RC108]',{status:'PERMISSION_TAB_FAILED',error:String(e)});return 'tab-error';}
 hibPermTab={id:tab.id,owner:priorTab};
 console.info('[HIB RC108]',{status:'PERMISSION_TAB_OPENED',origin:target.origin});
 await closeScan();
 for(let w=0;w<12;w++){const t=await browser.tabs.get(tab.id).catch(()=>null);if(!t||t.status==='complete')break;await sleep(250);}
 await browser.tabs.executeScript(tab.id,{code:hibRc108TipCode}).catch(()=>{});
 await new Promise(resolve=>{
  const onRemoved=id=>{if(id!==tab.id)return;browser.tabs.onRemoved.removeListener(onRemoved);resolve();};
  browser.tabs.onRemoved.addListener(onRemoved);
  browser.tabs.get(tab.id).then(()=>{},()=>{browser.tabs.onRemoved.removeListener(onRemoved);resolve();});
 });
 hibPermTab=null;
 console.info('[HIB RC108]',{status:'PERMISSION_TAB_CLOSED',verified:hibPermResult});
 return hibPermResult;
}
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-rc109-dismiss-permission')return undefined;
 const id=sender?.tab?.id;
 if(hibPermTab===null||id!==hibPermTab.id)return Promise.resolve({ok:false});
 return (async()=>{
  try{const r=await browser.tabs.executeScript(id,{code:hibRc111PlaybackCode});hibPermResult=r?.[0]?.result??r?.[0]??'unknown';}catch(_){hibPermResult='unknown';}
  // RC423: tell every tab of this site to forget its apostrophe tags so the cards are scanned again (autoplay may be allowed now).
  try{const t=await browser.tabs.get(id);const origin=new URL(t.url).origin;
   for(const tab of await browser.tabs.query({url:origin+'/*'}))if(tab.id!==id)browser.tabs.sendMessage(tab.id,{type:'hib-rc423-clear-autoplay-marks'}).catch(()=>{});
   hibPermTried.delete(origin);}catch(_){}
  await browser.tabs.remove(id).catch(()=>{});
  return {ok:true};
 })();
});

browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type!=='hib-scan-is-probe')return undefined;
 return Promise.resolve({probe:hibScanProbes.has(sender?.tab?.id)});
});
let hibRc108BusySince=0;
/* RC346 janitor: a discovery window never stays open (20 s after its result) and a stuck discovery lock is released after 75 s */
setInterval(async()=>{
 try{
  for(const [wid,v] of [...hibRc276Windows.entries()]){
   if(Date.now()-v.resultAt>20000){try{await browser.windows.remove(wid);}catch(_){}hibRc276Windows.delete(wid);}
  }
  if(hibRc108Busy&&hibRc108BusySince&&Date.now()-hibRc108BusySince>150000&&!hibRc111Handoff){
   console.warn('[HIB RC346]',{status:'STALE_DISCOVERY_RELEASED'});
   for(const [key,pr] of [...hibRc293Owned.entries()]){try{const w=await pr;await browser.windows.remove(w.id);}catch(_){}hibRc293Owned.delete(key);}
   hibRc108Busy=false;
  }
 }catch(_){}
},5000);
const hibRc312AutoplayOk=new Map();
const hibRc329SubCandidates=new Map();
/* RC346 diagnostic (global): while a scan is running or just ended, log every tab / window that appears or takes focus and what opened it,
 * so a focus grab can be traced to its cause (page script, ad, permission helper, ...). */
let hibTabLogUntil=0;

/* RC346 test-build diagnostic: HIB console lines written during a scan (and 20 s after) are also saved to Downloads\HIB_SCANLOG.txt
 * (overwritten each scan), so a focus problem can be read without opening the console. */
const hibLogBuf=[];
(()=>{for(const k of ['info','warn','log','error']){const o=console[k].bind(console);
 console[k]=(...a)=>{try{if(hibRc108Busy||Date.now()<hibTabLogUntil){const t=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');if(/^\[HIB/.test(t)){hibLogBuf.push(new Date().toISOString().slice(11,23)+' '+t.slice(0,/DEBUGSTOP/.test(t)?6000:500));if(hibLogBuf.length>1500)hibLogBuf.shift();}}}catch(_){}o(...a);};}})();
let hibRc343Timer=null;
function hibRc343ScheduleLogWrite(){
 /* RC457: HIB never writes HIB_SCANLOG.txt (or any file) on its own any more. The log lines stay in memory only (trimmed here) and are available through the
  * popup's diagnostics; the only file HIB writes is the one you ask for with a "Capture report" button. */
 if(hibRc343Timer)return;
 hibRc343Timer=setTimeout(()=>{hibRc343Timer=null;if(hibLogBuf.length>4000)hibLogBuf.splice(0,hibLogBuf.length-4000);},22000);
}
const hibTabLog=(kind,d)=>{try{if(hibRc108Busy||Date.now()<hibTabLogUntil)console.info('[HIB TABLOG]',kind,d);}catch(_){}};
browser.tabs.onCreated.addListener(t=>{if(hibRc108Busy)hibTabLogUntil=Date.now()+20000;hibTabLog('TAB_CREATED',{id:t.id,store:t.cookieStoreId,active:t.active,opener:t.openerTabId,window:t.windowId,url:String(t.url||t.pendingUrl||'').slice(0,120)});});
browser.tabs.onActivated.addListener(a=>{hibTabLog('TAB_ACTIVATED',{tab:a.tabId,previous:a.previousTabId,window:a.windowId});});
browser.windows.onCreated.addListener(w=>{if(hibRc108Busy)hibTabLogUntil=Date.now()+20000;hibTabLog('WINDOW_CREATED',{id:w.id,type:w.type,focused:w.focused,state:w.state});});
browser.windows.onFocusChanged.addListener(id=>{hibTabLog('WINDOW_FOCUS',{window:id});});
browser.tabs.onUpdated.addListener((id,c,t)=>{if(c.url||c.status==='loading')hibTabLog('TAB_UPDATED',{id,window:t.windowId,active:t.active,status:c.status,url:String(c.url||'').slice(0,120)});});
browser.tabs.onRemoved.addListener((id,i)=>{hibTabLog('TAB_REMOVED',{id,window:i.windowId,windowClosing:i.isWindowClosing});});
browser.windows.onRemoved.addListener(id=>{hibTabLog('WINDOW_REMOVED',{id});});

function hibRc332Srt2Vtt(t){return 'WEBVTT\n\n'+t.replace(/\r/g,'').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g,'$1.$2');}
/* RC441: language of a subtitle candidate: from its ADDRESS (en / eng / english, ar / ara / arabic, ja / jpn / japanese ...) first, otherwise from the SCRIPT of
 * its text (Arabic, Cyrillic, Hangul, kana, Han, Thai, Hebrew, Greek). Plain Latin text with no language hint returns null (unknown Latin language). */
function hibRc440Lang(url,text){
 const names={en:'en',eng:'en',english:'en',ar:'ar',ara:'ar',arabic:'ar',ja:'ja',jp:'ja',jpn:'ja',japanese:'ja',es:'es',spa:'es',spanish:'es',fr:'fr',fra:'fr',fre:'fr',french:'fr',
  de:'de',deu:'de',ger:'de',german:'de',pt:'pt',por:'pt',portuguese:'pt',it:'it',ita:'it',italian:'it',ru:'ru',rus:'ru',russian:'ru',ko:'ko',kor:'ko',korean:'ko',
  zh:'zh',zho:'zh',chi:'zh',chinese:'zh',id:'id',ind:'id',indonesian:'id',th:'th',tha:'th',thai:'th',vi:'vi',vie:'vi',vietnamese:'vi',tr:'tr',tur:'tr',turkish:'tr',hi:'hi',hin:'hi',hindi:'hi'};
 try{
  const path=decodeURIComponent(new URL(url).pathname).toLowerCase();
  /* RC472: the FILE NAME is read first, then the folders from the nearest outward: a title word in a folder ('...Honi de Yatte Mitara...' = German 'de') must never outrank the file's own 'eng.ass' */
  /* RC508: a TITLE word must never be read as a language. 'Honi de Yatte Mitara' (German 'de'), 'ita', 'id', 'hi' ... appear in titles. So:
   *   file name  - only a code that is a SUFFIX tag: one of the last 3 pieces before the extension, scanned from the END (the tag follows the title), and a 2-letter code
   *                must be attached with . _ - [ ( , never separated by spaces from the title ('Honi de Yatte' has spaces; 'Title.eng.ass' / 'Title [en].vtt' do not);
   *   folders    - only a folder that IS the language ('en', 'eng/', 'English', 'subs-en', 'subtitles_german'), never a title folder containing a language word. */
  const segs=path.split('/').filter(Boolean);
  const file=(segs.pop()||'').replace(/\.[a-z0-9]{2,4}$/,'');
  const pieces=[...file.matchAll(/([^a-z]*)([a-z]+)/g)].map(m=>({delim:m[1],tok:m[2]}));
  for(const pc of pieces.slice(-3).reverse()){
   if(!names[pc.tok]||pc.tok.length<2)continue;
   if(pc.tok.length===2&&!/[._\-\[(]$/.test(pc.delim))continue;     // short code glued to the title by spaces only = a title word
   return names[pc.tok];
  }
  for(const seg of segs.reverse()){
   const m=seg.trim().match(/^(?:(?:subs?|subtitles?|captions?|srt|vtt)[ ._-]*)?([a-z]{2,})$/);
   if(m&&names[m[1]])return names[m[1]];
  }
 }catch(_){}
 const t=String(text||'').slice(0,20000);
 const count=re=>(t.match(re)||[]).length;
 const sets=[['ar',/[\u0600-\u06FF]/g],['ru',/[\u0400-\u04FF]/g],['ko',/[\uAC00-\uD7AF]/g],['ja',/[\u3040-\u30FF]/g],['zh',/[\u4E00-\u9FFF]/g],['th',/[\u0E00-\u0E7F]/g],['he',/[\u0590-\u05FF]/g],['el',/[\u0370-\u03FF]/g]];
 let best=null,bestN=0;for(const [code,re] of sets){const n=count(re);if(n>bestN){best=code;bestN=n;}}
 if(bestN>=10)return best;
 /* RC508: Latin-script text with no language hint in the address: plain English dialogue is recognised by its common words (the player's default is English). */
 const en=(t.match(/\b(?:the|and|you|that|this|with|have|for|not|are|was|what|just|your|can|but)\b/gi)||[]).length;
 return en>=12?'en':null;
}
/* RC439: share of Latin letters among all letters of the dialogue text of a subtitle file (VTT / SRT / ASS). >= 85 % counts as English-script. */
function hibRc439LooksLatin(text){
 try{
  let body=String(text||'');
  // ASS: only the dialogue text (last field of "Dialogue:" lines), without {override tags}
  if(/\[Events\]/i.test(body.slice(0,8000))){body=body.split(/\r?\n/).filter(l=>/^Dialogue:/i.test(l)).map(l=>l.split(',').slice(9).join(',').replace(/\{[^}]*\}/g,' ')).join('\n');}
  else body=body.replace(/^WEBVTT.*$/m,'').replace(/\d+:\d\d[:.,]\d\d\d?\s*-->\s*\d+:\d\d[:.,]\d\d\d?[^\n]*/g,' ').replace(/<[^>]+>/g,' ');
  body=body.slice(0,60000);
  const latin=(body.match(/[A-Za-zÀ-ɏ]/g)||[]).length,letters=(body.match(/\p{L}/gu)||[]).length;
  return letters<20?true:latin/letters>=0.85;   // a near-empty file cannot be judged
 }catch(_){return true;}
}
async function hibRc332FetchSub(url,page,timeoutMs,anyLang){
 const c=new AbortController();const tm=setTimeout(()=>c.abort(),timeoutMs);
 try{
  const r=await fetch(url,{credentials:'include',referrer:page,cache:'no-store',signal:c.signal});
  clearTimeout(tm);
  if(!r.ok)return null;
  const raw=await r.text();
  if(raw.length>3000000)return null;
  const t=raw.replace(/^\uFEFF/,'').trimStart();
  // RC439: ENGLISH ONLY. A subtitle file whose letters are mostly NOT Latin (Arabic, Cyrillic, Greek, Hebrew, Thai, CJK ...) is rejected, so the
  // next candidate (the English one) is used. Timestamps, numbers, tags and ASS styling lines carry no language and are ignored.
  const latinOk=hibRc439LooksLatin(t);
  if(!latinOk&&!anyLang)return null;   // RC441: the track list (anyLang) keeps every language; the single default still has to be Latin script
  const lang=hibRc440Lang(url,t);
  const path=new URL(url).pathname;
  const label=/(?:^|[\/._-])(?:en|eng|english)(?:[\/._-]|$)/i.test(path)?'English':'Subtitles';
  if(t.startsWith('WEBVTT'))return {ok:true,text:t,label,kind:'vtt',lang,latinOk,url};
  if(/^\d+\s*\r?\n\d\d:\d\d:\d\d[,.]\d{3}\s*-->/.test(t))return {ok:true,text:hibRc332Srt2Vtt(t),label,kind:'srt',lang,latinOk,url};
  if(/^\[Script Info\]/i.test(t)||/\[Events\]/i.test(t.slice(0,6000)))return {ok:true,format:'ass',url,label,kind:'ass',lang,latinOk};
  return null;
 }catch(_){clearTimeout(tm);return null;}
}
browser.runtime.onMessage.addListener((msg)=>{
 if(msg?.type!=='hib-rc332-get-subs')return undefined;
 return (async()=>{
  const rec=hibRc329SubCandidates.get(msg.url)||{urls:[],page:msg.page||''};
  const bad=/(?:thumb|sprite|storyboard|preview|seek)/i;
  const en=u=>/(?:^|[\/._-])(?:en|eng|english)(?:[\/._-]|$)/i.test(u)?1:0;
  const norm=raw=>{try{const x=new URL(raw,rec.page||msg.url);return x.protocol==='https:'&&!bad.test(x.pathname)?x.href:null;}catch(_){return null;}};
  const observed=[...new Set(rec.urls.map(norm).filter(Boolean))].sort((a,b)=>en(b)-en(a)).slice(0,10);
  let found=null,tracks=[];
  if(observed.length){
   const res=await Promise.all(observed.map(u=>hibRc332FetchSub(u,rec.page,6000,true)));
   tracks=res.filter(Boolean);
   found=tracks.find(x=>x.latinOk)||null;   // the legacy single default: first Latin-script candidate (English-named ones are sorted first)
  }
  const pagePromise=(async()=>{if(found)return;
   /* RC472: the episode PAGE itself often lists its subtitle files (a download / track list) on a host other than the media's, which the guesses below can never reach.
      Read the page once and take every .ass / .vtt / .srt address in it (English-named first). Generic, no site rules. */
   try{
    const pg=rec.page||msg.page||'';
    if(/^https:/i.test(pg)){
     const ctl=new AbortController();const tm0=setTimeout(()=>ctl.abort(),6000);
     const html=await fetch(pg,{credentials:'include',cache:'no-store',signal:ctl.signal}).then(r=>r.ok?r.text():'').catch(()=>'');clearTimeout(tm0);
     const urls=[...new Set((String(html).split('\/').join('/').match(/https:\/\/[^\s"'<>\)]+?\.(?:ass|vtt|srt)(?:\?[^\s"'<>\)]*)?/gi)||[]).map(norm).filter(Boolean))].sort((x,y)=>en(y)-en(x)).slice(0,8);
     if(urls.length){
      const res2=await Promise.all(urls.map(u=>hibRc332FetchSub(u,pg,6000,true)));
      for(const t of res2.filter(Boolean))if(!tracks.some(x=>x.url===t.url))tracks.push(t);
      found=tracks.find(x=>x.latinOk)||null;
      console.info('[HIB RC346]',{status:'SUBTITLES_FROM_PAGE',listed:urls.length,usable:tracks.length,found:!!found});
     }
    }
   }catch(_){}
  })();   // RC481: runs alongside the guesses below; whichever finds a track first ends the other
  if(!found){
   // nothing observed (or nothing usable): look next to the media file for the usual subtitle names
   let guesses=[];
   try{
    const m=new URL(msg.url);
    const dir=m.origin+m.pathname.replace(/[^\/]*$/,'');
    const base=m.origin+m.pathname.replace(/\.[a-z0-9]{2,5}$/i,'');
    guesses=[dir+'subs/en.vtt',dir+'subs/eng.vtt',dir+'subs/english.vtt',dir+'subtitles/en.vtt',dir+'subtitles/eng.vtt',dir+'en.vtt',dir+'eng.vtt',base+'.vtt',base+'.en.vtt',base+'.eng.vtt',base+'.srt',base+'.ass'];
    // RC429: the subtitle file often sits one folder ABOVE the media (hstream: .../E02/720/manifest.mpd with .../E02/eng.ass). Try the parent
    // folder too, and the usual ASS names (the player renders ASS with libass). Generic names only, no site rules.
    const up=dir.replace(/[^\/]+\/$/,'');
    for(const d of (up.length>m.origin.length+1&&up!==dir?[dir,up]:[dir])){
     // RC438: ENGLISH-named files only. Generic names (sub, subs, subtitles) were removed: they can be ANY language and picked foreign subtitles.
     for(const n of ['eng.ass','en.ass','english.ass','sub_en.ass','sub_eng.ass','sub_english.ass'])guesses.push(d+n);
     // RC431: also the "sub_en.vtt" family (oppai.stream keeps .../<video>/sub_en.vtt next to the dash/ folder)
     for(const n of ['sub_en.vtt','sub_eng.vtt','sub_english.vtt','sub_en.srt'])guesses.push(d+n);
     if(d===up)for(const n of ['eng.vtt','en.vtt','english.vtt','eng.srt','en.srt'])guesses.push(d+n);
    }
   }catch(_){}
   // RC431: the most common names first (parent folder, then the media folder) so the usual case is found in the first batch.
   try{const m2=new URL(msg.url),dir2=m2.origin+m2.pathname.replace(/[^\/]*$/,''),up2=dir2.replace(/[^\/]+\/$/,'');
    const first=[];for(const d of (up2.length>m2.origin.length+1&&up2!==dir2?[up2,dir2]:[dir2]))for(const n of ['sub_en.vtt','eng.ass','en.vtt','eng.vtt','sub_en.ass','en.ass'])first.push(d+n);
    guesses=first.concat(guesses);}catch(_){}
   const uniq=[...new Set(guesses)].slice(0,48);
   // RC431: batches of 6 (the browser allows ~6 parallel requests per host; 48 at once made the later guesses time out in the queue).
   for(let i=0;i<uniq.length&&!found;i+=6){
    const res=await Promise.all(uniq.slice(i,i+6).map(u=>hibRc332FetchSub(u,rec.page||msg.page||'',3500)));
    found=found||res.find(Boolean)||null;
   }
   if(found)console.info('[HIB RC346]',{status:'SUBTITLES_FOUND_BY_LOOKUP',kind:found.kind});
  }
  await pagePromise;
  if(found)console.info('[HIB RC346]',{status:'SUBTITLES_READY',kind:found.kind});
  // RC441: every candidate found goes to the player as a TRACK LIST (language detected) so the user can pick; a guessed file is a one-item list.
  if(found&&!tracks.some(x=>x.url===found.url))tracks.push(found);
  const list=tracks.map(x=>({kind:x.kind,format:x.format,url:x.url,text:x.text,label:x.label,lang:x.lang||null,latin:x.latinOk!==false}));
  const fonts=Array.isArray(rec.fonts)?rec.fonts.slice(0,8):[];   // page fonts for ASS playback
  if(found)return {...found,tracks:list,fonts};
  return list.length?{ok:true,tracks:list,fonts}:{ok:false};
 })();
});

/* RC460: a stream's playlist can load without a Referer while its media files refuse that (hotlink protection answers 401/403/404/410 to the segments only).
 * Look at the first media file the playlist names (following one master -> variant step); if it is refused, the address is flagged so the Referer hook
 * (same-host rule) supplies the page that verified it for the whole stream. */
/* RC495: is a stream manifest (DASH .mpd / HLS .m3u8) really usable? The manifest must load and look like one, and its first media piece (the init segment of a DASH
 * template, or the first segment of an HLS playlist) must answer. Used by the scan to accept a manifest that is verified as reachable, without waiting for the
 * page's own player to get going (some players need 10-40 s of ads / clicks / slow starts before they move). Generic; any failure simply means 'not accepted early'. */
async function hibManifestAlive(u){
 try{
  const href=new URL(u).href;
  const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),6000);
  const r=await fetch(href,{cache:'no-store',signal:ctl.signal});clearTimeout(tm);
  if(!r.ok)return false;
  const text=(await r.text()).slice(0,400000);
  // one ranged request for the first media piece: 200 or 206 = it is there
  const probe=async(piece)=>{const c2=new AbortController();const t2=setTimeout(()=>c2.abort(),6000);try{const r2=await fetch(piece,{headers:{Range:'bytes=0-0'},cache:'no-store',signal:c2.signal});return r2.status===200||r2.status===206;}finally{clearTimeout(t2);}};
  const firstLine=(t)=>t.split(/\r?\n/).map(x=>x.trim()).find(x=>x&&x[0]!=='#');
  if(/<MPD[\s>]/i.test(text)){
   const init=/initialization="([^"]+)"/.exec(text),rep=/<Representation[^>]*\sid="([^"]+)"/.exec(text);
   if(!init)return true;                                                     // single-file / base-URL layouts: the manifest itself is the proof
   return await probe(new URL(init[1].replace(/\$RepresentationID\$/g,rep?rep[1]:'0').replace(/\$Bandwidth\$/g,'0'),href).href);
  }
  if(/^\s*#EXTM3U/.test(text)){
   const first=firstLine(text);
   if(!first)return false;
   const abs=new URL(first,href).href;
   if(/\.m3u8(?:[?#]|$)/i.test(new URL(abs).pathname)){                       // master playlist: look at its first variant's first piece
    const r3=await fetch(abs,{cache:'no-store'});if(!r3.ok)return false;
    const f3=firstLine(await r3.text());
    return f3?await probe(new URL(f3,abs).href):false;
   }
   return await probe(abs);
  }
  return false;
 }catch(_){return false;}
}
async function hibRefererNeedProbe(u,text,depth){
 const first=String(text).split(/\r?\n/).map(s=>s.trim()).find(s=>s&&s[0]!=='#');
 if(!first)return;
 const abs=new URL(first,u.href);
 if(abs.protocol!=='https:')return;
 if(/\.m3u8(?:[?#]|$)/i.test(abs.pathname)){
  if(depth>0)return;
  const pr=await fetch(abs.href,{cache:'no-store'});
  if(pr.status!==200)return;
  return hibRefererNeedProbe(abs,await pr.text(),depth+1);
 }
 const sr=await fetch(abs.href,{headers:{Range:'bytes=0-1'},cache:'no-store'});
 try{if(sr.body)sr.body.cancel();}catch(_){}
 if([401,403,404,410,412].includes(sr.status)){const hh=hib101MediaOriginHints.get(u.href)||hib101MediaOriginHints.get(abs.href);if(hh){hh.needsReferer=true;hibRefererSync();console.info('[HIB RC346]',{status:'MEDIA_FILES_NEED_REFERER',host:abs.hostname,http:sr.status});}}
}
browser.runtime.onMessage.addListener((msg)=>{
 if(msg?.type!=='hib-rc326-verify-url')return undefined;
 return (async()=>{
  let u;try{u=new URL(msg.url);}catch(_){return {alive:false};}
  if(u.protocol!=='https:')return {alive:true};
  try{const ref=new URL(msg.referrer);const had=hib101MediaOriginHints.get(u.href);if(ref.protocol==='https:'&&!(had&&Date.now()<had.until))hib101MediaOriginHints.set(u.href,{referrer:ref.href,until:Date.now()+30*60*1000,source:'verified-popup'});}catch(_){}   // RC459: never replace the embed's own address (set when the scan played it) with the page address
  const c=new AbortController();const t=setTimeout(()=>c.abort(),2500);   // RC496: a slow answer is treated as 'alive' below; waiting 5 s here delayed every first open of a freshly found video
  try{
   const isHls=/\.m3u8(?:[?#]|$)/i.test(u.pathname);
   const probe=()=>fetch(u.href,{headers:isHls?{}:{Range:'bytes=0-1'},cache:'no-store',signal:c.signal,redirect:'follow'});
   let r=await probe();
   /* RC459: a refusal may only mean "no Referer" (hotlink protection): flag the address, let the Referer hook add the page that verified it, and ask once more. A second refusal = the file is gone / its signature ran out. */
   if([401,403,410,412].includes(r.status)){try{if(r.body)r.body.cancel();}catch(_){}const hh=hib101MediaOriginHints.get(u.href);if(hh&&!hh.needsReferer){hh.needsReferer=true;hibRefererSync();r=await probe();}}
   clearTimeout(t);
   let ok=!(r.status===404||r.status===410||r.status===412),reason='';
   if(r.status===200&&isHls){const full=await r.text();ok=full.slice(0,64).trimStart().startsWith('#EXTM3U');if(!ok)reason='not-a-manifest';if(ok)await hibRefererNeedProbe(u,full,0).catch(()=>{});}
   else if(r.status===200&&/\.mpd(?:[?#]|$)/i.test(u.pathname)){const full=await r.text();ok=/<MPD[\s>]/i.test(full.slice(0,4000));if(!ok)reason='not-a-manifest';}   // 3.0.1: a streaming mirror that answers with a web page instead of the manifest
   else{try{if(r.body)r.body.cancel();}catch(_){}}
   /* RC465: 401/403 after the Referer retry is NOT 'dead': hosts behind a DDoS guard / session cookie refuse a request made outside the page and still serve the player's own (saved cards were dropped and re-scanned in a loop). Expired signatures are caught by hibUrlExpired (stale) instead. */
   console.info('[HIB RC346]',{status:'CACHED_URL_CHECK',alive:ok,http:r.status,host:u.hostname});
   return {alive:ok,status:r.status,reason};
  }catch(e){clearTimeout(t);console.info('[HIB RC346]',{status:'CACHED_URL_CHECK',alive:true,error:String(e)});return {alive:true,error:String(e)};/* RC450: a failed check never discards a saved card */}
 })();
});

async function hibRc321EnsureNoScanWindows(){
 const ids=new Set();
 for(const [wid,v] of [...hibRc276Windows.entries()]){ids.add(wid);hibRc276Windows.delete(wid);}
 for(const [key,pr] of [...hibRc293Owned.entries()]){try{const w=await pr;if(w?.id!==undefined)ids.add(w.id);}catch(_){}hibRc293Owned.delete(key);}
 let closed=0;
 for(const id of ids){
  for(let attempt=0;attempt<3;attempt++){
   try{await browser.windows.remove(id);}catch(_){}
   const still=await browser.windows.get(id).then(()=>true,()=>false);
   if(!still){closed++;break;}
   await new Promise(r=>setTimeout(r,150));
  }
 }
 if(ids.size)console.info('[HIB RC346]',{status:'LEFTOVER_SCAN_WINDOWS_CLOSED_BEFORE_NEW_SCAN',found:ids.size,closed});
}
const hibRc276AckPending=new Map();
let hibRc276Active=null;
// RC279: single-flight by originating tab + exact media destination.
// Never start a second discovery for an already-running matching request.
let hibRc279ActiveKey=null;
let hibRc279ActivePromise=null;
const hibRc279Acked=new Map();
browser.runtime.onMessage.addListener((msg,sender)=>{
 if(msg?.type==='hib-rc268-source-received'){
  const item=hibRc276AckPending.get(msg.token);
  if(!item || item.owner!==sender?.tab?.id || item.url!==msg.url)return Promise.resolve({ok:false,error:'unmatched verified source acknowledgment'});
  // Do not consume the token until the owned resolver actually closes.
  return (async()=>{
   const matching=[...hibRc276Windows.entries()].filter(([id,v])=>v.owner===item.owner&&v.pageUrl===item.pageUrl).map(([id])=>id);
   if(!matching.includes(item.windowId))matching.push(item.windowId);
   let closed=0,errors=[];
   for(const id of matching){
    try{await browser.windows.remove(id);closed++;hibRc276Windows.delete(id);}
    catch(e){
     const missing=await browser.windows.get(id).then(()=>false,()=>true);
     if(missing){hibRc276Windows.delete(id);closed++;}else errors.push(String(e));
    }
   }
   if(errors.length){console.warn('[HIB RC279]',{status:'ACK_CLEANUP_FAILED',errors});return {ok:false,error:errors.join('; '),closed};}
   hibRc276AckPending.delete(msg.token);
   hibRc279Acked.set(item.owner+'|'+item.pageUrl,{url:item.url,at:Date.now()});
   console.info('[HIB RC279]',{status:'VERIFIED_RESOLVER_CLOSED',owner:item.owner,page:item.pageUrl,closed});
   return {ok:true,closed};
  })();
 }
 if(msg?.type!=='hib-rc259-probe-video')return undefined;
 if(!sender?.tab?.id)return Promise.resolve({error:'Card tab required',sources:[]});
 const owner=sender.tab.id;
 let requestUrl;
 try{requestUrl=new URL(msg.pageUrl).href;}catch{return Promise.resolve({error:'Invalid media page URL',sources:[]});}
 const requestKey=owner+'|'+requestUrl;
 if(hibPermTab!==null)return Promise.resolve({error:'Video probe busy (permission tab open)',busy:true,sources:[]});
 if(hibRc279ActivePromise){
  if(hibRc279ActiveKey===requestKey){
   console.info('[HIB RC279]',{status:'JOIN_EXISTING_PROBE',page:requestUrl});
   return hibRc279ActivePromise;
  }
  return Promise.resolve({error:'Video probe busy (different card currently scanning)',busy:true,sources:[]});
 }
 const task=(async()=>{
  let target;
  try{target=new URL(msg.pageUrl);if(!/^https?:$/.test(target.protocol))throw Error('Invalid URL');}
  catch(e){return {error:String(e),sources:[]};}
  await hibRc321EnsureNoScanWindows();
  console.info('[HIB RC276]',{status:'LEGACY_CORE_ENTERED',page:target.href});
  let original=await hibRc133ResolveMedia({type:'hib-test-global-rendered-media',pageUrl:target.href,rc276Bridge:true,knownSource:msg.knownSource},sender);
  if(original?.autoplayPermission&&['allowed-after-close','recheck-after-close'].includes(original.autoplayPermission.status)){
   console.info('[HIB RC108]',{status:'RESUME_DISCOVERY_AFTER_PERMISSION',after:original.autoplayPermission.status});
   original=await hibRc133ResolveMedia({type:'hib-test-global-rendered-media',pageUrl:target.href,rc276Bridge:true,permissionRetry:true},sender);
  }
  if(original?.busy)return {busy:true,error:original.error||'busy',sources:[]};
  if(original?.autoplayPermission?.status==='site-allow-required'&&!original.ok){console.info('[HIB RC346]',{status:'AUTOPLAY_NOT_ALLOWED_APOSTROPHE'});original={...original,landing:true,reason:'autoplay-blocked'};}
  const retained=[...hibRc276Windows.entries()].filter(([,v])=>v.owner===owner&&v.pageUrl===target.href).sort((x,y)=>y[1].resultAt-x[1].resultAt)[0];
  // RC297: the resolver window has done its job the moment the resolver returns (verified, landing page or failure):
  // close it now instead of keeping it open and playing in the background.
  for(const [wid,v] of [...hibRc276Windows.entries()]){
   if(v.owner===owner&&v.pageUrl===target.href){try{await browser.windows.remove(wid);}catch(_){}hibRc276Windows.delete(wid);}
  }
  if(original?.landing){console.info('[HIB RC297]',{status:'LANDING_REPORTED_POPUP_CLOSED',reason:original.reason||'landing',page:target.href});return {landing:true,reason:original.reason||'landing',sources:[],error:null};}
  console.info('[HIB RC276]',{status:'LEGACY_CORE_RETURNED',ok:!!original?.ok,verified:!!original?.verified,url:original?.url||null,error:original?.error||null,retainedWindow:retained?.[0]??null});
  if(!(original?.ok&&original?.verified&&/^https?:\/\//.test(original.url||''))){
   return {error:original?.error||'Legacy resolver did not verify a source',sources:[],frames:original?.framesExamined||0,observations:original?.diagnosticSnapshots||[],autoplayPermission:original?.autoplayPermission||null};
  }
  const token='hib276-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  if(retained)hibRc276AckPending.set(token,{owner,url:original.url,windowId:retained[0],pageUrl:target.href});
  return {sources:[{url:original.url,kind:'verified-media',format:original.mediaFormat||'legacy',frame:String(original.candidates?.[0]?.frame||'')}],playbackVerified:!!retained,resultToken:retained?token:null,detectedEngine:original.rc150DetectedEngine||original.engine||null,frames:original.framesExamined||0,observations:original.diagnosticSnapshots||[],subtitles:original.subtitles||null};
 })().catch(e=>{console.error('[HIB RC276] LEGACY_CORE_FAILED',String(e));return {error:String(e),sources:[]};});
 hibRc276Active=task;
 hibRc279ActiveKey=requestKey;
 const delivered=task.finally(()=>{
  if(hibRc276Active===task)hibRc276Active=null;
  if(hibRc279ActivePromise===delivered){hibRc279ActivePromise=null;hibRc279ActiveKey=null;}
 });
 hibRc279ActivePromise=delivered;
 return delivered;
});

/* RC284: site engine hint stored independently from expiring episode URLs. */
browser.runtime.onMessage.addListener((message,sender)=>{
 if(message?.type!=='hib-rc284-record-known-engine')return undefined;
 try{
  const site=new URL(message.siteUrl);
  if(!/^https?:$/.test(site.protocol)||!sender?.tab?.url||new URL(sender.tab.url).hostname!==site.hostname)
   return Promise.resolve({ok:false,error:'site origin mismatch'});
  return HIBRC150.recordKnownEngine(site.hostname,message.engine)
   .then(ok=>({ok}),error=>({ok:false,error:String(error)}));
 }catch(error){return Promise.resolve({ok:false,error:String(error)});}
});


/* RC346: toolbar "Clear HIB video cache" + a clean video cache on every load of the add-on */
browser.runtime.onMessage.addListener((msg)=>{
 if(msg?.type!=='hib-rc346-clear-cache')return undefined;
 return (async()=>{
  try{await browser.storage.local.remove(['hibRc291VerifiedEpisodeMedia']);}catch(_){}
  try{hibRc329SubCandidates.clear();hibRc312AutoplayOk.clear();}catch(_){}
  let n=0;
  try{for(const t of await browser.tabs.query({})){try{await browser.tabs.sendMessage(t.id,{type:'hib-rc346-clear-cache-page'});n++;}catch(_){}}}catch(_){}
  console.info('[HIB RC346]',{status:'VIDEO_CACHE_CLEARED',tabs:n});
  return {ok:true,tabs:n};
 })();
});
/* RC449: the verified-video cache is kept across browser restarts (entries expire by age / address expiry); only the toolbar button clears it. */
/* ===== END VIDEO SECTION - BACKGROUND (video parts of background.js) - VIDEO FINAL (RC507) ===== */
