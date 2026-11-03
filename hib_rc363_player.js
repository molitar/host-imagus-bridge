"use strict";
/* RC368 TEST: RC367 auto-completion plus per-track first-fragment retention for replay startup. */
const $=id=>document.getElementById(id),tab=Number(new URLSearchParams(location.search).get('tab'));
const log=(...v)=>{$('log').textContent+=v.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n';};
let objectUrl=null,mediaSource=null,run=0,activeBuffers=null,activeFrame=null,finishRequested=false;
let completionLogged=false;
// RC385K: user-opt-in native MSE pacing. Never alters the source tab,
// capture, replay cache, fragments, or independent direct-MP4 player.
// RC385R: opt-in startup gate and per-track continuous playable lead.
const rc385r={startup:false,ready:false,startMs:0,lastMetrics:0,appendedBytes:0,appendedByTrack:new Map(),prevHashes:new Map(),lastSpeedAt:Date.now(),lastSpeedBytes:0};
const rc385k={held:false,pausedByUs:false,holds:0,resumes:0,playRejections:0,lastLead:null};
let RC385R_START=10.5,RC385R_RESUME=10.5;const RC385R_LOW=0.75;
// RC385S: cap each SourceBuffer's forward playback horizon. This keeps captured
// fragments in the bounded receiver until they can be safely appended and ACKed.
let RC385S_FORWARD_WHILE_PAUSED=11.5,RC385S_FORWARD_PLAYING=12.5;
const RC385S_RETAIN_BEHIND=3;
const rc385s={holds:0,quotaWaits:0,quotaRetries:0,lastHoldLog:new Map(),lastQuotaLog:new Map()};
function rc385sForwardLimit(){
 if($('rc385kSmooth')?.checked!==true)return Infinity;
 const v=$('video');return v.paused?RC385S_FORWARD_WHILE_PAUSED:RC385S_FORWARD_PLAYING;
}
function rc385sMayFeed(b){
 const lead=rc385rRangeLead(b.sb.buffered,$('video').currentTime);
 return {allow:lead<rc385sForwardLimit(),lead,limit:rc385sForwardLimit()};
}
async function rc385sFreeBehind(b){
 const v=$('video'),sb=b.sb,cutoff=v.currentTime-RC385S_RETAIN_BEHIND;
 if(!(cutoff>0)||!sb.buffered.length)return false;
 let removed=false;
 // Never remove data within three seconds of the playhead.
 for(let i=sb.buffered.length-1;i>=0;i--){
  const start=sb.buffered.start(i),end=Math.min(sb.buffered.end(i),cutoff);
  if(end>start+0.1){if(sb.updating)await once(sb,'updateend','error');sb.remove(start,end);await once(sb,'updateend','error');removed=true;}
 }
 return removed;
}

// RC385T read-only source/receiver starvation sampling. Does not demand, seek,
// play or reload source media, and never retains remote URLs or credentials.
const rc385t={lastSampleAt:0,lastReason:'',samples:0};
async function rc385tSnapshot(reason,listed,frame,buffers){
 const now=Date.now();
 if(now-rc385t.lastSampleAt<6000)return;
 rc385t.lastSampleAt=now;rc385t.lastReason=reason;rc385t.samples++;
 const ids=[...buffers.keys()];const tracks=ids.map(id=>{
  const b=buffers.get(id),visible=(listed?.tracks||[]).filter(x=>x.frame===frame&&x.id===id&&x.kind!=='init'&&x.seq>=b.next);
  return {id,mime:b.init.mime,nextExpectedSeq:b.next,visiblePending:visible.length,
   firstVisibleSeq:visible.length?Math.min(...visible.map(x=>x.seq)):null,
   lastVisibleSeq:visible.length?Math.max(...visible.map(x=>x.seq)):null,
   bufferLeadSeconds:Number(rc385rRangeLead(b.sb.buffered,$('video').currentTime).toFixed(3))};
 });
 const outcomes=await Promise.allSettled([
  browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab}),
  browser.runtime.sendMessage({type:'hib-rc360-get',tabId:tab}),
  browser.runtime.sendMessage({type:'hib-rc363-list',tabId:tab})
 ]);
 const get=i=>outcomes[i].status==='fulfilled'?outcomes[i].value:{ok:false,error:String(outcomes[i].reason)};
 const session=get(0),observer=get(1),receiver=get(2),v=$('video');
 const observerStates=(observer.observerStates||[]).map(x=>({frameId:x.frameId,seenAt:x.seenAt,
  transferFailures:x.transferFailures,backpressureStops:x.backpressureStops,
  tracks:(x.tracks||[]).map(t=>({id:t.id,verified:t.verified,captured:t.captured,lost:t.lost,stopReason:t.stopReason}))}));
 log('RC385T STARVATION SNAPSHOT',{
  reason,sample:rc385t.samples,playback:{time:v.currentTime,paused:v.paused,readyState:v.readyState,
   videoError:v.error?.code||null,leads:rc385rLeads(),startupWaiting:rc385r.startup},
  playbackTracks:tracks,source:{ok:session.ok,captureState:session.captureState,
   captureAgeMs:session.captureAgeMs,sourceState:session.sourceState,
   videos:(session.sourceVideos||[]).map(x=>({paused:x.paused,readyState:x.readyState,
    networkState:x.networkState,currentTime:x.currentTime,bufferedEnd:x.bufferedEnd,
    duration:x.duration,error:x.error,sourceAttached:x.sourceAttached})),
   tracks:(session.tracks||[]).map(t=>({frame:t.frame,id:t.id,mime:t.mime,
    mediaSeq:t.mediaSeq,verified:t.verified})),error:session.error},
  receiver:{ok:receiver.ok,listedFragments:receiver.tracks?.length||0,
   visibleUnconsumed:(receiver.tracks||[]).filter(x=>x.frame===frame&&x.kind!=='init'&&buffers.has(x.id)&&x.seq>=buffers.get(x.id).next).length,
   byTrack:tracks.map(t=>({id:t.id,allListed:(receiver.tracks||[]).filter(x=>x.frame===frame&&x.id===t.id).length})),
   error:receiver.error},observer:observerStates,forwardCapSeconds:rc385sForwardLimit(),
  note:'Read-only snapshot; no source playback, seek, network range requests or media modifications.'});
}
function rc385rRangeLead(ranges,time){
 // RC407: many files start their first video frame a little after 0 (e.g. 0.1 s). Tolerate that gap at the very start of the timeline.
 const tol=time<1?0.5:0.05;
 try{for(let i=0;i<ranges.length;i++)if(ranges.start(i)<=time+tol&&ranges.end(i)>=time-0.05)return Math.max(0,ranges.end(i)-time);}catch(_){}
 return 0;
}
function rc385rLeads(){
 const v=$('video'),at=v.currentTime;let video=null,audio=null;
 if(activeBuffers)for(const b of activeBuffers.values()){
  const lead=rc385rRangeLead(b.sb.buffered,at);
  if(b.init.mime.startsWith('video/'))video=lead;
  if(b.init.mime.startsWith('audio/'))audio=lead;
 }
 return {video,audio,continuous:Math.min(video??Infinity,audio??Infinity,v.buffered.length?rc385rRangeLead(v.buffered,at):0)};
}
function rc385kLead(){return rc385rLeads().continuous;}
// RC393: the MediaSource cannot hold more than ~10-12 s of a 4K stream (browser eviction), so the longer start/resume
// cache is the captured queue waiting in the extension. It grows with every underrun. A stalled or finished source
// (no queue growth for 6 s) or a 45 s wait never blocks playback.
const rc393={pending:0,grewAt:Date.now(),needMiB:220,since:Date.now()};
// RC401: predict an overrun. fill = media-seconds buffered per wall second while the MSE is not at its forward cap.
// To play the remaining R seconds without another stop the buffer must hold B = R*(1-fill) seconds first; the MSE only holds ~12 s,
// so the rest is the queued capture. Convert to MiB with the observed bytes per media second.
const rc401={win:[],fill:1,samples:0};
function rc401Sample(lead){
 const v=$('video'),now=Date.now();if(!Number.isFinite(v.duration)||v.paused)return;
 const w=rc401.win;w.push([now,lead]);while(w.length&&now-w[0][0]>14000)w.shift();
 if(w.length<5||now-w[0][0]<8000)return;
 if(Math.max(...w.map(x=>x[1]))>=rc385sForwardLimit()-1.2)return; // capped window: supply not measurable
 // least squares slope of lead (s/s); buffer grows at fill = 1 + slope media-seconds per second
 const n=w.length,t0=w[0][0];let sx=0,sy=0,sxx=0,sxy=0;
 for(const [t,l] of w){const x=(t-t0)/1000;sx+=x;sy+=l;sxx+=x*x;sxy+=x*l;}
 const den=n*sxx-sx*sx;if(!den)return;
 const slope=(n*sxy-sx*sy)/den;
 rc401.fill=Math.max(0,Math.min(2,1+slope));rc401.samples++;
}
function rc401Need(lead){
 const v=$('video'),R=Math.max(0,v.duration-v.currentTime);
 if(rc401.samples<1||rc401.fill>=0.97||!R)return null;
 const B=R*(1-rc401.fill),mediaSec=Math.max(1,v.currentTime+lead),bps=rc385r.appendedBytes/mediaSec;
 const queueSec=Math.max(0,B-12);
 return Math.max(100,Math.min(300,Math.round(queueSec*bps/1048576)));
}
// RC408: the pre-buffer is sized by the video length: ~15 % of the duration, 3-20 s (a 20 s clip needs ~3 s, 2 min ~18 s, long videos 20 s),
// growing by 50 % per underrun. The lead threshold and the queued-bytes threshold both follow it.
function rc408ReqSec(){
 const d=$('video').duration;if(!Number.isFinite(d)||d<=0)return 10.5;
 let s=Math.max(3,Math.min(20,d*0.15));s*=1+0.5*rc385k.holds;
 return Math.min(30,s,Math.max(2,d-1));
}
function rc393QueueReady(lead){
 const now=Date.now(),v=$('video'),req=rc408ReqSec();
 // RC409: if the SourceBuffer already holds the length-based target, there is nothing to wait for; otherwise never wait longer than 3 s + the target.
 if(lead>=req)return true;
 if(now-rc393.since>3000+req*1000)return true;
 let needMiB=rc393.needMiB;
 const mediaSec=Math.max(1,v.currentTime+(lead||0)),bps=rc385r.appendedBytes>2*1048576?rc385r.appendedBytes/mediaSec:0;
 if(bps>0)needMiB=Math.min(needMiB,Math.max(8,req*bps/1048576*1.2));
 return rc393.pending>=needMiB*1048576||now-rc393.grewAt>6000||now-rc393.since>45000;
}
const rc402={primed:false,playing:false,muteSwap:false,wasMuted:false};
function rc408Unmute(){if(rc402.muteSwap){rc402.muteSwap=false;try{$('video').muted=rc402.wasMuted;}catch(_){}}}
const rc406={be:0,at:Date.now()};
// RC404: the browser keeps about 70-100 MiB per SourceBuffer, so the useful cache (seconds) depends on the stream bitrate:
// ~12 s for 70 Mbps 4K, up to 40 s for ordinary streams. Replace the fixed 8/10/12 s numbers by that measured value.
let rc404Last=0;
function rc404Adapt(lead){
 const now=Date.now();if(now-rc404Last<2000||rc385r.appendedBytes<24*1048576)return;rc404Last=now;
 const v=$('video'),mediaSec=Math.max(1,v.currentTime+lead),bps=rc385r.appendedBytes/mediaSec;
 const cap=Math.max(12.5,Math.min(40,Math.round(70*1048576/bps*2)/2));
 if(Math.abs(cap-RC385S_FORWARD_PLAYING)>=1){
  RC385S_FORWARD_PLAYING=cap;RC385S_FORWARD_WHILE_PAUSED=cap-1;RC385R_START=RC385R_RESUME=Math.max(10.5,Math.min(20,cap-2));
  log('RC404 CACHE TARGET ADAPTED',JSON.stringify({bytesPerSecondMiB:+(bps/1048576).toFixed(2),forwardCapSeconds:cap,startResumeSeconds:RC385R_START}));
 }
}
function rc385kTick(){
 const v=$('video'),enabled=$('rc385kSmooth')?.checked===true;
 if(enabled&&rc385r.startup&&mediaSource&&mediaSource.readyState==='open'&&!Number.isFinite(v.duration))return; // RC400: duration not known yet; keep waiting, do not drop the start-up gate
 if(!enabled||!mediaSource||mediaSource.readyState!=='open'||v.seeking||v.ended||!Number.isFinite(v.duration)){
  if(rc385r.startup){rc385r.startup=false;rc385r.ready=true;log('RC385R STARTUP GATE DISABLED');}
  if(rc385k.held){rc385k.held=false;log('RC385K BUFFER PACING DISABLED',{time:v.currentTime});if(rc385k.pausedByUs){rc385k.pausedByUs=false;rc408Unmute();v.play().catch(e=>{rc385k.playRejections++;log('RC385K USER PLAY REQUIRED',e.name);});}}
  return;
 }
 const leads=rc385rLeads(),lead=leads.continuous;rc385k.lastLead=lead;rc401Sample(lead);rc404Adapt(lead);
 // RC400: also the tail when everything up to the known end is already buffered (a hold there could never be released by lead>=10.5)
 const atTail=v.duration-v.currentTime<0.5||v.duration-(v.currentTime+lead)<0.6;
 if(rc385r.startup){
  // RC402: prime = play about 1 s so the timeline/first frame exist, then pause and pre-buffer before resuming (as a normal hold).
  if(!rc402.primed&&lead>=2&&lead<rc408ReqSec()&&!atTail){rc402.primed=true;rc402.playing=true;rc402.wasMuted=v.muted;rc402.muteSwap=true;v.muted=true;v.play().catch(e=>{rc402.playing=false;log('RC402 PRIME PLAY REFUSED',e.name);});return;}
  if(rc402.primed&&v.currentTime>=1&&!atTail){
   v.pause();rc402.playing=false;rc385r.startup=false;rc385r.ready=true;rc385k.held=true;rc385k.pausedByUs=true;
   rc393.since=Date.now();rc393.grewAt=Date.now();
   log('RC402 PRIMED: paused after 1 s, pre-buffering before playback',JSON.stringify({lead:+lead.toFixed(1),queuedMiB:Math.round(rc393.pending/1048576),needMiB:rc393.needMiB}));
   return;
  }
  if(rc402.primed&&!rc402.playing)rc402.primed=false;
  if(rc402.primed)return;
  if((lead>=Math.min(RC385R_START,rc408ReqSec())&&rc393QueueReady(lead))||atTail){
   rc385r.startup=false;rc385r.ready=true;rc385k.held=false;
   log('RC385R STARTUP BUFFER READY',{reqSeconds:+rc408ReqSec().toFixed(1),queuedMiB:Math.round(rc393.pending/1048576),elapsedMs:Date.now()-rc385r.startMs,lead,videoAhead:leads.video,audioAhead:leads.audio});
   rc408Unmute();v.play().catch(e=>log('RC385R USER PLAY REQUIRED',e.name));
  }
  return;
 }
 if(rc385k.held){
  if((lead>=Math.min(RC385R_RESUME,rc408ReqSec())&&rc393QueueReady(lead))||atTail){rc385k.held=false;rc385k.resumes++;if(rc385k.pausedByUs){rc385k.pausedByUs=false;rc408Unmute();v.play().then(()=>log('RC385R BUFFER RESUME',{time:v.currentTime,lead,videoAhead:leads.video,audioAhead:leads.audio})).catch(e=>{rc385k.playRejections++;log('RC385R USER PLAY REQUIRED',e.name);});}}
 }else if(!v.paused&&!atTail&&v.currentTime>0.2&&lead<RC385R_LOW){
  rc385k.held=true;rc385k.pausedByUs=true;rc385k.holds++;v.pause();{const n=rc401Need(lead);rc393.needMiB=n!==null?n:Math.min(300,Math.round(rc393.needMiB*1.5));log('RC401 OVERRUN PREDICTION',JSON.stringify({fillRate:+rc401.fill.toFixed(2),remainingSeconds:Math.round(v.duration-v.currentTime),queueTargetMiB:rc393.needMiB}));}rc393.since=Date.now();rc393.grewAt=Date.now();log('RC393 UNDERRUN: next start waits for queued MiB',rc393.needMiB);log('RC385R BUFFER HOLD',{time:v.currentTime,lead,videoAhead:leads.video,audioAhead:leads.audio,resumeAtSecondsAhead:RC385R_RESUME});
 }
}
$('rc385kSmooth').addEventListener('change',()=>{
 const enabled=$('rc385kSmooth').checked;
 log('RC385R BUFFER PACING SET',{enabled,lowWaterSeconds:RC385R_LOW,highWaterSeconds:RC385R_RESUME,initialBufferSeconds:RC385R_START});
 rc385kTick();
});
$('video').addEventListener('timeupdate',rc385kTick);
$('video').addEventListener('play',()=>{if(rc385r.startup&&!rc402.playing&&$('rc385kSmooth').checked){const lead=rc385kLead();if(lead<RC385R_START){$('video').pause();log('RC385R PLAY DEFERRED FOR INITIAL BUFFER',{lead,required:RC385R_START});}}});
window.addEventListener('pagehide',()=>{rc385k.held=false;rc385k.pausedByUs=false;});
// RC385I: read-only playback starvation counters; intentionally no source control.
const rc385iEvents={waiting:0,stalled:0,playing:0,progress:0,lastProgressAt:null,lastWaitingAt:null,lastStalledAt:null};
for(const eventName of ['waiting','stalled','playing','progress']){
 $('video').addEventListener(eventName,()=>{
  rc385iEvents[eventName]++;
  if(eventName==='progress')rc385iEvents.lastProgressAt=Date.now();
  if(eventName==='waiting')rc385iEvents.lastWaitingAt=Date.now();
  if(eventName==='stalled')rc385iEvents.lastStalledAt=Date.now();
 });
}

