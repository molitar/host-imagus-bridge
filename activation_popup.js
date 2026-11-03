"use strict";
/* ===== TOOLBAR / SITE & PLAYER PREFERENCES ===== */
(async()=>{
 const $=id=>document.getElementById(id);
 const tab=(await browser.tabs.query({active:true,currentWindow:true}))[0];
 const norm=h=>String(h||'').trim().toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
 // "Current site" is the domain part of the page's address (muchohentai.com). ?site= lets the page be previewed outside a web tab.
 const host=(()=>{
  const forced=new URLSearchParams(location.search).get('site');
  if(forced)return norm(forced);
  try{const u=new URL(tab?.url||'');return /^https?:$/.test(u.protocol)?norm(u.hostname):null;}catch{return null;}
 })();
 const config={delay:'hibHoverVideoDelaySeconds'};
 const AUDIO_KEY='hibTestVideoPlaybackDefaults'; // read by the player: {volume 0..1, muted}
 $('version').textContent='Host Imagus Bridge v'+browser.runtime.getManifest().version;
 $('host').textContent=host||'Not a website';
 const say=m=>{$('status').textContent=m;};
 let state=null,imageOn=false;

 /* ---------- header ---------- */
 $('closeBtn').onclick=()=>window.close();
 $('helpBtn').onclick=()=>$('help').classList.toggle('show');
 // (the old Settings window is gone: display sizes + preferred source now live in Tools)

 /* ---------- site controls ---------- */
 async function readSite(h){
  const [s,all]=await Promise.all([browser.runtime.sendMessage({type:'hib-rc153-read-activation',host:h}),browser.storage.local.get('hibImageSiteHosts')]);
  return {state:s,image:all.hibImageSiteHosts?.[h]===true};
 }
 async function setImage(h,on){
  const d=await browser.storage.local.get('hibImageSiteHosts');const map={...(d.hibImageSiteHosts||{})};
  if(on)map[h]=true;else delete map[h];
  await browser.storage.local.set({hibImageSiteHosts:map});
 }
 // A site is "previously verified" when HIB has a playback-verified rule for it (a player type saved after a real, played video).
 async function wasVerified(h){
  const d=await browser.storage.local.get('hibRc133VerifiedSiteRules');
  const cards=d.hibRc133VerifiedSiteRules?.[h]?.cards||{};
  return Object.values(cards).some(c=>c&&c.verified&&c.kind!=='landing');
 }
 // Video ON: a previously verified site is restored explicitly; any other site only enters SCAN mode and is registered later, by a
 // verified playback. Enabling video never bypasses verification. Video OFF removes the registration and the scan mode.
 async function setVideo(h,on){
  if(on){
   if(await wasVerified(h))await browser.runtime.sendMessage({type:'hib-rc154-set-site',host:h,value:true});
   else await browser.runtime.sendMessage({type:'hib-rc153-set-test',host:h,value:true});
   return;
  }
  await browser.runtime.sendMessage({type:'hib-rc154-set-site',host:h,value:false});
  await browser.runtime.sendMessage({type:'hib-rc153-set-test',host:h,value:false});
 }
 async function sync(){
  if(!host)return;
  const r=await readSite(host);state=r.state;imageOn=r.image;
  const video=state.permanentVideo||state.override;
  $('imageSiteText').textContent=imageOn?'Remove Image Site':'Add Image Site';
  $('videoSiteText').textContent=state.permanentVideo?'Remove Video Site':state.override?'Stop Video Scan':'Scan Site for Videos';
  const on=imageOn||video;
  $('siteToggle').checked=on;
  $('siteText').textContent=on?'HIB is enabled on this site.':'HIB is disabled on this site.';
 }
 $('siteToggle').onchange=async()=>{
  if(!host)return;
  if($('siteToggle').checked){await setImage(host,true);say('HIB enabled for '+host+' (images). Use Scan Site for Videos for video; it is registered only after a verified playback.');}
  else{await setImage(host,false);await setVideo(host,false);say('HIB disabled for '+host+'.');}
  await sync();
 };
 $('imageSite').onclick=async()=>{if(!host)return;await setImage(host,!imageOn);await sync();say('Image registration updated; learned card rules preserved.');};
 $('videoSite').onclick=async()=>{
  if(!host)return;
  if(state?.permanentVideo){await browser.runtime.sendMessage({type:'hib-rc154-set-site',host,value:false});say('Video site registration removed. Learned rules preserved.');}
  else{await browser.runtime.sendMessage({type:'hib-rc153-set-test',host,value:!state?.override});say(state?.override?'Video scan stopped.':'Video scanning enabled. The site is NOT registered until playback is verified.');}
  await sync();
 };

 /* ---------- playback + hover delay ---------- */
 const prefs=await browser.storage.local.get([config.delay,AUDIO_KEY]);
 const audio=prefs[AUDIO_KEY]&&typeof prefs[AUDIO_KEY]==='object'?prefs[AUDIO_KEY]:{};
 const number=(v,min,max,def)=>Number.isFinite(+v)&&v!==undefined&&v!==null&&+v>=min&&+v<=max?+v:def;
 const delayText=n=>n+(n===1?' second':' seconds');
 $('hoverDelay').value=number(prefs[config.delay],1,10,2);$('delayValue').textContent=delayText(+$('hoverDelay').value);
 const vol=Number.isFinite(+audio.volume)&&audio.volume!==null?Math.round(Math.min(1,Math.max(0,+audio.volume))*100):100;$('volume').value=vol;$('volumePct').value=vol;
 $('startMuted').checked=audio.muted===true;
 const store=async(k,v)=>{await browser.storage.local.set({[k]:v});say('Setting saved.');};
 $('hoverDelay').oninput=()=>{$('delayValue').textContent=delayText(+$('hoverDelay').value);};
 $('hoverDelay').onchange=()=>store(config.delay,Number($('hoverDelay').value));
 // RC441: default subtitle language for the HIB player (storage hibSubtitleLang; 'en' when never set)
 {const sl=await browser.storage.local.get('hibSubtitleLang');$('subLang').value=typeof sl.hibSubtitleLang==='string'?sl.hibSubtitleLang:'en';}
 $('subLang').onchange=async()=>{await browser.storage.local.set({hibSubtitleLang:$('subLang').value});say('Setting saved.');};
 // Default volume moves in 1% steps; the slider and the number box stay in step.
 const clampPct=v=>Math.min(100,Math.max(0,Math.round(Number(v)||0)));
 $('volume').oninput=()=>{$('volumePct').value=$('volume').value;};
 const saveAudio=async()=>{await browser.storage.local.set({[AUDIO_KEY]:{volume:clampPct($('volume').value)/100,muted:$('startMuted').checked}});say('Setting saved.');};
 $('volume').onchange=saveAudio;
 $('volumePct').oninput=()=>{if($('volumePct').value!=='')$('volume').value=clampPct($('volumePct').value);};
 $('volumePct').onchange=()=>{const v=clampPct($('volumePct').value);$('volumePct').value=v;$('volume').value=v;saveAudio();};
 $('startMuted').onchange=saveAudio;

 /* ---------- Tools: its own page (Manage Sites, Report Issue, Save / Restore). Pick Card stays here: it needs the page you are on. ---------- */
 $('toolsBtn').onclick=()=>{location.href='tools.html'+(new URLSearchParams(location.search).get('site')?'?site='+encodeURIComponent(new URLSearchParams(location.search).get('site')):'');};
 $('picker').onclick=async()=>{try{const r=await browser.tabs.sendMessage(tab.id,{type:'hib-rc186-start-picker'});if(!r?.ok)throw Error('Picker did not start');window.close();}catch(e){say('Pick Card failed: '+e);}};

 if(host)await sync();else{$('imageSite').disabled=true;$('videoSite').disabled=true;$('picker').disabled=true;$('siteToggle').disabled=true;$('siteText').textContent='Open a website to use HIB here.';}
})();
