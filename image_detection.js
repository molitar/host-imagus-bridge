"use strict";
/* ===== START SECTION 4A — IMAGUS IMAGE TARGET HANDOFF ===== */

/* ===========================================================================
 * RC177 / STAGE 2E: REARMED CARD-LOCAL IMAGUS IMAGE HANDOFF
 * Stage 1 supplies READ-ONLY card lookup. No edits to card inventory.
 * Hover: pre-resolve card-local sources and expose a real IMG target before
 * pointer re-entry. Right-click: report the best VERIFIED image. RC175 avoids
 * waiting until contextmenu (too late for an Imagus hover listener). No synthetic input, own popup, video playback, or video scan.
 * Native context menu is preserved. Resource bounds protect responsiveness.
 * =========================================================================== */
(()=>{
 const stage=()=>window.__HIB_CARD_STAGE_1__;
 const stats={attempts:0,success:0,failures:0,last:null};
 let seq=0;
 let imageBridge=null,bridgeExpiry=0,hoverDelay=0,hoverSequence=0;
 const hoverCache=new WeakMap();
 function removeBridge(){
  if(imageBridge){imageBridge.node.remove();imageBridge=null;}
  clearTimeout(bridgeExpiry);
 }
 function exposeNativeImage(card,image){
  // RC176: NEVER place an interactive HIB element in the document-wide top layer.
  // The image link is confined to the original card's own media positioning context.
  if(!card?.element?.isConnected||!/^https?:/.test(image.url)||!/^https?:/.test(card.url||''))return false;
  if(window.__HIB_PREVIEW_FREEZE__?.hasVideoPreview(card.element))return false;
  const root=card.element;
  const original=[...root.querySelectorAll('img')].find(el=>{
   const r=el.getBoundingClientRect();return r.width>30&&r.height>30;
  });
  if(!original)return false;
  const parent=original.parentElement;
  if(!parent||getComputedStyle(parent).position==='static')return false;
  const rect=original.getBoundingClientRect(),frame=parent.getBoundingClientRect();
  if(rect.width<30||rect.height<30||rect.right<=0||rect.bottom<=0)return false;
  removeBridge();
  /* RC241 NAVIGATION INVARIANT — DO NOT REINTRODUCE A NESTED ANCHOR.
   * RC240 put an <a href=image> inside the site's <a href=episode>, so
   * middle-click opened the JPEG instead of the episode. An image target
   * needs an IMG src for Imagus, not an image navigation anchor. This SPAN
   * leaves the original link's browser navigation (including button 1) intact.
   * Do not change back to an A even if it appears to improve hover handling. */
  const link=document.createElement('span');
  link.dataset.hibImageNativeTarget='1';
  link.setAttribute('aria-label','HIB verified image preview');
  const left=rect.left-frame.left,top=rect.top-frame.top;
  Object.assign(link.style,{position:'absolute',left:left+'px',top:top+'px',width:rect.width+'px',height:rect.height+'px',display:'block',overflow:'hidden',pointerEvents:'auto',zIndex:'auto'});
  const img=document.createElement('img');img.src=image.url;img.alt=card.title||'';img.dataset.hibVerifiedImage='1';
  // Keep the real site thumbnail visible. The transparent IMG still provides
  // a native hit target and its verified source URL to Imagus.
  Object.assign(img.style,{display:'block',width:'100%',height:'100%',objectFit:'cover',opacity:'0',pointerEvents:'auto'});
  link.appendChild(img);
  // RC241: No click/auxclick handler. Native bubbling follows the site's own anchor.
  parent.appendChild(link);
  imageBridge={node:link,card:root,url:image.url};
  // Legacy HIB re-arm pattern: a fresh native image anchor is given one
  // non-click mouseover notification when physically hovered. The site card
  // itself retains its original stacking and click/navigation behavior.
  setTimeout(()=>{
   if(!link.isConnected || imageBridge?.node!==link || !link.matches(':hover'))return;
   link.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,cancelable:false,view:window}));
   console.info('[HIB RC177 IMAGUS RECHECK]',{image:image.url,hovered:true});
  },80);
  bridgeExpiry=setTimeout(removeBridge,12000);
  console.info('[HIB RC177 IMAGUS TARGET]',{image:image.url,card:card.url,dimensions:[image.width,image.height],stacking:'card-local; no global z-index',hint:'Move mouse away and back over the image.'});
  return true;
 }
 function grade(w,h){const n=Math.max(w,h);return n<200?'BAD':n<400?'LOW':n<600?'MEDIUM':'HIGH';}
 function candidate(url,rank,source){if(!url)return null;try{const u=new URL(url,location.href);if(!['https:','http:','data:','blob:'].includes(u.protocol))return null;return {url:u.href,rank,source};}catch{return null;}}
 function cssUrls(value){if(!value||value==='none')return [];const a=[];const re=/url\(\s*(["']?)(.*?)\1\s*\)/gi;let m;while((m=re.exec(value))!==null){if(m[2])a.push(m[2]);if(a.length>=5)break;}return a;}
 function srcsetUrls(value){
  // HTML srcset entries carry density/width descriptors; do not mistake those for URLs.
  return (value||'').split(/,\s*(?=\S)/).map(x=>x.trim().split(/\s+/)[0]).filter(Boolean).slice(0,16);
 }
 function discover(card){
  const out=[],seen=new Set();
  const add=(url,rank,source)=>{const c=candidate(url,rank,source);if(c&&!seen.has(c.url)){seen.add(c.url);out.push(c);}};
  const all=[card,...card.querySelectorAll('img,picture,source,video,[style],[data-src],[data-original],[data-lazy-src],[data-srcset],[data-bg]')].slice(0,350);
  for(const el of all){
   if(el.matches('img')){
    add(el.currentSrc,115,'img.currentSrc');add(el.getAttribute('src'),98,'img.src');
    for(const u of srcsetUrls(el.getAttribute('srcset')))add(u,108,'img.srcset');
    for(const u of srcsetUrls(el.getAttribute('data-srcset')))add(u,104,'img.data-srcset');
    for(const attr of ['data-src','data-original','data-lazy-src','data-full','data-large','data-image','data-zoom-image'])add(el.getAttribute(attr),102,'img.'+attr);
   }
   if(el.matches('source'))for(const u of srcsetUrls(el.getAttribute('srcset')||el.getAttribute('data-srcset')))add(u,108,'source.srcset');
   if(el.matches('video'))add(el.getAttribute('poster'),109,'video.poster');
   for(const attr of ['data-bg','data-background-image'])add(el.getAttribute(attr),94,attr);
   for(const u of cssUrls(el.style?.backgroundImage))add(u,96,'inline-background');
   const computed=getComputedStyle(el);for(const u of cssUrls(computed.backgroundImage))add(u,94,'computed-background');
  }
  out.sort((a,b)=>b.rank-a.rank);return out.slice(0,14);
 }
 function loadImage(c,timeout=3500){return new Promise(resolve=>{
  const img=new Image();let done=false;
  const finish=ok=>{if(done)return;done=true;clearTimeout(timer);img.onload=img.onerror=null;resolve({ok,width:ok?img.naturalWidth:0,height:ok?img.naturalHeight:0,...c});};
  const timer=setTimeout(()=>finish(false),timeout);img.onload=()=>finish(true);img.onerror=()=>finish(false);img.src=c.url;
  if(img.complete)queueMicrotask(()=>{if(img.naturalWidth)finish(true);});
 });}
 async function measure(candidates,token){
  // At most three simultaneous loads, fourteen total, to avoid flooding sites.
  const measured=[];let next=0;
  async function worker(){while(next<candidates.length&&token===seq){const item=candidates[next++];const r=await loadImage(item);if(r.ok&&r.width>0&&r.height>0)measured.push(r);}}
  await Promise.all(Array.from({length:Math.min(3,candidates.length)},worker));
  measured.sort((a,b)=>Math.max(b.width,b.height)-Math.max(a.width,a.height)||b.width*b.height-a.width*a.height||b.rank-a.rank);
  return measured;
 }
 // Pre-arm before right-click. Genuine hover entry is required for Imagus.
 // Never intercept original card clicks, preventDefault, or replay pointer events.
 function onPointerMove(e){
  if(e.target?.closest?.('[data-hib-image-native-target]'))return;
  const card=stage()?.cardFromElement(e.target)||stage()?.cardAtPoint(e.clientX,e.clientY);
  if(!card?.element || !card.url || !/^https?:/.test(card.url))return;
  if(window.__HIB_PREVIEW_FREEZE__?.hasVideoPreview(card.element)){
   clearTimeout(hoverDelay);++hoverSequence;removeBridge();return;
  }
  if(imageBridge?.card===card.element)return;
  const key=card.element;
  clearTimeout(hoverDelay);
  const serial=++hoverSequence;
  hoverDelay=setTimeout(async()=>{
   if(serial!==hoverSequence||!key.isConnected)return;
   let best=hoverCache.get(key);
   if(!best){
    const choices=discover(key);
    if(!choices.length)return;
    const verified=await measure(choices,seq);
    if(serial!==hoverSequence||!verified.length)return;
    best=verified[0];hoverCache.set(key,best);
   }
   if(serial===hoverSequence)exposeNativeImage(card,best);
  },220);
 }
 document.addEventListener('pointermove',onPointerMove,{capture:true,passive:true});
 document.addEventListener('scroll',()=>{removeBridge();++hoverSequence;},{capture:true,passive:true});
 async function onContext(e){
  if(e.target?.closest?.('[data-hib-image-native-target]'))return;
  const card=stage()?.cardFromElement(e.target)||stage()?.cardAtPoint(e.clientX,e.clientY);
  if(!card?.element)return;
  const token=++seq;stats.attempts++;
  const choices=discover(card.element);
  if(!choices.length){stats.failures++;stats.last={result:'NO_IMAGE',title:card.title,url:card.url};console.warn('[HIB RC177 IMAGE]',stats.last);return;}

  const verified=await measure(choices,token);if(token!==seq)return;
  if(!verified.length){stats.failures++;stats.last={result:'LOAD_FAILED',title:card.title,videoUrl:card.url,candidates:choices.length};console.warn('[HIB RC173 IMAGE]',stats.last);return;}
  const best=verified[0],quality=grade(best.width,best.height);
  stats.success++;stats.last={result:'PASS',quality,title:card.title,videoUrl:card.url,imageUrl:best.url,width:best.width,height:best.height,source:best.source,candidates:choices.length,verified:verified.length,alternates:verified.slice(1,5).map(x=>({url:x.url,width:x.width,height:x.height,source:x.source}))};
  let host='image';try{host=new URL(best.url).hostname||best.source;}catch{}

  hoverCache.set(card.element,best);
  const bridged=!!(imageBridge?.card===card.element) || (!(e.target instanceof HTMLImageElement) && exposeNativeImage(card,best));
  stats.last.nativeTargetArmed=bridged;

  console.info('[HIB RC177 IMAGE]',stats.last);
 }
 // Observational only. Never stopPropagation or preventDefault: user keeps native menu.
 document.addEventListener('contextmenu',onContext,true);
 window.__HIB_IMAGE_STAGE_2__=Object.freeze({getSnapshot(){return {...stats,last:stats.last?{...stats.last}:null};}});
})();
/* END STAGE 2E / REARMED IMAGE -> IMAGUS TARGET — RC177. No player/popup scan. */

/* ===== END SECTION 4A — IMAGUS IMAGE TARGET HANDOFF ===== */
