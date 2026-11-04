/* ===== START VIDEO SECTION - HIB PLAYER (hib101_player.js) - VIDEO FINAL (RC507) =====
 * The extension-page player that runs inside the HIB window. FEATURE MAP of what was added in RC456-RC507 (each part carries its own comment where it is defined):
 *   Streams (DASH / HLS)
 *     RC456/RC479/RC483/RC499  Segment store + adaptive prefetch (pfStore, pfPut, pfTick, pfAdd): memory only, the current video only, wiped by stop() / pfClear().
 *                              An XHR hook (HibXHR) answers the player's own segment requests from the store. Speed follows the buffer (short = fast, comfortable = slow).
 *     RC474                    dash.js keeps what was played (bufferToKeep) and buffers further ahead.
 *     RC502                    pfSegmentRuns(): what the store holds, drawn green on the seek bar and shown as 'cache N%'.
 *   Single files (html5)
 *     RC479-RC503              fullCacheStart(): ONE full local copy of the video in memory (2 MB pieces, follows the playhead, yields to the player, no '.mp4' needed in the address).
 *     RC489 / hib_mp4fix.js    repairs a file index that lists almost no sync samples (hentaisea) so jumps are fast; the copy also keeps the audio track (all chunk tables shift).
 *     RC485-RC489              partial copies serve jumps before the copy is complete (only for files whose index was repaired).
 *     RC500/RC505              SEEK LOCK (setSeekLock): slider + Left/Right wait until the copy is complete, at most 45 s (25 s without progress). Play waits for the first 'canplay'.
 *     RC473/RC486/RC488        stall watchdog (reviveDirect), fresh address on refusal / expiry / start stall (needFresh, replaceSource), probes after a long pause or a stall.
 *   Controls
 *     RC478/RC481/RC502        buffered / cached bands on the seek bar (paintBuffer), '+Ns' / 'cache N%' / 'cached' label.
 *     RC480                    text subtitles drawn by HIB above the control bar (capLayer); RC441 track list and default language.
 *     RC493/RC494/RC507        volume OSD; arrows always mean volume (Up/Down) and jump (Left/Right); the player takes keyboard focus when it opens.
 *     RC496                    resume position is also written by the page script (survives the iframe being removed); a position under 8 s never erases a saved one.
 * ===== (the code follows; the matching END marker is at the end of this file) ===== */
(() => {
'use strict';
const BRIDGE='hib-unified-v101';
const $=id=>document.getElementById(id);
const video=$('media'),message=$('message'),play=$('play'),seek=$('seek'),current=$('current'),duration=$('duration'),mute=$('mute'),volume=$('volume'),label=$('volumeLabel'),captions=$('captions');
/* 3.0.1: the volume bar and its percentage are ONE unit (no flex gap between them), so the number is read as belonging to the bar */
{const w=document.createElement('span');w.id='volWrap';w.style.cssText='display:flex;align-items:center;gap:4px;flex:0 0 auto';volume.parentNode.insertBefore(w,volume);w.appendChild(volume);w.appendChild(label);label.style.minWidth='30px';label.style.margin='0';label.style.textAlign='left';}
// Keep player timestamps and controls out of browser/page translation systems.
for(const node of [document.documentElement,$('player'),$('controls'),current,duration,seek]){node.setAttribute('translate','no');node.classList.add('notranslate');}

let engine=null,hls=null,dash=null,started=false,blob=null,volumeEditing=false,subtitles=null,seekEditing=false,seekTarget=null,lastSource=null,seekPending=null,seekPendingSince=0;
let recoveryAttempts=0,recoveryTimer=null,hlsParsingFailures=0,invalidKeyResponse=false;
const diagnosticHistory=[];
const TRACE_MAX_EVENTS=350;
const TRACE_MAX_CHARS=180000;
const traceStart=performance.now();
let traceSequence=0,traceLastPosition=-1,traceLastPersist=-Infinity,traceDownloadedFailure=false;
const traceSession='hib93-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
// Never serialize HLS.js level details, fragment arrays, browser internals or cyclic references.
function traceSafe(value,depth=0,seen=new WeakSet()){
 if(value==null||typeof value==='boolean')return value;
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value==='string'){
  let x=value;
  // Strip all query strings from logged URLs; signed key URLs must not enter export logs.
  x=x.replace(/https?:\/\/[^\s"'<>]+/g,u=>{try{let q=new URL(u);return q.origin+q.pathname;}catch(_){return u;}});
  return x.length>550?x.slice(0,550)+'…[truncated]':x;
 }
 if(typeof value!=='object')return String(value).slice(0,120);
 if(depth>3)return '[depth limit]';
 if(seen.has(value))return '[circular]';
 seen.add(value);
 if(Array.isArray(value))return value.slice(0,12).map(x=>traceSafe(x,depth+1,seen));
 const out={};
 for(const key of Object.keys(value).slice(0,24)){
  if(/^(details|fragments|_?stats|loader|key|decryptdata|levelkeys|payload|data|buffer|bytes)$/i.test(key)&&depth>0)continue;
  try{out[key]=traceSafe(value[key],depth+1,seen);}catch(_){out[key]='[unavailable]';}
 }
 return out;
}
function trace(type,data={}){
 const entry={seq:++traceSequence,elapsedMs:Math.round(performance.now()-traceStart),type,data:traceSafe(data)};
 diagnosticHistory.push(entry);if(diagnosticHistory.length>TRACE_MAX_EVENTS)diagnosticHistory.shift();
 if(/ERROR|FAIL|STALLED|FATAL/.test(type))console.error('[HIB RC93 PLAYER TRACE]',entry);
 else if(!/TIMEUPDATE|PROGRESS/.test(type))console.info('[HIB RC93 PLAYER TRACE]',entry);
 return entry;
}
function recordDiagnostic(type,data){return trace(type,data);}
async function persistTrace(reason){
 try{const report={schema:'hib-player-trace-v2',session:traceSession,reason,capturedAt:new Date().toISOString(),...playerDiagnostics()};
 // Enforce a hard export ceiling while keeping the latest, most relevant failure events.
 while(JSON.stringify(report).length>TRACE_MAX_CHARS&&report.history.length>12)report.history.splice(0,Math.min(25,report.history.length-12));
 await browser.storage.local.set({hibRc90LastPlayerTrace:report});
 console.info('[HIB RC93 PLAYER TRACE STORED]',JSON.stringify({session:traceSession,reason,entries:report.history.length}));
 const manual=reason==='MANUAL_CAPTURE';
 send('diagnostics',{report,automatic:!manual,reason});
 // RC437: a trace file is downloaded ONLY for the manual "Capture report" button. Automatic failures are still recorded (stored in the add-on's
 // storage and in the diagnostic window) but never written to the Downloads folder.
 const shouldDownload=manual;
 if(shouldDownload){
   if(!manual)traceDownloadedFailure=true;
   send('status',{code:'DIAGNOSTICS_DOWNLOAD_STARTING',detail:'Saving player trace to Downloads…'});
   try{
     const result=await browser.runtime.sendMessage({type:'hib-rc91-download-player-trace',report});
     if(!result?.ok)throw Error(result?.error||'Download not completed');
     trace('DIAGNOSTICS_DOWNLOAD_COMPLETE',{filename:result.filename,id:result.id});
     send('diagnostics-download',{ok:true,filename:result.filename});
     send('status',{code:'DIAGNOSTICS_DOWNLOAD_COMPLETE',detail:'Saved to Downloads: '+result.filename});
   }catch(e){
     trace('DIAGNOSTICS_DOWNLOAD_FAILED',{error:String(e)});
     send('diagnostics-download',{ok:false,error:String(e)});
     send('status',{code:'DIAGNOSTICS_DOWNLOAD_FAILED',detail:'Diagnostics download failed: '+String(e)});
   }
 }
 }catch(e){console.error('[HIB RC90 PLAYER TRACE SAVE FAILED]',String(e));}
}
function traceFailure(reason){trace('PLAYER_FAILURE',{reason});const now=performance.now();if(now-traceLastPersist<5000)return;traceLastPersist=now;void persistTrace(reason);}
const mediaEvents=['loadstart','loadedmetadata','loadeddata','canplay','canplaythrough','play','playing','pause','waiting','stalled','suspend','emptied','abort','error','ended','seeking','seeked','durationchange','ratechange'];
for(const name of mediaEvents)video.addEventListener(name,()=>{
 trace('MEDIA_'+name.toUpperCase(),{time:video.currentTime,readyState:video.readyState,networkState:video.networkState,paused:video.paused,error:video.error?{code:video.error.code,message:video.error.message}:null});
 if(name==='error'||name==='stalled')traceFailure('MEDIA_'+name.toUpperCase());
});
// RC104: signal actual decoded media readiness, not the earlier optimistic PLAYING status.
video.addEventListener('playing',()=>{if(video.readyState>=2)send('status',{code:'PLAYBACK_CONFIRMED',detail:''});});
video.addEventListener('canplay',()=>{if(video.readyState>=2)send('status',{code:'PLAYBACK_CONFIRMED',detail:''});});
video.addEventListener('timeupdate',()=>{if(video.currentTime-traceLastPosition>=2||video.currentTime<traceLastPosition){traceLastPosition=video.currentTime;trace('MEDIA_TIMEUPDATE',{time:video.currentTime,readyState:video.readyState});}});
window.addEventListener('error',e=>traceFailure('WINDOW_ERROR '+String(e.message||e.error||'')));
window.addEventListener('unhandledrejection',e=>traceFailure('UNHANDLED_REJECTION '+String(e.reason||'')));
trace('PLAYER_BOOT',{userAgent:navigator.userAgent,session:traceSession});
function playerDiagnostics(){
 const ranges=[];for(let i=0;i<video.buffered.length;i++)ranges.push([video.buffered.start(i),video.buffered.end(i)]);
 return {schema:"hib-player-trace-v2",session:traceSession,capturedAt:new Date().toISOString(),source:lastSource||null,engine,started,hlsVersion:typeof Hls!=='undefined'?Hls.version:null,failures:hlsParsingFailures,recoveryAttempts,video:{currentTime:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null,paused:video.paused,ended:video.ended,readyState:video.readyState,networkState:video.networkState,errorCode:video.error?.code||null,videoWidth:video.videoWidth,videoHeight:video.videoHeight,buffered:ranges},hls:hls?{levels:hls.levels?.map(l=>({width:l.width,height:l.height,videoCodec:l.videoCodec,audioCodec:l.audioCodec,codecSet:l.codecSet,url:l.url})),audioTracks:hls.audioTracks?.map(t=>({name:t.name,lang:t.lang,url:t.url})),currentLevel:hls.currentLevel,loadLevel:hls.loadLevel}:null,history:diagnosticHistory};
}
function clearRecovery(){if(recoveryTimer!==null){clearTimeout(recoveryTimer);recoveryTimer=null;}}
function playSafely(){return video.play().catch(e=>{if(e?.name==='AbortError'){send('status',{code:'PLAY_INTERRUPTED',detail:String(e)});return;}if(e?.name==='NotAllowedError'){if(video.paused){video.muted=true;showAudio();return video.play().then(()=>{status('PLAYING_MUTED','Playing muted — click 🔊 to unmute');}).catch(()=>{status('AUTOPLAY_PERMISSION_DISABLED','Autoplay permission disabled — click Play to start');});}else{status('PLAYING');}return;}status('PLAY_REJECTED',String(e));send('error',{code:'PLAY_REJECTED',detail:String(e)});});}

/* RC421  START GATE ("buffer first, then play").
 * Before: every engine called playSafely() the moment the source was attached, so the video started with an empty buffer, ran out of data at once
 * and the buffer never got ahead (hentaisea.com episodes). Now the source is attached PAUSED and the browser/hls.js buffers; playback starts when
 *   - the buffer ahead of the playhead reaches targetLead() = 15 % of the duration, clamped to 3..20 s (8 s while the duration is unknown), or
 *   - the whole file is already buffered, or
 *   - the wait runs long: 20 s with at least 1.5 s ahead, or 45 s regardless (never hang on a slow or odd source).
 * A press on Play / the toggle starts at once (toggle() calls playSafely directly) and ends the gate. A new source or stop() ends it too.
 * While waiting the status line shows "Buffering before play...". */
let gateTimer=null;
function targetLead(){const d=video.duration;return Math.min(20,Math.max(3,Number.isFinite(d)&&d>0?d*0.15:8));}
function bufferedAheadSec(){const t=video.currentTime||0;for(let i=0;i<video.buffered.length;i++){const a=video.buffered.start(i),b=video.buffered.end(i);if(a<=t+2&&b>=t)return b-Math.max(t,a);   /* RC457: the first range of some files starts a moment after 0 (it used to count as 'nothing buffered' and held the start gate for 45 s) */}return 0;}
function clearGate(){if(gateTimer){clearInterval(gateTimer);gateTimer=null;}}
function playWhenBuffered(){
 clearGate();
 try{video.preload='auto';}catch(_){}
 status('BUFFERING','Buffering before play...');
 const began=Date.now();
 gateTimer=setInterval(()=>{
  if(!started||!video.paused){clearGate();return;}                         // user pressed play, or the session ended
  const lead=bufferedAheadSec(),d=video.duration,waited=Date.now()-began;
  const full=Number.isFinite(d)&&d>0&&video.buffered.length&&video.buffered.end(video.buffered.length-1)>=d-0.5;
  if(lead>=targetLead()||full||(waited>20000&&lead>=1.5)||waited>45000){
   clearGate();trace('START_GATE_OPEN',{lead:Math.round(lead*10)/10,waitedMs:waited,full});
   if(/^Buffering/.test(message.textContent))message.textContent='';   // the gate is open: playback starts now, the wait message must go
   void playSafely();
  }
 },250);
}
const send=(type,detail={})=>parent.postMessage({bridge:BRIDGE,type,...detail},'*');

// Single global caption style for both HTML5 and HLS engines. Settings persist independently of volume.
const CAPTION_KEY='hib101CaptionPreferences';
let captionScale=2.8; // percentage of player height, clamped below
const captionSmaller=$('captionSmaller'),captionLarger=$('captionLarger');
const captionStyle=document.createElement('style');document.head.appendChild(captionStyle);
function updateCaptionStyle(){
 const px=Math.round(Math.max(16,Math.min(140,innerHeight*captionScale/100)));
 captionStyle.textContent=`video::cue { font-size: ${px}px; }`;
 try{capLayout();capRender();}catch(_){}
 captionSmaller.title=`Decrease subtitles (current ${px}px)`;
 captionLarger.title=`Increase subtitles (current ${px}px)`;
}
function changeCaptionScale(change){
 captionScale=Math.max(1.5,Math.min(14.0,Math.round((captionScale+change)*10)/10));
 updateCaptionStyle();
 try{if(window.hibAssSubtitles&&window.hibAssSubtitles.has())window.hibAssSubtitles.step(change>0?1.15:1/1.15);}catch(_){}   // 3.0.1: styled (ASS) subtitles follow A- / A+ too
 browser.storage.local.set({[CAPTION_KEY]:{scale:captionScale}}).catch(()=>{});
}
captionSmaller.addEventListener('click',()=>changeCaptionScale(-0.4));
captionLarger.addEventListener('click',()=>changeCaptionScale(0.4));
window.addEventListener('resize',updateCaptionStyle);
browser.storage.local.get(CAPTION_KEY).then(v=>{
 const saved=Number(v?.[CAPTION_KEY]?.scale);
 if(Number.isFinite(saved)&&saved>=1.5&&saved<=14)captionScale=saved;
 updateCaptionStyle();
}).catch(updateCaptionStyle);
updateCaptionStyle();

const clamp=v=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):1));
const stamp=t=>{if(!Number.isFinite(t))return '0:00';const x=Math.max(0,Math.floor(t));return `${Math.floor(x/60)}:${String(x%60).padStart(2,'0')}`;};
function status(code,detail=''){trace('STATUS',{code,detail});message.textContent=detail||'';send('status',{code,detail});}
function showAudio(){const n=Math.round(video.volume*100);volume.value=String(n);label.value=n+'%';label.textContent=n+'%';mute.textContent=video.muted||n===0?'🔇':'🔊';mute.setAttribute('aria-label',video.muted?'Unmute':'Mute');send('volume',{volume:video.volume,muted:video.muted});}
function stop(){try{pfClear();}catch(_){}try{fcAbort=true;if(fcUrl)URL.revokeObjectURL(fcUrl);}catch(_){}saveResume(true);clearGate();if(rc355FallbackFrame){rc355FallbackFrame.remove();rc355FallbackFrame=null;}rc355FallbackActive=false;rc355FallbackPending=false;trace('STOP',{engine,started});clearRecovery();recoveryAttempts=0;seekEditing=false;seekTarget=null;seekPending=null;if(hls){try{hls.destroy()}catch(_){}hls=null;}if(dash){try{dash.reset()}catch(_){}dash=null;}video.pause();video.removeAttribute('src');video.load();if(blob){URL.revokeObjectURL(blob);blob=null;}window.hibAssSubtitles?.clear();started=false;}
function useAudio(setting){video.volume=clamp(setting?.volume);video.muted=setting?.muted===true;showAudio();}
// Apply bottom anchoring to parsed cues, never by rewriting WebVTT text.
// A cue with an authored line position remains untouched.
function positionParsedCues(track){
 if(!track)return;
 for(const cue of track.cues||[]){
  placeCue(cue);
 }
}
/* RC449: keep the whole cue (every line) above the control bar. The cue box is anchored by its bottom edge at a fixed distance from the bottom of
 * the video, so a two-line cue grows upward instead of its second line sitting under the seek bar. Applied to every showing track (direct and HLS). */