// RC385C: bounded ISO BMFF structural observer. Only box types and decode ticks
// are retained; no media payloads, URLs, cookies, keys or user content are logged.
const mp4Observations=new Map();
function bmffU32(a,o){return (a[o]*16777216+a[o+1]*65536+a[o+2]*256+a[o+3])>>>0;}
function bmffU64(a,o){return bmffU32(a,o)*4294967296+bmffU32(a,o+4);}
function bmffType(a,o){return String.fromCharCode(a[o],a[o+1],a[o+2],a[o+3]);}
function bmffChildren(a,start,end,fn){
 for(let o=start;o+8<=end;){const size=bmffU32(a,o),type=bmffType(a,o+4);
  if(size<8||o+size>end)return;fn(type,a,o+8,o+size);o+=size;
 }
}
function bmffMoof(a){let decode=[];
 bmffChildren(a,8,a.length,(type,a,start,end)=>{if(type!=='traf')return;
  let trackId=null,dt=null;
  bmffChildren(a,start,end,(t,a,i,j)=>{
   if(t==='tfhd'&&i+8<=j)trackId=bmffU32(a,i+4);
   if(t==='tfdt'&&i+8<=j){const version=a[i];dt=version===1&&i+12<=j?bmffU64(a,i+4):version===0?bmffU32(a,i+4):null;}
  });if(dt!==null)decode.push({trackId,decodeTicks:dt});
 });return decode;
}
// Parse only tkhd track IDs and mdhd timescales, without extracting payloads.
function bmffTimescales(moov){const out=[];
 bmffChildren(moov,8,moov.length,(type,a,start,end)=>{
  if(type!=='trak')return;
  let id=null,scale=null;
  bmffChildren(a,start,end,(t,a,i,j)=>{
   if(t==='tkhd'&&i+24<=j){const version=a[i];const off=version===1?i+20:i+12;if(off+4<=j)id=bmffU32(a,off);}
   if(t!=='mdia')return;
   bmffChildren(a,i,j,(mt,a,mi,mj)=>{
    if(mt!=='mdhd'||mi+20>mj)return;
    const version=a[mi],off=version===1?mi+20:mi+12;
    if(off+4<=mj)scale=bmffU32(a,off);
   });
  });
  if(Number.isInteger(scale)&&scale>0)out.push({trackId:id,timescale:scale});
 });return out;
}
function bmffFeed(id,mime,bytes){let p=mp4Observations.get(id);
 if(!p){p={mime,boxCounts:{},events:[],anomalies:[],stash:new Uint8Array(0),skip:0,appends:0,parsedBytes:0,completedMdats:0,activeMdat:null};mp4Observations.set(id,p);}
 p.appends++;
 let data=bytes,at=0;
 while(at<data.length){
  if(p.skip){const n=Math.min(data.length-at,p.skip);p.skip-=n;at+=n;
   if(p.activeMdat){p.activeMdat.receivedBytes+=n;if(p.skip===0){p.completedMdats++;p.lastCompletedMdat={...p.activeMdat,complete:true};p.activeMdat=null;}}
   continue;}
  // Store at most 1 MiB of structural headers; skip opaque mdat payloads.
  const need=Math.max(0,8-p.stash.length),take=Math.min(need,data.length-at);
  if(take){const b=new Uint8Array(p.stash.length+take);b.set(p.stash);b.set(data.subarray(at,at+take),p.stash.length);p.stash=b;at+=take;}
  if(p.stash.length<8)break;
  const size=bmffU32(p.stash,0),type=bmffType(p.stash,4);
  if(size===0||size===1||size<8||size>268435456||!/^[\x20-\x7e]{4}$/.test(type)){
   if(p.anomalies.length<12)p.anomalies.push({issue:'unsupported-or-invalid-box-header',type,size,append:p.appends});
   p.stash=new Uint8Array(0);break;
  }
  const have=p.stash.length,remaining=size-have;
  if(type==='mdat'){
   p.boxCounts.mdat=(p.boxCounts.mdat||0)+1;
   p.activeMdat={declaredBoxBytes:size,declaredPayloadBytes:size-8,receivedBytes:0,openedAtAppend:p.appends};
   p.stash=new Uint8Array(0);p.skip=remaining;
   if(p.skip===0){p.completedMdats++;p.lastCompletedMdat={...p.activeMdat,complete:true};p.activeMdat=null;}
   continue;
  }
  if(size>1048576){if(p.anomalies.length<12)p.anomalies.push({issue:'oversized-structural-box',type,size});p.stash=new Uint8Array(0);p.skip=remaining;continue;}
  const n=Math.min(Math.max(0,remaining),data.length-at);
  if(n){const b=new Uint8Array(have+n);b.set(p.stash);b.set(data.subarray(at,at+n),have);p.stash=b;at+=n;}
  if(p.stash.length<size)break;
  p.boxCounts[type]=(p.boxCounts[type]||0)+1;
  if(type==='moof'){
   const summary={declaredBytes:size,atAppend:p.appends};
   if(!p.moofSizes)p.moofSizes=[];
   p.moofSizes.push(summary);if(p.moofSizes.length>8)p.moofSizes.shift();
  }
  if(type==='moov'){const scale=bmffTimescales(p.stash);p.timescales=scale;}
  if(type==='moof'){
   const rows=bmffMoof(p.stash);
   for(const row of rows){const previous=p.lastDecode?.[row.trackId??'unknown'];
    if(previous!=null&&row.decodeTicks<previous&&p.anomalies.length<12)p.anomalies.push({issue:'decode-timestamp-decreased',trackId:row.trackId,previous,current:row.decodeTicks,append:p.appends});
    if(!p.lastDecode)p.lastDecode={};p.lastDecode[row.trackId??'unknown']=row.decodeTicks;
    if(p.events.length<10||p.events.length%15===0)p.events.push({...row,append:p.appends});
    if(p.events.length>48)p.events.splice(10,p.events.length-48);
   }
  }
  if((type==='moov'||type==='ftyp')&&(p.boxCounts[type]||0)>1&&p.anomalies.length<12)p.anomalies.push({issue:'repeated-initialization-box',type,append:p.appends});
  p.stash=new Uint8Array(0);
 }
}

