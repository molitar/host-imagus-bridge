"use strict";
/* One-time takeover (toolbar "Play with HIB"): the HIB player is opened for the stream found on this page right away (the page's own player
 * may be unable to play it), and every <video> that starts playing afterwards is handed over too, until the page is reloaded or navigated.
 * Nothing is saved. Where the address comes from, in order: a plain https video address, what the tab requested (kept by the background),
 * the page's own resource list, then addresses written on the page itself (a source <input>, the page address' own parameters, <source>
 * tags, links). */
(()=>{
 // RC410: pressing the button again on the same page re-runs detection (the first press stops watching after ~30 s).
 if(window.__hibTakeover){try{window.__hibTakeover.retry();}catch(_){}return;}
 let opening=false;
 function toast(text){
  try{
   document.getElementById('hib-takeover-toast')?.remove();
   const t=document.createElement('div');t.id='hib-takeover-toast';t.textContent='HIB: '+text;
   t.style.cssText='all:initial!important;position:fixed!important;right:14px!important;bottom:14px!important;z-index:2147483646!important;max-width:420px!important;background:#202026!important;color:#fff!important;font:13px system-ui,sans-serif!important;padding:7px 11px!important;border-radius:6px!important;box-shadow:0 2px 8px rgba(0,0,0,.4)!important;word-break:break-all!important;';
   (document.body||document.documentElement).append(t);setTimeout(()=>t.remove(),9000);
  }catch(_){}
 }
 const kindOf=n=>{let p='';try{p=new URL(n).pathname.toLowerCase();}catch(_){}return /\.m3u8$/.test(p)?'hls':/\.mpd$/.test(p)?'dash':/\.(?:mp4|m4v|webm|ogv)$/.test(p)?'direct':'';};
 const pick=names=>{
  const ok=names.filter(n=>/^https:/i.test(n));
  const man=ok.find(n=>{const k=kindOf(n);return k==='hls'||k==='dash';});
  if(man)return {url:man,format:kindOf(man)};
  const file=[...ok].reverse().find(n=>kindOf(n)==='direct');
  return file?{url:file}:null;
 };
 function fromResources(){try{return pick(performance.getEntriesByType('resource').map(r=>r.name));}catch(_){return null;}}
 // Addresses the page shows or carries: a text box with the stream, the page address' own parameters (nested once), <source>, links.
 function fromPage(){
  const found=[];
  try{
   for(const el of document.querySelectorAll('input[type=text],input[type=url],input:not([type]),textarea'))if(/https?:/i.test(el.value||''))found.push(el.value.trim());
   const q=new URLSearchParams(location.search);for(const [,v] of q)if(/^https?:/i.test(v))found.push(v);
   for(const s of document.querySelectorAll('video source[src],video[src],a[href]')){const u=s.getAttribute('src')||s.getAttribute('href');if(u)try{found.push(new URL(u,location.href).href);}catch(_){}}
  }catch(_){}
  return pick(found);
 }
 async function findSource(v){
  const src=v?(v.currentSrc||v.src||''):'';
  if(/^https:/i.test(src))return {url:src,format:kindOf(src)==='direct'?undefined:kindOf(src)||undefined};
  const m=await browser.runtime.sendMessage({type:'hib-tab-media'}).catch(()=>null);
  if(m&&m.url)return {url:m.url,format:m.format};
  return fromResources()||fromPage();
 }
 const bestVideo=()=>{
  let best=null,area=0;
  for(const v of document.querySelectorAll('video')){const r=v.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=v;}}
  return best;
 };

 /* RC410: captured (MediaSource) streams. Pages such as Mega or Google Drive play through MediaSource, so there is no stream address to
  * hand to the URL player. If hib_rc360_mse_observer.js captured the segments of this tab, open the SAME HIB player window with the
  * segment player inside (unified_player.js openCaptured). The source video is NOT paused: it keeps playing muted underneath because
  * its player is what produces the segments (the background drives it). Returns true if the window was opened, false if this page
  * has no capture. It is tried BEFORE the address lookup: a blob: video has no address anyway, and a captured stream must never fall
  * through to an unrelated URL the tab happened to request. */
 async function takeCaptured(quiet){
  const cap=await browser.runtime.sendMessage({type:'hib-rc387-capture-info'}).catch(()=>null);
  if(cap&&cap.ok&&cap.hasInit&&window.__hibUnifiedPlayerOpenCaptured){
   const ok=window.__hibUnifiedPlayerOpenCaptured({tabId:cap.tabId,title:document.title,site:location.hostname});
   console.info('[HIB TAKEOVER]',{status:ok?'OPENED_CAPTURED':'REJECTED_CAPTURED',tabId:cap.tabId,segments:cap.segments});
   if(ok)toast('playing the captured stream');
   return ok;
  }
  // Capture switched off: tell the user how to turn it on (only for an explicit press, not for the silent retries).
  if(!quiet&&cap&&cap.ok&&!cap.enabled)toast('no stream address found. For streams like this, turn on "Capture streams" in the HIB popup, reload the page and start the video.');
  return false;
 }
 async function take(v,quiet){
  if(opening||window.__hibUnifiedPlayerIsOpen?.()||!window.__hibUnifiedPlayerOpen)return false;
  if(v){const r=v.getBoundingClientRect();if(r.width<160||r.height<90)v=null;}
  // RC424: look for a stream address FIRST. A real manifest (HLS / DASH) goes to the normal URL player (time display, subtitles). Only when
  // there is no manifest address is the captured-stream window (RC410, MediaSource pages such as Mega / Google Drive) tried; a captured stream
  // must still never fall through to an unrelated non-manifest URL the tab happened to request, so that case keeps captured first.
  let s=null;try{s=await findSource(v);}catch(_){}
  if(!(s&&s.url&&(s.format==='hls'||s.format==='dash'))&&await takeCaptured(quiet))return true;
  opening=true;
  try{
   if(!s||!s.url){
     if(!quiet){
       const hosted=await browser.runtime.sendMessage({type:'hib-hosted-player-candidates'}).catch(()=>null);
       console.info('[HIB TAKEOVER]',{status:hosted?.candidates?.length?'HOSTED_PLAYER_DETECTED_SOURCE_UNAVAILABLE':'NO_SOURCE',category:hosted?.category||null,candidates:(hosted?.candidates||[]).map(({host,mime,evidence,method,status,count,frameId})=>({host,mime,evidence,method,status,count,frameId})),note:'Candidates are not playable URLs; do not feed encrypted chunks or framed transports to MP4 decoder.'});
       toast(hosted?.candidates?.length?'Hosted media detected, but no reusable playback source yet':'could not find a stream on this page');
     }
     return false;
   }
   try{v&&v.pause();}catch(_){}
   const opened=window.__hibUnifiedPlayerOpen({url:s.url,format:s.format,title:document.title,site:location.hostname,observedSource:true});
   console.info('[HIB TAKEOVER]',{status:opened?'OPENED':'REJECTED',url:s.url.slice(0,160),format:s.format});
   if(!opened){toast('the player could not open this stream');return false;}
   const u=new URL(s.url);toast('playing '+(s.format||'direct file')+' from '+u.host+u.pathname.slice(0,80));
   return true;
  }finally{setTimeout(()=>{opening=false;},1500);}
 }
 const onPlay=e=>{if(e.target instanceof HTMLVideoElement&&e.target.isConnected)take(e.target,true);};
 document.addEventListener('play',onPlay,true);
 document.addEventListener('playing',onPlay,true);
 window.__hibTakeover={retry(){return take(bestVideo(),false);},stop(){document.removeEventListener('play',onPlay,true);document.removeEventListener('playing',onPlay,true);delete window.__hibTakeover;}};
 // Pressed now: find the stream now. If none is found yet, later playback is still handed over.
 // Retry global detection as the website player initializes and requests media. No site-specific URL rules.
 let attempts=0;let watcher=null;
 const poll=async()=>{
  if(!window.__hibTakeover||window.__hibUnifiedPlayerIsOpen?.()){clearInterval(watcher);return;}
  if(opening)return;
  attempts++;
  const ok=await take(bestVideo(),true).catch(()=>false);
  if(ok||attempts>=20){clearInterval(watcher);if(!ok)console.info('[HIB TAKEOVER]',{status:'NO_VERIFIED_STREAM',attempts});}
 };
 take(bestVideo(),false).then(ok=>{
  if(!ok){toast('Watching this page for a media stream. Start its video, then HIB will retry detection.');watcher=setInterval(poll,1500);}
 });
})();
