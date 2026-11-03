/* ===== START VIDEO SECTION - UNIFIED PLAYER WINDOW (unified_player.js) - VIDEO FINAL (RC507) =====
 * The page-side shell of the HIB player: the window (title bar, close button, minimum width 640 px), the iframe that runs hib101_player.js, the message bridge to it,
 * settings pushed to it (bar opacity, jump, volume step, size), keyboard relay for page-focused keys, subtitles hand-over, and the fresh-link relay
 * (hib-need-fresh-source / hib-fresh-source) that lets the player ask the hover code for a new address. The player takes keyboard focus when it opens (RC507).
 * ===== */
/* HIB 1.0.1 TEST: one shell, one iframe player, two interchangeable media engines. */
(() => {
  if (window.__hibUnifiedPlayerOpen) return;
  const TAG='[HIB 1.0.1 core]', BRIDGE='hib-unified-v101', AUDIO='hibTestVideoPlaybackDefaults', SIZE='hibV210VideoDisplaySize';
  let active=null;
  const clamp=(v)=>Math.min(1,Math.max(0,Number.isFinite(+v)?+v:1));
  function open(spec) {
    if (active?.shell?.isConnected) { console.warn(TAG,'ALREADY_OPEN'); return false; }
    let media;
    try { media=new URL(String(spec?.url||'')); } catch (_) { console.warn(TAG,'INVALID_SOURCE_URL'); return false; }
    if (media.protocol!=='https:') { console.warn(TAG,'UNSAFE_SOURCE_PROTOCOL'); return false; }
    const engine=spec?.format==='dash'||/\.mpd(?:\/|$)/i.test(media.pathname)?'dash':spec?.format==='hls'||/\.m3u8(?:\/|$)/i.test(media.pathname)||/(?:^|\/)hls(?:\/|$)/i.test(media.pathname)?'hls':'html5'; // an extension-less /hls/ address is HLS too
    // Any source the scan verified is accepted (an address without a file extension included): the player's own preflight closes it cleanly if it cannot play.
    const shell=document.createElement('section');shell.id='hib-v101-player';
    shell.style.cssText='all:initial!important;position:fixed!important;display:block!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;z-index:2147483647!important;box-sizing:border-box!important;background:#101016!important;color:white!important;border:1px solid #595961!important;border-radius:9px!important;overflow:hidden!important;box-shadow:0 12px 36px #000b!important;font:13px system-ui,sans-serif!important;';
    const header=document.createElement('div');header.style.cssText='display:flex;align-items:center;gap:8px;height:34px;padding:0 8px;box-sizing:border-box;background:#25252a;color:white;';
    const heading=document.createElement('span');heading.textContent=String(spec?.site||location.hostname).replace(/^www\./,'')+' • '+String(spec?.title||document.title||'Video').replace(/\s+(?:thumbnail|poster|preview|cover)(?:\s+image)?\s*$/i,'').slice(0,100);heading.style.cssText='flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const reset=document.createElement('button');reset.textContent='Reset';const capture=document.createElement('button');capture.textContent='Capture Diagnostics';capture.title='Download current player/HLS diagnostics';const close=document.createElement('button');close.textContent='✕';
    for(const button of [reset,capture,close]) button.style.cssText='padding:3px 9px;border:0;border-radius:4px;color:white;background:#404049;cursor:pointer;';
    // Volume step: how many points the Up / Down arrow keys change the volume (1-99). Saved for every video, read by the player.
    const stepBox=document.createElement('label');stepBox.title='How much the Up / Down arrow keys change the volume';stepBox.style.cssText='display:flex;align-items:center;gap:5px;font:12px system-ui,sans-serif;color:#cfd2d8;white-space:nowrap;';
    const stepText=document.createElement('span');stepText.textContent='Volume step';
    const stepInput=document.createElement('input');stepInput.type='number';stepInput.min='1';stepInput.max='99';stepInput.step='1';stepInput.value='5';stepInput.setAttribute('aria-label','Volume step');
    stepInput.style.cssText='width:52px;padding:2px 4px;border:1px solid #595961;border-radius:4px;background:#101016;color:white;font:13px system-ui,sans-serif;';
    const readStep=v=>{const n=Math.round(Number(v));return Number.isFinite(n)?Math.min(99,Math.max(1,n)):5;};
    try{browser.storage.local.get('hibVolumeStep').then(d=>{if(d&&d.hibVolumeStep!=null)stepInput.value=String(readStep(d.hibVolumeStep));}).catch(()=>{});}catch(_){}
    stepInput.addEventListener('change',()=>{const n=readStep(stepInput.value);stepInput.value=String(n);try{browser.storage.local.set({hibVolumeStep:n}).catch(()=>{});}catch(_){}});
    for(const ev of ['keydown','keyup','keypress'])stepInput.addEventListener(ev,e=>e.stopPropagation());
    stepBox.append(stepText,stepInput);
    // Control-bar opacity and jump length, in the title bar like the Volume step: changed here they apply to this player at once (and are saved).
    const miniStyle='display:flex;align-items:center;gap:5px;font:12px system-ui,sans-serif;color:#cfd2d8;white-space:nowrap;';
    const barBox=document.createElement('label');barBox.title='Control bar opacity (the bar stays in view while you change it)';barBox.style.cssText=miniStyle;
    const barText=document.createElement('span');barText.textContent='Bar';
    const barInput=document.createElement('input');barInput.type='range';barInput.min='0';barInput.max='100';barInput.step='5';barInput.value='70';barInput.setAttribute('aria-label','Control bar opacity');barInput.style.cssText='width:64px;margin:0;accent-color:#1769d1;';
    barBox.append(barText,barInput);
    const jumpBox=document.createElement('label');jumpBox.title='How far the Left / Right keys jump';jumpBox.style.cssText=miniStyle;
    const jumpText=document.createElement('span');jumpText.textContent='Jump';
    const jumpSel=document.createElement('select');jumpSel.setAttribute('aria-label','Jump seconds');jumpSel.style.cssText='padding:1px 3px;border:1px solid #595961;border-radius:4px;background:#101016;color:white;font:12px system-ui,sans-serif;';
    for(const sec of [5,10,15,20,25,30]){const o=document.createElement('option');o.value=String(sec);o.textContent=sec+'s';jumpSel.append(o);}
    jumpBox.append(jumpText,jumpSel);
    try{browser.storage.local.get(['hibPlayerBarOpacity','hibPlayerJumpSeconds']).then(d=>{
      const b=Number(d.hibPlayerBarOpacity);if(Number.isFinite(b)&&d.hibPlayerBarOpacity!==null)barInput.value=String(Math.min(100,Math.max(0,Math.round(b/5)*5)));
      const j=Number(d.hibPlayerJumpSeconds);if(Number.isFinite(j)&&d.hibPlayerJumpSeconds!==null)jumpSel.value=String(Math.min(30,Math.max(5,Math.round(j/5)*5)));
    }).catch(()=>{});}catch(_){}
    barInput.addEventListener('input',()=>{try{browser.storage.local.set({hibPlayerBarOpacity:Number(barInput.value),hibPlayerBarPreviewUntil:Date.now()+4000}).catch(()=>{});}catch(_){}});
    jumpSel.addEventListener('change',()=>{try{browser.storage.local.set({hibPlayerJumpSeconds:Number(jumpSel.value)}).catch(()=>{});}catch(_){}});
    for(const el of [barInput,jumpSel])for(const ev of ['keydown','keyup','keypress'])el.addEventListener(ev,e=>e.stopPropagation());
    // Which add-on build this player belongs to (when two HIB add-ons are installed, only this build's Settings affect this player).
    const buildTag=document.createElement('span');
    try{buildTag.textContent='v'+browser.runtime.getManifest().version;buildTag.title='Host Imagus Bridge '+browser.runtime.getManifest().version+' - Settings in this toolbar change this player';}catch(_){buildTag.textContent='TEST';}
    buildTag.style.cssText='font:11px system-ui,sans-serif;color:#9aa3b5;white-space:nowrap;';
    header.append(heading,buildTag,barBox,jumpBox,stepBox,close);
    const frame=document.createElement('iframe');frame.src=browser.runtime.getURL('hib101_player.html');frame.title='HIB unified player';frame.setAttribute('allow','autoplay; fullscreen');frame.style.cssText='display:block;width:100%;aspect-ratio:16/9;border:0;background:#000;';
    shell.append(header,frame);document.documentElement.append(shell);
    // RC104: preflight media before revealing the window; no duplicate stream request.
    shell.style.setProperty('visibility','hidden','important');
    let hibPreflightResolved=false;
    const hibPreflightTimer=setTimeout(()=>{if(!hibPreflightResolved&&!disposed){hibPreflightResolved=true;shell.style.removeProperty('visibility');heading.title='Preflight pending: stream is still buffering';}},10000);
    const hibPreflightSuccess=()=>{if(hibPreflightResolved)return;hibPreflightResolved=true;clearTimeout(hibPreflightTimer);shell.style.removeProperty('visibility');};
    const hibPreflightFailure=(code)=>{if(hibPreflightResolved)return;hibPreflightResolved=true;clearTimeout(hibPreflightTimer);window.dispatchEvent(new CustomEvent('hib-verified-unplayable',{detail:{source:media.href,site:spec?.site||location.hostname,code}}));queueMicrotask(()=>{if(!disposed)dispose();});};
    let aspect=16/9,width=720,base=720,preset='auto';
    const maxWidth=()=>Math.max(200,Math.min(innerWidth-20,(innerHeight-62)*aspect));
    /* RC476: the WINDOW is never narrower than 640 px (the title bar, the close button and the control bar need that room); a tall/narrow video keeps its height and is centred with black side bars */ const place=v=>{width=Math.max(200,Math.min(maxWidth(),v));const W=Math.min(Math.max(640,width),innerWidth-20);shell.style.setProperty('width',Math.round(W)+'px','important');frame.style.aspectRatio=String(aspect*W/width);};
    const sizing=o=>{const map={'960x540':[960,540],'1280x720':[1280,720],'1920x1080':[1920,1080],'2560x1440':[2560,1440],'3840x2160':[3840,2160]};preset=o?.preset||'auto';const wh=/^(\d{3,4})x(\d{3,4})$/.exec(String(preset));const d=preset==='custom'?[Number(o.width),Number(o.height)]:map[preset]||(wh?[Number(wh[1]),Number(wh[2])]:null);aspect=d?.[0]>0&&d?.[1]>0?d[0]/d[1]:16/9;base=d?.[0]>0?d[0]:maxWidth();place(base);};
    const zoom=delta=>place(width*(delta<0?1.12:1/1.12));
    const onResize=()=>place(preset==='auto'?maxWidth():width);
    // Player settings (bar opacity, jump, volume step): read here and PUSHED to the player iframe, the same channel audio, size and subtitles use.
    const SETTING_KEYS=['hibPlayerBarOpacity','hibPlayerJumpSeconds','hibVolumeStep','hibPlayerBarPreviewUntil'];
    const pushSettings=async()=>{
      try{const d=await browser.storage.local.get(SETTING_KEYS);if(disposed)return;send({type:'settings',barOpacity:d.hibPlayerBarOpacity,jump:d.hibPlayerJumpSeconds,volumeStep:d.hibVolumeStep,previewUntil:d.hibPlayerBarPreviewUntil});}catch(_){}
    };
    const onStorage=(change,area)=>{
      if(area!=='local'||active?.shell!==shell)return;
      if(change[SIZE])sizing(change[SIZE].newValue);
      if(SETTING_KEYS.some(k=>change[k]))pushSettings();
    };
    sizing(null);window.addEventListener('resize',onResize);browser.storage.onChanged.addListener(onStorage);
    browser.storage.local.get(SIZE).then(v=>{if(active?.shell===shell)sizing(v[SIZE]);}).catch(()=>{});
    let disposed=false,handshakeTimer=null,readySeen=false,sourceSent=false;
    const playerEvents=[];
    const recordEvent=(type,msg)=>{playerEvents.push({at:new Date().toISOString(),type,code:msg.code||null,detail:msg.detail||null});if(playerEvents.length>100)playerEvents.shift();};
    let capturePending=false;
    const exportDiagnostics=async (playerSnapshot)=>{
      const report={schema:'hib-player-diagnostics-v2',capturedAt:new Date().toISOString(),page:location.href,episode:String(spec?.title||document.title),site:spec?.site||location.hostname,source:media.href,engine,player:playerSnapshot||null,events:playerEvents};
      try{await browser.storage.local.set({hibRc87LastPlayerCapture:report});}catch(e){console.warn(TAG,'CAPTURE_STORE_FAILED',String(e));}
      // RC91: the extension iframe owns downloads; do not simulate a page link click.
      capture.textContent='Waiting for download result…';
      console.info('[HIB RC96] PLAYER_DIAGNOSTICS_CAPTURED',JSON.stringify({engine,source:media.href,entries:report.player?.history?.length||0}));
      capturePending=false;
    };
    capture.addEventListener('click',()=>{if(capturePending)return;capturePending=true;capture.textContent='Capturing…';send({type:'capture-diagnostics'});setTimeout(()=>{if(capturePending){capturePending=false;capture.textContent='Capture timed out';capture.title='No response from player frame';capture.style.background='#842f32';}},10000);});
    const origin=new URL(frame.src).origin;
    const send=data=>{try {frame.contentWindow?.postMessage({bridge:BRIDGE,...data},origin);}catch(e){console.warn(TAG,'MESSAGE_SEND_FAILED',String(e));}};
    // RC444: the subtitle lookup (hover scan) can finish AFTER the player was opened. The hover code announces that with this event; the tracks are then sent to the
    // player (it ignores tracks it already has), so subtitles that arrive late are no longer lost (hstream.moe: .ass found a few seconds after the player opened).
    window.addEventListener('hib-animeid-subtitles-ready',()=>{if(!disposed&&sourceSent)void attachSubtitles();});
    const tryHandoff=()=>{if(disposed||sourceSent||!readySeen||!active?.audio)return;sourceSent=true;send({type:'open',url:media.href,engine,site:spec?.site||location.hostname,title:heading.textContent,audio:active.audio});
      try{frame.focus();frame.contentWindow&&frame.contentWindow.focus();}catch(_){}   // RC507: the keyboard belongs to the player as soon as it opens (a site's own Left/Right page keys must not get the arrows)attachSubtitles();
      if(!(spec?.subtitles?.tracks?.length)&&spec?.subtitles?.format==='ass'&&spec?.subtitles?.url){send({type:'ass-subtitle-url',url:spec.subtitles.url});}   // RC441: a track list replaces the single legacy subtitle
    };
    const onMessage=e=>{
      if(disposed||e.source!==frame.contentWindow||e.origin!==origin||e.data?.bridge!==BRIDGE)return;
      const msg=e.data;
      if(msg.type==='diagnostics-download'){
        capturePending=false;capture.textContent=msg.ok?'Saved to Downloads':'Download failed';
        capture.title=msg.ok?'Saved: '+String(msg.filename||''):'Error: '+String(msg.error||'Unknown');
        capture.style.background=msg.ok?'#245b3a':'#842f32';
        console.info('[HIB RC91] DOWNLOAD_RESULT',JSON.stringify(msg));
        return;
      }
      if(msg.type==='diagnostics'){
        if(msg.automatic){
          const report={schema:'hib-player-diagnostics-v2',capturedAt:new Date().toISOString(),page:location.href,episode:String(spec?.title||document.title),site:spec?.site||location.hostname,source:media.href,engine,reason:msg.reason||'PLAYBACK_FAILURE',player:msg.report||null,events:playerEvents.slice()};
          browser.storage.local.set({hibRc89LastPlayerFailure:report}).then(()=>console.info('[HIB RC96] PLAYER_DIAGNOSTICS_AUTOSAVED',{reason:report.reason,history:report.player?.history?.length||0})).catch(e=>console.error('[HIB RC89] PLAYER_DIAGNOSTICS_STORE_FAILED',String(e)));
        }
        if(capturePending)void exportDiagnostics(msg.report);
        return;
      }
      if(msg.type==='diagnostic-event'){recordEvent('hls-diagnostic', {code:msg.event?.detail||'hls',detail:msg.event});return;}
      if(msg.type==='status'||msg.type==='error')recordEvent(msg.type,msg);
      if(msg.type==='status'){
       if(msg.code==='PLAYBACK_CONFIRMED')hibPreflightSuccess();
       else if(['HLS_KEY_ACCESS_DENIED','HLS_INVALID_AES_KEY_RESPONSE','HLS_FORMAT_INCOMPATIBLE','HLS_FATAL','DASH_ERROR','MEDIA_ERROR'].includes(msg.code))hibPreflightFailure(msg.code);
      }
      if(msg.type==='error'&&['DASH_ERROR','MEDIA_ERROR'].includes(msg.code))hibPreflightFailure(msg.code);
      if(msg.type==='ready'){readySeen=true;if(handshakeTimer){clearInterval(handshakeTimer);handshakeTimer=null;}tryHandoff();pushSettings();}
      else if(msg.type==='status')console.info(TAG,'ENGINE_STATUS',msg.code||'',msg.detail||'');
      else if(msg.type==='error'){console.warn(TAG,'ENGINE_ERROR',msg.code||'',msg.detail||'');heading.title=String(msg.detail||msg.code||'Playback error');}
      else if(msg.type==='volume')console.info(TAG,'AUDIO_ACTUAL_MEDIA',JSON.stringify({volume:msg.volume,muted:msg.muted,engine}));
      else if(msg.type==='aspect'&&Number(msg.width)>0&&Number(msg.height)>0&&preset==='auto'){aspect=msg.width/msg.height;place(maxWidth());}
      else if(msg.type==='wheel'&&Number.isFinite(msg.deltaY))zoom(msg.deltaY);
      else if(msg.type==='resume-pos'&&typeof msg.key==='string'&&Number.isFinite(msg.t)&&Number.isFinite(msg.d)){   // RC496: remembered by the page script (survives the iframe being removed)
       browser.storage.local.get('hibResumePositions').then(v=>{const all=v&&v.hibResumePositions&&typeof v.hibResumePositions==='object'?v.hibResumePositions:{};all[msg.key]={t:msg.t,d:msg.d,at:Date.now()};const now=Date.now();for(const k of Object.keys(all))if(!all[k]||now-all[k].at>30*86400000)delete all[k];return browser.storage.local.set({hibResumePositions:all});}).catch(()=>{});
      }
      else if(msg.type==='need-fresh-source')window.dispatchEvent(new CustomEvent('hib-need-fresh-source',{detail:{source:media.href,why:String(msg.why||'')}}));   // RC486: the player's address ran out: the hover code looks for a new one
    };
    window.addEventListener('hib-fresh-source',ev=>{if(!disposed&&ev&&ev.detail&&ev.detail.url)send({type:'replace-source',url:ev.detail.url});});
    async function attachSubtitles(){try{if(spec?.subtitles?.tracks?.length){send({type:'subtitle-tracks',tracks:spec.subtitles.tracks,fonts:Array.isArray(spec.subtitles.fonts)?spec.subtitles.fonts:[]});return;}if(spec?.subtitles?.text?.replace(/^\uFEFF/,'').trimStart().startsWith('WEBVTT')){send({type:'subtitles',text:spec.subtitles.text.replace(/^\uFEFF/,''),label:spec.subtitles.label||'Subtitles'});return;}}catch(e){console.warn(TAG,'SUBTITLE_LOOKUP_FAILED',String(e));}}
    const dispose=()=>{if(disposed)return;disposed=true;try{browser.runtime.sendMessage({type:'hib-player-tab',open:false}).catch(()=>{});}catch(_){}clearTimeout(hibPreflightTimer);send({type:'destroy'});if(handshakeTimer)clearInterval(handshakeTimer);window.removeEventListener('message',onMessage);window.removeEventListener('keydown',keyboardRelay,true);window.removeEventListener('resize',onResize);window.removeEventListener('pagehide',dispose);browser.storage.onChanged.removeListener(onStorage);shell.remove();if(active?.shell===shell)active=null;};
    /* RC509: the report asks the open player for its trace: relayed to the iframe, answered within 2.5 s (null if it does not answer). */
    const requestTrace=()=>new Promise(resolve=>{const t=setTimeout(()=>{window.removeEventListener('message',h);resolve(null);},2500);const h=e=>{if(e.source!==frame.contentWindow||!e.data||e.data.bridge!==BRIDGE||e.data.type!=='report-trace-result')return;clearTimeout(t);window.removeEventListener('message',h);resolve(e.data.report||null);};window.addEventListener('message',h);send({type:'report-trace'});});
    active={shell,dispose,audio:null,requestTrace};
    try{browser.runtime.sendMessage({type:'hib-player-tab',open:true}).catch(()=>{});}catch(_){}
    // RC88: close on pointerdown before page-level capture listeners can swallow the click.
    const closeNow=e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();dispose();};
    close.addEventListener('pointerdown',closeNow,true);
    close.addEventListener('click',closeNow,true);
    reset.addEventListener('click',()=>place(base));window.addEventListener('pagehide',dispose,{once:true});
    window.addEventListener('message',onMessage);
    // relays Space / arrow keys pressed while the PAGE has focus to the player (the player itself takes focus when it opens)
    const keyboardRelay=e=>{
      if(disposed||!shell.isConnected||e.altKey||e.ctrlKey||e.metaKey)return;
      if(![' ','Spacebar','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
      if(e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable=true]'))return;
      // The player iframe handles keys when focused. Relay only page-focused keys.
      if(document.activeElement===frame)return;
      e.preventDefault();e.stopImmediatePropagation();send({type:'shortcut',key:e.key});
    };
    window.addEventListener('keydown',keyboardRelay,true);
    shell.addEventListener('wheel',e=>{if(e.target===frame)return;e.preventDefault();zoom(e.deltaY);},{passive:false});
    // Resolve defaults before iframe handoff, so initial media state is never stale.
    browser.storage.local.get(AUDIO).then(data=>{
      const setting=data[AUDIO]||{};const audio={volume:clamp(setting.volume),muted:setting.muted===true};
      if(active?.shell!==shell)return;
      active.audio=audio;tryHandoff();console.info(TAG,'GLOBAL_AUDIO_READ',JSON.stringify({volume:audio.volume,muted:audio.muted,engine,site:spec?.site||location.hostname}));
      let count=0;handshakeTimer=setInterval(()=>{if(disposed||++count>40){clearInterval(handshakeTimer);handshakeTimer=null;if(!disposed)console.error(TAG,'IFRAME_HANDSHAKE_TIMEOUT');return;}send({type:'request-ready'});},250);
      send({type:'request-ready'});
    }).catch(err=>{console.error(TAG,'GLOBAL_AUDIO_READ_FAILED',String(err));dispose();});
    console.info(TAG,'PLAYER_OPEN',JSON.stringify({engine,path:media.pathname}));return true;
  }

  /* ------------------------------------------------------------------------------------------------------------------------------
   * RC410  openCaptured(spec)  -  the same HIB player window as every other video, for a stream that has NO plain address.
   *
   * Used by hib_takeover.js ("Play with HIB") when the page plays through MediaSource (Mega, Google Drive, ...): the segments were
   * captured by hib_rc360_mse_observer.js and are replayed by the extension page hib_rc363_player.html. This function only builds the
   * WINDOW (same fixed, centered shell + title bar + close button as open() above); the segment player runs inside the iframe.
   *
   *   spec.tabId  (required)  id of THIS tab (the source tab whose captured segments are replayed). Obtained from the background.
   *   spec.title / spec.site  title-bar text.
   *   returns true if the window was opened, false if one is already open or tabId is invalid.
   *
   * Contract with the iframe (hib_rc410_embed.js, message bridge 'hib-rc410'):
   *   iframe -> page : {type:'aspect', width, height}   the real video size, so the window follows the video's shape
   *   page -> iframe : {type:'destroy'}                 stop driving the source video and free the MediaSource before removal
   * The source page keeps playing (muted, driven by the background) underneath: its own player is what produces the segments.
   * Closing the window (X or Escape) leaves the page exactly as it was.
   * ---------------------------------------------------------------------------------------------------------------------------- */
  function openCaptured(spec) {
    if (active?.shell?.isConnected) { console.warn(TAG,'ALREADY_OPEN'); return false; }
    const tabId=Number(spec?.tabId);
    if (!Number.isInteger(tabId)||tabId<0) { console.warn(TAG,'CAPTURED_NO_TAB'); return false; }
    const BRIDGE410='hib-rc410';
    const shell=document.createElement('section');shell.id='hib-v101-player';
    // Identical look to the URL player's window (kept as one string on purpose: change both places together).
    shell.style.cssText='all:initial!important;position:fixed!important;display:block!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;z-index:2147483647!important;box-sizing:border-box!important;background:#101016!important;color:white!important;border:1px solid #595961!important;border-radius:9px!important;overflow:hidden!important;box-shadow:0 12px 36px #000b!important;font:13px system-ui,sans-serif!important;';
    const header=document.createElement('div');header.style.cssText='display:flex;align-items:center;gap:8px;height:34px;padding:0 8px;box-sizing:border-box;background:#25252a;color:white;';
    const heading=document.createElement('span');heading.textContent=String(spec?.site||location.hostname).replace(/^www\./,'')+' • '+String(spec?.title||document.title||'Video').replace(/\s+(?:thumbnail|poster|preview|cover)(?:\s+image)?\s*$/i,'').slice(0,100);heading.style.cssText='flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const tag=document.createElement('span');tag.textContent='captured stream';tag.title='This page plays through MediaSource: HIB replays the segments it captured from the page';tag.style.cssText='font:11px system-ui,sans-serif;color:#9aa3b5;white-space:nowrap;';
    const close=document.createElement('button');close.textContent='\u2715';close.setAttribute('aria-label','Close HIB player');close.style.cssText='padding:3px 9px;border:0;border-radius:4px;color:white;background:#404049;cursor:pointer;';
    header.append(heading,tag,close);
    const frame=document.createElement('iframe');
    frame.src=browser.runtime.getURL('hib_rc363_player.html?embed=1&tab='+encodeURIComponent(tabId));
    frame.title='HIB captured-stream player';frame.setAttribute('allow','autoplay; fullscreen');frame.setAttribute('allowfullscreen','');
    frame.style.cssText='display:block;width:100%;aspect-ratio:16/9;border:0;background:#000;';
    shell.append(header,frame);document.documentElement.append(shell);
    // Size: as wide as fits the viewport at the video's aspect ratio (16:9 until the iframe reports the real size).
    let aspect=16/9,disposed=false;
    const place=()=>{const w=Math.max(320,Math.min(innerWidth-20,(innerHeight-62)*aspect,1280));const W=Math.min(Math.max(640,w),innerWidth-20);shell.style.setProperty('width',Math.round(W)+'px','important');frame.style.aspectRatio=String(aspect*W/w);};   // RC476: window at least 640 px wide
    place();window.addEventListener('resize',place);
    const origin=new URL(frame.src).origin;
    const onMessage=e=>{
      // Only the player iframe of THIS window, speaking our bridge, is trusted.
      if(disposed||e.source!==frame.contentWindow||e.origin!==origin||e.data?.bridge!==BRIDGE410)return;
      if(e.data.type==='aspect'&&Number(e.data.width)>0&&Number(e.data.height)>0){aspect=e.data.width/e.data.height;place();}
    };
    window.addEventListener('message',onMessage);
    const onKey=e=>{if(e.key==='Escape'&&!e.altKey&&!e.ctrlKey&&!e.metaKey){e.stopImmediatePropagation();dispose();}};
    window.addEventListener('keydown',onKey,true);
    const dispose=()=>{
      if(disposed)return;disposed=true;
      try{browser.runtime.sendMessage({type:'hib-player-tab',open:false}).catch(()=>{});}catch(_){}
      // Ask the iframe to release the source video / MediaSource first, then remove the window.
      try{frame.contentWindow?.postMessage({bridge:BRIDGE410,type:'destroy'},origin);}catch(_){}
      window.removeEventListener('message',onMessage);window.removeEventListener('keydown',onKey,true);window.removeEventListener('resize',place);
      setTimeout(()=>{try{shell.remove();}catch(_){}},180);
      if(active?.shell===shell)active=null;
    };
    active={shell,dispose,audio:null};
    try{browser.runtime.sendMessage({type:'hib-player-tab',open:true}).catch(()=>{});}catch(_){}
    // Close on pointerdown in the capture phase so page scripts cannot swallow the click (same approach as open()).
    const closeNow=e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();dispose();};
    close.addEventListener('pointerdown',closeNow,true);close.addEventListener('click',closeNow,true);
    window.addEventListener('pagehide',dispose,{once:true});
    console.info(TAG,'CAPTURED_PLAYER_OPEN',JSON.stringify({tabId}));
    return true;
  }
  window.__hibUnifiedPlayerOpenCaptured=openCaptured;
  /* RC411  openCapturedHere(opts)  -  open the captured-stream window for THIS tab if HIB holds its segments (or, with opts.wait, even before).
   * Used by every gesture that means "play this page's video in HIB" for a MediaSource page: the toolbar button (hib_takeover.js), the
   * right-click on a page video (hover_video_player.js) and the right-click inside an iframe (hib_rc411_capture_ui.js -> background ->
   * the message listener below). The tab id is asked from the background (a content script does not know its own tab id).
   * Resolves true if the window was opened, false if nothing is captured (and not wait mode) / a window is already open. */
  async function openCapturedHere(opts) {
    if (active?.shell?.isConnected) return false;
    const cap = await browser.runtime.sendMessage({ type: 'hib-rc387-capture-info' }).catch(() => null);
    if (!(cap && cap.ok)) return false;
    /* WAIT MODE (opts.wait, used by right-click): nothing is captured yet, e.g. the page's player has not started. Open the window anyway:
     * the embedded player shows "Buffering" and its own Load keeps asking for the first segments until they exist (hib_rc410_embed.js),
     * exactly what the old diagnostic tab did. Only when capturing is switched on; otherwise nothing could ever arrive. */
    if (!cap.hasInit && !(opts && opts.wait && cap.enabled)) return false;
    return openCaptured({ tabId: cap.tabId, title: document.title, site: location.hostname });
  }
  window.__hibUnifiedPlayerOpenCapturedHere = openCapturedHere;
  // The background asks the TOP frame to open the window when the right-click happened inside an iframe (Google Drive).
  browser.runtime.onMessage.addListener(m => {
    if (m && m.type === 'hib-rc387-open-window') return openCapturedHere({ wait: true });   // right-click: open at once, buffer in the window
    if (m && m.type === 'hib-report-player-trace') return active && active.requestTrace ? active.requestTrace() : undefined;   // RC509: Report Issue / Submit Request
    return undefined;
  });

  window.__hibUnifiedPlayerOpen=open;
  window.__hibUnifiedPlayerIsOpen=()=>Boolean(active?.shell?.isConnected);
  console.info(TAG,'Unified iframe/controller loaded');
})();
/* ===== END VIDEO SECTION - UNIFIED PLAYER WINDOW (unified_player.js) - VIDEO FINAL (RC507) ===== */