function cleanup(){try{rc386Release();}catch(_){}rc385qRecent.length=0;rc385fPrior=null;rc385ePrior=null;mp4Observations.clear();run++;finishRequested=false;completionLogged=false;activeBuffers=null;activeFrame=null;$('finish').disabled=true;try{$('video').pause();$('video').removeAttribute('src');$('video').load();}catch(_){}if(mediaSource?.readyState==='open'){try{mediaSource.endOfStream();}catch(_){}}mediaSource=null;if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
async function status(){const r=await browser.runtime.sendMessage({type:'hib-rc364-status',tabId:tab});if(!r?.ok)throw Error(r?.error||'Status unavailable');const s=await browser.storage.local.get('hibRC360CaptureEnabled');log('CAPTURE STATUS',r,'probe enabled:',s.hibRC360CaptureEnabled===true);if(!r.tracks)log('NO MEDIA: enable probe and recapture on source tab.');return r;}
async function getBytes(x){const out=new Uint8Array(x.bytes);let off=0;while(off<out.length){const r=await browser.runtime.sendMessage({type:'hib-rc363-read',tabId:tab,frame:x.frame,id:x.id,kind:x.kind,seq:x.seq,sha256:x.sha256,offset:off,binary:true});if(!r?.ok)throw Error('Read '+x.kind+'/'+x.id+'/'+x.seq+': '+r?.error);if(r.binary){const u=r.binary instanceof Uint8Array?r.binary:new Uint8Array(r.binary);if(!u.length)throw Error('Read '+x.kind+'/'+x.id+'/'+x.seq+': empty');out.set(u,off);off+=u.length;continue;}const s=atob(r.base64);for(let i=0;i<s.length;i++)out[off+i]=s.charCodeAt(i);off+=s.length;}const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',out)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==x.sha256)throw Error('SHA-256 mismatch '+x.kind+'/'+x.id+'/'+x.seq);return out;}
const once=(obj,yes,no)=>new Promise((resolve,reject)=>{const good=()=>{off();resolve();},bad=()=>{off();reject(Error('MSE event error '+(obj.error?.message||'')));},off=()=>{obj.removeEventListener(yes,good);obj.removeEventListener(no,bad);};obj.addEventListener(yes,good,{once:true});obj.addEventListener(no,bad,{once:true});});
// RC385Q: bounded integrity breadcrumb trail, observational only.
// Records only box headers, fragment identifiers and parser counters; never payloads.
const rc385qRecent=[];
function rc385qRemember(track,seq,kind,data,phase){
 const p=mp4Observations.get(track);
 const top=data.length>=8?{size:bmffU32(data,0),type:bmffType(data,4)}:null;
 const note={at:Date.now(),track,seq,kind,phase,bytes:data.length,top,
   parser:p?{appends:p.appends,stashBytes:p.stash.length,skipBytes:p.skip,
     completedMdats:p.completedMdats,anomalies:p.anomalies.slice(-3)}:null};
 rc385qRecent.push(note);if(rc385qRecent.length>32)rc385qRecent.shift();
 if(p?.anomalies?.length&&p.anomalies.at(-1)?.append===p.appends)
  log('RC385Q MP4 PARSER ANOMALY',note);
}
function rc385qSnapshot(reason){
 const v=$('video');let ranges=[];try{for(let i=0;i<v.buffered.length;i++)ranges.push([v.buffered.start(i),v.buffered.end(i)]);}catch(_){}
 return {reason,at:Date.now(),video:{errorCode:v.error?.code??null,errorMessage:v.error?.message??null,
  time:v.currentTime,duration:v.duration,paused:v.paused,readyState:v.readyState,buffered:ranges},
  mediaSourceState:mediaSource?.readyState??null,
  tracks:[...mp4Observations].map(([id,p])=>({id,mime:p.mime,appends:p.appends,skipBytes:p.skip,
    stashBytes:p.stash.length,completedMdats:p.completedMdats,boxCounts:p.boxCounts,
    recentAnomalies:p.anomalies.slice(-8),lastDecode:p.lastDecode||null})),
  recentFragments:rc385qRecent.slice(-16)};
}
async function append(sb,data){if(sb.updating)await once(sb,'updateend','error');sb.appendBuffer(data);await once(sb,'updateend','error');}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// RC386: keep the (idle) source element playing muted just ahead of this player so it keeps producing fragments.
let rc386Driving=false,rc386Logged=0,rc386LastLog=0;
async function rc386Send(release){const v=$('video');
 try{return await browser.runtime.sendMessage({type:'hib-rc386-drive',tabId:tab,time:v.currentTime||0,playing:(!v.paused&&!v.ended)||rc385r.startup||rc385k.held,release:!!release});}catch(_){return null;}}
function rc386Release(){if(!rc386Driving)return;rc386Driving=false;rc386Send(true).then(()=>log('RC386 SOURCE DRIVE RELEASED'));}
setInterval(async()=>{
 const on=$('rc386drive')?.checked!==false;
 const open=!!mediaSource&&mediaSource.readyState==='open'&&Number.isInteger(tab)&&tab>0;
 if(!on||!open){rc386Release();return;}
 const r=await rc386Send(false);
 if(!rc386Driving){rc386Driving=true;log('RC386 SOURCE DRIVE ACTIVE',r);}
 else{const o=r&&r.frames&&r.frames.map(f=>f.out&&f.out[0]).find(Boolean);
  if(o&&Date.now()-rc386LastLog>8000&&rc386Logged<20){rc386LastLog=Date.now();rc386Logged++;log('RC391 SOURCE DRIVE STATE',JSON.stringify(o)+(o.blocked?' (source play() refused by browser autoplay policy; following by seeking)':''));}}
},500);
// RC389: after a start-up underrun Firefox can stay in 'waiting' (readyState 2) although data is buffered ahead. Nudge the playhead.
const rc389={t:-1,at:Date.now(),nudges:0};
setInterval(()=>{const v=$('video');if(!v||!mediaSource||mediaSource.readyState!=='open')return;
 const t=v.currentTime;if(Math.abs(t-rc389.t)>0.05||v.paused||v.seeking||v.ended){rc389.t=t;rc389.at=Date.now();return;}
 let ahead=0;for(let i=0;i<v.buffered.length;i++)if(v.buffered.start(i)<=t+0.05&&v.buffered.end(i)>t)ahead=v.buffered.end(i)-t;
 if(v.readyState<=2&&ahead>=1&&Date.now()-rc389.at>2000){rc389.at=Date.now();rc389.nudges++;if(rc389.nudges<=12)log('RC389 STALL NUDGE',{t:+t.toFixed(2),ahead:+ahead.toFixed(1),readyState:v.readyState});try{v.currentTime=t+0.01;}catch(_){}}
},1000);
window.addEventListener('pagehide',()=>{/* RC418: always release (the source hold is taken when the window opens, whether or not the driver ran) */browser.runtime.sendMessage({type:'hib-rc386-drive',tabId:tab,time:0,playing:false,release:true}).catch(()=>{});});

async function load(){
 $('load').disabled=true;
 try{
  const v=$('video');
  if(mediaSource&&v.src===objectUrl&&v.error===null&&v.readyState>=2&&v.buffered.length){
    const start=v.buffered.start(0);
    if(v.seekable.length||v.buffered.length)v.currentTime=start;
    log('RC369 REUSE EXISTING MEDIA SOURCE',{bufferedStart:start,duration:v.duration,readyState:v.readyState});
    try {
      await v.play().catch(e=>log('USER PLAY REQUIRED',e.name));
    } finally {
      // Reuse returns before the new-capture try/finally; restore the Load button here.
      $('load').disabled=false;
    }
    return;
  }
 }catch(e){log('RC369 EXISTING SOURCE NOT REUSABLE',String(e));}
 cleanup();rc385r.startup=false;rc385r.ready=false;rc385r.appendedBytes=0;rc385r.appendedByTrack.clear();rc385r.prevHashes.clear();const token=run;
 try{
  if(!Number.isInteger(tab)||tab<=0)throw Error('Missing originating source tab');
  await browser.runtime.sendMessage({type:'hib-rc364-hold',tabId:tab});await status();
  // RC370: do not destroy the independent player on a missing capture. Prime the
  // source once, then wait for init+media from a single frame for up to 12 seconds.
  const isReady=xs=>{const by=new Map();for(const x of xs){const k=x.frame+':'+x.id;const r=by.get(k)||{init:false,media:false};if(x.kind==='init'&&x.seq===0)r.init=true;if(x.kind==='media'&&x.seq===1)r.media=true;by.set(k,r);}return [...by.values()].some(x=>x.init&&x.media);};
  let first=await browser.runtime.sendMessage({type:'hib-rc363-list',tabId:tab});
  // RC387: a previous Load already consumed part of this capture (and the replay cache could not keep it): recapture quietly.
  const rc387Gap=xs=>{const by=new Map();for(const x of xs){const k=x.frame+':'+x.id;const g=by.get(k)||new Set();g.add(x.seq);by.set(k,g);}
   for(const g of by.values()){const max=Math.max(...g);if(max<4)continue;for(let i=0;i<=max;i++)if(!g.has(i))return {track:[...by.keys()].join(','),missing:i,max};}return null;};
  {const gap=first?.ok?rc387Gap(first.tracks||[]):null;
   if(gap){
    log('RC387 CAPTURE ALREADY PARTLY CONSUMED (hole at seq '+gap.missing+' of '+gap.max+'): reloading the source tab quietly to recapture');
    const rq=await browser.runtime.sendMessage({type:'hib-rc387-quiet-recapture',tabId:tab});log('RC387 RECAPTURE',rq);
    if(!rq?.ok)throw Error('Recapture failed: '+(rq?.error||'unknown'));
    const until=Date.now()+75000;
    do{await sleep(600);first=await browser.runtime.sendMessage({type:'hib-rc363-list',tabId:tab});}
    while(token===run&&Date.now()<until&&!(first?.ok&&isReady(first.tracks||[])&&!rc387Gap(first.tracks||[])));
    log('RC387 RECAPTURED',{ready:!!(first?.ok&&isReady(first.tracks||[]))});}}
  if(first?.ok&&!isReady(first.tracks||[])){
   // RC376: the document-start MSE hook is installed only when this persisted
   // setting was already true during source-frame initialization. Do not click
   // a website Play control if HIB knows that hook was disabled.
   const probeSetting=await browser.storage.local.get('hibRC360CaptureEnabled');
   if(probeSetting.hibRC360CaptureEnabled!==true){
     log('RC376 CAPTURE NOT ARMED: source probe was disabled at page initialization. Use Enable Probe & Reload Source for Recapture, then Load & Stream. Source playback was not activated.');
     throw Error('CAPTURE_NOT_ARMED: enable probe and reload source before using Load & Stream');
   }
   log('RC376 CAPTURE PROBE CONFIGURED: verifying source initialization via captured fragments');
   log('RC370 SOURCE IDLE: requesting media initialization once from permitted video frames');
   const attempt=await browser.runtime.sendMessage({type:'hib-rc369-prime',tabId:tab});
   log('RC370 PRIME RESULT',attempt);
   const deadline=Date.now()+12000;
   while(token===run&&Date.now()<deadline){
    await sleep(350);
    first=await browser.runtime.sendMessage({type:'hib-rc363-list',tabId:tab});
    if(!first?.ok||isReady(first.tracks||[]))break;
   }
   if(token!==run)return;
   if(first?.ok&&!isReady(first.tracks||[])){
    log('RC370 INTERACTION REQUIRED: source did not produce initialization and first media fragments; no forced reload or synthetic click');
     // RC373: report poster readiness only after the normal RC371 priming window has failed.
     // No wait, reload, controller click, or capture/fragment change is introduced.
     try {
       const poster=await browser.runtime.sendMessage({type:'hib-rc372-poster-status',tabId:tab});
       if(token!==run)return;
       log('RC373 POSTER ADVISORY',poster);
       if(poster?.ok&&poster.state==='pending')log('RC373 PREVIEW NOT READY: refresh the source website tab manually if the preview image has not appeared, then retry.');
     } catch(e){log('RC373 POSTER ADVISORY UNAVAILABLE',String(e));}
   }
  }

  if(!first?.ok)throw Error(first?.error||'list unavailable');
  const groups=new Map();for(const x of first.tracks){const k=x.frame+':'+x.id;const g=groups.get(k)||{};if(x.kind==='init'&&x.seq===0)g.init=x;else if(x.kind==='media')g.media=true;groups.set(k,g);}
  const ready=[...groups.values()].filter(g=>g.init&&g.media&&/^\s*(audio|video)\/mp4/.test(g.init.mime));
  if(!ready.length)throw Error('No captured initialization and media yet. Recapture with probe enabled.');
  const frame=ready.find(x=>x.init.mime.startsWith('video/'))?.init.frame;
  const tracks=ready.filter(x=>x.init.frame===frame);log('SELECTED FRAME',frame,'tracks',tracks.map(x=>x.init.mime));
  const ms=new MediaSource();mediaSource=ms;objectUrl=URL.createObjectURL(ms);$('video').src=objectUrl;await once(ms,'sourceopen','error');
  const buffers=new Map();activeBuffers=buffers;activeFrame=frame;
  for(const t of tracks){if(!MediaSource.isTypeSupported(t.init.mime)){log('UNSUPPORTED CODEC',t.init.mime);continue;}buffers.set(t.init.id,{sb:ms.addSourceBuffer(t.init.mime),next:0,init:t.init});}
  if(!buffers.size)throw Error('No native codec supported; HEVC WASM not integrated');
  for(const t of tracks){const b=buffers.get(t.init.id);if(!b)continue;{const data=await getBytes(t.init);bmffFeed(t.init.id,t.init.mime,data);rc385qRemember(t.init.id,0,'init',data,'before-append');await append(b.sb,data);}b.next=1;log('INIT APPENDED',t.init.id);}
  rc385t.lastSampleAt=0;rc385t.lastReason='';rc385t.samples=0;
  rc385s.holds=0;rc385s.quotaWaits=0;rc385s.quotaRetries=0;rc385s.lastHoldLog.clear();rc385s.lastQuotaLog.clear();
  rc385r.startup=$('rc385kSmooth').checked;rc385r.ready=!rc385r.startup;rc385r.startMs=Date.now();rc385r.lastMetrics=0;rc385r.lastSpeedAt=Date.now();rc385r.lastSpeedBytes=rc385r.appendedBytes;
  if(rc385r.startup){rc402.primed=false;rc402.playing=false;rc393.since=Date.now();rc393.grewAt=Date.now();rc393.needMiB=220;log('RC385R STARTUP BUFFER WAIT',{requiredContinuousSeconds:RC385R_START,tracks:[...buffers.values()].map(b=>b.init.mime)});rc385kTick();}
  else $('video').play().then(()=>log('play() RESOLVED')).catch(e=>log('play() rejected',e.name,e.message,'Use video controls for user-initiated playback.'));
  $('finish').disabled=false;log('RC367 STREAM ACTIVE: auto-finalize near known duration after queues drain; manual Finish remains available.');
  let lastProgress=Date.now();
  while(token===run&&ms.readyState==='open'){
   const r=await browser.runtime.sendMessage({type:'hib-rc363-list',tabId:tab});if(!r?.ok)throw Error('Capture lost: '+r?.error);
   let progressed=false;
   for(const t of tracks){const b=buffers.get(t.init.id);if(!b)continue;
    const all=r.tracks.filter(x=>x.frame===frame&&x.id===t.init.id&&x.seq>=b.next).sort((a,z)=>a.seq-z.seq);
    if(all.length&&all[0].seq!==b.next){
      // RC385O: A concurrent archive write or out-of-order visibility may
      // temporarily hide a fragment. Requery boundedly; NEVER skip a seq.
      const now=Date.now();
      if(b.gapExpected!==b.next){b.gapExpected=b.next;b.gapSince=now;b.gapLastLog=0;}
      if(now-b.gapLastLog>1500){
        b.gapLastLog=now;
        log('RC385O SEQUENCE GAP WAIT',{track:t.init.id,expected:b.next,firstVisible:all[0].seq,waitMs:now-b.gapSince,visibleAhead:all.length});
      }
      if(now-b.gapSince>6000){
        let verify=null;
        try{const rr=await browser.runtime.sendMessage({type:'hib-rc363-list',tabId:tab});
          verify={ok:rr?.ok,nearby:(rr?.tracks||[]).filter(x=>x.frame===frame&&x.id===t.init.id&&x.seq>=b.next-1&&x.seq<=b.next+4).map(x=>({seq:x.seq,kind:x.kind,bytes:x.bytes}))};
        }catch(e){verify={error:String(e).slice(0,120)};}
        log('RC385O SEQUENCE GAP CONFIRMED',{track:t.init.id,expected:b.next,received:all[0].seq,waitMs:now-b.gapSince,verify});log('RC385Q GAP INTEGRITY SNAPSHOT',rc385qSnapshot('sequence-gap'));
        throw Error('DISCONTINUITY track '+t.init.id+' expected '+b.next+' received '+all[0].seq);
      }
      continue;
    }
    if(b.gapExpected!==undefined){log('RC385O SEQUENCE GAP RECOVERED',{track:t.init.id,seq:b.next,waitMs:Date.now()-b.gapSince});delete b.gapExpected;delete b.gapSince;delete b.gapLastLog;}
    if(!all.length)continue;
    // RC385S: do not fetch, append or ACK more fragments while this track
    // already has enough playable data ahead. Other tracks continue independently.
    const gate=rc385sMayFeed(b);
    if(!gate.allow){
      rc385s.holds++;const now=Date.now(),last=rc385s.lastHoldLog.get(t.init.id)||0;
      if(now-last>4000){rc385s.lastHoldLog.set(t.init.id,now);
        log('RC385S FORWARD CAP HOLD',{track:t.init.id,leadSeconds:Number(gate.lead.toFixed(3)),limitSeconds:gate.limit,paused:$('video').paused,pendingForTrack:all.length,nextSeq:b.next});
      }
      continue;
    }
    if(b.quotaBlocked&&Date.now()<b.quotaRetryAt)continue;
    // RC403: coalesce consecutive media pieces of this track into one append (<= runCap bytes). An MSE byte stream may be split anywhere,
    // so joining pieces is safe; it removes one list+append+ACK round trip per 250-512 KiB piece.
    const grp=[all[0]];
    if(all[0].kind!=='init'){let tot=all[0].bytes;const cap=b.runCap||4194304;
     for(let i=1;i<all.length&&grp.length<24;i++){const y=all[i];if(y.seq!==grp[grp.length-1].seq+1||y.kind==='init'||tot+y.bytes>cap)break;grp.push(y);tot+=y.bytes;}}
    const parts=[];
    for(const y of grp){const d=await getBytes(y);if(token!==run)return;parts.push(d);}
    const x=grp[0];let data=parts[0];
    if(parts.length>1){let n=0;for(const d of parts)n+=d.byteLength;data=new Uint8Array(n);let o=0;for(const d of parts){data.set(d,o);o+=d.byteLength;}}
    for(const y of grp){const priorHash=rc385r.prevHashes.get(y.id);
     if(y.sha256&&priorHash?.sha256===y.sha256&&priorHash.seq!==y.seq)log('RC385R IDENTICAL CONSECUTIVE FRAGMENT',{track:y.id,previousSeq:priorHash.seq,currentSeq:y.seq,bytes:y.bytes,sha256:y.sha256});
     if(y.sha256)rc385r.prevHashes.set(y.id,{seq:y.seq,sha256:y.sha256});}
    // A QuotaExceededError is retryable: preserve the same sequence in the
    // receiver and do NOT mark it consumed. Never call the structure parser
    // twice for a failed append attempt.
    let accepted=false;
    try{await append(b.sb,data);accepted=true;}catch(e){
      if(e?.name==='QuotaExceededError'||String(e).includes('QuotaExceededError')){
        const freed=await rc385sFreeBehind(b);
        b.runCap=Math.max(524288,(b.runCap||4194304)>>1);
        b.quotaBlocked=true;b.quotaRetryAt=Date.now()+1200;rc385s.quotaWaits++;
        log('RC385S QUOTA WAIT',{track:x.id,seq:x.seq,bytes:data.byteLength,freedBehind:freed,leadSeconds:rc385rRangeLead(b.sb.buffered,$('video').currentTime),playhead:$('video').currentTime,note:'Fragment remains unconsumed; will retry same sequence'});
        continue;
      }
      log('RC385Q MSE APPEND FAILURE',{track:x.id,seq:x.seq,error:String(e),integrity:rc385qSnapshot('append-failed')});throw e;
    }
    if(accepted){
      if(b.quotaBlocked){rc385s.quotaRetries++;log('RC385S QUOTA RECOVERED',{track:x.id,seq:x.seq});b.quotaBlocked=false;}
      for(let i=0;i<grp.length;i++){bmffFeed(grp[i].id,t.init.mime,parts[i]);rc385qRemember(grp[i].id,grp[i].seq,grp[i].kind,parts[i],'after-append');}
    }
    for(const y of grp){b.next++;
     if(y.kind!=='init'){const ack=await browser.runtime.sendMessage({type:'hib-rc365-consumed',tabId:tab,frame,id:y.id,seq:y.seq,sha256:y.sha256});if(!ack?.ok)throw Error('Consume ACK failed: '+ack?.error);if(ack.cacheError)log('REPLAY CACHE SKIPPED',ack.cacheError);}}
    progressed=true;lastProgress=Date.now();
    rc385r.appendedBytes+=data.byteLength;rc385r.appendedByTrack.set(x.id,(rc385r.appendedByTrack.get(x.id)||0)+data.byteLength);
    log('MSE APPEND PASS',x.id,'seq',x.seq+(grp.length>1?'-'+grp[grp.length-1].seq:''),'bytes',data.byteLength,'position',$('video').currentTime.toFixed(2));
   }
    rc385kTick();
    // Sample only on real starvation, never on an intentional forward-cap hold.
    const visibleUnconsumed=r.tracks.filter(x=>x.frame===frame&&x.kind!=='init'&&buffers.has(x.id)&&x.seq>=buffers.get(x.id).next).length;
    {let pb=0;for(const x of r.tracks){if(x.frame===frame&&x.kind!=='init'&&buffers.has(x.id)&&x.seq>=buffers.get(x.id).next)pb+=x.bytes||0;}
     if(pb>rc393.pending+262144)rc393.grewAt=Date.now();rc393.pending=pb;}
    const currentLeads=rc385rLeads();
    if(!rc385r.startup&&visibleUnconsumed===0&&currentLeads.continuous<8){
      await rc385tSnapshot('no-visible-fragments-buffer-depleting',r,frame,buffers);
    }else if(!rc385r.startup&&rc385k.held&&currentLeads.continuous<1){
      await rc385tSnapshot('buffer-hold-near-empty',r,frame,buffers);
    }
    if(Date.now()-rc385r.lastMetrics>=3000){
      const now=Date.now(),leads=rc385rLeads(),elapsed=Math.max(1,(now-rc385r.lastSpeedAt)/1000);
      log('RC385R PIPELINE METRICS',{time:$('video').currentTime,sourceTabId:tab,videoAheadSeconds:leads.video,audioAheadSeconds:leads.audio,continuousAheadSeconds:leads.continuous,initialBufferWaiting:rc385r.startup,appendedMiB:Number((rc385r.appendedBytes/1048576).toFixed(2)),appendMiBps:Number(((rc385r.appendedBytes-rc385r.lastSpeedBytes)/1048576/elapsed).toFixed(2)),perTrackMiB:Object.fromEntries([...rc385r.appendedByTrack].map(([id,bytes])=>[id,Number((bytes/1048576).toFixed(2))])),receiverListedFragments:r.tracks.length,forwardCapSeconds:rc385sForwardLimit(),forwardCapHolds:rc385s.holds,quotaWaits:rc385s.quotaWaits,quotaRecoveries:rc385s.quotaRetries,visiblePending:r.tracks.filter(x=>x.frame===frame&&x.kind!=='init'&&buffers.has(x.id)&&x.seq>=buffers.get(x.id).next).length});
      rc385r.lastMetrics=now;rc385r.lastSpeedAt=now;rc385r.lastSpeedBytes=rc385r.appendedBytes;
    }
    // Automatic completion is timeline-based, never an inactivity timeout.
    // Keep the existing manual action as a fallback, using exactly the same safety guard.
    const v=$('video'),d=v.duration;
    const bufferedEnd=v.buffered.length?v.buffered.end(v.buffered.length-1):0;
    const pending=r.tracks.filter(x=>x.frame===frame&&x.kind!=='init'&&buffers.has(x.id)&&x.seq>=buffers.get(x.id).next);
    const nearEnd=Number.isFinite(d)&&d>0&&Number.isFinite(bufferedEnd)&&
      d-v.currentTime<=1.5&&d-v.currentTime>=-0.5&&d-bufferedEnd<=1.0; // RC405: tolerate a last frame/audio packet shorter than the container duration
    const updating=[...buffers.values()].some(x=>x.sb.updating);
    // Only consider finalization after the player has reached the tail, not merely
    // when a seek or a metadata update advertises a finite duration.
    // RC406: if the buffered end stops growing near the advertised end (container duration slightly longer than the real media, or
    // a long video whose last piece is shorter), finish the stream instead of waiting for data that will never arrive.
    {const nowT=Date.now();if(bufferedEnd>rc406.be+0.01||progressed){rc406.be=bufferedEnd;rc406.at=nowT;}}
    const stalledTail=Number.isFinite(d)&&d>0&&Date.now()-rc406.at>4000&&d-bufferedEnd<=3&&d-v.currentTime<=3.5&&bufferedEnd-v.currentTime<=3.5;
    const eligible=(nearEnd||stalledTail)&&!pending.length&&!updating&&!progressed;
    if(eligible){
      const mode=finishRequested?'manual':'automatic';
      finishRequested=false;$('finish').disabled=true;
      try{ms.endOfStream();log('END_OF_STREAM_COMMITTED',{mode,at:v.currentTime,duration:d,bufferedEnd,pending:0,stalledTail});}
      catch(e){log('END_OF_STREAM_FAILED',{mode,error:String(e)});throw e;}
      break;
    }
    if(finishRequested){
      finishRequested=false;
      log('END_OF_STREAM_NOT_READY',{currentTime:v.currentTime,duration:d,bufferedEnd,queued:pending.length,updating,progressed});
    }
   if(!progressed)await sleep(500);
   if(Date.now()-lastProgress>15000){log('WAITING FOR SOURCE APPENDS (15s); source may have paused or ended.');lastProgress=Date.now();}
  }
 }catch(e){log('STREAM ERROR',String(e),e.stack||'');}finally{$('load').disabled=false;}
}
$('finish').onclick=()=>{if(!mediaSource||mediaSource.readyState!=='open'||!activeBuffers){log('FINISH UNAVAILABLE: no open player stream');return;}finishRequested=true;log('FINISH REQUESTED: validating playback end and empty captured queue');};
$('load').onclick=load;
$('status').onclick=()=>status().catch(e=>log('STATUS ERROR',String(e)));
$('recapture').onclick=async()=>{const b=$('recapture');b.disabled=true;try{cleanup();const r=await browser.runtime.sendMessage({type:'hib-rc364-recapture',tabId:tab});log(r?.ok?'RECAPTURE':'RECAPTURE ERROR',r?.message||r?.error);}catch(e){log('RECAPTURE ERROR',String(e));}finally{b.disabled=false;}};
(async()=>{try{await browser.runtime.sendMessage({type:'hib-rc364-hold',tabId:tab});await status();}catch(e){log('INITIAL STATUS ERROR',String(e));}})();
// RC377: UI-only capture log export. No changes to media, cache, or controller logic.
$('copylog').onclick=async()=>{
 const button=$('copylog');
 const capture=$('log').textContent;
 if(!capture){log('COPY CAPTURE LOG: log is empty');return;}
 button.disabled=true;
 const oldLabel=button.textContent;
 try{
   try { await navigator.clipboard.writeText(capture); }
   catch(primary){
     const box=document.createElement('textarea');
     box.value=capture;box.readOnly=true;box.style.cssText='position:fixed;left:-9999px;top:0';
     document.body.appendChild(box);box.select();
     let ok=false;
     try { ok=document.execCommand('copy'); }finally{box.remove();}
     if(!ok)throw primary;
   }
   button.textContent='Copied!';
   log('RC377 CAPTURE LOG COPIED',capture.length+' characters');
 }catch(e){log('RC377 CAPTURE LOG COPY FAILED',String(e));button.textContent='Copy Failed';}
 finally{button.disabled=false;setTimeout(()=>{button.textContent=oldLabel;},1800);}
};
// RC378: Explicit testing-only source-cache reset; never silently wipe an active playback session.
$('clearcache').onclick=async()=>{
 const b=$('clearcache'),v=$('video');
 if(mediaSource && !v.ended && v.readyState>0){
  log('RC378 CACHE CLEAR BLOCKED: active player. Finish or close playback before clearing.');return;
 }
 if(!confirm('Clear captured RAM and disk fragments for THIS source video? This cannot be undone. Other video caches are untouched.'))return;
 b.disabled=true;
 try{
  cleanup();
  const r=await browser.runtime.sendMessage({type:'hib-rc378-clear-source-cache',tabId:tab});
  log(r?.ok?'RC378 SOURCE CACHE CLEARED':'RC378 CACHE CLEAR ERROR',r);
 }catch(e){log('RC378 CACHE CLEAR ERROR',String(e));}
 finally{b.disabled=false;}
};
$('clear').onclick=()=>{$('log').textContent='';};
$('video').addEventListener('error',()=>{log('VIDEO ERROR',$('video').error?.code,$('video').error?.message);log('RC385Q DECODER ERROR INTEGRITY SNAPSHOT',rc385qSnapshot('decoder-error'));browser.runtime.sendMessage({type:'hib-rc360-get',tabId:tab}).then(r=>{log('RC386 SOURCE TRACE',(r?.trace386||[]).slice(-60).map(x=>x.e.replace('RC386_','')+' '+JSON.stringify(x.d)));log('RC386 OBSERVER STATE',r?.observerStates||[]);}).catch(()=>{});});
$('video').addEventListener('loadedmetadata',()=>log('METADATA',$('video').duration,$('video').videoWidth,$('video').videoHeight));
$('video').addEventListener('ended',()=>log('VIDEO ENDED EVENT', {time:$('video').currentTime,duration:$('video').duration}));
log('RC369 EXPERIMENTAL: bounded disk replay cache and source-tab cleanup; existing MediaSource reuse enabled.');

// RC375: observational only; never change RC374 player, source, cache or loading paths.
$('transport').onclick=async()=>{try{const r=await browser.runtime.sendMessage({type:'hib-rc375-transport',tabId:tab});log('RC375 TRANSPORT OBSERVATION',r);}catch(e){log('RC375 TRANSPORT ERROR',String(e));}};

// RC384A: Explicit user-driven metadata capture and extension-origin transport test.
// No player or source reconfiguration and no captured URLs in logs.
$('independentprobe').onclick=async()=>{
 const b=$('independentprobe');b.disabled=true;
 try {
  const r=await browser.runtime.sendMessage({type:'hib-rc384-independent-probe',tabId:tab});
  log('RC384A INDEPENDENT ACQUISITION',r);
  b.textContent=r.phase==='armed'?'Test Acquired Media':'Arm Independent Media Test';
 }catch(e){log('RC384A INDEPENDENT ERROR',String(e));}
 finally {b.disabled=false;}
};
// RC384C: isolated native playback from a fresh signed MP4 candidate.
// Do NOT log the signed URL or persist it. The user must already have closed Drive.
let rc384CActive=false,rc384CLastProgress=-1,rc384CStarted=false;
const rc384CDirect=$('directvideo');
function rc384CVideoState(){const v=rc384CDirect;
 return {time:Number(v.currentTime.toFixed(2)),duration:Number.isFinite(v.duration)?Number(v.duration.toFixed(2)):null,
  paused:v.paused,readyState:v.readyState,networkState:v.networkState,
  width:v.videoWidth,height:v.videoHeight,bufferedEnd:v.buffered.length?Number(v.buffered.end(v.buffered.length-1).toFixed(2)):0,
  error:v.error?{code:v.error.code,message:String(v.error.message||'').slice(0,160)}:null};}
function rc384CStop(){rc384CActive=false;rc384CStarted=false;
 try{rc384CDirect.pause();rc384CDirect.removeAttribute('src');rc384CDirect.load();}catch(_){}
 $('directpanel').hidden=true;$('video').hidden=false;
 log('RC384C DIRECT PLAYBACK STOPPED');}
$('directstop').onclick=rc384CStop;
for(const evt of ['loadedmetadata','canplay','playing','waiting','stalled','seeking','seeked','ended','error'])
 rc384CDirect.addEventListener(evt,()=>{if(!rc384CActive)return;
  log('RC384C DIRECT EVENT',evt,rc384CVideoState());});
rc384CDirect.addEventListener('timeupdate',()=>{
 if(!rc384CActive)return;
 const sec=Math.floor(rc384CDirect.currentTime);
 if(sec>=0&&sec!==rc384CLastProgress&&(sec===0||sec%30===0||sec>=450)){
  rc384CLastProgress=sec;log('RC384C DIRECT PROGRESS',rc384CVideoState());
 }
});
$('postcloseplay').onclick=async()=>{
 const b=$('postcloseplay');b.disabled=true;
 try{
  const r=await browser.runtime.sendMessage({type:'hib-rc384-direct-playback',tabId:tab});
  // The URL is an internal handoff, not a logging field.
  if(!r?.ok||!r?.url){log('RC384C DIRECT PLAYBACK REJECTED',r?.error||'no verified media');return;}
  if(!r.sourceTabClosed||!r.revalidatedAfterClose){log('RC384C DIRECT PLAYBACK REJECTED','missing after-close validation');return;}
  rc384CStop();rc384CActive=true;rc384CLastProgress=-1;
  $('video').pause();$('video').hidden=true;$('directpanel').hidden=false;
  rc384CDirect.src=r.url;
  rc384CDirect.load();
  log('RC384C DIRECT PLAYBACK INITIALIZED',{sourceTabClosed:true,afterCloseRangeValidated:true,
   acquisitionOwner:'HIB extension page / native media element',representation:r.representation,
   instruction:'Use Independent MP4 player controls to start, seek and verify complete playback.'});
 }catch(e){log('RC384C DIRECT PLAYBACK ERROR',String(e).slice(0,200));}
 finally{b.disabled=false;}
};
// RC384B: Test new extension-owned bytes only after the user closes the original source tab.
$('postcloseprobe').onclick=async()=>{
 const b=$('postcloseprobe');b.disabled=true;
 try{const r=await browser.runtime.sendMessage({type:'hib-rc384-post-close-range',tabId:tab});
  log('RC384B POST-CLOSE INDEPENDENT RANGE',r);
 }catch(e){log('RC384B POST-CLOSE ERROR',String(e));}
 finally{b.disabled=false;}
};
// RC383A: Read-only long-form source/consumer comparison. All observations are
// scoped to the source tab bound into this extension-player URL; no source edits.
$('positioncompare').onclick=async()=>{
 const button=$('positioncompare');button.disabled=true;
 try{
  const v=$('video');
  const ranges=Array.from({length:v.buffered.length},(_,i)=>({start:v.buffered.start(i),end:v.buffered.end(i)}));
  const present=ranges.find(x=>v.currentTime>=x.start-0.05&&v.currentTime<=x.end+0.05);
  const h={time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,
   paused:v.paused,waiting:v.readyState<=2,readyState:v.readyState,seeking:v.seeking,
   resolution:[v.videoWidth,v.videoHeight],bufferedEnd:present?.end??null,
   secondsAhead:present?Math.max(0,present.end-v.currentTime):0,bufferedRanges:ranges};
  const source=await browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab});
  const videos=Array.isArray(source?.sourceVideos)?source.sourceVideos:[];
  const initialized=videos.filter(x=>x.sourceAttached&&x.readyState>=1);
  const s=initialized[0]||videos[0]||null;
  const offset=s&&Number.isFinite(s.currentTime)?Number((h.time-s.currentTime).toFixed(3)):null;
  const comparison={ok:!!source?.ok,sourceTabId:tab,
   hib:h,source:{captureState:source?.captureState||null,captureAgeMs:source?.captureAgeMs??null,
    state:source?.sourceState||null,paused:s?.paused??null,readyState:s?.readyState??null,
    currentTime:s?.currentTime??null,bufferedEnd:s?.bufferedEnd??null,
    sourceAttached:s?.sourceAttached??null,resolution:'not-collected',
    tracks:(source?.tracks||[]).map(t=>({mime:t.mime,seq:t.mediaSeq,frame:t.frame}))},
   positionDifferenceSeconds:offset,
   classification:!source?.ok?'source-unavailable':
    !s||!s.sourceAttached?'source-reset-or-uninitialized':
    h.secondsAhead<=0.25&&source.captureState==='no-new-fragments'?'hib-starved-source-inactive':
    h.secondsAhead<=0.25?'hib-buffer-low':
    source.captureState==='no-new-fragments'?'prefetch-idle-buffer-available':'buffer-available',
   note:'Read-only only; playback positions and MIME do not prove independent acquisition. Original source resolution is not supplied by RC379 API.'};
  log('RC383A POSITION COMPARISON',comparison);
 }catch(e){log('RC383A POSITION ERROR',String(e));}
 finally{button.disabled=false;}
};