function placeCue(cue){
 try{
  const h=Math.max(120,video.clientHeight||innerHeight);
  const pct=Math.max(40,Math.min(92,100-(78/h)*100));
  if(cue.snapToLines===false&&cue.lineAlign==='end'&&cue.__hibLine===pct)return;
  if(cue.line!=='auto'&&cue.__hibLine===undefined)return; // an authored position stays
  cue.snapToLines=false;cue.lineAlign='end';cue.line=pct;cue.__hibLine=pct;
 }catch(_){/* browser may expose readonly cues */}
}
function placeActiveCues(){
 for(const tr of video.textTracks||[]){
  if(tr.mode!=='showing')continue;
  for(const c of tr.activeCues||[])placeCue(c);
 }
}
video.addEventListener('timeupdate',placeActiveCues);
video.addEventListener('seeked',placeActiveCues);
window.addEventListener('resize',placeActiveCues);
/* RC480: TEXT SUBTITLES (WebVTT / SRT, direct or from HLS) are drawn by HIB itself in a layer whose BOTTOM edge sits just above the control bar. The browser's own cue box is
 * anchored from its top edge in some versions, so a cue that wraps to two lines slid its second line under the bar. Here the whole block is anchored by its bottom line:
 * a wrapped cue grows UPWARD and nothing is ever covered. The tracks are kept in 'hidden' mode (cues still run, the browser draws nothing). */
const capLayer=document.createElement('div');capLayer.id='hib-cap-layer';
capLayer.style.cssText='position:absolute;left:0;right:0;bottom:50px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding:0 4%;pointer-events:none;z-index:2;text-align:center;';
$('player').appendChild(capLayer);
const capAdopted=new WeakSet();
// places the caption layer just above the control bar and sizes its text
function capLayout(){try{const h=$('controls').offsetHeight||42;capLayer.style.bottom=(h+8)+'px';const px=Math.round(Math.max(16,Math.min(140,innerHeight*captionScale/100)));capLayer.style.fontSize=px+'px';capLayer.style.lineHeight='1.25';capLayer.style.fontFamily='Arial,sans-serif';}catch(_){}}
// draws the active subtitle cues into the HIB caption layer (its bottom edge sits above the control bar)
function capRender(){
 try{
  const frag=document.createDocumentFragment();
  for(const tr of video.textTracks||[]){
   if(!capAdopted.has(tr)||tr.mode==='disabled')continue;
   for(const c of tr.activeCues||[]){
    /* RC511: the row is FULL WIDTH and centred. Sized to its own content (fit-content) Firefox measured the row from the FIRST line only, so a two-line cue wrapped into three ('houses.' alone on a third line); a full-width row wraps only when a line really is wider than the screen. */
    const line=document.createElement('div');line.style.cssText='display:inline;max-width:100%;color:rgba(255,255,255,.97);background:rgba(0,0,0,.45);padding:.02em .3em;-webkit-box-decoration-break:clone;box-decoration-break:clone;text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 1px #000;white-space:pre-line;overflow-wrap:anywhere;';
    try{line.appendChild(c.getCueAsHTML());}catch(_){line.textContent=String(c.text||'').replace(/<[^>]+>/g,'');}
    const row=document.createElement('div');row.style.cssText='width:100%;max-width:100%;margin:2px 0;text-align:center;';row.appendChild(line);frag.appendChild(row);
   }
  }
  capLayer.replaceChildren(frag);capLayout();
 }catch(_){}
}
// takes over every showing text track: hidden for the browser, drawn by HIB
function capAdoptTracks(){
 for(const tr of video.textTracks||[]){
  if(tr.kind!=='subtitles'&&tr.kind!=='captions')continue;
  if(!capAdopted.has(tr)){capAdopted.add(tr);tr.addEventListener('cuechange',capRender);}
  if(tr.mode==='showing')tr.mode='hidden';
 }
 capRender();
}
setInterval(capAdoptTracks,400);video.addEventListener('timeupdate',capRender);window.addEventListener('resize',capLayout);capLayout();
function attachDirectVtt(text,name){
 if(blob)URL.revokeObjectURL(blob);
 const old=video.querySelector('track[data-hib]');old?.remove();
 blob=URL.createObjectURL(new Blob([text],{type:'text/vtt'}));
 const t=document.createElement('track');
 t.dataset.hib='true';t.kind='subtitles';t.srclang='en';t.label=name||'English';t.default=true;t.src=blob;
 // Some browsers load tracks only after textTrack mode is enabled.
 video.append(t);t.track.mode='hidden';
 t.addEventListener('load',()=>{t.track.mode='hidden';});
 captions.hidden=false;captions.disabled=false;captions.title='Toggle subtitles';
}

/* RC441  SUBTITLE TRACKS + SELECTOR + DEFAULT LANGUAGE.
 * Every subtitle source registers its tracks here: the HLS manifest (EXT-X-MEDIA .vtt entries) and the page / scan (message 'subtitle-tracks' from the
 * window, list built by the background). Each track has a language code (from the manifest's LANGUAGE/NAME, the address, or the script of its text).
 * A <select> next to the CC button lists "Off" + the tracks and switches at once. The track shown at start is chosen by the DEFAULT LANGUAGE setting
 * (storage hibSubtitleLang, popup -> Video Playback Settings -> Subtitle language): 'en' (default), another language code, 'auto' (first track) or 'off'.
 * For English with no English track, a track of UNKNOWN Latin-script language is used; otherwise nothing is shown (the selector still lists the rest),
 * so a foreign track (Arabic, ...) can never appear just because it came first. */
