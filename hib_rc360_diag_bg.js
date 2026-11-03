/* ===== START ONE-CARD TRACE (Report Issue / Submit Request) =====
 * The trace of what HIB did for ONE card at a time, held in memory only (never written to disk). A new card starts a new trace: the old one is dropped, so memory
 * stays small however long the page is used. A card starts when
 *   - the video hover begins to scan a different card (RC386_TAG_SHOWN with no symbol yet), or
 *   - an image link is hovered / right-clicked for resolving (RC386_IMG_TRIGGER) for a different address.
 * Everything else (video open / player steps, image resolve start / retry / stall / result, gallery open) is appended to the current card's trace, up to 300 events.
 * Producers: the video hover script and the image sections send { type:'hib-rc360-log', event:'RC386_...' }; background code calls rc386Push directly. */
globalThis.rc386Trace=globalThis.rc386Trace||[];
globalThis.rc386CardKey='';
globalThis.rc386Push=function(event,detail){
 try{
  const d=detail&&typeof detail==='object'?detail:{};
  const key=String(d.key||d.url||'');
  const starts=(event==='RC386_TAG_SHOWN'&&d.symbol==null)||event==='RC386_IMG_TRIGGER';
  if(starts&&key&&key!==globalThis.rc386CardKey){globalThis.rc386Trace.length=0;globalThis.rc386CardKey=key;}
  globalThis.rc386Trace.push({e:event,d:detail,t:Date.now()});
  if(globalThis.rc386Trace.length>300)globalThis.rc386Trace.shift();
 }catch(_){}
};
/* ===== END ONE-CARD TRACE ===== */
"use strict";
/* RC362 transient bounded segment assembly. No persistence or playback. */
const rc385hObserverStates=new Map();
const rc360Tabs=new Map(), rc362Transfers=new Map(), rc362Segments=new Map();
const MAX_SEG=18*1024*1024,MAX_TAB=320*1024*1024,MAX_AGE=30*60*1000;
const rc364Holds=new Map(),rc364Seen=new Map();
// RC379: transient source-session fingerprint only; never retain media URLs or credentials.
const rc379Sessions=new Map();
function rc364State(id){const a=rc362Segments.get(id)||[];const now=Date.now();const ready=new Map();for(const x of a){const k=x.frame+':'+x.sourceBufferId;const v=ready.get(k)||new Set();v.add(x.kind);ready.set(k,v);}return {queuedBytes:a.reduce((n,x)=>n+x.bytes.length,0),tracks:a.length,completePairs:[...ready.values()].filter(v=>v.has('init')&&v.has('media')).length,ageMs:a.length?now-Math.max(...a.map(x=>x.created)):null,lastCaptureAt:rc364Seen.get(id)||null,held:rc364Holds.has(id)};}

function log(tab,frame,event,detail){const a=rc360Tabs.get(tab)||[];a.push({time:new Date().toISOString(),frameId:frame,event,detail:JSON.stringify(detail).slice(0,700)});if(a.length>400)a.shift();rc360Tabs.set(tab,a);}
function clearOld(){const now=Date.now();for(const [id,v] of rc362Transfers)if(now-v.created>MAX_AGE)rc362Transfers.delete(id);for(const [tab,a] of rc362Segments){const kept=rc364Holds.has(tab)?a:a.filter(x=>now-x.created<MAX_AGE);if(kept.length)rc362Segments.set(tab,kept);else rc362Segments.delete(tab);}}
const binToHex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');

// RC375: Passive, bounded, token-free media transport observation.
// No request interception, response rewriting, downloading, or changes to RC374 capture.
const rc375Network=new Map(),rc375Requests=new Map();
function rc375Kind(url){
 try {const u=new URL(url),p=u.pathname.toLowerCase();
  if(/\.m3u8(?:$|\/)/.test(p))return 'hls-manifest';
  if(/\.mpd(?:$|\/)/.test(p))return 'dash-manifest';
  if(/\.(?:m4s|cmfv|cmfa)(?:$|\/)/.test(p))return 'fmp4-segment';
  if(/\.(?:mp4|m4a|webm|ts)(?:$|\/)/.test(p))return 'media-file';
  if(/videoplayback/i.test(p))return 'playback-endpoint';
  if(/(?:manifest|playlist)/i.test(p))return 'possible-manifest';
  return 'other';
 }catch(_){return 'invalid';}
}
function rc375Observe(tab,kind,update){
 if(!Number.isInteger(tab)||!rc364Holds.has(tab))return;
 const a=rc375Network.get(tab)||{created:Date.now(),total:0,counts:{},samples:[]};
 a.total++;a.counts[kind]=(a.counts[kind]||0)+1;
 if(a.samples.length<80)a.samples.push({time:Date.now(),kind,...update});
 rc375Network.set(tab,a);
}
try {
 browser.webRequest.onBeforeRequest.addListener(d=>{
  if(!Number.isInteger(d.tabId)||!rc364Holds.has(d.tabId))return;
  const kind=rc375Kind(d.url);
  if(kind==='other'||kind==='invalid')return;
  rc375Requests.set(d.requestId,{tab:d.tabId,kind,created:Date.now()});
  rc375Observe(d.tabId,kind,{phase:'request',method:d.method,resourceType:d.type});
 },{urls:['<all_urls>']});
 browser.webRequest.onBeforeSendHeaders.addListener(d=>{
  const r=rc375Requests.get(d.requestId);if(!r)return;
  const hasRange=(d.requestHeaders||[]).some(x=>x.name.toLowerCase()==='range');
  if(hasRange)rc375Observe(r.tab,r.kind,{phase:'range-header'});
 },{urls:['<all_urls>']},['requestHeaders']);
 browser.webRequest.onHeadersReceived.addListener(d=>{
  const r=rc375Requests.get(d.requestId);if(!r)return;
  const ct=((d.responseHeaders||[]).find(x=>x.name.toLowerCase()==='content-type')?.value||'').split(';')[0].slice(0,80);
  rc375Observe(r.tab,r.kind,{phase:'response',status:d.statusCode,contentType:ct});
 },{urls:['<all_urls>']},['responseHeaders']);
 const forget=d=>rc375Requests.delete(d.requestId);
 browser.webRequest.onCompleted.addListener(forget,{urls:['<all_urls>']});
 browser.webRequest.onErrorOccurred.addListener(forget,{urls:['<all_urls>']});
}catch(e){console.warn('RC375 passive observation unavailable',String(e));}

