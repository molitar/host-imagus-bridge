"use strict";
/* ===== START SECTION 5 — HOVER VIDEO PLAYER / RC250 STAGE 1 =====
 * Authority: opt-in HIB video activation only. Uses Stage 1 CPCR read-only.
 * The card detector, image resolver, Imagus handoff and navigation are untouched.
 * RC256 Stage 2 extracts card destinations.
 * The original Imagus spinner is shown during extraction; leave cancels pending
 * hover. No video can be marked READY without Stage 3 verification.
 * No tabs, page navigation, remote HTML crawling, or automatic playback.
 * This is a conservative first stage: player adapters will be reintroduced
 * in later TEST builds after their existing behavior is verified.
 */
/* VIDEO FINAL (RC507) - what this file does besides the original hover flow: marks (minus / apostrophe, hidden when a fixed bar covers them, RC487), cached-card right-click
 * open (hibOpenVerified, spinner lock RC469, open breadcrumbs RC504), stale / dead address refresh (fast refresh via the background scan, hibKnownSource), fresh-link relay for a
 * playing video (hib-need-fresh-source, RC486/RC498), address expiry rules (hibUrlExpired: unix stamps in query / path, signing-time stamps RC469/RC471), page-video right-click gate. */
(async()=>{
 const act=await browser.runtime.sendMessage({type:'hib-rc153-read-activation',host:location.hostname}).catch(()=>null);
 if(!act?.effectiveVideoEnabled)return;
 const DELAY_KEY='hibHoverVideoDelaySeconds';
 let delay=2;
 try{const values=await browser.storage.local.get(DELAY_KEY);const v=Number(values[DELAY_KEY]);if(Number.isInteger(v)&&v>=1&&v<=10)delay=v;}catch{}
 browser.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes[DELAY_KEY]){const v=Number(changes[DELAY_KEY].newValue);delay=Number.isInteger(v)&&v>=1&&v<=10?v:2;console.info('[HIB HOVER VIDEO]',{status:'HOVER_DELAY_UPDATED',delay});if(hovered?.element?.isConnected)enter(hovered);}
 });
 const mediaPattern=/\.(?:mp4|m4v|webm|ogv|m3u8)(?:[?#]|$)/i;
 const validURL=(raw)=>{try{const u=new URL(raw,document.baseURI);return /^https?:$/.test(u.protocol)&&mediaPattern.test(u.pathname)?u.href:null;}catch{return null;}};
 const stage=()=>window.__HIB_CARD_STAGE_1__;
 // RC281: image-viewer interaction has priority over video-card hover.
 const hibViewerOpen=()=>!!document.querySelector('[data-hib-rc215-viewer="1"]');

 // RC253: resolve a destination only when it is actually represented by this
 // physical card. Do not follow unrelated page, sidebar, or recommendation links.
 function destinationOf(card){
  if(card?.url)return card.url;
  const root=card?.element;if(!(root instanceof Element))return '';
  const links=[...(root.matches('a[href]')?[root]:root.querySelectorAll('a[href]'))];
  if(!links.length){const parent=root.closest('a[href]');if(parent)links.push(parent);}
  const normalized=new Set();
  for(const link of links){try{const url=new URL(link.getAttribute('href'),location.href);if(/^https?:$/.test(url.protocol))normalized.add(url.href);}catch{}}
  return normalized.size===1?[...normalized][0]:'';
 }

 let hovered=null,hoverTimer=null,requestID=0,ready=null,indicator=null,spinner=null;
  // Verified media survives hover departure, window blur and indicator changes.
  const verifiedCards=new WeakMap();
 const verifiedDestinations=new Map();
 const landingDestinations=new Map(); // RC297: cards whose page is a landing page (shown with an apostrophe)
  // RC291: Firefox-managed persistence, isolated from verified playback state.
  // Never rely on persistence to mark a card verified in its current page.
  const RC291_KEY='hibRc291VerifiedEpisodeMedia';
  let rc291Loaded=false;
  let rc291CacheWrite=Promise.resolve();
  /* The cache lives in the extension's storage, which the browser's "clear cookies and site data" does not touch. Each saved entry
   * therefore carries a MARKER that is also kept in the site's own localStorage and in a cookie. Clearing site data or cookies removes the
   * marker, and every entry of that site stops matching: it is not loaded, not tagged, not played, and is deleted on the next write. */
  const HIB_MARK='hibVideoCacheMark',RC291_MAX_AGE=12*3600*1000,RC291_MAX_ENTRIES=150;
  function hibMarkRead(){
    let l=null,c=null;
    try{l=localStorage.getItem(HIB_MARK);}catch{}
    try{const m=document.cookie.match(new RegExp('(?:^|;\\s*)'+HIB_MARK+'=([^;]+)'));c=m&&m[1];}catch{}
    /* RC464: the marker ties saved videos to this site's stored data. The page-storage copy is the key; the cookie copy only has to AGREE when it is present.
     * A site or browser that deletes cookies (pornhub, 'clear cookies on close') used to make every saved video 'foreign' at once: marks vanished and the right-click fell through to the image popup. A missing cookie is simply written again. */
    if(l&&!c){try{document.cookie=HIB_MARK+'='+l+'; max-age=31536000; path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');}catch{}return l;}
    return l&&c&&l===c?l:null;
  }
  const HIB_TAB_MARK='hibVideoCacheTab';
  function hibTabMarkRead(){try{return sessionStorage.getItem(HIB_TAB_MARK);}catch{return null;}}
  function hibTabMarkEnsure(){
    let m=hibTabMarkRead();
    if(m)return m;
    m=Date.now().toString(36)+Math.random().toString(36).slice(2,10);
    try{sessionStorage.setItem(HIB_TAB_MARK,m);}catch{}
    return hibTabMarkRead();
  }
  function hibMarkEnsure(){
    let m=hibMarkRead();
    if(m)return m;
    m=Date.now().toString(36)+Math.random().toString(36).slice(2,10);
    try{localStorage.setItem(HIB_MARK,m);}catch{}
    try{document.cookie=HIB_MARK+'='+m+'; max-age=31536000; path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');}catch{}
    return hibMarkRead();
  }
  const rc291Stale=item=>!Number.isFinite(item.cachedAt)||Date.now()-item.cachedAt>RC291_MAX_AGE||item.cachedAt>Date.now()+60000;   // RC465: an address that ran out is 'stale', not 'bad': the episode stays known (see liveVerified)
  // 'ok' = usable on this page, 'foreign' = another site's entry (left alone unless old), 'bad' = to be deleted
  const rc291State=(key,item)=>{
    if(!key||!item||typeof item!=='object'||typeof item.source!=='string'||item.cacheKey!==key)return 'bad';
    if(rc291Stale(item))return 'bad';
    try{const url=new URL(item.source);if(!(/^https?:$/.test(url.protocol)&&!!item.destination))return 'bad';}catch{return 'bad';}
    if(typeof item.origin!=='string')return 'bad';
    if(item.origin!==location.origin)return 'foreign';
    const m=hibMarkRead();
    const tm=hibTabMarkRead();
    return m&&item.marker===m?'ok':'bad';   // RC449: no per-tab marker - detected videos survive closing the tab (the site-data marker still ties them to the site's cookies/storage)
  };
  const rc291IsValid=(key,item)=>rc291State(key,item)==='ok';
  async function rc291Load(){
    try{
      const data=await browser.storage.local.get(RC291_KEY);
      const entries=data[RC291_KEY];
      if(entries&&typeof entries==='object'&&!Array.isArray(entries)){
        let loaded=0,dropped=0;
        for(const [key,item] of Object.entries(entries)){
          const st=rc291State(key,item);
          if(st==='ok'){verifiedDestinations.set(key,item);loaded++;}
          else if(st==='bad'){delete entries[key];dropped++;}
        }
        if(dropped)await browser.storage.local.set({[RC291_KEY]:entries});
        console.info('[HIB RC291]',{status:'PERSISTENT_CACHE_LOADED',count:loaded,dropped});
      }
    }catch(e){console.warn('[HIB RC291]',{status:'CACHE_READ_FAILED',error:String(e)});}
    finally{rc291Loaded=true;}
  }
  const rc291Loading=rc291Load();
  function rc291Persist(key,record){
    // Serialized read-modify-write avoids two near-simultaneous episodes overwriting one another.
    rc291CacheWrite=rc291CacheWrite.catch(()=>{}).then(async()=>{
      const stored=await browser.storage.local.get(RC291_KEY);
      const entries=stored[RC291_KEY]&&typeof stored[RC291_KEY]==='object'&&!Array.isArray(stored[RC291_KEY])?stored[RC291_KEY]:{};
      entries[key]={...record,origin:location.origin,marker:hibMarkEnsure(),tabMarker:hibTabMarkEnsure()};
      for(const [k,item] of Object.entries(entries))if(rc291State(k,item)==='bad')delete entries[k];
      const keys=Object.keys(entries);
      if(keys.length>RC291_MAX_ENTRIES)for(const k of keys.sort((x,y)=>(entries[x].cachedAt||0)-(entries[y].cachedAt||0)).slice(0,keys.length-RC291_MAX_ENTRIES))delete entries[k];
      await browser.storage.local.set({[RC291_KEY]:entries});
      console.info('[HIB RC291]',{status:'EPISODE_PERSISTED',cacheKey:key});
    }).catch(e=>console.warn('[HIB RC291]',{status:'CACHE_WRITE_FAILED',cacheKey:key,error:String(e)}));
  }

  // RC285: a cache key must identify ONE episode, never a shared collection URL.
  function verifiedDestinationKey(card){
   if(!card?.element)return null;
   try{
    const u=new URL(destinationOf(card),location.href);
    if(!/^https?:$/.test(u.protocol)||u.href===location.href)return null;
    return 'url:'+u.href;
   }catch{return null;}
  }
  /* RC435  CATEGORY LANDING (row/section aware).
   * When a whole ROW of cards leads to landing pages (no video on any of them), every card of that row must carry the same apostrophe at once,
   * not one card per hover/scan. A category = the cards of one layout (card type + element tag/class signature) that live in the same CONTAINER:
   * the nearest ancestor holding at least HIB_CATEGORY_MIN such cards (a carousel track, a grid). A different row (e.g. a "videos" strip below an
   * "episodes" strip) is another container and is never affected, even when its cards look alike. Once HIB_CATEGORY_MIN different cards of one
   * container were found to be landing pages for the same reason and none of the container's cards is a verified video, the other cards of that
   * container are marked landing too (the same 10-minute entry the single-card mark uses, flagged category:<id>). The marks are withdrawn as soon as
   * one card of the container is verified as a video, or the user clears them. Reasons specific to one card or to the browser (source-down,
   * autoplay-blocked, unsupported-video) never spread. */
  const HIB_CATEGORY_MIN=3,HIB_CATEGORY_HITS=2,hibCategoryIds=new WeakMap();   // >=3 same-layout cards in the container; spread after 2 landing resultslet hibCategoryHits=new WeakMap();   // container -> id ; container -> Map(destination key -> reason)
  let hibCategoryNext=1;
  const hibCategorySig=card=>{
   try{const el=card.element;return String(card.type||'')+'|'+el.tagName.toLowerCase()+'.'+[...el.classList].filter(c=>c&&c.length<60&&!/^(active|current|selected|hover|focus|is-|has-|js-|slick-|owl-|swiper-)/i.test(c)).sort().join('.');}catch(_){return '';}
  };
  function hibCategoryOf(card){
   const sig=hibCategorySig(card);if(!sig||!card?.element)return null;
   for(let a=card.element.parentElement,up=0;a&&a!==document.body&&a!==document.documentElement&&up<8;a=a.parentElement,up++){
    const members=[];
    for(const img of a.querySelectorAll('img')){
     const c=stage()?.cardFromElement(img);
     if(!c?.element||hibCategorySig(c)!==sig||members.some(m=>m.element===c.element))continue;
     members.push(c);if(members.length>400)break;
    }
    if(members.length>=HIB_CATEGORY_MIN){
     if(!hibCategoryIds.has(a))hibCategoryIds.set(a,'c'+(hibCategoryNext++));
     return {container:a,id:hibCategoryIds.get(a),members};
    }
   }
   return null;
  }
  function hibCategoryLanding(card,reason,key,markReason){
   if(!card?.element||!key||/^(?:source-down|autoplay-blocked|unsupported-video)$/.test(reason||''))return;
   const cat=hibCategoryOf(card);
   //try{browser.runtime.sendMessage({type:'hib-rc360-log',event:'RC435_LANDING',detail:{reason,container:cat?cat.id:null,members:cat?cat.members.length:0,sig:hibCategorySig(card)}}).catch(()=>{});}catch(_){}   // breadcrumb for diagnostics
   if(!cat)return;
   const hits=hibCategoryHits.get(cat.container)||hibCategoryHits.set(cat.container,new Map()).get(cat.container);
   hits.set(key,reason||'landing');
   if([...hits.values()].filter(r=>r===(reason||'landing')).length<HIB_CATEGORY_HITS)return;
   for(const c of cat.members){const k=verifiedDestinationKey(c);if(k&&liveVerified(k))return;}   // one real video in the row: not a landing-only category
   let marked=0;
   for(const c of cat.members){
    const k=verifiedDestinationKey(c);if(!k||landingDestinations.has(k))continue;
    landingDestinations.set(k,{at:Date.now(),reason:markReason||reason||'landing',category:cat.id});marked++;
   }
   if(marked)console.info('[HIB RC435]',{status:'CATEGORY_MARKED_LANDING',container:cat.id,reason,marked,total:cat.members.length});
   if(marked)try{hibPassiveScan();}catch(_){}   // draw the new marks at once instead of waiting for the next passive pass
  }
  /* RC436: the same rule evaluated from what is ALREADY marked (cached marks, marks from earlier scans, any code path that records a landing):
   * every passive pass looks at the visible cards, and a container with >= HIB_CATEGORY_HITS landing cards of one reason and no verified video
   * gets all its other cards marked. Containers already handled in this pass are skipped. */
  function hibCategorySweep(){
   const done=new Set();let n=0;
   for(const img of document.querySelectorAll('img')){
    const r=img.getBoundingClientRect();
    if(r.width<60||r.height<60||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)continue;
    if(++n>400)break;
    const card=stage()?.cardFromElement(img);if(!card?.element)continue;
    const key=verifiedDestinationKey(card);const entry=key&&landingDestinations.get(key);
    if(!entry||entry.category||Date.now()-entry.at>=10*60*1000||/^(?:autoplay-blocked|unsupported-video)$/.test(entry.reason||''))continue;
    const cat=hibCategoryOf(card);
    if(!cat||done.has(cat.container))continue;done.add(cat.container);
    let same=0,verified=false;
    for(const c of cat.members){const k=verifiedDestinationKey(c);if(!k)continue;if(liveVerified(k)){verified=true;break;}const e=landingDestinations.get(k);if(e&&!e.category&&e.reason===entry.reason)same++;}
    if(verified||same<HIB_CATEGORY_HITS)continue;
    let marked=0;
    for(const c of cat.members){const k=verifiedDestinationKey(c);if(!k||landingDestinations.has(k))continue;landingDestinations.set(k,{at:Date.now(),reason:entry.reason,category:cat.id});marked++;}
    if(marked)console.info('[HIB RC436]',{status:'CATEGORY_SWEPT_LANDING',container:cat.id,reason:entry.reason,marked,total:cat.members.length});
   }
  }
  window.__HIB_CAT_DEBUG={of:hibCategoryOf,sig:hibCategorySig,sweep:hibCategorySweep,landing:()=>[...landingDestinations.entries()].map(([k,v])=>k+' '+JSON.stringify(v)),set:(k,v)=>landingDestinations.set(k,v)};   // RC436 diagnostics handle (content-script world only)
  function hibCategoryClear(card){
   const cat=hibCategoryOf(card);if(!cat)return;
   hibCategoryHits.delete(cat.container);
   for(const [k,v] of [...landingDestinations])if(v&&v.category===cat.id)landingDestinations.delete(k);
   for(const el of [...document.querySelectorAll('[data-hib-passive]')])if(el.textContent==="'")el.remove();   // the passive pass re-draws what is still marked
  }
  function cacheMediaForCard(card,media){
   const key=verifiedDestinationKey(card);
   if(!key)return false;
    const own={...media,cacheKey:key,cachedAt:Date.now(),marker:hibMarkEnsure(),tabMarker:hibTabMarkEnsure()};
    verifiedCards.set(card.element,own);
    verifiedDestinations.set(key,own);
    try{hibCategoryClear(card);}catch(_){}   // RC435: a verified video in the category ends the category-wide landing mark
    ready=own;
    // Storage is best effort. Failure cannot demote verified media or block player launch.
    rc291Persist(key,{cacheKey:key,cachedAt:own.cachedAt,destination:own.destination,source:own.source,referrer:own.referrer||'',kind:own.kind,engine:own.engine||null,episodeId:own.episodeId||null});
    return true;
  }
 /* RC297: has this verified address (or the cache entry made from it) run out?
  * Signed addresses carry their own lifetime: s=<start>&e=<seconds>, e=<unix time>, expires=<unix time>, or a unix time after
  * a comma/equals (secure=...,1792688460). Unknown signatures are trusted for 30 minutes, everything else for 2 hours. */
 function hibUrlExpired(url,cachedAt){
  let exp=cachedAt+12*3600*1000;
  try{
   const u=new URL(url);const p=u.searchParams;
   const num=k=>{const v=Number(p.get(k));return Number.isFinite(v)&&v>0?v:null;};
   const s=num('s'),e=num('e'),ex=num('expires')||num('exp')||num('Expires')||num('validto')||num('valid_until')||num('validuntil')||num('expiry')||num('expire');
   let known=false;
   if(s&&e&&s>1e9&&e<1e7){exp=Math.min(exp,(s+e)*1000);known=true;}
   else if(e&&e>1e9){exp=Math.min(exp,e*1000);known=true;}
   if(ex&&ex>1e9){exp=Math.min(exp,ex*1000);known=true;}
   const m=/[,](1[6-9][0-9]{8})(?:$|[&,._-])/.exec(u.search); // unix time after a comma; never a stray number inside a token
   if(m){exp=Math.min(exp,Number(m[1])*1000);known=true;}
   const m2=/=(1[6-9][0-9]{8})[-|:][A-Za-z0-9%_+\/=.-]{8,}/.exec(u.search); // RC459: <unix expiry>-<signature> inside one value (verify=1793238732-xxxx): about 5 minutes on the real file
   if(m2){const t2=Number(m2[1])*1000;exp=Math.min(exp,t2-cachedAt<=60000?t2+300000:t2);known=true;}   // RC469: a stamp at (or just after) the moment the address was found is its signing time, not its end: the real file lives 5 minutes from it (measured on the real file); a stamp far ahead is the end
   const m3=/\/(1[6-9][0-9]{8})\//.exec(u.pathname);   // RC471: a unix time as a path segment (/<token>/1793328376/videos/x.mp4) is when the address ends (measured: about 1.5 h from when it was made, dead by 2.7 h)
   if(m3){const t3=Number(m3[1])*1000;exp=Math.min(exp,t3-cachedAt<=60000?t3+300000:t3);known=true;}
   if(!known&&u.search)exp=Math.min(exp,cachedAt+30*60*1000);   // RC454: an address with an unknown signature (token / IP bound) is trusted 30 minutes, as you asked; plain addresses keep 12 h
  }catch(_){}
  /* RC465: the safety margin is a share of the address's own lifetime (at most the old 60 s): a 10-second address was 'expired' the moment it was found, which made every fresh result stale. */
  return Date.now()>=exp-Math.max(0,Math.min(60000,(exp-cachedAt)*0.3));
 }
 function liveVerified(key){
  const v=key?verifiedDestinations.get(key):null;
  if(!v)return null;
  if(Date.now()-v.cachedAt>RC291_MAX_AGE||(v.marker&&v.marker!==hibMarkRead())){verifiedDestinations.delete(key);return null;}
  /* RC465: some sites hand out video addresses that live only seconds (animeid: ?verify=<unix>-<sig>, about 10 s). Such an entry keeps its mark - the episode IS playable -
   * but is flagged stale: opening it scans the card again for a fresh address instead of loading a dead one (hibOpenVerified). */
  v.stale=hibUrlExpired(v.source,v.cachedAt);
  return v;
 }
 /* RC297: keep the spinner / minus / apostrophe on its own card. They are drawn above the page (fixed position) so the
  * site's layout is untouched; a frame loop moves them with the card (carousel slides, scrolling) and hides them while the
  * card is clipped or covered. */
  /* RC453: the mark belongs to the card's PERMANENT thumbnail, never to a hover-only layer. Candidates are the card's visible pictures; a picture
   * that is hidden or transparent is skipped, and the first good choice is remembered per card, so a hover preview that appears later cannot take
   * the mark over. Cards whose thumbnail is a CSS background (no <img>) anchor on the largest element with a background picture, else on the card. */
  const hibAnchorOf=new WeakMap();
  function hibCardAnchor(card){
   const el=card?.element;
   if(!el)return null;
   const kept=hibAnchorOf.get(el);
   if(kept&&kept.isConnected&&el.contains(kept)){const r=kept.getBoundingClientRect();if(r.width>=20&&r.height>=20)return kept;}
   const usable=c=>{const r=c.getBoundingClientRect();if(r.width<20||r.height<20)return 0;const cs=getComputedStyle(c);if(cs.visibility==='hidden'||cs.display==='none')return 0;if(Number(cs.opacity)<0.05&&c.tagName!=='IMG')return 0;return r.width*r.height;};   /* RC460: a still picture that a hover preview fades out is still THE thumbnail */
   let pick=null;
   for(const sel of ['img','video,canvas']){
    let best=null,area=0;
    for(const c of el.querySelectorAll(sel)){if(c.dataset&&(c.dataset.hibVideoStage||c.dataset.hibPassive))continue;const a=usable(c);if(a>area){best=c;area=a;}}
    if(best){pick=best;break;}
   }
   if(!pick){let area=0;for(const c of el.querySelectorAll('*')){const bg=getComputedStyle(c).backgroundImage;if(!bg||bg==='none'||bg.indexOf('url(')<0)continue;const a=usable(c);if(a>area){pick=c;area=a;}}}
   if(pick){if(pick.tagName!=='VIDEO'&&pick.tagName!=='CANVAS')hibAnchorOf.set(el,pick);return pick;}   // RC460: a video / canvas is usually the hover preview layer: used while nothing better exists, never remembered
   return el;
  }
 const hibTracked=new Set();let hibTrackRaf=0;
 /* RC461: every reason a mark disappears is written to the diagnostic trace (shows in "Capture report", RC386_ events). Only changes are logged, never per frame. */
 function hibTagWhy(entry,why,extra){
  try{
   if(entry&&entry.__why===why)return;
   if(entry)entry.__why=why;
   browser.runtime.sendMessage({type:'hib-rc360-log',event:'RC386_TAG_'+why,detail:{symbol:entry?.symbol||null,t:Math.round(performance.now()),key:String(entry&&entry.card?verifiedDestinationKey(entry.card)||'':'').slice(-60),...(extra||{})}}).catch(()=>{});
  }catch(_){}
 }
 // places one mark on its card; hides it for a gone / covered / clipped card
 function hibPlace(entry){
  const {el,card,dx,dy}=entry;
  if(!card?.element?.isConnected){hibTagWhy(entry,'CARD_DISCONNECTED');el.style.display='none';return;}
  // The tag must not outlive what it stands for: a minus needs a verified address that is still valid (liveVerified drops
  // expired ones, and a player error removes the entry); an apostrophe for a down source goes after ten minutes.
  if(entry.symbol==='\u2212'){
   if(!liveVerified(verifiedDestinationKey(card))){hibTagWhy(entry,'REMOVED_NOT_VERIFIED_ANY_MORE',(()=>{try{const v=verifiedDestinations.get(verifiedDestinationKey(card));return v?{expired:hibUrlExpired(v.source,v.cachedAt),ageMin:Math.round((Date.now()-v.cachedAt)/60000),marker:!v.marker||v.marker===hibMarkRead()}:{noEntry:true};}catch(_){return {};}})());el.remove();hibTracked.delete(entry);return;}
  }else if(entry.symbol==="'"){
   const land=landingDestinations.get(verifiedDestinationKey(card));
   if(!land||Date.now()-land.at>=10*60*1000){el.remove();hibTracked.delete(entry);return;}
  }
  const anchor=hibCardAnchor(card);
  /* RC453: the tag always lives on the document root (fixed position) and is placed from the permanent thumbnail's coordinates, so nothing the site does
   * to a hover layer / offsetParent can remove it; the frame loop keeps it on its thumbnail while scrolling, resizing and sliding carousels. */
  if(el.parentElement!==document.documentElement){el.style.setProperty('position','fixed','important');document.documentElement.appendChild(el);}
  const r=anchor.getBoundingClientRect();
  let visible=r.width>=20&&r.height>=20;
  if(visible){
   const cx=r.left+r.width/2,cy=r.top+r.height/2;
   visible=cx>=0&&cy>=0&&cx<=innerWidth&&cy<=innerHeight;
   if(visible){
    // clipped by a carousel / scroll container? (a site's hover overlay covering the card must NOT hide the tag)
    for(let p=card.element.parentElement;p&&p!==document.documentElement;p=p.parentElement){
     const cs=getComputedStyle(p);
     if(/(hidden|auto|scroll|clip)/.test(cs.overflowX+' '+cs.overflowY)){
      const pr=p.getBoundingClientRect();
      if(pr.width>0&&pr.height>0&&(cx<pr.left||cx>pr.right||cy<pr.top||cy>pr.bottom)){visible=false;break;}
     }
    }
   }
  }
  /* RC487: a card scrolled up UNDER a fixed / sticky bar (site menu, header) must not keep its tag on top of that bar: look at what is really drawn at the tag's spot; if it is a fixed or
   * sticky element that is not part of the card, the tag is hidden (checked a few times a second; a site's hover overlay that is not fixed/sticky does not count). */
  if(visible){const now=performance.now();if(!(now-(entry.__occAt||0)<150)){entry.__occAt=now;let occ=false;try{
    const tx=Math.min(innerWidth-1,Math.max(0,r.right-dx+15)),ty=Math.min(innerHeight-1,Math.max(0,r.top+dy+15));const top=document.elementFromPoint(tx,ty);
    if(top&&!card.element.contains(top)&&!top.contains(card.element)&&top!==document.documentElement&&top!==document.body){for(let q=top;q&&q!==document.documentElement;q=q.parentElement){if(q.dataset&&(q.dataset.hibVideoStage||q.dataset.hibRc215Viewer))break;const pos=getComputedStyle(q).position;if(pos==='fixed'||pos==='sticky'){occ=true;break;}}}
   }catch(_){}entry.__occ=occ;}if(entry.__occ)visible=false;}
  hibTagWhy(entry,visible?'SHOWN':'HIDDEN',visible?{}:{w:Math.round(r.width),h:Math.round(r.height),anchor:anchor.tagName});el.style.setProperty('display',visible?'':'none','important');
  el.style.left=Math.max(0,r.right-dx)+'px';
  el.style.top=Math.max(0,r.top+dy)+'px';
 }
 function hibTrackTick(){
  hibTrackRaf=0;
  for(const entry of [...hibTracked]){
   if(!entry.el.isConnected){hibTracked.delete(entry);continue;}
   hibPlace(entry);
  }
  if(hibTracked.size)hibTrackRaf=requestAnimationFrame(hibTrackTick);
 }
 // registers a mark so the frame loop keeps it on its card
 function hibTrack(el,card,dx,dy,symbol){
  hibTracked.add({el,card,dx,dy,symbol});
  if(!hibTrackRaf)hibTrackRaf=requestAnimationFrame(hibTrackTick);
 }

 /* RC346: cards already in the cache (verified / landing) carry their tag without a hover. */
 const hibPassive=new WeakMap();
 function hibPassiveScan(){
  try{
   if(!rc291Loaded||!stage()||hibViewerOpen())return;
   try{hibCategorySweep();}catch(e){if(!window.__hibCatErr){window.__hibCatErr=1;try{browser.runtime.sendMessage({type:'hib-rc360-log',event:'RC436_SWEEP_ERROR',detail:String(e&&e.stack||e).slice(0,300)}).catch(()=>{});}catch(_){}}}   // RC436
   /* RC453: walk the CARDS in view (any thumbnail kind, incl. CSS-background thumbnails that have no <img>); the old picture walk stays as the fallback. */
   let list=null;try{list=stage().visibleCards?stage().visibleCards():null;}catch(_){}
   if(!list){list=[];let n=0;for(const img of document.querySelectorAll('img')){const r=img.getBoundingClientRect();if(r.width<60||r.height<60||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)continue;if(++n>400)break;const cd=stage().cardFromElement(img);if(cd)list.push(cd);}}
   for(const card of list){
    if(!card?.element||hovered?.element===card.element)continue;
    const old=hibPassive.get(card.element);
    if(old&&old.isConnected)continue;
    if([...hibTracked].some(t=>t.card?.element===card.element&&t.el.isConnected))continue;
    const key=verifiedDestinationKey(card);if(!key)continue;
    let symbol=null,label='';
    if(liveVerified(key)){symbol='−';label='Verified media - right-click to open HIB player';}
    else{const l=landingDestinations.get(key);
     if(l&&Date.now()-l.at<10*60*1000){symbol="'";label=l.reason==='source-down'?'Source is down right now - image popup only; will be tried again later':'Landing page - no video ready to play; image popup only';}}
    if(!symbol)continue;
    const el=document.createElement('span');el.dataset.hibVideoStage='1';el.dataset.hibPassive='1';
    el.textContent=symbol;el.title=label;
    el.style.cssText='position:fixed;pointer-events:none;z-index:2147483643;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#111d;color:white;border:2px solid #fff;font:bold 20px sans-serif;';
    document.documentElement.appendChild(el);
    hibPassive.set(card.element,el);
    hibTrack(el,card,36,6,symbol);
   }
  }catch(_){}
 }
 setInterval(hibPassiveScan,1000);

 /* RC346: right-click on a tagged card: (1) is the cached address still alive? (2) yes: spinner while the player loads and starts;
  * (3) no: forget it, the minus goes away and the card is scanned again at once (and opened when found, if the pointer is still there). */
 function rc291Drop(key){
  verifiedDestinations.delete(key);
  rc291CacheWrite=rc291CacheWrite.catch(()=>{}).then(async()=>{
   const st=await browser.storage.local.get(RC291_KEY);
   const e=st[RC291_KEY]&&typeof st[RC291_KEY]==='object'&&!Array.isArray(st[RC291_KEY])?st[RC291_KEY]:{};
   if(key in e){delete e[key];await browser.storage.local.set({[RC291_KEY]:e});}
  }).catch(()=>{});
 }
 const hibKnownSource=new Map();   // episode key -> the address that ran out (see hibOpenVerified)
 let hibOpening=false,hibAutoOpenEl=null,hibAutoOpenAt=0;
 /* RC504: short breadcrumbs of the open path (kept in the page trace, read with Capture report): where a right-click on a marked card stops when the player does not appear. */
 const hibOpenTrace=(ev,detail)=>{try{browser.runtime.sendMessage({type:'hib-rc360-log',event:'RC386_OPEN_'+ev,detail:{t:Math.round(performance.now()),...detail}}).catch(()=>{});}catch(_){}};
 async function hibOpenVerified({media,format,card}){
  if(hibOpening){hibOpenTrace('OPEN_BUSY',{});return;}
  hibOpenTrace('OPEN_START',{stale:!!media.stale,src:String(media.source).slice(-60)});
  hibOpening=true;
  spinnerLock=false;clearSpinner(true);
  if(card?.element?.isConnected){spinner=stage2Spinner(card);spinnerLock=!!spinner;}
  let alive=true;
  const subs={};
  const subsTask=Promise.race([browser.runtime.sendMessage({type:'hib-rc332-get-subs',url:media.source,page:media.destination}),new Promise(r=>setTimeout(()=>r(null),25000))]).then(r=>{if(r&&r.ok&&(r.text||r.url||(r.tracks&&r.tracks.length))){Object.assign(subs,{text:r.text,label:r.label,format:r.format,url:r.url,tracks:r.tracks||[],fonts:r.fonts||[]});window.dispatchEvent(new CustomEvent('hib-animeid-subtitles-ready',{detail:{media:new URL(media.source).href}}));}}).catch(()=>{});
  let deadWhy='';
  if(media.stale)alive=false;   // RC465: its address has run out (short-lived signature): go straight to the fresh scan below
  else try{const r=await browser.runtime.sendMessage({type:'hib-rc326-verify-url',url:media.source,referrer:media.referrer||media.destination});alive=!(r&&r.alive===false);deadWhy=(r&&r.reason)||'';}catch(_){alive=true;}
  void subsTask;
  hibOpenTrace('OPEN_VERIFIED',{alive});
  hibOpening=false;
  if(!card?.element?.isConnected){spinnerLock=false;clearSpinner(true);return;}
  if(alive){
   if(window.__hibRescans)window.__hibRescans.delete(media.cacheKey);
   openPlayer({url:media.source,format,referrer:media.referrer||media.destination,cacheKey:media.cacheKey,destination:media.destination,card,subtitles:subs});
   const stop=()=>{window.removeEventListener('message',on,true);clearTimeout(timer);spinnerLock=false;clearSpinner(true);};
   const on=e=>{const d=e.data;if(d&&d.bridge==='hib-unified-v101'&&((d.type==='status'&&d.code==='PLAYBACK_CONFIRMED')||d.type==='error'))stop();};
   const timer=setTimeout(stop,30000);
   window.addEventListener('message',on,true);
   return;
  }
  hibOpenTrace('OPEN_DEAD_RESCAN',{});
  console.info('[HIB RC346]',{status:'CACHED_URL_DEAD_RESCAN',url:media.source});
  /* 3.0.1: an address whose manifest is a web page (one broken mirror host of a streaming site) must NOT be remembered as the known file: the rescan would accept the same bad host again. At most 3 rescans per card. */
  const hibRescans=(window.__hibRescans=window.__hibRescans||new Map());const hibRescanN=(hibRescans.get(media.cacheKey)||0)+1;hibRescans.set(media.cacheKey,hibRescanN);
  if(hibRescanN>3){hibRescans.delete(media.cacheKey);openPlayer({url:media.source,format,referrer:media.referrer||media.destination,cacheKey:media.cacheKey,destination:media.destination,card,subtitles:subs});spinnerLock=false;clearSpinner(true);return;}   // enough rescans: open it and let the player's own retry take over
  if(deadWhy!=='not-a-manifest')hibKnownSource.set(media.cacheKey,media.source);   // RC467: the refresh scan may accept the same file with a new signature at once
  rc291Drop(media.cacheKey);verifiedCards.delete(card.element);ready=null;
  /* RC469: the spinner keeps turning from the right-click until the refreshed video is open (the scan below replaces it, it is never removed in between) */
  hibAutoOpenEl=card.element;hibAutoOpenAt=Date.now();
  const d0=delay;delay=0.05;hovered=null;enter(card);delay=d0;
  if(!spinner&&card.element.isConnected)spinner=stage2Spinner(card);
  spinnerLock=!!spinner;setTimeout(()=>{if(spinnerLock&&!hibOpening&&!window.__hibHoverScanBusy){spinnerLock=false;clearSpinner(true);}},20000);
 }

 /* Autoplay still blocked after the permission module ran: the card keeps the apostrophe and the page shows this notice (no tab is opened here). */
 let hibNoticeEl=null;
 function hibAutoplayNotice(card){
  void card;
  if(hibNoticeEl&&hibNoticeEl.isConnected)return;
  // RC419: attempt a real play() right now so Firefox/Floorp shows its blocked-autoplay icon in the address bar (it only does so after a play attempt on this page).
  try{const a=document.createElement('audio');a.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';a.style.display='none';(document.body||document.documentElement).appendChild(a);const p=a.play();if(p&&p.catch)p.catch(()=>{});setTimeout(()=>a.remove(),3000);}catch(_){}
  const box=document.createElement('div');box.dataset.hibAutoplayNotice='1';
  box.style.cssText='position:fixed;right:15px;top:15px;z-index:2147483645;max-width:360px;background:#151b2b;color:#fff;border:1px solid #60a5fa;border-radius:8px;padding:10px 12px;font:13px/1.4 sans-serif;box-shadow:0 4px 18px #0008;';
  const t=document.createElement('div');t.textContent='HIB: Autoplay is still blocked for this site. Click the blocked-autoplay icon at the left of the address bar and choose "Allow Audio and Video" (or Page Info > Permissions > Autoplay), then hover the card again.';
  const x=document.createElement('button');x.textContent='Dismiss';x.style.cssText='margin-top:8px;padding:4px 10px;cursor:pointer;';
  x.onclick=()=>box.remove();
  box.append(t,x);document.documentElement.appendChild(box);hibNoticeEl=box;
  setTimeout(()=>box.remove(),30000);
 }

 /* RC423: the user allowed autoplay and pressed Dismiss on the permission tab. Every card that was left with an APOSTROPHE (landing page / blocked
  * source) must be forgotten so the next hover scans it again for an active video: the landing entries are dropped, the apostrophe tags (tracked
  * and passive) are removed, and the autoplay notice is closed. Minus tags (verified video) are NOT touched. Sent by the background
  * (hibRc108 permission flow) to every tab of the site. */
 browser.runtime.onMessage.addListener(m=>{
  if(m?.type!=='hib-rc423-clear-autoplay-marks')return undefined;
  landingDestinations.clear();hibCategoryHits=new WeakMap();
  let removed=0;
  for(const entry of [...hibTracked]){if(entry?.symbol==="'"){try{entry.el?.remove();}catch(_){}hibTracked.delete(entry);removed++;}}
  // passive tags live in a WeakMap (not iterable); removing the node is enough: the passive pass re-creates tags only for isConnected-less entries
  for(const el of [...document.querySelectorAll('[data-hib-passive]')]){if(el.textContent==="'"){el.remove();removed++;}}
  for(const el of [...document.querySelectorAll('[data-hib-autoplay-notice]')])el.remove();
  try{hibNoticeEl=null;}catch(_){}
  console.info('[HIB RC423]',{status:'AUTOPLAY_MARKS_CLEARED',removed});
  return Promise.resolve({ok:true,removed});
 });

 /* RC346: "Clear HIB video cache" (toolbar) empties the in-page cache and removes every tag */
 browser.runtime.onMessage.addListener(m=>{
  if(m?.type!=='hib-rc346-clear-cache-page')return undefined;
  verifiedDestinations.clear();landingDestinations.clear();try{localStorage.removeItem(HIB_MARK);}catch{}
  for(const el of [...document.querySelectorAll('[data-hib-video-stage],[data-hib-video-stage2-spinner]')])el.remove();
  hibTracked.clear();hovered=null;ready=null;
  return Promise.resolve({ok:true});
 });
 // the spinner shown on a card while a video is looked for or opened
 function stage2Spinner(card){
  if(!card?.element?.isConnected)return null;
  const anchor=hibCardAnchor(card);
  const rect=anchor.getBoundingClientRect();
  if(rect.width<20||rect.height<20)return null;
  const el=document.createElement('span');
  el.dataset.hibVideoStage2Spinner='1';
  el.title='Host Imagus Bridge is discovering video destination';
  el.style.cssText='position:fixed!important;pointer-events:none!important;z-index:2147483643!important;width:24px!important;height:24px!important;border-radius:50%!important;background:rgba(12,12,12,.9)!important;border:3px solid rgba(170,170,170,.7)!important;border-top-color:#fff!important;box-sizing:border-box!important;animation:hib-v208-spin .65s linear infinite!important;';
  el.style.left=Math.max(0,rect.right-32)+'px';el.style.top=Math.max(0,rect.top+8)+'px';
  if(!document.getElementById('hib-rc256-spin-css')){
   const css=document.createElement('style');css.id='hib-rc256-spin-css';
   css.textContent='@keyframes hib-v208-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
   (document.head||document.documentElement).append(css);
  }
  document.documentElement.append(el);
  hibTrack(el,card,32,8);
  return el;
 }
 // RC258 TEST-only hover-extraction overlay: reports what was ACTUALLY extracted.
 // A watch-page or embed URL is not mislabeled as verified playable media.
 let statusPanel=null,statusHideTimer=null;
 const safeText=value=>String(value??'').slice(0,1200);
 function extractionPanel(result){
  try{console.info('[HIB EXTRACTION]',{verified:!!(result&&result.verified),destination:result&&result.destination,error:(result&&result.error)||null});}catch(_){}
  return;
  if(statusHideTimer){clearTimeout(statusHideTimer);statusHideTimer=null;}
  statusPanel?.remove();statusPanel=null;
  const panel=document.createElement('aside');statusPanel=panel;
  panel.dataset.hibExtractionStatus='1';
  panel.style.cssText='position:fixed!important;top:14px!important;right:14px!important;z-index:2147483645!important;width:min(460px,calc(100vw - 28px))!important;max-height:45vh!important;overflow:auto!important;box-sizing:border-box!important;background:#101218!important;color:#f5f5f5!important;border:1px solid #98a1af!important;border-radius:8px!important;box-shadow:0 5px 24px #000b!important;padding:12px 14px!important;font:13px/1.5 system-ui,sans-serif!important;overflow-wrap:anywhere!important;pointer-events:none!important;';
  const heading=document.createElement('div');heading.textContent='HIB TEST — Extracted URL · RC346';heading.style.cssText='font-weight:700!important;font-size:14px!important;margin-bottom:6px!important;';
  const outcome=document.createElement('div');
  const found=!!result.destination;
  const level=result.playerVerified?'PLAYER VERIFIED':result.verified?'MEDIA VERIFIED':result.direct?'MEDIA CANDIDATE FOUND':result.probeFailed?'NO MEDIA SOURCE DETECTED':result.episode?'EMBED URL':found?'WATCH/PAGE URL':'NOT DETECTED';
  outcome.textContent=(result.episode&&!result.verified?'PLAYER EMBED — STREAM NOT VERIFIED':level)+(result.error&&!result.episode?' · ERROR':'');
  outcome.style.cssText='font-weight:700!important;color:'+(result.verified||result.direct?'#90efb0':result.probeFailed?'#ff9292':found?'#ffd680':'#ff9292')+'!important;margin-bottom:5px!important;';
  const detail=document.createElement('div');
  detail.textContent=found?result.destination:'No destination extracted for this card';
  detail.style.cssText='user-select:text!important;font:12px/1.5 ui-monospace,Consolas,monospace!important;';
  const title=document.createElement('div');title.textContent=safeText(result.title);title.style.cssText='font-size:12px!important;color:#b9c3d1!important;margin-top:6px!important;';
  const note=document.createElement('div');note.textContent=result.verified?'Verified URL delivered to HIB; resolver can close':result.direct?'Media candidate found; playback NOT yet verified':result.probeFailed?'Rendered-page probe completed without a usable MP4/HLS/DASH URL; the page URL is NOT media.':result.episode?'Player embed identified; underlying stream NOT yet verified':found?'This is a page URL, NOT the direct video stream':'No supported destination found';note.style.cssText='color:#d0d0d0!important;font-size:11px!important;margin-top:6px!important;';
  panel.append(heading,outcome,detail,title,note);
  if(result.error){const error=document.createElement('div');error.textContent='Error: '+safeText(result.error);panel.append(error);}
  document.documentElement.append(panel);
  statusHideTimer=setTimeout(()=>{if(statusPanel===panel){panel.remove();statusPanel=null;}statusHideTimer=null;},15000);
 }
 // RC295: the spinner and the minus/! indicator are separate elements. Extraction can finish (or fail, or be
 // dropped) at any point and the spinner must go with it; the result indicator stays.
 let spinnerLock=false;   // RC469: while a verified/cached video is opening, only the opener may remove the spinner
 function clearSpinner(force){if(spinnerLock&&force!==true)return;spinner?.remove();spinner=null;}
 let playerHost=null,playerVideo=null,playerToken=0;
 const clearIndicator=()=>{if(indicator){try{hibTagWhy({symbol:indicator.textContent,card:null},'HOVER_TAG_CLEARED',{by:String(new Error().stack).split(String.fromCharCode(10)).slice(1,4).map(s=>s.trim().split('@')[0]).join('<')});}catch(_){}}indicator?.remove();indicator=null;if(!window.__hibHoverScanBusy)clearSpinner();};
 const stopWait=()=>{clearTimeout(hoverTimer);hoverTimer=null;++requestID;clearIndicator();};
 // The viewer is injected after pointerdown. Cancel any pending hover immediately.
 const hibViewerObserver=new MutationObserver(()=>{
  if(hibViewerOpen() && (hoverTimer!==null || hovered!==null)){
   stopWait();hovered=null;
   console.info('[HIB RC281]',{status:'HOVER_SUPPRESSED_VIEWER_OPEN'});
  }
 });
 hibViewerObserver.observe(document.documentElement,{childList:true,subtree:true});

 function cardOf(e){return stage()?.cardFromElement(e.target)||stage()?.cardAtPoint(e.clientX,e.clientY)||null;}
 function candidates(card){
  const result=[],seen=new Set();
  const add=(url,kind)=>{const normalized=validURL(url);if(normalized&&!seen.has(normalized)){seen.add(normalized);result.push({url:normalized,kind});}};
  for(const video of card.element.querySelectorAll('video')){
   add(video.currentSrc,'VIDEO_CURRENT_SRC');add(video.getAttribute('src'),'VIDEO_SRC');
   for(const source of video.querySelectorAll('source[src]'))add(source.getAttribute('src'),'SOURCE_SRC');
  }
  for(const element of card.element.querySelectorAll('[data-video-src],[data-mp4],[data-hls],[data-video-url]')){
   for(const key of ['data-video-src','data-mp4','data-hls','data-video-url'])add(element.getAttribute(key),'CARD_MEDIA_ATTRIBUTE');
  }
  return result.slice(0,8);
 }
 const verify=(url)=>new Promise(resolve=>{
  const video=document.createElement('video');let ended=false;
  video.preload='metadata';video.muted=true;video.playsInline=true;
  const finish=(ok)=>{if(ended)return;ended=true;video.removeAttribute('src');video.load();resolve(ok);};
  video.onloadedmetadata=()=>finish(true);
  video.onerror=()=>finish(false);
  const t=setTimeout(()=>finish(false),3200);
  const old=finish;
  // Cleanup timer without keeping the media element alive.
  video.onloadedmetadata=()=>{clearTimeout(t);old(true);};
  video.onerror=()=>{clearTimeout(t);old(false);};
  video.src=url;
 });
 function showIndicator(card,symbol,label){
  clearIndicator();if(!card?.element?.isConnected)return;
  {const p=hibPassive.get(card.element);if(p){p.remove();hibPassive.delete(card.element);}}
  const anchor=hibCardAnchor(card);
  const rect=anchor.getBoundingClientRect();if(rect.width<20||rect.height<20)return;
  indicator=document.createElement('span');indicator.dataset.hibVideoStage='1';
  indicator.textContent=symbol;indicator.title=label;
  indicator.style.cssText='position:fixed;pointer-events:none;z-index:2147483643;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#111d;color:white;border:2px solid #fff;font:bold 20px sans-serif;';
  indicator.style.left=Math.max(0,rect.right-36)+'px';indicator.style.top=Math.max(0,rect.top+6)+'px';
  document.documentElement.appendChild(indicator);
  hibTrack(indicator,card,36,6,symbol);
 }
 async function scan(card,token){
  if(!card?.element?.isConnected||hovered?.element!==card.element||token!==requestID)return;
  const destination=destinationOf(card);
  const urls=candidates(card);
  console.info('[HIB HOVER VIDEO]',{status:'HOVER_DELAY_ELAPSED',delay,cardType:card.type||'',destination,candidates:urls.length});
  if(!urls.length){showIndicator(card,'!','Card recognized; no playable media source on thumbnail');console.info('[HIB HOVER VIDEO]',{status:'NO_CARD_MEDIA_SOURCE',destination,cardType:card.type||'',note:'Episode-page extraction not part of RC250 stage 1'});return;}
  showIndicator(card,'◌','Checking media source');
  for(const entry of urls){
   const ok=await verify(entry.url);
   if(token!==requestID||hovered?.element!==card.element)return;
   if(ok){ready={card:card.element,destination,source:entry.url,kind:entry.kind};verifiedCards.set(card.element,ready);showIndicator(card,'−','Video verified — right-click to open HIB player');
    console.info('[HIB HOVER VIDEO]',{status:'READY',destination,source:entry.url,kind:entry.kind});return;}
  }
  showIndicator(card,'!','Media unavailable');
  console.info('[HIB HOVER VIDEO]',{status:'SOURCE_PROBE_FAILED',destination,candidates:urls.length});
 }
 function enter(card){
  if(hibViewerOpen()){if(hoverTimer!==null)stopWait();hovered=null;return;}
  if(hovered?.element===card?.element)return;
  stopWait();hovered=card;ready=null;
  if(!card?.element)return;
   const cacheKey=verifiedDestinationKey(card);
   if(!rc291Loaded){
     rc291Loading.finally(()=>{if(card.element.isConnected&&hovered?.element===card.element) {hovered=null;enter(card);}});
     return;
   }
   const priorVerified=liveVerified(cacheKey);
  if(priorVerified){
   verifiedCards.set(card.element,priorVerified);
   ready=priorVerified;
   showIndicator(card,'−','Verified media — right click for restored unified player');
   console.info('[HIB RC279]',{status:'CACHED_VERIFIED_CARD_REUSED',url:priorVerified.source});
   return;
  }
  const landed=cacheKey?landingDestinations.get(cacheKey):null;
  // A down source may come back: retry after ten minutes. A landing page stays marked for the session.
  if(landed&&Date.now()-landed.at<10*60*1000){
   showIndicator(card,"'",landed.reason==='source-down'?'Source is down right now - image popup only; will be tried again later':'Landing page - no video ready to play; image popup only');
   /* RC449: hovering an apostrophe card again for the full hover time scans it again (a scan can fail by chance; no page refresh needed).
    * A card that is only waiting for the autoplay permission is left alone. */
   if(landed.reason!=='autoplay-blocked'){
    const tok=requestID,el=card.element;
    hoverTimer=setTimeout(()=>{
     hoverTimer=null;
     if(tok!==requestID||hovered?.element!==el||!el.isConnected||hibViewerOpen()||window.__hibHoverScanBusy)return;
     landingDestinations.delete(cacheKey);
     try{hibCategoryClear(card);}catch(_){}
     console.info('[HIB RC449]',{status:'RESCAN_ON_REHOVER',key:cacheKey});
     hovered=null;enter(card);
    },delay*1000);
   }
   return;
  }
  if(landed)landingDestinations.delete(cacheKey);
  const token=requestID;
  console.info('[HIB HOVER VIDEO]',{status:'HOVER_TIMER_STARTED',delay,cardType:card.type||'',destination:destinationOf(card)});
  hoverTimer=setTimeout(()=>{
   hoverTimer=null;
   if(hibViewerOpen()||token!==requestID||hovered?.element!==card.element||!card.element.isConnected)return;
   console.info('[HIB HOVER VIDEO]',{status:'STAGE1_HOVER_CONFIRMED',delay,cardType:card.type||'',title:card.title||'',destination:destinationOf(card),element:card.element});
   if(window.__hibHoverScanBusy){console.info('[HIB RC346]',{status:'HOVER_SKIPPED_SCAN_ACTIVE'});return;}
   window.__hibHoverScanBusy=true;window.__hibHoverScanStart=Date.now();
   spinnerLock=false;clearSpinner(true);spinner=stage2Spinner(card);
   console.info('[HIB HOVER VIDEO]',{status:'STAGE2_EXTRACTION_STARTED',cardType:card.type||''});
   // Yield a rendering opportunity so the spinner is observable during extraction.
   const runExtraction=async()=>{
    if(hibViewerOpen()||token!==requestID||hovered?.element!==card.element||!card.element.isConnected)return;
    let error=null;
    const destination=destinationOf(card);
    const direct=validURL(destination);
    const status=direct?'STAGE2_DIRECT_URL_EXTRACTED':destination?'STAGE2_PAGE_URL_EXTRACTED':'STAGE2_DESTINATION_UNAVAILABLE';
    console.info('[HIB HOVER VIDEO]',{status,destination,error,note:'Discovery only. Embedded players and media verification are Stage 3; no playback.'});
    // Stage 3 candidate discovery: inspect the rendered destination and its frames.
    // A watch URL is NOT a verified media URL. No player launch in this build.
    const requestedEpisodeKey=verifiedDestinationKey(card);
    let result=null;
    if(destination&&!direct){
     console.info('[HIB HOVER VIDEO]',{status:'RC259_PLAYER_PROBE_STARTED',destination});
     try{result=await browser.runtime.sendMessage({type:'hib-rc259-probe-video',pageUrl:destination,knownSource:hibKnownSource.get(requestedEpisodeKey)||undefined});}
     catch(e){error=String(e);}
    }
    // RC263: committed discovery survives pointer departure; only navigation/disconnection invalidates delivery.
     if(!card.element.isConnected || !requestedEpisodeKey || verifiedDestinationKey(card)!==requestedEpisodeKey){console.warn('[HIB RC285]',{status:'STALE_OR_AMBIGUOUS_EPISODE_RESULT_DROPPED'});return;}
    if(result?.landing){
     if(hibAutoOpenEl===card.element)hibAutoOpenEl=null;
     if(requestedEpisodeKey)landingDestinations.set(requestedEpisodeKey,{at:Date.now(),reason:result.reason||'landing'});
     try{hibCategoryLanding(card,result.reason||'landing',requestedEpisodeKey);}catch(_){}   // RC435
     clearSpinner();showIndicator(card,"'",result.reason==='source-down'?'Source is down right now - image popup only; will be tried again later':result.reason==='unsupported-video'?'This video format is not supported by this browser and no source could be read - image popup only':'Landing page - no video ready to play; image popup only');
     if(result.reason==='autoplay-blocked')hibAutoplayNotice(card);
     console.info('[HIB RC297]',{status:'LANDING_PAGE_MARKED',reason:result.reason||'landing',destination});
     return;
    }
    const source=result?.playbackVerified?result?.sources?.[0]||null:null;
    if(source&&result?.resultToken){
      console.info('[HIB RC268]',{status:'VERIFIED_URL_DELIVERED',url:source.url,engine:result.detectedEngine,elapsedMs:result.elapsedMs});
      extractionPanel({destination:source.url,direct:true,verified:true,title:card.title||''});
      if(!cacheMediaForCard(card,{card:card.element,destination,source:source.url,referrer:source.frame||'',kind:source.format||source.kind||'verified-media',engine:result.detectedEngine||null,episodeId:null}))return;
      clearSpinner();showIndicator(card,'−','Verified media — right click for restored unified player');
      if(hibAutoOpenEl===card.element){hibAutoOpenEl=null;if(hovered?.element===card.element){const m2=liveVerified(verifiedDestinationKey(card));if(m2)hibOpenVerified({media:m2,format:undefined,card});}}
      try{const ack=await browser.runtime.sendMessage({type:'hib-rc268-source-received',token:result.resultToken,url:source.url});
       console.info('[HIB RC279]',{status:'SOURCE_ACK_RESULT',ok:!!ack?.ok,closed:ack?.closed||0,error:ack?.error||null});}catch(e){console.warn('[HIB RC268] ACK_FAILED',String(e));}
    }
    console.info('[HIB HOVER VIDEO]',{status:source?'RC259_MEDIA_CANDIDATE_FOUND':'RC259_NO_MEDIA_CANDIDATE',destination,playerTypes:result?.playerTypes||[],detectedEngine:result?.detectedEngine||null,profileCacheHit:!!result?.profileCacheHit,identificationMs:result?.identificationMs||null,elapsedMs:result?.elapsedMs||null,frames:result?.frames||0,observations:result?.observations||[],source:source?.url||null,error:error||result?.error||null,note:'Detection only; no playback verification'});
    if(!source && !result?.busy)extractionPanel({destination:destination,direct:false,probeFailed:!!destination&&!direct,title:card.title||'',error:error||result?.error||null});
    if(!source&&!result?.busy&&!result?.landing&&requestedEpisodeKey&&result&&/exhausted/i.test(String(result.error||''))&&Date.now()-(window.__hibHoverScanStart||0)>15000&&card.element.isConnected){
     landingDestinations.set(requestedEpisodeKey,{at:Date.now(),reason:'source-down'});
     try{hibCategoryLanding(card,'no-video',requestedEpisodeKey,'source-down');}catch(_){}   // RC435: two such cards in one row mark the whole row (same 10-minute "no playable video" entry)
     showIndicator(card,"'",'No playable video found right now - image popup only; will be tried again later');
    }
    if(result?.busy)console.info('[HIB RC280]',{status:'DEFERRED_OTHER_DISCOVERY_ACTIVE',destination});
    clearSpinner();
   };
   setTimeout(()=>{const guard=setTimeout(()=>{clearSpinner();window.__hibHoverScanBusy=false;},50000);runExtraction().catch(e=>console.warn('[HIB RC295]',{status:'EXTRACTION_FAILED',error:String(e)})).finally(()=>{clearTimeout(guard);clearSpinner();window.__hibHoverScanBusy=false;});},100);

  },delay*1000);
 }
 window.addEventListener('pointerover',e=>{const card=cardOf(e);if(card)enter(card);},true);
 window.addEventListener('pointermove',e=>{const card=cardOf(e);if(card?.element!==hovered?.element)enter(card);},true);
 window.addEventListener('pointerout',e=>{if(!hovered?.element||hovered.element.contains(e.relatedTarget))return;
  /* RC453: a site's own hover layer (info card / preview inserted outside the card's element) takes the pointer without the pointer having left the card: only leave when no card is under the pointer any more */
  try{const under=stage()?.cardAtPoint(e.clientX,e.clientY);if(under?.element&&under.element===hovered.element)return;}catch(_){}
  enter(null);},true);
 window.addEventListener('blur',()=>{if(window.__hibHoverScanBusy)return;enter(null);},true);   // RC457: HIB's own scan window takes the focus when the hover scan starts; that blur must not cancel the hover it belongs to
 window.addEventListener('pagehide',()=>{enter(null);closePlayer();},true);
 function closePlayer(){++playerToken;try{playerVideo?.pause();playerVideo?.removeAttribute('src');playerVideo?.load();}catch{}playerHost?.remove();playerHost=null;playerVideo=null;}
 /* RC486: what is playing now, so that a player whose address ran out can ask for a fresh one (same scan as the right-click refresh of a stale card). */
 let hibLiveOpen=null,hibFreshBusy=false;
 window.addEventListener('hib-need-fresh-source',async()=>{
  if(hibFreshBusy||!hibLiveOpen||!hibLiveOpen.destination)return;hibFreshBusy=true;
  try{
   const r=await browser.runtime.sendMessage({type:'hib-rc259-probe-video',pageUrl:hibLiveOpen.destination,knownSource:hibLiveOpen.url});
   const src=r&&r.playbackVerified&&r.sources&&r.sources[0]&&r.sources[0].url;
   if(src){hibLiveOpen.url=src;window.dispatchEvent(new CustomEvent('hib-fresh-source',{detail:{url:src}}));
    // the saved address of this episode is replaced too, so the next open uses the fresh one
    try{const k=hibLiveOpen.cacheKey,old=k&&verifiedDestinations.get(k);if(old){const own={...old,source:src,cachedAt:Date.now()};verifiedDestinations.set(k,own);rc291Persist(k,{cacheKey:k,cachedAt:own.cachedAt,destination:own.destination,source:src,referrer:own.referrer||'',kind:own.kind,engine:own.engine||null,episodeId:own.episodeId||null});}}catch(_){}console.info('[HIB RC486]',{status:'FRESH_SOURCE_DELIVERED'});
    if(r.resultToken){try{await browser.runtime.sendMessage({type:'hib-rc268-source-received',token:r.resultToken,url:src});}catch(_){}}}
   else console.info('[HIB RC486]',{status:'FRESH_SOURCE_NOT_FOUND',landing:!!(r&&r.landing)});
  }catch(e){console.warn('[HIB RC486]',{status:'FRESH_SOURCE_FAILED',error:String(e)});}
  finally{hibFreshBusy=false;}
 });
 // opens the unified HIB player for an address (the only player UI)
 function openPlayer(source){
  closePlayer();
  const spec=typeof source==='string'?{url:source}:source;
  let url;try{url=new URL(spec.url);}catch{return;}
  hibLiveOpen=spec.destination?{url:url.href,destination:spec.destination,cacheKey:spec.cacheKey||''}:null;
  if(url.protocol!=='https:')return;
  try{browser.runtime.sendMessage({type:'hib-rc297-media-hint',url:url.href,referrer:spec.referrer||location.href});}catch(_){}
  // The unified HIB player is the only player UI. If it cannot open (already open, bad address) nothing else is shown in its place.
  if(!window.__hibUnifiedPlayerOpen){console.warn('[HIB RC346]',{status:'UNIFIED_PLAYER_MISSING'});return;}
  const ok=window.__hibUnifiedPlayerOpen({url:url.href,format:spec.format,title:(spec.card&&spec.card.title)||document.title,site:location.hostname,observedSource:true,subtitles:spec.subtitles||undefined,destination:spec.destination||undefined});
  hibOpenTrace('OPEN_PLAYER',{ok:!!ok});
  console.info('[HIB RC346]',{status:ok?'UNIFIED_PLAYER_OPENED':'UNIFIED_PLAYER_REJECTED',url:url.href.slice(0,120)});
 }

  let claimedUntil=0,claimedCard=null;
  function verifiedForEvent(e) {
    let card=cardOf(e);
    let media=card?.element?.isConnected?liveVerified(verifiedDestinationKey(card)):null;
    if(!media&&hovered?.element?.isConnected){
     const hr=hovered.element.getBoundingClientRect();
     if(e.clientX>=hr.left&&e.clientX<=hr.right&&e.clientY>=hr.top&&e.clientY<=hr.bottom){
      const m=liveVerified(verifiedDestinationKey(hovered));
      if(m){card=hovered;media=m;}
     }
    }
    if(!media){
     for(const t of hibTracked){
      if(t.symbol!=='\u2212'||!t.card?.element?.isConnected||!t.el.isConnected)continue;
      const tr=hibCardAnchor(t.card).getBoundingClientRect();
      if(e.clientX>=tr.left&&e.clientX<=tr.right&&e.clientY>=tr.top&&e.clientY<=tr.bottom){
       const m2=liveVerified(verifiedDestinationKey(t.card));
       if(m2){card=t.card;media=m2;break;}
      }
     }
    }
    if (!card?.element?.isConnected) return {card:null, media:null};
    return {card,media};
  }
  // A <video> playing in the page itself (not a card): right-click hands it to the HIB player. A blob: address is replaced by the
  // manifest / file the tab actually requested (background keeps those); the page's own player is paused.
  /* RC462: the page-video right-click only exists on sites in the user's list (it used to answer on every website). */
  let hibSiteActive=false;
  const hibSiteActiveSync=()=>browser.runtime.sendMessage({type:'hib-rc462-site-active'}).then(r=>{hibSiteActive=!!(r&&r.active);}).catch(()=>{});
  hibSiteActiveSync();try{browser.storage.onChanged.addListener((ch,area)=>{if(area==='local'&&(ch.enabledSites||ch.siteMediaModes||ch.hibRc139ScanVideoHosts))hibSiteActiveSync();});}catch(_){}
  function pageVideoAt(e){
   if(!hibSiteActive)return null;
   const direct=e.target instanceof Element?e.target.closest('video'):null;
   const list=direct?[direct]:(document.elementsFromPoint?document.elementsFromPoint(e.clientX,e.clientY):[]);
   for(const el of list){
    if(!(el instanceof HTMLVideoElement)||!el.isConnected)continue;
    const r=el.getBoundingClientRect();
    if(r.width>=200&&r.height>=120)return el;
   }
   return null;
  }
  async function openPageVideo(video){
   let url='',format;
   const src=video.currentSrc||video.src||'';
   if(/^https:/i.test(src)){url=src;format=/\.m3u8(?:[?#]|$)/i.test(src)?'hls':/\.mpd(?:[?#]|$)/i.test(src)?'dash':undefined;}
   else{const m=await browser.runtime.sendMessage({type:'hib-tab-media'}).catch(()=>null);if(m&&m.url){url=m.url;format=m.format;}}
   // RC424: a REAL stream manifest (HLS / DASH) always goes to the normal HIB URL player (time display, subtitles, quality...). The captured-stream
   // window (RC411, for MediaSource pages without any address, e.g. Mega / Google Drive) is only used when no manifest address is known: before
   // this rule hstream.moe (DASH manifest + ASS subtitles) was hijacked by the captured player, which has neither the time nor the subtitles.
   const manifest=!!url&&(format==='hls'||format==='dash');
   if(!manifest&&!/^https:/i.test(src)&&window.__hibUnifiedPlayerOpenCapturedHere&&await window.__hibUnifiedPlayerOpenCapturedHere({wait:true})){console.info('[HIB PAGE VIDEO]',{status:'OPENED_CAPTURED'});return true;}
   if(!url||!window.__hibUnifiedPlayerOpen){console.info('[HIB PAGE VIDEO]',{status:'NO_SOURCE',src:src.slice(0,60)});return false;}
   try{video.pause();}catch(_){}
   const ok=window.__hibUnifiedPlayerOpen({url,format,title:document.title,site:location.hostname,observedSource:true});
   console.info('[HIB PAGE VIDEO]',{status:ok?'OPENED':'REJECTED',url:url.slice(0,120)});
   return !!ok;
  }
  window.__HIB_HOVER_VIDEO__=Object.freeze({
    claimRightClick(e) {
      if(e.button!==2||e.ctrlKey||e.shiftKey||e.altKey||e.metaKey||playerHost||window.__hibUnifiedPlayerIsOpen?.())return false;
      const {card,media}=verifiedForEvent(e);
      if(!media&&!card){
       const pv=pageVideoAt(e);
       if(pv){if(e.type==='pointerdown')openPageVideo(pv);return true;}
      }
      /* RC468: the 'contextmenu' event that follows this click's pointerdown must not cancel what pointerdown just started (a refresh scan of a stale card runs from a hover timer that this branch used to clear) */
      if(!media&&claimedCard&&claimedCard===card?.element&&performance.now()<claimedUntil)return true;
      if(!media){
       /* RC470: a card that carries the minus (cached video) never gets the image popup from a right-click: while its refresh scan runs the click is only absorbed, and a minus whose cache entry has gone starts the refresh now */
       let mc=(card?.element&&hibAutoOpenEl===card.element&&Date.now()-hibAutoOpenAt<45000)?card:null;
       if(!mc){for(const t of hibTracked){
        if(t.symbol!=='−'||!t.card?.element?.isConnected||!t.el.isConnected)continue;
        const tr=hibCardAnchor(t.card).getBoundingClientRect();
        if(e.clientX>=tr.left&&e.clientX<=tr.right&&e.clientY>=tr.top&&e.clientY<=tr.bottom){mc=t.card;break;}
       }}
       if(mc){
        if(e.type==='pointerdown'){
         claimedUntil=performance.now()+1400;claimedCard=mc.element;
         if(!(hibAutoOpenEl===mc.element&&Date.now()-hibAutoOpenAt<45000)){
          verifiedCards.delete(mc.element);ready=null;
          hibAutoOpenEl=mc.element;hibAutoOpenAt=Date.now();
          const d0=delay;delay=0.05;hovered=null;enter(mc);delay=d0;
          if(!spinner&&mc.element.isConnected)spinner=stage2Spinner(mc);
          spinnerLock=!!spinner;setTimeout(()=>{if(spinnerLock&&!hibOpening&&!window.__hibHoverScanBusy){spinnerLock=false;clearSpinner(true);}},20000);
          console.info('[HIB RC470]',{status:'MINUS_WITHOUT_CACHE_REFRESH'});
         }
        }
        return true;
       }
      }
      if (!media) {
        // Not a cached video: this right-click is the image popup. A hover timer that has not fired yet is cancelled so no video scan starts.
        if(hoverTimer!==null){clearTimeout(hoverTimer);hoverTimer=null;hovered=null;console.info('[HIB HOVER VIDEO]',{status:'HOVER_CANCELLED_BY_RIGHT_CLICK'});}
        if(e.type==='pointerdown')hibOpenTrace('RC_NOT_VERIFIED',{card:!!card});
        console.info('[HIB RC278]',{status:'RIGHT_CLICK_NOT_VERIFIED',card:!!card,ready:!!ready,event:e.type});
        return claimedCard===card?.element&&performance.now()<claimedUntil;
      }
      if(e.type==='pointerdown'){
        claimedUntil=performance.now()+1400;
        claimedCard=card.element;
        const format=media.kind==='hls'||/mpegurl|hls/i.test(media.kind||'')?'hls':media.kind==='dash'?'dash':undefined;
        hibOpenTrace('RC_CLAIM',{});
        console.info('[HIB RC278]',{status:'VERIFIED_PLAYER_OPEN_REQUEST',url:media.source,format});
        // Do not invalidate persistent verification as the mouse leaves the thumbnail.
        enter(null);
        try {
          hibOpenVerified({media,format,card});
        }
        catch(err){console.error('[HIB RC278]',{status:'PLAYER_OPEN_ERROR',error:String(err),stack:err?.stack});}
      }
      return true;
    },
    getState(){return {delay,ready:!!ready,source:ready?.source||null,hoveredCardVerified:!!(hovered?.element&&verifiedCards.has(hovered.element))};}
  });
  function hibRC278RightClick(event) {
    if(event.button!==2)return;
    const claimed=window.__HIB_HOVER_VIDEO__?.claimRightClick(event);
    if(!claimed)return;
    event.preventDefault();event.stopImmediatePropagation();
    console.info('[HIB RC278]',{status:'VERIFIED_VIDEO_RIGHT_CLICK_CLAIMED',event:event.type});
  }
  // Ctrl + Right Shift = a right-click on the card under the pointer: the video when it is verified after the hover (or its scan is running),
  // otherwise the key falls through to the image popup.
  let hibLastPtr={x:-1,y:-1,t:null};
  window.addEventListener('pointermove',e=>{hibLastPtr={x:e.clientX,y:e.clientY,t:e.target};},true);
  window.addEventListener('keydown',e=>{
    if(!(e.code==='ShiftRight'||(e.key==='Shift'&&e.location===2))||!e.ctrlKey||e.altKey||e.metaKey||e.repeat)return;
    const el=document.elementFromPoint(hibLastPtr.x,hibLastPtr.y)||hibLastPtr.t;
    if(!el)return;
    const fake={button:2,type:'pointerdown',ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,target:el,clientX:hibLastPtr.x,clientY:hibLastPtr.y};
    if(window.__HIB_HOVER_VIDEO__?.claimRightClick(fake)){e.preventDefault();e.stopImmediatePropagation();console.info('[HIB RC278]',{status:'CTRL_RIGHT_SHIFT_CLAIMED'});}
  },true);
  window.addEventListener('pointerdown',hibRC278RightClick,true);
  window.addEventListener('contextmenu',hibRC278RightClick,true);

})();
/* ===== END SECTION 5 — HOVER VIDEO PLAYER / RC250 STAGE 1 ===== */