// RC385F: Read-only stage-by-stage capture, queue, append comparison.
// Intentionally shares existing source-session, status, and queue APIs; no source interaction.
let rc385fPrior=null;
$('pipelinediag').onclick=async()=>{
 const btn=$('pipelinediag');btn.disabled=true;
 try{
  const now=Date.now();
  const [source,status,queue,sourceEvents]=await Promise.all([
   browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab}),
   browser.runtime.sendMessage({type:'hib-rc364-status',tabId:tab}),
   browser.runtime.sendMessage({type:'hib-rc363-list',tabId:tab}),
   browser.runtime.sendMessage({type:'hib-rc360-get',tabId:tab})
  ]);
  const captureTracks=(source?.tracks||[]).map(t=>{
   const prev=rc385fPrior?.captureTracks?.find(p=>p.frame===t.frame&&p.sourceBufferId===t.sourceBufferId&&p.mime===t.mime);
   return {frame:t.frame,id:t.sourceBufferId,mime:t.mime,mediaSeq:t.mediaSeq??null,
    verifiedFragments:t.verifiedFragments??null,
    mediaSeqDelta:prev&&Number.isFinite(t.mediaSeq)&&Number.isFinite(prev.mediaSeq)?t.mediaSeq-prev.mediaSeq:null,
    verifiedDelta:prev&&Number.isFinite(t.verifiedFragments)&&Number.isFinite(prev.verifiedFragments)?t.verifiedFragments-prev.verifiedFragments:null};
  });
  const pending=(queue?.tracks||[]).filter(x=>x.kind==='media').reduce((a,x)=>{
   const key=x.frame+':'+x.id;
   const existing=a[key]||(a[key]={frame:x.frame,id:x.id,fragments:0,bytes:0,minSeq:null,maxSeq:null});
   existing.fragments++;existing.bytes+=(Number(x.bytes)||0);
   existing.minSeq=existing.minSeq===null?x.seq:Math.min(existing.minSeq,x.seq);
   existing.maxSeq=existing.maxSeq===null?x.seq:Math.max(existing.maxSeq,x.seq);
   return a;
  },{});
  const appended=[...(activeBuffers?.entries()||[])].map(([id,b])=>{
   let ranges=[];try{ranges=Array.from({length:b.sb.buffered.length},(_,i)=>({start:b.sb.buffered.start(i),end:b.sb.buffered.end(i)}));}catch(_){}
   const prev=rc385fPrior?.appended?.find(p=>p.id===id);
   const count=Math.max(0,b.next-1);
   const obs=mp4Observations.get(id);
   return {id,nextRequiredSeq:b.next,appendedMediaCount:count,
    appendDelta:prev?count-prev.appendedMediaCount:null,
    mp4InspectedAppends:obs?.appends??null,
    updating:b.sb.updating,bufferedRanges:ranges,
    queueAhead:(queue?.tracks||[]).filter(x=>x.kind==='media'&&x.frame===activeFrame&&x.id===id&&Number(x.seq)>=b.next).length,
    retainedHistorical:(pending[activeFrame+':'+id]?.fragments||0),
    pendingMP4PayloadBytes:obs?.skip??null};
  });
  const v=$('video');
  // Observer lifecycle and stop reasons: only known event names and sanitized numeric metadata.
  const eventNames=['HOOK_INSTALLED','HOOK_FAILED','HOOK_UNAVAILABLE','SOURCE_BUFFER_CREATED',
   'SEGMENT_CAPTURED','SEGMENT_TRANSFER_VERIFIED','SEGMENT_TRANSFER_FAILED',
   'CAPTURE_BACKPRESSURE_STOP','CAPTURE_ERROR','APPEND_BUFFER'];
  const rows=(sourceEvents?.records||[]).filter(x=>eventNames.includes(x.event));
  const eventCounts={};for(const x of rows)eventCounts[x.event]=(eventCounts[x.event]||0)+1;
  const significant=rows.filter(x=>['HOOK_INSTALLED','HOOK_FAILED','HOOK_UNAVAILABLE','SOURCE_BUFFER_CREATED',
   'SEGMENT_TRANSFER_FAILED','CAPTURE_BACKPRESSURE_STOP','CAPTURE_ERROR'].includes(x.event))
   .slice(-15).map(x=>{
    let d={};try{d=JSON.parse(x.detail||'{}')}catch(_){}
    return {event:x.event,time:x.time,frameId:x.frameId,
     sourceBufferId:Number.isInteger(d.sourceBufferId)?d.sourceBufferId:(Number.isInteger(d.id)?d.id:null),
     seq:Number.isInteger(d.seq)?d.seq:null,bytes:Number.isFinite(d.bytes)?d.bytes:null,
     pendingBytes:Number.isFinite(d.pendingBytes)?d.pendingBytes:null,
     limit:Number.isFinite(d.limit)?d.limit:null,
     errorCode:['HOOK_FAILED','CAPTURE_ERROR','SEGMENT_TRANSFER_FAILED'].includes(x.event)?String(d.error||d.message||'').slice(0,120):null};
   });
  const report={ok:!!(source?.ok&&status?.ok&&queue?.ok),elapsedMs:rc385fPrior?now-rc385fPrior.at:null,
   source:{ok:!!source?.ok,state:source?.captureState??null,ageMs:source?.captureAgeMs??null,
    mediaState:source?.sourceState??null,tracks:captureTracks},
   captureStore:{ok:!!status?.ok,queuedBytes:status?.queuedBytes??null,tracks:status?.tracks??null,
    completePairs:status?.completePairs??null,
    replayCache:{cachedBytes:status?.replayCache?.cachedBytes??null,cachedFragments:status?.replayCache?.cachedFragments??null}},
   handoffQueue:{ok:!!queue?.ok,trackCounts:Object.values(pending)},
   sourceObserver:{eventsRetained:rows.length,eventCounts,significantEvents:significant,
    lifecycleStates:sourceEvents?.observerStates||[],
    note:'Event log is bounded to last 400 records; absence of a historic event is not proof it never occurred.'},
   hibAppend:{mediaSourceState:mediaSource?.readyState??'none',tracks:appended,
    currentTime:v.currentTime,readyState:v.readyState,paused:v.paused},
   interpretation:'queueAhead now counts only sequence >= nextRequiredSeq. CAPTURE_BACKPRESSURE_STOP indicates observer disabled further capture on that SourceBuffer after exceeding pendingBytes limit; existing appends may remain playable. Absence of an event in the bounded log is inconclusive.',
   privacy:'No fragment payloads, URLs, keys, headers, or credentials logged.'};
  // RC385I: correlate consumer starvation against already-available source session state.
  let bufferedRanges=[];
  try{bufferedRanges=Array.from({length:v.buffered.length},(_,i)=>({start:v.buffered.start(i),end:v.buffered.end(i)}));}catch(_){}
  const currentRange=bufferedRanges.find(r=>v.currentTime>=r.start-0.1&&v.currentTime<=r.end+0.1);
  const sourceVideos=(source?.sourceVideos||[]).map(item=>({
   currentTime:Number.isFinite(item.currentTime)?item.currentTime:null,
   readyState:item.readyState??null,paused:item.paused??null,
   sourceAttached:item.sourceAttached??null,bufferedEnd:item.bufferedEnd??null
  }));
  const playback={time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,
   readyState:v.readyState,networkState:v.networkState,paused:v.paused,seeking:v.seeking,
   bufferedRanges,bufferedAheadSeconds:currentRange?Math.max(0,currentRange.end-v.currentTime):0,
   sourceVideos,events:{...rc385iEvents},
   warning:'Source video position is observational only; no source playback or download is triggered.'};
  report.rc385iPlaybackContinuity=playback;
  log('RC385I PLAYBACK CONTINUITY',{
   captureAgeMs:source?.captureAgeMs??null,captureState:source?.captureState??null,
   sourceObserver:report.sourceObserver?.lifecycleStates||[],playback,
   note:'Read-only. A low buffered-ahead interval proves starvation, not why the upstream source stopped appending.'});
  log('RC385H CAPTURE LIFECYCLE',report);
  rc385fPrior={at:now,captureTracks:captureTracks.map(t=>({frame:t.frame,sourceBufferId:t.id,mime:t.mime,mediaSeq:t.mediaSeq,verifiedFragments:t.verifiedFragments})),appended:appended.map(t=>({id:t.id,appendedMediaCount:t.appendedMediaCount}))};
 }catch(e){log('RC385F PIPELINE ERROR',String(e));}finally{btn.disabled=false;}
};

