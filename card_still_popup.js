"use strict";
/* ===== START SECTION 4 — IMAGE DISCOVERY AND POPUP ===== */

/* RC215 - RC195 still popup behaviour (right-click on card thumbnails, hi-res still probing)
 * with a centered, lockable, wheel-zoom / drag / edge-resize viewer in a shadow root. TEST only. */
/* Image-pipeline decisions (candidates, sizes, identity checks, the chosen image) are forwarded to the add-on log file. */
(()=>{
 const prefixes=['[HIB IMAGE','[HIB RC24','[HIB RC239','[HIB RC240'];
 for(const k of ['info','warn']){
  const o=console[k].bind(console);
  console[k]=(...a)=>{
   try{if(typeof a[0]==='string'&&prefixes.some(p=>a[0].startsWith(p)))browser.runtime.sendMessage({type:'hib-still-log',text:a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ').slice(0,3500)}).catch(()=>{});}catch(_){}
   o(...a);
  };
 }
})();
(()=>{
 const stage=()=>window.__HIB_CARD_STAGE_1__;
 let hibCyan=false;try{browser.storage.local.get('hibDiagMode').then(v=>{hibCyan=!!(v&&v.hibDiagMode===true);}).catch(()=>{});browser.storage.onChanged.addListener((c,a)=>{if(a==='local'&&c.hibDiagMode)hibCyan=c.hibDiagMode.newValue===true;});}catch(_){}
let host=null,photo=null,serial=0,baseW=640,baseH=360,scale=1,panX=0,panY=0,moved=false,drag=null;
 const imagePath=/\/contents\/videos_screenshots\/(\d+)\/(\d+)\/(?:\d+x\d+\/\d+\.jpe?g|preview_720p\.mp4\.jpe?g)(?:[?#]|$)/i;
 console.info('[HIB VIEWER] RC247 guarded poster candidates loaded on',location.host);
 // RC222: extension-local trace; no requests or modifications caused by logging.
 const qualityTraces=window.__HIB_IMAGE_QUALITY_TRACES__||(window.__HIB_IMAGE_QUALITY_TRACES__=[]);
 function traceQuality(media,decision,detail={}){
  const dest=destinationOf(media.card,media.destination)||'';
  const item={at:new Date().toISOString(),cardUrl:dest,thumbnailUrl:media.src,
    thumbnailResolution:media.natural||[0,0],decision,...detail};
  const last=qualityTraces[qualityTraces.length-1];
  if(last&&last.cardUrl===item.cardUrl&&last.decision===item.decision&&last.resolvedImageUrl===item.resolvedImageUrl&&last.videoUrl===item.videoUrl)return;
  qualityTraces.push(item);if(qualityTraces.length>200)qualityTraces.shift();
 }


 function within(e,element){
  const r=element?.getBoundingClientRect();
  return !!r&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
 }
 function backgroundUrl(element){
  const value=getComputedStyle(element).backgroundImage;
  const match=/url\(\s*["']?(.*?)["']?\s*\)/i.exec(value);
  if(!match)return null;
  try{const url=new URL(match[1],location.href);return /^https?:$/.test(url.protocol)?url.href:null;}
  catch{return null;}
 }
 /* RC241 IMAGE SAFETY — never let UI placeholder assets become the image.
  * RC240 selected an animated loading-c*.svg as a poster. The same
  * rule applies on EVERY enabled website, before or after DOM mutation. */
 function acceptableStill(raw){
  if(!raw)return false;
  try{const u=new URL(raw,location.href);return /^https?:$/.test(u.protocol)
   &&!/\.svg(?:$|[?#])|(?:^|[\/_-])(?:loading|spinner|placeholder|sprite|icon|logo|player)(?:[\/_-]|\.|$)/i.test(u.pathname);}
  catch{return false;}
 }
 function cardAt(e){
  const card=stage()?.cardFromElement(e.target)||stage()?.cardAtPoint(e.clientX,e.clientY);
  if(!card?.element||!card.element.isConnected)return null;
  const url=card.url||card.element.querySelector('a[href*="/video/"]')?.href||'';
  const h=location.hostname.replace(/^www\./,'');
  // RC196: Trust the scanner's validated card destination instead of a site URL shape.
  if(!/^https?:\/\//i.test(url)||url===location.href)return null;
  const img=[...card.element.querySelectorAll('img:not([data-hib-verified-image])')]
   .find(node=>node.naturalWidth>=80||Number(node.getAttribute('width'))>=80);
  if(img&&acceptableStill(img.currentSrc||img.src)&&within(e,img.parentElement||img))
   return {src:img.currentSrc||img.src,natural:[img.naturalWidth,img.naturalHeight],card:card.element,destination:url};
  for(const node of [card.element,...card.element.querySelectorAll('*')]){
   if(!within(e,node))continue;
   const src=backgroundUrl(node);
   if(acceptableStill(src)){const r=node.getBoundingClientRect();if(r.width>=80&&r.height>=60)return {src,natural:[0,0],card:card.element,destination:url};}
  }
  // RC216: whatever visual sits under the pointer (hover overlays, posters, lazy images).
  for(const node of document.elementsFromPoint(e.clientX,e.clientY)){
   if(!card.element.contains(node)&&!node.contains(card.element))continue;
   if(node instanceof HTMLVideoElement&&acceptableStill(node.poster))return {src:node.poster,natural:[0,0],card:card.element,destination:url};
   if(node instanceof HTMLImageElement){const r=node.getBoundingClientRect();
    const src=node.currentSrc||node.src||node.getAttribute('data-src');
    if(acceptableStill(src)&&r.width>=80&&r.height>=60&&!node.dataset.hibVerifiedImage)return {src,natural:[node.naturalWidth,node.naturalHeight],card:card.element,destination:url};}
   const src=backgroundUrl(node);if(acceptableStill(src))return {src,natural:[0,0],card:card.element,destination:url};
  }
  return null;
 }

 // Viewer geometry: the image box is always positioned from the viewport centre plus pan.
   /* ===== START 4A — IMAGE VIEWER LAYOUT / INTERACTION ===== */
function size(){
  if(!photo)return;
  const w=baseW*scale,h=baseH*scale;
  const vw=document.documentElement.clientWidth||innerWidth,vh=innerHeight;
  const put=(k,v)=>photo.style.setProperty(k,v,'important');
  put('width',w+'px');put('height',h+'px');
  put('left',(vw/2+panX-w/2)+'px');put('top',(vh/2+panY-h/2)+'px');
 }
 /* RC465: the size settings were never read here, so every image opened at the same size (and never larger than its own pixels).
  * Popup 'Gallery' size (hibV210GalleryDisplaySize): auto / a fixed box / custom box. Settings page (hibGalleryDisplaySize): legacy+fit = fill the browser window, original = the picture's own size.
  * AUTOMATIC = the largest size that fits the browser window (small pictures are enlarged to fill it, large ones are reduced). */
 let sizePref={preset:'auto',width:960,height:540},sizeMode='legacy';
 const loadSizePrefs=()=>browser.storage.local.get(['hibV210GalleryDisplaySize','hibGalleryDisplaySize']).then(v=>{const g=v.hibV210GalleryDisplaySize;if(g&&typeof g==='object')sizePref=g;sizeMode=['legacy','fit','original'].includes(v.hibGalleryDisplaySize)?v.hibGalleryDisplaySize:'legacy';}).catch(()=>{});
 loadSizePrefs();try{browser.storage.onChanged.addListener((ch,area)=>{if(area==='local'&&(ch.hibV210GalleryDisplaySize||ch.hibGalleryDisplaySize))loadSizePrefs();});}catch(_){}
 function fit(){
  if(!photo)return;
  baseW=photo.naturalWidth||baseW;baseH=photo.naturalHeight||baseH;
  const vw=document.documentElement.clientWidth||innerWidth;
  const boxW=vw*.87,boxH=innerHeight*.86,fillWindow=Math.min(boxW/baseW,boxH/baseH);
  let target=null;const m=/^(\d{3,4})x(\d{3,4})$/.exec(String(sizePref.preset||''));
  if(m)target=[Number(m[1]),Number(m[2])];else if(sizePref.preset==='custom'&&Number(sizePref.width)>=160&&Number(sizePref.height)>=90)target=[Number(sizePref.width),Number(sizePref.height)];
  if(target)scale=Math.min(target[0]/baseW,target[1]/baseH,fillWindow);          // a chosen size, never beyond the browser window
  else if(sizeMode==='original')scale=Math.min(1,(vw*.97)/baseW,(innerHeight*.96)/baseH);                    // the picture's own pixels (reduced only when it would not fit)
  else scale=Math.min(fillWindow,(baseW<100||baseH<100)?1:4);                    // automatic: as large as the browser window allows (a tiny placeholder is not enlarged, and never more than 4x its own size)
  panX=0;panY=0;moved=false;size();
 }
 function close(){
  ++serial;drag=null;
  host?.remove();host=null;photo=null;
 }
 function show(media){
  close();const token=serial;moved=false;
  host=document.createElement('div');host.dataset.hibRc215Viewer='1';
  for(const [k,v] of Object.entries({all:'initial',position:'fixed',inset:'0',width:'100vw',height:'100vh','z-index':'2147483646',background:'transparent',overflow:'hidden','pointer-events':'none'}))host.style.setProperty(k,v,'important');
  const root=host.attachShadow({mode:'open'});
  photo=document.createElement('img');photo.alt='Verifying best available image…';photo.draggable=false;
  Object.assign(photo.style,{position:'absolute',display:'block',maxWidth:'none',maxHeight:'none',objectFit:'contain',boxSizing:'border-box',border:hibCyan?'2px solid #00c8ee':'1px solid #ffffff30',background:'#111',boxShadow:'0 8px 32px #000a',cursor:'grab',userSelect:'none',pointerEvents:'auto',touchAction:'none'});
  baseW=Math.max(1,media.natural[0]||640);baseH=Math.max(1,media.natural[1]||360);
  photo.addEventListener('load',()=>{if(token===serial&&!moved&&!drag)fit();});
  // RC238 QUALITY GUARD: do not paint the unverified gallery thumbnail first.
  // Opening the viewer still creates its normal pan/zoom/resizing controls, but
  // the image source is assigned ONLY after the decoded candidate checks finish.
  // This section is deliberately independent of CPCR / card detection/counting.
  root.append(photo);document.documentElement.append(host);
  fit();wire();
  return token;
 }
 function wire(){
  const EDGE=14;
  const zone=e=>{const r=photo.getBoundingClientRect();
   return {dx:e.clientX-r.left<EDGE?-1:r.right-e.clientX<EDGE?1:0,dy:e.clientY-r.top<EDGE?-1:r.bottom-e.clientY<EDGE?1:0};};
  const cursors={'-1,-1':'nwse-resize','1,1':'nwse-resize','1,-1':'nesw-resize','-1,1':'nesw-resize','-1,0':'ew-resize','1,0':'ew-resize','0,-1':'ns-resize','0,1':'ns-resize'};
  photo.addEventListener('pointerdown',e=>{
   if(e.button!==0)return;e.preventDefault();e.stopPropagation();
   const z=zone(e);
   if(z.dx||z.dy){const w=baseW*scale,h=baseH*scale,vw=document.documentElement.clientWidth||innerWidth;
    const cx=vw/2+panX,cy=innerHeight/2+panY;
    drag={id:e.pointerId,resize:true,dx:z.dx,dy:z.dy,ax:cx-z.dx*w/2,ay:cy-z.dy*h/2};photo.style.cursor=cursors[z.dx+','+z.dy];}
   else{drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:panX,py:panY};photo.style.cursor='grabbing';}
   photo.setPointerCapture(e.pointerId);
  });
  photo.addEventListener('pointermove',e=>{
   if(!drag){const z=zone(e);photo.style.cursor=cursors[z.dx+','+z.dy]||'grab';return;}
   if(e.pointerId!==drag.id)return;
   moved=true;
   if(drag.resize){const {dx,dy,ax,ay}=drag;let s=0;
    if(dx)s=Math.max(s,dx*(e.clientX-ax)/baseW);
    if(dy)s=Math.max(s,dy*(e.clientY-ay)/baseH);
    s=Math.max(.05,Math.min(16,s));scale=s;
    const w=baseW*s,h=baseH*s,vw=document.documentElement.clientWidth||innerWidth;
    panX=ax+dx*w/2-vw/2;panY=ay+dy*h/2-innerHeight/2;size();return;}
   panX=drag.px+e.clientX-drag.x;panY=drag.py+e.clientY-drag.y;size();
  });
  const end=e=>{if(drag&&e.pointerId===drag.id){drag=null;photo.style.cursor='grab';}};
  photo.addEventListener('pointerup',end);photo.addEventListener('pointercancel',end);
  photo.addEventListener('wheel',e=>{
   e.preventDefault();e.stopPropagation();
   const old=scale,ns=Math.max(.05,Math.min(16,scale*(e.deltaY<0?1.16:1/1.16)));
   if(ns===old)return;
   const vw=document.documentElement.clientWidth||innerWidth;
   const cx=vw/2+panX,cy=innerHeight/2+panY,k=ns/old;
   panX=(cx+(e.clientX-cx)*(1-k))-vw/2;panY=(cy+(e.clientY-cy)*(1-k))-innerHeight/2;
   scale=ns;moved=true;size();
  },{passive:false});
  photo.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();fit();});
 }

   /* ===== END 4A — IMAGE VIEWER LAYOUT / INTERACTION ===== */
  /* ===== START 4B — URL CANDIDATES / IMAGE PROBES ===== */
function candidates(src){
  const match=new URL(src,location.href).pathname.match(imagePath);
  if(!match)return [];
  const base=location.origin+'/contents/videos_screenshots/'+match[1]+'/'+match[2]+'/';
  return [base+'preview_720p.mp4.jpg'];
 }
 function probe(url){return new Promise(resolve=>{
  const img=new Image();let done=false;
  const finish=ok=>{if(done)return;done=true;clearTimeout(timer);img.onload=img.onerror=null;
   resolve(ok?{url,width:img.naturalWidth,height:img.naturalHeight}:null);};
  const timer=setTimeout(()=>finish(false),3000);
  img.onload=()=>finish(true);img.onerror=()=>finish(false);img.src=url;
  if(img.complete&&img.naturalWidth)queueMicrotask(()=>finish(true));
 });}
 // Quality decisions run only after the original verified high-res candidate pipeline completes.
 // The image remains the authoritative source until a decoded frame proves materially better.
 const frameCache=new Map(),pendingFrames=new Map();
 function previewSource(media){
  const api=window.__HIB_PREVIEW_FREEZE__;
  const direct=api?.previewUrlFor?.(media.card);
  if(direct&&/\.(?:mp4|webm|m4v)(?:[?#]|$)/i.test(direct))return direct;
  if(!media.card)return null;
  for(const node of [media.card,...media.card.querySelectorAll('*')]){
   for(const attr of ['data-preview','data-video','data-video-url','data-trailer','data-mp4']){
    const raw=node.getAttribute?.(attr);if(!raw)continue;
    try{const url=new URL(raw,location.href);if(/\.(?:mp4|webm|m4v)(?:[?#]|$)/i.test(url.href))return url.href;}catch{}
   }
   if(node instanceof HTMLVideoElement){
    const url=node.currentSrc||node.src||node.querySelector('source[src]')?.src;
    if(url&&/\.(?:mp4|webm|m4v)(?:[?#]|$)/i.test(url))return url;
   }
  }
  return null;
 }

 // RC221: Resolve actual video from the linked destination; no filename/domain guessing.
 const pageMediaCache=new Map(),pageMediaPending=new Map();
 const mediaSuffix=/\.(?:mp4|webm|m4v)(?:[?#]|$)/i;
 function normalizeVideo(raw,base){
  if(typeof raw!=='string'||!raw)return null;
  try{const u=new URL(raw.replace(/\\\//g,'/').replace(/&amp;/g,'&'),base);
   return /^https?:$/.test(u.protocol)&&mediaSuffix.test(u.href)?u.href:null;
  }catch{return null;}
 }
 /* ========================================================================
  * SECTION 1 -> SECTION 4: CARD DESTINATION CONTRACT (RC244).
  * The CPCR detector already validates card.url. Preserve that URL in the
  * transient media record: DOM-first-anchor guessing can select an image
  * link or unrelated control instead of the selected episode. The explicit
  * destination is preferred; legacy DOM fallback remains for older callers.
  * Same-origin restriction is mandatory; NEVER loosen it to fix image size.
  * CPCR, site data, and interaction isolation must remain unchanged.
  * ======================================================================== */
   /* ===== END 4B — URL CANDIDATES / IMAGE PROBES ===== */
  /* ===== START 4C — CARD DESTINATION / PLAYER ASSOCIATION ===== */
function destinationOf(card,explicitUrl){
  if(!card&&!explicitUrl)return null;
  const a=card?.querySelector('a[href]')||card?.closest('a[href]');
  for(const raw of [explicitUrl,a?.href]){
   if(!raw)continue;
   try{const u=new URL(raw,location.href);
    if(/^https?:$/.test(u.protocol)&&u.origin===location.origin&&u.href!==location.href)return u.href;
   }catch{}
  }
  return null;
 }
 async function destinationVideo(card,explicitUrl){
  const dest=destinationOf(card,explicitUrl);if(!dest)return null;
  if(pageMediaCache.has(dest))return pageMediaCache.get(dest);
  if(pageMediaPending.has(dest))return pageMediaPending.get(dest);
  const task=(async()=>{
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9000);
   try{
    const response=await fetch(dest,{credentials:'same-origin',signal:controller.signal});
    if(!response.ok)return null;
    const type=response.headers.get('content-type')||'';
    if(type&&!/html|text\/plain/i.test(type))return null;
    const html=await response.text();if(html.length>3000000)return null;
    const doc=new DOMParser().parseFromString(html,'text/html');
    const candidates=[];
    const add=(raw)=>{const url=normalizeVideo(raw,dest);
     if(url&&!candidates.includes(url))candidates.push(url);};
    for(const el of doc.querySelectorAll('video,source,a[href],meta[content],*[data-src],*[data-video],*[data-file]')){
     for(const key of ['src','href','content','data-src','data-video','data-file'])
      if(el.hasAttribute(key))add(el.getAttribute(key));
    }
    for(const script of doc.querySelectorAll('script:not([src])')){
     const code=script.textContent||'';
     for(const match of code.matchAll(/https?:\\?\/\\?\/[^\s"'<>`]+?\.(?:mp4|webm|m4v)(?:\?[^\s"'<>`]*)?/gi))
      add(match[0].replace(/\\u002[fF]/g,'/').replace(/\\u0026/g,'&'));
    }
    console.info('[HIB RC221 DISCOVERY] DESTINATION_SCAN',{destination:dest,candidates:candidates.slice(0,10)});
    // Ambiguous references are not assigned to a card automatically.
    return candidates.length===1?candidates[0]:null;
   }catch(err){console.info('[HIB RC221 DISCOVERY] PAGE_UNAVAILABLE',{destination:dest,error:String(err)});return null;}
   finally{clearTimeout(timeout);}
  })();
  pageMediaPending.set(dest,task);
  try{const result=await task;pageMediaCache.set(dest,result);return result;}
  finally{pageMediaPending.delete(dest);}
 }
 /* ========================================================================
  * RC240 GLOBAL POSTER EXTRACTION — DO NOT SIMPLIFY TO "LARGEST IMAGE".
  * Only inspect a clicked card's SAME-ORIGIN destination, then its specifically
  * embedded player. Parse HTML read-only; never execute remote scripts.
  * Candidate categories: page og/twitter image, video poster, known player
  * preview CSS, and iframe-associated preview. Reject SVG/loading/icons,
  * arbitrary galleries, and generic Fluid site wallpaper. No domain-specific
  * CDN rewriting and NO changes to CPCR.
  * ======================================================================== */
 /* SECTION 4 — IMAGE POPUP / QUALITY CACHE (RC245)
  * Only proven resolution improvements belong in the positive cache.
  * NEVER cache null, original-image fallbacks, or an unsuccessful lookup as
  * reusable successes: those blocked future poster discovery on
  * later cards. Keep in-flight deduplication separate from completed results.
  * Cache is per document, expires, and remains keyed by destination+original.
  * CPCR, card ownership, site settings and interaction isolation are untouched.
  */
 const posterCache=new Map(),posterPending=new Map();
 const POSITIVE_POSTER_TTL_MS=10*60*1000;
   /* ===== END 4C — CARD DESTINATION / PLAYER ASSOCIATION ===== */
  /* ===== START 4D — POSTER METADATA / FORMAT VARIANTS / IFRAME ADAPTERS ===== */
function posterImageUrl(raw,base){
  if(!raw||typeof raw!=='string')return null;
  try{const url=new URL(raw.replace(/&amp;/g,'&'),base);
   return acceptableStill(url.href)?url.href:null;
  }catch{return null;}
 }
 function cssImageUrls(css,base){
  if(!css)return [];
  const out=[];
  for(const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)){
   const url=posterImageUrl(m[1],base);if(url)out.push(url);
  }return out;
 }
 function extractPosterCandidates(doc,base,embedded){
  const results=[];
  const add=(raw,source,rank)=>{const url=posterImageUrl(raw,base);
   if(url&&!results.some(x=>x.url===url))results.push({url,source,rank});};
  for(const el of doc.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"],meta[property="twitter:image"],meta[property="og:image:secure_url"]'))
   add(el.getAttribute('content'),'EPISODE_METADATA',embedded?3:10);
  for(const el of doc.querySelectorAll('video[poster]'))add(el.getAttribute('poster'),'VIDEO_POSTER',embedded?13:11);
  for(const el of doc.querySelectorAll('img[src],img[data-src]')){
   if(el.closest('.jw-preview,.backdrop,.vjs-poster,[class*="player"],[id*="player"]'))
    add(el.getAttribute('src')||el.getAttribute('data-src'),'PLAYER_IMG',14);
  }
  // Computed CSS cannot be obtained from a parsed, non-executing document.
  // Inspect inline background declarations and same-document CSS rule text.
  const rules=[...doc.querySelectorAll('style')].map(x=>x.textContent||'').join('\n');
  for(const el of doc.querySelectorAll('[style]')){
   const cl=String(el.className||'');
   if(!/(?:jw-preview|backdrop|vjs-poster|fluid_pseudo_poster|player|thumbnail|poster|preview)/i.test(cl))continue;
   const isFluid=/fluid_pseudo_poster/i.test(cl);
   for(const url of cssImageUrls(el.getAttribute('style'),base))add(url,isFluid?'FLUID_CSS':'PLAYER_CSS',isFluid?1:15);
  }
  // Static stylesheet URLs can be associated with player selectors; avoid
  // unrelated global background art and ambiguous generic CSS declarations.
  for(const m of rules.matchAll(/([^{}]+)\{([^{}]*background(?:-image)?\s*:[^{}]+)\}/gi)){
   if(!/(?:\.jw-preview|\.vjs-poster|\.backdrop)/i.test(m[1]))continue;
   for(const url of cssImageUrls(m[2],base))add(url,'PLAYER_CSS_RULE',13);
  }
  // Embed player image tag can be the actual preview, e.g. a 1080p player
  // screenshot. Only gather images specifically inside player containers.
  if(embedded){for(const img of doc.querySelectorAll('img[src]')){
   const src=img.getAttribute('src');
   if(/(?:preview|poster|thumb)/i.test(src||''))add(src,'EMBED_PREVIEW_IMG',15);
  }}
  return results;
 }
 /* SECTION 4 / RC246 — bounded, generic image-resolution variants.
  * This probes semantic preview/thumbnail directory pairs on the exact same
  * host and SAME basename, not an arbitrary different scene or site. Loading
  * and dimensions alone do not prove artwork identity; callers preserve the
  * existing name-based association rules and original-image fallback. */
 function imageVariants(original){
  try{
   const u=new URL(original,location.href);
   if(!/^https?:$/.test(u.protocol)||!acceptablestillForVariant(u.href))return [];
   const out=[];
   const semantic=[[/\/preview\//i,'/thumbnail/'],[/\/thumbnails?\//i,'/full/']];
   for(const [pattern,replacement] of semantic){
    if(!pattern.test(u.pathname))continue;
    const v=new URL(u.href);v.pathname=u.pathname.replace(pattern,replacement);
    if(v.href!==u.href&&acceptableStill(v.href))out.push({url:v.href,source:'SAME_STEM_URL_VARIANT',rank:9});
    // Same image identity, alternate encoding: several sites serve WebP
    // previews but only publish their larger version in JPEG format.
    if(/\.webp$/i.test(v.pathname)){
     const jpeg=new URL(v.href);jpeg.pathname=v.pathname.replace(/\.webp$/i,'.jpg');
     if(acceptableStill(jpeg.href))out.push({url:jpeg.href,source:'SAME_STEM_JPEG_VARIANT',rank:9});
    }
   }
   return [...new Map(out.map(x=>[x.url,x])).values()].slice(0,4);
  }catch{return [];}
 }
 function acceptablestillForVariant(url){return acceptableStill(url);}
 async function fetchPosterDocument(url,kind,parent){
  try{
   let result=null;
   try{
    const u=new URL(url);
    if(u.origin===location.origin){
     const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9000);
     try{
      const r=await fetch(u.href,{credentials:'include',signal:ctrl.signal});
      const ct=r.headers.get('content-type')||'';
      if(r.ok&&(!ct||/text\/html|xhtml/i.test(ct))){const body=await r.text();if(body.length<=2000000)result={html:body,finalUrl:r.url};}
      console.info('[HIB IMAGE VERIFY]',{status:'PAGE_FETCHED_BY_PAGE',kind,url,http:r.status,bytes:result?result.html.length:0});
     }finally{clearTimeout(timer);}
    }
   }catch(e){console.info('[HIB IMAGE VERIFY]',{status:'PAGE_FETCH_BY_PAGE_FAILED',kind,url,error:String(e).slice(0,100)});}
   if(!result||!result.html)result=await browser.runtime.sendMessage({type:'hib-rc240-fetch-poster-document',url,kind,parent});
   if(!result?.html){console.info('[HIB IMAGE VERIFY]',{status:'PAGE_RESPONSE_UNAVAILABLE',kind,url,error:result?.error||'EMPTY_RESPONSE'});return null;}
   if(kind==='destination'&&result.finalUrl){try{const requested=new URL(url),final=new URL(result.finalUrl);if(requested.origin!==final.origin || (requested.pathname!==final.pathname && requested.pathname!=='/')){console.info('[HIB IMAGE VERIFY]',{status:'DESTINATION_REDIRECTED',requested:url,returned:result.finalUrl});return null;}}catch{}}
   const doc=new DOMParser().parseFromString(result.html,'text/html');
   console.info('[HIB IMAGE VERIFY]',{status:'PAGE_RESPONSE_INSPECTED',kind,url,finalUrl:result.finalUrl||url,htmlBytes:result.html.length,title:doc.title,metaImages:doc.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"],meta[property="twitter:image"]').length,iframes:doc.querySelectorAll('iframe[src]').length});
   return {doc,base:result.finalUrl||url};
  }catch{return null;}
 }
 function parsePlayerIframes(doc,base){
  return [...doc.querySelectorAll('iframe[src]')]
   .map(el=>{try{return new URL(el.getAttribute('src'),base);}catch{return null;}})
   .filter(u=>u&&/^https?:$/.test(u.protocol))
   .filter(u=>/(?:player|embed|stream|video|\/v\/)/i.test(u.pathname))
   .slice(0,6).map(u=>u.href);
 }
 /* RC241 ARTWORK IDENTITY — poster candidates are NOT interchangeable.
  * E.g. a series cover.webp must not become another episode's poster.webp,
  * and a generic player.webp is site art. Never rank by pixels alone.
  * A matching source can be proven by a WP-sized variant of the same stem,
  * or the same thumbnail-vs-full naming variant; trusted dedicated player
  * previews still require a card-specific association. */
 function imageStem(raw){
  try{let name=decodeURIComponent(new URL(raw,location.href).pathname.split('/').pop()||'').toLowerCase();
   name=name.replace(/\.(?:jpe?g|webp|png)$/,'').replace(/-\d+x\d+$/,'').replace(/_thumb$/,'');
   return name.replace(/[^a-z0-9]+/g,'');}catch{return '';}
 }
   /* ===== END 4D — POSTER METADATA / FORMAT VARIANTS / IFRAME ADAPTERS ===== */
  /* ===== START 4E — ARTWORK IDENTITY PROTECTION ===== */
const origDims=new Map(); // original thumbnail url -> {width,height}, filled by destinationPoster
 // Sources that are the destination page's OWN statement of its artwork (not a guess from a URL pattern)
 const PAGE_ARTWORK=new Set(['EPISODE_METADATA','VIDEO_POSTER','PLAYER_IMG','PLAYER_CSS','PLAYER_CSS_RULE','FLUID_CSS','EMBED_PREVIEW_IMG']);
 const idTokens=u=>{try{return new Set((new URL(u,location.href).pathname.match(/\d{5,}/g)||[]));}catch{return new Set();}};
 function isEquivalentArt(original,candidate,source,entry){
  const a=imageStem(original),b=imageStem(candidate);
  // 1. the same file name (a larger variant of the same file)
  if(a&&b&&a===b)return true;
  // 2. the same numeric video / asset id in the path (a different file of the same item)
  const ta=idTokens(original),tb=idTokens(candidate);
  for(const t of ta)if(tb.has(t))return true;
  // 3. artwork the card's own destination page declares (og:image, video poster, player preview), with the same shape as the
  //    thumbnail and not smaller: a site logo, a series cover or an advertisement is not 16:9-like the thumbnail.
  if(PAGE_ARTWORK.has(source)||source==='RENDERED_TAB_METADATA'){
   const od=origDims.get(original);
   if(od&&od.width>0&&od.height>0&&entry&&entry.width>0&&entry.height>0){
    const ro=od.width/od.height,rc=entry.width/entry.height;
    if(Math.abs(ro-rc)/ro<=0.15&&entry.width*entry.height>=od.width*od.height)return true;
   }
  }
  return false;
 }
 /* RC242: Metadata must be resolved independently of iframe latency.
  * RC241 awaited every iframe before selecting twitter:image / og:image.
  * The 1700 ms click fallback could win that race even for a valid image.
  * DO NOT select a larger unrelated image just because it is page metadata. */
   /* ===== END 4E — ARTWORK IDENTITY PROTECTION ===== */
  /* ===== START 4F — DESTINATION DISCOVERY / RC248 FALLBACK ===== */
async function destinationPoster(card,originalUrl,explicitUrl){
  const dest=destinationOf(card,explicitUrl);
  if(!dest){console.info('[HIB IMAGE VERIFY]',{status:'DISCOVERY_SKIPPED',reason:'NO_SAME_ORIGIN_DESTINATION',original:originalUrl});return null;}
  const key=dest+"|"+(originalUrl||"");
  if(posterCache.has(key)){
   const entry=posterCache.get(key);
   const ageMs=Math.max(0,Date.now()-entry.createdAt);
   const isUpgrade=!!entry.value?.url&&entry.value.url!==originalUrl;
   if(isUpgrade&&ageMs<POSITIVE_POSTER_TTL_MS){
    console.info('[HIB IMAGE VERIFY]',{status:'DISCOVERY_SKIPPED',reason:'VERIFIED_UPGRADE_CACHE_HIT',destination:dest,original:originalUrl,candidate:entry.value.url,dimensions:[entry.value.width,entry.value.height],cacheAgeMs:ageMs,cacheTtlMs:POSITIVE_POSTER_TTL_MS});
    return entry.value;
   }
   posterCache.delete(key);
   console.info('[HIB IMAGE VERIFY]',{status:'CACHE_INVALIDATED',reason:isUpgrade?'EXPIRED':'NOT_AN_UPGRADE',destination:dest,original:originalUrl,cacheAgeMs:ageMs});
  }
  if(posterPending.has(key)){
   console.info('[HIB IMAGE VERIFY]',{status:'DISCOVERY_PENDING',reason:'JOIN_IN_FLIGHT',destination:dest,original:originalUrl});
   return posterPending.get(key);
  }
  console.info('[HIB IMAGE VERIFY]',{status:'DISCOVERY_STARTED',destination:dest,original:originalUrl});
  const work=(async()=>{
   const started=performance.now();
   try{const od=await probe(originalUrl);if(od)origDims.set(originalUrl,{width:od.width,height:od.height});}catch{}
   console.info('[HIB IMAGE VERIFY]',{status:'PAGE_FETCH_STARTED',destination:dest});
   const page=await fetchPosterDocument(dest,'destination');
   console.info('[HIB IMAGE VERIFY]',{status:page?'PAGE_FETCH_SUCCEEDED':'PAGE_FETCH_FAILED',destination:dest,ms:Math.round(performance.now()-started)});
   if(!page){
    console.info('[HIB RC242 META]',{stage:'PAGE_UNAVAILABLE',destination:dest,ms:Math.round(performance.now()-started)});
    try{
     const result=await browser.runtime.sendMessage({type:'hib-rc248-existing-tab-poster-metadata',url:dest});
     console.info('[HIB IMAGE VERIFY]',{status:'RENDERED_TAB_LOOKUP',destination:dest,result:result?.error||'FOUND',count:result?.images?.length||0});
     if(result?.images?.length){
      const original=await probe(originalUrl);
      const entries=result.images.map(x=>({url:x.url,source:'RENDERED_TAB_METADATA',rank:12})).filter(x=>isEquivalentArt(originalUrl,x.url,x.source,x));
      for(const entry of entries.slice(0,6)){
       const tested=await probe(entry.url);
       console.info('[HIB IMAGE VERIFY]',{status:'RENDERED_TAB_CANDIDATE',url:entry.url,loaded:!!tested,dimensions:tested?[tested.width,tested.height]:null,identityMatch:true});
       if(tested&&original&&tested.width*tested.height>original.width*original.height)return {...tested,...entry};
      }
     }
    }catch(e){console.info('[HIB IMAGE VERIFY]',{status:'RENDERED_TAB_LOOKUP_FAILED',error:String(e)});}
    return null;
   }
   const verified=[];
   async function check(entries,stage){
    const unique=[...new Map(entries.map(x=>[x.url,x])).values()].slice(0,14);
    console.info('[HIB IMAGE VERIFY]',{status:'CANDIDATES_FOUND',stage,destination:dest,count:unique.length,candidates:unique.map(x=>({source:x.source,url:x.url,rank:x.rank,identityMatch:isEquivalentArt(originalUrl,x.url,x.source,x)})),ms:Math.round(performance.now()-started)});
    const found=await Promise.all(unique.map(async entry=>{
     const result=await probe(entry.url);return result?{...result,...entry}:null;
    }));
    verified.push(...found.filter(Boolean));
    console.info('[HIB IMAGE VERIFY]',{status:'CANDIDATES_PROBED',stage,destination:dest,results:unique.map((entry,i)=>({source:entry.source,url:entry.url,loaded:!!found[i],dimensions:found[i]?[found[i].width,found[i].height]:null,identityMatch:isEquivalentArt(originalUrl,entry.url,entry.source,entry),rank:entry.rank})),ms:Math.round(performance.now()-started)});
    const valid=found.filter(x=>x&&x.width>=300&&x.height>=150&&x.rank>=3
      &&isEquivalentArt(originalUrl,x.url,x.source,x));
    valid.sort((a,b)=>b.width*b.height-a.width*a.height || b.rank-a.rank);
    console.info('[HIB RC242 META]',{stage,destination:dest,ms:Math.round(performance.now()-started),
      candidates:unique.length,verified:found.filter(Boolean).length,matched:valid.length,
      rejected:found.filter(x=>x&&!isEquivalentArt(originalUrl,x.url,x.source,x))
       .map(x=>({source:x.source,url:x.url}))});
    return valid[0]||null;
   }
   // Page metadata first: an embedded player must never hold this result hostage.
   const pagePoster=await check(extractPosterCandidates(page.doc,page.base,false),'DESTINATION_METADATA');
   // Original-size matches must never short-circuit image upgrade discovery.
   // A genuine upgrade remains eligible for the fast metadata-first exit.
   if(pagePoster&&pagePoster.url!==originalUrl){console.info('[HIB RC240 POSTER]',{destination:dest,selected:pagePoster,seen:verified.map(x=>({source:x.source,resolution:[x.width,x.height],url:x.url}))});return pagePoster;}
   if(pagePoster)console.info('[HIB IMAGE VERIFY]',{status:'ORIGINAL_MATCH_CONTINUING',destination:dest,source:pagePoster.source});
   const variants=await check(imageVariants(originalUrl),'ORIGINAL_URL_VARIANTS');
   const originalProbe=variants?await probe(originalUrl):null;
   const largerVariant=variants&&(!originalProbe||variants.width*variants.height>originalProbe.width*originalProbe.height);
   if(variants&&!largerVariant)console.info('[HIB IMAGE VERIFY]',{status:'CANDIDATE_REJECTED',reason:'NOT_LARGER_THAN_ORIGINAL',candidate:variants.url,dimensions:[variants.width,variants.height],originalDimensions:originalProbe?[originalProbe.width,originalProbe.height]:null});
   if(largerVariant&&variants.url!==originalUrl){console.info('[HIB RC240 POSTER]',{destination:dest,selected:variants,seen:verified.map(x=>({source:x.source,resolution:[x.width,x.height],url:x.url}))});return variants;}
   const embeds=parsePlayerIframes(page.doc,page.base);
   console.info('[HIB IMAGE VERIFY]',{status:'EMBED_DISCOVERY_STARTED',destination:dest,iframeCount:embeds.length,iframes:embeds});
   const iframeCandidates=await Promise.all(embeds.map(async url=>{
    const embed=await fetchPosterDocument(url,'embed',dest);
    return embed?extractPosterCandidates(embed.doc,embed.base,true):[];
   }));
   const embedPoster=await check(iframeCandidates.flat(),'EMBED_METADATA');
   console.info('[HIB RC240 POSTER]',{destination:dest,selected:embedPoster,seen:verified.map(x=>({source:x.source,resolution:[x.width,x.height],url:x.url}))});
   return (embedPoster&&embedPoster.url!==originalUrl?embedPoster:null)||pagePoster||null;
  })();
  posterPending.set(key,work);
  try{
   const value=await work;
   // Do not let a failed discovery or the original thumbnail suppress a retry.
   const isUpgrade=!!value?.url&&value.url!==originalUrl;
   if(isUpgrade){
    posterCache.set(key,{value,createdAt:Date.now()});
    console.info('[HIB IMAGE VERIFY]',{status:'UPGRADE_CACHED',destination:dest,original:originalUrl,candidate:value.url,dimensions:[value.width,value.height],cacheTtlMs:POSITIVE_POSTER_TTL_MS});
   }else{
    posterCache.delete(key);
    console.info('[HIB IMAGE VERIFY]',{status:'FALLBACK_NOT_CACHED',reason:value?'ORIGINAL_IMAGE':'NO_MATCHING_CANDIDATE',destination:dest,original:originalUrl});
   }
   console.info('[HIB IMAGE VERIFY]',{status:value?'CANDIDATE_VALIDATED':'NO_MATCHING_CANDIDATE',destination:dest,original:originalUrl,selected:value?.url||null,dimensions:value?[value.width,value.height]:null});
   return value;
  }
  finally{posterPending.delete(key);}
 }
 // Spinner lives on the physical thumbnail while preparing, not in the full viewer.
 let pendingCard=null,pendingSpinner=null,pendingRun=0;
   /* ===== END 4F — DESTINATION DISCOVERY / RC248 FALLBACK ===== */
  /* ===== START 4G — PENDING RESOLUTION / ORIGINAL FALLBACK ===== */
function endPending(){
  pendingSpinner?.remove();pendingSpinner=null;pendingCard=null;
 }
 function beginPending(card){
  pendingCard=card||null;
  const img=card?.querySelector('img');const target=img||card;
  if(!target)return;
  const rect=target.getBoundingClientRect();
  if(rect.width<30||rect.height<30)return;
  const spinner=document.createElement('div');spinner.dataset.hibPreviewSpinner='1';
  spinner.style.cssText='position:fixed;pointer-events:none;z-index:2147483645;display:grid;place-items:center;background:#0006;border-radius:4px;';
  Object.assign(spinner.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
  const ring=document.createElement('div');ring.style.cssText='box-sizing:border-box;width:35px;height:35px;border:4px solid #ffffff75;border-top-color:#00c8ee;border-radius:50%;animation:hib-preview-spin .65s linear infinite;';
  const style=document.createElement('style');style.textContent='@keyframes hib-preview-spin{to{transform:rotate(360deg)}}';
  spinner.append(style,ring);document.documentElement.append(spinner);pendingSpinner=spinner;
 }
 function extractFrame(url){
  if(frameCache.has(url))return Promise.resolve(frameCache.get(url));
  if(pendingFrames.has(url))return pendingFrames.get(url);
  const task=new Promise(resolve=>{
   const video=document.createElement('video');video.muted=true;video.preload='auto';video.playsInline=true;
   video.crossOrigin='anonymous';
   let done=false;
   const timer=setTimeout(()=>finish(null),20000);
   function finish(value){
    if(done)return;done=true;clearTimeout(timer);
    video.pause();video.removeAttribute('src');video.load();resolve(value);
   }
   video.addEventListener('error',()=>finish(null),{once:true});
   video.addEventListener('loadedmetadata',()=>{
    if(!video.videoWidth||!video.videoHeight)return finish(null);
    const d=Number.isFinite(video.duration)?video.duration:2;
    try{video.currentTime=Math.max(0,Math.min(10,d>0?d*.1:10));}catch{finish(null);}
   },{once:true});
   video.addEventListener('seeked',()=>{
    try{
     const w=Math.min(1920,video.videoWidth),h=Math.round(w*video.videoHeight/video.videoWidth);
     const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
     const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,w,h);
     canvas.toBlob(blob=>finish(blob?{src:URL.createObjectURL(blob),width:w,height:h}:null),'image/webp',.9);
    }catch{finish(null);}
   },{once:true});
   video.src=url;video.load();
  });
  pendingFrames.set(url,task);
  return task.finally(()=>pendingFrames.delete(url));
 }
 // RC239 PROTECTED VIEWER WORKFLOW (NOT CPCR): first click owns its card's
 // preparation. No additional click may start a second job until completion.
 // The original thumbnail is authoritative even if only 300px wide. Video-frame
 // fallback is permitted only for truly tiny stills (below 300px wide) and
 // must never overwrite a usable matching poster just for larger dimensions.
 async function openStill(media){
  if(!acceptableStill(media.src)||pendingCard){console.info('[HIB IMAGE VERIFY]',{status:'DISCOVERY_SKIPPED',reason:pendingCard?'BUSY':'INVALID_TARGET',original:media.src});return;}
  const run=++pendingRun;
  beginPending(media.card);
  let best={url:media.src,width:media.natural[0]||0,height:media.natural[1]||0};
  try{
   const original=await probe(media.src);
   if(original)best=original;
   console.info('[HIB IMAGE VERIFY]',{status:original?'TARGET_VERIFIED':'TARGET_DETECTED',original:media.src,dimensions:[best.width,best.height],destination:destinationOf(media.card,media.destination)});
   // Protect responsiveness: use the card image if the destination takes too long.
   const posterTask=destinationPoster(media.card,media.src,media.destination);
   const waitStart=performance.now();
   const timedOut={timeout:true};
   const posterResult=await Promise.race([posterTask,new Promise(resolve=>setTimeout(()=>resolve(timedOut),3200))]);
   const poster=posterResult===timedOut?null:posterResult;
   console.info('[HIB IMAGE VERIFY]',{status:posterResult===timedOut?'DISCOVERY_TIMEOUT':poster?'CANDIDATE_RETURNED':'NO_MATCHING_CANDIDATE',waitMs:Math.round(performance.now()-waitStart),destination:destinationOf(media.card,media.destination),candidate:poster?.url||null,dimensions:poster?[poster.width,poster.height]:null});
   if(poster&&poster.width>=300&&poster.height>=150&&poster.width*poster.height>best.width*best.height){
    best=poster;
    traceQuality(media,'POSTER_SELECTED',{resolvedImageUrl:best.url,resolvedResolution:[best.width,best.height]});
   }else{
    // RC241 UNIVERSAL THUMB-PAIR: only same-basename _thumb image variants.
    // Carousel cards used the correct 1.jpg on fast
    // clicks, but intermittently fell back to 1_thumb.jpg after hover.
    // Probe the exact matching sibling, never unrelated screenshots.
    const sibling=/\_thumb\.(?:jpe?g|webp|png)(?:[?#]|$)/i.test(media.src)
     ?[media.src.replace(/_thumb(?=\.(?:jpe?g|webp|png)(?:[?#]|$))/i,'')]:[];
    const alternatives=await Promise.all([...sibling,...candidates(media.src)].map(probe));
    for(const alt of alternatives)
     if(alt&&alt.width*alt.height>best.width*best.height)best=alt;
   }
   // Video is a last resort, not an unconditional resolution upgrade.
   if(best.width>0&&best.width<300){
    const video=previewSource(media)||await Promise.race([
     destinationVideo(media.card,media.destination),new Promise(resolve=>setTimeout(()=>resolve(null),900))
    ]);
    if(video){
     const frame=await Promise.race([extractFrame(video),new Promise(resolve=>setTimeout(()=>resolve(null),1800))]);
     if(frame&&frame.width>=300&&frame.height>=150){
      // A frame is not proven visually equivalent. Keep existing recognizable
      // imagery unless the original image is effectively unusable (<150px).
      if(best.width<150){best={url:frame.src,width:frame.width,height:frame.height};}
     }
    }
   }
   if(run!==pendingRun)return;
   console.info('[HIB IMAGE VERIFY]',{status:best.url!==media.src?'HIGH_RES_SELECTED':'ORIGINAL_VERIFIED',original:media.src,selected:best.url,dimensions:[best.width,best.height],note:'HIGH_RES_SELECTED means dimension/selection checks passed; artwork equivalence is not proven by loading alone'});
   console.info('[HIB RC239 QUALITY] PREVIEW_READY',{thumbnail:media.src,selected:best.url,dimensions:[best.width,best.height]});
   const token=show(media);
   if(token===serial&&photo){photo.src=best.url;console.info('[HIB RC239 QUALITY] POPUP_OPENED',{selected:best.url});}
   if(posterResult===timedOut){
    // The wait ended first: the viewer is already open with the thumbnail. A larger verified image that arrives later replaces it.
    posterTask.then(late=>{
     if(late&&late.width>=300&&late.height>=150&&late.width*late.height>best.width*best.height&&photo&&token===serial&&host&&host.isConnected){
      best=late;photo.src=late.url;
      console.info('[HIB IMAGE VERIFY]',{status:'LATE_UPGRADE_APPLIED',selected:late.url,dimensions:[late.width,late.height]});
     }
    }).catch(()=>{});
   }
   traceQuality(media,'PREVIEW_OPENED',{resolvedImageUrl:best.url,resolvedResolution:[best.width,best.height]});
  }catch(error){
   console.warn('[HIB RC239 QUALITY] PREPARE_FAILED',String(error));
   if(run===pendingRun){const token=show(media);if(token===serial&&photo)photo.src=media.src;}
  }finally{if(run===pendingRun)endPending();}
 }
 const inViewer=e=>!!host&&e.composedPath().includes(host);
 function suppress(e){
  if(e.button!==2||e.shiftKey)return;
  // SECTION 5 / VERIFIED VIDEO HANDOFF: the video controller claims only
  // cards whose media source passed its own probe. Image fallback stays intact.
  if(window.__HIB_HOVER_VIDEO__?.claimRightClick(e)){
   if(e.cancelable)e.preventDefault();
   e.stopImmediatePropagation();e.stopPropagation();
   return;
  }
  if(inViewer(e)){ // right-click on the open viewer closes it
   if(e.cancelable)e.preventDefault();
   e.stopImmediatePropagation();e.stopPropagation();
   if(e.type==='pointerdown')close();
   return;
  }
  const hit=cardAt(e);
  if(!hit)return;
  if(pendingCard){if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();return;}
  if(e.cancelable)e.preventDefault();
  e.stopImmediatePropagation();e.stopPropagation();
  if(e.type==='pointerdown')openStill(hit);
 }
 /* ========================================================================
  * RC240 CRITICAL CROSS-SITE INTERACTION ISOLATION — DO NOT REMOVE.
  * This image viewer is now packaged on <all_urls> for opt-in discovery.
  * It MUST NOT install any capturing mouse/pointer/key listener, overlay,
  * observer or DOM mutation until HIB's authoritative activation is true.
  * RC239 broke chatgpt.com Settings because globally executing scripts
  * changed unrelated sites' interaction surfaces. This guard is mandatory.
  * CPCR and RC239.1 protections remain entirely independent/unchanged.
  * ======================================================================== */
 let viewerActive=false;
 const viewerEvents=[];
   /* ===== END 4G — PENDING RESOLUTION / ORIGINAL FALLBACK ===== */
  /* ===== START 4H — SITE ACTIVATION / EVENT GATES ===== */
function setViewerGate(active){
  if(active===viewerActive)return;
  viewerActive=active;
  if(active){
   for(const [type,handler] of viewerEvents)window.addEventListener(type,handler,true);
  }else{
   for(const [type,handler] of viewerEvents)window.removeEventListener(type,handler,true);
   ++pendingRun;endPending();close();
  }
 }
 async function refreshViewerGate(){
  try{const result=await browser.runtime.sendMessage({type:'hib-rc153-read-activation',host:location.hostname});
   setViewerGate(!!result?.effectiveVideoEnabled);
  }catch{setViewerGate(false);}
 }

 viewerEvents.push(['pointerdown',suppress],['mousedown',suppress],['contextmenu',suppress]);
 viewerEvents.push(['pointerdown',e=>{if(e.button===0&&host&&!inViewer(e))close();}]);
 viewerEvents.push(['keydown',e=>{if(e.key==='Escape')close();}]);
 // Ctrl + Right Shift = the same as a right-click on the card under the pointer (image popup; closes the popup when it is open).
 // The video hover script sees the key first and takes it when that card's video is verified after the hover.
 let lastPtr={x:-1,y:-1,t:null};
 viewerEvents.push(['pointermove',e=>{lastPtr={x:e.clientX,y:e.clientY,t:e.target};}]);
 viewerEvents.push(['keydown',e=>{
  if(!(e.code==='ShiftRight'||(e.key==='Shift'&&e.location===2))||!e.ctrlKey||e.altKey||e.metaKey||e.repeat)return;
  if(host){e.preventDefault();close();return;}
  if(pendingCard)return;
  const el=document.elementFromPoint(lastPtr.x,lastPtr.y)||lastPtr.t;
  const hit=el?cardAt({target:el,clientX:lastPtr.x,clientY:lastPtr.y}):null;
  if(hit){e.preventDefault();e.stopImmediatePropagation();openStill(hit);}
 }]);
 viewerEvents.push(['resize',()=>{if(photo&&!moved)fit();else size();}]);
 viewerEvents.push(['pagehide',()=>{++pendingRun;endPending();close();}]);
 browser.storage.onChanged.addListener((change,area)=>{
  if(area==='local'&&['enabledSites','siteMediaModes','hibRc139ScanVideoHosts'].some(k=>k in change))refreshViewerGate();
 });
 refreshViewerGate();

})();

/* ===== END 4H — SITE ACTIVATION / EVENT GATES ===== */
/* ===== END SECTION 4 — IMAGE DISCOVERY AND POPUP ===== */
