"use strict";
/* RC398: manual quality control for adaptive players (hls.js, dash.js, Shaka). Generic by player library, never by site.
   Active only while HIB capture is enabled. It registers player instances and applies a rendition the user picked in the HIB player. */
(async()=>{
 const {hibRC360CaptureEnabled:on}=await browser.storage.local.get('hibRC360CaptureEnabled').catch(()=>({}));
 if(on!==true)return;
 if(!(await browser.runtime.sendMessage({type:'hib-rc462-site-active'}).then(r=>!!(r&&r.active)).catch(()=>false)))return;   // RC462: only on sites in the user's list
 const w=window.wrappedJSObject;
 if(!w||typeof exportFunction!=='function'||typeof cloneInto!=='function')return;
 const reg={hls:[],dash:[],shaka:[]};
 const note=(kind,inst)=>{try{inst=(inst&&inst.wrappedJSObject)||inst;if(inst&&!reg[kind].includes(inst))reg[kind].push(inst);}catch(_){}};
 const patched=[];
 // Lazy read-time hook: whatever way the library defines its members, the page reads them through the global.
 const lazy=(name,prop,wrapFn)=>{
  let val,proxy=null;const cache=new Map();
  const make=v=>{
   try{
    const h={get:exportFunction(function(t,k){
      const o=t.wrappedJSObject||t;const x=o[k];
      if(k===prop&&(typeof x==='function')){let y=cache.get(x);if(!y){try{y=wrapFn(x)||x;}catch(e){patched.push('wrap '+name+'.'+prop+' '+e);y=x;}cache.set(x,y);}return y;}
      return x;},w)};
    return new w.Proxy(v,cloneInto(h,w,{cloneFunctions:true}));
   }catch(e){patched.push('proxy '+name+' '+e);return null;}
  };
  try{val=w[name];}catch(_){}
  if(val)proxy=make(val);
  try{Object.defineProperty(w,name,{configurable:true,enumerable:true,get:exportFunction(function(){return proxy||val;},w),set:exportFunction(function(v0){const v=(v0&&v0.wrappedJSObject)||v0;val=v;proxy=v&&typeof v==='object'||typeof v==='function'?make(v):null;},w)});}catch(e){patched.push('define '+name+' '+e);}
 };
 // hls.js: Hls itself is the class; patch its prototype once when the page first reads it.
 {
  let hv,hdone=false;
  try{hv=w.Hls;}catch(_){}
  const patchHls=C=>{if(hdone||!C||!C.prototype||!C.prototype.attachMedia)return;hdone=true;const p=C.prototype,am=p.attachMedia,ls=p.loadSource;
   p.attachMedia=exportFunction(function(m){note('hls',this);return am.call(this,m);},w);
   if(ls)p.loadSource=exportFunction(function(u){note('hls',this);return ls.call(this,u);},w);patched.push('hls.prototype');};
  if(hv)patchHls(hv);
  /* RC460: NO accessor on window.Hls any more (it stopped pornhub's own player from ever requesting its stream). The class is patched when it is seen as an ordinary property, by polling for the first 60 s and again on the first play. */
  const seekHls=()=>{try{const d=Object.getOwnPropertyDescriptor(w,'Hls');if(d&&!d.get&&d.value&&typeof d.value==='function')patchHls(d.value);}catch(_){}};
  seekHls();let tries=0;const tm=setInterval(()=>{seekHls();if(hdone||++tries>240)clearInterval(tm);},250);
 }
 lazy('dashjs','MediaPlayer',mp=>{
  const wrap=exportFunction(function(c){
   const f=c===undefined?mp.call(this):mp.call(this,c);
   if(f&&typeof f.create==='function'&&!f.__hibq){f.__hibq=1;const oc=f.create;f.create=exportFunction(function(a){const pl=a===undefined?oc.call(this):oc.call(this,a);note('dash',pl);return pl;},w);}
   return f;},w);
  try{for(const k of Object.keys(mp))wrap[k]=mp[k];}catch(_){}
  patched.push('dash.MediaPlayer');return wrap;});
 lazy('shaka','Player',P=>{
  if(P&&P.prototype&&P.prototype.load&&!P.prototype.load.__hibq){const ld=P.prototype.load;
   P.prototype.load=exportFunction(function(u,st,mt){note('shaka',this);return ld.call(this,u,st,mt);},w);P.prototype.load.__hibq=1;patched.push('shaka.load');}
  return P;});
 const num=x=>Number.isFinite(Number(x))?Number(x):0;
 const dbg=[];
 const list=()=>{
  const out=[];dbg.length=0;dbg.push('reg '+reg.hls.length+'/'+reg.dash.length+'/'+reg.shaka.length);
  for(const h of reg.hls){try{const lv=[];for(let i=0;i<h.levels.length;i++){const l=h.levels[i];lv.push({id:i,height:num(l.height),width:num(l.width),bitrate:num(l.bitrate)});}
   if(lv.length>1)out.push({kind:'hls',levels:lv,current:h.autoLevelEnabled?-1:num(h.currentLevel)});}catch(e){dbg.push('hls '+e);}}
  for(const d of reg.dash){try{const info=d.getBitrateInfoListFor('video'),lv=[];
   for(let i=0;i<info.length;i++)lv.push({id:num(info[i].qualityIndex),height:num(info[i].height),width:num(info[i].width),bitrate:num(info[i].bitrate)});
   const auto=!!d.getSettings().streaming.abr.autoSwitchBitrate.video;
   if(lv.length>1)out.push({kind:'dash',levels:lv,current:auto?-1:num(d.getQualityFor('video'))});}catch(e){dbg.push('dash '+e);}}
  for(const s of reg.shaka){try{const tr=s.getVariantTracks(),lv=[];let cur=-1;
   for(const t of tr){if(t.active)cur=num(t.id);lv.push({id:num(t.id),height:num(t.height),width:num(t.width),bitrate:num(t.bandwidth)});}
   const auto=!!s.getConfiguration().abr.enabled;
   const seen=new Set(),uniq=lv.filter(l=>seen.has(l.id)?false:seen.add(l.id));
   if(uniq.length>1)out.push({kind:'shaka',levels:uniq,current:auto?-1:cur});}catch(e){dbg.push('shaka '+e);}}
  return out;
 };
 const set=(kind,id)=>{
  id=Number(id);let done=0;
  if(kind==='hls')for(const h of reg.hls){try{h.nextLevel=id;done++;}catch(_){}}
  if(kind==='dash')for(const d of reg.dash){try{
   if(id<0)d.updateSettings(cloneInto({streaming:{abr:{autoSwitchBitrate:{video:true}}}},w));
   else{d.updateSettings(cloneInto({streaming:{abr:{autoSwitchBitrate:{video:false}}}},w));d.setQualityFor('video',id,true);}
   done++;}catch(_){}}
  if(kind==='shaka')for(const s of reg.shaka){try{
   if(id<0)s.configure(cloneInto({abr:{enabled:true}},w));
   else{const t=s.getVariantTracks().find(x=>Number(x.id)===id);if(t){s.configure(cloneInto({abr:{enabled:false}},w));s.selectVariantTrack(t,true);}}
   done++;}catch(_){}}
  return done;
 };
 browser.runtime.onMessage.addListener(m=>{
  if(!m||typeof m.type!=='string')return;
  if(m.type==='hib-rc387-q-list'){const p=list();return Promise.resolve({ok:true,players:p,dbg:dbg.slice().concat(patched)});}
  if(m.type==='hib-rc387-q-set'){return Promise.resolve({ok:true,applied:set(String(m.kind),m.id)});}
 });
})();