// RC385E: Cross-site HEVC delivery snapshot. No polling, source control, or media changes.
let rc385ePrior=null;
$('deliverydiag').onclick=()=>{
 const now=Date.now();
 const rows=[...mp4Observations.entries()].map(([id,p])=>{
  const sb=activeBuffers?.get(id)?.sb;
  let buffered=[];try{if(sb)buffered=Array.from({length:sb.buffered.length},(_,i)=>({start:sb.buffered.start(i),end:sb.buffered.end(i)}));}catch(_){}
  const prev=rc385ePrior?.tracks?.find(x=>x.id===id);
  return {id,mime:p.mime,appends:p.appends,appendsDelta:prev?p.appends-prev.appends:null,
   completeMdats:p.completedMdats,completeMdatsDelta:prev?p.completedMdats-prev.completeMdats:null,
   pendingPayloadBytes:p.skip,pendingReceivedBytes:p.activeMdat?.receivedBytes??0,
   declaredPayloadBytes:p.activeMdat?.declaredPayloadBytes??null,bufferedRanges:buffered,
   latestDecodeTicks:p.lastDecode||{},structuralAnomalies:p.anomalies.length};
 });
 const report={ok:true,sourceTabId:tab,elapsedMs:rc385ePrior?now-rc385ePrior.at:null,
  playbackPosition:$('video').currentTime,playerReadyState:$('video').readyState,
  mediaSourceState:mediaSource?.readyState||'none',tracks:rows,
  interpretation:'A zero delta means no newly appended chunks between snapshots, not necessarily no upstream downloads. Incomplete mdat can be normal until further bytes arrive.',
  note:'Read-only; no payload, credential, key, or source URL logged.'};
 log('RC385E HEVC DELIVERY',report);
 rc385ePrior={at:now,tracks:rows.map(x=>({id:x.id,appends:x.appends,completedMdats:x.completeMdats}))};
};