const subSel=document.createElement('select');
subSel.id='subsel';subSel.hidden=true;subSel.title='Subtitles';
subSel.style.cssText='max-width:130px;margin-left:6px;background:#1b2430;color:#fff;border:1px solid #556;border-radius:6px;padding:2px 4px;font:12px system-ui;';
captions.after(subSel);
const LANG_LABEL={cs:'Czech',da:'Danish',fi:'Finnish',hu:'Hungarian',nl:'Dutch',pl:'Polish',ro:'Romanian',sv:'Swedish',uk:'Ukrainian',no:'Norwegian',bg:'Bulgarian',hr:'Croatian',sk:'Slovak',sl:'Slovenian',sr:'Serbian',ca:'Catalan',ms:'Malay',fa:'Persian',bn:'Bengali',ta:'Tamil',en:'English',ar:'Arabic',ja:'Japanese',es:'Spanish',fr:'French',de:'German',pt:'Portuguese',it:'Italian',ru:'Russian',ko:'Korean',zh:'Chinese',id:'Indonesian',th:'Thai',vi:'Vietnamese',tr:'Turkish',hi:'Hindi',he:'Hebrew',el:'Greek'};
const LANG_TOKEN={cs:'cs',da:'da',fi:'fi',hu:'hu',nl:'nl',pl:'pl',ro:'ro',sv:'sv',uk:'uk',no:'no',bg:'bg',hr:'hr',sk:'sk',sl:'sl',sr:'sr',ca:'ca',ms:'ms',fa:'fa',bn:'bn',ta:'ta',he:'he',el:'el',cze:'cs',dan:'da',fin:'fi',hun:'hu',nld:'nl',dut:'nl',pol:'pl',ron:'ro',rum:'ro',swe:'sv',ukr:'uk',nor:'no',czech:'cs',danish:'da',finnish:'fi',hungarian:'hu',dutch:'nl',polish:'pl',romanian:'ro',swedish:'sv',ukrainian:'uk',hebrew:'he',greek:'el',en:'en',eng:'en',english:'en',ar:'ar',ara:'ar',arabic:'ar',ja:'ja',jp:'ja',jpn:'ja',japanese:'ja',es:'es',spa:'es',spanish:'es',fr:'fr',fra:'fr',fre:'fr',french:'fr',de:'de',deu:'de',ger:'de',german:'de',pt:'pt',por:'pt',portuguese:'pt',it:'it',ita:'it',italian:'it',ru:'ru',rus:'ru',russian:'ru',ko:'ko',kor:'ko',korean:'ko',zh:'zh',zho:'zh',chi:'zh',chinese:'zh',id:'id',ind:'id',indonesian:'id',th:'th',tha:'th',thai:'th',vi:'vi',vie:'vi',vietnamese:'vi',tr:'tr',tur:'tr',turkish:'tr',hi:'hi',hin:'hi',hindi:'hi'};
let subTracks=[],subCurrent='off',subDefaultApplied=false,subDefaultTries=0,subPrefLang='en',subSeq=0;
browser.storage.local.get('hibSubtitleLang').then(v=>{if(typeof v.hibSubtitleLang==='string')subPrefLang=v.hibSubtitleLang;}).catch(()=>{});
function subLangFromName(...parts){
 /* RC508: parts are (language, name, label, url). language and label are explicit tags: every word counts. A file NAME or an ADDRESS also holds the TITLE, and a title
  * word ('Honi de Yatte Mitara' = 'de', 'id', 'it', 'hi' ...) must never be read as a language, so there only (a) a SUFFIX tag counts: one of the last 3 pieces before the
  * extension, read from the end, a 2-letter code glued by . _ - [ ( not by spaces; and (b) a folder that IS the language ('en', 'eng/', 'english', 'subs-en'). */
 const strictPath=raw=>{
  const segs=raw.split('/').filter(Boolean);
  const file=(segs.pop()||'').replace(/\.[a-z0-9]{2,4}$/,'');
  const pieces=[...file.matchAll(/([^a-z]*)([a-z]+)/g)].map(m=>({delim:m[1],tok:m[2]}));
  for(const pc of pieces.slice(-3).reverse()){
   if(!LANG_TOKEN[pc.tok]||pc.tok.length<2)continue;
   if(pc.tok.length===2&&!/[._\-\[(]$/.test(pc.delim))continue;
   return LANG_TOKEN[pc.tok];
  }
  for(const seg of segs.reverse()){
   const m=seg.trim().match(/^(?:(?:subs?|subtitles?|captions?|srt|vtt)[ ._-]*)?([a-z]{2,})$/);
   if(m&&LANG_TOKEN[m[1]])return LANG_TOKEN[m[1]];
  }
  return null;
 };
 for(let i=0;i<parts.length;i++){
  let str=String(parts[i]||'').toLowerCase();if(!str)continue;
  if(i===1||i===3){try{if(/^https?:/.test(str))str=decodeURIComponent(new URL(str).pathname);}catch(_){}const r=strictPath(str);if(r)return r;continue;}
  for(const tok of str.split(/[^a-z]+/)){if(tok.length>=2&&LANG_TOKEN[tok])return LANG_TOKEN[tok];}
 }
 return null;
}
function subTrackLabel(tr){
 const name=(LANG_LABEL[tr.lang]||(tr.lang?tr.lang.toUpperCase():'')||tr.label||'Subtitles');
 return tr.kind==='ass'||tr.format==='ass'?name+' (styled)':name;
}
function rebuildSubSelect(){
 subSel.replaceChildren();
 const off=document.createElement('option');off.value='off';off.textContent='Subtitles off';subSel.append(off);
 for(const tr of subTracks){const o=document.createElement('option');o.value=tr.id;o.textContent=subTrackLabel(tr);subSel.append(o);}
 subSel.value=subCurrent;subSel.hidden=!subTracks.length;
 if(subTracks.length){captions.hidden=false;captions.disabled=false;}
}
function clearSubtitleDisplay(){
 const old=video.querySelector('track[data-hib]');old?.remove();
 try{window.hibAssSubtitles?.clear?.();}catch(_){}
}
async function applySubTrack(id){
 subCurrent=id;subSel.value=id;
 if(id==='off'){clearSubtitleDisplay();return;}
 const tr=subTracks.find(x=>x.id===id);if(!tr)return;
 try{
  if(tr.kind==='ass'||tr.format==='ass'){
   const u=new URL(tr.url);if(u.protocol!=='https:')throw Error('Invalid ASS URL');
   const response=await fetch(u.href,{credentials:'omit'});if(!response.ok)throw Error('HTTP '+response.status);
   const txt=await response.text();if(txt.length>3000000||!/^\s*(?:\uFEFF)?\[Script Info\]/i.test(txt))throw Error('Not an ASS subtitle document');
   if(subCurrent!==id)return;                          // the user already chose another track while this one was loading
   clearSubtitleDisplay();
   const count=window.hibAssSubtitles.attach(txt);status('ASS_SUBTITLES_READY',count+' subtitle events');
  }else{
   let text=tr.text;
   if(typeof text!=='string'){const r=await fetch(tr.url,{credentials:'omit'});if(!r.ok)throw Error('HTTP '+r.status);text=await r.text();}
   text=String(text).replace(/^\uFEFF/,'');
   if(!/^WEBVTT(?:\s|$)/.test(text))throw Error('Subtitle response is not WebVTT');
   if(subCurrent!==id)return;
   clearSubtitleDisplay();
   attachDirectVtt(text,subTrackLabel(tr));
  }
 }catch(e){console.warn('[HIB 1.0.1 caption]','SUBTITLE_TRACK_FAILED',String(e));send('error',{code:'SUBTITLE_FETCH',detail:String(e)});}
}
function chooseDefaultSubTrack(){
 const pref=subPrefLang||'en';
 if(pref==='off')return 'off';
 if(pref==='auto')return subTracks[0]?.id||'off';
 const exact=subTracks.find(t=>t.lang===pref);if(exact)return exact.id;
 if(pref==='en'){const latin=subTracks.find(t=>!t.lang&&t.latin!==false);if(latin)return latin.id;}
 return 'off';
}
/* A track is listed ONLY when it is really available: a track that came with its text is; a track that is just an address (HLS manifest entry) is fetched
 * first and dropped when the request fails or the answer is not WebVTT / ASS. So a video offering Arabic, English and Japanese lists exactly those three. */
async function probeSubTrack(tr){
 try{
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9000);
  try{
   const r=await fetch(tr.url,{credentials:'omit',signal:ctrl.signal});if(!r.ok)return false;
   const text=String(await r.text()).replace(/^﻿/,'');
   if(tr.kind==='ass'||tr.format==='ass')return /^\s*\[Script Info\]/i.test(text);
   if(!/^WEBVTT(?:\s|$)/.test(text))return false;
   tr.text=text;return true;
  }finally{clearTimeout(timer);}
 }catch(_){return false;}
}
/* list: [{kind:'vtt'|'ass'|'srt', url?, text?, label?, lang?, name?, latin?}] ; merged with the tracks already known (same address = same track) */
function registerSubTracks(list){
 const fresh=[];
 for(const raw of list||[]){
  if(!raw||(!raw.url&&typeof raw.text!=='string'))continue;
  if(raw.url&&subTracks.some(t=>t.url===raw.url)||fresh.some(t=>t.url&&t.url===raw.url))continue;
  const text=typeof raw.text==='string'?raw.text:undefined;
  const lang=raw.lang||subLangFromName(raw.language,raw.name,raw.label,raw.url)||null;
  fresh.push({id:'t'+(++subSeq),kind:raw.kind||(/\.ass(?:$|[?#])/i.test(String(raw.url||''))?'ass':'vtt'),format:raw.format,url:raw.url,text,label:raw.label||raw.name||'Subtitles',lang,latin:raw.latin});
 }
 Promise.all(fresh.map(async tr=>((typeof tr.text==='string'||tr.kind==='ass'&&!tr.url)?true:await probeSubTrack(tr)))).then(ok=>{
  fresh.forEach((tr,i)=>{if(ok[i])subTracks.push(tr);});
  rebuildSubSelect();
  if(!subDefaultApplied&&subTracks.length){const pick=chooseDefaultSubTrack();if(pick!=='off'||subPrefLang==='off'||++subDefaultTries>=3)subDefaultApplied=true;if(pick!=='off'||subDefaultApplied)void applySubTrack(pick);}   // RC472: a first batch without the preferred language no longer ends the default for good
 });
}
subSel.addEventListener('change',()=>{void applySubTrack(subSel.value);});

/* RC444  HLS MASTER WITHOUT .vtt SUBTITLE ENTRIES.
 * hentaihaven's master playlist lists its subtitles as  #EXT-X-MEDIA:TYPE=SUBTITLES,URI="s/en.vtt"  (a WebVTT FILE, not an HLS playlist). hls.js loads
 * the default one as a playlist, fails with a FATAL "levelParsingError: Missing format identifier #EXTM3U" and aborts the video downloads, so the video
 * stayed at 0:00 (or recovered only after "HLS reconnecting" messages). Now the master is read first: its .vtt subtitle entries are taken out (they
 * become tracks of the subtitle selector instead) and the playlist is handed to hls.js with every address made absolute (as a blob: URL). A master
 * without such entries, or any failure here, uses the original address unchanged. */
async function hibPrepareHlsSource(url){
 try{
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);
  let text;
  try{const r=await fetch(url,{credentials:'include',signal:ctrl.signal});if(!r.ok)return url;text=await r.text();}finally{clearTimeout(timer);}
  if(!/^#EXTM3U/.test(text)||!/#EXT-X-STREAM-INF/.test(text))return url;
  const subs=[],out=[];
  const abs=u=>{try{return new URL(u,url).href;}catch(_){return u;}};
  for(const line of text.split(/\r?\n/)){
   if(/^#EXT-X-MEDIA:/.test(line)&&/TYPE=SUBTITLES/i.test(line)){
    const uri=(line.match(/URI="([^"]+)"/i)||[])[1];
    if(uri&&/\.vtt(?:[?#]|$)/i.test(uri)){
     subs.push({kind:'vtt',url:abs(uri),name:(line.match(/NAME="([^"]*)"/i)||[])[1],language:(line.match(/LANGUAGE="([^"]*)"/i)||[])[1]});
     continue;                                           // dropped from the playlist hls.js sees
    }
   }
   if(line.startsWith('#')){
    out.push(line.replace(/URI="([^"]+)"/g,(m,u)=>'URI="'+abs(u)+'"').replace(/,SUBTITLES="[^"]*"/,''));
   }else out.push(line.trim()?abs(line.trim()):line);
  }
  if(!subs.length)return url;
  registerSubTracks(subs.map(x=>({kind:'vtt',url:x.url,name:x.name,language:x.language,label:x.name||x.language})));
  trace('HLS_MASTER_REWRITTEN',{subtitleEntries:subs.length});
  return URL.createObjectURL(new Blob([out.join('\n')],{type:'application/vnd.apple.mpegurl'}));
 }catch(e){trace('HLS_MASTER_REWRITE_FAILED',{error:String(e).slice(0,120)});return url;}
}
async function attachManifestCaptions(subtitleEntries){
 // An EXT-X-MEDIA subtitle entry may point straight at a WebVTT file instead of an HLS subtitle playlist; hls.js cannot play that, so it is loaded here.
 for(const entry of (subtitleEntries||[]).slice(0,4)){
  let vtt;try{const u=new URL(entry?.url||'');if(u.protocol!=='https:'||!/\.vtt$/i.test(u.pathname))continue;vtt=u.href;}catch(_){continue;}
  try{console.info('[HIB 1.0.1 caption]','MANIFEST_VTT',new URL(vtt).pathname);const r=await fetch(vtt,{credentials:'omit'});if(!r.ok)throw Error('HTTP '+r.status);const text=await r.text();if(!/^WEBVTT(?:\s|$)/.test(text.replace(/^﻿/,'')))throw Error('Subtitle response is not WebVTT');attachDirectVtt(text,entry.name||entry.lang||'Subtitles');console.info('[HIB 1.0.1 caption]','SUBTITLES_READY');send('status',{code:'SUBTITLES_READY'});return;}
  catch(e){console.warn('[HIB 1.0.1 caption]','SUBTITLE_FETCH',String(e));send('error',{code:'SUBTITLE_FETCH',detail:String(e)});}
 }
}
// The player must play whatever a video site's scan verified, however the address is written. An address that does not look like a plain
// video file is checked by its first bytes: "#EXTM3U" is HLS, "<MPD" is DASH (an extension-less /hls/<id> address, a /stream/<token> ...).
async function sniffEngine(url,engine){
 if(engine!=='html5'||/\.(?:mp4|m4v|webm|ogv|ogg|mov|mkv)(?:[?#]|$)/i.test(url))return engine;
 try{
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),4000);
  try{
   const r=await fetch(url,{headers:{Range:'bytes=0-2047'},credentials:'include',signal:ctrl.signal});
   const ct=(r.headers.get('content-type')||'').toLowerCase();
   const head=(await r.text()).slice(0,2048).replace(/^﻿/,'').trimStart();
   if(head.startsWith('#EXTM3U')||/mpegurl/.test(ct)){trace('SNIFFED_HLS',{url});return 'hls';}
   if(/<MPD[\s>]/i.test(head)||/dash\+xml/.test(ct)){trace('SNIFFED_DASH',{url});return 'dash';}
  }finally{clearTimeout(timer);}
 }catch(e){trace('SNIFF_FAILED',{error:String(e).slice(0,80)});}
 return engine;
}
// RC355: isolated HEVC-on-native-decode-failure bridge. No HLS/DASH interception.
let rc355FallbackActive=false,rc355FallbackPending=false,rc355FallbackFrame=null;
async function rc355TryHevcFallback(){
 if(rc355FallbackActive||rc355FallbackPending||engine!=='html5'||!lastSource?.url)return;
 let url;try{url=new URL(lastSource.url);}catch(_){return;}
 if(url.protocol!=='https:'||!/.mp4$/i.test(url.pathname))return;
 if(video.error?.code!==3)return; // decode error, not network/access failures
 rc355FallbackPending=true;
 try{
  const r=await fetch(url.href,{headers:{Range:'bytes=0-8191'},cache:'no-store',credentials:'omit'});
  if(!r.ok||![200,206].includes(r.status))throw Error('HEVC header HTTP '+r.status);
  if(r.status===200&&Number(r.headers.get('content-length'))>1048576){await r.body?.cancel();throw Error('Range unsupported for header probe');}
  const raw=await r.arrayBuffer();
  const bytes=new Uint8Array(raw.slice(0,Math.min(raw.byteLength,8192)));
  const str=new TextDecoder('latin1').decode(bytes);
  if(!/hvc1|hev1/.test(str)){trace('RC355_HEVC_NOT_FOUND');return;}
  trace('RC355_HEVC_HEADER_DETECTED',{source:url.origin+url.pathname});
  status('HEVC_NEEDS_SYSTEM_DECODER','This video is HEVC and Firefox cannot decode it on this computer. Install HEVC Video Extensions from the Microsoft Store (Windows), then reload.');
  trace('RC355_HEVC_SYSTEM_DECODER_NEEDED');
 }catch(e){trace('RC355_HEVC_FALLBACK_UNAVAILABLE',{reason:String(e)});}
 finally{rc355FallbackPending=false;}
}
function start(url,selected){
 trace('START_REQUEST',{url,selected});
 if(started)return;started=true;recoveryAttempts=0;hlsParsingFailures=0;invalidKeyResponse=false;clearRecovery();engine=selected;lastSource={url,selected};
 if(selected==='html5'){console.info('[HIB 1.0.1 caption]','DIRECT_VIDEO_NO_EXTERNAL_TRACK_IN_SOURCE_CONTRACT',new URL(url).hostname);video.src=url;playWhenBuffered();return;}
 if(selected==='dash'){
  if(typeof dashjs==='undefined'||typeof dashjs.MediaPlayer!=='function'){
   started=false;status('NO_DASH','DASH engine unavailable');send('error',{code:'NO_DASH'});return;
  }
  try{
   dash=dashjs.MediaPlayer().create();
   const E=dashjs.MediaPlayer.events;
   dash.on(E.STREAM_INITIALIZED,()=>{trace('DASH_STREAM_INITIALIZED');status('DASH_READY');playWhenBuffered();});
   dash.on(E.ERROR,e=>{trace('DASH_ERROR',{error:String(e?.error?.message||e?.event?.message||e?.error?.code||'DASH_ERROR')});traceFailure('DASH_ERROR');const detail=String(e?.error?.message||e?.event?.message||e?.error?.code||'DASH_ERROR');status('DASH_ERROR',detail);send('error',{code:'DASH_ERROR',detail});if(/pars|manifest|load/i.test(detail))needFresh('dash '+detail,true);   /* 3.0.1: some streaming sites hand out several mirror hosts and one of them answers with a web page instead of the manifest: scan again, the page picks another host */});
   for(const [key,eventName] of Object.entries(E)){
    if(!/ERROR|FRAGMENT|MANIFEST|BUFFER|QUALITY|PLAYBACK/.test(key)||key==='ERROR')continue;
    dash.on(eventName,e=>trace('DASH_'+key,{type:e?.type,error:e?.error?.message||null}));
   }
   // RC474: keep what was already played (seeking back reuses it instead of fetching again; dash.js keeps only 20 s behind the playhead by default) and buffer further ahead, like the HLS path does
   try{dash.updateSettings({streaming:{buffer:{bufferToKeep:1800,bufferPruningInterval:60,bufferTimeAtTopQuality:120,bufferTimeAtTopQualityLongForm:180}}});}catch(e){trace('DASH_SETTINGS_FAILED',{error:String(e)});}
   try{dash.on(E.FRAGMENT_LOADING_COMPLETED,e=>{const rq=e&&e.request;if(!rq||rq.type!=='MediaSegment'||!rq.url)return;pfJudge(rq);pfLastSeg.set(String(rq.mediaType||'x'),rq.url);if(Number.isFinite(rq.startTime)&&rq.duration>0)pfDashInfo[String(rq.mediaType||'x')]={url:rq.url,start:rq.startTime,dur:rq.duration};pfTick();});}catch(_){}   // RC479
   dash.initialize(video,url,false);
   status('DASH_LOADING','Loading DASH manifest…');
  }catch(e){started=false;status('DASH_INIT_FAILED',String(e));send('error',{code:'DASH_INIT_FAILED',detail:String(e)});}
  return;
 }
 if(selected!=='hls'){send('error',{code:'INVALID_ENGINE'});return;}
 if(typeof Hls==='undefined'){started=false;status('NO_HLS','HLS engine unavailable');return;}
 if(Hls.isSupported()){
  // RC100: Inspect HLS key-response integrity without recording or exporting key bytes.
  const HlsBaseLoader=Hls.DefaultConfig.loader;
  class HIBKeyIntegrityLoader extends HlsBaseLoader {
   load(context,config,callbacks){
    if(context?.type!=='key')return super.load(context,config,callbacks);
    const startedAt=performance.now();
    trace('HLS_KEY_REQUEST',{host:(()=>{try{return new URL(context.url).hostname}catch(_){return null}})(),signed:(()=>{try{return new URL(context.url).searchParams.has('key')}catch(_){return false}})()});
    const wrapped={...callbacks,onSuccess:(response,stats,ctx,networkDetails)=>{
     const raw=response?.data;
     const length=raw instanceof ArrayBuffer?raw.byteLength:ArrayBuffer.isView(raw)?raw.byteLength:typeof raw==='string'?raw.length:null;
     let looksLikeHTML=false;
     if(typeof raw==='string')looksLikeHTML=/^\s*<(?:!doctype|html|head|body)/i.test(raw);
     else if(raw instanceof ArrayBuffer||ArrayBuffer.isView(raw)){
      const bytes=new Uint8Array(raw instanceof ArrayBuffer?raw:raw.buffer,raw instanceof ArrayBuffer?0:raw.byteOffset,Math.min(32,length||0));
      const prefix=String.fromCharCode(...bytes);
      looksLikeHTML=/^\s*<(?:!doctype|html|head|body)/i.test(prefix);
     }
     const sample=raw instanceof ArrayBuffer?new Uint8Array(raw,0,Math.min(24,raw.byteLength)):ArrayBuffer.isView(raw)?new Uint8Array(raw.buffer,raw.byteOffset,Math.min(24,raw.byteLength)):typeof raw==='string'?new TextEncoder().encode(raw.slice(0,24)):new Uint8Array(0);
     const prefix=Array.from(sample).map(b=>String.fromCharCode(b)).join('');
     const signature=looksLikeHTML?'html':prefix.startsWith('\x89PNG')?'png':prefix.startsWith('GIF8')?'gif':prefix.startsWith('%PDF')?'pdf':prefix.startsWith('PK\x03\x04')?'zip':prefix.startsWith('\x1f\x8b')?'gzip':/^\s*[{[]/.test(prefix)?'json-possible':/^\s*</.test(prefix)?'markup-possible':sample.length&&sample[0]===0x47?'mpegts-possible':'unknown';
     let contentType=null;
     try{contentType=networkDetails?.getResponseHeader?.('content-type')||null;}catch(_){}
     trace('HLS_KEY_RESPONSE_INTEGRITY',{length,validAES128Length:length===16,looksLikeHTML,signature,contentType,elapsedMs:Math.round(performance.now()-startedAt)});
     if(length!==16){
      invalidKeyResponse=true;
      trace('HLS_INVALID_AES_KEY_RESPONSE',{length,signature,contentType,keyHost:(()=>{try{return new URL(context.url).hostname}catch(_){return null}})()});
      traceFailure('HLS_INVALID_AES_KEY_RESPONSE');
      clearRecovery();
      hls?.stopLoad();
      status('HLS_INVALID_AES_KEY_RESPONSE','Encrypted HLS key response was '+length+' bytes; expected 16.');
      // Reject invalid key material before hls.js attempts WebCrypto decryption.
      return callbacks.onError({code:200,text:'Invalid AES-128 key response length',url:context.url},ctx,networkDetails,stats);
     }
     return callbacks.onSuccess(response,stats,ctx,networkDetails);
    },onError:(response,ctx,networkDetails,stats)=>{
     trace('HLS_KEY_RESPONSE_FAILURE',{status:response?.code||null,elapsedMs:Math.round(performance.now()-startedAt)});
     return callbacks.onError(response,ctx,networkDetails,stats);
    }};
    return super.load(context,config,wrapped);
   }
  }
  hls=new Hls({enableWorker:false,loader:HIBKeyIntegrityLoader,maxBufferLength:120,maxMaxBufferLength:180,maxBufferSize:120*1000*1000,backBufferLength:3600});   // RC456: keep already played data (seeking back reuses it instead of fetching again)
  hls.on(Hls.Events.KEY_LOADED,(_evt,data)=>{
   const key=data?.frag?.decryptdata?.key;
   trace('HLS_KEY_LOADED',{keyLength:key?.byteLength??key?.length??null,validAES128Length:(key?.byteLength??key?.length)===16});
  });
  // A manifest whose subtitle entries are direct WebVTT files: hls.js must not manage subtitles, the shared VTT loader does.
  let directVtt=false;
  hls.on(Hls.Events.MANIFEST_LOADED,(_event,data)=>{
   const subs=(data?.subtitles||[]).filter(x=>/\.vtt(?:$|[?#])/i.test(String(x?.url||'')));
   if(subs.length){directVtt=true;registerSubTracks(subs.map(x=>({kind:'vtt',url:String(x.url),name:x.name,language:x.lang||x.language,label:x.name||x.lang})));}   // RC441: all manifest tracks, default language chosen by setting
  });
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED,()=>{if(hls&&directVtt)hls.subtitleTrack=-1;});
  hls.on(Hls.Events.FRAG_LOADED,(_e,d)=>{try{const f=d&&d.frag;if(!f||f.type!=='main')return;const det=hls.levels&&hls.levels[f.level]&&hls.levels[f.level].details;if(det)pfHls={det,sn:f.sn};pfTick();}catch(_){}});   // RC483
  hls.on(Hls.Events.MEDIA_ATTACHED,()=>{trace('HLS_MEDIA_ATTACHED');hibPrepareHlsSource(url).then(u=>{if(hls)hls.loadSource(u);});});
  hls.on(Hls.Events.MANIFEST_PARSED,()=>{
   if(directVtt && hls)hls.subtitleTrack=-1;
   playWhenBuffered();
  });
  hls.on(Hls.Events.MANIFEST_PARSED,(_event,data)=>{
   const tracks=(data?.levels||hls?.levels||[]).map(x=>({width:x?.width,height:x?.height,videoCodec:x?.videoCodec,audioCodec:x?.audioCodec,codecSet:x?.codecSet,url:Array.isArray(x?.url)?x.url.slice(0,2):x?.url}));
   recordDiagnostic('HLS_MANIFEST',{source:url,levels:tracks});
   console.info('[HIB TEST RC85] HLS_MANIFEST',{source:url,hlsVersion:Hls.version,levels:tracks,audioTracks:(hls?.audioTracks||[]).map(x=>({name:x.name,lang:x.lang,url:x.url}))});
  });
  hls.on(Hls.Events.FRAG_LOADED,(_event,data)=>{
   const f=data?.frag;trace('HLS_FRAG_LOADED',{sn:f?.sn,type:f?.type,level:f?.level,url:f?.url,bytes:data?.payload?.byteLength,loaded:data?.stats?.loaded,total:data?.stats?.total});
   if(f?.sn===0||f?.sn===1) console.info('[HIB TEST RC85] FRAGMENT',{sn:f.sn,type:f.type,level:f.level,url:f.url,stats:{loaded:data?.stats?.loaded,total:data?.stats?.total},payloadBytes:data?.payload?.byteLength});
  });
  hls.on(Hls.Events.ERROR,(_e,data)=>{
   const detail=String(data?.details||'HLS_ERROR');
   const f=data?.frag;
   const diagnostic={source:url,detail,type:data?.type,fatal:!!data?.fatal,reason:String(data?.reason||''),error:String(data?.error?.message||''),fragment:f?{sn:f.sn,type:f.type,level:f.level,url:f.url,cc:f.cc,start:f.start,duration:f.duration}:null,response:data?.response?{code:data.response.code,text:data.response.text,url:data.response.url}:null,video:{readyState:video.readyState,paused:video.paused,currentTime:video.currentTime,buffered:video.buffered.length},hlsVersion:Hls.version};
   recordDiagnostic('HLS_ERROR',diagnostic);if(data?.fatal)traceFailure('HLS_FATAL_'+detail);
   console.error('[HIB TEST RC85] HLS_FRAGMENT_DIAGNOSTIC',diagnostic);
   send('error',{code:'RC85_HLS_DIAGNOSTIC',detail:JSON.stringify(diagnostic)});
   send('diagnostic-event',{event:diagnostic});
   /* RC468: refused playlist / segment before anything played: ask the background to add the Referer for this host, then restart loading (once) */
   if(!window.__hibRefTried&&/^(?:frag|level|manifest)LoadError$/.test(detail)&&[401,403,404,410,412].includes(Number(data?.response?.code))&&!(video.buffered.length>0)){
    window.__hibRefTried=1;
    browser.runtime.sendMessage({type:'hib-rc468-need-referer',url}).then(r=>{if(r&&r.ok){trace('HLS_REFERER_RETRY',{flagged:r.flagged});setTimeout(()=>{try{hls.startLoad(-1);}catch(_){}},400);}}).catch(()=>{});
   }
   if(invalidKeyResponse){hls.stopLoad();return;}
   if(detail==='keyLoadError' && Number(data?.response?.code)===403){
     trace('HLS_KEY_ACCESS_DENIED',{httpStatus:403,detail:'AES-128 key request rejected by source server',keyHost:(()=>{try{return new URL(data?.response?.url).hostname}catch(_){return null}})()});
     traceFailure('HLS_KEY_ACCESS_DENIED');
     clearRecovery();
     hls.stopLoad();
     status('HLS_KEY_ACCESS_DENIED','Playback blocked: source server denied access to the HLS decryption key (HTTP 403).');
     return;
   }
   if(/fragParsingError|remuxAllocError|bufferAppendError/.test(detail)){
      hlsParsingFailures++;
      if(hlsParsingFailures>=3){traceFailure('HLS_FRAGMENT_PARSE_FAILURE');clearRecovery();hls.stopLoad();status('HLS_FORMAT_INCOMPATIBLE','HLS fragment parsing failed repeatedly. Player diagnostics saved automatically.');return;}
   }

   // RC441/RC444: an error that belongs to a SUBTITLE track (a .vtt answered as a playlist: "levelParsingError ... Missing format identifier #EXTM3U") is not a
   // video error and must never show "HLS recovery failed". BUT hls.js treats it as FATAL and aborts the video downloads too, so the video would stay at 0:00
   // forever: the subtitle track is switched off and loading is restarted quietly (no message, at most 6 times). The subtitle selector serves those tracks.
   {const errUrl=String(data?.url||data?.context?.url||data?.response?.url||'');
    if(data?.context?.type==='subtitle'||/\.vtt(?:[?#]|$)/i.test(errUrl)||subTracks.some(t=>t.url&&t.url===errUrl)){
     trace('HLS_SUBTITLE_TRACK_ERROR_QUIET_RESTART',{detail,url:errUrl.slice(0,160)});
     if(hls&&started&&(window.__hibSubErr=(window.__hibSubErr||0)+1)<=6){try{hls.subtitleTrack=-1;}catch(_){}try{hls.startLoad(-1);}catch(_){}}
     return;}}
   send('error',{code:detail,detail:String(data?.reason||data?.type||'')});
   if(!data?.fatal)return;
   if(!video.paused&&!video.ended&&video.readyState>=2){send('status',{code:'HLS_ERROR_WITH_ACTIVE_PLAYBACK',detail});return;}
   const recoverable=data.type===Hls.ErrorTypes.NETWORK_ERROR||data.type===Hls.ErrorTypes.MEDIA_ERROR;
   if(!recoverable){status('PLAYBACK_ERROR','HLS playback error: '+detail);return;}
   if(recoveryTimer!==null)return;
   // RC443: no message on screen while the player quietly retries; the error box appears ONLY when the video really cannot play (nothing buffered and
   // not playing). Before, "HLS reconnecting (attempt 2/3)" / "recovery failed" were shown during the normal buffer-then-play start.
   const videoAlive=()=>(!video.paused&&!video.ended&&video.readyState>=2)||(video.buffered.length>0&&video.buffered.end(video.buffered.length-1)>1);
   if(recoveryAttempts>=3){if(videoAlive()){trace('HLS_RECOVERY_FAILED_BUT_VIDEO_ALIVE',{detail});return;}status('PLAYBACK_ERROR','HLS recovery failed after 3 attempts: '+detail);return;}
   const attempt=++recoveryAttempts;
   send('status',{code:'RECOVERING',detail:'HLS reconnecting (attempt '+attempt+'/3)'});trace('HLS_RECOVERING',{attempt,detail});
   recoveryTimer=setTimeout(()=>{recoveryTimer=null;if(!hls||!started)return;try{
     if(data.type===Hls.ErrorTypes.NETWORK_ERROR)hls.startLoad();
     else hls.recoverMediaError();
   }catch(e){status('PLAYBACK_ERROR','HLS recovery failed: '+String(e));}},Math.min(4000,500*2**(attempt-1)));
  });
  for(const [key,eventName] of Object.entries(Hls.Events)){
   if(!/MANIFEST|LEVEL|AUDIO_TRACK|FRAG_|BUFFER_|INIT_PTS|MEDIA_DETACHED/.test(key)||['FRAG_LOADED','MANIFEST_PARSED'].includes(key))continue;
   hls.on(eventName,(_evt,data)=>{const f=data?.frag;trace('HLS_'+key,{frag:f?{sn:f.sn,type:f.type,level:f.level,url:f.url}:null,level:data?.level,details:data?.details?{live:!!data.details.live,totalduration:Number(data.details.totalduration)||null,fragmentCount:data.details.fragments?.length||0,targetduration:Number(data.details.targetduration)||null,encrypted:!!data.details.fragments?.[0]?.levelkeys}:null,buffered:Number.isFinite(video.currentTime)?video.currentTime:null});});
  }
  hls.attachMedia(video);
 }else if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=url;playWhenBuffered();}
 else {started=false;status('NO_HLS','HLS unsupported by this Firefox configuration');}
}
window.addEventListener('message',e=>{
 if(e.source!==parent||!/^https:\/\//i.test(e.origin)&&!/^moz-extension:\/\//i.test(e.origin))return;
 const d=e.data;if(d?.bridge!==BRIDGE)return;
 if(d.type==='capture-diagnostics'){trace('MANUAL_CAPTURE');void persistTrace('MANUAL_CAPTURE');return;}
 /* RC509: Report Issue / Submit Request ask the OPEN player for its trace (nothing is saved, nothing is downloaded); the last 150 events only. */
 if(d.type==='report-trace'){try{const r=playerDiagnostics();if(Array.isArray(r.history))r.history=r.history.slice(-150);send('report-trace-result',{report:r});}catch(e){send('report-trace-result',{report:null,error:String(e)});}return;}
 if(d.type==='request-ready'){send('ready');return;}
 if(d.type==='replace-source'){replaceSource(d.url);return;}
 if(d.type==='open'){try{window.focus();document.body.setAttribute('tabindex','-1');document.body.focus({preventScroll:true});}catch(_){}}   // RC507: keys go to the player from the start (handling of 'open' continues below)
 if(d.type==='shortcut'){playbackKey(d.key);return;}
 if(d.type==='settings'){applyPlayerSettings(d);return;}
 if(d.type==='destroy'){stop();return;}
 if(d.type==='subtitle-tracks'){try{window.hibAssSubtitles&&window.hibAssSubtitles.setPageFonts(d.fonts);}catch(_){}registerSubTracks(Array.isArray(d.tracks)?d.tracks:[]);return;}   // RC441
 if(d.type==='subtitles'){if(typeof d.text==='string'&&d.text.startsWith('WEBVTT'))attachDirectVtt(d.text,d.label);return;}
 if(d.type==='ass-subtitle-url'){
  (async()=>{try{
   const u=new URL(d.url);if(u.protocol!=='https:'||!u.pathname.toLowerCase().endsWith('.ass'))throw Error('Invalid ASS URL');
   const response=await fetch(u.href,{credentials:'omit'});if(!response.ok)throw Error('HTTP '+response.status);
   const txt=await response.text();if(txt.length>3000000||!/^\s*(?:\uFEFF)?\[Script Info\]/i.test(txt))throw Error('Not an ASS subtitle document');
   (window.hibDlExtra=window.hibDlExtra||[]).push({name:'subtitles',ext:'ass',text:txt});const count=window.hibAssSubtitles.attach(txt);captions.hidden=false;captions.disabled=false;captions.title='Toggle ASS subtitles';
   status('ASS_SUBTITLES_READY',count+' subtitle events');
  }catch(error){send('error',{code:'ASS_SUBTITLES_FAILED',detail:String(error)});}})();return;
 }
 if(d.type!=='open'||started)return;
 let url;try{url=new URL(d.url);}catch(_){send('error',{code:'INVALID_URL'});return;}
 if(url.protocol!=='https:'||!['hls','html5','dash'].includes(d.engine)){send('error',{code:'UNSUPPORTED_SOURCE'});return;}
 resumeUrl=url.href;resumeDone=false;
 useAudio(d.audio);sniffEngine(url.href,d.engine).then(e=>start(url.href,e));
});
/* RC449: RESUME. The play position is saved (per episode address without its query string) every few seconds and when the player closes, and
 * restored when the same video is opened again, so closing the player and coming back continues where it stopped. Nothing but the position is kept. */
const RESUME_KEY='hibResumePositions';
let resumeUrl='',resumeDone=true,resumeSaved=0;
const resumeId=u=>{try{const x=new URL(u);return x.origin+x.pathname;}catch(_){return u;}};
// stores the playback position (also sent to the page script, which writes it reliably)
function saveResume(force){
 if(!resumeUrl||!started)return;
 const t=video.currentTime,d=video.duration;
 if(!Number.isFinite(t)||!Number.isFinite(d)||d<60)return;
 if(!force&&Math.abs(t-resumeSaved)<3)return;
 resumeSaved=t;
 const id=resumeId(resumeUrl);
 /* RC496: the position is ALSO sent to the page (hib-resume), whose script outlives this iframe and writes it to the store: a write started while the iframe is being removed
  * (pressing X) can be lost, which made the last position vanish. A position under 8 s never erases a saved one (closing at once must not forget where the video was). */
 if(t>=8&&t<=d-20)send('resume-pos',{key:id,t:Math.round(t*10)/10,d:Math.round(d)});
 if(t<8)return;
 browser.storage.local.get(RESUME_KEY).then(v=>{
  const all=v&&v[RESUME_KEY]&&typeof v[RESUME_KEY]==='object'?v[RESUME_KEY]:{};
  if(t>d-20)delete all[id];else all[id]={t:Math.round(t*10)/10,d:Math.round(d),at:Date.now()};
  const now=Date.now();for(const k of Object.keys(all))if(!all[k]||now-all[k].at>30*86400000)delete all[k];
  const ks=Object.keys(all);if(ks.length>300)for(const k of ks.sort((x,y)=>all[x].at-all[y].at).slice(0,ks.length-300))delete all[k];
  return browser.storage.local.set({[RESUME_KEY]:all});
 }).catch(()=>{});
}
video.addEventListener('timeupdate',()=>saveResume(false));
video.addEventListener('pause',()=>saveResume(true));
window.addEventListener('pagehide',()=>saveResume(true));
/* RC457: RESUME is applied only once the video is really PLAYING from the start (never while the start gate waits or while the first data is loading), and it is
 * abandoned (back to 0:00, playback continues) when the seek does not complete within 8 s, so an address that cannot seek can never hold the player on 'Buffering'. */
let resumeTarget=null;
video.addEventListener('loadedmetadata',()=>{
 if(resumeDone||!resumeUrl)return;resumeDone=true;
 const id=resumeId(resumeUrl);
 browser.storage.local.get(RESUME_KEY).then(v=>{
  const r=v&&v[RESUME_KEY]&&v[RESUME_KEY][id];
  if(r&&Number.isFinite(r.t)&&r.t>=8&&Number.isFinite(video.duration)&&r.t<video.duration-20)resumeTarget=r.t;
 }).catch(()=>{});
});
video.addEventListener('playing',()=>{
 if(resumeTarget===null)return;
 const t=resumeTarget;resumeTarget=null;
 if(video.currentTime>3)return;                // the user already moved on
 let done=false;
 const fin=()=>{done=true;video.removeEventListener('seeked',fin);};
 video.addEventListener('seeked',()=>{if(!done){fin();status('RESUMED','Resumed at '+stamp(t));}},{once:true});
 try{video.currentTime=t;}catch(_){return;}
 setTimeout(()=>{if(done)return;done=true;if(video.currentTime<1||video.readyState<3){try{video.currentTime=0;}catch(_){}status('RESUME_SKIPPED','Could not resume - playing from the start');}},8000);
});
video.addEventListener('volumechange',()=>{if(!volumeEditing)showAudio();});
volume.addEventListener('input',()=>{volumeEditing=true;video.volume=Number(volume.value)/100;if(video.muted&&video.volume>0)video.muted=false;showAudio();volumeEditing=false;});
mute.addEventListener('click',()=>{video.muted=!video.muted;showAudio();});
/* RC479 / RC483: ADAPTIVE SEGMENT PREFETCH (DASH / HLS). A segmented stream is fetched one segment at a time, so on a server that answers only about as fast as
 * the video plays the read-ahead never gets going. The next segments are requested in parallel into the browser's HTTP cache; the player's own request for them is
 * then answered from the cache at once. The effort follows the buffer: SHORT buffer (< 15 s) = 6 requests at once, 14 segments ahead; 15-45 s = 3 at once; 45-100 s =
 * 1 at a time; more than 100 s ahead = idle. A seek drops the queued (now useless) requests and the new position is fed first. Nothing is stored by HIB; if the
 * prefetched segments do not come back fast from the cache (cache disabled / not cacheable) the prefetch switches itself off so it never doubles the traffic. */
const pfDone=new Set(),pfSeen=new Set(),pfStore=new Map(),pfEnd=new Set();let pfBytes=0,pfServed=0;const PF_CAP=600*1024*1024;
/* RC485: IN-MEMORY SEGMENT STORE (current video only). Prefetched segments live here, not in the browser's disk cache, and are served to the player's own requests by the XHR
 * hook below. Everything is dropped when the player is closed (X) or the tab goes away; only the saved mark / player type / source / duration / position remain. */
function pfKey(u){return String(u).replace(/\d+(?=\.[a-z0-9]{2,5}(?:[?#]|$))/i,'#');}
function pfPut(u,b){if(pfStore.has(u))return;pfStore.set(u,b);pfBytes+=b.byteLength;pfDone.add(u);while(pfBytes>PF_CAP&&pfStore.size>1){const k=pfStore.keys().next().value;pfBytes-=pfStore.get(k).byteLength;pfStore.delete(k);}}
function pfClear(){pfStore.clear();pfBytes=0;pfDone.clear();pfSeen.clear();pfEnd.clear();pfQueue.length=0;}
(function(){const Real=window.XMLHttpRequest;if(!Real||Real.__hib)return;
 function HibXHR(){const x=new Real();let hit=false,url='',method='GET',hdr=false;const fk={readyState:0,status:0,statusText:'',response:null,responseURL:''};
  const call=(n,e)=>{try{const f=x[n];if(typeof f==='function')f.call(p,e);}catch(_){}};
  const p=new Proxy(x,{
   get(t,k){
    if(hit&&(k==='readyState'||k==='status'||k==='statusText'||k==='response'||k==='responseURL'))return fk[k];
    if(k==='open')return function(m,u,...r){method=String(m).toUpperCase();url=String(u);hit=false;hdr=false;return t.open(m,u,...r);};
    if(k==='setRequestHeader')return function(n,v){if(/^range$/i.test(n))hdr=true;return t.setRequestHeader(n,v);};
    if(k==='send')return function(b){
     if(method==='GET'&&!hdr&&t.responseType==='arraybuffer'&&pfStore.has(url)){
      hit=true;pfServed++;const buf=pfStore.get(url).slice(0);fk.readyState=4;fk.status=200;fk.statusText='OK';fk.response=buf;fk.responseURL=url;
      setTimeout(()=>{if(!hit)return;const ev=(type)=>({type,target:p,currentTarget:p,loaded:buf.byteLength,total:buf.byteLength,lengthComputable:true});call('onreadystatechange',ev('readystatechange'));call('onprogress',ev('progress'));call('onload',ev('load'));call('onloadend',ev('loadend'));},0);
      return;}
     return t.send(b);};
    if(k==='getResponseHeader')return n=>hit?(/^content-length$/i.test(n)?String(fk.response.byteLength):null):t.getResponseHeader(n);
    if(k==='getAllResponseHeaders')return ()=>hit?('content-length: '+fk.response.byteLength+'\r\n'):t.getAllResponseHeaders();
    if(k==='abort')return ()=>{hit=false;try{t.abort();}catch(_){}};
    const v=t[k];return typeof v==='function'?v.bind(t):v;},
   set(t,k,v){t[k]=v;return true;}});
  return p;}
 HibXHR.__hib=true;HibXHR.prototype=Real.prototype;window.XMLHttpRequest=HibXHR;})();let pfQueue=[],pfBusy=0,pfPauseUntil=0,pfOff=false,pfHit=0,pfMiss=0,pfConc=3,pfSeg=10;const pfLastSeg=new Map();let pfHls=null;
// starts queued prefetch requests, up to the current concurrency (pfConc)
/* 3.1: only a real END of the stream (404 / 410 / 416: no such segment) marks the numbered family as finished. Before, ANY failed request (429 / 5xx / a dropped
 * connection) did that, and the prefetch (the green "cache" bar) then stopped for the rest of the video. Other failures put the address back and rest 6 s. */
function pfFail(u){pfSeen.delete(u);pfPauseUntil=Date.now()+6000;}
function pfPump(){if(pfOff){pfQueue.length=0;return;}
 if(Date.now()<pfPauseUntil)return;
 while(pfBusy<pfConc&&pfQueue.length){const u=pfQueue.shift();pfBusy++;fetch(u).then(r=>{if(r.ok)return r.arrayBuffer();if(r.status===404||r.status===410||r.status===416)return null;pfFail(u);return undefined;}).then(b=>{if(b)pfPut(u,b);else if(b===null)pfEnd.add(pfKey(u));}).catch(()=>{pfFail(u);}).finally(()=>{pfBusy--;pfPump();});}}
// queues segment addresses for prefetch (known / already ended ones are skipped)
function pfAdd(urls){for(const u of urls){if(!u||pfSeen.has(u)||pfEnd.has(pfKey(u)))continue;if(pfSeen.size>900){pfSeen.clear();}pfSeen.add(u);pfQueue.push(u);}pfPump();}
// seconds of video buffered ahead of the playhead
function pfAheadSeconds(){try{let e=0;for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=video.currentTime+1)e=Math.max(e,video.buffered.end(i));return e-video.currentTime;}catch(_){return 0;}}
// the next segment addresses: the number in an address counted up (from +from to +count)
function pfNumbered(url,count,from){const m=/^(.*?)(\d+)(\.[a-z0-9]{2,5})?([?#].*)?$/i.exec(String(url));if(!m)return[];const w=m[2].length,n=Number(m[2]),out=[];for(let i=(from||1);i<=count;i++)out.push(m[1]+String(n+i).padStart(w,'0')+(m[3]||'')+(m[4]||''));return out;}
// counts whether a prefetched segment came back fast from the cache (information only)
function pfJudge(rq){try{if(!pfDone.has(rq.url)||pfOff)return;const es=performance.getEntriesByName(rq.url),e=es.length?es[es.length-1]:null;if(!e)return;if(e.duration<250)pfHit++;else pfMiss++;}catch(_){}}
// the adaptive controller: sets concurrency / look-ahead from the buffer and tops the queue up
function pfTick(){
 try{
  if(pfOff||!started)return;
  const ahead=pfAheadSeconds();
  if(ahead<3){pfConc=1;pfSeg=3;}else if(ahead<15){pfConc=5;pfSeg=14;}else if(ahead<45){pfConc=3;pfSeg=10;}else if(ahead<100){pfConc=2;pfSeg=10;}else{pfConc=2;pfSeg=40;}   // buffer comfortable: keep filling the whole video at one request at a time (until the memory cap)
  for(const last of pfLastSeg.values())pfAdd(pfNumbered(last,pfSeg+1,2));   // from +2: +1 is what the player asks for itself right away
  if(pfHls){const {det,sn}=pfHls;const fr=det&&det.fragments;if(fr){const i=fr.findIndex(x=>x.sn===sn);if(i>=0)pfAdd(fr.slice(i+1,i+1+pfSeg).filter(x=>x.url&&!(x.byteRange&&x.byteRange.length)).map(x=>x.url));}}
  pfPump();
 }catch(_){}
}
setInterval(pfTick,500);
video.addEventListener('seeking',()=>{pfQueue.length=0;pfLastSeg.clear();pfHls=null;});
/* RC493: VOLUME OSD. Any volume change (keys, slider, mute, wheel on the slider) shows the level for about 1.2 s in the upper left of the picture, so the setting can be read
 * without moving to the control bar. Not shown for the player's own start-up volume. */
const volOsd=document.createElement('div');volOsd.id='hibVolOsd';
volOsd.style.cssText='position:absolute;top:10px;left:10px;z-index:4;padding:5px 10px;border-radius:6px;background:rgba(16,16,22,.82);color:#fff;font:600 15px system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .18s ease;';
$('player').appendChild(volOsd);
let volOsdArmed=0,volOsdTimer=null,volOsdLast=null;
video.addEventListener('playing',()=>{if(!volOsdArmed)volOsdArmed=Date.now()+1500;},{once:true});
video.addEventListener('volumechange',()=>{
 const level=video.muted?'m':Math.round(video.volume*100);
 if(level===volOsdLast)return;volOsdLast=level;
 if(!volOsdArmed||Date.now()<volOsdArmed)return;
 volOsd.textContent=video.muted||video.volume===0?'🔇 Muted':'🔊 Volume '+Math.round(video.volume*100)+'%';
 volOsd.style.opacity='1';clearTimeout(volOsdTimer);volOsdTimer=setTimeout(()=>{volOsd.style.opacity='0';},1200);
});
/* RC502: what the in-memory segment store holds, as time ranges [start,end] in seconds (HLS: from the playlist's segment times; DASH: from the time of the last segment the
 * player loaded and the numbering of the stored ones). Drawn green on the seek bar and counted in the 'cache N%' label, the same as the single-file copy. */
const pfDashInfo={};
function pfSegmentRuns(){
 const runs=[];
 try{
  if(engine==='hls'&&pfHls&&pfHls.det&&pfHls.det.fragments){for(const f of pfHls.det.fragments)if(pfStore.has(f.url))runs.push([f.start,f.start+f.duration]);}
  else if(engine==='dash'){
   const info=pfDashInfo.video||pfDashInfo[Object.keys(pfDashInfo)[0]];
   if(info&&info.dur>0){const re=/^(.*?)(\d+)(\.[a-z0-9]{2,5})?([?#].*)?$/i,m0=re.exec(info.url);
    if(m0){const n0=Number(m0[2]),key=pfKey(info.url);for(const u of pfStore.keys()){if(pfKey(u)!==key)continue;const mm=re.exec(u);if(!mm)continue;const st=info.start+(Number(mm[2])-n0)*info.dur;runs.push([st,st+info.dur]);}}}
  }
 }catch(_){}
 runs.sort((a,b)=>a[0]-b[0]);const out=[];
 for(const r of runs){const last=out[out.length-1];if(last&&r[0]<=last[1]+0.6)last[1]=Math.max(last[1],r[1]);else out.push(r.slice());}
 return out;
}
/* RC478: the seek bar shows how much is already buffered (lighter band ahead of the playhead), so it can be seen that the player is reading ahead. */
function paintBuffered(){
 try{const d=video.duration;if(!(d>0)||!Number.isFinite(d))return;
  const lay=(ranges,col)=>{const g=[];let pos=0;for(const [a0,b0] of ranges){const a=Math.max(0,a0/d*100),b=Math.min(100,b0/d*100);if(b<=a)continue;if(a>pos)g.push('transparent '+pos+'% '+a+'%');g.push(col+' '+a+'% '+b+'%');pos=Math.max(pos,b);}g.push('transparent '+pos+'% 100%');return 'linear-gradient(to right,'+g.join(',')+')';};
  const nat=[];for(let i=0;i<video.buffered.length;i++)nat.push([video.buffered.start(i),video.buffered.end(i)]);
  const fc=[];if(fcMap&&fcMap.length){const n=fcMap.length;let st=-1;for(let k=0;k<=n;k++){if(k<n&&fcMap[k]){if(st<0)st=k;}else if(st>=0){fc.push([st/n*d,k/n*d]);st=-1;}}}
  seek.style.setProperty('--buf',lay(nat,'#9fb0c8')+','+lay(fc,'#58a583')+',#3a3d46');
  let ahead=0;for(const [a,b] of nat)if(a<=video.currentTime+1)ahead=Math.max(ahead,b-video.currentTime);
  let txt='';if(fcMap&&fcMap.length&&!fcActive){const pct=Math.round(100*fcMap.filter(Boolean).length/fcMap.length);txt='cache '+pct+'%'+(fcFixState==='ok'?' · seek-fix ✓':fcFixState==='failed'?' · seek-fix ✗':'');}else if(fcActive)txt='cached'+(fcFixState==='ok'?' · seek-fix ✓':'');else if((engine==='hls'||engine==='dash')&&pfStore.size>2){const sr=pfSegmentRuns();let sum=0;for(const r of sr)sum+=Math.min(r[1],d)-Math.max(0,r[0]);const pct=Math.max(0,Math.min(100,Math.round(100*sum/d)));txt=pct>=99?'cached':'cache '+pct+'%';}else if(ahead>=1)txt='+'+Math.round(ahead)+'s';
  if(!aheadEl){aheadEl=document.createElement('span');aheadEl.id='hibAhead';aheadEl.style.cssText='font:11px system-ui,sans-serif;color:#9fb0c8;white-space:nowrap;margin-left:2px;';current.after(aheadEl);}
  if(aheadEl.textContent!==txt)aheadEl.textContent=txt;}catch(_){}
}
video.addEventListener('progress',paintBuffered);video.addEventListener('timeupdate',paintBuffered);video.addEventListener('loadedmetadata',paintBuffered);setInterval(paintBuffered,1000);
function syncSeek(){
 const now=video.currentTime;
 if(seekPending!==null){
   if(Math.abs(now-seekPending)<1.25 || (performance.now()-seekPendingSince)>5500){seekPending=null;}
   else {current.textContent=stamp(seekPending);return;}
 }
 if(!seekEditing){current.textContent=stamp(now);if(Number.isFinite(video.duration)&&video.duration>0)seek.value=String(Math.round(1000*now/video.duration));}
}
// Global buffered-range visualization: played / buffered-ahead / not-yet-buffered.
// Buffered range is measured from HTMLMediaElement.buffered, not guessed from download status.
const playedRange=$('playedRange'),bufferedRange=$('bufferedRange');
let lastBufferLogAt=0; let bufferedSegKey='';
function paintBuffer(){
 const total=video.duration;
 if(!Number.isFinite(total)||total<=0){playedRange.style.width='0%';bufferedRange.textContent='';bufferedSegKey='';return;}
 const t=Math.max(0,video.currentTime);
 const played=Math.max(0,Math.min(100,t/total*100));
 let contiguous=t;
 const spans=[];
 for(let i=0;i<video.buffered.length;i++){
  const a=video.buffered.start(i),b=video.buffered.end(i);
  spans.push([Math.round(a*10)/10,Math.round(b*10)/10]);
  if(a<=contiguous+0.3&&b>=contiguous)contiguous=Math.max(contiguous,b);
 }
 /* RC455: every buffered range is drawn as its own segment of the full-width layer (the old single 0..contiguous bar hid data before the playhead and any
 * range not touching it, e.g. after seeking back). Rebuilt only when the ranges change. */
 const fcRuns=[];if(typeof fcMap!=='undefined'&&fcMap&&fcMap.length&&!fcActive){const n=fcMap.length;let st=-1;for(let k=0;k<=n;k++){if(k<n&&fcMap[k]){if(st<0)st=k;}else if(st>=0){fcRuns.push([st/n*total,k/n*total]);st=-1;}}}   // RC481: the full-copy download is drawn too (green)
 if(!fcRuns.length&&(engine==='hls'||engine==='dash'))for(const r of pfSegmentRuns())fcRuns.push(r);   // RC502: and the segment store of a segmented stream
 const key=spans.map(s=>s[0]+'-'+s[1]).join(',')+'/'+Math.round(total)+'/'+fcRuns.map(r=>Math.round(r[0])+'-'+Math.round(r[1])).join(',');
 if(key!==bufferedSegKey){bufferedSegKey=key;bufferedRange.textContent='';for(const [sa,sb] of fcRuns){const seg=document.createElement('div');seg.className='bseg fc';seg.style.left=Math.max(0,sa/total*100)+'%';seg.style.width=Math.max(0,Math.min(100,sb/total*100)-Math.max(0,sa/total*100))+'%';bufferedRange.appendChild(seg);}for(const [sa,sb] of spans){const seg=document.createElement('div');seg.className='bseg';seg.style.left=Math.max(0,sa/total*100)+'%';seg.style.width=Math.max(0,Math.min(100,sb/total*100)-Math.max(0,sa/total*100))+'%';bufferedRange.appendChild(seg);}}
 playedRange.style.width=played+'%';
 bufferedRange.style.width='100%';
 seek.title=`Buffered to ${stamp(contiguous)} of ${stamp(total)}`;
 const now=performance.now();
 if(now-lastBufferLogAt>12000){
  lastBufferLogAt=now;
  console.info('[HIB 1.0.1 buffer]',JSON.stringify({engine,currentSec:Math.round(t),durationSec:Math.round(total),aheadSec:Math.max(0,Math.round(contiguous-t)),readyState:video.readyState,networkState:video.networkState,ranges:spans,preload:video.preload}));
 }
}
video.addEventListener('progress',paintBuffer);setInterval(()=>{try{paintBuffer();}catch(_){}},1000);
video.addEventListener('loadedmetadata',paintBuffer);
video.addEventListener('durationchange',paintBuffer);
video.addEventListener('seeking',paintBuffer);
video.addEventListener('seeked',paintBuffer);
video.addEventListener('timeupdate',paintBuffer);
video.addEventListener('timeupdate',syncSeek);
video.addEventListener('seeked',()=>{seekPending=null;syncSeek();if(video.readyState>=2)status('SEEK_COMPLETE');});
video.addEventListener('durationchange',()=>duration.textContent=stamp(video.duration));
seek.addEventListener('pointerdown',()=>{seekEditing=true;});
seek.addEventListener('input',()=>{seekEditing=true;if(Number.isFinite(video.duration)&&video.duration>0){seekTarget=video.duration*Number(seek.value)/1000;current.textContent=stamp(seekTarget);}});
function commitSeek(){
 if(!seekEditing)return;
 const target=seekTarget;
 seekTarget=null;seekEditing=false;
 if(target===null||!Number.isFinite(target))return;
 seekPending=target;seekPendingSince=performance.now();
 try{video.currentTime=target;}catch(e){seekPending=null;send('error',{code:'SEEK_FAILED',detail:String(e)});}
}
seek.addEventListener('change',commitSeek);
seek.addEventListener('pointerup',commitSeek);
seek.addEventListener('pointercancel',()=>{seekTarget=null;seekEditing=false;syncSeek();});
seek.addEventListener('blur',commitSeek);
video.addEventListener('play',()=>{clearRecovery();recoveryAttempts=0;play.textContent='❚❚';status('PLAYING');});
video.addEventListener('pause',()=>{play.textContent='▶';pausedAt=Date.now();});
video.addEventListener('play',()=>{
 const was=pausedAt;pausedAt=0;
 if(!was||Date.now()-was<30000||engine!=='html5'||fcActive||!lastSource||!lastSource.url)return;
 // a long pause: is the address still good? (short, ranged request; a refused answer or a different total size = ran out)
 fetch(fcLiveUrl||lastSource.url,{headers:{Range:'bytes=0-0'}}).then(r=>{const m=/\/(\d+)$/.exec(r.headers.get('Content-Range')||'');if(r.status>=400||(fcTotal&&m&&Number(m[1])!==fcTotal)||(r.status===206&&!m))needFresh('after-pause '+r.status);try{r.arrayBuffer();}catch(_){}}).catch(()=>needFresh('after-pause network'));
});
video.addEventListener('loadedmetadata',()=>send('aspect',{width:video.videoWidth,height:video.videoHeight}));
video.addEventListener('waiting',()=>{let covered=false;try{const t=video.currentTime;for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=t+0.1&&video.buffered.end(i)>t+2)covered=true;}catch(_){}if(covered)status('BUFFERING','Buffering…');else status('BUFFERING','Buffering…');});
// RC441: also clears the start gate's "Buffering before play..." (it was never cleared, so the box stayed on screen while the video played)
function clearBufferStatus(code){if(/^(?:Buffering|Decoding)/.test(message.textContent))status(code);}
video.addEventListener('canplay',()=>clearBufferStatus('CAN_PLAY'));
video.addEventListener('playing',()=>{if(message.textContent==='Autoplay permission disabled — click Play to start'){status('PLAYING');}else{clearBufferStatus('PLAYING');}});
video.addEventListener('seeked',()=>{if(video.readyState>=2)clearBufferStatus('SEEK_COMPLETE');});
video.addEventListener('error',()=>{if(engine==='html5'&&video.error&&(video.error.code===4||video.error.code===2))needFresh('error '+video.error.code);if(rvAlive()&&!rvBusy&&video.error&&video.error.code!==3&&reviveDirect('error '+video.error.code))return;status('MEDIA_ERROR','Media could not be decoded or fetched');send('error',{code:'MEDIA_ERROR',detail:String(video.error?.code||'unknown')});void rc355TryHevcFallback();});
/* RC479: FULL LOCAL CACHE for a single direct file (mp4 / webm). The browser reads such a file over ONE connection and only a little ahead of the playhead; servers
 * that limit each connection (hentaisea: ~0.7 MB/s per connection, ~3 MB/s over four) leave almost no read-ahead and a seek outside it restarts from nothing.
 * Once the file is playing it is downloaded in 8 MB pieces, four at a time (the piece at the playhead first), into memory. When it is complete the player switches to
 * the local copy at the same position: after that every seek is instant. Safety: every piece must be a proper 206 of the SAME total size (a server answering a
 * short stand-in clip is detected and the attempt dropped), the copy is only used when its duration matches the stream's, and files over 700 MB are not copied. */
/* RC500: SEEK LOCK. While the full local copy of a single-file video is still being made (the green part of the bar is not full yet) the time line and the Left / Right keys
 * are switched off: a jump in that state breaks playback. They unlock when the copy is complete and in use (the bar turns blue), when the copy cannot be made, or when it
 * makes no progress for 60 s. */
let seekLocked=false,fcCtype='';
function setSeekLock(on){seekLocked=!!on;try{seek.disabled=!!on;seek.title=on?'Jumping unlocks when the cache is complete (the green bar is full)':'';seek.style.opacity=on?'.55':'';}catch(_){}}
let fcActive=false,fcStarted=false,fcAbort=false,fcUrl=null,fcMap=null,aheadEl=null,fcFixState='';   // fcFixState: '' unknown, 'ok' repaired index in use, 'none' index fine, 'failed'
async function fullCacheStart(url){
 if(fcStarted||fcActive)return;fcStarted=true;fcAbort=false;const lockT0=Date.now();
 const status0=(c,d)=>{try{status(c,d);}catch(_){}};
 try{
  const head=await fetch(url,{headers:{Range:'bytes=0-0'}});
  const cr=/\/(\d+)$/.exec(head.headers.get('Content-Range')||'');if(head.status!==206||!cr){trace('FULL_CACHE_SKIP',{why:'no range support',status:head.status});return;}
  const ctype=String(head.headers.get('Content-Type')||'');if(!/^(?:video\/|audio\/|application\/octet-stream|binary\/octet-stream)/i.test(ctype)){trace('FULL_CACHE_SKIP',{why:'not a media file',ctype});return;}   // RC503: any single-file video address (no '.mp4' needed in it: rule34video / others)
  const total=Number(cr[1]);fcTotal=total;fcCtype=ctype;try{await head.arrayBuffer();}catch(_){}
  if(!(total>=4e6&&total<=7e8)){trace('FULL_CACHE_SKIP',{why:'size',total});return;}
  setSeekLock(true);                                    // RC500: no jumping until the copy is complete
  {const lockedAt=lockT0,aheadOk=()=>{try{const dur=video.duration;if(!(dur>0))return false;if(bufferedAheadSec()>=45)return true;if(!fcMap||!fcMap.length)return false;const nn=fcMap.length;let k=Math.min(nn-1,Math.floor((video.currentTime/dur)*nn)),c=0;while(k<nn&&fcMap[k]){c++;k++;}return (c*CH/total)*dur>=45;}catch(_){return false;}};let lastDone=0,lastAt=Date.now();const wd=setInterval(()=>{if(!seekLocked||fcActive||fcAbort){clearInterval(wd);return;}const d=fcMap?fcMap.filter(Boolean).length:0;if(d!==lastDone){lastDone=d;lastAt=Date.now();}
   // RC506: the lock is a short safety, not a wait for a slow server: at most 45 s (measured: the longest a copy needed to complete) and 25 s without any progress, then jumping is allowed even if the copy is not finished (jumps then use the stream itself / the partial copy)
   if(Date.now()-lockedAt>45000||Date.now()-lastAt>25000||aheadOk()){setSeekLock(false);trace('SEEK_LOCK_RELEASED',{done:d,of:fcMap?fcMap.length:0,why:aheadOk()?'45 s ahead':'time'});clearInterval(wd);}},500);}   /* 3.0.1: 45 s of time OR 45 s of video already buffered / copied ahead of the playhead; the clock starts when the copy starts, checked every 0.5 s */
  const CH=2*1024*1024,n=Math.ceil(total/CH),parts=new Array(n),zeroPiece=new Uint8Array(CH),mime=/video\/webm/i.test(String(fcCtype))||/[.]webm(?:$|[?#\/])/i.test(url)?'video/webm':'video/mp4';fcMap=new Array(n).fill(false);let done=0,failed=false;
  const inflight=new Set(),ctls=new Set();
  /* RC489: a file whose index lists almost no sync samples (hentaisea: one in 34 084 frames, although a random-access picture exists every ~10 s) makes every jump decode from
   * the first frame. The corrected index (hibMp4Fix) is built from the first piece + a few hundred small reads and is used in every local copy made below. */
  let fix=null,plain=null;   // plain: the parsed index of a file whose index needs no repair (3.1: used to play from the local copy during stalls)
  const readBytes=async(o,l)=>{const k0=Math.floor(o/CH),k1=Math.floor((o+l-1)/CH);if(k0===k1&&parts[k0]){const a0=o-k0*CH;return parts[k0].subarray(a0,a0+l);}
   const r=await fetch(fcLiveUrl||url,{headers:{Range:'bytes='+o+'-'+(o+l-1)}});if(r.status!==206)throw Error('status '+r.status);return new Uint8Array(await r.arrayBuffer());};
  const prepFix=async()=>{try{
   for(let i=0;i<200&&!parts[0]&&!fcAbort;i++)await new Promise(res=>setTimeout(res,300));if(!parts[0]||fcAbort||!window.hibMp4Fix)return;
   const info=hibMp4Fix.analyze(parts[0]);if(!info||!info.needsFix){if(info)plain=info;fcFixState='none';trace('MP4_INDEX_OK',{info:!!info});return;}
   const syncs=await hibMp4Fix.findSyncs(info,readBytes,{trace:x=>trace('MP4_SYNC_SCAN',x)});if(fcAbort)return;
   const pt=hibMp4Fix.patch(parts[0],info,syncs);if(!pt){fcFixState='failed';trace('MP4_PATCH_FAILED');return;}
   fix={info,syncs,head:pt.head,origLen:pt.origLen};fcFixState='ok';trace('MP4_SYNC_FIXED',{syncs:syncs.length,was:info.stssCount,delta:pt.delta});
  }catch(e){fcFixState='failed';trace('MP4_SYNC_ERROR',{error:String(e)});}};
  const buildBlob=(last)=>{const list=[];let from=0;
   if(fix&&parts[0]){list.push(fix.head);list.push(parts[0].subarray(fix.origLen));from=1;}
   for(let k=from;k<=last;k++){const len=(k===n-1)?(total-(n-1)*CH):CH;list.push(parts[k]||(len===CH?zeroPiece:new Uint8Array(len)));}
   return new Blob(list,{type:mime});};
  const timeAtByte=(bytePos)=>{const I=fix?fix.info:plain;if(!I)return (bytePos/Math.max(1,total))*(video.duration||0);const o=I.offs;let lo=0,hi=o.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(o[m]<=bytePos)lo=m;else hi=m-1;}return lo/(I.fps||24);};
  /* the next piece is always the nearest MISSING one at / after the playhead (it follows the user's seeks) */
  const pick=()=>{if(!parts[0]&&!inflight.has(0))return 0;
  const dur=video.duration||1,p=Math.min(n-1,Math.max(0,Math.floor((Math.max(0,video.currentTime-12)/dur)*n)));   /* 3.1: from 12 s BEFORE the playhead: a local copy that plays the stalled spot must start at the picture group before it */for(let d=0;d<n;d++){const k=(p+d)%n;if(!parts[k]&&!inflight.has(k))return k;}return -1;};
  /* a seek or a stall belongs to the player's own request: the copy's requests in flight are dropped and the copy waits until playback is smooth again */
  const onSeek=()=>{for(const c of ctls){try{c.abort();}catch(_){}}};
  video.addEventListener('seeking',onSeek);
  /* 3.1 SLOW-PER-CONNECTION SERVERS (rule34video: ~300 KB/s per request while the video needs ~330 KB/s; parallel requests each keep the full speed).
   * The speed of finished pieces is measured; when a connection is slower than 1.5x the video's own data rate the copy no longer steps aside while playback stalls
   * (it is the only way to get ahead) and two extra workers join. On a fast server nothing changes (the copy still waits for smooth playback). */
  let pieceSpeed=0,extrasOff=false;   // extrasOff: set at the first failed request; back to the careful 3.0.0 behaviour
  const slowSrc=()=>{if(extrasOff)return false;const b=(video.duration>0)?total/video.duration:0;return pieceSpeed>0&&b>0&&pieceSpeed<b*1.5;};
  const oneWorker=async(extra)=>{
   let rounds=0;
   while(!failed&&!fcAbort){
    while(!fcAbort&&!video.ended&&(video.seeking||(pieceSpeed>0&&!slowSrc()&&!video.paused&&(video.readyState<3||pfAheadSeconds()<3))))await new Promise(res=>setTimeout(res,500));
    if(extra&&!slowSrc()){if(pick()<0||extrasOff&&done>=n)return;await new Promise(res=>setTimeout(res,1000));continue;}
    const k=pick();if(k<0)return;
    inflight.add(k);
    const a=k*CH,b=Math.min(total-1,a+CH-1);
    let ok=false,bad=0;
    while(!ok&&bad<8&&!fcAbort&&!failed){
     const ctl=new AbortController();ctls.add(ctl);let timedOut=false;const t0=performance.now();const tmo=setTimeout(()=>{timedOut=true;try{ctl.abort();}catch(_){}},30000);
     try{
      const r=await fetch(fcLiveUrl||url,{headers:{Range:'bytes='+a+'-'+b},signal:ctl.signal});
      const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('Content-Range')||'');
      if(r.status===206&&m&&(Number(m[3])!==total||Number(m[1])!==a)){failed=true;trace('FULL_CACHE_BAD_PIECE',{k,status:r.status,range:r.headers.get('Content-Range')});break;}   // the file is not the same one
      if(r.status!==206||!m){extrasOff=true;bad++;trace('FULL_CACHE_PIECE_STATUS',{k,status:r.status,bad});try{await r.arrayBuffer();}catch(_){}await new Promise(res=>setTimeout(res,Math.min(15000,600*bad*bad)));continue;}   // 403 / 429 / 5xx: expired address or a busy server, try again
      const buf=new Uint8Array(await r.arrayBuffer());
      if(buf.length!==b-a+1)throw Error('short piece');
      {const sp=buf.length/Math.max(0.05,(performance.now()-t0)/1000);pieceSpeed=pieceSpeed?pieceSpeed*0.6+sp*0.4:sp;}
      parts[k]=buf;done++;ok=true;if(fcMap)fcMap[k]=true;
     }catch(e){
      if(timedOut){extrasOff=true;bad++;trace('FULL_CACHE_PIECE_TIMEOUT',{k,bad});await new Promise(res=>setTimeout(res,Math.min(15000,600*bad*bad)));}
      else if(e&&e.name==='AbortError'){while(!fcAbort&&(video.seeking||(!video.paused&&video.readyState<3)))await new Promise(res=>setTimeout(res,500));}   // dropped for the player's sake: try again, not a failure
      else{extrasOff=true;bad++;await new Promise(res=>setTimeout(res,Math.min(15000,600*bad*bad)));}
     }finally{clearTimeout(tmo);ctls.delete(ctl);}
    }
    inflight.delete(k);
    if(ok)rounds=0;
    else if(!failed&&!fcAbort){if(++rounds>10){failed=true;return;}trace('FULL_CACHE_REST',{k,rounds});await new Promise(res=>setTimeout(res,Math.min(60000,5000*rounds)));}
   }
  };
  trace('FULL_CACHE_START',{total,pieces:n});
  /* RC485: PARTIAL LOCAL COPY. The pieces the copy already holds can serve a seek at once, before the whole file is there: when the player seeks (or stalls) to a spot whose
   * pieces (and the file's index, piece 0) are all held, the player switches to a local copy that contains everything up to the end of that held stretch (holes before it are
   * zero-filled and never read). Near the end of the held stretch it rebuilds the copy if more is held, otherwise it goes back to the original address at the same
   * position. Needs the file's index (moov) at the start. Any error in the copy sends it straight back to the original address. */
  const dur0=video.duration||0,bps=dur0>0?total/dur0:0;
  let mode='native',sparseUrl=null,sparseLast=-1,sparseEndT=0,swapping=false;
  
  const coveredLast=(t,secs)=>{
   /* 3.1: a partial local copy is now used for EVERY file whose index (moov) sits in front, not only the repaired ones: while the stream itself stalls (a server that
    * answers slower than the video plays) the pieces the copy already holds are played instead. A file with a sound index has no sync table to start from, so the copy starts
    * 12 s before the target (longer than any normal group of pictures) and holds one piece more at the end (sound runs slightly ahead of the picture). */
   const I=fix?fix.info:plain;if(!I)return -1;
   const fps=I.fps||24,s=Math.min(I.n-1,Math.max(0,Math.floor(t*fps)));
   let from;
   if(fix){let lo=0,hi=fix.syncs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(fix.syncs[m]-1<=s)lo=m;else hi=m-1;}from=fix.syncs[lo]-1;}   // the sync sample at / before the target
   else from=Math.max(0,s-Math.ceil(12*fps));
   const e=Math.min(I.n-1,s+Math.ceil(secs*fps)),a=Math.floor(I.offs[from]/CH),b=Math.min(n-1,Math.floor((I.offs[e]+I.sizes[e])/CH)+(fix?0:1));
   if(!parts[0])return -1;for(let k=Math.max(1,a);k<=b;k++)if(!parts[k])return -1;return b;};
  const toNative=(pos,why)=>{if(mode==='native')return;trace('FULL_CACHE_TO_NATIVE',{why,pos});mode='native';swapping=true;const old=sparseUrl;sparseUrl=null;try{video.addEventListener('loadedmetadata',()=>{try{video.currentTime=pos;}catch(_){}swapping=false;void playSafely();if(old)setTimeout(()=>{try{URL.revokeObjectURL(old);}catch(_){}},3000);},{once:true});video.src=fcLiveUrl||url;}catch(_){swapping=false;}};
  const swapSparse=(t,last,why)=>{
   if(swapping||fcActive||fcAbort)return;swapping=true;
   const local=URL.createObjectURL(buildBlob(last));const old=sparseUrl;sparseUrl=local;sparseLast=last;mode='sparse';
   sparseEndT=Math.max(0,timeAtByte((last+1)*CH-1)-10);
   video.addEventListener('loadedmetadata',()=>{
    if(!(Math.abs((video.duration||0)-dur0)<=2)){trace('FULL_CACHE_DURATION_MISMATCH',{dur0,newDur:video.duration});swapping=false;mode='sparse';toNative(t,'duration');return;}
    try{video.currentTime=t;}catch(_){}swapping=false;void playSafely();trace('FULL_CACHE_PARTIAL',{why,t,last,endT:sparseEndT});status0('FULL_CACHE_READY','Jump served from the local copy');setTimeout(()=>{if(/^Jump served/.test(message.textContent))status0('PLAYING');},3000);
    if(old)setTimeout(()=>{try{URL.revokeObjectURL(old);}catch(_){}},3000);
   },{once:true});
   video.src=local;
  };
  video.addEventListener('seeking',()=>{if(swapping||fcActive||fcAbort)return;const t=video.currentTime;let nativeHas=false;try{for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=t&&video.buffered.end(i)>t+3)nativeHas=true;}catch(_){}
   if(mode==='sparse'&&t>=0&&t<sparseEndT-3){return;}   // inside the held stretch: nothing to do
   if(nativeHas&&mode==='native')return;
   const last=coveredLast(t,45);if(last>=0)swapSparse(t,last,'seek');else if(mode==='sparse')toNative(t,'seek-outside');});
  setInterval(()=>{if(swapping||fcActive||fcAbort||video.ended)return;const t=video.currentTime;
   if(mode==='sparse'&&t>sparseEndT-6){const last=coveredLast(t,45);if(last>sparseLast+2)swapSparse(t,last,'extend');else if(t>sparseEndT)toNative(t,'edge');}
   else if(mode==='native'&&!video.paused&&video.readyState<3&&video.currentTime>0){const last=coveredLast(t,30);if(last>=0)swapSparse(t,last,'stall');}},1000);
  video.addEventListener('error',()=>{if(mode==='sparse'&&!swapping)toNative(video.currentTime||0,'error');});
  prepFix();
  await Promise.all([oneWorker(false),oneWorker(false),oneWorker(true),oneWorker(true)]);
  if(failed||fcAbort||done!==n){trace('FULL_CACHE_GIVEUP',{done,n,failed});setSeekLock(false);return;}
  const blob=buildBlob(n-1);parts.length=0;
  const local=URL.createObjectURL(blob);
  const oldDur=video.duration,pos=video.currentTime,wasPlaying=!video.paused;
  const back=()=>{ // the copy does not look like the stream: go back to the original address
   try{URL.revokeObjectURL(local);}catch(_){}fcActive=false;setSeekLock(false);try{video.src=url;video.addEventListener('loadedmetadata',()=>{try{video.currentTime=pos;}catch(_){}if(wasPlaying)void playSafely();},{once:true});}catch(_){}
  };
  fcUrl=local;mode='full';try{if(sparseUrl)setTimeout(()=>{try{URL.revokeObjectURL(sparseUrl);}catch(_){}},4000);}catch(_){}
  video.addEventListener('loadedmetadata',()=>{
   if(!(Math.abs((video.duration||0)-(oldDur||0))<=2)){trace('FULL_CACHE_DURATION_MISMATCH',{oldDur,newDur:video.duration});back();return;}
   fcActive=true;setSeekLock(false);try{video.currentTime=pos;}catch(_){}
   if(wasPlaying)void playSafely();
   status0('FULL_CACHE_READY','Fully cached - seeking is instant');trace('FULL_CACHE_SWITCHED',{pos,total});
   setTimeout(()=>{if(/^Fully cached/.test(message.textContent))status0('PLAYING');},4000);
  },{once:true});
  video.src=local;
 }catch(e){trace('FULL_CACHE_ERROR',{error:String(e)});setSeekLock(false);}
}
video.addEventListener('playing',()=>{if(!fcStarted&&engine==='html5'&&lastSource&&lastSource.url&&!fcActive)setTimeout(()=>{if(!video.paused&&!video.error)void fullCacheStart(lastSource.url);},800);},{once:false});
/* RC473: a direct file (html5) that stops mid-way (the connection dropped, the server closed the stream) was never retried: it sat on 'Buffering' or paused and the Play button did nothing.
 * Now: stalled for 8 s (not paused by the user), or a media error, or Play pressed on a dead stream -> the same address is loaded again and the position restored (3 tries per stall).
 * If it keeps failing the address has probably run out: the message says to close and right-click the card again (a stale address is re-scanned there). */
/* RC486: FRESH ADDRESS. A signed address runs out (hentaisea: pause for a while, press play, and the new request is refused / answered with a short stand-in clip).
 * When the player cannot reconnect (two reloads did not help), the address is refused on resume, or the browser reports a source error, the page is asked for a new
 * address of the same video (the same scan as the right-click refresh); the answer replaces the address at the same position. Once per 45 s. */
let fcLiveUrl=null,fcTotal=0,freshAt=0,pausedAt=0;
let manifestRetries=0;
function needFresh(why,quick){const now=Date.now();if(quick){if(manifestRetries>=3||now-freshAt<6000)return;manifestRetries++;}else if(now-freshAt<45000)return;freshAt=now;trace('NEED_FRESH_SOURCE',{why,quick:!!quick,retry:manifestRetries});send('need-fresh-source',{why});try{status('BUFFERING','Buffering… getting a fresh link');}catch(_){}}
function replaceSource(u){
 try{const x=new URL(u);if(x.protocol!=='https:')return;trace('REPLACE_SOURCE',{host:x.hostname});lastSource.url=x.href;fcLiveUrl=x.href;fcLiveEpoch++;
  const pos0=Math.max(video.currentTime||0,lastGoodT);
  if(engine==='dash'&&dash){pfClear();try{dash.attachSource(x.href,pos0>1?pos0-1:0);}catch(e){trace('REPLACE_SOURCE_DASH_FAILED',{error:String(e)});}return;}   // RC498: a segmented stream restarts on the fresh manifest at the same position
  if(engine==='hls'&&hls){pfClear();try{hls.loadSource(x.href);hls.startLoad(pos0>1?pos0-1:-1);}catch(e){trace('REPLACE_SOURCE_HLS_FAILED',{error:String(e)});}return;}
  if(engine==='html5'&&!fcActive){const pos=Math.max(video.currentTime||0,lastGoodT);rvTries=0;rvBusy=true;
   video.addEventListener('loadedmetadata',()=>{try{if(pos>1)video.currentTime=pos-1;}catch(_){}rvBusy=false;void playSafely();},{once:true});
   setTimeout(()=>{rvBusy=false;},15000);
   video.src=x.href;video.load();}
 }catch(e){trace('REPLACE_SOURCE_FAILED',{error:String(e)});}
}
/* RC498: a saved address can still answer the manifest and then never deliver video (old / revoked media files). If playback was asked for and nothing played within 14 s,
 * a fresh address is requested once (same mechanism as for direct files). Not while the player waits for the user (autoplay prompt) or is paused on purpose. */
let everPlayed=false,startedAt=0;video.addEventListener('playing',()=>{everPlayed=true;});
setInterval(()=>{if(!started){startedAt=0;return;}if(!startedAt)startedAt=Date.now();
 if(!everPlayed&&!video.paused&&video.readyState<3&&Date.now()-startedAt>14000&&!/click Play/i.test(message.textContent))needFresh('start-stall');},2000);
let fcLiveEpoch=0,lastGoodT=0;video.addEventListener('timeupdate',()=>{if(video.currentTime>1&&!video.error&&video.readyState>=2)lastGoodT=video.currentTime;});
let rvTries=0,rvLast=-1,rvSince=0,rvBusy=false,rvProbed=false;
// true while the direct-file recovery (reload / fresh address) applies to the current source
function rvAlive(){return !!(lastSource&&lastSource.url)&&engine==='html5'&&started;}
// reloads the same address at the same position after a stall / error (max 3 tries); the 2nd failure asks for a fresh address
function reviveDirect(why){
 if(!rvAlive()||rvBusy)return false;
 if(rvTries>=2)needFresh('revive-failed');
 if(rvTries>=3){status('PLAYBACK_ERROR','This stream stopped and could not be reconnected (its address has probably run out). Close the player and right-click the card again.');return false;}
 rvBusy=true;rvTries++;const pos=video.currentTime||0;trace('DIRECT_REVIVE',{why,pos,try:rvTries,readyState:video.readyState,networkState:video.networkState});
 status('BUFFERING','Buffering… reconnecting');
 const back=()=>{video.removeEventListener('loadedmetadata',back);try{if(pos>1)video.currentTime=pos-1;}catch(_){}rvBusy=false;void playSafely();};
 video.addEventListener('loadedmetadata',back);
 setTimeout(()=>{if(rvBusy){video.removeEventListener('loadedmetadata',back);rvBusy=false;}},15000);
 try{video.src=(fcActive&&fcUrl)?fcUrl:lastSource.url;video.load();}catch(_){rvBusy=false;}
 return true;
}
setInterval(()=>{
 if(!rvAlive()||rvBusy||video.ended||video.paused||video.seeking){rvLast=-1;rvSince=Date.now();return;}
 const t=video.currentTime;
 if(t!==rvLast){rvLast=t;rvSince=Date.now();rvProbed=false;return;}
 if(video.readyState<3&&Date.now()-rvSince>4500&&!rvProbed){rvProbed=true;   // RC487: a stall after a jump: is the address still accepted? (refused / stand-in clip = ran out: ask for a fresh one at once)
  fetch(fcLiveUrl||lastSource.url,{headers:{Range:'bytes=0-0'}}).then(r=>{const m=/\/(\d+)$/.exec(r.headers.get('Content-Range')||'');if(r.status>=400||(fcTotal&&m&&Number(m[1])!==fcTotal)||(r.status===206&&!m))needFresh('stall-probe '+r.status);try{r.arrayBuffer();}catch(_){}}).catch(()=>{});}
 if(video.readyState<3&&Date.now()-rvSince>8000){rvSince=Date.now();rvProbed=false;reviveDirect('stalled');}
},2000);
video.addEventListener('playing',()=>{if(video.currentTime>0)setTimeout(()=>{if(!video.paused&&video.readyState>=3)rvTries=0;},20000);});
/* RC500: the Play button stays off until enough is buffered to start (first 'canplay'); a 25 s fallback enables it anyway so it can never stay dead. */
play.disabled=true;play.title='Waiting until enough is buffered…';
let playReady=false;const enablePlay=()=>{if(playReady)return;playReady=true;play.disabled=false;play.title='';};
video.addEventListener('canplay',enablePlay);video.addEventListener('playing',enablePlay);video.addEventListener('error',enablePlay);setTimeout(enablePlay,25000);
// play / pause (ignored while Play is still disabled; a dead stream is revived on Play)
function toggle(){if(play.disabled)return;if(video.paused){if(rvAlive()&&!rvBusy&&(video.error||video.networkState===3||(video.readyState<2&&video.currentTime>1&&!video.ended))&&reviveDirect('play-pressed'))return;void playSafely();}else video.pause();}
play.addEventListener('click',toggle);video.addEventListener('click',toggle);
// Control-bar opacity (0-100 % in steps of 5): the bar lets the picture and the subtitles show through.
// While the setting is being changed the bar is kept in view (window.__hibBarPinnedUntil, read by reveal()) so the change can be seen live.
{const apply=v=>{const n=Number(v);const a=Number.isFinite(n)?Math.min(100,Math.max(0,Math.round(n/5)*5))/100:0.7;document.documentElement.style.setProperty('--hib-bar-alpha',String(a));};
 apply(70);
 try{browser.storage.local.get('hibPlayerBarOpacity').then(d=>{if(d&&d.hibPlayerBarOpacity!=null)apply(d.hibPlayerBarOpacity);}).catch(()=>{});
 browser.storage.onChanged.addListener((c,area)=>{
  if(area!=='local')return;
  if(c.hibPlayerBarOpacity)apply(c.hibPlayerBarOpacity.newValue);
  if(c.hibPlayerBarOpacity||c.hibPlayerBarPreviewUntil){window.__hibBarPinnedUntil=Date.now()+4000;window.dispatchEvent(new Event('hib-bar-pin'));}
 });}catch(_){}}
// Jump length of the Left / Right arrow keys (Settings > Jump, 5-30 s in steps of 5, default 5).
let jumpSeconds=5;
{const readJump=v=>{const n=Math.round(Number(v)/5)*5;return Number.isFinite(n)?Math.min(30,Math.max(5,n)):5;};
 try{browser.storage.local.get('hibPlayerJumpSeconds').then(d=>{if(d&&d.hibPlayerJumpSeconds!=null)jumpSeconds=readJump(d.hibPlayerJumpSeconds);}).catch(()=>{});
 browser.storage.onChanged.addListener((c,area)=>{if(area==='local'&&c.hibPlayerJumpSeconds)jumpSeconds=readJump(c.hibPlayerJumpSeconds.newValue);});}catch(_){}}
let volumeStep=5;
// Settings pushed by the page script (the iframe cannot rely on reading extension storage itself).
function applyPlayerSettings(d){
 const num=v=>Number.isFinite(Number(v))&&v!==null&&v!==undefined?Number(v):null;
 const bar=num(d.barOpacity);if(bar!==null)document.documentElement.style.setProperty('--hib-bar-alpha',String(Math.min(100,Math.max(0,Math.round(bar/5)*5))/100));
 const jump=num(d.jump);if(jump!==null)jumpSeconds=Math.min(30,Math.max(5,Math.round(jump/5)*5));
 const step=num(d.volumeStep);if(step!==null)volumeStep=Math.min(99,Math.max(1,Math.round(step)));
 const pv=num(d.previewUntil);if(pv!==null&&pv>Date.now()-500){window.__hibBarPinnedUntil=Date.now()+4000;window.dispatchEvent(new Event('hib-bar-pin'));}
 try{send('status',{code:'SETTINGS_APPLIED',detail:JSON.stringify({bar:getComputedStyle(document.getElementById('controls')).backgroundColor,jump:jumpSeconds,step:volumeStep})});}catch(_){}
}
{const readStep=v=>{const n=Math.round(Number(v));return Number.isFinite(n)?Math.min(99,Math.max(1,n)):5;};
 try{browser.storage.local.get('hibVolumeStep').then(d=>{if(d&&d.hibVolumeStep!=null)volumeStep=readStep(d.hibVolumeStep);}).catch(()=>{});
 browser.storage.onChanged.addListener((c,area)=>{if(area==='local'&&c.hibVolumeStep)volumeStep=readStep(c.hibVolumeStep.newValue);});}catch(_){}}
// one keyboard map for the player: Space, Up/Down = volume, Left/Right = jump (Left/Right wait while the copy is being made)
function playbackKey(key){switch(key){case ' ':case 'Spacebar':toggle();return true;case 'ArrowUp':video.volume=Math.min(1,Math.round(video.volume*100+volumeStep)/100);if(video.volume>0)video.muted=false;return true;case 'ArrowDown':video.volume=Math.max(0,Math.round(video.volume*100-volumeStep)/100);return true;case 'ArrowLeft':if(seekLocked)return true;if(Number.isFinite(video.duration))video.currentTime=Math.max(0,video.currentTime-jumpSeconds);return true;case 'ArrowRight':if(seekLocked)return true;if(Number.isFinite(video.duration))video.currentTime=Math.min(video.duration,video.currentTime+jumpSeconds);return true;default:return false;}}
window.addEventListener('keydown',e=>{const t=e.target;if(t?.matches?.('input:not([type=range]),textarea,select,[contenteditable]'))return;if(playbackKey(e.key)){e.preventDefault();e.stopPropagation();}},true);   // RC494: with the time line / volume slider focused the arrows keep their player meaning: Up/Down = volume, Left/Right = jump (the slider's own arrow handling is suppressed)
captions.hidden=false;captions.disabled=true;captions.title='No subtitle track available';
captions.addEventListener('click',()=>{const t=[...video.textTracks].find(x=>x.kind==='subtitles');if(t){t.mode=t.mode==='disabled'?'hidden':'disabled';captions.style.opacity=t.mode==='disabled'?'.5':'1';capAdoptTracks();}else if(window.hibAssSubtitles?.has()){captions.style.opacity=window.hibAssSubtitles.toggle()?'1':'.5';}});
$('fullscreen').addEventListener('click',()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});else document.exitFullscreen().catch(()=>{});});
window.addEventListener('wheel',e=>{e.preventDefault();send('wheel',{deltaY:e.deltaY});},{passive:false});
window.addEventListener('pagehide',stop);
send('ready');
// Shared controls: visible when paused or active; fade after inactivity while playing.
(() => {
 const root=$('player'),bar=$('controls');let hideTimer;
 window.addEventListener('hib-bar-pin',()=>reveal());
 function reveal(){root.classList.remove('hib-controls-idle');clearTimeout(hideTimer);if(!video.paused&&!video.ended){hideTimer=setTimeout(()=>{if(Date.now()<(window.__hibBarPinnedUntil||0)){reveal();return;}if(!video.paused&&!video.ended&&!bar.matches(':hover'))root.classList.add('hib-controls-idle');},2200);}}
 ['mousemove','pointermove','pointerdown','touchstart','keydown','focusin'].forEach(name=>root.addEventListener(name,reveal,{passive:true}));
 bar.addEventListener('pointerleave',reveal);
 video.addEventListener('play',reveal);video.addEventListener('pause',reveal);video.addEventListener('waiting',reveal);
 reveal();
})();
/* 3.0.1 RESOLUTION CHOICE (KVS players: rule34video and the sites built on the same engine). The page lists every resolution in its player settings
 * (video_url / video_alt_url / video_alt_url2 with the labels 360p / 480p / 720p). The background fetches the page when the player opens (so the addresses are fresh:
 * they carry short-lived tokens) and returns the list; a selector appears in the control bar when there are two or more. Choosing one reopens the video at the same
 * position. A switched source streams from the server (no full local copy, so no seek lock). Generic by player engine, not by site name. */
let hibPageDest='',hibPlayerTitle='';   // hibPlayerTitle: the title shown in the player's own title bar ("site • episode · 1080p · Sub"); the saved files are named after it
function hibPathKey(u){try{const x=new URL(u);return x.origin+x.pathname.replace(/[/]+$/,'');}catch(_){return String(u);}}
async function hibLoadVariants(){
 try{
  if(!hibPageDest||!lastSource||!lastSource.url||engine!=='html5')return;
  const r=await browser.runtime.sendMessage({type:'hib-kvs-variants',page:hibPageDest});
  const list=(r&&r.ok&&Array.isArray(r.variants))?r.variants:[];
  trace('VARIANTS',{count:list.length,labels:list.map(v=>v.label)});
  hibOfferToUmd(list);
  if(list.length<2||$('hibRes'))return;
  const sel=document.createElement('select');sel.id='hibRes';sel.title='Resolution';sel.setAttribute('aria-label','Resolution');
  sel.style.cssText='background:#202026;color:#fff;border:1px solid #555;border-radius:4px;font:12px system-ui,sans-serif;padding:2px 3px;max-width:78px;';
  const curKey=hibPathKey(lastSource.url);let matched=false;
  for(const v of list){const o=document.createElement('option');o.value=v.url;o.textContent=v.label||(v.res?v.res+'p':'?');if(hibPathKey(v.url)===curKey){o.selected=true;matched=true;}sel.appendChild(o);}
  if(!matched){const o=document.createElement('option');o.value='';o.textContent='current';o.selected=true;sel.insertBefore(o,sel.firstChild);}
  sel.addEventListener('change',()=>{const u=sel.value;if(u)hibSwitchSource(u,sel.options[sel.selectedIndex].textContent);try{sel.blur();window.focus();}catch(_){}});
  sel.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Spacebar'].includes(e.key)){e.preventDefault();e.stopPropagation();playbackKey(e.key);}});   // mouse only: the arrow keys keep meaning volume / jump, they never change the resolution
  const ctl=$('controls'),before=$('captionSmaller');ctl.insertBefore(sel,before||$('fullscreen'));
 }catch(e){trace('VARIANTS_FAILED',{error:String(e)});}
}
/* 3.0.1 QUALITY CHOICE FOR HLS STREAMS (the stream's own qualities, e.g. 360p / 720p / 1080p): a selector in the control bar, filled from the player's quality list as soon as
 * it is known. Auto = the player decides; a height = that quality at once. Mouse only (the arrow keys keep meaning volume / jump). Generic by player engine, not by site. */
function hibLoadLevels(){
 let tries=0;
 const tm=setInterval(()=>{
  try{
   if(++tries>40||engine!=='hls'&&tries>5){clearInterval(tm);return;}
   if(engine!=='hls'||!hls||!hls.levels||hls.levels.length<2||$('hibLevel')||$('hibRes'))return;
   clearInterval(tm);
   const sel=document.createElement('select');sel.id='hibLevel';sel.title='Quality';sel.setAttribute('aria-label','Quality');
   sel.style.cssText='background:#202026;color:#fff;border:1px solid #555;border-radius:4px;font:12px system-ui,sans-serif;padding:2px 3px;max-width:78px;';
   const heights=[];
   hls.levels.forEach((l,i)=>{if(l&&l.height)heights.push({i,h:Number(l.height),b:Number(l.bitrate||0)});});
   heights.sort((x,y)=>y.h-x.h||y.b-x.b);
   const auto=document.createElement('option');auto.value='-1';auto.textContent='Auto';sel.appendChild(auto);
   const seen=new Set();
   for(const x of heights){if(seen.has(x.h))continue;seen.add(x.h);const o=document.createElement('option');o.value=String(x.i);o.textContent=x.h+'p';sel.appendChild(o);}
   if(sel.options.length<3)return;
   sel.value='-1';
   if(heights.length){try{hls.currentLevel=heights[0].i;sel.value=String(heights[0].i);trace('LEVEL_DEFAULT_BEST',{height:heights[0].h});}catch(_){}}   // starts at the best quality (Auto would begin at the lowest and look blocky); Auto stays one click away
   sel.addEventListener('change',()=>{try{hls.currentLevel=Number(sel.value);trace('LEVEL_CHOSEN',{value:sel.value,text:sel.options[sel.selectedIndex].textContent});sel.blur();window.focus();}catch(e){trace('LEVEL_FAILED',{error:String(e)});}});
   sel.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Spacebar'].includes(e.key)){e.preventDefault();e.stopPropagation();playbackKey(e.key);}});
   const ctl=$('controls'),before=$('captionSmaller');ctl.insertBefore(sel,before||$('fullscreen'));
   trace('LEVELS',{count:hls.levels.length,heights:heights.map(x=>x.h)});
  }catch(e){trace('LEVELS_FAILED',{error:String(e)});}
 },1000);
}
/* 3.0.1 SUBTITLE RETRY: the subtitle lookup that runs when a card is opened can come back empty (it looked next to a streaming mirror that answers with a web page, or it simply
 * ran out of time) while the video itself plays fine; the CC button then stayed greyed out until the player was reopened. If there is still no subtitle track a few seconds after
 * the player opened, the lookup is asked again for the address that is really playing (up to 3 times, 9 s apart). */
function hibSubRetry(){
 let n=0;
 const tm=setInterval(async()=>{
  try{
   if(++n>3){clearInterval(tm);return;}
   if(subTracks.length||(window.hibAssSubtitles&&window.hibAssSubtitles.has())){clearInterval(tm);return;}
   if(!lastSource||!lastSource.url)return;
   const r=await browser.runtime.sendMessage({type:'hib-rc332-get-subs',url:lastSource.url,page:hibPageDest||''});
   const tracks=(r&&Array.isArray(r.tracks))?r.tracks:[];
   if(tracks.length){try{window.hibAssSubtitles&&window.hibAssSubtitles.setPageFonts(r.fonts||[]);}catch(_){}registerSubTracks(tracks);trace('SUBTITLES_RETRY_FOUND',{n,count:tracks.length});clearInterval(tm);}
   else trace('SUBTITLES_RETRY_NONE',{n});
  }catch(e){trace('SUBTITLES_RETRY_FAILED',{error:String(e)});}
 },9000);
}
function hibSwitchSource(u,label){
 try{
  const t=video.currentTime||0,wasPaused=video.paused;
  trace('SWITCH_SOURCE',{label,t:Math.round(t)});
  try{browser.runtime.sendMessage({type:'hib-rc297-media-hint',url:u,referrer:hibPageDest||u});}catch(_){}
  try{setSeekLock(false);}catch(_){}
  stop();
  fcStarted=true;                        // a switched source streams from the server: no full local copy (and so no seek lock)
  resumeUrl=u;resumeDone=true;
  video.addEventListener('loadedmetadata',()=>{try{video.currentTime=t;}catch(_){}if(!wasPaused)void playSafely();message.textContent='';},{once:true});
  message.textContent='Switching to '+label+'...';
  start(u,'html5');
  setTimeout(()=>hibOfferToUmd([]),500);
 }catch(e){trace('SWITCH_FAILED',{error:String(e)});}
}
/* 3.0.1 UNIVERSAL MEDIA DOWNLOADER HAND-OVER. Firefox hides this player's own requests from other add-ons, so the downloader cannot see the file the HIB player plays. The
 * player therefore offers the address (and the other resolutions of the page) to the background page, which passes it on to the downloader add-on when it is installed
 * (otherwise nothing happens). Only the address, a label, the title and the page address are sent. */
function hibOfferToUmd(variants){
 try{
  if(!lastSource||!lastSource.url)return;
  const items=[],seen=new Set();
  const add=(url,label)=>{try{const u=new URL(url);if(u.protocol!=='https:'||seen.has(u.href))return;seen.add(u.href);items.push({url:u.href,label:String(label||''),kind:engine==='hls'&&u.href===lastSource.url?'hls':(/[.]m3u8(?:$|[?#\/])/i.test(u.pathname)?'hls':(/[.]mpd(?:$|[?#\/])/i.test(u.pathname)?'dash':'video'))});}catch(_){}};
  add(lastSource.url,'');
  for(const v of (variants||[]))add(v.url,v.label);
  browser.runtime.sendMessage({type:'hib-umd-offer',items,title:String(hibPlayerTitle||'').replace(/^[^\u2022]*\u2022\s*/,''),referrer:hibPageDest||''}).catch(()=>{});
 }catch(_){}
}
window.addEventListener('message',e=>{const d=e.data;if(e.source!==parent||!d||d.bridge!==BRIDGE||d.type!=='open')return;if(d.title)hibPlayerTitle=String(d.title);if(!d.destination)return;hibPageDest=String(d.destination);setTimeout(()=>{hibOfferToUmd([]);hibLoadVariants();hibLoadLevels();hibSubRetry();},1500);});
/* 3.0.1: the optional Download button (3.1 feature, hib_download.js) is placed INSIDE the player scope: it needs lastSource / engine / status of the player. */
/* 3.1  OPTIONAL DOWNLOAD BUTTON (off by default; Tools > Beta features > "Download button in the player").
 * Saves what the player is playing WITHOUT joining the parts: the video, a separate sound stream when the stream has one, and every subtitle
 * track each become their own file with the same base name. Nothing is converted and no other program is used.
 *   - direct video (MP4/WEBM): the file as it is
 *   - HLS: the segments of the chosen quality are fetched in order (AES-128 decrypted) and written into one .ts (or .mp4 when the stream uses
 *          fMP4 segments) file; a separate sound playlist becomes a second file
 *   - DASH: not supported yet (the button says so)
 * The player page does the fetching, so the same Referer handling as playback applies. */
(()=>{
 const KEY='hibDownloadEnabled';
 const btn=document.createElement('button');
 btn.id='hibDownload';btn.type='button';btn.hidden=true;btn.textContent='⭳';
 btn.title='Download video and subtitles (separate files)';btn.setAttribute('aria-label','Download video and subtitles');
 const anchor=document.getElementById('captions');
 if(!anchor||!anchor.parentNode)return;
 anchor.parentNode.insertBefore(btn,anchor);
 let busy=false;
 const say=(t)=>{try{status('DOWNLOAD',t);}catch(_){}};
 const show=async()=>{try{const d=await browser.storage.local.get(KEY);btn.hidden=d[KEY]!==true;}catch(_){btn.hidden=true;}};
 void show();
 try{browser.storage.onChanged.addListener((c,a)=>{if(a==='local'&&c[KEY])void show();});}catch(_){}

 const clean=s=>String(s||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
 const absolute=(u,base)=>{try{return new URL(u,base).href;}catch(_){return null;}};
 /* 3.0.1: a title that is only "Episode 4" gets the series name from the page address (/watch/kanojo-no-tomodachi/ -> "Kanojo No Tomodachi - Episode 4"); every saved file (video, sound, each subtitle language) is named from it. */
 function withSeries(title,pageUrl){
  const t=String(title||'').trim();
  if(!/^(?:episode|ep[.]?)\s*[0-9]+(?:[.][0-9]+)?$/i.test(t))return t;
  try{
   const parts=new URL(pageUrl).pathname.split('/').filter(Boolean).map(x=>decodeURIComponent(x));
   const ignore=/^(?:watch|video|videos|episode|episodes|ep|series|anime|hentai|play|stream|player|[0-9]+)$/i;
   const slug=[...parts].reverse().find(x=>!ignore.test(x)&&!/^(?:episode|ep)[-_ ]?[0-9]+$/i.test(x)&&/[a-z]/i.test(x));
   if(!slug)return t;
   return slug.replace(/[-_+]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b([a-z])/g,c=>c.toUpperCase())+' - '+t;
  }catch(_){return t;}
 }
 async function pageTitle(){const own=clean(withSeries(String(hibPlayerTitle||'').replace(/^[^•]*•\s*/,''),hibPageDest));if(own)return own;try{const r=await browser.runtime.sendMessage({type:'hib-dl-title'});return clean(withSeries(r&&r.title,hibPageDest));}catch(_){return '';}}   /* 3.0.1: the player's own title first (the page's tab title is often just the site name) */
 function fileBase(url){try{const n=decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop()||'');return clean(n.replace(/\.[a-z0-9]{2,5}$/i,''));}catch(_){return '';}}

 async function save(blob,name){
  const u=URL.createObjectURL(blob);
  try{
   /* 3.0.1: this page is an extension frame inside the web page, where browser.downloads does not exist ("browser.downloads is undefined"): the background page saves it. */
   const r=await browser.runtime.sendMessage({type:'hib-dl-save',url:u,filename:name});
   if(!r||!r.ok)throw Error((r&&r.error)||'the background page could not save the file');
  }finally{setTimeout(()=>URL.revokeObjectURL(u),30000);}
 }
 async function get(url,type){
  const r=await fetch(url,{credentials:'include'});
  if(!r.ok)throw Error('HTTP '+r.status+' for '+new URL(url).hostname);
  return type==='text'?r.text():type==='blob'?r.blob():r.arrayBuffer();
 }

 /* ---- HLS ---- */
 function attr(line,name){const m=new RegExp('(?:^|[:,])'+name+'=("([^"]*)"|[^,]*)','i').exec(line);return m?(m[2]!==undefined?m[2]:m[1]):null;}
 async function resolvePlaylist(url){
  let text=await get(url,'text'),base=url;
  if(/#EXT-X-STREAM-INF/i.test(text)){
   const lines=text.split(/\r?\n/);let best=null;
   for(let i=0;i<lines.length;i++){
    if(!/^#EXT-X-STREAM-INF/i.test(lines[i]))continue;
    const bw=Number(attr(lines[i],'BANDWIDTH'))||0,next=lines.slice(i+1).find(l=>l&&!l.startsWith('#'));
    if(next&&(!best||bw>best.bw))best={bw,url:absolute(next,url)};
   }
   if(!best)throw Error('No video playlist found in the stream');
   base=best.url;text=await get(base,'text');
  }
  return {text,base};
 }
 function hlsLevelUrl(){
  try{
   if(typeof hls==='undefined'||!hls||!hls.levels||!hls.levels.length)return null;
   const i=hls.currentLevel>=0?hls.currentLevel:(hls.loadLevel>=0?hls.loadLevel:hls.levels.length-1);
   const l=hls.levels[i];const u=Array.isArray(l.url)?l.url[0]:(l.uri||l.url);
   return u?absolute(u,lastSource.url):null;
  }catch(_){return null;}
 }
 function hlsAudioUrl(){
  try{
   if(typeof hls==='undefined'||!hls||!hls.audioTracks||!hls.audioTracks.length)return null;
   const t=hls.audioTracks[hls.audioTrack>=0?hls.audioTrack:0];
   const u=t&&(Array.isArray(t.url)?t.url[0]:t.url);
   return u?absolute(u,lastSource.url):null;
  }catch(_){return null;}
 }
 async function downloadPlaylist(playlistUrl,label,onProgress){
  const {text,base}=await resolvePlaylist(playlistUrl);
  const lines=text.split(/\r?\n/);
  const jobs=[];let key=null,init=null,seq=0,mediaSeq=0,sawFmp4=false;
  for(const line of lines){
   if(/^#EXT-X-MEDIA-SEQUENCE/i.test(line)){mediaSeq=Number(line.split(':')[1])||0;seq=mediaSeq;}
   else if(/^#EXT-X-KEY/i.test(line)){
    const method=(attr(line,'METHOD')||'NONE').toUpperCase();
    if(method==='NONE')key=null;
    else if(method==='AES-128')key={uri:absolute(attr(line,'URI'),base),iv:attr(line,'IV')};
    else throw Error('This stream uses '+method+' encryption, which cannot be saved');
   }
   else if(/^#EXT-X-MAP/i.test(line)){init={uri:absolute(attr(line,'URI'),base),key};sawFmp4=true;}
   else if(line&&!line.startsWith('#')){jobs.push({url:absolute(line.trim(),base),key,seq:seq++});}
  }
  if(!jobs.length)throw Error('The playlist has no segments');
  const keys=new Map();
  const keyFor=async k=>{if(!keys.has(k.uri))keys.set(k.uri,crypto.subtle.importKey('raw',await get(k.uri),{name:'AES-CBC'},false,['decrypt']));return keys.get(k.uri);};
  const ivFor=(k,n)=>{
   const iv=new Uint8Array(16);
   if(k.iv){const h=k.iv.replace(/^0x/i,'').padStart(32,'0');for(let i=0;i<16;i++)iv[i]=parseInt(h.substr(i*2,2),16);}
   else{let v=n;for(let i=15;i>=8&&v>0;i--){iv[i]=v%256;v=Math.floor(v/256);}}
   return iv;
  };
  const fetchSeg=async j=>{
   let buf=await get(j.url);
   if(j.key)buf=await crypto.subtle.decrypt({name:'AES-CBC',iv:ivFor(j.key,j.seq)},await keyFor(j.key),buf);
   return buf;
  };
  const parts=new Array(jobs.length+(init?1:0));
  let at=0;
  const all=init?[{init:true,url:init.uri,key:null,seq:0},...jobs]:jobs;
  let done=0;
  async function worker(){
   while(at<all.length){
    const i=at++,j=all[i];
    parts[i]=await fetchSeg(j);
    done++;onProgress(label+' '+Math.round(done/all.length*100)+'%  ('+done+'/'+all.length+')');
   }
  }
  await Promise.all([worker(),worker(),worker(),worker()]);
  return {blob:new Blob(parts),fmp4:sawFmp4};
 }

 async function run(){
  if(busy)return;busy=true;btn.disabled=true;
  try{
   const src=lastSource&&lastSource.url;
   if(!src)throw Error('Nothing is playing yet');
   if(engine==='dash')throw Error('Download is not available for DASH streams yet');
   const base=(await pageTitle())||fileBase(src)||'video';
   const saved=[],notes=[];notes.push('engine '+engine);
   if(engine==='hls'){
    const vurl=hlsLevelUrl()||src;
    const v=await downloadPlaylist(vurl,'Video',say);
    const vname=base+(v.fmp4?'.mp4':'.ts');
    await save(v.blob,vname);saved.push(vname);
    const aurl=hlsAudioUrl();
    if(!aurl)notes.push('no separate sound stream in this video');else if(aurl===vurl)notes.push('the sound is in the video stream');
    if(aurl&&aurl!==vurl){
     const a=await downloadPlaylist(aurl,'Sound',say);
     const aname=base+'.audio'+(a.fmp4?'.m4a':'.aac');
     await save(a.blob,aname);saved.push(aname);
    }
   }else{
    say('Video: downloading…');
    const blob=await get(src,'blob');
    const ct=(blob.type||'').toLowerCase();
    const ext=/webm/.test(ct)?'.webm':/matroska/.test(ct)?'.mkv':(/\.(mp4|webm|mkv|m4v|mov)(?:$|[?#])/i.exec(src)||[])[1]?'.'+(/\.(mp4|webm|mkv|m4v|mov)(?:$|[?#])/i.exec(src))[1].toLowerCase():'.mp4';
    const vname=base+ext;await save(blob,vname);saved.push(vname);
   }
   const subs=[];
   /* 3.0.1: ONLY the subtitle language being watched (the track chosen in the player's subtitle list; when none is shown, the player's default language), not every track the stream offers. */
   try{
    const cur=subTracks.find(t=>t.id===subCurrent)||(subCurrent==='off'?subTracks.find(t=>t.id===chooseDefaultSubTrack()):null);
    if(cur)subs.push(cur);
    notes.push(cur?'subtitle: '+(cur.lang||cur.label||cur.id):'no subtitle selected (tracks offered: '+subTracks.length+', current: '+subCurrent+')');
   }catch(e){notes.push('subtitle check failed: '+String(e&&e.message||e));}
   const extra=(window.hibDlExtra||[]).slice();
   const used=new Set();
   for(const t of subs){
    try{
     const isAss=t.kind==='ass'||/\.ass(?:$|[?#])/i.test(t.url||'');
     const isSrt=/\.srt(?:$|[?#])/i.test(t.url||'');
     const ext=isAss?'.ass':isSrt?'.srt':'.vtt';
     let text=typeof t.text==='string'?t.text:await get(t.url,'text');
     const tag=clean(t.lang||t.label||'subtitles').replace(/\s/g,'_');
     let n=base+'.'+tag+ext,k=2;while(used.has(n))n=base+'.'+tag+'.'+(k++)+ext;used.add(n);
     await save(new Blob([text],{type:'text/plain'}),n);saved.push(n);
    }catch(e){saved.push('(subtitle skipped: '+String(e&&e.message||e)+')');}
   }
   for(const t of extra){
    try{let n=base+'.'+(t.name||'subtitles')+'.'+t.ext,k=2;while(used.has(n))n=base+'.'+(t.name||'subtitles')+'.'+(k++)+'.'+t.ext;used.add(n);
     await save(new Blob([t.text],{type:'text/plain'}),n);saved.push(n);}catch(_){}
   }
   say('Saved '+saved.length+' file'+(saved.length===1?'':'s')+' to your Downloads folder: '+saved.join(', ')+'  ['+notes.join('; ')+']');
  }catch(e){say('Download failed: '+String(e&&e.message||e));}
  finally{busy=false;btn.disabled=false;}
 }
 btn.addEventListener('click',run);
})();

})();
/* ===== END VIDEO SECTION - HIB PLAYER (hib101_player.js) - VIDEO FINAL (RC507) ===== */