// RC384A: source-tab-independent transport proof. Capture only the next
// authenticated Google Drive playback metadata response, while transparently
// forwarding every byte to the original consumer. Signed URLs remain in RAM,
// only with explicit opt-in, and are never placed in extension logs/storage.
const rc384Armed=new Map(),rc384Metadata=new Map();
try{
 browser.webRequest.onBeforeRequest.addListener(d=>{
  if(!rc384Armed.has(d.tabId)||d.method!=='GET'||d.tabId<0)return;
  if(!/^https:\/\/workspacevideo-pa\.clients6\.google\.com\/v1\/drive\/media\/[^/]+\/playback(?:\?|$)/.test(d.url))return;
  if(typeof browser.webRequest.filterResponseData!=='function')return;
  let filter;
  try{filter=browser.webRequest.filterResponseData(d.requestId);}catch(_){return;}
  const chunks=[];let total=0;
  filter.ondata=ev=>{
   // Always forward unmodified response data first.
   try{filter.write(ev.data);}catch(_){}
   if(total<=192*1024){total+=ev.data.byteLength;if(total<=192*1024)chunks.push(new Uint8Array(ev.data).slice());}
  };
  filter.onstop=()=>{
   try{filter.disconnect();}catch(_){}
   if(total>192*1024||!rc384Armed.has(d.tabId))return;
   try{
    const raw=new Uint8Array(total);let p=0;for(const c of chunks){raw.set(c,p);p+=c.length;}
    const obj=JSON.parse(new TextDecoder().decode(raw));
    const m=obj.mediaStreamingData;
    if(!m)return;
    const inner=JSON.parse(m.serializedHouseBrandPlayerResponse||'{}');
    const sd=inner.streamingData||{};
    const progressive=(sd.formats||[]).filter(f=>typeof f.url==='string'&&f.url.startsWith('https://')).map(f=>({itag:f.itag,mime:f.mimeType,url:f.url}));
    const hls=typeof m.hlsManifestUrl==='string'&&m.hlsManifestUrl.startsWith('https://')?m.hlsManifestUrl:null;
    if(!progressive.length&&!hls)return;
    rc384Metadata.set(d.tabId,{capturedAt:Date.now(),progressive,hls});
    rc384Armed.delete(d.tabId);
   }catch(_){}
  };
  filter.onerror=()=>{try{filter.disconnect();}catch(_){}};
 },{urls:['https://workspacevideo-pa.clients6.google.com/v1/drive/media/*/playback*']},['blocking']);
}catch(e){console.warn('RC384A metadata interceptor unavailable',String(e));}
async function rc384CheckUrl(url,range){
 const ctl=new AbortController();const timeout=setTimeout(()=>ctl.abort(),10000);
 try{
  const headers=range?{'Range':'bytes=0-65535'}:{};
  const r=await fetch(url,{method:'GET',credentials:'omit',redirect:'follow',headers,signal:ctl.signal});
  const mime=(r.headers.get('content-type')||'').split(';')[0];
  const reader=r.body?.getReader();let total=0,head=[],prefix='';
  if(reader){while(total<65536){const v=await reader.read();if(v.done)break;const sub=v.value.slice(0,Math.min(v.value.length,65536-total));if(total<32)head.push(...sub.slice(0,32-total));total+=sub.length;}try{await reader.cancel();}catch(_){}}
  const ascii=head.map(x=>(x>=32&&x<127)?String.fromCharCode(x):'.').join('');
  const m3u8=ascii.startsWith('#EXTM3U');
  const mp4=ascii.includes('ftyp')||ascii.includes('moov')||ascii.includes('styp');
  return {status:r.status,ok:r.ok,mime,bytesRead:total,manifestDetected:m3u8,mp4BoxDetected:mp4,rangeRequested:!!range};
 }catch(e){return {ok:false,error:e.name==='AbortError'?'timeout':String(e).slice(0,160)};}
 finally{clearTimeout(timeout);}
}