// RC385D: Read-only per-track fragment completeness and track timescales.
$('fragmentcomplete').onclick=()=>{
 const tracks=[...mp4Observations.entries()].map(([id,p])=>({
  id,mime:p.mime,appendsInspected:p.appends,
  moofCount:p.boxCounts.moof||0,mdatStarted:p.boxCounts.mdat||0,
  mdatCompleted:p.completedMdats||0,
  pendingMdat:p.activeMdat?{...p.activeMdat,missingPayloadBytes:p.skip,complete:false}:null,
  mostRecentCompletedMdat:p.lastCompletedMdat||null,
  latestMoofDeclarations:p.moofSizes||[],
  trackTimescales:p.timescales||[],
  decodeTicks:p.lastDecode||{},
  pendingStructuralBytes:p.stash.length,
  parseAnomalies:p.anomalies,
  bufferRanges:(()=>{const x=activeBuffers?.get(id)?.sb;try{return x?Array.from({length:x.buffered.length},(_,i)=>({start:x.buffered.start(i),end:x.buffered.end(i)})):[];}catch(_){return[];}})()
 }));
 log('RC385D FRAGMENT COMPLETENESS',{ok:true,sourceTabId:tab,
  mediaSourceState:mediaSource?.readyState||'none',
  playbackPosition:$('video').currentTime,tracks,
  note:'Counts reflect appended bytes, not upstream HTTP completeness. No media payloads, keys, tokens or URLs retained.'});
};

