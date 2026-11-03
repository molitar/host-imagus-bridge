"use strict";
/* Manage Sites: one compact row per site: domain, image checkbox, video checkbox, delete. No dropdowns. */
(async()=>{
 const $=id=>document.getElementById(id);
 const norm=h=>String(h||'').trim().toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
 const params=new URLSearchParams(location.search);
 const tab=(await browser.tabs.query({active:true,currentWindow:true}))[0];
 const current=(()=>{
  const forced=params.get('site');if(forced)return norm(forced);
  try{const u=new URL(tab?.url||'');return /^https?:$/.test(u.protocol)?norm(u.hostname):null;}catch{return null;}
 })();
 const say=m=>{$('status').textContent=m;};
 $('back').onclick=()=>{location.href='tools.html'+(params.get('site')?'?site='+encodeURIComponent(params.get('site')):'');};

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
 // Video ON: a previously verified site is restored explicitly; any other site only enters SCAN mode and is registered later, by a verified
 // playback. Enabling video never bypasses verification. Video OFF removes the registration and the scan mode.
 async function setVideo(h,on){
  if(on){
   if(await wasVerified(h))await browser.runtime.sendMessage({type:'hib-rc154-set-site',host:h,value:true});
   else await browser.runtime.sendMessage({type:'hib-rc153-set-test',host:h,value:true});
   return;
  }
  await browser.runtime.sendMessage({type:'hib-rc154-set-site',host:h,value:false});
  await browser.runtime.sendMessage({type:'hib-rc153-set-test',host:h,value:false});
 }

 const ICON_IMG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 9"/></svg>';
 const ICON_VID='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>';
 const ICON_DEL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
 async function knownSites(){
  const s=await browser.storage.local.get(['enabledSites','hibRc139ScanVideoHosts','hibImageSiteHosts']);
  const set=new Set();
  for(const x of Array.isArray(s.enabledSites)?s.enabledSites:[]){const h=norm(typeof x==='string'?x:x?.host||x?.domain);if(h)set.add(h);}
  for(const k of Object.keys(s.hibRc139ScanVideoHosts||{}))set.add(norm(k));
  for(const k of Object.keys(s.hibImageSiteHosts||{}))set.add(norm(k));
  return [...set].filter(Boolean).sort();
 }
 const PER_PAGE=8;let page=0;
 async function render(){
  const list=$('list');list.textContent='';
  const sites=await knownSites();
  $('count').textContent=sites.length?sites.length+(sites.length===1?' site':' sites'):'';
  $('filterWrap').style.display=sites.length>PER_PAGE?'block':'none';
  if(!sites.length){const e=document.createElement('div');e.className='empty';e.textContent='No sites yet. Add one below, or use Add Image Site on a website.';list.append(e);return;}
  const filter=$('filter').value.trim().toLowerCase();
  const shown=sites.filter(h=>!filter||h.includes(filter));
  const pages=Math.max(1,Math.ceil(shown.length/PER_PAGE));
  if(page>=pages)page=pages-1;
  // Pages instead of a scrolling list: the toolbar never shows a vertical scrollbar.
  const pager=$('pager');pager.style.display=pages>1?'flex':'none';
  if(pages>1){pager.textContent='';const prev=document.createElement('button');prev.textContent='‹';prev.title='Previous';prev.disabled=page===0;prev.onclick=()=>{page--;render();};const label=document.createElement('span');label.textContent=(page+1)+' / '+pages;const next=document.createElement('button');next.textContent='›';next.title='Next';next.disabled=page>=pages-1;next.onclick=()=>{page++;render();};pager.append(prev,label,next);}
  for(const h of shown.slice(page*PER_PAGE,page*PER_PAGE+PER_PAGE)){
   const r=await readSite(h);
   const video=r.state.permanentVideo||r.state.override;
   const row=document.createElement('div');row.className='siteItem'+(h===current?' current':'');
   const name=document.createElement('span');name.className='siteName';name.textContent=h;name.title=h;
   const mk=(icon,label,checked,onchange)=>{
    const l=document.createElement('label');l.className='chk';l.title=label;l.innerHTML=icon;
    const c=document.createElement('input');c.type='checkbox';c.checked=checked;c.setAttribute('aria-label',label+' for '+h);
    c.onchange=async()=>{
     await onchange(c.checked);await render();
     say(label+(c.checked?' on':' off')+' for '+h+(label==='Video'&&c.checked?(await wasVerified(h)?' (previously verified registration restored).':' (scan mode: registered only after a verified playback).'):'.'));
    };
    l.append(c);return l;
   };
   const del=document.createElement('button');del.className='trash';del.title='Remove '+h;del.setAttribute('aria-label','Remove '+h);del.innerHTML=ICON_DEL;
   del.onclick=async()=>{if(!confirm('Remove '+h+' from HIB (image and video)? Learned card rules are kept.'))return;await setImage(h,false);await setVideo(h,false);await render();say(h+' removed.');};
   row.append(name,mk(ICON_IMG,'Image',r.image,v=>setImage(h,v)),mk(ICON_VID,'Video',video,v=>setVideo(h,v)),del);
   list.append(row);
  }
 }
 $('filter').oninput=()=>{page=0;render();};
 // Add a site: registered for images only. Video is chosen afterwards (checkbox), and stays subject to verification.
 const addSite=async()=>{
  const h=norm($('newSite').value.replace(/^https?:\/\//i,'').split('/')[0]);
  if(!h||!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)){say('Enter a domain such as example.com.');return;}
  await setImage(h,true);$('newSite').value='';await render();say(h+' added (images).');
 };
 $('add').onclick=addSite;
 $('newSite').onkeydown=e=>{if(e.key==='Enter')addSite();};
 await render();
})();
