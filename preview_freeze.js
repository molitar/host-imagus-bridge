"use strict";
/* ===== START SECTION 5 — HOVER VIDEO PREVIEW GUARDS (EXISTING; NOT HOVER-TO-OPEN) ===== */

/* ========================================================================
 * RC239.1 CRITICAL SAFETY FIX — HOVER OBSERVER ACTIVATION BARRIER.
 * DO NOT REMOVE OR REORDER THIS PRE-INSTALL ACTIVATION CHECK.
 * The prior version installed document-wide MutationObserver and capture-
 * phase pointer listeners on ALL websites, even if the site was not enabled.
 * This can change unrelated UI hover behavior, including ChatGPT menus.
 * Never install observers, listeners, or mutate page DOM unless the trusted
 * extension activation background reports effectiveVideoEnabled=true.
 * An inactive page is intentionally left untouched; newly enabled sites
 * require a reload for this freeze helper to install. Stage 1 activation
 * continues independently, so Card Picker and site registration still work.
 * ======================================================================== */
(async()=>{
 const activationHost=location.hostname.toLowerCase().replace(/^www\./,'');
 let activation;
 try {
  activation=await browser.runtime.sendMessage({
   type:'hib-rc153-read-activation',host:activationHost
  });
 } catch (_) { return; } // Fail closed: never touch unrelated page DOM.
 if(!activation?.effectiveVideoEnabled)return;
 // RC239.1: everything below is permitted ONLY for an active HIB site.
 const stage=()=>window.__HIB_CARD_STAGE_1__;
 const videoUrl=/\.(?:mp4|m4v|webm|ogv|mov|m3u8)(?:[?#]|$)/i;
 const imageUrl=/\.(?:jpe?g|png|webp|avif|gif|bmp|svg)(?:[?#]|$)/i;
 const previewName=/(?:preview|hover)/i;
 const blocked=new WeakSet();
 const previewSources=new WeakSet();
 const aspectQueued=new WeakSet();
 let hovered=null,cardObserver=null,stills=new Map();
 const stillOriginal=new WeakMap();   // RC432: first src/srcset seen for a picture; survives the pointer leaving/re-entering the card

 /* RC448  PAGE-WORLD IMAGE GUARD (oppai.stream: the card's thumbnail is animated by a script that swaps img.src through frames on hover).
  * Watching the attribute and putting it back (RC432) always loses the race: the picture flashes and the site keeps going. The setters are therefore
  * wrapped IN THE PAGE: while the pointer is on a card, an assignment of a DIFFERENT src/srcset to one of that card's remembered pictures is simply
  * ignored (img.src = ..., img.setAttribute('src', ...)). Everything else (other images, other attributes, pictures not yet loaded, the same value)
  * behaves exactly as before. Needs no per-site setting: it is part of the hover guard that runs on every enabled site. */
 let stillBypass=false;
 const stillBlocks=(img,name,value)=>{
  try{
   if(stillBypass||!hovered||!stills.size)return false;
   const keep=stills.get(img);if(!keep)return false;
   const orig=name==='srcset'?keep.srcset:keep.src;
   return value!==orig&&String(value)!==String(orig);
  }catch(_){return false;}
 };
 (function installImageGuard(){
  try{
   const page=window.wrappedJSObject;if(!page||typeof exportFunction!=='function'||!page.HTMLImageElement)return;
   for(const name of ['src','srcset']){
    const desc=Object.getOwnPropertyDescriptor(page.HTMLImageElement.prototype,name);
    if(!desc||!desc.set)continue;
    const origSet=desc.set;
    Object.defineProperty(page.HTMLImageElement.prototype,name,{configurable:true,enumerable:desc.enumerable,get:desc.get,
     set:exportFunction(function(v){if(stillBlocks(this,name,v))return;return origSet.call(this,v);},page)});
   }
   const origSetAttr=page.Element.prototype.setAttribute;
   page.Element.prototype.setAttribute=exportFunction(function(name,value){
    try{if(this.tagName==='IMG'&&(name==='src'||name==='srcset')&&stillBlocks(this,name,value))return;}catch(_){}
    return origSetAttr.call(this,name,value);
   },page);
   try{document.documentElement.setAttribute('data-hib-image-guard','installed');}catch(_){}
  }catch(e){console.info('[HIB RC448]','IMAGE_GUARD_NOT_INSTALLED',String(e));try{document.documentElement.setAttribute('data-hib-image-guard','ERR '+String(e).slice(0,80));}catch(_){}}
 })();
 window.__HIB_PREVIEW_FREEZE__=Object.freeze({
  hasVideoPreview(card){
   return !!card&&(previewSources.has(card)||
    [...card.querySelectorAll('*')].some(node=>previewSources.has(node)));
  }
 });

 function cardFor(target,x,y){
  if(hovered?.isConnected&&hovered.contains(target))return hovered;
  const api=stage();
  return api?.cardFromElement(target)?.element||
   (Number.isFinite(x)&&Number.isFinite(y)?api?.cardAtPoint(x,y)?.element:null)||null;
 }
 function hasImageLink(card){
  return [...card.querySelectorAll('a[href]:not([data-hib-image-native-target])')]
   .some(a=>imageUrl.test(a.href));
 }
 function normalizeStill(img){
  if(!img?.isConnected||getComputedStyle(img).objectFit!=='fill')return;
  const card=stage()?.cardFromElement(img)?.element;
  if(!card||hasImageLink(card))return;
  const r=img.getBoundingClientRect();
  const naturalWidth=img.naturalWidth||Number(img.getAttribute('width'));
  const naturalHeight=img.naturalHeight||Number(img.getAttribute('height'));
  if(r.width<30||r.height<30||naturalWidth<30||naturalHeight<30)return;
  if(Math.abs(r.width/r.height-naturalWidth/naturalHeight)/(naturalWidth/naturalHeight)>.08)
   img.style.setProperty('object-fit','contain','important');
 }
 function queueAspectCheck(node){
  const img=node.matches('img')?node:node.querySelector('img:not([data-hib-verified-image])');
  if(!img||aspectQueued.has(img))return;
  aspectQueued.add(img);
  requestAnimationFrame(()=>normalizeStill(img));
  setTimeout(()=>normalizeStill(img),500);
  if(!img.complete)img.addEventListener('load',()=>normalizeStill(img),{once:true});
 }
 function scrubPreviewNode(node){
  if(!(node instanceof Element))return false;
  let found=previewSources.has(node);
  for(const attr of [...node.attributes]){
   if(!previewName.test(attr.name)||imageUrl.test(attr.value))continue;
   const isVideo=videoUrl.test(attr.value)||/video/i.test(attr.name);
   const isMediaPreview=attr.name==='data-preview'&&
    !!(node.matches('img,video,picture')||node.querySelector('img,video,picture')||node.closest('a[href]'));
   if(!isVideo&&!isMediaPreview)continue;
   previewSources.add(node);
   node.removeAttribute(attr.name);
   found=true;
  }
  if(found)queueAspectCheck(node);
  return found;
 }
 function scrubTree(root){
  if(!(root instanceof Element))return;
  scrubPreviewNode(root);
  for(const node of root.querySelectorAll('*'))scrubPreviewNode(node);
 }
 function previewAttributes(card){
  let found=false;
  const nodes=[card,...card.querySelectorAll('*')].slice(0,300);
  for(const node of nodes)if(scrubPreviewNode(node))found=true;
  return found;
 }
 function freezeVideo(video,hidePreview=false){
  if(!(video instanceof HTMLVideoElement))return;
  // A paused hover preview still paints its first frame over the card image.
  // Hide that layer and restore the site's own thumbnail when available.
  if(hidePreview){
   if(video.style.getPropertyValue('display')!=='none'||video.style.getPropertyPriority('display')!=='important')
    video.style.setProperty('display','none','important');
   if(video.style.getPropertyValue('pointer-events')!=='none'||video.style.getPropertyPriority('pointer-events')!=='important')
    video.style.setProperty('pointer-events','none','important');
   const still=[...(video.parentElement?.querySelectorAll('img:not([data-hib-verified-image])')||[])]
    .find(img=>Number(img.getAttribute('width'))>=80||img.naturalWidth>=80);
   if(still&&getComputedStyle(still).display==='none')
    still.style.setProperty('display','block','important');
  }
  if(video.autoplay)video.autoplay=false;
  if(video.hasAttribute('autoplay'))video.removeAttribute('autoplay');
  if(video.loop)video.loop=false;
  if(video.hasAttribute('loop'))video.removeAttribute('loop');
  if(video.readyState===0&&video.preload!=='none')video.preload='none';
  try{video.pause();}catch{}
 }
 function freezeCard(card){
  if(!card?.isConnected||hasImageLink(card))return false;
  const videos=[...card.querySelectorAll('video')];
  const preview=previewAttributes(card);
  if(!preview&&!videos.length&&!blocked.has(card))return false;
  blocked.add(card);
  const hasStill=!!card.querySelector('img');
  for(const video of videos){
   const isHoverPreview=preview||video.autoplay||video.loop||
    video.hasAttribute('autoplay')||video.hasAttribute('loop');
   freezeVideo(video,hasStill&&isHoverPreview);
  }
  return true;
 }
 /* RC450  HOVER LOOK GUARD. Some sites slide a card's play-button picture on hover (a CSS background-position change on the card's link, e.g.
  * xanimeporn). While the pointer is on a card, every picture-background element inside it is pinned to the position it has when NOT hovered
  * (read from an invisible, pointer-less copy, which the :hover rule cannot reach) and its transition is switched off. Undone when the pointer leaves. */
 let pinned=[];
 function unpinCard(){for(const [el,pos,trans] of pinned){try{el.style.removeProperty('background-position');if(trans)el.style.setProperty('transition',trans);else el.style.removeProperty('transition');void pos;}catch(_){}}pinned=[];}
 function pinCard(card){
  unpinCard();
  try{
   for(const el of card.querySelectorAll('a')){
    if(el.dataset&&el.dataset.hibVideoStage)continue;
    const cs=getComputedStyle(el);
    if(!cs.backgroundImage||cs.backgroundImage==='none')continue;
    const r=el.getBoundingClientRect();if(r.width<10||r.height<10)continue;
    const clone=el.cloneNode(false);
    clone.style.cssText='position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;transition:none;width:'+r.width+'px;height:'+r.height+'px';
    el.parentNode.insertBefore(clone,el);
    const pos=getComputedStyle(clone).backgroundPosition;
    clone.remove();
    if(!pos)continue;
    pinned.push([el,pos,el.style.getPropertyValue('transition')]);
    el.style.setProperty('transition','none','important');
    el.style.setProperty('background-position',pos,'important');
   }
  }catch(_){}
 }
 function hoverCard(card){
  if(card===hovered){if(card)freezeCard(card);return;}
  cardObserver?.disconnect();cardObserver=null;
  hovered=card;
  if(!card){unpinCard();return;}
  pinCard(card);
  freezeCard(card);
  /* RC432  STILL GUARD. Some sites animate a card's thumbnail on hover WITHOUT any <video>: a script swaps the picture's src through frames
   * (oppai.stream: img.cover -> .../pics/output_0010.png ...). When the site has "Block real video playback inside gallery thumbnails" turned on
   * (card_detector API galleryBlocked), the pictures that are already loaded when the pointer enters the card are remembered, and any src/srcset
   * change made while the pointer stays on the card is put back at once. Pictures that were not loaded yet (lazy loading) are left alone. */
  stills=new Map();
  {   // RC448: GLOBAL (was: only when the site's "block gallery video" box was ticked)
   for(const img of card.querySelectorAll('img')){
    const r=img.getBoundingClientRect();
    // rendered size, not naturalWidth (a picture that is mid-swap reports 0); a data: placeholder is a lazy image still waiting for its real source
    const cur=img.getAttribute('src')||'';
    if(cur&&!/^data:/i.test(cur)&&r.width>=80&&r.height>=60){
     // The pointer often leaves and re-enters a card while the site's script is mid-swap: re-reading the CURRENT src then would remember the
     // animation frame as "original". The first value seen is kept (and refreshed only by a change that happens while the card is not hovered).
     if(!stillOriginal.has(img))stillOriginal.set(img,{src:img.getAttribute('src'),srcset:img.getAttribute('srcset')});
     stills.set(img,stillOriginal.get(img));
    }
   }
  }
  cardObserver=new MutationObserver(records=>{
   if(stills.size)for(const r of records){
    if(r.type!=='attributes'||(r.attributeName!=='src'&&r.attributeName!=='srcset')||!stills.has(r.target))continue;
    const keep=stills.get(r.target)[r.attributeName];
    stillBypass=true;try{if(keep===null)r.target.removeAttribute(r.attributeName);
    else if(r.target.getAttribute(r.attributeName)!==keep)r.target.setAttribute(r.attributeName,keep);}finally{stillBypass=false;}
   }
   const relevant=records.some(r=>r.type==='childList'||
    /(?:preview|hover|autoplay|loop|src|poster|style)/i.test(r.attributeName||''));
   if(relevant&&hovered===card&&card.isConnected)freezeCard(card);
  });
  cardObserver.observe(card,{subtree:true,childList:true,attributes:true});
 }

 // Strip generic video-preview attributes as cards are built. Waiting for a
 // hover event can be too late when a site cached the source during setup.
 const earlyObserver=new MutationObserver(records=>{
  for(const record of records){
   if(record.type==='attributes'){
    // RC432: a picture whose src changed while NOT hovered (carousel, lazy load, site refresh) has a new original
    if((record.attributeName==='src'||record.attributeName==='srcset')&&stillOriginal.has(record.target)&&!(hovered&&hovered.contains(record.target)))
     stillOriginal.set(record.target,{src:record.target.getAttribute('src'),srcset:record.target.getAttribute('srcset')});
    if(previewName.test(record.attributeName||''))scrubPreviewNode(record.target);
   }
   else for(const node of record.addedNodes)if(node.nodeType===Node.ELEMENT_NODE)scrubTree(node);
  }
 });
 earlyObserver.observe(document,{subtree:true,childList:true,attributes:true});
 if(document.documentElement)scrubTree(document.documentElement);

 // pointerover arrives before the mouseover handlers most sites use to start
 // a hover preview. Remove video preview URLs without touching movie links.
 // RC448: sticky hover. A pointer that is still INSIDE the hovered card's box keeps that card even when the element under it is not recognised as part of a card
 // (an overlay, a pass-through layer): flipping to "no card" there switched the guard off in the middle of the site's thumbnail animation.
 const insideHovered=(x,y)=>{try{if(!hovered||!hovered.isConnected)return false;const r=hovered.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}catch(_){return false;}};
 window.addEventListener('pointerover',e=>{
  const next=cardFor(e.target,e.clientX,e.clientY);
  hoverCard(next||(insideHovered(e.clientX,e.clientY)?hovered:null));
 },true);
 window.addEventListener('pointermove',e=>{
  if(hovered&&!hovered.contains(e.target)){
   const next=cardFor(e.target,e.clientX,e.clientY);
   hoverCard(next||(insideHovered(e.clientX,e.clientY)?hovered:null));
  }
 },true);
 window.addEventListener('play',e=>{
  const video=e.target;
  if(!(video instanceof HTMLVideoElement))return;
  const card=cardFor(video,0,0);
  if(card&&!hasImageLink(card)){
   blocked.add(card);
   freezeVideo(video,!!card.querySelector('img'));
  }
 },true);

 // RC448: the 'blur' reset was removed. Capture-phase 'blur' also fires for every element that loses focus and for the focus flicker when HIB's scan window opens, which
 // switched the thumbnail guard off right after the hover scan started; the pointer position (pointermove/pointerover) decides when a card is left.
 window.addEventListener('pagehide',()=>{hoverCard(null);earlyObserver.disconnect();},true);
})();

/* ===== END SECTION 5 — HOVER VIDEO PREVIEW GUARDS (EXISTING; NOT HOVER-TO-OPEN) ===== */