// RC385C: Inspect only bounded box metadata observed during Load & Stream.
$('mp4timeline').onclick=()=>{
 const tracks=[...mp4Observations.entries()].map(([id,p])=>({id,mime:p.mime,
  appendsInspected:p.appends,boxCounts:p.boxCounts,lastDecodeTicks:p.lastDecode||{},
  sampledDecodeTicks:p.events,anomalies:p.anomalies,pendingStructuralBytes:p.stash.length,
  pendingMdatBytes:p.skip}));
 log('RC385C MP4 TIMELINE',{
  ok:true,sourceTabId:tab,mediaSourceState:mediaSource?.readyState||'none',
  tracks,note:'Decode timestamps are raw track ticks, NOT seconds; absent tfdt may mean format or parser limitations. Read-only diagnostics; does not retain any MP4 payload bytes beyond parser scratch space.'});
};

// RC385B: Read-only snapshot of the actual HIB SourceBuffer timelines.
// Never calls appendBuffer/remove/abort, never seeks, fetches or changes playback.
$('bufferranges').onclick=async()=>{
 const b=$('bufferranges');b.disabled=true;
 try{
  const video=$('video');
  const ranges=tr=>{try{return Array.from({length:tr?.length||0},(_,i)=>({start:+tr.start(i).toFixed(3),end:+tr.end(i).toFixed(3)}));}catch(e){return [{readError:String(e)}];}};
  const buffers=[...(activeBuffers?.entries()||[])].map(([id,entry])=>{
   const sb=entry.sb;
   return {id,mime:entry.init?.mime||null,frame:entry.init?.frame??null,
    nextCaptureSeq:entry.next,appendedMediaCount:Math.max(0,entry.next-1),
    updating:!!sb.updating,mode:sb.mode,timestampOffset:sb.timestampOffset,
    appendWindowStart:sb.appendWindowStart,appendWindowEnd:Number.isFinite(sb.appendWindowEnd)?sb.appendWindowEnd:null,
    bufferedRanges:ranges(sb.buffered)};
  });
  const ends=buffers.map(t=>({mime:t.mime,end:t.bufferedRanges.length?t.bufferedRanges[t.bufferedRanges.length-1].end:null}));
  const snapshot={ok:true,sourceTabId:tab,mediaSourceState:mediaSource?.readyState||'none',
   sourceFrame:activeFrame,video:{currentTime:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null,
   readyState:video.readyState,paused:video.paused,bufferedRanges:ranges(video.buffered),
   errorCode:video.error?.code??null,errorMessage:video.error?.message??null},
   sourceBuffers:buffers,trackEnds:ends,
   note:'Read-only live SourceBuffer ranges; different buffer endpoints or holes can limit playable intersection. Fragment sequence counts are not seconds or network ranges.'};
  log('RC385B SOURCEBUFFER RANGES',snapshot);
 }catch(e){log('RC385B SOURCEBUFFER RANGES ERROR',String(e));}
 finally{b.disabled=false;}
};

// RC379: Observational source-session fingerprint; does not alter acquisition or replay.

// RC385A: Read-only per-track counters across user-triggered checkpoints.
// Verified-fragment counts can include earlier capture resets; do not equate them to fresh bytes.
let rc385APrior=null;
$('trackdiag').onclick=async()=>{
 const button=$('trackdiag');button.disabled=true;
 try{
  const session=await browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab});
  if(!session?.ok){log('RC385A TRACK DIAGNOSTIC',{ok:false,error:'source-session-unavailable'});return;}
  const tracks=(session.tracks||[]).map(t=>({
   frame:t.frame,sourceBufferId:t.sourceBufferId,mime:t.mime,
   mediaSeq:Number(t.mediaSeq)||0,verifiedFragments:Number(t.verifiedFragments)||0,
   initSeen:!!t.initSeen
  }));
  const prior=rc385APrior;
  const comparisons=tracks.map(t=>{
   const old=prior?.tracks.find(p=>p.frame===t.frame&&p.sourceBufferId===t.sourceBufferId&&p.mime===t.mime);
   return {...t,mediaSeqDelta:old?t.mediaSeq-old.mediaSeq:null,
    verifiedFragmentsDelta:old?t.verifiedFragments-old.verifiedFragments:null,
    changedSincePrior:old?(t.mediaSeq!==old.mediaSeq||t.verifiedFragments!==old.verifiedFragments):null};
  });
  const v=$('video'),d=$('directvideo');
  const mediaState=el=>({currentTime:el.currentTime,paused:el.paused,
   readyState:el.readyState,networkState:el.networkState,
   bufferedRanges:Array.from({length:el.buffered.length},(_,i)=>({start:el.buffered.start(i),end:el.buffered.end(i)})),
   errorCode:el.error?.code??null});
  const result={ok:true,sourceTabId:session.sourceTabId,sourceOrigin:session.sourceOrigin,
   elapsedSincePreviousMs:prior?Date.now()-prior.at:null,
   captureState:session.captureState,captureAgeMs:session.captureAgeMs,
   sourceState:session.sourceState,tracks:comparisons,
   sourceVideos:session.sourceVideos||[],hibMediaSource:mediaState(v),hibNativePlayer:mediaState(d),
   interpretation:'Counter deltas compare only two snapshots. A zero video delta does not prove no network video was fetched; prior video may already be fully prefetched. A high captureAgeMs can coexist with counter changes after resets.',
   note:'Read-only; no source interaction, media fetching, seeking or playback changes. No URLs or credentials retained.'};
  rc385APrior={at:Date.now(),tracks};
  log('RC385A TRACK DIAGNOSTIC',result);
 }catch(e){log('RC385A TRACK DIAGNOSTIC ERROR',String(e));}
 finally{button.disabled=false;}
};

$('sourcesession').onclick=async()=>{
 const b=$('sourcesession');b.disabled=true;
 try{const s=await browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab});log('RC379 SOURCE SESSION',s);}
 catch(e){log('RC379 SOURCE SESSION ERROR',String(e));}
 finally{b.disabled=false;}
};

// RC380: Explicit, bounded recovery experiment. Never resets the HIB MediaSource,
// changes a capture sequence, or merges a newly created upstream media session.
$('recoverytest').onclick=async()=>{
 const b=$('recoverytest');b.disabled=true;
 try{
  const before=await browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab});
  log('RC380 RECOVERY BEFORE',before);
  if(!before?.ok)throw Error('source-session-unavailable');
  if(!mediaSource||mediaSource.readyState!=='open'||!activeBuffers?.size)
   throw Error('no-active-hib-stream: recovery test requires a stalled open MediaSource');
  const v=$('video');
  const end=v.buffered.length?v.buffered.end(v.buffered.length-1):0;
  const ahead=end-v.currentTime;
  if(ahead>3)throw Error('buffer-not-starved: '+ahead.toFixed(2)+' seconds ahead');
  if(before.captureState!=='no-new-fragments')throw Error('capture-not-stale');
  if(before.sourceState!=='media-idle-or-reset')throw Error('source-not-reset: '+before.sourceState);
  const original=before.tracks.filter(x=>x.frame===activeFrame).map(x=>({id:x.sourceBufferId,mime:x.mime,seq:x.mediaSeq}));
  log('RC380 RECOVERY ATTEMPT',{bufferAhead:Math.max(0,ahead),sourceFrame:activeFrame,tracks:original});
  // Existing RC371 semantic-controller activation, invoked ONCE by user action.
  const result=await browser.runtime.sendMessage({type:'hib-rc369-prime',tabId:tab});
  log('RC380 SOURCE REACTIVATION',result);
  if(!result?.ok)throw Error('source-activation-failed');
  await sleep(2500);
  const after=await browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab});
  log('RC380 RECOVERY AFTER',after);
  const fresh=after?.tracks?.filter(x=>x.frame===activeFrame)||[];
  const progressed=original.some(x=>fresh.some(y=>y.sourceBufferId===x.id && y.mime===x.mime && y.mediaSeq>x.seq));
  if(progressed)log('RC380 ORIGINAL SESSION CONTINUED: existing stream loop may resume on its own');
  else log('RC380 NO VERIFIED CONTINUATION: do not append data from a different frame or sequence. Original HIB stream preserved.');
 }catch(e){log('RC380 RECOVERY TEST NOT COMPLETED',String(e));}
 finally{b.disabled=false;}
};


