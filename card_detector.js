"use strict";
/* ===== START SECTION 1 — CARD DETECTOR AND CPCR ===== */

/* =======================================================================
 * RC159 / CARD_DETECTOR (PHASE 2: CARD RECOGNITION ONLY)
 * Contract:
 *   Input: page DOM + authoritative activation settings, read from background.
 *   Output: unique card inventory, last hovered/selected card, bounded event log.
 *   Never opens a popup, performs network requests, classifies a landing page,
 *   starts player detection, or changes permanent site registration.
 *   Disabled state removes highlighting and ignores hover/select events.
 *   A detected card is a DOM card container, not an image or every anchor.
 * ======================================================================= */
(()=>{
 const host=location.hostname.toLowerCase().replace(/^www\./,'');
 // DEVELOPMENT DIAGNOSTICS MASTER SWITCH — flip only for developer builds.
 const HIB_DEVELOPER_DIAGNOSTICS=true;
 const MAX_LOG=250, POST_LAYOUT_KEY='hibRc158CardLayouts', LEARN_KEY='hibRc161LearnedCardRules', DEDUPE_KEY='hibRc199SiteDedupe', VIDEO_BLOCK_KEY='hibRc202BlockGalleryVideo', families=[
  {type:'Featured carousel',selector:'#home-featured-tvshows article.hero-tv-slide'},
  {type:'Episode cards',selector:'article.item.se.episodes'},
  {type:'3D cards',selector:'article.item.se.porn,article.item.liked-card.porn'},
  {type:'Series/category cards',selector:'article.item.tvshows,article.item.se.tvshows'},
  {type:'Generic article cards',selector:'article.item:not(.se):not(.tvshows)'},
  {type:'Generic image/link cards',selector:'article.post, .video-item, .video-card, .thumb-item, .post-item, .videos .item, .videos .video, .item.video, .item.episode, .items .item, .items article, .grid-item, .thumb, .thumb-block, .videoBox, .video-box, .videoItem, .video-item-container, .post, .item'}
 ];
 let postFix=false,inspectMode=false, enabled=false,gate=null,inventory=[],hovered=null,lastSelected=null,events=[],serial=0,refreshTimer=null,observer=null,lastInventorySignature='';
 let pickerRememberedCardLevel=null;
 let learnedRules=[],siteDedupe=null,siteVideoBlock=false,pickerDedupeOriginal=false,pickerVideoOriginal=false,picker=null,pickTarget=null,pickLevel=0,pickMatches=[],pickCandidate=null,pickerShield=null,pickerHoverTarget=null,pickStage=0,pickThumbSelector=null,pickThumbElement=null;
 const hasCardMedia=el=>!!(el.matches('img,video,picture')||el.querySelector('img,video,picture,[style*="background-image"]')||el.matches('[style*="background-image"]'));
 const normalizedTitle=value=>String(value||'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const cardTitle=el=>titleOf(el)||el.querySelector('a[title]')?.getAttribute('title')||el.querySelector('.title,.video-title,.name,h4,h5')?.textContent?.trim()||el.textContent?.trim().slice(0,140)||'';
 // RC168: distinguish a navigable URL from a JS-activated video card.
 const isActionCard=el=>!!(el.matches('button,[role=button]')||el.querySelector('button,[role=button]'));
 const cardIsCandidate=el=>hasCardMedia(el)&&!!(urlOf(el)||el.closest('a[href]')?.href||isActionCard(el));
 let previousCardKeys=null,changeHistory=[],domIdentities=new WeakMap(),nextDomIdentity=1;
 const domId=el=>{if(!domIdentities.has(el))domIdentities.set(el,nextDomIdentity++);return domIdentities.get(el);};
 const sectionOf=el=>{const x=el.closest('section,aside,main,[role=main],.widget,.module,.sidebar,.content,.container')||el.parentElement;return x?(x.id?'#'+x.id:x.className&&typeof x.className==='string'?x.tagName.toLowerCase()+'.'+x.className.trim().split(/\s+/).slice(0,2).join('.'):x.tagName.toLowerCase()):'document';};
 function log(event,data){if(!HIB_DEVELOPER_DIAGNOSTICS)return;events.push({at:new Date().toISOString(),event,data});if(events.length>MAX_LOG)events.shift();serial++;}
/* A card that is not a link (a <button> or <div> rendered by React): its destination lives in the framework's props on the element.
  * Read-only: the element's React fiber and up to 3 parents are searched for URL-like fields (href, url, link, permalink, embedUrl, ...);
  * a destination is returned only when there is exactly ONE distinct candidate, so a list container can never be mistaken for the card. */
 function reactDestination(el){
  try{
   let node=el;try{node=el.wrappedJSObject||el;}catch(_){}
   const key=Object.keys(node).find(k=>k.startsWith('__reactFiber$'));
   let fiber=key?node[key]:null;
   if(!fiber)return '';
   const field=/^(?:href|url|link|permalink|embed_?url|watch_?url|video_?url|episode_?url|page_?url|path)$/i;
   const found=new Set();
   const take=v=>{
    if(typeof v!=='string'||v.length<2||v.length>2048)return;
    let u;try{u=new URL(v,location.href);}catch(_){return;}
    if(!/^https?:$/.test(u.protocol)||u.href===location.href)return;
    if(/\.(?:jpe?g|png|webp|gif|svg|css|js)(?:[?#]|$)/i.test(u.pathname))return;
    found.add(u.href);
   };
   const scan=props=>{
    if(!props||typeof props!=='object')return;
    for(const k of Object.keys(props)){
     let v;try{v=props[k];}catch(_){continue;}
     if(field.test(k))take(v);
     else if(v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Element)){
      let inner;try{inner=Object.keys(v);}catch(_){continue;}
      for(const k2 of inner.slice(0,40)){let v2;try{v2=v[k2];}catch(_){continue;}if(field.test(k2))take(v2);}
     }
    }
   };
   const startFiber=fiber;
   for(let depth=0;fiber&&depth<4;depth++,fiber=fiber.return)scan(fiber.memoizedProps);
   /* RC457: a card rendered from a LIST (rail / grid) often carries no address in its own props: the data object lives in an array prop of an ancestor
    * (items / list / episodes ...) and the card's wrapper is keyed by that object's id. When the card itself yielded nothing, the array entry whose id/slug equals
    * one of the wrapper keys of this card is read the same way (exactly one distinct address, same safety rule). */
   if(found.size===0&&startFiber){
    const keys=new Set();
    let f=startFiber;for(let d=0;f&&d<4;d++,f=f.return){if(f.key!==null&&f.key!==undefined&&String(f.key).length>=4)keys.add(String(f.key));}
    const idLike=/^(?:id|slug|key|uid|uuid|_id|wpId|titleId|episodeId|videoId)$/i;
    const matches=item=>{if(!item||typeof item!=='object')return false;
     for(const k of Object.keys(item).slice(0,30)){let v;try{v=item[k];}catch(_){continue;}
      if(idLike.test(k)&&(typeof v==='string'||typeof v==='number')&&keys.has(String(v)))return true;
      if(v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Element)){let ks;try{ks=Object.keys(v).slice(0,30);}catch(_){continue;}for(const k2 of ks){let v2;try{v2=v[k2];}catch(_){continue;}if(idLike.test(k2)&&(typeof v2==='string'||typeof v2==='number')&&keys.has(String(v2)))return true;}}}
     return false;};
    if(keys.size){
     f=startFiber;
     outer:for(let d=0;f&&d<9;d++,f=f.return){
      const p=f.memoizedProps;if(!p||typeof p!=='object')continue;
      for(const k of Object.keys(p)){let v;try{v=p[k];}catch(_){continue;}
       if(!Array.isArray(v)||v.length<2||v.length>400)continue;
       let hit=null;for(let i=0;i<v.length;i++){let it;try{it=v[i];}catch(_){continue;}if(matches(it)){hit=it;break;}}   // plain loop: the array belongs to the page, so no callback is handed to it
       if(hit){scan(hit);if(found.size)break outer;}
      }
     }
    }
   }
   return found.size===1?[...found][0]:'';
  }catch(_){return '';}
 }
 function urlOf(el){const links=el.matches('a[href]')?[el]:[...el.querySelectorAll('a[href]')];// RC428: only links with a real web address count. hentai0's carousel cards start with <a href="javascript:void(0)"> around the thumbnail and keep the
 // real /movie/... link on the title; taking links[0] blindly found the javascript: link, produced no address and the whole card was dropped (no hover).
 const usable=links.filter(a=>{try{return /^https?:$/.test(new URL(a.getAttribute('href'),location.href).protocol);}catch(_){return false;}});
 const prefer=usable.find(a=>a.matches('.hero-tv-title a[href],a.ep-bd-link[href],.data a[href],a.hero-tv-button[href],a[href*="/videos/"],a[href*="/series/"]'))||usable[0];if(!prefer)return links.length?'':reactDestination(el);try{const url=new URL(prefer.getAttribute('href'),location.href);return /^https?:$/.test(url.protocol)?url.href:'';}catch(_){return '';}}
 function titleOf(el){return (el.querySelector('.hero-tv-title,.data h3,.data h2,h3,h2,img[alt]')?.textContent||el.querySelector('img[alt]')?.getAttribute('alt')||el.getAttribute('title')||'').trim().slice(0,140);}
 // RC158 / POST_CARD_ADAPTER: reusable outer-container adapter. Site opt-in
 // is stored separately from registration and never modifies player settings.
 function postContainer(el){if(!(el instanceof Element))return null;const post=el.closest('[id^="post-"],.post');if(!post)return null;
  const idOk=/^post-\d+$/i.test(post.id||'');
  const structure=!!(post.querySelector('.thumb')&&post.querySelector('.clip-link,.overlay,a[href]'));
  return idOk||structure?post:null;
 }
 function postCard(el){const card=postContainer(el);if(!card)return null;
  const url=urlOf(card);if(!url)return null;
  const r=card.getBoundingClientRect();if(r.width<35||r.height<35)return null;
  // RC159: post-fix is HIT TESTING only; retain semantic classification.
  // More specific selectors take priority; unrecognized posts remain generic.
  const type=families.find(f=>f.type!=='Generic image/link cards'&&card.matches(f.selector))?.type||'Post cards (other)';
  return {el:card,type,url,title:titleOf(card),visible:!!card.getClientRects().length,clone:!!card.closest('.cloned,.owl-cloned,.slick-cloned'),rect:r,adapter:'POST_CARD_ADAPTER'};
 }
 // Store original inline style to ensure Reset returns the exact page state.
 const originalDisplay=new WeakMap();
 function restoreHiddenDuplicates(){
  for(const el of document.querySelectorAll('[data-hib-rc165-duplicate]')){
   const old=originalDisplay.get(el);
   if(old){if(old.value)el.style.setProperty('display',old.value,old.priority);else el.style.removeProperty('display');}
   else el.style.removeProperty('display');
   el.removeAttribute('data-hib-rc165-duplicate');
  }
 }
 function hideDuplicate(el){
  if(!originalDisplay.has(el))originalDisplay.set(el,{value:el.style.getPropertyValue('display'),priority:el.style.getPropertyPriority('display')});
  el.dataset.hibRc165Duplicate='1';el.style.setProperty('display','none','important');
 }
 // RC171: Compare recognized complete cards with physical peer cards missed by
 // the inventory. Never classify a missing cyan border alone as duplication.
 const candidateCardSelector='li.item-post,li.item,article.item,.item-post,.video-card,.video-item,.post-item,.grid-item';
 function cardLabel(el){
  const named=el.querySelector('.entry-title,.post-title,.video-title,.title,h2,h3,h4,h5,[itemprop="name"],a[title]');
  const value=named?.getAttribute('title')||named?.textContent||el.getAttribute('title')||'';
  return normalizedTitle(value);
 }
 function completeCard(el){
  if(!(el instanceof Element)||!el.isConnected||!hasCardMedia(el))return false;
  if(el.closest('#hib-rc161-picker,#hib-rc163-overlay-layer,#hib-rc165-shield'))return false;
  const b=el.getBoundingClientRect();
  return b.width>=65&&b.height>=65&&!!cardLabel(el)&&!!(urlOf(el)||isActionCard(el));
 }
 function duplicateCandidates(recognized){
  const keep=new Set(recognized.filter(completeCard));
  const cardPool=[...new Set([...keep,...document.querySelectorAll(candidateCardSelector)])].filter(completeCard);
  // A physical card must not merely be a descendant/ancestor of an accepted
  // one. Retain accepted inventory as authoritative representatives.
  const independent=cardPool.filter(el=>![...keep].some(k=>k!==el&&(k.contains(el)||el.contains(k))));
  const byTitle=new Map();
  for(const el of independent){const title=cardLabel(el);if(title.length<5)continue;
   const group=byTitle.get(title)||[];group.push(el);byTitle.set(title,group);
  }
  const hidden=new Set(),details=[];
  for(const [title,group] of byTitle){
   if(group.length<2)continue;
   // Never hide unmatched/unrecognized groups on the strength of a blank cyan
   // state: require at least one recognized reference with the same title.
   const anchor=group.find(el=>keep.has(el));if(!anchor)continue;
   for(const el of group){if(el===anchor)continue;
    // Whole-card alternatives only: don't hide another structural level of
    // the same card, a section container, or a nested thumbnail.
    if(group.some(other=>other!==el&&(other.contains(el)||el.contains(other))))continue;
    hidden.add(el);details.push({title,kept:domId(anchor),duplicate:domId(el),recognized:keep.has(el)});
   }
  }
  return {hidden,details,physical:cardPool.length};
 }
 // RC225: reject gallery/layout wrappers and primary-player containers.
 // Classification is based on geometry and independent media destinations,
 // not a site-specific exclusion. Individual recommendations remain eligible.
 function invalidCardContainer(el){
  const r=el.getBoundingClientRect();
  if(r.width<35||r.height<35)return true;
  const imgs=el.querySelectorAll('img');
  const links=[...el.querySelectorAll('a[href]')].filter(a=>a.querySelector('img,video,picture')||a.closest('article,.item,.thumb,.video-card'));
  const destinations=new Set(links.map(a=>a.href).filter(Boolean));
  const huge=r.height>innerHeight*0.75&&r.width>innerWidth*0.30;
  const multiTile=destinations.size>=3&&imgs.length>=3;
  const manyImages=imgs.length>=4&&r.width>innerWidth*0.40;
  const player=el.querySelector('video,iframe[src]');
  const primaryPlayer=!!player&&r.width>innerWidth*0.40&&r.height>innerHeight*0.45;
  return huge||multiTile||manyImages||primaryPlayer;
 }

 /* RC430  STRUCTURAL AUTOMATIC CARD DETECTION (oppai.stream: only 4 of ~30 identical cards were found).
  * The class-name families above only know a fixed list of theme classes (.video-item, .thumb, article.item ...). A site that calls its card
  * `a.episode` was never matched, and the generic family also drops every card whose address contains /search (oppai: /watch/X/from/search).
  * This pass needs no class names: a CARD GROUP is a set of >= 3 links that carry a picture, share one tag+class signature (and parent
  * signature), have similar sizes and lead to DIFFERENT web addresses. Each member becomes a card; the card element is grown to the largest
  * ancestor that still holds exactly one member link and is at most 2.5x the link's area (so the title under the picture is part of the card).
  * Skipped: navigation (nav / header / footer / menus), tiny links, and groups whose addresses all start with a category-like first folder
  * (/tag/, /category/, /genre/ ...: lists of topics, not videos). Existing family rows are never duplicated (overlap check). */
 function structuralCardRows(seen){
  const out=[];
  const stable=c=>c&&c.length<60&&!/^(active|current|selected|hover|focus|is-|has-|js-|slick-|owl-|swiper-|show|hide|open|visible|loaded|lazy|ng-)/i.test(c);
  const sig=el=>el.tagName.toLowerCase()+'.'+[...el.classList].filter(stable).sort().join('.');
  const bgOnly=a=>{for(const d of a.querySelectorAll('div,span')){const b=getComputedStyle(d).backgroundImage;if(b&&b!=='none'&&/url\(/.test(b)){const r=d.getBoundingClientRect();if(r.width>=60&&r.height>=40)return true;}}return false;};
  const groups=new Map(),taken=new Set();
  const skip=el=>el.closest('nav,header,footer,[role=navigation],.menu,.navbar,.breadcrumb,#hib-rc184-picker,#hib-rc163-overlay-layer,#hib-rc155-highlight');
  const add=(a,url,r)=>{if(taken.has(a))return;taken.add(a);const key=sig(a)+'|'+(a.parentElement?sig(a.parentElement):'');(groups.get(key)||groups.set(key,[]).get(key)).push({a,url,r});};
  for(const a of document.querySelectorAll('a[href]')){
   if(skip(a))continue;
   const r=a.getBoundingClientRect();if(r.width<90||r.height<60)continue;
   if(!a.querySelector('img,picture,video')&&!bgOnly(a))continue;
   const url=urlOf(a);if(!url)continue;
   add(a,url,r);
  }
  /* RC445b PICTURE-FIRST: the picture is NOT inside the link (xanimeporn: <li><img><a>title</a></li>). For every big picture the highest ancestor that still holds
   * exactly ONE distinct web address and is at most 3x the picture's area is a card candidate (its link need not wrap the picture). */
  for(const img of document.querySelectorAll('img')){
   if(skip(img))continue;
   const ir=img.getBoundingClientRect();if(ir.width<90||ir.height<60||ir.bottom<-2000||ir.top>innerHeight+4000)continue;
   if(img.closest('a[href]'))continue;                       // anchor-wrapped pictures are handled above
   let best=null,bestUrl='';
   for(let el=img.parentElement,up=0;el&&el!==document.body&&el!==document.documentElement&&up<5;el=el.parentElement,up++){
    const r=el.getBoundingClientRect();if(r.width*r.height>ir.width*ir.height*3.2)break;
    const urls=new Set();for(const l of el.querySelectorAll('a[href]')){const u=urlOf(l);if(u)urls.add(u);}
    if(urls.size===1){best=el;bestUrl=[...urls][0];}else if(urls.size>1)break;
   }
   if(best)add(best,bestUrl,best.getBoundingClientRect());
  }
  for(const members of groups.values()){
   if(members.length<3)continue;
   const urls=new Set(members.map(m=>m.url));if(urls.size<3)continue;
   const widths=members.map(m=>m.r.width).sort((x,y)=>x-y),med=widths[Math.floor(widths.length/2)];
   const fit=members.filter(m=>m.r.width>=med*0.7&&m.r.width<=med*1.3);if(fit.length<3)continue;
   const topFolders=new Set(fit.map(m=>{try{return new URL(m.url).pathname.split('/')[1]||'';}catch(_){return '';}}));
   if([...topFolders].every(f=>/^(?:categories|category|models|model|tags|tag|genres|genre|search|series|brands|brand|studios|studio|artists|artist)$/i.test(f)))continue;
   const set=new Set(fit.map(m=>m.a));
   for(const m of fit){
    let card=m.a;
    for(let i=0;i<4;i++){
     const parent=card.parentElement;if(!parent||parent===document.body||parent===document.documentElement)break;
     if([...set].filter(x=>parent.contains(x)).length!==1)break;
     const pr=parent.getBoundingClientRect(),cr=card.getBoundingClientRect();
     if(pr.width*pr.height>cr.width*cr.height*2.5)break;
     card=parent;
    }
    if(seen.has(card)||invalidCardContainer(card))continue;
    if([...seen].some(e=>e.contains(card)||card.contains(e)))continue;
    out.push({el:card,type:'Repeated image/link cards',url:m.url,title:titleOf(card)||(card.textContent||'').trim().replace(/\s+/g,' ').slice(0,100),visible:!!card.getClientRects().length,clone:!!card.closest('.cloned,.owl-cloned,.slick-cloned'),rect:card.getBoundingClientRect(),adapter:'STRUCTURAL'});
   }
  }
  return out;
 }
   /* ===== START 1A — PHYSICAL CARD SCANNING / DEDUPLICATION ===== */
function scan(){const seen=new Set(),rows=[];
  if(postFix){for(const el of document.querySelectorAll('[id^="post-"],.post')){
   const row=postCard(el);if(!row||seen.has(row.el)||invalidCardContainer(row.el))continue;
   // Nested thumbnail/post elements belong to the outer matching post.
   if(postContainer(row.el.parentElement))continue;
   seen.add(row.el);rows.push(row);
  }}
  for(const fam of families){for(const el of document.querySelectorAll(fam.selector)){
   if(seen.has(el)||el.closest('#hib-rc155-highlight')||invalidCardContainer(el))continue;
   if(postFix&&postContainer(el))continue;
   if(fam.type==='Generic image/link cards' && (el.closest('article.item')||el.querySelectorAll('img').length===0))continue;
   const href=urlOf(el);if(!href)continue;
   // RC230: a generic media card must lead to a media item, not category/model
   // navigation. Sidebars that reuse .item and img are not video inventory.
   // Respect different link schemes; don't require /video globally.
   if(fam.type==='Generic image/link cards'){
    let dest;try{dest=new URL(href)}catch{continue;}
    const path=dest.pathname.toLowerCase();
    if(/\/(?:categories|category|models|model|tags|tag|search|genres|genre)(?:\/|$)/.test(path))continue;
   }
   seen.add(el);rows.push({el,type:fam.type,url:href,title:titleOf(el),visible:!!(el.getClientRects().length),clone:!!el.closest('.cloned,.owl-cloned,.slick-cloned'),rect:el.getBoundingClientRect()});
  }}
  // RC430: class-independent pass for card groups the families above did not recognise (see structuralCardRows).
  try{for(const row of structuralCardRows(seen)){seen.add(row.el);rows.push(row);}}catch(e){log('STRUCTURAL_CARD_ERROR',String(e));}
  // RC188 / MANUAL + AUTOMATIC MERGE START
  // Manual rules are additive. They must NEVER clear the auto inventory or
  // remove automatically detected peers in another section of the page.
  const autoCount=rows.length, manualCandidates=[];
  for(const rule of learnedRules){try{for(const el of document.querySelectorAll(rule.selector)){
   if(el.closest('#hib-rc184-picker,#hib-rc163-overlay-layer')||el.matches('#hib-rc184-selection-outline,#hib-rc157-hover-outline'))continue;
   const b=el.getBoundingClientRect();if(b.width<30||b.height<30||invalidCardContainer(el)||(!rule.thumbnailSelector&&!hasCardMedia(el)))continue;
   const href=urlOf(el)||el.closest('a[href]')?.href||'';if(!href&&!isActionCard(el))continue;
   manualCandidates.push({el,type:rule.type||'Learned cards',url:href,title:cardTitle(el),visible:!!el.getClientRects().length,clone:false,adapter:'LEARNED:'+rule.selector,thumbnailSelector:rule.thumbnailSelector||null,manual:true});
  }}catch(e){log('LEARNED_RULE_ERROR',{selector:rule.selector,error:String(e)});}}
  // Only collapse auto/manual matches when they demonstrably cover the same
  // card. Containment alone is insufficient: gallery ancestors and sidebar
  // layouts can include unrelated auto-detected card elements.
  const samePhysicalCard=(a,b)=>{
   if(a.el===b.el)return true;
   const x=a.el.getBoundingClientRect(),y=b.el.getBoundingClientRect();
   const intersection=Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
   const smaller=Math.min(x.width*x.height,y.width*y.height);
   if(smaller<1||intersection/smaller<0.80)return false;
   const xurl=a.url&&b.url&&a.url===b.url;
   const xt=normalizedTitle(a.title),yt=normalizedTitle(b.title);
   return !!(xurl||(xt&&yt&&xt===yt));
  };
  let overlapCount=0, manualCount=0;
  for(const m of manualCandidates){
   if(rows.some(a=>a.manual&&samePhysicalCard(a,m))){overlapCount++;continue;}
   for(let i=rows.length-1;i>=0;i--)if(!rows[i].manual&&samePhysicalCard(rows[i],m)){rows.splice(i,1);overlapCount++;}
   rows.push(m);manualCount++;
  }
  // RC188 / MANUAL + AUTOMATIC MERGE END
  // RC170: Restore previous HIB changes before each pass. Never hide
  // isolated thumbnails or unrelated cards. Only peer card containers qualify.
  restoreHiddenDuplicates();
  const duplicateMode=siteDedupe===null?learnedRules.some(r=>r.blockDuplicates===true):siteDedupe;
  // RC200: Same destination URL is NOT the same physical card. Distinct DOM
  // tiles (including episodes pointing to a common series landing page) must
  // remain separate when the user has disabled title-based duplicate blocking.
  // Preserve only the internal protection against the same element registering
  // more than once. Optional title duplicate handling runs below.
  // RC224: collapse nested representations of ONE physical card, not peer tiles.
  // A broad wrapper containing links to multiple destinations cannot be a card.
  const dedup=new Set(),accepted=[];
  const singleDestination=row=>{
   if(!row.url)return false;
   const urls=new Set([...row.el.querySelectorAll('a[href]')].map(a=>{try{return new URL(a.href,location.href).href}catch{return ''}}).filter(Boolean));
   return urls.size<=1 || [...urls].every(u=>u===row.url);
  };
   // ========================================================================
   // PROTECTED CARD COUNT CORE: CPCR (Canonical Physical Card Registry)
   // BASELINE: RC236 / v1.0.138; labeled and DOCUMENTED in RC237 / v1.0.139.
   // DO NOT MODIFY THIS BLOCK OR THE ADJACENT INVENTORY/DEDUPE PATH BY ACCIDENT.
   // Any intentional change requires a dedicated release, regression tests,
   // and an explicit review of physical-card identity versus URL duplicates.
   //
   // PURPOSE:
   //   Count one physical CYAN card, not each YELLOW thumbnail/title link.
   //   The thumbnail is a visual/preview child, not an extra inventory card.
   //   Keep separate physical cards even when their destinations are identical.
   //   Preserve specialist families (Featured/Episode/3D/Series) and manual rules.
   //
   // VERIFIED DOM CASE (2026-10-20):
   //   92 .item-post physical wrappers: 36 main + 56 sidebar tiles.
   //   Each wrapper commonly has 3 descendant links but is ONE card.
   //   RC235 counted 184 entries. RC236 counted 87 -- FIVE legitimate cards
   //   are still missing; this implementation is NOT a complete fix.
   //   The optional site-wide title-based duplicate blocker and downstream
   //   duplicateCandidates() may also hide separate cards; inspect BEFORE edits.
   //
   // LIMITATION: .item-post is a verified site structure, not a universal
   // card selector. Do not broaden it to all sites without cross-site tests.
   // REGRESSION TARGETS: 92 distinct cards on a long grid; 24 on a short one;
   // specialist classifications intact; no storage mutations.
   //
   // BEGIN CPCR PROTECTED IMPLEMENTATION (RC236 BEHAVIOR UNCHANGED)
   // ========================================================================
  const physicalGenericWrapper=row=>{
   if(row.type!=='Generic image/link cards'||row.manual)return null;
   const wrapper=row.el.closest('.item-post');
   if(!wrapper||!wrapper.isConnected||!wrapper.contains(row.el))return null;
   const r=wrapper.getBoundingClientRect();
   if(r.width<45||r.height<45||r.width>500||r.height>500)return null;
   if(wrapper.querySelectorAll('img').length<1||wrapper.querySelectorAll('img').length>3)return null;
   if(wrapper.querySelectorAll('.item-post').length>0)return null;
   const links=[...wrapper.querySelectorAll('a[href]')].map(a=>a.href);
   if(!row.url||!links.includes(row.url))return null;
   return wrapper;
  };
  const wrapperIndex=new Map();
  for(const row of rows.filter(row=>!row.clone)){
   const wrapper=physicalGenericWrapper(row);
   if(wrapper&&wrapperIndex.has(wrapper)){
    const idx=wrapperIndex.get(wrapper), existing=accepted[idx];
    // Prefer the complete outer card over an inner thumbnail/link.
    if(row.el===wrapper&&existing.el!==wrapper)accepted[idx]=row;
    continue;
   }
   if(dedup.has(row.el))continue;
   dedup.add(row.el);
   const index=accepted.findIndex(existing=>{
    if(!row.url||row.url!==existing.url)return false;
    if(!singleDestination(row)||!singleDestination(existing))return false;
    if(!(row.el.contains(existing.el)||existing.el.contains(row.el)))return false;
    const a=row.el.getBoundingClientRect(),b=existing.el.getBoundingClientRect();
    const areaA=a.width*a.height,areaB=b.width*b.height;
    return areaA>0&&areaB>0&&Math.max(areaA,areaB)/Math.min(areaA,areaB)<7;
   });
   if(index<0){if(wrapper)wrapperIndex.set(wrapper,accepted.length);accepted.push(row);continue;}
   const existing=accepted[index];
   // Prefer complete outer card when it adds title/details; retain manual rules.
   if(existing.manual&&!row.manual)continue;
   if(row.manual&&!existing.manual){accepted[index]=row;continue;}
   if(row.el.contains(existing.el)&&!existing.el.contains(row.el))accepted[index]=row;
  }
     // END CPCR PROTECTED IMPLEMENTATION -- do not change without review.
   // NOTE: Site-wide title duplicate hiding is a SEPARATE downstream stage.
   // Its behavior must be audited independently when diagnosing missing cards.
   const duplicateReview=duplicateMode?duplicateCandidates(accepted.map(r=>r.el)):{hidden:new Set(),details:[],physical:0};
  const toHide=duplicateReview.hidden;
  for(const el of toHide)hideDuplicate(el);
  inventory=accepted.filter(row=>!toHide.has(row.el));
  if(toHide.size)log('DUPLICATE_CARDS_HIDDEN',{count:toHide.size,details:duplicateReview.details.slice(0,30)});
  // Diagnostic-only DOM identity diff; no changes to the RC159 inventory.
  const current=new Map(inventory.map(r=>[domId(r.el),{type:r.type,title:r.title,url:r.url,section:sectionOf(r.el)}]));
  if(previousCardKeys){const added=[...current].filter(([k])=>!previousCardKeys.has(k)).map(([,v])=>v),removed=[...previousCardKeys].filter(([k])=>!current.has(k)).map(([,v])=>v);
   if(added.length||removed.length){changeHistory.push({at:new Date().toISOString(),added:added.length,removed:removed.length,addedSamples:added.slice(0,12),removedSamples:removed.slice(0,12)});if(changeHistory.length>35)changeHistory.shift();log('CARD_DOM_CHANGED',{added:added.length,removed:removed.length});}}
  previousCardKeys=current;
  const counts={};for(const fam of families)counts[fam.type]=inventory.filter(r=>r.type===fam.type).length;if(postFix)counts['Post cards (other)']=inventory.filter(r=>r.type==='Post cards (other)').length;counts['Learned cards']=inventory.filter(r=>r.type==='Learned cards').length;
  counts['Auto detected']=inventory.filter(r=>!r.manual).length;counts['Manual detected']=inventory.filter(r=>!!r.manual).length;counts['Auto/manual overlaps']=overlapCount;counts['Total unique cards']=inventory.length;
  const signature=JSON.stringify(counts);if(signature!==lastInventorySignature){lastInventorySignature=signature;log('CARD_COUNTS_CHANGED',{counts,total:inventory.length});}
 }
 function relevant(target){if(!(target instanceof Element))return null;
  // RC188: prefer configured/manual card in nested or post-fix layouts.
  let cur=target;while(cur&&cur!==document.documentElement){const row=inventory.find(r=>r.el===cur&&r.manual);if(row)return row;cur=cur.parentElement;}
  if(postFix){const post=postContainer(target);if(post){const row=inventory.find(r=>r.el===post);if(row)return row;}}
  cur=target;while(cur&&cur!==document.documentElement){const row=inventory.find(r=>r.el===cur);if(row)return row;cur=cur.parentElement;}return null;}
 // RC157 / HOVER_OUTLINE: separate fixed-position visual overlay. It never
 // intercepts site pointers; native card links retain their own click handling.
 // RC163: root-level, pointer-transparent, fixed coordinate outline layer.
 // The layer is separate from site card CSS and covers the viewport.
 const overlayLayer=document.createElement('div');overlayLayer.id='hib-rc163-overlay-layer';
 Object.assign(overlayLayer.style,{position:'fixed',inset:'0',zIndex:'2147483646',pointerEvents:'none',overflow:'hidden'});
 const outline=document.createElement('div');outline.id='hib-rc157-hover-outline';
 Object.assign(outline.style,{position:'absolute',display:'none',pointerEvents:'none',boxSizing:'border-box',border:'4px dashed #00dfff',background:'transparent'});
 overlayLayer.appendChild(outline);
  // RC186: Optional learned thumbnail highlight; automatic hover/detection otherwise unchanged.
  const thumbnailOutline=document.createElement('div');thumbnailOutline.id='hib-rc186-thumbnail-outline';
  Object.assign(thumbnailOutline.style,{position:'absolute',display:'none',pointerEvents:'none',boxSizing:'border-box',border:'4px dashed #ffd42a',background:'transparent'});
  overlayLayer.appendChild(thumbnailOutline);
  function paintedThumbnail(){
    if(!hovered)return null;
    for(const rule of learnedRules){if(!rule.thumbnailSelector||!rule.selector)continue;
      try{const card=hovered.el.matches(rule.selector)?hovered.el:hovered.el.closest(rule.selector)||hovered.el.querySelector(rule.selector);
        if(card){const thumb=card.matches(rule.thumbnailSelector)?card:card.querySelector(rule.thumbnailSelector);if(thumb)return thumb;}
      }catch(_){}}
    return null;
  }

 const PREVIEW_LIMIT=250,OFFSET=5;
let pickPreviewOk=false,pickSavedReadOnly=false;
 let previewElements=[];
 function positionOverlay(el,node){ensureOverlay();const r=el.getBoundingClientRect();if(!el.isConnected||r.width<8||r.height<8||r.bottom<0||r.right<0||r.top>innerHeight||r.left>innerWidth){node.style.display='none';return;}
  Object.assign(node.style,{display:'block',left:(r.left-OFFSET)+'px',top:(r.top-OFFSET)+'px',width:(r.width+2*OFFSET)+'px',height:(r.height+2*OFFSET)+'px'});}
 /* RC434: single-page sites (React / Next, e.g. hentaihaven.xxx) rebuild <html>'s children while they hydrate and silently DELETE the overlay layer
  * that was appended at start-up, so the cyan card outline never showed even though cards were detected. The layer is re-attached whenever it is
  * needed (every paint) and whenever something removes it. */
 function ensureOverlay(){if(!overlayLayer.isConnected&&document.documentElement)document.documentElement.appendChild(overlayLayer);}
 /* RC476: the cyan card outline / yellow thumbnail outline are working aids: shown while picking / inspecting cards, or when the user has switched Diagnostics mode ON (stored true). Plain browsing stays clean. */
 let hibOutlinesOn=false;
 try{browser.storage.local.get('hibDiagMode').then(v=>{hibOutlinesOn=v&&v.hibDiagMode===true;}).catch(()=>{});browser.storage.onChanged.addListener((ch,area)=>{if(area==='local'&&ch.hibDiagMode){hibOutlinesOn=ch.hibDiagMode.newValue===true;if(!hibOutlinesOn)inspectMode=false;paintOutline();}});}catch(_){}
 /* 3.0.1: Diagnostics mode switched OFF must bring the plain 1 px outline back at once: the inspect aid is switched off with it, and the stored value is read again whenever the page
  * regains focus (a change made in another tab / the Tools page is then never missed). */
 try{window.addEventListener('focus',()=>{browser.storage.local.get('hibDiagMode').then(v=>{const on=!!(v&&v.hibDiagMode===true);if(on!==hibOutlinesOn){hibOutlinesOn=on;if(!on)inspectMode=false;paintOutline();}}).catch(()=>{});});}catch(_){}
 function paintOutline(){ensureOverlay();
 /* RC499: the card the pointer is on always gets a dashed cyan outline, so a card can be recognised before anything is marked on it. While picking / inspecting cards or with
  * Diagnostics mode on it is the full 4 px outline (plus the yellow thumbnail outline); otherwise it is a light 1 px dash that stays out of the way. */
 const full=hibOutlinesOn||!!picker||inspectMode;outline.style.border=full?'4px dashed #00dfff':'1px dashed #00dfff';
 if(!hovered||!outline.isConnected){outline.style.display='none';return;}positionOverlay(hovered.el,outline);
 if(!full){thumbnailOutline.style.display='none';return;}
 const thumb=paintedThumbnail();if(thumb)positionOverlay(thumb,thumbnailOutline);else thumbnailOutline.style.display='none';}
 function repositionAllOutlines(){paintOutline();for(const item of previewElements)positionOverlay(item.el,item.outline);if(picker&&pickTarget)pickUpdate();}
 function clearHover(){hovered=null;outline.style.display='none';thumbnailOutline.style.display='none';}
 function setHover(row){if(hovered?.el===row?.el)return;clearHover();if(!row)return;hovered=row;paintOutline();log('CARD_HOVER',{type:row.type,url:row.url,title:row.title});}
 // RC157 / POINTER_HIT_TEST: identify the *actual* card under the mouse,
 // even when a decorative site overlay is painted above its link.
 function cardAtPoint(x,y){const hit=document.elementsFromPoint(x,y);for(const el of hit){const row=relevant(el);if(row)return row;}const manual=inventory.find(r=>r.manual&&(()=>{const b=r.el.getBoundingClientRect();return b.width>12&&b.height>12&&x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom;})());if(manual)return manual;return inventory.find(r=>{const b=r.el.getBoundingClientRect();return b.width>12&&b.height>12&&x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom;})||null;}
 function onMove(e){if(picker)return;if(!enabled||inspectMode)return;const row=cardAtPoint(e.clientX,e.clientY)||relevant(e.target);setHover(row);if(row)paintOutline();}
 // RC157 / ELEMENT_INSPECTOR: capture the actual hit target, its ancestry,
 // nearby anchors and images, and explicit unmatched reasons in Copy Diagnostics.
 function describe(el){const r=el.getBoundingClientRect();return {tag:el.tagName?.toLowerCase(),id:el.id||'',classes:String(el.className||'').slice(0,220),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},pointerEvents:getComputedStyle(el).pointerEvents,position:getComputedStyle(el).position};}
 function onClick(e){if(picker)return;if(!enabled||e.button!==0)return;
  const row=cardAtPoint(e.clientX,e.clientY)||relevant(e.target);
  if(inspectMode){e.preventDefault();e.stopImmediatePropagation();const el=e.target,ancestry=[];
   for(let x=el,i=0;x&&i<9;x=x.parentElement,i++)ancestry.push(describe(x));
   const context=el.closest('article,li,.item,.post,.grid-item,.video-card,.video-item')||el.parentElement||el;
   const links=[...context.querySelectorAll('a[href]')].slice(0,15).map(a=>({href:a.href,title:(a.title||a.textContent||'').trim().slice(0,120)}));
   const images=[...context.querySelectorAll('img')].slice(0,12).map(a=>({src:a.currentSrc||a.src,alt:a.alt}));
   const candidate=postContainer(el),candidateRect=candidate?.getBoundingClientRect();
   const tests={postContainerFound:!!candidate,postLayoutEnabled:postFix,postHasDestination:!!(candidate&&urlOf(candidate)),
    matchedInventory:!!row,matchingFamilies:families.filter(f=>el.closest(f.selector)).map(f=>f.type),
    candidateSizeOk:!!(candidateRect&&candidateRect.width>=35&&candidateRect.height>=35)};
   const reason=row?'MATCHED':candidate&&!postFix?'Post container found; post-fix not enabled':
    candidate&&!urlOf(candidate)?'Post container has no usable destination':candidate?'Candidate excluded from inventory':'No recognized card boundary at click coordinates';
   lastSelected={type:row?.type||'UNMATCHED ELEMENT',url:row?.url||urlOf(candidate||context)||'',title:row?.title||titleOf(candidate||context),reason,
    target:describe(el),ancestry,links,images,selectorTests:tests,postCandidate:candidate?describe(candidate):null,
    elementHTML:el.outerHTML.slice(0,2200),candidateHTML:candidate?.outerHTML.slice(0,3500)||null,
    point:{x:e.clientX,y:e.clientY},at:new Date().toISOString()};
   log('ELEMENT_INSPECTED',lastSelected);return;
  }
  if(!row)return;lastSelected={type:row.type,url:row.url,title:row.title,at:new Date().toISOString()};log('CARD_SELECTED',lastSelected);
 }
 // RC164: Intercept the entire primary activation sequence at window capture.
 // Clicking cards in training mode must NEVER activate page links or page JS handlers.
 // The picker controls are exempt so Save, Cancel, Up/Down, Preview still function.
 const pickerGuardTypes=['pointerdown','mousedown','pointerup','mouseup','click','auxclick','touchstart','touchend'];
 let pickerGuardsInstalled=false;
 function pickerInputGuard(e){
  if(!picker)return;
  const target=e.target;
  if(target instanceof Element && (target===picker||picker.contains(target)||!!target.closest('#hib-rc184-picker')))return;
  if(e.composedPath?.().includes(picker))return;
  if('button' in e && e.button!==0)return;
  if('isPrimary' in e && e.isPrimary===false)return;
  if(e.cancelable)e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  if(e.type==='click' && target instanceof Element){chooseElement(target);}
 }
 function installPickerInputGuards(){
  if(pickerGuardsInstalled)return;
  pickerGuardsInstalled=true;
  for(const type of pickerGuardTypes)window.addEventListener(type,pickerInputGuard,{capture:true,passive:false});
 }
 function removePickerInputGuards(){
  if(!pickerGuardsInstalled)return;
  pickerGuardsInstalled=false;
  for(const type of pickerGuardTypes)window.removeEventListener(type,pickerInputGuard,true);
 }
 // ================== CARD PICKER START — RC186 ==================
 // Single toolbar entry; staged thumbnail -> Next -> whole card -> Save Card.
 // All rules are kept in memory until Finish & Save Site. No player modifications.
 let stagedRules=[],pickMode='idle',skippedCandidates=new WeakSet(),suggestedCandidate=null,replaceExisting=false;
 const pickOutline=document.createElement('div');pickOutline.id='hib-rc184-selection-outline';
 Object.assign(pickOutline.style,{position:'absolute',pointerEvents:'none',display:'none',border:'4px dashed #00dfff',boxSizing:'border-box'});
   /* ===== END 1A — PHYSICAL CARD SCANNING / DEDUPLICATION ===== */
  /* ===== START 1B — CARD PICKER / USER CARD RULES ===== */
function pickerHidePreview(){pickPreviewOk=false;for(const item of previewElements)item.outline.remove();previewElements=[];pickMatches=[];}
 function pickerClose(){pickSavedReadOnly=false;pickMode='idle';pickStage=0;pickThumbSelector=null;pickThumbElement=null;pickerShield?.remove();pickerShield=null;removePickerInputGuards();pickerHidePreview();pickOutline.style.display='none';picker?.remove();picker=null;pickTarget=null;pickerHoverTarget=null;pickMatches=[];pickCandidate=null;pickLevel=0;stagedRules=[];suggestedCandidate=null;skippedCandidates=new WeakSet();replaceExisting=false;}
 function pickerAncestors(){const arr=[];for(let el=pickTarget;el&&el!==document.body&&arr.length<16;el=el.parentElement)arr.push(el);return arr;}
 // RC199: the automatic inventory already resolves card boundaries. Prefer that
 // exact boundary, but reject a multi-card ancestor (grid/track/section).
 function pickerCardLimit(){
  if(!pickThumbElement)return -1;
  const ancestors=pickerAncestors();
  const resolved=inventory.filter(row=>!row.manual&&row.el.contains(pickThumbElement))
   .sort((a,b)=>a.el.getBoundingClientRect().width*a.el.getBoundingClientRect().height-b.el.getBoundingClientRect().width*b.el.getBoundingClientRect().height)[0];
  if(resolved){const index=ancestors.indexOf(resolved.el);if(index>=0&&!pickerMultiCard(resolved.el))return index;}
  const possible=ancestors.findIndex((el,i)=>i>0&&pickerMultiCard(el));
  return possible>0?possible-1:ancestors.length-1;
 }
 function pickerMultiCard(el){
  if(!el)return false;
  const links=[...el.querySelectorAll('a[href]')].filter(a=>a.querySelector('img,video,picture')||a.matches('.clip-link,.video-link'));
  const distinct=new Set(links.map(a=>{try{return new URL(a.href,location.href).pathname;}catch(_){return a.href;}}));
  const thumbs=[...el.querySelectorAll('img')].filter(img=>{const r=img.getBoundingClientRect();return r.width>=45&&r.height>=40;});
  return distinct.size>=2&&thumbs.length>=2;
 }
 function pickerAllowedLevel(){const limit=pickerCardLimit();return limit<0?0:limit;}
 /* RC425: Up/Down may use EVERY ancestor of the picked thumbnail (up to 16). pickerAllowedLevel() (the automatic card boundary, RC199) is now only a
  * SUGGESTION for the starting level (pickerAutoLevel): as a hard cap it stopped Up early on sites such as HentaiHaven whose card boundary is
  * higher than the detected one. Saving still refuses a selection that contains several cards (saveCard -> pickerMultiCard). */
 function pickerMaxLevel(){return Math.max(0,pickerAncestors().length-1);}
 /* RC425: the layer the user already chose for this kind of card: the saved or staged rule whose thumbnail selector matches the picked thumbnail
  * -> the lowest ancestor that matches that rule's card selector. Null when no rule applies. */
 function pickerSavedLevel(){
  if(!pickThumbElement)return null;
  const anc=pickerAncestors();
  for(const r of [...stagedRules,...learnedRules]){
   try{if(!(pickThumbElement.matches(r.thumbnailSelector)||pickThumbElement.closest(r.thumbnailSelector)))continue;}catch(_){continue;}
   for(let i=0;i<anc.length;i++){try{if(anc[i].matches(r.selector))return i;}catch(_){}}
  }
  return null;
 }
 function pickerAutoLevel(){
  const ancestors=pickerAncestors();
  const rows=inventory.filter(row=>!row.manual&&row.el.contains(pickThumbElement)&&!pickerMultiCard(row.el));
  rows.sort((a,b)=>a.el.getBoundingClientRect().width*a.el.getBoundingClientRect().height-b.el.getBoundingClientRect().width*b.el.getBoundingClientRect().height);
  const index=rows.length?ancestors.indexOf(rows[0].el):-1;
  if(index>=0)return index;
  const limit=pickerAllowedLevel();
  for(let i=limit;i>=0;i--){const el=ancestors[i];if(el&&el.querySelector('a[href],h2,h3,h4,.title,.data')&&!pickerMultiCard(el))return i;}
  return Math.min(1,limit);
 }
 function pickerSelector(el){if(!el)return '';
  const tag=el.tagName.toLowerCase(),classes=[...el.classList].filter(x=>x&&x.length<120&&!/^(hover:|focus:|active:)/.test(x));
  const own=tag+classes.map(x=>'.'+CSS.escape(x)).join('');const parent=el.parentElement;
  const candidates=[own];if(parent){const pc=[...parent.classList].filter(x=>x&&x.length<120);const scope=parent.id?'#'+CSS.escape(parent.id):parent.tagName.toLowerCase()+pc.map(x=>'.'+CSS.escape(x)).join('');candidates.unshift(scope+' > '+own);}
  for(const candidate of candidates){try{if(document.querySelectorAll(candidate).length>=2)return candidate;}catch(_){}}
  for(const candidate of candidates.slice().reverse()){try{if(document.querySelectorAll(candidate).length)return candidate;}catch(_){}}return own;
 }
 /* RC426  CARD SELECTOR CHOICE (HentaiHaven: only 2 of 20 cards matched the chosen layer).
  * pickerSelector() returns the FIRST candidate that matches 2 or more elements. For the card layer that was "<parent classes> > <own classes>",
  * and the parent's classes include responsive utility variants (order-1 @min-[520px]:order-1 ...) that only the first two cards' parents carry,
  * so 2 matches were "enough" and the other 18 cards were silently left out. For the CARD step every candidate is now scored against the
  * thumbnail selector instead: an element is a good card when it contains exactly ONE thumbnail (or is the thumbnail), an element with none or
  * several is a miss. The candidate with the best score wins (the most specific one on a tie); utility-variant classes (names with : [ ] @) are
  * also tried in a "stable" form without them. The selected element itself must match the winner. */
 function pickerCardCandidates(el){
  const tag=el.tagName.toLowerCase(),parent=el.parentElement,out=[];
  const cls=(node,stable)=>[...node.classList].filter(x=>x&&x.length<120&&!/^(hover:|focus:|active:)/.test(x)&&(!stable||!/[:\[\]@]/.test(x))).map(x=>'.'+CSS.escape(x)).join('');
  const scope=stable=>parent?(parent.id?'#'+CSS.escape(parent.id):parent.tagName.toLowerCase()+cls(parent,stable)):'';
  for(const stable of [false,true]){
   const own=tag+cls(el,stable);
   if(parent)out.push(scope(stable)+' > '+own);
   out.push(own);
  }
  if(parent)out.push(scope(true)+' > '+tag);
  return [...new Set(out)];
 }
 function pickerBestCardSelector(el){
  const thumb=pickThumbSelector;if(!el||!thumb)return pickerSelector(el);
  let best=null,bestScore=-Infinity;
  for(const sel of pickerCardCandidates(el)){
   let els;try{if(!el.matches(sel))continue;els=[...document.querySelectorAll(sel)];}catch(_){continue;}
   let valid=0,bad=0;
   for(const e of els){let n=0;try{n=(e.matches(thumb)?1:0)+e.querySelectorAll(thumb).length;}catch(_){}if(n===1)valid++;else bad++;}
   const score=valid-2*bad;
   if(valid>=1&&score>bestScore){best=sel;bestScore=score;}
  }
  return best||pickerSelector(el);
 }
 function pickerMessage(message){const n=picker?.querySelector('#hibpick-instructions');if(n)n.textContent=message;}
 function pickerButtons(){if(!picker)return;const show=(act,visible)=>{const b=picker.querySelector('[data-act="'+act+'"]');if(b)b.style.display=visible?'inline-block':'none';};
  show('next',pickMode==='thumbnail'&&!!pickThumbElement);show('back',pickMode==='card');show('save-card',pickMode==='card');
  show('add-type',pickMode==='review'||pickMode==='thumbnail');const changed=(!!picker.querySelector('#hibpick-dedupe')?.checked!==pickerDedupeOriginal)||(!!picker.querySelector('#hibpick-video-block')?.checked!==pickerVideoOriginal);show('finish',(pickMode==='review'&&(stagedRules.length>0||replaceExisting||changed))||(pickMode==='thumbnail'&&(stagedRules.length>0||changed)));show('skip',pickMode==='thumbnail'&&stagedRules.length>0);
  show('up',pickMode==='card');show('down',pickMode==='card');show('preview',pickMode==='review'||pickMode==='card'||pickMode==='thumbnail');
 }
 function pickUpdate(){if(!picker||!pickTarget)return;pickLevel=Math.min(pickLevel,pickerMaxLevel());const el=pickerAncestors()[pickLevel];if(!el)return;positionOverlay(el,pickOutline);pickCandidate=pickMode==='card'&&pickThumbSelector?pickerBestCardSelector(el):pickerSelector(el);picker.querySelector('#hibpick-selector').textContent=pickCandidate;picker.querySelector('#hibpick-level').textContent='Selection '+(pickLevel+1)+' / '+pickerAncestors().length+' — '+el.tagName.toLowerCase();}
 function chooseElement(el){if(!(el instanceof Element)||el.closest('#hib-rc184-picker,#hib-rc163-overlay-layer,#hib-rc184-shield'))return;
  if(pickMode!=='thumbnail'){picker.querySelector('#hibpick-count').textContent='Use Next before adjusting the full-card boundary.';return;}
  pickSavedReadOnly=false;pickThumbElement=el;pickThumbSelector=pickerSelector(el);pickTarget=el;pickerHoverTarget=el;pickLevel=0;pickStage=1;pickerHidePreview();pickUpdate();
  pickerMessage('Thumbnail selected. Click Next to select the full card, then use Up/Down if needed.');picker.querySelector('#hibpick-count').textContent='Thumbnail selected: '+pickThumbSelector;pickerButtons();
 }
 function pickerUnderlying(x,y){if(!pickerShield)return null;const oldShield=pickerShield.style.pointerEvents,oldOverlay=overlayLayer.style.pointerEvents;pickerShield.style.pointerEvents='none';overlayLayer.style.pointerEvents='none';let hit=null;
  try{hit=document.elementsFromPoint(x,y).find(el=>el instanceof Element&&!el.closest('#hib-rc184-picker,#hib-rc163-overlay-layer,#hib-rc184-shield')&&el!==document.body&&el!==document.documentElement)||null;}
  finally{pickerShield.style.pointerEvents=oldShield;overlayLayer.style.pointerEvents=oldOverlay;}return hit;
 }
 function pickerTrack(e){if(!picker)return;const el=pickerUnderlying(e.clientX,e.clientY);if(!el)return;pickerHoverTarget=el;if(!pickTarget&&pickMode==='thumbnail')positionOverlay(el,pickOutline);}
 function pairsFor(rule){let cards=[],thumbs=[];
  try{cards=[...document.querySelectorAll(rule.selector)].filter(card=>card.matches(rule.thumbnailSelector)||!!card.querySelector(rule.thumbnailSelector));
   thumbs=[...document.querySelectorAll(rule.thumbnailSelector)].filter(el=>cards.some(card=>card===el||card.contains(el)));}catch(_){}
  return {cards,thumbs};
 }
 function previewPicker(){if(!picker)return;pickerHidePreview();const rules=(pickMode==='review'||pickMode==='thumbnail')?stagedRules:pickMode==='card'?[{selector:pickCandidate,thumbnailSelector:pickThumbSelector}]:[];
  // RC235: Automatic-only preview is valid; continue to inventory overlay rendering even with no staged rules.
  let nc=0,nt=0;for(const rule of rules){if(!rule.selector||!rule.thumbnailSelector)continue;const {cards,thumbs}=pairsFor(rule);nc+=cards.length;nt+=thumbs.length;
   for(const [items,color,width] of [[cards,'#00dfff',4],[thumbs,'#ffd42a',4]])for(const el of items.slice(0,PREVIEW_LIMIT)){
    const o=document.createElement('div');o.dataset.hibRc184Preview='1';Object.assign(o.style,{position:'absolute',pointerEvents:'none',boxSizing:'border-box',border:width+'px dashed '+color});
    overlayLayer.appendChild(o);previewElements.push({el,outline:o});positionOverlay(el,o);
   }
  }
  if(pickMode==='review'||pickMode==='thumbnail'){
   for(const row of inventory.filter(r=>!r.manual).slice(0,PREVIEW_LIMIT)){
    if(!row.el?.isConnected||pickerMultiCard(row.el))continue;
    const o=document.createElement('div');o.dataset.hibRc184Preview='1';Object.assign(o.style,{position:'absolute',pointerEvents:'none',boxSizing:'border-box',border:'4px dashed #00dfff'});
    overlayLayer.appendChild(o);previewElements.push({el:row.el,outline:o});positionOverlay(row.el,o);nc++;
    const img=row.el.querySelector('img');if(img){const i=document.createElement('div');i.dataset.hibRc184Preview='1';Object.assign(i.style,{position:'absolute',pointerEvents:'none',boxSizing:'border-box',border:'4px dashed #ffd42a'});overlayLayer.appendChild(i);previewElements.push({el:img,outline:i});positionOverlay(img,i);nt++;}
   }
  }
  if(nc&&nt){pickPreviewOk=true;pickerMessage(pickMode==='review'||pickMode==='thumbnail'?'Final Preview: automatic and staged thumbnail (yellow) and card (cyan) boundaries are displayed. No changes are saved until Finish & Save Site.':'Preview is optional. If the yellow thumbnails and cyan cards look right, select Save Card.');}
  picker.querySelector('#hibpick-count').textContent='Preview: '+nt+' thumbnails (yellow), '+nc+' cards (cyan).';
 }
 function nextPicker(){if(pickMode!=='thumbnail'||!pickThumbElement)return;pickMode='card';pickStage=2;
  // RC433: Next KEEPS the layer you are on (selecting a thumbnail puts you on layer 1). It never jumps to an "automatic" or remembered layer: the
  // user presses Up from the thumbnail to the card boundary. (Earlier versions jumped to the auto-detected card, a remembered level or a saved rule's
  // level, which could land on layer 15 and forced pressing Down many times.)
  pickLevel=Math.min(Math.max(0,pickLevel),pickerMaxLevel());pickUpdate();
  pickerMessage('Stage 2: Use Up until the outline fits one complete card (you start on the thumbnail layer). If the thumbnail is the entire card, leave it unchanged. Preview is optional; click Save Card.');pickerButtons();
 }
 function suggestNextType(){scan();const covered=el=>stagedRules.some(rule=>{try{return !!el.closest(rule.selector)||el.matches(rule.selector)||!!el.querySelector(rule.selector);}catch(_){return false;}});
  const candidates=inventory.map(row=>row.el).filter(el=>el.isConnected&&!covered(el)&&!skippedCandidates.has(el)&&el.getBoundingClientRect().width>=40&&el.getBoundingClientRect().height>=40);
  const example=candidates.find(el=>{const ss=pickerSelector(el);try{return document.querySelectorAll(ss).length>=2;}catch(_){return false;}})||candidates[0];
  suggestedCandidate=example||null;pickMode='thumbnail';pickStage=1;pickTarget=null;pickThumbElement=null;pickThumbSelector=null;pickCandidate=null;pickLevel=0;pickOutline.style.display='none';pickerHidePreview();
  if(example){positionOverlay(example,pickOutline);pickerMessage('Another possible card layout is highlighted. Click its thumbnail, then Next. You can Skip This Type or Finish & Save Site.');picker.querySelector('#hibpick-count').textContent='Staged card types: '+stagedRules.length+'. Candidate found; confirm it is a different layout.';}
  else{pickerMessage('No unconfigured card type was suggested automatically. Click the thumbnail of any missing card to teach HIB another layout, then click Next. Existing saved types are preserved.');picker.querySelector('#hibpick-count').textContent='Staged card types: '+stagedRules.length+'. Manual selection is available.';}
  pickerButtons();
 }
 function addCardType(){pickSavedReadOnly=false;pickerHidePreview();suggestNextType();picker.querySelector('#hibpick-level').textContent='Add card type — Select thumbnail';}
 function saveCard(){if(pickMode!=='card'||!pickTarget||!pickThumbSelector)return;const full=pickerAncestors()[pickLevel];if(!full?.contains(pickThumbElement))return;
  if(pickerMultiCard(full)){picker.querySelector('#hibpick-count').textContent='Refusing multi-video carousel/grid selection. Select one individual card.';return;}
  const rule={selector:pickCandidate,thumbnailSelector:pickThumbSelector,type:'Learned cards',created:new Date().toISOString()};
  const matched=pairsFor(rule);if(!matched.cards.length||!matched.thumbs.length){picker.querySelector('#hibpick-count').textContent='No matching thumbnail/full card pairs found. Adjust the selection.';return;}
  // Same DOM element for both selectors is explicitly valid (two selectors on one card element).
  stagedRules=stagedRules.filter(r=>r.selector!==rule.selector);stagedRules.push(rule);
  pickerRememberedCardLevel=pickLevel;   // RC425: the next card type starts on the layer that was just saved (not only after Up/Down)
  log('PICKER_RULE_STAGED',{selector:rule.selector,thumbnailSelector:rule.thumbnailSelector,cards:matched.cards.length});suggestNextType();
 }
 async function saveSite(){const dedupeChoice=!!picker.querySelector('#hibpick-dedupe')?.checked;const dedupeChanged=dedupeChoice!==pickerDedupeOriginal;const videoChoice=!!picker.querySelector('#hibpick-video-block')?.checked;const videoChanged=videoChoice!==pickerVideoOriginal;if(!stagedRules.length&&!replaceExisting&&!dedupeChanged&&!videoChanged){picker.querySelector('#hibpick-count').textContent='No changes to save.';return;}
  if(!stagedRules.length&&replaceExisting&&!confirm('Save zero manual card rules for this site? Automatic detection will remain active.'))return;
  const data=await browser.storage.local.get([LEARN_KEY,DEDUPE_KEY,VIDEO_BLOCK_KEY,'hibRc184IrReminder']);const all={...(data[LEARN_KEY]||{})};
  all[host]=replaceExisting?stagedRules:[...((Array.isArray(all[host])?all[host]:[]).filter(x=>!stagedRules.some(y=>x.selector===y.selector))),...stagedRules];const reminders={...(data.hibRc184IrReminder||{})};const first=!reminders[host];reminders[host]=true;
  const siteSettings={...(data[DEDUPE_KEY]||{}),[host]:dedupeChoice};const videoSettings={...(data[VIDEO_BLOCK_KEY]||{}),[host]:videoChoice};await browser.storage.local.set({[LEARN_KEY]:all,[DEDUPE_KEY]:siteSettings,[VIDEO_BLOCK_KEY]:videoSettings,hibRc184IrReminder:reminders});siteDedupe=dedupeChoice;siteVideoBlock=videoChoice;log('PICKER_SITE_SAVED',{host,types:stagedRules.length,blockDuplicates:dedupeChoice,blockGalleryVideo:videoChoice});await loadLearned();pickerClose();
  if(first)alert('Imagus Reborn may conflict with HIB on this website. Click the Imagus Reborn toolbar icon once to disable it for this site. HIB handles previews and videos here.');
 }
 let lastSiteReset=null;
 async function clearSiteSettings(){
  log('SITE_CARD_CLEAR_CLICK_RECEIVED',{host});
  const approved=await new Promise(resolve=>{
   if(!picker?.isConnected){resolve(false);return;}
   picker.querySelector('#hib-reset-confirm')?.remove();
   const confirmBox=document.createElement('div');confirmBox.id='hib-reset-confirm';
   Object.assign(confirmBox.style,{display:'block',padding:'10px',margin:'10px 0',background:'#253449',border:'1px solid #f5c66a',borderRadius:'5px'});
   const message=document.createElement('div');
   message.textContent='Clear ALL saved cards and card settings for '+host+'? This includes protected learned/manual rules and post-fix. Fresh automatic detection will run afterward.';
   const yes=document.createElement('button');yes.type='button';yes.textContent='Confirm Clear All';yes.style.cssText='background:#874044;color:white;padding:8px;margin:6px;cursor:pointer';
   const no=document.createElement('button');no.type='button';no.textContent='Cancel Reset';no.style.cssText='background:#34455d;color:white;padding:8px;margin:6px;cursor:pointer';
   const finish=value=>{confirmBox.remove();resolve(value);};
   yes.addEventListener('click',e=>{e.stopPropagation();finish(true)});
   no.addEventListener('click',e=>{e.stopPropagation();finish(false)});
   confirmBox.append(message,yes,no);picker.appendChild(confirmBox);
   pickerMessage('RESET REQUESTED — choose Confirm Clear All or Cancel Reset.');
  });
  if(!approved){log('SITE_CARD_RESET_CANCELLED',{host});return;}
  log('SITE_CARD_RESET_CONFIRMED',{host});
  const button=picker?.querySelector('[data-act="reset"]');if(button){button.disabled=true;button.textContent='Clearing…';button.style.backgroundColor='#172435';}
  try{
   const keys=[LEARN_KEY,DEDUPE_KEY,VIDEO_BLOCK_KEY,POST_LAYOUT_KEY,'hibRc184IrReminder'];
   const before=await browser.storage.local.get(keys),patch={};
   for(const key of keys){const entry={...(before[key]||{})};delete entry[host];delete entry['www.'+host];
    if(key===POST_LAYOUT_KEY)entry[host]='automatic';
    patch[key]=entry;
   }
   await browser.storage.local.set(patch);
   // Verify persistence: a successful promise alone does not prove the per-site state is clean.
   const after=await browser.storage.local.get(keys);
   const leftovers=keys.filter(key=>key!==POST_LAYOUT_KEY&&(
    Object.prototype.hasOwnProperty.call(after[key]||{},host)||
    Object.prototype.hasOwnProperty.call(after[key]||{},'www.'+host)));
   if(after[POST_LAYOUT_KEY]?.[host]!=='automatic'||leftovers.length)throw Error('Stored settings verification failed: '+leftovers.join(', '));
   // Apply to this tab AND await it, rather than assuming storage events ran already.
   await Promise.all([loadLearned(),loadPostFix()]);
   if(learnedRules.length!==0||siteDedupe!==null||siteVideoBlock!==false||postFix!==false)
    throw Error('Active detector still has rules/settings after reload');
   const oldInventoryCount=inventory.length;stagedRules=[];replaceExisting=false;clearHover();restoreHiddenDuplicates();inventory=[];previousCardKeys=null;lastInventorySignature='';pickerClose();scan();
   lastSiteReset={status:'PASS',host,at:new Date().toISOString(),previousInventoryCount:oldInventoryCount,rebuiltAutomaticCount:inventory.length,rules:learnedRules.length,postFix,siteDedupe,siteVideoBlock};
   log('SITE_CARD_SETTINGS_RESET_VERIFIED',lastSiteReset);
   alert('HIB site reset VERIFIED for '+host+'.\nSaved card rules cleared: YES\nPrevious detected inventory: '+oldInventoryCount+'\nFresh automatic inventory: '+inventory.length+'\nPost-fix: OFF (Automatic)\nGallery video block: OFF');
  }catch(err){
   lastSiteReset={status:'FAIL',host,at:new Date().toISOString(),error:String(err)};
   log('SITE_CARD_SETTINGS_RESET_FAILED',lastSiteReset);
   if(picker)pickerMessage('RESET NOT VERIFIED: '+String(err));
   alert('HIB reset FAILED verification for '+host+': '+String(err));
  }finally{if(button?.isConnected){button.disabled=false;button.textContent='Clear Site Settings';button.style.backgroundColor='#34455d';}}
 }

 function pickerLoadSaved(){stagedRules=learnedRules.map(r=>({...r}));if(!stagedRules.length)return false;
  pickMode='review';pickStage=3;pickSavedReadOnly=true;pickerMessage('Existing card settings loaded ('+stagedRules.length+' type(s)). Click Preview to inspect them, Find / Add Card Type to teach a missing layout, or Clear Site Settings to replace all rules.');
  picker.querySelector('#hibpick-level').textContent='Saved site configuration';picker.querySelector('#hibpick-count').textContent='Preview is read-only. Existing rules remain unchanged.';pickerButtons();return true;
 }
 function startPicker(){if(picker)return {ok:true};inspectMode=false;clearHover();picker=document.createElement('div');picker.id='hib-rc184-picker';
  Object.assign(picker.style,{all:'initial',display:'block',position:'fixed',right:'15px',bottom:'15px',width:'min(390px, calc(100vw - 30px))',maxHeight:'calc(100dvh - 30px)',overflowY:'auto',overflowX:'hidden',overscrollBehavior:'contain',boxSizing:'border-box',padding:'12px',background:'#152333',color:'#fff',border:'1px solid #46dbfe',borderRadius:'8px',zIndex:'2147483647',font:'13px/1.45 system-ui,sans-serif',boxShadow:'0 3px 25px #0009'});
  picker.innerHTML='<b>HIB RC237 — Site Card Settings</b><p id="hibpick-instructions">Click a thumbnail image to begin. Existing site rules load automatically.</p><div id="hibpick-level">Stage 1 / 2 — Thumbnail</div><code id="hibpick-selector" style="display:block;white-space:normal;word-break:break-all;margin:8px 0"></code><div id="hibpick-count"></div><label style="display:block;margin:8px 0"><input type="checkbox" id="hibpick-dedupe"> Block duplicate video links automatically (match by title, site-wide)</label><label style="display:block;margin:8px 0"><input type="checkbox" id="hibpick-video-block"> Block real video playback inside gallery thumbnails (site-wide)</label><button data-act="up">Up</button> <button data-act="down">Down</button> <button data-act="back">Back</button> <button data-act="next">Next</button> <button data-act="preview">Preview Detected Cards</button> <button data-act="add-type">Find / Add Card Type</button> <button data-act="save-card">Save Card</button> <button data-act="skip">Skip This Type</button> <button data-act="finish">Finish &amp; Save Site</button> <button data-act="cancel">Cancel</button> <button data-act="reset">Clear Site Settings</button>';
  // RC229: The host site's CSS must never reposition or overlap picker children.
  // Use a scoped stylesheet instead of trusting host b/p/label/button typography.
  const pickerCss=document.createElement('style');pickerCss.textContent=`
  #hib-rc184-picker, #hib-rc184-picker * {box-sizing:border-box !important;}
  #hib-rc184-picker > b {display:block !important;position:static !important;font:bold 15px/1.4 system-ui,sans-serif !important;margin:0 0 9px !important;white-space:normal !important;}
  #hib-rc184-picker > p,#hib-rc184-picker > div,#hib-rc184-picker > code,#hib-rc184-picker > label {display:block !important;position:static !important;float:none !important;clear:both !important;width:auto !important;height:auto !important;max-width:100% !important;}
  #hib-rc184-picker > p {font:13px/1.45 system-ui,sans-serif !important;margin:0 0 9px !important;padding:0 !important;color:#fff !important;}
  #hib-rc184-picker > div {font:13px/1.45 system-ui,sans-serif !important;margin:5px 0 !important;padding:0 !important;color:#fff !important;}
  #hib-rc184-picker > code {font:12px/1.4 monospace !important;overflow-wrap:anywhere !important;margin:6px 0 !important;color:#c8ecff !important;}
  #hib-rc184-picker > label {font:13px/1.45 system-ui,sans-serif !important;margin:8px 0 !important;padding:0 !important;color:#fff !important;}
  #hib-rc184-picker > button {position:static !important;float:none !important;display:inline-block;vertical-align:middle !important;width:auto !important;height:auto !important;max-width:100% !important;min-height:29px !important;line-height:1.4 !important;}
  `;picker.appendChild(pickerCss);
  // Keep selection navigation anchored to the user's chosen location in the panel.
  // Do not permit focusing a navigation button to scroll it back into view.
  // RC230: Never preventDefault on button pointerdown: it can suppress click activation.

  for(const btn of picker.querySelectorAll('button'))Object.assign(btn.style,{background:'#34455d',color:'#fff',border:'1px solid #8aa9c8',padding:'6px 9px',margin:'3px',borderRadius:'4px',cursor:'pointer',font:'bold 13px system-ui,sans-serif',transition:'background-color 80ms ease'});
  // RC228: Visible press acknowledgment; the visual state is not tied to storage success.
  // Pointer cancellation must never leave a button dark or interfere with clicks.
  function pressFeedback(e){const btn=e.target instanceof Element?e.target.closest('button[data-act]'):null;
   if(!btn||!picker?.contains(btn))return;
   if(e.type==='pointerdown'||e.type==='keydown'){
    if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;
    btn.style.backgroundColor='#172435';btn.dataset.hibPressed='1';
   }else if(btn.dataset.hibPressed){btn.style.backgroundColor='#34455d';delete btn.dataset.hibPressed;}
  }
  for(const ev of ['pointerdown','pointerup','pointercancel','pointerleave','keydown','keyup'])picker.addEventListener(ev,pressFeedback);
  picker.addEventListener('click',e=>{
   const btn=e.target instanceof Element?e.target.closest('button[data-act]'):null;
   if(btn&&picker.contains(btn)){btn.style.backgroundColor='#172435';
    setTimeout(()=>{if(btn.isConnected&&!btn.disabled){btn.style.backgroundColor='#34455d';delete btn.dataset.hibPressed;}},140);}
  },true);
  picker.addEventListener('click',e=>{const target=e.target instanceof Element?e.target.closest('button[data-act]'):null;const a=target?.dataset?.act;if(!a||!picker.contains(target))return;e.stopPropagation();const preservedScroll=picker.scrollTop;const preservePosition=['up','down','next','back','preview','add-type'].includes(a);try{if(a==='cancel')pickerClose();else if(a==='next')nextPicker();else if(a==='back'&&pickMode==='card'){pickMode='thumbnail';pickStage=1;pickerHidePreview();pickerMessage('Change your thumbnail selection or click Next to use the current one.');pickerButtons();}
   else if(a==='up'&&pickMode==='card'){pickLevel=Math.min(pickLevel+1,pickerMaxLevel());if(!pickerMultiCard(pickerAncestors()[pickLevel]))pickerRememberedCardLevel=pickLevel;pickerHidePreview();pickUpdate();}
   else if(a==='down'&&pickMode==='card'){pickLevel=Math.max(0,pickLevel-1);pickerRememberedCardLevel=pickLevel;pickerHidePreview();pickUpdate();}
   else if(a==='preview')previewPicker();else if(a==='add-type')addCardType();else if(a==='save-card')saveCard();else if(a==='skip'){if(suggestedCandidate)skippedCandidates.add(suggestedCandidate);suggestNextType();}
   else if(a==='finish')saveSite().catch(x=>picker.querySelector('#hibpick-count').textContent='Save failed: '+String(x));
   else if(a==='reset')clearSiteSettings().catch(x=>picker.querySelector('#hibpick-count').textContent='Reset failed: '+String(x));}finally{if(preservePosition&&picker?.isConnected){picker.scrollTop=preservedScroll;requestAnimationFrame(()=>{if(picker?.isConnected)picker.scrollTop=preservedScroll;});}}});
  const videoToggle=picker.querySelector('#hibpick-video-block');pickerVideoOriginal=siteVideoBlock;videoToggle.checked=pickerVideoOriginal;videoToggle.addEventListener('change',()=>{pickerMessage('Gallery video blocking is site-wide; click Finish & Save Site. No manual card selection needed.');pickerButtons();});const toggle=picker.querySelector('#hibpick-dedupe');pickerDedupeOriginal=siteDedupe===null?learnedRules.some(r=>r.blockDuplicates===true):siteDedupe;toggle.checked=pickerDedupeOriginal;toggle.addEventListener('change',()=>{pickerMessage('Duplicate blocking is a site-wide setting. Click Finish & Save Site; no manual card selection is required.');pickerButtons();});
  pickerShield=document.createElement('div');pickerShield.id='hib-rc184-shield';Object.assign(pickerShield.style,{position:'fixed',inset:'0',zIndex:'2147483646',background:'transparent',cursor:'crosshair',touchAction:'none',pointerEvents:'auto'});
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','auxclick','dblclick','contextmenu','touchstart','touchend'])pickerShield.addEventListener(type,e=>{if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();if(type==='click'&&(!('button'in e)||e.button===0)){const el=pickerUnderlying(e.clientX,e.clientY)||pickerHoverTarget;if(el)chooseElement(el);else picker.querySelector('#hibpick-count').textContent='No webpage element at that point';}},{capture:true,passive:false});
  pickerShield.addEventListener('pointermove',pickerTrack,{passive:true});pickerShield.addEventListener('pointerover',pickerTrack,{passive:true});
  document.documentElement.appendChild(pickerShield);document.documentElement.appendChild(picker);overlayLayer.appendChild(pickOutline);
  if(!pickerLoadSaved()){pickMode='thumbnail';pickStage=1;pickerMessage('Click Preview Detected Cards to inspect automatic cyan card and yellow thumbnail outlines (read-only). Use Find / Add Card Type for missing layouts. Settings are saved only with Finish & Save Site.');picker.querySelector('#hibpick-level').textContent='Stage 1 / 2 — Thumbnail';picker.querySelector('#hibpick-count').textContent='No manual rules saved. Preview is available for all automatically detected cards.';pickerButtons();}return {ok:true};
 }
 // ================== CARD PICKER END — RC186 ====================
   /* ===== END 1B — CARD PICKER / USER CARD RULES ===== */
  /* ===== START 1C — SITE RULES / STORAGE HANDOFF ===== */
async function loadLearned(){try{const v=await browser.storage.local.get([LEARN_KEY,DEDUPE_KEY,VIDEO_BLOCK_KEY]);siteVideoBlock=v[VIDEO_BLOCK_KEY]?.[host]===true;learnedRules=Array.isArray(v[LEARN_KEY]?.[host])?v[LEARN_KEY][host]:[];siteDedupe=typeof v[DEDUPE_KEY]?.[host]==='boolean'?v[DEDUPE_KEY][host]:null;scan();}catch(e){log('LEARNED_LOAD_ERROR',String(e));}}
 async function loadPostFix(){try{const value=await browser.storage.local.get(POST_LAYOUT_KEY);const stored=value[POST_LAYOUT_KEY]||{};const configured=Object.prototype.hasOwnProperty.call(stored,host);postFix=configured?stored[host]==='post-fix':document.querySelectorAll('[id^="post-"],.post').length>=6;scan();log('CARD_LAYOUT',{layout:postFix?'post-fix':'automatic',host,configured});}catch(e){log('LAYOUT_ERROR',String(e));}}
 /* ========================================================================
 * RC239.1 CRITICAL SAFETY FIX — CROSS-SITE POINTER EVENT ISOLATION.
 * DO NOT REMOVE OR WEAKEN THE enabled GATE.
 * RC239 called releaseDecorativeOverlays() on every website. That function
 * forcibly applies pointer-events:none !important to matching page nodes;
 * on unrelated sites (including chatgpt.com), those nodes can be essential
 * interactive menu backdrops. This gate MUST precede the DOM mutation.
 * The registration/activation state is authoritative; merely loading a
 * content script does NOT authorize page input/style modifications.
 * Protected CPCR card classification/deduplication is unchanged.
 * ======================================================================== */
   /* ===== END 1C — SITE RULES / STORAGE HANDOFF ===== */
  /* ===== START 1D — DOM UPDATES / ACTIVATION / INVENTORY ===== */
function scheduleScan(){if(!enabled)return;if(refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;if(!enabled)return;scan();releaseDecorativeOverlays();},350);}
 async function refreshGate(){try{const value=await browser.runtime.sendMessage({type:'hib-rc153-read-activation',host});const next=!!value.effectiveVideoEnabled;
  if(next!==enabled){enabled=next;clearHover();log('SCANNER_ACTIVATION',{enabled,source:value.activationSource});}
  gate=value;if(enabled)scheduleScan();else{clearTimeout(refreshTimer);refreshTimer=null;inventory=[];lastInventorySignature='';}
 }catch(e){log('ACTIVATION_ERROR',String(e));}}
 function captureInfo(){const root=document.documentElement;const h=Math.max(root.scrollHeight,document.body?.scrollHeight||0),w=Math.max(root.scrollWidth,document.body?.scrollWidth||0);
  const groups=new Map();for(const r of inventory){const section=sectionOf(r.el);groups.set(section,(groups.get(section)||0)+1);}
  return {imageQualityTraces:[...(window.__HIB_IMAGE_QUALITY_TRACES__||[])],document:{width:w,height:h,viewportWidth:innerWidth,viewportHeight:innerHeight,scrollX,scrollY,devicePixelRatio:devicePixelRatio||1},sections:[...groups].map(([name,count])=>({name,count})),changes:changeHistory,
   cards:inventory.map((r,i)=>{const b=r.el.getBoundingClientRect();return {index:i+1,type:r.type,title:r.title,url:r.url,section:sectionOf(r.el),domId:domId(r.el),rect:{x:Math.round(b.left+scrollX),y:Math.round(b.top+scrollY),width:Math.round(b.width),height:Math.round(b.height)}};})};}
function snapshot(){const counts={};for(const fam of families)counts[fam.type]=inventory.filter(r=>r.type===fam.type).length;if(postFix)counts['Post cards (other)']=inventory.filter(r=>r.type==='Post cards (other)').length;counts['Learned cards']=inventory.filter(r=>r.type==='Learned cards').length;counts['Auto detected']=inventory.filter(r=>!r.manual).length;counts['Manual detected']=inventory.filter(r=>!!r.manual).length;counts['Total unique cards']=inventory.length;
  return {imageQualityTraces:[...(window.__HIB_IMAGE_QUALITY_TRACES__||[])],alive:true,version:'RC227',lastSiteReset,host,postFix,postCandidates:document.querySelectorAll('[id^="post-"],.post').length,url:location.href,enabled,gate,counts,total:inventory.length,hovered:hovered?{type:hovered.type,url:hovered.url,title:hovered.title}:null,lastSelected,serial,events:[...events],cards:inventory.map(r=>({type:r.type,url:r.url,title:r.title,visible:r.visible}))};}
 browser.runtime.onMessage.addListener(msg=>{
  if(msg?.type==='hib-rc186-start-picker')return Promise.resolve(startPicker());
  if(msg?.type==='hib-rc186-cancel-picker'){pickerClose();return Promise.resolve({ok:true});}
  if(msg?.type==='hib-rc155-card-snapshot'){scan();return Promise.resolve(snapshot());}
  if(msg?.type==='hib-rc160-capture-info'){scan();return Promise.resolve(captureInfo());}
  if(msg?.type==='hib-rc160-scroll-tile'){window.scrollTo({left:0,top:Math.max(0,Number(msg.y)||0),behavior:'instant'});return Promise.resolve({x:scrollX,y:scrollY,viewportHeight:innerHeight});}
  if(msg?.type==='hib-rc160-restore-scroll'){window.scrollTo({left:Number(msg.x)||0,top:Number(msg.y)||0,behavior:'instant'});return Promise.resolve({ok:true});}
  if(msg?.type==='hib-rc156-inspect-mode'){inspectMode=!!msg.enabled;clearHover();log('INSPECT_MODE',{enabled:inspectMode});return Promise.resolve({ok:true,inspectMode});}
  if(msg?.type==='hib-rc155-clear-card-events'){events=[];serial++;return Promise.resolve({ok:true});}
 });
 // RC202 — Site-wide suppression of genuine video playback in gallery-card thumbnails.
 // Real playback surfaces and HIB's separate player are never paused by this code.
   /* ===== END 1D — DOM UPDATES / ACTIVATION / INVENTORY ===== */
  /* ===== START 1E — VIDEO CARD CLASSIFICATION / OVERLAY GUARDS ===== */
function galleryVideoCard(video){
  if(!enabled||!siteVideoBlock||picker||!(video instanceof HTMLVideoElement))return null;
  const card=relevant(video);if(!card?.el?.contains(video)||!/^https?:/.test(card.url||''))return null;
  if(video.controls||video.closest('[controls],.jwplayer,.flowplayer,.freedomplayer,.fp-player,.plyr,.video-js,.dplayer,.art-video-player,.xgplayer,[data-player-id]'))return null;
  const r=video.getBoundingClientRect(),cr=card.el.getBoundingClientRect();
  if(r.width<45||r.height<35||!cr.width||!cr.height)return null;
  const vw=innerWidth||document.documentElement.clientWidth,vh=innerHeight||document.documentElement.clientHeight;
  if(r.width>vw*.72&&r.height>vh*.40)return null;
  // Reject media elements that clearly live in a player rather than a gallery tile.
  if(video.closest('.video-player,.responsive-player,[id*="video-player"],.player-container,.player-wrapper'))return null;
  if(card.el.querySelectorAll('video').length>2)return null;
  const target=card.el.querySelector('a[href]');
  if(!target||!/^https?:/.test(target.href)||target.href===location.href)return null;
  return card;
 }
 let lastSuppressed=null;
 function suppressGalleryVideo(video){
  const card=galleryVideoCard(video);if(!card)return false;
  if(!video.paused){video.pause();if(lastSuppressed!==video){lastSuppressed=video;log('GALLERY_VIDEO_PAUSED',{url:card.url,title:card.title});}}
  return true;
 }
 // The capture-phase play event catches autoplay, including restarts by hover scripts.
 document.addEventListener('play',e=>{if(e.target instanceof HTMLVideoElement)suppressGalleryVideo(e.target);},true);
 document.addEventListener('pointerover',e=>{const video=e.target?.closest?.('video');if(video)suppressGalleryVideo(video);},true);
 // Some players restart without new pointer events; only revisit eligible videos.
 setInterval(()=>{if(!enabled||!siteVideoBlock||document.hidden||picker)return;
  for(const video of document.querySelectorAll('video:not([controls])'))if(!video.paused)suppressGalleryVideo(video);
 },500);
 document.addEventListener('pointerover',onMove,true);
 document.addEventListener('pointermove',onMove,true);
 document.addEventListener('click',onClick,true);
 // STAGE 1 / CARD DETECTION — FINAL VERIFIED MODULE INTERFACE.
 // Read-only access for subsequent stages; no image/network/popup logic here.
 // The card detector owns selection, layout learning, duplicates, and boundaries.
 window.__HIB_CARD_STAGE_1__ = Object.freeze({
  cardAtPoint(x,y){if(!enabled||picker)return null;const row=cardAtPoint(x,y);return row?{element:row.el,url:row.url,title:row.title,type:row.type}:null;},
  cardFromElement(el){if(!enabled||picker)return null;const row=relevant(el);return row?{element:row.el,url:row.url,title:row.title,type:row.type}:null;},
  visibleCards(){if(!enabled||picker)return [];const out=[];for(const r of inventory){if(!r.el||!r.el.isConnected)continue;const b=r.el.getBoundingClientRect();if(b.width<40||b.height<40||b.bottom<0||b.top>innerHeight||b.right<0||b.left>innerWidth)continue;out.push({element:r.el,url:r.url,title:r.title,type:r.type});if(out.length>=400)break;}return out;},   // RC453: every card in the viewport (any thumbnail kind), for the passive mark pass
  galleryBlocked(){return siteVideoBlock===true;}   // RC432: the site's "Block real video playback inside gallery thumbnails" choice (read by preview_freeze.js)
 });
 // END STAGE 1 / CARD DETECTION — functionality frozen at RC171.
 // Root overlay shares the same viewport coordinate space as the proven console test.
 document.documentElement.appendChild(overlayLayer);
 try{new MutationObserver(()=>{if(!overlayLayer.isConnected)ensureOverlay();}).observe(document.documentElement,{childList:true});}catch(_){}   // RC434
 window.addEventListener('scroll',repositionAllOutlines,true);window.addEventListener('resize',repositionAllOutlines);
 // Decorative overlay pass-through is conservative: only pointer-blocking
 // elements with no interactive children and no image/video are eligible.
 // Do not make site overlays visually invisible; protect title/buttons.
 function releaseDecorativeOverlays(){for(const el of document.querySelectorAll('[class*="overlay"],[class*="cover"],[class*="mask"]')){
  if(el.closest('#hib-rc163-overlay-layer,#hib-rc157-hover-outline')||el.matches('a,button,input')||el.querySelector('a[href],button,input,video,iframe'))continue;
  const r=el.getBoundingClientRect();if(r.width<80||r.height<60)continue;
  const b=el.parentElement?.getBoundingClientRect();if(!b||r.width<b.width*.8||r.height<b.height*.7)continue;
  // Pass through pointer input to the card behind this decorative layer.
  if(el.dataset.hibRc157PassThrough==='1')continue;
  el.dataset.hibRc157PassThrough='1';el.style.setProperty('pointer-events','none','important');
 }}
 // RC239.1 SAFETY: no unconditional overlay mutation during startup.
 // Only scheduleScan() may run releaseDecorativeOverlays(), after activation.

 observer=new MutationObserver(scheduleScan);observer.observe(document.documentElement,{subtree:true,childList:true});
 browser.storage.onChanged.addListener((change,area)=>{if(area==='local'){if(POST_LAYOUT_KEY in change)loadPostFix();if(LEARN_KEY in change||DEDUPE_KEY in change||VIDEO_BLOCK_KEY in change)loadLearned();if(['enabledSites','siteMediaModes','hibRc139ScanVideoHosts'].some(k=>k in change))refreshGate();}});
 window.addEventListener('pagehide',clearHover);loadPostFix();loadLearned();refreshGate();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleScan,{once:true});
})();

/* ===== END 1E — VIDEO CARD CLASSIFICATION / OVERLAY GUARDS ===== */
/* ===== END SECTION 1 — CARD DETECTOR AND CPCR ===== */
