/* HIB RC45: libass-backed global ASS/SSA subtitle rendering. */
(()=>{'use strict';
 const video=document.getElementById('media');
 const layer=document.getElementById('hib-ass-layer');
 let renderer=null,available=false,enabled=true;

 /* 3.0.1: A- / A+ also resize styled (ASS) subtitles. libass draws them as authored (PlayRes units), so the size is changed in the script itself: every style's Fontsize and every \fs
  * override is multiplied by `factor` before the renderer gets it. Default 0.7 (the bundled fallback font is wide and the authored sizes looked huge); saved in storage (hibAssScale). */
 let srcText='',factor=0.7;
 const ASS_KEY='hibAssScale';
 try{browser.storage.local.get(ASS_KEY).then(v=>{const f=Number(v&&v[ASS_KEY]);if(Number.isFinite(f)&&f>=0.3&&f<=2.5){factor=f;if(renderer&&srcText)applyScale();}}).catch(()=>{});}catch(_){}
 function scaledText(text,f){
  if(Math.abs(f-1)<0.001)return text;
  let inStyles=false,fsIdx=-1;const r=n=>String(Math.round(parseFloat(n)*f*10)/10);
  return text.split(/\r?\n/).map(l=>{
   if(/^\s*\[V4\+?\s*Styles\]/i.test(l))inStyles=true;else if(/^\s*\[/.test(l))inStyles=false;
   if(inStyles){
    if(/^\s*Format\s*:/i.test(l))fsIdx=l.slice(l.indexOf(':')+1).split(',').map(x=>x.trim().toLowerCase()).indexOf('fontsize');
    else if(/^\s*Style\s*:/i.test(l)&&fsIdx>=0){const i=l.indexOf(':'),p=l.slice(i+1).split(',');if(p.length>fsIdx&&!isNaN(parseFloat(p[fsIdx])))p[fsIdx]=r(p[fsIdx]);return l.slice(0,i+1)+p.join(',');}
   }
   if(/^\s*Dialogue\s*:/i.test(l))return l.replace(/\\fs(\d+(?:\.\d+)?)/g,(m,n)=>'\\fs'+r(n));
   return l;
  }).join('\n');
 }
 function applyScale(){if(renderer&&srcText){try{renderer.setTrack(scaledText(srcText,factor));}catch(e){console.warn('[HIB ASS] setTrack',e);}}}
 function step(mult){factor=Math.max(0.3,Math.min(2.5,Math.round(factor*mult*100)/100));try{browser.storage.local.set({[ASS_KEY]:factor}).catch(()=>{});}catch(_){}applyScale();return factor;}
 let pageFonts=[];   // fonts the video page itself loads (https only); added after the bundled default
 function setPageFonts(list){pageFonts=(Array.isArray(list)?list:[]).filter(u=>{try{return new URL(u).protocol==='https:';}catch(_){return false;}}).slice(0,8);}
 function dispose(){srcText='';if(renderer){try{renderer.dispose();}catch(e){console.warn('[HIB ASS] dispose',e);}renderer=null;}layer.replaceChildren();available=false;enabled=true;}
 function attach(text){
  if(typeof text!=='string'||!/^\s*\uFEFF?\[Script Info\]/i.test(text))throw Error('Invalid ASS document');
  if(typeof window.HIBSubtitlesOctopus!=='function')throw Error('libass controller unavailable');
  dispose();
  srcText=text;
  const count=(text.match(/^Dialogue\s*:/gm)||[]).length;
  if(!count)throw Error('No ASS dialogue events');
  // The worker and controller are the official @jellyfin/libass-wasm 4.2.4 files; the subtitle text is handed over directly (no second fetch).
  renderer=new window.HIBSubtitlesOctopus({
   video,
   subContent:scaledText(text,factor),
   workerUrl:browser.runtime.getURL('subtitles-octopus-worker.js'),
   legacyWorkerUrl:browser.runtime.getURL('subtitles-octopus-worker.js'),
   /* the font is bundled in the package (Figtree ExtraBold, SIL OFL 1.1: fonts/Figtree-OFL-1.1.txt): no request to any website */
   fonts:[browser.runtime.getURL('fonts/figtree-latin-800-normal.woff2'),browser.runtime.getURL('fonts/figtree-latin-ext-800-normal.woff2'),...pageFonts],
   fallbackFont:browser.runtime.getURL('fonts/figtree-latin-800-normal.woff2'),
   renderMode:'wasm-blend',
   onError(error){console.warn('[HIB ASS] renderer error',error);},
   onReady(){console.info('[HIB ASS] LIBASS_RENDERER_READY');}
  });
  available=true;enabled=true;
  return count;
 }
 window.hibAssSubtitles={attach,setPageFonts,step,toggle(){enabled=!enabled;if(renderer){try{renderer.canvasParent.style.display=enabled?'':'none';}catch(e){console.warn('[HIB ASS] toggle',e);}}return enabled;},has(){return available;},clear:dispose};
})();
