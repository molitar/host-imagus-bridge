"use strict";
/* RC369 experiment: ephemeral IndexedDB disk replay cache. Never buffers a whole video in RAM. */
const hib369Cache=(()=>{
 const DB='hib-rc369-ephemeral-replay',STORE='blocks',TTL=30*60*1000;
 const MAX_TOTAL=6*1024*1024*1024,MAX_VIDEO=1024*1024*1024,BLOCK=48*1024;
 const meta=new Map();let total=0,dbp=null,op=Promise.resolve();
 const videoKey=x=>x.tab+':'+x.frame;
 const segKey=x=>[x.tab,x.frame,x.id,x.seq,x.sha256].join(':');
 function open(){if(dbp)return dbp;dbp=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE);};r.onerror=()=>{dbp=null;reject(r.error);};r.onsuccess=()=>{const db=r.result;db.onclose=()=>{dbp=null;};db.onversionchange=()=>{dbp=null;db.close();};resolve(db);};});return dbp;}
 function closedDBError(e){return e?.name==='InvalidStateError'&&/closed database|closing database|not running|not open/i.test(String(e?.message||e));}
 async function retryClosedDB(fn){try{return await fn();}catch(e){if(!closedDBError(e))throw e;dbp=null;return await fn();}}
 function txn(db,mode,fn){return new Promise((resolve,reject)=>{const t=db.transaction(STORE,mode),s=t.objectStore(STORE);let result;t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error||Error('cache transaction error'));t.onabort=()=>reject(t.error||Error('cache transaction abort'));try{result=fn(s);}catch(e){t.abort();reject(e);}});}
 // Never make persisted entries survive a browser background startup: the tab IDs are not reusable sessions.
 let broken=false,brokenWhy='';
 // RC388: the replay cache is optional. If its database cannot be cleared (quota / corrupt), delete and recreate it once;
 // if that also fails, run RAM-only instead of failing playback.
 const ready=(async()=>{
  for(let attempt=0;attempt<2;attempt++){
   try{const db=await open();await txn(db,'readwrite',s=>s.clear());return;}
   catch(e){brokenWhy=String(e&&e.name||e);dbp=null;try{await new Promise(r=>{const q=indexedDB.deleteDatabase(DB);q.onsuccess=q.onerror=q.onblocked=()=>r();setTimeout(r,3000);});}catch(_){}}
  }
  broken=true;console.warn('HIB replay cache disabled (RAM only):',brokenWhy);
 })();
 const serial=fn=>{const result=op.then(fn);op=result.catch(()=>{});return result;};
 async function removeOne(x){const db=await open();await txn(db,'readwrite',s=>{for(let i=0;i<x.parts;i++)s.delete(x.key+':'+i);});if(meta.delete(x.key))total-=x.bytes;}
 async function clean(held){const now=Date.now();for(const x of [...meta.values()])if(now-x.created>TTL&&!held(x.tab))await removeOne(x);}
 async function put(desc,bytes,held){return serial(async()=>{
  try{await ready;if(broken)return {ok:false,error:'disk-cache-unavailable'};await clean(held);const key=segKey(desc);if(meta.has(key))return {ok:true,cached:true};
   if(bytes.length>MAX_VIDEO)return {ok:false,error:'per-video-limit'};
   let used=0;for(const x of meta.values())if(videoKey(x)===videoKey(desc))used+=x.bytes;
   if(used+bytes.length>MAX_VIDEO)return {ok:false,error:'per-video-limit'};
   if(total+bytes.length>MAX_TOTAL){
    const old=[...meta.values()].filter(x=>!held(x.tab)).sort((a,b)=>a.created-b.created);
    for(const x of old){if(total+bytes.length<=MAX_TOTAL)break;await removeOne(x);}
   }
   if(total+bytes.length>MAX_TOTAL)return {ok:false,error:'total-limit-active-sessions'};
   const db=await open(),parts=Math.ceil(bytes.length/BLOCK);
   await txn(db,'readwrite',s=>{for(let i=0;i<parts;i++)s.put(bytes.slice(i*BLOCK,Math.min((i+1)*BLOCK,bytes.length)),key+':'+i);});
   const x={...desc,key,bytes:bytes.length,parts,created:Date.now(),kind:'media'};
   meta.set(key,x);total+=bytes.length;return {ok:true,cached:true};
  }catch(e){return {ok:false,error:'disk-cache-write:'+String(e)};}
 });}
 async function read(desc,offset){await ready;if(broken)return null;const x=meta.get(segKey(desc));if(!x)return null;if(Date.now()-x.created>TTL)return null;
  const i=Math.floor(offset/BLOCK),pos=offset%BLOCK;if(i>=x.parts)return null;
  return retryClosedDB(async()=>{const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(x.key+':'+i);r.onsuccess=()=>{const b=r.result;resolve(b?{chunk:new Uint8Array(b).subarray(pos),total:x.bytes}:null);};r.onerror=()=>reject(r.error);});});}
 async function has(desc){
  await ready;if(broken)return false;
  const x=meta.get(segKey(desc));
  if(!x||Date.now()-x.created>TTL||x.parts<1)return false;
  // Confirm at least the first persisted block exists, not metadata alone.
  return retryClosedDB(async()=>{const db=await open();
   return new Promise((resolve,reject)=>{
    const t=db.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(x.key+':0');
    r.onsuccess=()=>resolve(!!r.result && r.result.byteLength>0);
    r.onerror=()=>reject(r.error);
   });});
 }
 async function list(tab){await ready;if(broken)return [];return [...meta.values()].filter(x=>x.tab===tab&&Date.now()-x.created<=TTL).map(x=>({kind:x.kind,mime:x.mime,frame:x.frame,id:x.id,bytes:x.bytes,sha256:x.sha256,seq:x.seq,created:x.created,archived:true}));}
 async function dropTab(tab){return serial(async()=>{await ready;if(broken)return {ok:true};for(const x of [...meta.values()])if(x.tab===tab)await removeOne(x);return {ok:true};});}
 const stats=()=>({cachedBytes:total,cachedFragments:meta.size,maxTotalBytes:MAX_TOTAL,maxVideoBytes:MAX_VIDEO,ttlMinutes:30});
 return {put,read,has,list,dropTab,clean:(held=()=>false)=>serial(async()=>{await ready;if(!broken)await clean(held);}),stats};
})();
