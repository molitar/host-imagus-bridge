/* HIB RC45: libass-backed global ASS/SSA subtitle rendering. */
(()=>{'use strict';
 const video=document.getElementById('media');
 const layer=document.getElementById('hib-ass-layer');
 let renderer=null,available=false,enabled=true;
 let pageFonts=[];   // fonts the video page itself loads (https only); added after the bundled default
 function setPageFonts(list){pageFonts=(Array.isArray(list)?list:[]).filter(u=>{try{return new URL(u).protocol==='https:';}catch(_){return false;}}).slice(0,8);}
 function dispose(){if(renderer){try{renderer.dispose();}catch(e){console.warn('[HIB ASS] dispose',e);}renderer=null;}layer.replaceChildren();available=false;enabled=true;}
 function attach(text){
  if(typeof text!=='string'||!/^\s*\uFEFF?\[Script Info\]/i.test(text))throw Error('Invalid ASS document');
  if(typeof window.HIBSubtitlesOctopus!=='function')throw Error('libass controller unavailable');
  dispose();
  const count=(text.match(/^Dialogue\s*:/gm)||[]).length;
  if(!count)throw Error('No ASS dialogue events');
  // The worker and controller are the official @jellyfin/libass-wasm 4.2.4 files; the subtitle text is handed over directly (no second fetch).
  renderer=new window.HIBSubtitlesOctopus({
   video,
   subContent:text,
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
 window.hibAssSubtitles={attach,setPageFonts,toggle(){enabled=!enabled;if(renderer){try{renderer.canvasParent.style.display=enabled?'':'none';}catch(e){console.warn('[HIB ASS] toggle',e);}}return enabled;},has(){return available;},clear:dispose};
})();
