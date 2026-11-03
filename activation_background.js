"use strict";
/* ===== START SECTION 3 — SITE DATA / PERMISSIONS / MESSAGE ROUTING ===== */

/* RC153 / VIDEO_SITE_ACTIVATION — authoritative activation state.
 * Input: hostname and existing TEST extension storage.
 * Output: registered, permanentVideo, override, effectiveVideoEnabled.
 * NO scanner, player, DOM modification or site registration side-effects.
 */
/* DEVELOPER DIAGNOSTICS START — one switch; set false for production. */
const HIB_DEVELOPER_DIAGNOSTICS = false;   // RELEASE: no automatic diagnostic windows (developer builds: true)   // RC422: ON for TEST builds (it was false: the automatic diagnostic window never opened). Set false for production.
/* DEVELOPER DIAGNOSTICS END */
const normalize = x=>String(x||'').trim().toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  /* ===== START 3A — SITE ACTIVATION STATE ===== */
async function state(hostname){
 const host=normalize(hostname);
 const s=await browser.storage.local.get(['enabledSites','siteMediaModes','hibRc139ScanVideoHosts']);
 const registered=Array.isArray(s.enabledSites)&&s.enabledSites.some(x=>normalize(typeof x==='string'?x:x?.host||x?.domain)===host);
 const modes=s.siteMediaModes||{};
 const permanentVideo=registered&&(modes[host]==='video'||modes['www.'+host]==='video');
 const override=s.hibRc139ScanVideoHosts?.[host]===true;
 return {host,registered,permanentVideo,override,effectiveVideoEnabled:!!(permanentVideo||override),activationSource:permanentVideo?'PERMANENT':override?'TEST_OVERRIDE':'DISABLED'};
}
/* AUTOMATIC DIAGNOSTIC WINDOWS START — governed by HIB_DEVELOPER_DIAGNOSTICS. */
// RC224: one persistent, passive monitor follows the active WEBSITE tab.
// Never raise the monitor or reload its document when browser tabs change.
const HIB_AUTO_DIAGNOSTICS_KEY='hibAutoDiagnostics';
const HIB_ACTIVE_DIAG_TAB='hibRc224ActiveDiagnosticTab';
const HIB_DIAG_WINDOW_LAYOUT={left:1966,top:0,width:1440,height:1540};
let diagnosticWindowId=null,openingDiagnostic=false;
const isWebsite=url=>/^https?:\/\//i.test(url||'');
  /* ===== END 3A — SITE ACTIVATION STATE ===== */
  /* ===== START 3B — DIAGNOSTIC WINDOW MANAGEMENT ===== */
async function autoDiagnosticsEnabled(){
 if(!HIB_DEVELOPER_DIAGNOSTICS)return false;
 /* RC459: the popup's "Diagnostics mode" box (hibDiagMode) governs the automatic diagnostic window too: unchecked = no window. */
 const st=await browser.storage.local.get([HIB_AUTO_DIAGNOSTICS_KEY,'hibDiagMode']);
 return st[HIB_AUTO_DIAGNOSTICS_KEY]!==false&&st.hibDiagMode===true;   /* RC510: Diagnostics mode is OFF unless it was switched on */
}
/* RC510: Diagnostics mode is OFF by default (no automatic diagnostic window, no 4 px cyan card outline). Earlier test builds defaulted it ON and saved that, and the page that
 * switches it has been hidden, so a ONE-TIME reset switches it off for profiles that already saved "on". Developers switch it on again from the (hidden) Diagnostics page. */
