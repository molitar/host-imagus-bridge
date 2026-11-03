/* ================================================================
 * RC150 / MODULAR VIDEO DETECTION REGISTRY (READ-ONLY PROBES)
 * ================================================================
 * A player engine (JW, Video.js, NPlayer) is independent from the
 * transport (MP4, HLS, DASH). Each probe returns evidence, never a
 * success/verified state. Browser page scripts can live in a separate
 * JS realm: positive DOM evidence is a hint, not player activation.
 *
 * API:
 *   HIBRC150.buildPlan(profile) -> array of adapter IDs, fastest first
 *   HIBRC150.probeTab(tabId,plan) -> {engine,format,probes,elapsedMs}
 *   HIBRC150.recordVerified(host,path,engine,format) -> Promise<void>
 *   HIBRC150.readProfile(host,path) -> Promise<rule|null>
 * All failures are recoverable and leave the legacy verified popup
 * extraction active. Adding an engine only requires registering a probe.
 * ================================================================ */
const HIBRC150=(()=>{
 'use strict';
 const KEY='hibRc133VerifiedSiteRules';
 const KNOWN_KEY='hibRc284KnownPlayerEngines';
 // Faster, passive checks first. The user can later tune priorities based
 // on measured success; these priorities do not imply verified playback.
 const adapters=[
  {id:'html5',rank:10,probe:function(){const v=document.querySelector('video,audio');return !!(v&&(v.currentSrc||v.src||v.querySelector('source[src]')));}},
  {id:'jwplayer',rank:20,probe:function(){return !!document.querySelector('.jwplayer,.jw-video,[data-jwplayer-id]');}},
  {id:'videojs',rank:30,probe:function(){return !!document.querySelector('video-js,.video-js');}},
  {id:'plyr',rank:40,probe:function(){return !!document.querySelector('.plyr,.plyr__video-wrapper');}},
  {id:'hlsjs',rank:50,probe:function(){return !!document.querySelector('video[src*="m3u8"],source[src*="m3u8"]')||performance.getEntriesByType('resource').some(e=>/\.m3u8(?:[?#]|$)/i.test(e.name));}},
  {id:'dashjs',rank:60,probe:function(){return !!document.querySelector('video[src*="mpd"],source[src*="mpd"]')||performance.getEntriesByType('resource').some(e=>/\.mpd(?:[?#]|$)/i.test(e.name));}},
  {id:'shaka',rank:65,probe:function(){return !!document.querySelector('.shaka-video-container,.shaka-controls-container');}},
  {id:'flowplayer',rank:70,probe:function(){return !!document.querySelector('.flowplayer,.fp-player');}},
  {id:'nplayer',rank:80,probe:function(){return !!document.querySelector('.nplayer,[class*="nplayer"],[id*="nplayer"]');}},
  {id:'iframe',rank:90,probe:function(){return !!document.querySelector('iframe[src*="embed"],iframe[src*="player"]');}}
 ];
 const byId=new Map(adapters.map(a=>[a.id,a]));
 function buildPlan(profile){const id=profile?.engine;return [...adapters].sort((a,b)=>(a.id===id?-1000:a.rank)-(b.id===id?-1000:b.rank)).map(a=>a.id);}
 async function readProfile(host,path){
  const stored=await browser.storage.local.get([KEY,KNOWN_KEY]);
  const db=stored[KEY]||{},family=String(path||'/').split('/').filter(Boolean)[0]||'/';
  const r=db[host]?.cards?.[family];
  if(r?.verified&&r?.kind!=='landing'&&byId.has(r.engine))return r;
  const known=(stored[KNOWN_KEY]||{})[host];
  return known&&byId.has(known.engine)?{engine:known.engine,knownOnly:true,checkedAt:known.checkedAt}:null;
 }
 async function recordKnownEngine(host,engine){
  if(!byId.has(engine))return false;
  const all=await browser.storage.local.get(KNOWN_KEY),db=all[KNOWN_KEY]||{};
  db[host]={engine,checkedAt:Date.now()};
  await browser.storage.local.set({[KNOWN_KEY]:db});return true;
 }
 // Each probe runs in every accessible frame; inaccessible frames simply
 // contribute no evidence. No URL is copied to the profile or logs.
 async function probeTab(tabId,plan){const start=Date.now(),probes=[];for(const id of plan){const a=byId.get(id);if(!a)continue;let matched=false;try{const code=`(${a.probe.toString()})()`;const rows=await browser.tabs.executeScript(tabId,{allFrames:true,code});matched=rows.some(x=>x?.result===true||x===true);}catch(e){probes.push({id,status:'inaccessible'});continue;}probes.push({id,status:matched?'matched':'absent'});if(matched)return {engine:id,probes,elapsedMs:Date.now()-start};}return {engine:'custom',probes,elapsedMs:Date.now()-start};}
 // Site/profile writes are allowed only from the existing playback-verified
 // return path. Never store a transient media URL or authentication token.
 async function recordVerified(host,path,engine,format){const all=await browser.storage.local.get(KEY),db=all[KEY]||{},family=String(path||'/').split('/').filter(Boolean)[0]||'/';const site=db[host]||{cards:{}};site.cards=site.cards||{};site.cards[family]={kind:'video',verified:true,engine:byId.has(engine)?engine:'custom',format,checkedAt:Date.now(),schemaVersion:2};site.verifiedAt=Date.now();db[host]=site;await browser.storage.local.set({[KEY]:db});}
 return Object.freeze({buildPlan,probeTab,readProfile,recordVerified,recordKnownEngine,adapters:adapters.map(({id,rank})=>({id,rank}))});
})();
