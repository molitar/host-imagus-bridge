"use strict";
/* Tools page: Manage Sites, Submit Request / Report Issue, Save / Restore Settings. (Pick Card stays on the toolbar: it needs the page you are on.) */
(async()=>{
 const $=id=>document.getElementById(id);
 const params=new URLSearchParams(location.search);
 const keep=params.get('site')?'?site='+encodeURIComponent(params.get('site')):'';
 const say=m=>{$('status').textContent=m;};
 $('back').onclick=()=>{location.href='activation_popup.html'+keep;};
 $('manage').onclick=()=>{location.href='manage_sites.html'+keep;};
 /* Developer section (hidden): 5 clicks on the "Tools" title within 2.5 s show / hide it. It holds Diagnostics mode (hibDiagMode, OFF by default) and the way to the Diagnostics tools. */
 const devStore=await browser.storage.local.get(['hibDevUnlocked','hibDiagMode']);
 $('devSection').hidden=devStore.hibDevUnlocked!==true;
 /* 3.0.1: Diagnostics mode only exists while the Developer section is shown. Hidden = off (also repairs a value left on by an earlier hide). */
 if(devStore.hibDevUnlocked!==true&&devStore.hibDiagMode===true){devStore.hibDiagMode=false;await browser.storage.local.set({hibDiagMode:false});}
 $('devDiag').checked=devStore.hibDiagMode===true;
 $('devDiag').onchange=async()=>{await browser.storage.local.set({hibDiagMode:$('devDiag').checked});say('Diagnostics mode '+($('devDiag').checked?'on':'off')+'. Reload open pages to apply.');};
 $('devOpen').onclick=()=>{location.href='diagnostics.html'+keep;};
 /* Two ways to show / hide the Developer section: click the "Tools" title 5 times within 2.5 s, or press Alt+Shift+D while this page is open. */
 const toggleDev=async()=>{
  const show=$('devSection').hidden;
  await browser.storage.local.set({hibDevUnlocked:show});$('devSection').hidden=!show;if(!show){await browser.storage.local.set({hibDiagMode:false});$('devDiag').checked=false;}
  say(show?'Developer section shown.':'Developer section hidden.');
 };
 {let taps=0,tapTimer=null;
  document.querySelector('.top h1').addEventListener('click',()=>{
   taps++;clearTimeout(tapTimer);tapTimer=setTimeout(()=>{taps=0;},2500);
   if(taps<5)return;
   taps=0;void toggleDev();
  });}
 document.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&!e.ctrlKey&&!e.metaKey&&(e.code==='KeyD'||String(e.key).toLowerCase()==='d')){e.preventDefault();void toggleDev();}});
 /* GitHub issue forms (repo molitar/host-imagus-bridge). The add-on only OPENS the form: GitHub cannot take a file through the address, so the report is saved as a
  * .txt file in the Downloads folder and the form asks the user to drag it into the box (an attachment keeps the long log out of the issue text). The user then presses Submit.
  * Titles start with a tag so reports that came through HIB, and carry a diagnostic file, are easy to spot. */
 const HIB_ISSUES_URL='https://github.com/molitar/host-imagus-bridge/issues/new';
 let lastReportVideoHost='',lastReportHost='',lastReportVersion='',lastReportPage='',lastReportFile='',lastReportOnClipboard=false;
 const openIssue=kind=>{
  const bug=kind==='bug',feature=kind==='feature';
  const title=feature?'[Feature Request] ':(bug?'[Auto Bug Report] ':'[Auto Site Request] ')+(lastReportHost||'site')+(lastReportVideoHost?' (video from '+lastReportVideoHost+')':'');
  const NL=String.fromCharCode(10),FENCE=String.fromCharCode(96).repeat(3);
  const attach=lastReportFile
   ?['**Diagnostic log:** drag the file **'+lastReportFile+'** (saved in your Downloads folder) into this box to attach it.','']
   :['**Diagnostic report** (it is on your clipboard; paste with Ctrl+V):','',FENCE,'',FENCE,''];
  const body=feature
   ?['**What would you like HIB to do?**','','','**Why would it help?**','','','Add-on version: '+browser.runtime.getManifest().version,''].join(NL)
   :[bug?'**What went wrong?**':'**Which site, and what should HIB do there (video, images, both)?**','','',bug?'**What did you expect?**':'','','',
   'Add-on version: '+lastReportVersion,'Page: '+lastReportPage,lastReportVideoHost?'Video site: '+lastReportVideoHost:'',''].concat(attach).join(NL);
  const url=HIB_ISSUES_URL+'?title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body)+'&labels='+encodeURIComponent(bug?'bug':feature?'enhancement':'site request');
  browser.tabs.create({url});
 };
 /* ===== START Capture Diagnostics =====
  * One plain-text report of the page you are on, copied to the clipboard, for bug reports and "please support this site" requests. It holds:
  *   1 add-on + browser versions, time, page address / title
  *   2 HIB settings for this site (video enabled, media mode, image site, scan host)
  *   3 what the page contains: links to other hosts (with HIB's own resolve state), cards found by the card detector, video elements, iframes
  *   4 HIB trace events, stream-capture records, and the add-on's recent log lines
  * No cookies, passwords or page text beyond short link labels are included. Each part is guarded: a failing part writes its error and the rest still run. */
 /* One line per entry: a trace of 150 events as pretty JSON is 1800 lines, as one-liners it is 150. */
 const hhmmss=ms=>{try{return new Date(ms).toISOString().slice(11,23);}catch(e){return '';}};
 const oneLine=v=>{try{return JSON.stringify(v);}catch(e){return String(v);}};
 const diagPart=async(out,title,fn)=>{
  out.push('','===== '+title+' =====');
  try{const v=await fn();out.push(typeof v==='string'?v:JSON.stringify(v,null,1));}
  catch(e){out.push('(unavailable: '+String(e&&e.message||e)+')');}
 };
 const PAGE_PROBE='(function(){try{'+
  'var hosts={},links=[],ex=location.hostname;'+
  'var as=[].slice.call(document.querySelectorAll("a[href]"));'+
  'as.forEach(function(a){var h="";try{h=new URL(a.href).hostname}catch(e){}if(!/^https?:/.test(a.protocol)||!h||h===ex)return;hosts[h]=(hosts[h]||0)+1;'+
  'if(links.length>=60)return;var d={};for(var k in a.dataset)if(/^(hib|tih)/i.test(k))d[k]=String(a.dataset[k]).slice(0,160);'+
  'var im=a.querySelector("img");links.push({href:a.href.slice(0,220),text:(a.textContent||"").trim().slice(0,40),img:im?(im.currentSrc||im.src||"").slice(0,200):"",imgSize:im?[im.naturalWidth,im.naturalHeight,Math.round(im.getBoundingClientRect().width),Math.round(im.getBoundingClientRect().height)]:null,hib:d,nextTag:a.nextElementSibling&&a.nextElementSibling.dataset&&a.nextElementSibling.dataset.hibSiteDownTag?a.nextElementSibling.textContent:""});});'+
  'var vids=[].slice.call(document.querySelectorAll("video")).slice(0,12).map(function(v){var r=v.getBoundingClientRect();return {src:(v.currentSrc||v.src||"").slice(0,200),ready:v.readyState,paused:v.paused,err:v.error?v.error.code:0,size:[Math.round(r.width),Math.round(r.height)],natural:[v.videoWidth,v.videoHeight],dur:isFinite(v.duration)?Math.round(v.duration):null,mse:/^blob:/.test(v.currentSrc||v.src||"")};});'+
  'var ifr=[].slice.call(document.querySelectorAll("iframe")).slice(0,15).map(function(f){var r=f.getBoundingClientRect();return {src:(f.src||"").slice(0,200),size:[Math.round(r.width),Math.round(r.height)]};});'+
  'return JSON.stringify({url:location.href,title:document.title.slice(0,160),ready:document.readyState,lang:document.documentElement.lang,viewport:[innerWidth,innerHeight],'+
  'counts:{links:as.length,externalLinks:Object.keys(hosts).reduce(function(n,k){return n+hosts[k]},0),images:document.images.length,videos:document.querySelectorAll("video").length,iframes:document.querySelectorAll("iframe").length},'+
  'externalHosts:hosts,hibMarkers:{style:!!document.getElementById("hib-v208-style"),spinners:document.querySelectorAll("[data-hib-key]").length,resolvedLinks:document.querySelectorAll("a[data-hib-v2-chain-ready=\\"1\\"],a[data-hib-v2-ready=\\"1\\"],a[data-tih-full-image]").length,siteDownTags:document.querySelectorAll("[data-hib-site-down-tag]").length},'+
  'links:links,videos:vids,iframes:ifr});}catch(e){return JSON.stringify({error:String(e)});}})()';
 /* Report Issue / Request Site capture the report, copy it, then open their GitHub issue form (kind = 'bug' | 'site'). Request Feature needs no report. */
 const captureAndOpen=async kind=>{
  const out=[];let counts={};
  try{
   /* The toolbar popup reports the tab you are on. "?reportUrl=<address prefix>" (used only by developer test scripts) reports the first tab whose address starts with it. */
   const forced=params.get('reportUrl');
   const tab=forced?(await browser.tabs.query({})).find(t=>String(t.url).startsWith(forced)):(await browser.tabs.query({active:true,currentWindow:true}))[0];
   if(!tab)throw Error('No page tab to report on');
   const man=browser.runtime.getManifest();
   let host='';try{host=new URL(tab.url).hostname;}catch(e){}
   out.push('HIB DIAGNOSTIC REPORT','Add-on: '+man.name+' '+man.version,'Browser: '+navigator.userAgent,'Captured: '+new Date().toISOString(),'Page: '+(tab&&tab.url||'unknown'),'Host: '+host);
   /* Where the video really comes from. The page you are on is often not the video's site (animeid page -> nhplayer.com page -> media file on another host), so the
    * report names all three: the card's video page (from the current card trace), the media file / player engine of the last discovery. */
   const video={page:'',media:'',engine:''};
   try{
    const tr0=await browser.runtime.sendMessage({type:'hib-rc360-get',tabId:tab.id});
    const keys=((tr0&&tr0.trace386)||[]).map(x=>x&&x.d&&x.d.key).filter(k=>/^url:https?:/.test(k||''));
    if(keys.length)video.page=String(keys[keys.length-1]).slice(4);
    const st0=await browser.storage.local.get('hibRc75LastDiscovery');const d0=st0.hibRc75LastDiscovery;
    if(d0){video.media=String(d0.url||d0.candidateUrl||'');video.engine=[d0.mediaFormat,d0.rc150DetectedEngine].filter(Boolean).join(' / ');}
   }catch(e){}
   const hostOf=u=>{try{return new URL(u).hostname;}catch(e){return '';}};
   out.push('Video page: '+(video.page||'(none seen on this page)')+(hostOf(video.page)&&hostOf(video.page)!==host?'   [different site from the page you are on]':''),
    'Video file: '+(video.media||'(none)')+(video.engine?'   engine: '+video.engine:'')+(video.media?'   (last discovery: may be from an earlier video)':''));
   lastReportVideoHost=hostOf(video.page)&&hostOf(video.page)!==host?hostOf(video.page):'';

   await diagPart(out,'HIB SETTINGS FOR THIS SITE',async()=>{
    const st=await browser.storage.local.get(['enabledSites','siteMediaModes','hibImageSiteHosts','hibRc139ScanVideoHosts','hibDiagMode','hibRC360CaptureEnabled','hibVideoPreferredSource','hibV210VideoDisplaySize','hibV210GalleryDisplaySize']);
    const pick=o=>o&&typeof o==='object'?(Array.isArray(o)?o.filter(x=>String(x).includes(host)):Object.fromEntries(Object.entries(o).filter(([k])=>k===host||k==='www.'+host||('www.'+k)===host))):o;
    return {videoEnabled:pick(st.enabledSites),mediaMode:pick(st.siteMediaModes),imageSite:pick(st.hibImageSiteHosts),scanVideoHost:pick(st.hibRc139ScanVideoHosts),diagnosticsMode:st.hibDiagMode,captureStreams:st.hibRC360CaptureEnabled===true,preferredSource:st.hibVideoPreferredSource,videoSize:st.hibV210VideoDisplaySize,gallerySize:st.hibV210GalleryDisplaySize};
   });
   await diagPart(out,'PAGE CONTENT (links to other hosts with HIB state, videos, iframes)',async()=>{
    const r=await browser.tabs.executeScript(tab.id,{code:PAGE_PROBE});
    const o=JSON.parse(r&&r[0]||'{}');counts={links:(o.links||[]).length,videos:(o.videos||[]).length,iframes:(o.iframes||[]).length};o.links=(o.links||[]).map(l=>l.href+' | "'+l.text+'"'+(l.img?' | img '+l.img+' '+oneLine(l.imgSize):'')+(l.hib&&Object.keys(l.hib).length?' | '+oneLine(l.hib):'')+(l.nextTag?' | tag: '+l.nextTag:''));o.videos=(o.videos||[]).map(oneLine);o.iframes=(o.iframes||[]).map(f=>f.src+' '+oneLine(f.size));return o;
   });
   await diagPart(out,'CARDS FOUND BY THE CARD DETECTOR',async()=>{
    const info=await browser.tabs.sendMessage(tab.id,{type:'hib-rc160-capture-info'});
    const cards=(info&&info.cards||[]).slice(0,12).map(c=>c.index+' '+c.type+' | "'+String(c.title||'').slice(0,60)+'" | '+String(c.url||'').slice(0,160)+' | '+c.section+' | '+oneLine(c.rect));
    counts.cards=(info&&info.cards||[]).length;return {total:counts.cards,document:info&&info.document,first12:cards,imageQualityTraces:(info&&info.imageQualityTraces||[]).slice(-12)};
   });
   /* The same data the developer diagnostic window shows: the site's activation state, whether HIB's page script is alive, and the page's own event log (what HIB
    * detected, marked, selected and opened on this page, in order). */
   await diagPart(out,'WHAT HAPPENED ON THIS PAGE (activation state + page event log)',async()=>{
    const h2=host.replace(/^www\./,'').toLowerCase();
    let gate=null,gateErr='',probe=null,probeErr='',cards=null,cardErr='';
    try{const g=await browser.runtime.sendMessage({type:'hib-rc153-read-activation',host:h2});gate=g&&{registered:g.registered,permanentVideo:g.permanentVideo,override:g.override,effectiveVideoEnabled:g.effectiveVideoEnabled,activationSource:g.activationSource};}catch(e){gateErr=String(e&&e.message||e);}
    try{probe=await browser.tabs.sendMessage(tab.id,{type:'hib-rc153-activation-ping'});}catch(e){probeErr=String(e&&e.message||e);}
    try{cards=await browser.tabs.sendMessage(tab.id,{type:'hib-rc155-card-snapshot'});}catch(e){cardErr=String(e&&e.message||e);}
    const events=(cards&&cards.events||[]);counts.pageEvents=events.length;
    return {activation:gate,activationError:gateErr||undefined,pageScript:probe,pageScriptError:probeErr||undefined,cardDetectorError:cardErr||undefined,
     cardCounts:cards&&cards.counts,totalCards:cards&&cards.total,postFix:cards&&cards.postFix,lastSelected:cards&&cards.lastSelected,lastSiteReset:cards&&cards.lastSiteReset,
     events:events.slice(-200).map(x=>String(x.at||'').slice(11,23)+' '+x.event+' '+oneLine(x.data))};
   });
   /* The player's own trace. If the HIB player is open on this page it is asked for its live trace (nothing is saved or downloaded); otherwise the trace the player
    * saved when it last failed (or was asked for one) is shown, with its age. */
   await diagPart(out,'HIB PLAYER TRACE',async()=>{
    let live=null;
    try{live=await Promise.race([browser.tabs.sendMessage(tab.id,{type:'hib-report-player-trace'},{frameId:0}),new Promise(res=>setTimeout(()=>res(null),3500))]);}catch(e){live=null;}
    if(live&&live.history){counts.playerTrace=live.history.length;return {source:'LIVE: the HIB player is open on this page',session:live.session,capturedAt:live.capturedAt,engine:live.engine,started:live.started,history:live.history.slice(-150).map(h=>h.seq+' +'+h.elapsedMs+'ms '+h.type+' '+oneLine(h.data))};}
    const v=await browser.storage.local.get('hibRc90LastPlayerTrace');const t=v&&v.hibRc90LastPlayerTrace;
    if(!t)return '(the HIB player is not open and no earlier trace was saved: it saves one only when it fails)';
    counts.playerTrace=(t.history||[]).length;
    return {source:'SAVED: the player is not open on this page; this is its last saved trace',session:t.session,reason:t.reason,capturedAt:t.capturedAt,savedMinutesBeforeThisReport:(()=>{const ms=Date.now()-Date.parse(t.capturedAt);return Number.isFinite(ms)?Math.round(ms/60000):null;})(),note:'Saved by the player at the moment it failed (or was asked for a trace); later events are not in it. If the number above is large, this is an EARLIER playback, not the current one.',history:(t.history||[]).slice(-120).map(h=>h.seq+' +'+h.elapsedMs+'ms '+h.type+' '+oneLine(h.data))};
   });
   /* The subtitle tracks the player is offered for this video: kind, label, the language HIB detected, script, and the (query-free) address. This is what a "wrong subtitle
    * language" report needs. The lookup is the same one the player makes, with a 12 s limit; the subtitle text itself is NOT included. */
   await diagPart(out,'SUBTITLE TRACKS (what the player is offered for this video)',async()=>{
    if(!video.media)return '(no video source seen on this page)';
    const r=await Promise.race([browser.runtime.sendMessage({type:'hib-rc332-get-subs',url:video.media,page:video.page||tab.url}),new Promise(res=>setTimeout(()=>res({timeout:true}),12000))]);
    if(r&&r.timeout)return '(the subtitle lookup took longer than 12 s)';
    const list=(r&&r.tracks)||[];counts.subtitleTracks=list.length;
    return {tracks:list.map(t=>({kind:t.kind||t.format,label:t.label,detectedLanguage:t.lang,latinScript:t.latin,url:t.url}))};
   });
   await diagPart(out,'CURRENT CARD TRACE (video marks / open steps, image resolve + gallery steps) + STREAM RECORDS',async()=>{
    const r=await browser.runtime.sendMessage({type:'hib-rc360-get',tabId:tab.id});
    counts.records=(r&&r.records||[]).length;
    return {trace:(r&&r.trace386||[]).slice(-150).map(x=>hhmmss(x.t)+' '+x.e+' '+oneLine(x.d)),records:(()=>{let hook=false;return (r&&r.records||[]).filter(x=>{const ev=String(x.event);if(/^RC386_/.test(ev)||ev==='RC411_MOVE')return false;if(ev==='HOOK_INSTALLED'){if(hook)return false;hook=true;}return true;}).slice(-80).map(x=>x.time+' frame='+x.frameId+' '+x.event+' '+x.detail);})(),observers:(r&&r.observerStates||[]).slice(0,10)};
   });
   await diagPart(out,'ADD-ON LOG (most recent lines)',async()=>{
    const r=await browser.runtime.sendMessage({type:'hib-diag-get-log'});
    /* PRIVACY: the log names every site the user has registered or enabled, which says what they use HIB on. Those list lines are dropped. The other lines
     * name only hosts involved in the page being reported (page, player, media host); they are kept because a site request needs them. */
    const lines=(r&&r.lines||[])
     .filter(l=>!/\[HIB [^\]]*sites\]|image sites:|enabled source sites/i.test(l));
    counts.log=lines.length;return lines.join(String.fromCharCode(10))||'(empty)';
   });
   let text=out.join(String.fromCharCode(10));
   /* PRIVACY: the report may be pasted into a public issue. Every address loses its query string and fragment (signed video links carry access tokens there);
    * host and path stay because compatibility work needs them. Cookies, passwords, logins and form values are never collected in the first place. */
   text=text.replace(/(https?:\/\/[^\s"'<>?#\\]+)[?#][^\s"'<>\\]*/g,'$1?[removed]');
   /* Access tokens that are not part of an address (e.g. 'fy=1793435904-<signature>' or a long mixed-case id): masked as [token]. */
   /* Access tokens that are not part of an address, masked as [token]: 'fy=<expiry>-<signature>', a long mixed-case run (percent-encoded + / = signs count as part of it, %20 does not),
    * a 'src' value that is not an address, and the per-profile id inside moz-extension:// addresses. */
   text=text.replace(/\bfy=[^"&\s,}\\]+/g,'fy=[token]').replace(/(?=(?:[A-Za-z0-9_]|%2[FBfb]|%3[Dd])*[A-Z])(?=(?:[A-Za-z0-9_]|%2[FBfb]|%3[Dd])*[a-z])(?=(?:[A-Za-z0-9_]|%2[FBfb]|%3[Dd])*\d)(?:[A-Za-z0-9_]|%2[FBfb]|%3[Dd]){20,}/g,'[token]').replace(/"src":\s*"(?![a-z-]+:\/\/)[^"]{8,}"/g,'"src":"[token]"').replace(/moz-extension:\/\/[0-9a-f-]{36}/g,'moz-extension://[id]');
   document.body.dataset.lastReport=text;   /* kept in the page only, so developer test scripts can read what was copied */
   if(text.length>400000)text=text.slice(0,400000)+'\n(report cut at 400000 characters)';
   /* Save the report as a .txt file in Downloads (the user drags it into the issue). If the download is refused, fall back to the clipboard. */
   lastReportFile='';
   try{
    const stamp=new Date().toISOString().replace(/[:T]/g,'-').slice(0,16);
    const fileName='HIB-report-'+(host||'page').replace(/[^a-z0-9.-]/gi,'_')+'-'+stamp+'.txt';
    const blobUrl=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
    await browser.downloads.download({url:blobUrl,filename:fileName,saveAs:false,conflictAction:'uniquify'});
    setTimeout(()=>URL.revokeObjectURL(blobUrl),60000);
    lastReportFile=fileName;
   }catch(e){lastReportFile='';await navigator.clipboard.writeText(text);}
   /* Nothing is posted by the add-on: the issue form opens pre-filled and the user pastes the report (Ctrl+V) and presses Submit. */
   lastReportHost=host;lastReportVersion=man.version;lastReportPage=(tab.url||'').replace(/[?#].*$/,'');
   say((lastReportFile?'Report saved as '+lastReportFile+' in your Downloads folder':'Report copied to the clipboard')+' ('+Math.round(text.length/1024)+' KB: '+Object.entries(counts).map(([k,v])=>v+' '+k).join(', ')+'). In the GitHub form that just opened, '+(lastReportFile?'drag that file into the box':'paste it (Ctrl+V)')+' and press Submit. GitHub issues are public, so attached files can be opened by anyone with the link: no cookies, logins or passwords are collected and web addresses have their query part removed.');
   openIssue(kind);
  }catch(e){say('Capture failed: '+String(e.message||e));}
 };
 $('reportBug').onclick=()=>captureAndOpen('bug');
 $('reportSite').onclick=()=>captureAndOpen('site');
 $('reportFeature').onclick=()=>{openIssue('feature');say('The GitHub feature request form opened: describe your idea and press Submit. GitHub issues are public.');};
 $('requestBtn').onclick=()=>{$('requestChoice').hidden=!$('requestChoice').hidden;};
 /* ===== END Capture Diagnostics ===== */
 /* HEVC video support (Beta features). Firefox plays HEVC (H.265) through a decoder that is already on the computer; on Windows that is Microsoft's "HEVC Video Extensions"
  * from the Microsoft Store. Turning this on makes HIB check for one and, if there is none, points to the Store. HIB does not install anything. */
 const HEVC_STORE_URL='https://apps.microsoft.com/detail/9nmzlz57r3t7';
 const hevcSupported=()=>{
  const v=document.createElement('video');
  const types=['video/mp4; codecs="hvc1.1.6.L93.B0"','video/mp4; codecs="hev1.1.6.L93.B0"'];
  try{if(types.some(t=>v.canPlayType(t)!==''))return true;}catch(e){}
  try{if(typeof MediaSource!=='undefined'&&types.some(t=>MediaSource.isTypeSupported(t)))return true;}catch(e){}
  return false;
 };
 const isWindows=/Windows/i.test(navigator.userAgent);
 const hevcRefresh=async(announce)=>{
  const on=(await browser.storage.local.get('hibHevcEnabled')).hibHevcEnabled===true;
  $('hevcToggle').checked=on;
  const box=$('hevcStatus'),btn=$('hevcStore');
  if(!on){box.hidden=true;btn.hidden=true;return;}
  box.hidden=false;
  if(hevcSupported()){box.textContent='HEVC decoder found: Firefox can play HEVC videos on this computer.';box.style.color='#1f6b3a';btn.hidden=true;return;}
  box.style.color='#9a3412';btn.hidden=!isWindows;
  box.textContent=isWindows
   ?'No HEVC decoder found. Install "HEVC Video Extensions" from the Microsoft Store, then restart Firefox.'
   :'No HEVC decoder found. Install an HEVC (H.265) decoder for your system, then restart Firefox.';
  if(announce)say(box.textContent);
 };
 $('hevcToggle').onchange=async()=>{await browser.storage.local.set({hibHevcEnabled:$('hevcToggle').checked});await hevcRefresh(true);};
 $('hevcStore').onclick=()=>{browser.tabs.create({url:HEVC_STORE_URL});};
 await hevcRefresh(false);
 /* Beta features: stream capture switch (moved here from the Diagnostics page). Same storage key as before. */
 const betaV=await browser.storage.local.get('hibRC360CaptureEnabled');
 $('rc360toggle').checked=betaV.hibRC360CaptureEnabled===true;
 const dlV=await browser.storage.local.get('hibDownloadEnabled');
 $('dlToggle').checked=dlV.hibDownloadEnabled===true;
 $('dlToggle').onchange=async()=>{await browser.storage.local.set({hibDownloadEnabled:$('dlToggle').checked});say('Player download button '+($('dlToggle').checked?'on':'off')+'.');};
 $('rc360toggle').onchange=async()=>{
  await browser.storage.local.set({hibRC360CaptureEnabled:$('rc360toggle').checked});
  say('Stream capture '+($('rc360toggle').checked?'on':'off')+'. Reload the video page to apply.');
 };

 const config=['hibHoverVideoDelaySeconds','hibV210VideoDisplaySize','hibV210GalleryDisplaySize','hibTestVideoPlaybackDefaults','hibVideoPreferredSource','hibPlayerBarOpacity','hibPlayerJumpSeconds'];
 const keys=['enabledSites','siteMediaModes','hibRc139ScanVideoHosts','hibImageSiteHosts','hibRc161LearnedCardRules','hibRc158CardLayouts','hibGalleryDisplaySize','hibVolumeStep',...config];
 const sensitive=/token|secret|password|credential|auth|cookie|api.?key/i;
 /* ===== START Save / Restore settings (bookmarks; everything stays inside the toolbar popup) =====
  * A file chooser cannot be used in the toolbar popup (Firefox closes the popup when it opens) and an add-on cannot read a file or folder from disk, so the backups live
  * where the BROWSER keeps data an add-on may read: a BOOKMARKS FOLDER that you choose. The chosen folder is remembered (hibBackupFolderId).
  *   Save Settings  writes a dated bookmark "HIB settings YYYY-MM-DD HH:MM" into that folder (the newest 14 are kept) and also saves the dated .json file to Downloads.
  *   Restore        lists the backups in that folder, newest first; you pick one and press Confirm.
  * The bookmark's address holds the (compressed) settings; it touches only bookmarks whose title starts with "HIB settings ". */
 const BK_PREFIX='HIB settings ';
 const BK_DEFAULT_NAME='Host Imagus Bridge Backups';
 const toB64=u8=>{let t='';for(let i=0;i<u8.length;i+=0x8000)t+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(t);};
 const fromB64=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
 const gzipText=async text=>{const cs=new CompressionStream('gzip');const w=cs.writable.getWriter();w.write(new TextEncoder().encode(text));w.close();return new Uint8Array(await new Response(cs.readable).arrayBuffer());};
 const gunzipBytes=async u8=>{const ds=new DecompressionStream('gzip');const w=ds.writable.getWriter();w.write(u8);w.close();return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());};
 const GZ='data:application/gzip;base64,',JS='data:application/json;charset=utf-8,';
 const readRecord=async url=>{
  let json;
  if(String(url).startsWith(GZ))json=await gunzipBytes(fromB64(url.slice(GZ.length)));
  else if(String(url).startsWith(JS))json=decodeURIComponent(url.slice(JS.length));
  else throw Error('not a HIB backup');
  const d=JSON.parse(json);
  if(!d||d.format!=='HIB-settings'||!d.settings||typeof d.settings!=='object'||Array.isArray(d.settings))throw Error('not a HIB backup');
  return d;
 };
 /* how many sites a backup holds: the same count Manage Sites uses (video list + scan-mode list + image list, every site once) */
 const siteTotal=st=>{
  const set=new Set();
  for(const x of Array.isArray(st.enabledSites)?st.enabledSites:[])set.add(String(typeof x==='string'?x:(x&&(x.host||x.domain))||'').toLowerCase());
  for(const k of Object.keys(st.hibRc139ScanVideoHosts||{}))set.add(String(k).toLowerCase());
  for(const k of Object.keys(st.hibImageSiteHosts||{}))set.add(String(k).toLowerCase());
  set.delete('');return set.size;
 };
 const flatFolders=(node,trail,out)=>{
  for(const c of node.children||[]){
   if(c.url!==undefined)continue;                       // a bookmark, not a folder
   const label=trail.concat(c.title||'(untitled)').join(' / ');
   out.push({id:c.id,label});flatFolders(c,trail.concat(c.title||'(untitled)'),out);
  }
 };
 const folderExists=async id=>{try{const [n]=await browser.bookmarks.get(id);return !!n&&n.url===undefined;}catch(e){return false;}};
 const ensureDefaultFolder=async()=>{
  const tree=await browser.bookmarks.getTree();
  const other=tree[0].children.find(c=>c.id==='unfiled_____'||/other bookmarks/i.test(c.title))||tree[0].children[0];
  const kids=await browser.bookmarks.getChildren(other.id);
  return kids.find(x=>x.url===undefined&&x.title===BK_DEFAULT_NAME)||browser.bookmarks.create({parentId:other.id,title:BK_DEFAULT_NAME});
 };
 const currentFolderId=async(create)=>{
  const saved=(await browser.storage.local.get('hibBackupFolderId')).hibBackupFolderId;
  if(saved&&await folderExists(saved))return saved;
  if(!create)return null;
  const f=await ensureDefaultFolder();await browser.storage.local.set({hibBackupFolderId:f.id});return f.id;
 };
 /* Folder pull-down: ONLY HIB folders (the default backup folder, folders that already hold HIB backups, folders with "HIB" / "Host Imagus Bridge" in the name, and the one
  * chosen earlier). Ordinary bookmark folders are never listed; the old test-build backup folders are left out too, because Restore lists those backups by itself.
  * To keep a backup somewhere else, make a bookmark folder with HIB in its name. */
 const fillFolderList=async()=>{
  const sel=$('backupFolder');sel.replaceChildren();
  const tree=await browser.bookmarks.getTree();const out=[];flatFolders(tree[0],[],out);
  const saved=await currentFolderId(false);
  const withBackups=new Set();
  try{for(const b of await browser.bookmarks.search({query:'HIB settings'}))if(b.url&&b.title.startsWith(BK_PREFIX))withBackups.add(b.parentId);}catch(e){}
  const shown=out.filter(f=>f.id===saved||(!/Host Imagus Bridge TEST/i.test(f.label)&&(withBackups.has(f.id)||/(^|[^A-Za-z])(HIB|Host Imagus Bridge)([^A-Za-z]|$)/i.test(f.label))));
  const seen=new Set();
  for(const f of shown){if(seen.has(f.label))continue;seen.add(f.label);const o=document.createElement('option');o.value=f.id;o.textContent=f.label;sel.append(o);}
  if(!shown.some(f=>f.label.endsWith(BK_DEFAULT_NAME))){const d=document.createElement('option');d.value='__default__';d.textContent=BK_DEFAULT_NAME+' (will be created in Other Bookmarks)';sel.append(d);}
  if(saved&&[...sel.options].some(o=>o.value===saved))sel.value=saved;
  else{const hit=shown.find(f=>f.label.endsWith(BK_DEFAULT_NAME));sel.value=hit?hit.id:(sel.options[0]?sel.options[0].value:'__default__');}
 };
 /* the backups to offer: ONLY the HIB backups in the chosen folder (the old test-build backups are deliberately not listed) */
 const collectBackups=async()=>{
  const list=[];
  const id=await currentFolderId(false)||(()=>null)();
  const folderId=id||($('backupFolder').value&&$('backupFolder').value!=='__default__'?$('backupFolder').value:null);
  if(folderId){
   for(const b of await browser.bookmarks.getChildren(folderId))if(b.url&&b.title.startsWith(BK_PREFIX))list.push({b,source:'',when:b.dateAdded});
  }
  /* A backup packaged inside this install (hib_seed_backup.json). Only a personal build has one; the public builds have none, so nothing extra is listed there. */
  try{
   const r=await fetch(browser.runtime.getURL('hib_seed_backup.json'));
   if(r.ok){
    const rec=await r.json();
    if(rec&&rec.format==='HIB-settings'&&rec.settings&&typeof rec.settings==='object')
     list.push({b:{id:'seed:1',title:BK_PREFIX+String(rec.title||'included backup'),url:null},seed:rec,source:'',when:Date.parse(rec.createdAt)||0,note:'  (included with this install)'});
   }
  }catch(e){}
  return list.sort((x,y)=>y.when-x.when);
 };
 const fillBackupList=async()=>{
  const sel=$('backupList');sel.replaceChildren();
  let items=[];try{items=await collectBackups();}catch(e){}
  const rows=[];
  for(const it of items){
   try{
    const rec=it.seed||await readRecord(it.b.url);const n=siteTotal(rec.settings);
    const old=!!it.source;
    rows.push({id:it.b.id,old,v:n,when:it.when,label:it.source+it.b.title.replace(BK_PREFIX,'')+'  -  '+n+' site'+(n===1?'':'s')+(n<=1?'  (almost empty)':'')+(it.note||'')});
   }catch(e){}
  }
  /* new HIB backups first (newest first), then the old test-build ones (newest first); the fullest sensible one is pre-selected */
  rows.sort((x,y)=>(x.old-y.old)||(y.when-x.when));
  if(!rows.length){const o=document.createElement('option');o.value='';o.textContent='(no backups in this folder yet: use Save Settings)';sel.append(o);$('restoreFromList').disabled=true;return;}
  for(const r of rows){const o=document.createElement('option');o.value=r.id;o.textContent=r.label;sel.append(o);}
  const firstNew=rows.find(r=>!r.old&&r.v>1);
  const best=firstNew||rows.filter(r=>r.old).sort((x,y)=>(y.v-x.v)||(y.when-x.when))[0];
  if(best)sel.value=best.id;
  $('restoreFromList').disabled=false;
 };
 const doSave=async()=>{
  const storage=await browser.storage.local.get(keys);
  const safe=Object.fromEntries(Object.entries(storage).filter(([k])=>!sensitive.test(k)));
  const d=new Date(),pad=n=>String(n).padStart(2,'0');
  const day=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const stamp=day+' '+pad(d.getHours())+':'+pad(d.getMinutes());
  const exportedAt=d.toISOString();
  const fileName='HIB-settings-backup-'+day+'.json';
  let note='';
  try{                                                                  // 1) the bookmark backup (this is what Restore reads)
   const sel=$('backupFolder').value;
   if(sel&&sel!=='__default__')await browser.storage.local.set({hibBackupFolderId:sel});
   const folderId=await currentFolderId(true);
   const record=JSON.stringify({format:'HIB-settings',schemaVersion:1,createdAt:exportedAt,trackedKeys:keys,settings:safe});
   const url=GZ+toB64(await gzipText(record));
   if(url.length>60000)throw Error('settings are too large for a bookmark');
   const kids=await browser.bookmarks.getChildren(folderId);
   const same=kids.find(x=>x.url&&x.title===BK_PREFIX+stamp);
   if(same)await browser.bookmarks.update(same.id,{url});else await browser.bookmarks.create({parentId:folderId,title:BK_PREFIX+stamp,url});
   const mine=(await browser.bookmarks.getChildren(folderId)).filter(x=>x.url&&x.title.startsWith(BK_PREFIX)).sort((x,y)=>y.dateAdded-x.dateAdded);
   for(const old of mine.slice(14))await browser.bookmarks.remove(old.id);   // keep the newest 14
   note='Saved to your bookmarks folder.';
  }catch(e){note='Bookmark backup failed ('+String(e.message||e)+').';}
  try{                                                                  // 2) the dated .json file in Downloads (kept as an extra copy)
   const payload=JSON.stringify({format:'HIB Settings',version:1,exportedAt,trackedKeys:keys,settings:safe},null,2);
   const u=URL.createObjectURL(new Blob([payload],{type:'application/json'}));
   const a=document.createElement('a');a.href=u;a.download=fileName;a.click();setTimeout(()=>URL.revokeObjectURL(u),3000);
   note+=' File: '+fileName+'.';
  }catch(e){}
  say(note);void fillBackupList();
 };
 $('save').onclick=doSave;

 let pending=null;   // the backup waiting for Confirm: {entries}
 const stageRestore=(settings,trackedKeys)=>{
  const allowed=new Set(keys);
  const entries=Object.entries(settings||{}).filter(([k])=>allowed.has(k));
  if(!entries.length)throw Error('The backup has no supported settings.');
  const n=siteTotal(settings);
  pending={entries,sites:n,trackedKeys:Array.isArray(trackedKeys)?trackedKeys:null};
  $('confirmText').textContent='Restore the '+n+' site'+(n===1?'':'s')+' in this backup? Your current site list and settings will be replaced.';
  $('confirmBox').hidden=false;
 };
 $('restoreButton').onclick=async()=>{
  $('restoreInline').hidden=!$('restoreInline').hidden;$('confirmBox').hidden=true;pending=null;
  if(!$('restoreInline').hidden){try{await fillFolderList();await fillBackupList();}catch(e){say('Could not read your bookmarks: '+String(e.message||e));}}
 };
 $('backupFolder').onchange=async()=>{
  const v=$('backupFolder').value;
  if(v==='__default__')await browser.storage.local.remove('hibBackupFolderId');else await browser.storage.local.set({hibBackupFolderId:v});
  $('confirmBox').hidden=true;pending=null;await fillBackupList();
 };
 $('restoreFromList').onclick=async()=>{
  try{
   const id=$('backupList').value;if(!id)throw Error('Choose a saved backup first.');
   let rec;
   if(id.startsWith('seed:')){rec=await (await fetch(browser.runtime.getURL('hib_seed_backup.json'))).json();}
   else{const [b]=await browser.bookmarks.get(id);rec=await readRecord(b.url);}
   stageRestore(rec.settings,rec.trackedKeys);
  }catch(e){say('Restore: '+String(e.message||e));}
 };
 $('confirmNo').onclick=()=>{pending=null;$('confirmBox').hidden=true;say('Restore cancelled.');};
 $('confirmYes').onclick=async()=>{
  if(!pending)return;
  try{
   /* Restore = the state the backup describes. A setting that this backup COVERS (it is in the backup's own trackedKeys list) but has no value in it (it did not
    * exist when the backup was made) is removed, so an obsolete value cannot survive. Only HIB's own tracked keys can ever be touched, and a backup without a
    * trackedKeys list (made by an older build, or a hand-made file) removes nothing: it only writes what it contains. */
   const present=new Set(pending.entries.map(([k])=>k));
   const absent=(pending.trackedKeys||[]).filter(k=>keys.includes(k)&&!present.has(k));
   if(absent.length)await browser.storage.local.remove(absent);
   await browser.storage.local.set(Object.fromEntries(pending.entries));
   const sites=pending.sites;pending=null;$('confirmBox').hidden=true;
   say('Backup restored: '+sites+' site'+(sites===1?'':'s')+'. Reload open pages to use them.');
  }catch(e){say('Restore failed: '+String(e.message||e));}
 };
 /* ===== END Save / Restore settings ===== */

 /* ---------- display sizes + preferred source (moved here from the old Settings page, which no longer exists) ---------- */
 const VIDEO_KEY='hibV210VideoDisplaySize';   // read by the player: {preset,width,height}
 const SOURCE_KEY='hibVideoPreferredSource';
 const presets=[['auto','Automatic (fit screen)'],['854x480','854 × 480'],['960x540','960 × 540'],['1024x576','1024 × 576'],['1280x720','1280 × 720'],['1366x768','1366 × 768 (laptop)'],['1536x864','1536 × 864 (laptop)'],['1600x900','1600 × 900'],['1920x1080','1920 × 1080'],['2560x1440','2560 × 1440'],['3840x2160','3840 × 2160'],['custom','Custom size…']];
 const size=$('mediaSize');for(const [value,label] of presets){const o=document.createElement('option');o.value=value;o.textContent=label;size.append(o);}

 const prefs=await browser.storage.local.get([VIDEO_KEY,SOURCE_KEY,'hibGalleryDisplaySize']);
 $('gallerySize').value=['legacy','fit','original'].includes(prefs.hibGalleryDisplaySize)?prefs.hibGalleryDisplaySize:'legacy';
 const savedSize=prefs[VIDEO_KEY]&&typeof prefs[VIDEO_KEY]==='object'?prefs[VIDEO_KEY]:{};
 size.value=presets.some(x=>x[0]===savedSize.preset)?savedSize.preset:'auto';
 if(savedSize.width)$('customW').value=savedSize.width;if(savedSize.height)$('customH').value=savedSize.height;
 const showCustom=()=>{$('customRow').style.display=size.value==='custom'?'flex':'none';};showCustom();
 $('source').value=['auto','mp4','hls'].includes(prefs[SOURCE_KEY])?prefs[SOURCE_KEY]:'auto';
 // Saved as the player expects it. A custom size is checked (160-7680 x 90-4320); the player keeps the shape of the video inside it.
 async function saveVideoSize(){
  showCustom();
  const w=Number($('customW').value),h=Number($('customH').value);
  if(size.value==='custom'&&(!Number.isInteger(w)||!Number.isInteger(h)||w<160||w>7680||h<90||h>4320)){say('Custom size must be 160–7680 × 90–4320.');return;}
  await browser.storage.local.set({[VIDEO_KEY]:{preset:size.value,width:w,height:h}});
  say(size.value==='custom'?'Custom video size saved: '+w+' × '+h+'.':'Video size saved.');
 }
 $('gallerySize').onchange=async()=>{await browser.storage.local.set({hibGalleryDisplaySize:$('gallerySize').value});say('Gallery preference saved.');};
 size.onchange=saveVideoSize;$('customW').onchange=saveVideoSize;$('customH').onchange=saveVideoSize;
 $('source').onchange=async()=>{await browser.storage.local.set({[SOURCE_KEY]:$('source').value});say('Preferred source saved.');};
 $('resetSizes').onclick=async()=>{
  $('gallerySize').value='legacy';size.value='auto';showCustom();
  await browser.storage.local.set({hibGalleryDisplaySize:'legacy',[VIDEO_KEY]:{preset:'auto',width:1280,height:720}});say('Display sizes reset to defaults.');
 };
})();
