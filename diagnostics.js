"use strict";
/* Diagnostics page (moved out of the main toolbar window): stream capture switch, Diagnostics mode and the support-only tools. */
(async()=>{
 const $=id=>document.getElementById(id);
 const params=new URLSearchParams(location.search);
 const keep=params.get('site')?'?site='+encodeURIComponent(params.get('site')):'';
 const tab=(await browser.tabs.query({active:true,currentWindow:true}))[0];
 const say=m=>{$('status').textContent=m;};
 $('back').onclick=()=>{location.href='tools.html'+keep;};
 /* RC410: Diagnostics mode (storage key hibDiagMode, default off) enables the support-only buttons. The standard flow
  * never needs them. hib_rc410_embed.js reads the same key to enable the stand-alone diagnostics player page. */
 const diagStore=await browser.storage.local.get('hibDiagMode');
 const applyDiag=on=>{for(const id of ['rc360copy','rc360clear','rc363play'])$(id).disabled=!on;};
 $('diagmode').checked=diagStore.hibDiagMode===true;   /* RC510: OFF by default */
 $('diagmode').checked=$('diagmode').checked;applyDiag($('diagmode').checked);
 $('diagmode').onchange=async()=>{await browser.storage.local.set({hibDiagMode:$('diagmode').checked});applyDiag($('diagmode').checked);say('Diagnostics mode '+($('diagmode').checked?'on':'off')+'.');};
 $('rc360copy').onclick=async()=>{
   const r=await browser.runtime.sendMessage({type:'hib-rc360-get',tabId:tab?.id});
   const lines=['HIB RC361b BYTE-TRANSFER ACK DIAGNOSTICS','Tab: '+(tab?.url?new URL(tab.url).origin:'unknown')];
   for(const x of (r.records||[]))lines.push(x.time+' frame='+x.frameId+' '+x.event+' '+x.detail);
   await navigator.clipboard.writeText(lines.join('\n'));
   say('Copied '+(r.records||[]).length+' diagnostic events.');
 };
 $('rc363play').onclick=async()=>{
  if(!Number.isInteger(tab?.id))return say('No source tab: open the original video webpage first.');
  const btn=$('rc363play');btn.disabled=true;
  try{
    // RC410: DIAGNOSTICS ONLY (button is disabled unless Diagnostics mode is on). Normal playback is a right-click on the card. This opens the stand-alone diagnostic tab used to reproduce bug reports.
    // Open our independent player unconditionally. Capture state is reported inside that tab.
    // Never invoke play() or modify the source website from this action.
    const url=browser.runtime.getURL('hib_rc363_player.html?tab='+encodeURIComponent(tab.id));
    const created=await browser.tabs.create({url,active:true});
    if(!created?.id)throw Error('Firefox did not return a new player tab');
    window.close();
  }catch(e){say('HIB player tab failed: '+String(e));btn.disabled=false;}
};
 $('rc360clear').onclick=async()=>{await browser.runtime.sendMessage({type:'hib-rc360-clear',tabId:tab?.id});say('Current tab diagnostics cleared.');};

})();