// RC385L: manually triggered source-demand A/B probe. Read-only; no control,
// network request, byte payload, URL or decryption data are collected.
// First click establishes baseline. The next click compares after user performs
// a seek/play in the original source tab. A third click begins a new baseline.
let rc385lBaseline=null,rc385lCompleted=false;
$('acquisitionab').onclick=async()=>{
 const b=$('acquisitionab');b.disabled=true;
 try{
  if(rc385lCompleted){rc385lBaseline=null;rc385lCompleted=false;}
  const [session,events]=await Promise.all([
   browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab}),
   browser.runtime.sendMessage({type:'hib-rc360-get',tabId:tab})]);
  if(!session?.ok)throw Error('Source session unavailable: '+String(session?.error||'source tab closed'));
  const t=Date.now();
  const tracks=(session.tracks||[]).map(x=>({frame:x.frame,id:x.id??x.sourceBufferId??null,mime:x.mime,
   mediaSeq:x.mediaSeq??null,verifiedFragments:x.verifiedFragments??null}));
  const videos=(session.sourceVideos||[]).map((x,i)=>({index:i,paused:x.paused,readyState:x.readyState,
   networkState:x.networkState,currentTime:x.currentTime,duration:x.duration,
   bufferedEnd:x.bufferedEnd,sourceAttached:x.sourceAttached,error:x.error??null}));
  const states=(events?.observerStates||[]).map(x=>({frameId:x.frameId,
   appendNumber:x.appendNumber,backpressureStops:x.backpressureStops,
   transferFailures:x.transferFailures,hardLimitStops:x.hardLimitStops,
   pendingBytes:x.pendingBytes,peakPendingBytes:x.peakPendingBytes,
   tracks:(x.tracks||[]).map(q=>({id:q.id,appendCalls:q.appendCalls,
    captured:q.captured,verified:q.verified,lost:q.lost,stopReason:q.stopReason}))}));
  const v=$('video');const hib={time:v.currentTime,paused:v.paused,
   bufferedEnd:v.buffered.length?v.buffered.end(v.buffered.length-1):null,
   smoothBufferEnabled:$('rc385kSmooth').checked};
  const snap={timestamp:t,sourceCaptureState:session.captureState,
   sourceCaptureAgeMs:session.captureAgeMs,tracks,videos,states,hib};
  if(!rc385lBaseline){rc385lBaseline=snap;log('RC385L ACQUISITION BASELINE',snap);
   log('RC385L A/B INSTRUCTION','In the ORIGINAL SOURCE tab, manually seek/play near the last buffered point (about 28–30s for the current sample); return here and click Acquisition A/B again. This diagnostic does not control the source player.');
  }else{
   const before=rc385lBaseline;
   const deltas=tracks.map(x=>{const p=before.tracks.find(q=>q.frame===x.frame&&q.id===x.id&&q.mime===x.mime);
    return {frame:x.frame,id:x.id,mime:x.mime,
     mediaSeqDelta:typeof x.mediaSeq==='number'&&typeof p?.mediaSeq==='number'?x.mediaSeq-p.mediaSeq:null,
     verifiedDelta:typeof x.verifiedFragments==='number'&&typeof p?.verifiedFragments==='number'?x.verifiedFragments-p.verifiedFragments:null};});
   const videoChanges=videos.map((x,i)=>({index:i,now:x,before:before.videos[i]||null,
    bufferedEndDelta:Number.isFinite(x.bufferedEnd)&&Number.isFinite(before.videos[i]?.bufferedEnd)?x.bufferedEnd-before.videos[i].bufferedEnd:null}));
   const result={elapsedMs:t-before.timestamp,deltas,videoChanges,
    observerBefore:before.states,observerAfter:states,hibBefore:before.hib,hibAfter:hib,
    assessment:deltas.some(x=>/video\//i.test(x.mime||'')&&x.mediaSeqDelta>0)?'video-capture-advanced':
      videoChanges.some(x=>x.bufferedEndDelta>0.2)?'source-video-buffer-advanced-without-capture':'no-new-video-observed',
    note:'A/B is observational. Source seeking may restart the MSE session or change track IDs; in that case, deltas are inconclusive. This does NOT provide independent decryption/acquisition.'};
   log('RC385L ACQUISITION A/B',result);rc385lCompleted=true;
  }
 }catch(e){log('RC385L ACQUISITION ERROR',String(e).slice(0,240));}
 finally{b.disabled=false;}
};

// RC385P: user-triggered source demand, paired with a bounded read-only outcome.
// The site still owns all downloading/decryption. No media URL or key is logged.
$('sourcedemand').onclick=async()=>{
 const b=$('sourcedemand');b.disabled=true;
 const snapshot=async()=>{
  const [session,capture]=await Promise.all([
   browser.runtime.sendMessage({type:'hib-rc379-source-session',tabId:tab}),
   browser.runtime.sendMessage({type:'hib-rc360-get',tabId:tab})]);
  if(!session?.ok)return {ok:false,error:session?.error||'source-session-unavailable'};
  const video=(session.sourceVideos||[]).filter(v=>Number.isFinite(v.duration)&&v.duration>5)
   .sort((x,y)=>(y.videoWidth||0)*(y.videoHeight||0)-(x.videoWidth||0)*(x.videoHeight||0))[0]||null;
  const tracks=(session.tracks||[]).map(t=>({frame:t.frame,id:t.id??t.sourceBufferId??null,mime:t.mime,
   mediaSeq:t.mediaSeq??null,verified:t.verifiedFragments??null}));
  return {ok:true,time:Date.now(),captureState:session.captureState,captureAgeMs:session.captureAgeMs,
   video:video?{paused:video.paused,time:video.currentTime,duration:video.duration,bufferedEnd:video.bufferedEnd,
    readyState:video.readyState,sourceAttached:video.sourceAttached}:null,tracks,
   observer:(capture?.observerStates||[]).map(st=>({frame:st.frameId,transferFailures:st.transferFailures,
    backpressureStops:st.backpressureStops,tracks:(st.tracks||[]).map(t=>({id:t.id,verified:t.verified,
     captured:t.captured,lost:t.lost,stopReason:t.stopReason}))}))};
 };
 try{
  const before=await snapshot();
  log('RC385P SOURCE DEMAND BEFORE',before);
  if(!before.ok){log('RC385P SOURCE DEMAND BLOCKED',{error:before.error});return;}
  log('RC385P SOURCE DEMAND REQUEST',{sourceTabId:tab,method:'user-triggered-muted-source-play'});
  const response=await browser.runtime.sendMessage({type:'hib-rc385n-demand-source',tabId:tab});
  log('RC385P SOURCE DEMAND RESPONSE',response===undefined?{ok:false,error:'no-background-response'}:response);
  if(!response?.ok){log('RC385P SOURCE DEMAND BLOCKED',{error:response?.error||'source-declined',results:response?.results||[]});return;}
  await new Promise(resolve=>setTimeout(resolve,6000));
  const after=await snapshot();
  const previous=new Map(before.tracks.map(t=>[t.frame+':'+t.id+':'+t.mime,t]));
  const delta=after.ok?after.tracks.map(t=>{const old=previous.get(t.frame+':'+t.id+':'+t.mime);
   return {id:t.id,mime:t.mime,verifiedDelta:typeof t.verified==='number'&&typeof old?.verified==='number'?t.verified-old.verified:null,
    appendDelta:typeof t.mediaSeq==='number'&&typeof old?.mediaSeq==='number'?t.mediaSeq-old.mediaSeq:null,
    newTrack:!old};}):[];
  const beforeEnd=before.video?.bufferedEnd,afterEnd=after.video?.bufferedEnd;
  const advanced=Number.isFinite(beforeEnd)&&Number.isFinite(afterEnd)?afterEnd-beforeEnd:null;
  const videoCapture=delta.some(x=>/video\//.test(x.mime||'')&&(x.verifiedDelta>0||x.appendDelta>0));
  const assessment=!after.ok?'source-session-lost':advanced>0.2&&videoCapture?'source-and-capture-advanced':
   advanced>0.2?'source-advanced-capture-not-verified':videoCapture?'capture-advanced-source-end-unchanged':'no-advance-observed';
  log('RC385P SOURCE DEMAND OUTCOME',{assessment,elapsedMs:after.time-before.time,
   sourceBufferedBefore:beforeEnd??null,sourceBufferedAfter:afterEnd??null,sourceBufferedDelta:advanced,
   tracks:delta,observerBefore:before.observer,observerAfter:after.observer,
   note:'A successful trigger is not independent acquisition. Verify complete playback after closing source separately.'});
 }catch(e){log('RC385P SOURCE DEMAND ERROR',{error:String(e).slice(0,240)});}
 finally{b.disabled=false;}
};

// RC398: manual quality picker (only offered when the source page uses a controllable adaptive player).
const rc398={sig:'',busy:false};
async function rc398Refresh(){
 const sel=$('rc398q');if(!sel||rc398.busy||!Number.isInteger(tab)||tab<=0||!mediaSource||mediaSource.readyState!=='open')return;
 let r;try{r=await browser.runtime.sendMessage({type:'hib-rc387-q',op:'list',tabId:tab});}catch(_){return;}
 const pl=r?.players?.[0];
 const sig=JSON.stringify(pl||null);if(sig===rc398.sig)return;rc398.sig=sig;
 sel.textContent='';
 if(!pl){const o=document.createElement('option');o.textContent='Not available for this player';sel.appendChild(o);sel.disabled=true;return;}
 const add=(v,t)=>{const o=document.createElement('option');o.value=String(v);o.textContent=t;sel.appendChild(o);};
 add(-1,'Auto (source decides)');
 pl.levels.slice().sort((a,b)=>b.height-a.height||b.bitrate-a.bitrate).forEach(l=>add(l.id,(l.height?l.height+'p':'?')+' - '+(l.bitrate?(l.bitrate/1e6).toFixed(1)+' Mbps':'')));
 sel.value=String(pl.current);sel.dataset.kind=pl.kind;sel.disabled=false;
}
$('rc398q')?.addEventListener('change',async e=>{
 const sel=e.target;rc398.busy=true;
 try{const r=await browser.runtime.sendMessage({type:'hib-rc387-q',op:'set',tabId:tab,kind:sel.dataset.kind,id:Number(sel.value)});log('RC398 QUALITY SET',sel.options[sel.selectedIndex].text,JSON.stringify(r));}catch(err){log('RC398 QUALITY ERROR',String(err));}
 setTimeout(()=>{rc398.busy=false;rc398.sig='';},1500);
});
setInterval(rc398Refresh,3000);