browser.storage.local.get(['hibDiagMode','hibDiagModeResetRC510']).then(v=>{if(!v.hibDiagModeResetRC510)return browser.storage.local.set({hibDiagMode:false,hibDiagModeResetRC510:true});}).catch(()=>{});
browser.storage.onChanged.addListener((ch,area)=>{
 if(area!=='local'||!ch.hibDiagMode||ch.hibDiagMode.newValue!==false||diagnosticWindowId===null)return;
 const id=diagnosticWindowId;diagnosticWindowId=null;browser.windows.remove(id).catch(()=>{});   // RC459: box unchecked: close the open diagnostic window
});
async function followTab(tab){
 if(!tab||!isWebsite(tab.url)||!(await autoDiagnosticsEnabled()))return;
 if(!(await state(new URL(tab.url).hostname)).effectiveVideoEnabled)return;
 await browser.storage.local.set({[HIB_ACTIVE_DIAG_TAB]:tab.id});
 if(diagnosticWindowId!==null||openingDiagnostic)return;
 openingDiagnostic=true;
 try{
  const win=await browser.windows.create({url:browser.runtime.getURL('activation_monitor.html'),type:'popup',...HIB_DIAG_WINDOW_LAYOUT,focused:false});
  diagnosticWindowId=win.id;
 }catch(e){console.warn('Diagnostic monitor creation failed',String(e));}
 finally{openingDiagnostic=false;}
}
async function refreshActiveTab(){
 const tabs=await browser.tabs.query({active:true});
 const website=tabs.filter(t=>isWebsite(t.url)&&t.windowId!==diagnosticWindowId).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
 if(website)await followTab(website);
}
browser.tabs.onActivated.addListener(async({tabId})=>{
 try{await followTab(await browser.tabs.get(tabId));}catch(_){}
});
browser.tabs.onUpdated.addListener(async(id,change,tab)=>{
 if(change.status==='complete'&&tab.active)await followTab(tab);
});
browser.tabs.onRemoved.addListener(async id=>{
 const current=(await browser.storage.local.get(HIB_ACTIVE_DIAG_TAB))[HIB_ACTIVE_DIAG_TAB];
 if(current===id)await refreshActiveTab();
});
browser.windows.onRemoved.addListener(id=>{if(id===diagnosticWindowId)diagnosticWindowId=null;});
browser.storage.onChanged.addListener(async(changes,area)=>{
 if(area!=='local')return;
 if(changes[HIB_AUTO_DIAGNOSTICS_KEY]){
  if(changes[HIB_AUTO_DIAGNOSTICS_KEY].newValue!==true){
   const id=diagnosticWindowId;diagnosticWindowId=null;
   if(id!==null)try{await browser.windows.remove(id)}catch(_){}
  }else await refreshActiveTab();
 }else if(changes.enabledSites||changes.siteMediaModes||changes.hibRc139ScanVideoHosts)await refreshActiveTab();
});
if(HIB_DEVELOPER_DIAGNOSTICS)refreshActiveTab().catch(()=>{});
// RC272: A catch-all async listener responds with Promise<undefined> to
// unrelated messages, racing the dedicated capture handler in Firefox.
// Return undefined synchronously when this module does not own the type.
const HIB_ACTIVATION_MESSAGE_TYPES = new Set([
  'hib-rc462-site-active',
  'hib-dev-diagnostics-enabled',
  'hib-rc153-read-activation',
  'hib-rc248-existing-tab-poster-metadata',
  'hib-rc240-fetch-poster-document',
  'hib-rc160-capture-tile',
  'hib-rc154-set-site',
  'hib-rc153-set-test'
]);
browser.runtime.onMessage.addListener((msg,sender)=>{
  if(!HIB_ACTIVATION_MESSAGE_TYPES.has(msg?.type))return undefined;
  return (async()=>{
 if(msg?.type==='hib-dev-diagnostics-enabled') return {enabled:HIB_DEVELOPER_DIAGNOSTICS,auto:await autoDiagnosticsEnabled()};
 if(msg?.type==='hib-rc153-read-activation')return state(msg.host);
 /* RC462: is the TAB's site (the top page, also asked from frames inside it) in the user's list with video mode on? Every always-on feature asks this first. */
 if(msg?.type==='hib-rc462-site-active'){try{const h=new URL(sender?.tab?.url||'').hostname;return {active:!!(await state(h)).effectiveVideoEnabled,host:h};}catch(_){return {active:false};}}
 /* ========================================================================
  * RC240 GLOBAL POSTER DISCOVERY — SAFETY BOUNDARY; DO NOT REMOVE.
  * Read-only HTML fetch is requested ONLY by an active HIB site's content
  * script and ONLY for a destination directly linked from the clicked card
  * or a single nested player iframe in that destination. No page execution,
  * DOM mutation, script injection, navigation, or player activation.
  * The parent content script verifies the card association before calling.
  * This gate prevents inactive websites from using the resolver's network
  * authority; it must remain independent of broad <all_urls> permission.
  * ======================================================================== */
   /* ===== END 3B — DIAGNOSTIC WINDOW MANAGEMENT ===== */
  /* ===== START 3C — RC248 EXISTING-TAB RENDERED METADATA ===== */
/* RC248 existing-tab metadata only. NEVER open, activate, reload or play tabs. */
 if(msg?.type==='hib-rc248-existing-tab-poster-metadata'){
  const senderUrl=sender?.url||sender?.tab?.url||'';
  let from,target;
  try{from=new URL(senderUrl);target=new URL(msg.url);}catch{return {error:'INVALID_URL'};}
  if(!/^https?:$/.test(from.protocol)||target.origin!==from.origin)return {error:'ORIGIN_MISMATCH'};
  if(!(await state(from.hostname)).effectiveVideoEnabled)return {error:'INACTIVE_SITE'};
  if(target.href.length>2048)return {error:'URL_TOO_LONG'};
  try{
   const tabs=await browser.tabs.query({});
   const matched=tabs.find(t=>{try{const u=new URL(t.url);return u.origin===target.origin&&u.pathname===target.pathname&&u.search===target.search;}catch{return false;}});
   if(!matched)return {error:'NO_EXISTING_DESTINATION_TAB'};
   const script=`(() => ({url:location.href,images:[...document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"],meta[property="twitter:image"],meta[property="og:image:secure_url"]')].map(e=>({url:e.content||'',property:e.getAttribute('property')||e.getAttribute('name')||''})).filter(x=>x.url)}))()`;
   const values=await browser.tabs.executeScript(matched.id,{code:script,runAt:'document_idle'});
   const info=values?.[0];
   if(!info||new URL(info.url).href!==target.href)return {error:'TAB_URL_CHANGED'};
   return {finalUrl:info.url,images:info.images.slice(0,8),tabId:matched.id};
  }catch(e){return {error:String(e).slice(0,160)};}
 }
 if(msg?.type==='hib-rc240-fetch-poster-document'){
  const senderUrl=sender?.url||sender?.tab?.url||'';
  let from,target;
  try{from=new URL(senderUrl);target=new URL(msg.url);}catch{return {error:'INVALID_URL'};}
  if(!/^https?:$/.test(from.protocol)||!/^https?:$/.test(target.protocol))return {error:'UNSUPPORTED_PROTOCOL'};
  if(!(await state(from.hostname)).effectiveVideoEnabled)return {error:'INACTIVE_SITE'};
  if(String(msg.url).length>2048)return {error:'URL_TOO_LONG'};
  // Destination must be same-origin as clicked page. Embedded player document
  // may be cross-origin, but is tied to the already inspected destination.
  if(msg.kind==='destination' && target.origin!==from.origin)return {error:'DESTINATION_ORIGIN_MISMATCH'};
  if(msg.kind==='embed'){
   let parent;try{parent=new URL(msg.parent);}catch{return {error:'BAD_PARENT'};}
   if(parent.origin!==from.origin)return {error:'BAD_PARENT_ORIGIN'};
  }else if(msg.kind!=='destination')return {error:'BAD_KIND'};
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),4500);
  try{
   const response=await fetch(target.href,{credentials:target.origin===from.origin?'include':'omit',redirect:'follow',signal:ctrl.signal});
   if(!response.ok)return {error:'HTTP_'+response.status};
   const ct=response.headers.get('content-type')||'';
   if(ct&&!/(?:text\/html|application\/xhtml\+xml)/i.test(ct))return {error:'NOT_HTML'};
   const body=await response.text();
   if(body.length>2000000)return {error:'HTML_TOO_LARGE'};
   return {html:body,finalUrl:response.url};
  }catch(e){return {error:String(e).slice(0,120)};}finally{clearTimeout(timer);}
 }
 // Firefox captureTab captures a tab without forcing the monitor window to the foreground.
 if(msg?.type==='hib-rc160-capture-tile'){
  try {const tab=await browser.tabs.get(Number(msg.tabId));
   if(!tab||!/^https?:/.test(tab.url||''))return {error:'Unsupported tab URL'};
   if(typeof browser.tabs.captureTab!=='function')return {error:'Firefox tabs.captureTab is unavailable; capture aborted without changing tab focus'};
   return {image:await browser.tabs.captureTab(tab.id,{format:'png'}),tabUrl:tab.url};
  }catch(e){return {error:String(e)};}
 }
 // RC154 / REGISTER_SITE — explicit user action only; keeps existing HIB keys.
 if(msg?.type==='hib-rc154-set-site'){
  const host=normalize(msg.host);
  if(!host || !/^[a-z0-9.-]+$/.test(host)) return {error:'Invalid hostname'};
  const storage=await browser.storage.local.get(['enabledSites','siteMediaModes']);
  const sites=Array.isArray(storage.enabledSites)?storage.enabledSites.slice():[];
  const modes={...(storage.siteMediaModes||{})};
  if(msg.value===true){
   if(!sites.some(x=>normalize(x)===host))sites.push(host);
   modes[host]='video';
  }else{
   const remaining=sites.filter(x=>normalize(x)!==host);
   // Remove only this site's registration and mode; preserve all others.
   delete modes[host];delete modes['www.'+host];
   await browser.storage.local.set({enabledSites:remaining,siteMediaModes:modes});
   return state(host);
  }
  await browser.storage.local.set({enabledSites:sites,siteMediaModes:modes});
  return state(host);
 }
 if(msg?.type==='hib-rc153-set-test'){
  const host=normalize(msg.host);if(!host)return {error:'Invalid hostname'};
  const s=await browser.storage.local.get('hibRc139ScanVideoHosts');
  const entries={...(s.hibRc139ScanVideoHosts||{})};
  if(msg.value===true)entries[host]=true;else delete entries[host];
  await browser.storage.local.set({hibRc139ScanVideoHosts:entries});
  return state(host);
 }
  })();
});

/* ===== END 3C — RC248 EXISTING-TAB RENDERED METADATA ===== */
/* ===== END SECTION 3 — SITE DATA / PERMISSIONS / MESSAGE ROUTING ===== */