// RC384B keeps ONLY previously user-armed signed candidate URLs in volatile RAM
// after the original tab closes, for at most 10 minutes. No token persistence.
const rc384BPreClose=new Map();
async function rc384BNewRange(url){
 const offset=1048576, last=offset+65535;
 const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),12000);
 try {
  const r=await fetch(url,{method:'GET',credentials:'omit',redirect:'follow',
   headers:{Range:`bytes=${offset}-${last}`},signal:ctl.signal,cache:'no-store'});
  const mime=(r.headers.get('content-type')||'').split(';')[0];
  const cr=r.headers.get('content-range')||'';
  const match=/^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(cr);
  const rangeHonored=r.status===206 && !!match && Number(match[1])===offset && Number(match[2])>=offset;
  const reader=r.body?.getReader(); let size=0;let head=[];
  if(reader){while(size<65536){const part=await reader.read();if(part.done)break;
   const bytes=part.value.slice(0,65536-size);
   if(head.length<16)head.push(...bytes.slice(0,16-head.length)); size+=bytes.length;
  }try{await reader.cancel();}catch(_){}}
  const nonzero=head.some(x=>x!==0);
  return {ok:r.ok,status:r.status,mime,bytesRead:size,rangeStart:offset,
   rangeHonored,responseRangeStart:match?Number(match[1]):null,
   responseRangeEnd:match?Number(match[2]):null,
   nonzeroPrefix:nonzero,validated:rangeHonored&&size>0&&nonzero&&mime==='video/mp4'};
 }catch(e){return {ok:false,error:e.name==='AbortError'?'timeout':String(e).slice(0,150),validated:false};}
 finally {clearTimeout(timer);}
}
function rc384BSourceTabOpen(tabId){return browser.tabs.get(tabId).then(()=>true,()=>false);}
browser.runtime.onMessage.addListener((m,s)=>{
 if(!m||typeof m.type!=='string'||!/^hib-rc(?:36|37|384|385n|386|387)/.test(m.type))return;
 const tab=s.tab?.id,frame=s.frameId??0;
 if(m.type==='hib-rc384-direct-playback'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))
    return Promise.resolve({ok:false,error:'player-origin-only'});
  return (async()=>{
   const baseline=rc384BPreClose.get(m.tabId);
   if(!baseline||!baseline.preflightPassed)return {ok:false,error:'arm-reload-and-verify-acquisition-first'};
   if(Date.now()-baseline.capturedAt>10*60*1000)return {ok:false,error:'signed-media-link-expired-repeat-capture'};
   if(await rc384BSourceTabOpen(m.tabId))return {ok:false,error:'original-drive-tab-must-be-closed'};
   const check=await rc384BNewRange(baseline.url);
   if(!check.validated)return {ok:false,error:'post-close-fresh-range-validation-failed',
    status:check.status||null,reason:check.error||'invalid-response'};
   // Only hand off a verified URL to the *extension-owned* player, never to logs/storage.
   return {ok:true,url:baseline.url,sourceTabClosed:true,revalidatedAfterClose:true,
    representation:{mime:'video/mp4',itag:18}};
  })().catch(e=>({ok:false,error:String(e).slice(0,160)}));
 }
 if(m.type==='hib-rc384-post-close-range'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))
   return Promise.resolve({ok:false,error:'player-origin-only'});
  return (async()=>{
   const baseline=rc384BPreClose.get(m.tabId);
   if(!baseline||!baseline.preflightPassed)return {ok:false,error:'first-pass-preclose-acquisition-required'};
   if(Date.now()-baseline.capturedAt>10*60*1000){rc384BPreClose.delete(m.tabId);rc384Metadata.delete(m.tabId);
    return {ok:false,error:'signed-candidate-expired-restart-test'};}
   if(await rc384BSourceTabOpen(m.tabId))return {ok:false,error:'source-tab-still-open-close-it-manually-first'};
   const result=await rc384BNewRange(baseline.url);
   // A strictly new byte offset requested only AFTER the source tab was closed.
   return {ok:true,phase:'post-close-tested',sourceTabClosed:true,acquisitionOwner:'extension-background',
    priorOpenTabRange:{status:baseline.status,bytesRead:baseline.bytesRead},
    newUncachedRange:result,independentAfterCloseValidated:result.validated,
    note:'A fresh extension-owned HTTP range request was made after original source-tab removal; no credentials or signed URLs logged. Full-length playback is not yet proven.'};
  })().catch(e=>({ok:false,error:String(e).slice(0,150)}));
 }
 if(m.type==='hib-rc384-independent-probe'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))
    return Promise.resolve({ok:false,error:'player-origin-only'});
  return (async()=>{
   const tab=await browser.tabs.get(m.tabId);
   if(!/^https:\/\/drive\.google\.com\//.test(tab.url||''))return {ok:false,error:'not-a-google-drive-source'};
   const meta=rc384Metadata.get(m.tabId);
   if(!meta){rc384Armed.set(m.tabId,Date.now());return {ok:true,phase:'armed',instruction:'Reload the original Google Drive tab to generate fresh playback metadata, then press this button again. No tokens logged.'};}
   if(Date.now()-meta.capturedAt>10*60*1000){rc384Metadata.delete(m.tabId);rc384Armed.set(m.tabId,Date.now());return {ok:false,phase:'armed',error:'metadata-expired-reload-source'};}
   const fmt=meta.progressive.find(f=>f.itag===18)||meta.progressive[0];
   const progressive=fmt?await rc384CheckUrl(fmt.url,true):{ok:false,error:'not-offered'};
   const hls=meta.hls?await rc384CheckUrl(meta.hls,false):{ok:false,error:'not-offered'};
   if(fmt&&progressive.status===206&&progressive.mp4BoxDetected&&progressive.bytesRead>0)
    rc384BPreClose.set(m.tabId,{url:fmt.url,capturedAt:Date.now(),preflightPassed:true,
     status:progressive.status,bytesRead:progressive.bytesRead});

   return {ok:true,phase:'tested',acquisitionOwner:'extension-background',sourceTabStillOpen:true,
    representation:fmt?{itag:fmt.itag,mime:fmt.mime}:null,
    progressive,hls,
    independentFetchValidated:!!(progressive.mp4BoxDetected||hls.manifestDetected),
    note:'Tests HTTP acquisition from the extension background, not playback or after-close fetching. No full media download, no URLs, cookies, headers, or auth values logged.'};
  })().catch(e=>({ok:false,error:String(e).slice(0,160)}));
 }
 if(m.type==='hib-rc385n-demand-source'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))
   return Promise.resolve({ok:false,error:'player-origin-only'});
  return (async()=>{
   const source=await browser.tabs.get(m.tabId);
   if(!/^https?:/.test(source.url||''))return {ok:false,error:'source-tab-unavailable'};
   // The request is explicitly user-triggered, and modifies only the source
   // HTMLVideoElement's media position. No media URLs or keys are extracted.
   const frames=await browser.tabs.executeScript(m.tabId,{allFrames:true,code:`(()=>{
    try{
     const vs=[...document.querySelectorAll('video')].filter(v=>Number.isFinite(v.duration)&&v.duration>5&&v.readyState>=2);
     const v=vs.sort((a,b)=>(b.videoWidth*b.videoHeight)-(a.videoWidth*a.videoHeight))[0];
     if(!v)return {ok:false,reason:'no-ready-video'};
     const duration=v.duration,initialTime=v.currentTime;
     const priorEnd=v.buffered.length?v.buffered.end(v.buffered.length-1):0;
     if(priorEnd>=duration-0.5)return {ok:true,reason:'source-already-buffered',priorEnd,duration};
     if(!v.paused)return {ok:false,reason:'source-currently-playing',priorEnd,duration};
     const target=Math.max(0,Math.min(duration-1,priorEnd-1.5));
     if(target<=initialTime+0.25)return {ok:false,reason:'no-forward-demand-target',priorEnd,duration,initialTime};
     const originalMuted=v.muted;
     v.muted=true;
     v.currentTime=target;
     // Source player acquisition may be demand-driven. Initiate a short,
     // muted playback window and restore pause/mute after three seconds.
     const pr=v.play();if(pr&&pr.catch)pr.catch(()=>{});
     setTimeout(()=>{try{v.pause();v.muted=originalMuted;}catch(_){ }},3000);
     return {ok:true,reason:'muted-demand-triggered',priorEnd,target,duration,initialTime};
    }catch(e){return {ok:false,reason:String(e).slice(0,120)};}
   })()`});
   const results=frames.map((x,i)=>({frame:i,...(x||{})}));
   return {ok:results.some(x=>x.ok),results,note:'Trigger only. Check Source Session / Acquisition A/B after capture settles. Source tab must remain open; this is not independent acquisition.'};
  })().catch(e=>({ok:false,error:String(e).slice(0,180)}));
 }
 if(m.type==='hib-rc379-source-session'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))
   return Promise.resolve({ok:false,error:'player-origin-only'});
  return (async()=>{
   const source=await browser.tabs.get(m.tabId);
   const snapshot=rc379Sessions.get(m.tabId)||{tracks:[],lastCaptureAt:null};
   const frames=await browser.tabs.executeScript(m.tabId,{allFrames:true,code:`(() => ({
    origin:location.origin,
    videos:[...document.querySelectorAll('video')].map(v=>({
      paused:v.paused,readyState:v.readyState,networkState:v.networkState,
      currentTime:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,
      bufferedEnd:v.buffered.length?v.buffered.end(v.buffered.length-1):0,
      sourceAttached:!!(v.currentSrc||v.src),error:v.error?.code||null
    }))
   }))()`}).catch(e=>[{origin:'unavailable',error:String(e).slice(0,120),videos:[]}]);
   const now=Date.now();
   const sourceVideos=frames.flatMap(f=>(f.videos||[]).map(v=>({origin:f.origin,...v})));
   const lastCaptureAt=snapshot.lastCaptureAt||null;
   const ageMs=lastCaptureAt?now-lastCaptureAt:null;
   const initialized=sourceVideos.some(v=>v.readyState>=2);
   const origin=source.url?new URL(source.url).origin:null;
   return {ok:true,sourceOrigin:origin,sourceTabId:m.tabId,sourceTabStatus:source.status,
    captureAgeMs:ageMs,captureState:!lastCaptureAt?'not-yet-captured':ageMs>15000?'no-new-fragments':'recent-fragments',
    sourceState:initialized?'media-initialized':sourceVideos.length?'media-idle-or-reset':'video-not-found',
    tracks:snapshot.tracks,sourceVideos,
    note:'Diagnostic fingerprint only; internal capture seq is not an HTTP segment or byte range. No upstream requests made. URLs and tokens are not retained.'};
  })().catch(e=>({ok:false,error:String(e)}));
 }
 if(m.type==='hib-rc375-transport'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  const a=rc375Network.get(m.tabId);return Promise.resolve({ok:true,observed:!!a,total:a?.total||0,counts:a?.counts||{},samples:a?.samples||[],note:'passive observations only; URLs and tokens not recorded'});
 }
 if(m.type==='hib-rc360-log'){
  if(typeof m.event==='string'&&m.event.startsWith('RC386_'))globalThis.rc386Push(m.event,m.detail);
  if(Number.isInteger(tab)){
   if(m.event==='RC385H_OBSERVER_STATE'){
    const state=rc385hObserverStates.get(tab)||{};
    state[String(frame)]={frameId:frame,seenAt:Date.now(),...m.detail};
    rc385hObserverStates.set(tab,state);
   }else if(!String(m.event||'').startsWith('RC386_IMG_'))log(tab,frame,String(m.event||'event'),m.detail||{});   /* image trace events live only in the one-card trace (rc386Push) */
  }
  return Promise.resolve({ok:true});
 }
 /* RC410: "does THIS tab have a captured MediaSource stream?"  Asked by hib_takeover.js (content script, top frame of the page) when the
  * user presses "Play with HIB". The tab id is taken from the SENDER (a page can never ask about another tab).
  *   reply {ok, tabId, enabled, hasInit, segments}
  *     enabled  - the "capture streams" switch (hibRC360CaptureEnabled) is on; if it is off nothing can have been captured
  *     hasInit  - an initialisation segment (ftyp/moov) is held for this tab, i.e. the segment player can start
  *     segments - number of segments currently held in RAM for this tab (informational)
  * The message type starts with "hib-rc387" because the filter at the top of this listener only forwards types that match it. */
 if(m.type==='hib-rc387-capture-info'){
  const tid=s.tab?.id;
  if(!Number.isInteger(tid)||String(s.url||'').startsWith('moz-extension:'))return Promise.resolve({ok:false});
  const segs=rc362Segments.get(tid)||[];
  return browser.storage.local.get('hibRC360CaptureEnabled').then(d=>({ok:true,tabId:tid,enabled:d.hibRC360CaptureEnabled===true,hasInit:segs.some(x=>x.kind==='init'),segments:segs.length}));
 }
 /* RC411: a right-click on the video happened inside an IFRAME of the page (Google Drive). Frames cannot draw the HIB window themselves,
  * so the sender's TOP frame (frameId 0) is asked to open it (unified_player.js answers hib-rc387-open-window). The tab comes from the sender. */
 if(m.type==='hib-rc387-open-captured'){
  const tid=s.tab?.id;
  if(!Number.isInteger(tid)||String(s.url||'').startsWith('moz-extension:'))return Promise.resolve({ok:false});
  return browser.tabs.sendMessage(tid,{type:'hib-rc387-open-window'},{frameId:0}).then(r=>({ok:true,opened:r===true}),()=>({ok:false}));
 }
 if(m.type==='hib-rc360-get')return Promise.resolve({ok:true,trace386:globalThis.rc386Trace||[],records:rc360Tabs.get(m.tabId)||[],observerStates:Object.values(rc385hObserverStates.get(m.tabId)||{})});
 if(m.type==='hib-rc360-clear'){rc360Tabs.delete(m.tabId);rc385hObserverStates.delete(m.tabId);rc362Segments.delete(m.tabId);return Promise.resolve({ok:true});}
 // RC378: Explicit per-source test-cache reset. Only the HIB player origin may request it.
 if(m.type==='hib-rc378-clear-source-cache'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))
   return Promise.resolve({ok:false,error:'player-origin-only'});
  return (async()=>{
   const source=await browser.tabs.get(m.tabId);
   if(!/^https?:/.test(source.url||''))return {ok:false,error:'source-tab-not-available'};
   const before={ramFragments:(rc362Segments.get(m.tabId)||[]).length,disk:hib369Cache.stats()};
   // Serialize disk deletion with ongoing cache operations before clearing RAM state.
   const deleted=await hib369Cache.dropTab(m.tabId);
   if(!deleted?.ok)return {ok:false,error:'disk-cache-clear-failed'};
   rc362Segments.delete(m.tabId);rc364Seen.delete(m.tabId);rc379Sessions.delete(m.tabId);
   for(const [k,x] of rc362Transfers)if(x.tab===m.tabId)rc362Transfers.delete(k);
   return {ok:true,tabId:m.tabId,ramFragmentsRemoved:before.ramFragments,
     beforeDiskFragments:before.disk.cachedFragments,after:rc364State(m.tabId),
     disk:hib369Cache.stats(),message:'Selected source cache cleared. Use Enable Probe & Reload Source for Recapture before a fresh capture test.'};
  })().catch(e=>({ok:false,error:String(e)}));
 }
 if(m.type==='hib-rc364-status'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('')))return Promise.resolve({ok:false,error:'player-origin-only'});
  clearOld();return Promise.resolve({ok:true,...rc364State(m.tabId),replayCache:hib369Cache.stats()});
 }
 if(m.type==='hib-rc364-hold'){
  if(!Number.isInteger(m.tabId)||!Number.isInteger(tab)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  rc364Holds.set(m.tabId,tab);return Promise.resolve({ok:true,...rc364State(m.tabId)});
 }
 if(m.type==='hib-rc372-poster-status'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  /* RC417: the page's player must not be left running or audible by HIB's start-up step. BEFORE anything is clicked/played, every frame gets a
   * short-lived capture-phase 'play' listener: a video that goes from paused to playing during the next 60 s is remembered as
   * {paused:true, muted:<original>} in window.__hibRc386.saved (the same table the source driver uses) and MUTED at once. When the HIB window closes
   * the driver's release then pauses it and restores its mute state, so the page is left exactly as HIB found it. (Without this the driver only
   * saw the video after the page had started it audibly, "saved" that as the original state, and never paused it on close.) */
  const PRIME_GUARD=`(function(){try{
    var d=window.__hibRc386||(window.__hibRc386={saved:new Map()});
    if(d.onPlay)document.removeEventListener('play',d.onPlay,true);
    d.onPlay=function(e){var v=e.target;if(!v||v.tagName!=='VIDEO')return;if(!d.saved.has(v))d.saved.set(v,{muted:v.muted,paused:true});v.muted=true;};
    document.addEventListener('play',d.onPlay,true);
    setTimeout(function(){if(d.onPlay){document.removeEventListener('play',d.onPlay,true);d.onPlay=null;}},60000);
   }catch(e){}})()`;
  return browser.tabs.executeScript(m.tabId,{allFrames:true,matchAboutBlank:true,code:PRIME_GUARD}).catch(()=>{}).then(()=>browser.tabs.get(m.tabId)).then(t=>{
   if(!/^https?:/.test(t.url||''))throw Error('source-tab-unavailable');
   return browser.tabs.executeScript(m.tabId,{frameId:0,code:`(function(){
    try {
     // Advisory only. Posters are optional, and a missing image must never block media.
     var regions=Array.from(document.querySelectorAll('[role="tabpanel"],section,[role="region"]'));
     var players=regions.filter(el=>/^(?:video|media)[ ]*player$/i.test((el.getAttribute('aria-label')||'').trim()));
     if(!players.length)return {state:'unknown',reason:'no-semantic-player',images:0};
     var region=players.find(el=>{
       var r=el.getBoundingClientRect();return r.width>0&&r.height>0;
     })||players[0];
     var imgs=Array.from(region.querySelectorAll('img'));
     // Some players render their poster beside the accessible player panel.
     if(!imgs.length&&region.parentElement)imgs=Array.from(region.parentElement.querySelectorAll('img'));
     var posters=imgs.filter(el=>{
       var r=el.getBoundingClientRect();
       var desc=((el.getAttribute('alt')||'')+' '+(el.getAttribute('aria-label')||'')).toLowerCase();
       return (r.width>=80&&r.height>=45)||/poster|preview|thumbnail/.test(desc);
     });
     if(!posters.length)return {state:'unknown',reason:'no-visible-poster',images:imgs.length};
     var image=posters[0];
     return {state:image.complete&&image.naturalWidth>0?'ready':'pending',complete:!!image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,images:posters.length};
    } catch(e){return {state:'unknown',reason:'inspection-error',error:String(e).slice(0,160)};}
   })()`}).then(x=>({ok:true,...(x[0]||{state:'unknown',reason:'no-result'})}));
  }).catch(e=>({ok:false,error:String(e)}));
 }
 /* RC418: SOURCE HOLD. Sent by the embedded HIB window when it opens. The user wants the page's own player to be MUTED while the HIB window plays,
  * and to be left exactly as it was (paused if it was paused) when the window closes. For every frame of the source tab:
  *   - each existing <video> is remembered in window.__hibRc386.saved as {muted, paused} (first remembered state wins) and muted now;
  *   - a capture-phase 'play' listener remembers + mutes any video that STARTS later (HIB's start-up step, the driver, or the page itself),
  *     recording it as {paused:true, muted:<original>}.
  * The matching release is the 'release' branch of hib-rc386-drive below (sent when the window closes). */
 if(m.type==='hib-rc387-source-hold'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  return browser.tabs.executeScript(m.tabId,{allFrames:true,matchAboutBlank:true,code:`(function(){try{
   var d=window.__hibRc386||(window.__hibRc386={saved:new Map()});
   document.querySelectorAll('video').forEach(function(v){if(!d.saved.has(v))d.saved.set(v,{muted:v.muted,paused:v.paused});v.muted=true;});
   if(d.onPlay)document.removeEventListener('play',d.onPlay,true);
   d.onPlay=function(e){var v=e.target;if(!v||v.tagName!=='VIDEO')return;if(!d.saved.has(v))d.saved.set(v,{muted:v.muted,paused:true});v.muted=true;};
   document.addEventListener('play',d.onPlay,true);
  }catch(e){}})()`}).then(()=>({ok:true})).catch(e=>({ok:false,error:String(e).slice(0,120)}));
 }
 if(m.type==='hib-rc386-drive'){
  // RC386: generic source driver. A captured MSE source (blob: <video>) stops requesting data once its own
  // short prefetch window is full while its element is idle, so the independent player starves at that point.
  // Keep that element playing muted, only a few seconds ahead of the HIB playhead; release restores it.
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  const time=Number(m.time)||0,playing=m.playing===true,release=m.release===true;
  return browser.tabs.executeScript(m.tabId,{allFrames:true,matchAboutBlank:true,code:`(function(t,playing,release){
   try{
    var d=window.__hibRc386||(window.__hibRc386={saved:new Map()});
    if(release){
     // RC418: release EVERY remembered video (not only blob: ones): pause it if HIB found it paused, restore its mute state.
     if(d.onPlay){document.removeEventListener('play',d.onPlay,true);d.onPlay=null;}
     var rel=0;d.saved.forEach(function(sv,v){try{if(sv.paused)v.pause();v.muted=sv.muted;v.playbackRate=1;rel++;}catch(e){}});
     d.saved.clear();return {released:rel};
    }
    var vids=Array.prototype.slice.call(document.querySelectorAll('video')).filter(function(v){return (v.currentSrc||v.src||'').indexOf('blob:')===0&&v.readyState>0;});
    if(!vids.length)return {n:0};
    var out=[];
    vids.forEach(function(v){
     if(!d.saved.has(v))d.saved.set(v,{muted:v.muted,paused:v.paused});
     if(release){if(d.onPlay){document.removeEventListener('play',d.onPlay,true);d.onPlay=null;}var sv=d.saved.get(v);try{if(sv&&sv.paused)v.pause();if(sv)v.muted=sv.muted;v.playbackRate=1;}catch(e){}d.saved.delete(v);out.push('released');return;}
     v.muted=true;
     var lead=v.currentTime-t;
     // RC394: while the source is less than ~10 s ahead of the HIB playhead let it run at 2x so its streamer gets ahead.
     if(playing&&!v.paused){var pr2=lead<10?2:1;if(v.playbackRate!==pr2)v.playbackRate=pr2;}
     if(!playing){if(lead>1.5&&!v.paused)v.pause();}
     else if(lead<20&&v.paused&&!v.ended){var pr=v.play();if(pr&&pr.catch)pr.catch(function(e){d.blocked=String(e&&e.name||e).slice(0,40);});
      // RC391: browser autoplay policy can refuse play() from a script. The source streamer keeps fetching only while
      // its playhead is within ~17 s of the buffered end, so follow the HIB playhead by seeking inside buffered data.
      if(d.blocked&&v.buffered.length){var tgt=t+3,be=v.buffered.end(v.buffered.length-1);if(tgt>be-0.5)tgt=be-0.5;if(tgt>v.currentTime+1){try{v.currentTime=tgt;}catch(e){}}}}
     else if(lead>30&&!v.paused)v.pause();
     out.push({lead:Math.round(lead*10)/10,paused:v.paused,blocked:d.blocked||undefined,ct:Math.round(v.currentTime*10)/10});
    });
    return {n:vids.length,out:out};
   }catch(e){return {err:String(e).slice(0,120)};}
  })(${time},${playing},${release})`}).then(r=>({ok:true,frames:(r||[]).filter(Boolean)})).catch(e=>({ok:false,error:String(e).slice(0,160)}));
 }
 if(m.type==='hib-rc387-q'){
  // RC398: manual quality list/select for adaptive players; relayed to the source tab's frames, never automatic.
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  const frames=new Set([0]);for(const x of (rc362Segments.get(m.tabId)||[]))if(Number.isInteger(x.frame))frames.add(x.frame);
  const msg=m.op==='set'?{type:'hib-rc387-q-set',kind:String(m.kind||'').slice(0,12),id:Number(m.id)}:{type:'hib-rc387-q-list'};
  return Promise.all([...frames].map(f=>browser.tabs.sendMessage(m.tabId,msg,{frameId:f}).catch(()=>null))).then(rs=>{
   const hit=rs.filter(r=>r&&r.ok);
   if(m.op==='set')return {ok:true,applied:hit.reduce((a,r)=>a+(r.applied||0),0)};
   return {ok:true,players:hit.flatMap(r=>r.players||[]),dbg:hit.flatMap(r=>r.dbg||[])};
  });
 }
 if(m.type==='hib-rc369-prime'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  // Source priming is explicitly initiated by the independent player's Load button.
  // No DOM synthetic click, frame navigation, or site-specific resolver.
  return browser.tabs.get(m.tabId).then(t=>{
   if(!/^https?:/.test(t.url||''))throw Error('source-tab-unavailable');
   // RC371: Try a visible semantic Play control inside a player region first.
   // Scope to the source top frame, activate once, and never click unrelated controls.
   // This is a synthetic click, so browser/user-activation policies may still block it.
   return browser.tabs.executeScript(m.tabId,{frameId:0,code:`(function(){
     try {
       var regions=Array.from(document.querySelectorAll('[role="tabpanel"], [aria-label], video'));
       var eligible=regions.filter(el=>{
         var label=(el.getAttribute('aria-label')||'').trim();
         return /(?:video\\s*player|media\\s*player)/i.test(label) || el.tagName==='VIDEO';
       });
       for(var region of eligible){
         var root=region.tagName==='VIDEO'?(region.closest('section,[role="tabpanel"],.player')||region.parentElement):region;
         if(!root)continue;
         // RC413: some players (Google Drive) put their Play control NEXT TO the labelled player region rather than inside it,
         // one or two containers up. Search the region first, then at most two ancestors (still the player's own container).
         var play=null,scope=root;
         for(var up=0;up<3&&scope&&!play;up++,scope=scope.parentElement){
           var buttons=Array.from(scope.querySelectorAll('button,[role="button"]'));
           play=buttons.find(el=>{
             var label=(el.getAttribute('aria-label')||el.getAttribute('title')||'').trim();
             var rect=el.getBoundingClientRect();
             return /^play(?:\\s|$|\\()/i.test(label) && rect.width>0 && rect.height>0 &&
               !el.disabled && el.getAttribute('aria-disabled')!=='true';
           })||null;
         }
         if(play){
           var name=play.getAttribute('aria-label')||play.getAttribute('title')||'Play';
           play.click();
           return {url:location.origin,result:'controller-activated',activated:name,trusted:false};
         }
       }
       return {url:location.origin,result:'no-eligible-player-control'};
     }catch(e){return {url:location.origin,result:'controller-error',error:String(e).slice(0,160)};}
   })()`}).then(controller=>{
     if(controller[0]?.result==='controller-activated')return {ok:true,strategy:'player-controller',frames:controller};
     // No safe semantic controller was found: preserve RC370 video-element priming.
   return browser.tabs.executeScript(m.tabId,{allFrames:true,code:`(function(){
     try{
       var a=Array.from(document.querySelectorAll('video'));
       if(!a.length)return {url:location.origin,videos:0,result:'no-video'};
       var v=a.filter(x=>{var r=x.getBoundingClientRect();return r.width>=100&&r.height>=60}).sort((a,b)=>{var x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height})[0];
       if(!v)return {url:location.origin,videos:a.length,result:'no-visible-player'};
       var before={readyState:v.readyState,networkState:v.networkState,hasSource:!!(v.currentSrc||v.src),paused:v.paused};
       if(!v.paused||v.readyState>=2||v.networkState===2)return {url:location.origin,videos:a.length,result:'already-active',before};
       // load() is safe only when a source exists; avoid resetting unrelated playback.
       if(v.currentSrc||v.src||v.querySelector('source[src]')){try{v.load()}catch(e){}}
       try{
        var p=v.play();
        if(p&&typeof p.then==='function')p.then(()=>{
          browser.runtime.sendMessage({type:'hib-rc360-log',event:'PRIME_PLAY_STARTED',detail:{origin:location.origin}}).catch(()=>{});
        },e=>{
          browser.runtime.sendMessage({type:'hib-rc360-log',event:'PRIME_PLAY_REJECTED',detail:{origin:location.origin,error:String(e).slice(0,160)}}).catch(()=>{});
        });
        return {url:location.origin,videos:a.length,result:'play-requested',before};
       }catch(e){return {url:location.origin,videos:a.length,result:'play-blocked',error:String(e).slice(0,160),before};}
     }catch(e){return {url:location.origin,result:'frame-error',error:String(e).slice(0,160)};}
   })()`}).then(results=>({ok:true,frames:results}));
  });
  }).catch(e=>({ok:false,error:String(e)}));
 }
 if(m.type==='hib-rc364-recapture'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  return (async()=>{const t=await browser.tabs.get(m.tabId);if(!/^https?:/.test(t.url||''))throw Error('Source tab unavailable. Open website video again.');await browser.storage.local.set({hibRC360CaptureEnabled:true});rc362Segments.delete(m.tabId);rc364Seen.delete(m.tabId);rc379Sessions.delete(m.tabId);await hib369Cache.dropTab(m.tabId);await browser.tabs.reload(m.tabId);await browser.tabs.update(m.tabId,{active:true});return {ok:true,message:'Probe enabled and source reloaded. Start media loading on website, then return here and select Load & Play.'};})().catch(e=>({ok:false,error:String(e)}));
 }
 if(m.type==='hib-rc387-quiet-recapture'){
  // RC387: same as the Recapture button but never activates or focuses the source tab.
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  return (async()=>{const t=await browser.tabs.get(m.tabId);if(!/^https?:/.test(t.url||''))throw Error('Source tab unavailable.');
   await browser.storage.local.set({hibRC360CaptureEnabled:true});
   rc362Segments.delete(m.tabId);rc364Seen.delete(m.tabId);rc379Sessions.delete(m.tabId);await hib369Cache.dropTab(m.tabId);
   await browser.tabs.reload(m.tabId);return {ok:true,message:'source reloaded quietly'};})().catch(e=>({ok:false,error:String(e)}));
 }
 if(m.type==='hib-rc363-list'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('')))return Promise.resolve({ok:false,error:'player-origin-only'});
  clearOld();return hib369Cache.list(m.tabId).then(archived=>{const live=(rc362Segments.get(m.tabId)||[]).map(x=>({kind:x.kind,mime:x.mime,frame:x.frame,id:x.sourceBufferId,bytes:x.bytes.length,sha256:x.sha256,seq:x.seq,created:x.created}));const keys=new Set(live.map(x=>[x.frame,x.id,x.seq,x.sha256].join(':')));return {ok:true,tracks:live.concat(archived.filter(x=>!keys.has([x.frame,x.id,x.seq,x.sha256].join(':'))))};});
 }
 if(m.type==='hib-rc363-read'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('')))return Promise.resolve({ok:false,error:'player-origin-only'});
  clearOld();const arr=rc362Segments.get(m.tabId)||[];
  const x=arr.find(x=>x.frame===m.frame&&x.sourceBufferId===m.id&&x.kind===m.kind&&x.sha256===m.sha256&&x.seq===m.seq);
   if(!x)return hib369Cache.read({tab:m.tabId,frame:m.frame,id:m.id,seq:m.seq,sha256:m.sha256},m.offset>>>0).then(r=>{if(!r)return {ok:false,error:'segment-expired-or-missing'};if(m.binary===true)return {ok:true,binary:r.chunk.slice(),offset:m.offset>>>0,bytes:r.chunk.length,total:r.total};let raw='';for(let i=0;i<r.chunk.length;i+=8192)raw+=String.fromCharCode(...r.chunk.subarray(i,i+8192));return {ok:true,base64:btoa(raw),offset:m.offset>>>0,bytes:r.chunk.length,total:r.total};}).catch(e=>({ok:false,error:'replay-read:'+String(e)}));
  const pos=m.offset>>>0;if(pos>=x.bytes.length)return Promise.resolve({ok:false,error:'invalid-offset'});
  // RC393: binary read (structured clone) in 1 MiB steps; base64 path below stays for older callers.
  if(m.binary===true){const e=Math.min(pos+1024*1024,x.bytes.length);return Promise.resolve({ok:true,binary:x.bytes.slice(pos,e),offset:pos,bytes:e-pos,total:x.bytes.length});}
  const b=x.bytes.subarray(pos,Math.min(pos+48*1024,x.bytes.length));let raw='';
  for(let i=0;i<b.length;i+=8192)raw+=String.fromCharCode(...b.subarray(i,i+8192));
  return Promise.resolve({ok:true,base64:btoa(raw),offset:pos,bytes:b.length,total:x.bytes.length});
 }
 if(m.type==='hib-rc365-consumed'){
  if(!Number.isInteger(m.tabId)||!s.url?.startsWith(browser.runtime.getURL('hib_rc363_player.html')))return Promise.resolve({ok:false,error:'player-origin-only'});
  const arr=rc362Segments.get(m.tabId)||[];
  const i=arr.findIndex(x=>x.frame===m.frame&&x.sourceBufferId===m.id&&x.seq===m.seq&&x.sha256===m.sha256&&x.kind!=='init');
  if(i<0){
   // RC374: the player can read an archived fragment from IndexedDB after its
   // RAM copy was acknowledged. ACK must validate that same exact identity in
   // the archive; an unknown fragment is NEVER accepted as a duplicate.
   return hib369Cache.has({tab:m.tabId,frame:m.frame,id:m.id,seq:m.seq,sha256:m.sha256})
    .then(found=>found?{ok:true,alreadyConsumed:true,source:'verified-disk-cache'}:{ok:false,error:'fragment-not-in-ram-or-cache'})
    .catch(e=>({ok:false,error:'cache-ack-verification:'+String(e)}));
  }
  // RC368: retain the first media fragment alongside seq 0 initialization.
  // Both are scoped to their existing tab, frame and SourceBuffer; later media
  // remains consumable to respect MAX_TAB and the source transfer backpressure.
  if(arr[i].seq===1)return Promise.resolve({ok:true,retained:true});
  const x=arr[i];return hib369Cache.put({tab:m.tabId,frame:x.frame,id:x.sourceBufferId,seq:x.seq,sha256:x.sha256,mime:x.mime},x.bytes,t=>rc364Holds.has(t)).then(saved=>{const ix=arr.indexOf(x);if(ix>=0)arr.splice(ix,1);if(!saved.ok)log(m.tabId,x.frame,'REPLAY_CACHE_SKIPPED',{seq:x.seq,reason:saved.error});return {ok:true,replayCached:!!saved.ok,cacheError:saved.error||null};});
 }
 if(!Number.isInteger(tab))return Promise.resolve({ok:false,error:'no-tab'});
 if(m.type==='hib-rc362-begin'){
  clearOld();const total=m.totalBytes>>>0,parts=m.parts>>>0,key=tab+':'+frame+':'+String(m.keyId).slice(0,90);
  if(!total||total>MAX_SEG||!parts||parts>200||!Number.isSafeInteger(Number(m.seq))||Number(m.seq)<0)return Promise.resolve({ok:false,error:'limits'});
  if(rc362Transfers.has(key))return Promise.resolve({ok:false,error:'duplicate'});
  rc362Transfers.set(key,{tab,frame,keyId:m.keyId,kind:String(m.kind),seq:Number(m.seq),mime:String(m.mime).slice(0,160),sourceBufferId:m.sourceBufferId,total,parts,received:0,next:0,chunks:[],created:Date.now()});
  return Promise.resolve({ok:true});
 }
 if(m.type==='hib-rc362-chunk'){
  const key=tab+':'+frame+':'+String(m.keyId).slice(0,90),x=rc362Transfers.get(key);
  if(!x)return Promise.resolve({ok:false,error:'no-transfer'});
  if(m.index!==x.next)return Promise.resolve({ok:false,error:'out-of-order'});
  if(m.binary){const u=m.binary instanceof Uint8Array?m.binary:new Uint8Array(m.binary);
   if(u.length>1024*1024+8)return Promise.resolve({ok:false,error:'chunk-limit'});
   if(x.received+u.length>x.total)return Promise.resolve({ok:false,error:'overflow'});
   x.chunks.push(u);x.received+=u.length;x.next++;return Promise.resolve({ok:true});}
  const b64=String(m.base64||'');if(b64.length>135000)return Promise.resolve({ok:false,error:'chunk-limit'});
  let raw;try{raw=atob(b64);}catch(_){return Promise.resolve({ok:false,error:'base64'});}
  if(x.received+raw.length>x.total)return Promise.resolve({ok:false,error:'overflow'});
  const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  x.chunks.push(bytes);x.received+=raw.length;x.next++;
  return Promise.resolve({ok:true});
 }
 if(m.type==='hib-rc362-end'){
  const key=tab+':'+frame+':'+String(m.keyId).slice(0,90),x=rc362Transfers.get(key);
  if(!x)return Promise.resolve({ok:false,error:'no-transfer'});
  if(x.received!==x.total||x.next!==x.parts)return Promise.resolve({ok:false,error:'incomplete',received:x.received});
  // RC385M: do not destroy a complete transfer on a temporary receiver queue limit.
  // Keep the exact bytes and sequence until the player acknowledges enough RAM
  // fragments to make room. The observer retries END, not BEGIN or the chunks.
  const arr=rc362Segments.get(tab)||[];
  const used=arr.reduce((a,b)=>a+b.bytes.length,0);
  if(used+x.total>MAX_TAB){
   x.pressureRetries=(x.pressureRetries||0)+1;
   if(x.pressureRetries===1||x.pressureRetries%25===0)
    log(tab,frame,'RC385M_RECEIVER_PRESSURE',{sourceBufferId:x.sourceBufferId,seq:x.seq,queuedBytes:used,incomingBytes:x.total,limit:MAX_TAB,retries:x.pressureRetries});
   return Promise.resolve({ok:false,error:'tab-limit-retryable',queuedBytes:used,limit:MAX_TAB,retryAfterMs:160});
  }
  rc362Transfers.delete(key);
  const bytes=new Uint8Array(x.total);let pos=0;for(const c of x.chunks){bytes.set(c,pos);pos+=c.length;}
  return crypto.subtle.digest('SHA-256',bytes).then(hash=>{
   const sha256=binToHex(new Uint8Array(hash));
   const arr=rc362Segments.get(tab)||[];
   // Protect against concurrent completions from other SourceBuffers.
   const used=arr.reduce((a,b)=>a+b.bytes.length,0);
   if(used+bytes.length>MAX_TAB){
    rc362Transfers.set(key,x);
    return {ok:false,error:'tab-limit-retryable',queuedBytes:used,limit:MAX_TAB,retryAfterMs:160};
   }
   rc364Seen.set(tab,Date.now());arr.push({bytes,kind:x.kind,mime:x.mime,frame:x.frame,sourceBufferId:x.sourceBufferId,seq:x.seq,created:Date.now(),sha256});rc362Segments.set(tab,arr);
   // Session fingerprint is updated only after verified bytes are accepted.
   const previous=rc379Sessions.get(tab)||{tracks:[],lastCaptureAt:null};
   const trackKey=x.frame+':'+x.sourceBufferId;
   let track=previous.tracks.find(t=>t.key===trackKey);
   if(!track){track={key:trackKey,frame:x.frame,sourceBufferId:x.sourceBufferId,mime:x.mime,initSeen:false,mediaSeq:null,verifiedFragments:0};previous.tracks.push(track);}
   if(x.kind==='init'&&x.seq===0)track.initSeen=true;
   if(x.kind==='media'){track.mediaSeq=x.seq;track.verifiedFragments++;}
   previous.lastCaptureAt=Date.now();rc379Sessions.set(tab,previous);
   log(tab,frame,'SEGMENT_RECEIVED',{kind:x.kind,mime:x.mime,sourceBufferId:x.sourceBufferId,seq:x.seq,bytes:x.total,sha256});
   return {ok:true,sha256,bytes:x.total};
  }).catch(e=>({ok:false,error:String(e)}));
 }
 if(m.type==='hib-rc362-abort'){rc362Transfers.delete(tab+':'+frame+':'+String(m.keyId).slice(0,90));return Promise.resolve({ok:true});}
 if(m.type==='hib-rc362-status'){clearOld();return Promise.resolve({ok:true,segments:(rc362Segments.get(m.tabId)||[]).map(x=>({kind:x.kind,mime:x.mime,frame:x.frame,id:x.sourceBufferId,bytes:x.bytes.length,sha256:x.sha256}))});}
});
setInterval(()=>{const now=Date.now();for(const [id,r] of rc384BPreClose)
 if(now-r.capturedAt>10*60*1000){rc384BPreClose.delete(id);rc384Metadata.delete(id);}
},60000);
browser.tabs.onRemoved.addListener(id=>{
 // Closing the HIB player only releases its hold; the open source tab owns replay data.
 for(const [source,player] of rc364Holds)if(player===id)rc364Holds.delete(source);
 // Closing the source website tab deletes both memory and IndexedDB video cache.
 rc364Holds.delete(id);rc360Tabs.delete(id);rc362Segments.delete(id);rc364Seen.delete(id);rc379Sessions.delete(id);
 hib369Cache.dropTab(id).catch(e=>console.warn('HIB RC369 source cache cleanup',e));
 for(const [k,x] of rc362Transfers)if(x.tab===id)rc362Transfers.delete(k);
});
// Cleanup is also enforced on accesses, so alarms only improve reclamation latency.
browser.alarms.create('hib-rc369-cache-cleanup',{periodInMinutes:5});
browser.alarms.onAlarm.addListener(a=>{if(a.name==='hib-rc369-cache-cleanup')hib369Cache.clean(t=>rc364Holds.has(t)).catch(e=>console.warn('HIB RC369 cache expiration',e));});

// RC375 passive observation housekeeping: bound history lifetime.
setInterval(()=>{const now=Date.now();for(const [id,r] of rc375Requests)if(now-r.created>120000)rc375Requests.delete(id);for(const [tab,a] of rc375Network)if(!rc364Holds.has(tab)||now-a.created>1800000)rc375Network.delete(tab);},60000);

/* 3.0.0: "Capture streams" (hibRC360CaptureEnabled) is a BETA feature and is OFF by default (Tools > Beta features). It is for pages whose video has no
 * direct address (Mega / Google Drive style) and for the manual quality picker of adaptive players; hover + right-click on ordinary sites work without it.
 * (RC417 had switched it on by default; an existing stored value, on or off, is left as the user has it.) A missing value is written as false so
 * the Tools page and the stored settings agree. */
browser.storage.local.get('hibRC360CaptureEnabled').then(d=>{if(d.hibRC360CaptureEnabled===undefined)return browser.storage.local.set({hibRC360CaptureEnabled:false});}).catch(()=>{});
