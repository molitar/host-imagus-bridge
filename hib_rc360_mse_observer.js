"use strict";
/* RC365 TEST: ordered capture per SourceBuffer, bounded sender backlog, no site-specific logic. */
(async()=>{
 const {hibRC360CaptureEnabled:on}=await browser.storage.local.get('hibRC360CaptureEnabled').catch(()=>({}));
 if(on!==true)return;
 if(!(await browser.runtime.sendMessage({type:'hib-rc462-site-active'}).then(r=>!!(r&&r.active)).catch(()=>false)))return;   // RC462: only on sites in the user's list
 const report=(event,detail)=>{try{browser.runtime.sendMessage({type:'hib-rc360-log',event,detail}).catch(()=>{});}catch(_){}};
 if(!window.wrappedJSObject||typeof exportFunction!=='function'){report('HOOK_UNAVAILABLE',{reason:'no page bridge'});return;}
 try{
  const page=window.wrappedJSObject,MS=page.MediaSource,SB=page.SourceBuffer;
  if(!MS||!SB)throw Error('MediaSource or SourceBuffer unavailable');
  const origAdd=MS.prototype.addSourceBuffer,origAppend=SB.prototype.appendBuffer;
  const buffers=[];let appendNumber=0, pendingBytes=0;
  // RC385H telemetry only. These counters never influence capture decisions.
  let peakPendingBytes=0,backpressureStops=0,transferFailures=0,captureErrors=0,softPressureEvents=0,hardLimitStops=0;
  const lifecycle=(reason)=>report('RC385H_OBSERVER_STATE',{
   reason,appendNumber,pendingBytes,peakPendingBytes,backpressureStops,transferFailures,captureErrors,softPressureEvents,hardLimitStops,
   maxPendingBytes:MAX_PENDING,softPendingBytes:SOFT_PENDING,trackedSourceBuffers:buffers.length,
   tracks:buffers.slice(0,12).map(b=>({id:b.id,appendCalls:b.appendCalls||0,queuedSeq:b.nextSeq,
     captured:b.captured||0,verified:b.verified||0,lost:!!b.lost,stopReason:b.stopReason||null}))});
  // RC385J: 32 MiB is an advisory high-water mark, NOT a destructive stop.
  // A hard cap bounds extension staging RAM; hitting it is an explicit unrecoverable gap.
  // We never skip a fragment and then silently resume with a broken MP4 stream.
  const MAX_SEG=18*1024*1024,CHUNK=1024*1024,SOFT_PENDING=32*1024*1024,MAX_PENDING=256*1024*1024;
  const key=o=>{try{return o.wrappedJSObject||o;}catch(_){return o;}};
  const hookAdd=function(mime){const sb=origAdd.call(this,mime),rec={ref:key(sb),id:buffers.length+1,mime:String(mime).slice(0,160),nextSeq:0,queue:Promise.resolve(),lost:false,appendCalls:0,captured:0,verified:0,stopReason:null};buffers.push(rec);report('SOURCE_BUFFER_CREATED',{id:rec.id,mime:rec.mime});return sb;};
  async function sendSegment(rec,kind,bytes,seq){
   const keyId='s'+Date.now().toString(36)+'-'+rec.id+'-'+seq;
   const parts=Math.ceil(bytes.length/CHUNK);
   try{
    const begin=await browser.runtime.sendMessage({type:'hib-rc362-begin',keyId,kind,seq,sourceBufferId:rec.id,mime:rec.mime,totalBytes:bytes.length,parts});
    if(!begin?.ok)throw Error('begin rejected: '+(begin?.error||'unknown'));
    for(let pos=0,i=0;pos<bytes.length;pos+=CHUNK,i++){
     // RC396: binary structured-clone chunks instead of base64 text (large 4K segments were bound by encoding cost).
     const slice=bytes.slice(pos,Math.min(pos+CHUNK,bytes.length));
     const ack=await browser.runtime.sendMessage({type:'hib-rc362-chunk',keyId,index:i,binary:slice});
     if(!ack?.ok)throw Error('chunk '+i+': '+(ack?.error||'rejected'));
    }
    // RC385M: completed fragments stay pending, in sequence, while the
    // receiver is full. Never replay the chunks or advance to another seq.
    const deadline=Date.now()+900000;
    let end,pressureRetries=0;
    for(;;){
     end=await browser.runtime.sendMessage({type:'hib-rc362-end',keyId});
     if(end?.ok)break;
     if(end?.error!=='tab-limit-retryable')throw Error('end: '+(end?.error||'unknown'));
     if(Date.now()>=deadline)throw Error('end: receiver-pressure-timeout after '+pressureRetries+' retries');
     pressureRetries++;
     if(pressureRetries===1||pressureRetries%25===0)report('RC385M_TRANSFER_WAIT',{sourceBufferId:rec.id,seq,pressureRetries,queuedBytes:end.queuedBytes,limit:end.limit});
     await new Promise(resolve=>setTimeout(resolve,Math.max(100,Math.min(1000,Number(end.retryAfterMs)||160))));
    }
    if(pressureRetries)report('RC385M_TRANSFER_RESUMED',{sourceBufferId:rec.id,seq,pressureRetries});
    rec.verified++;report('SEGMENT_TRANSFER_VERIFIED',{kind,seq,sourceBufferId:rec.id,bytes:bytes.length,parts,hash:end.sha256});
   }catch(e){rec.lost=true;rec.stopReason='transfer-failed';transferFailures++;lifecycle('transfer-failure');report('SEGMENT_TRANSFER_FAILED',{kind,seq,sourceBufferId:rec.id,error:String(e).slice(0,180)});browser.runtime.sendMessage({type:'hib-rc362-abort',keyId}).catch(()=>{});}
   finally{pendingBytes-=bytes.length; if(pendingBytes<0)pendingBytes=0; lifecycle('transfer-settled');}
  }
  // RC387: capture runs only AFTER the browser accepted the append. A full / busy SourceBuffer makes appendBuffer throw
  // (QuotaExceededError / InvalidStateError) and the site retries the same chunk later; capturing the rejected
  // attempts duplicated chunks in the replay stream (seen as identical SHA-256 repeats) and broke the replay.
  const captureAppend=function(data){
   const rec=buffers.find(x=>x.ref===key(this))||buffers.find(x=>x.ref===this)||null;
   if(rec)rec.appendCalls++;const tag=rec||{id:0,mime:'unknown'};let bytes=0,box='unknown';
   try{
    bytes=Number(data?.byteLength||0);
    if(bytes>=8){
     const view=data instanceof page.ArrayBuffer?new page.Uint8Array(data):new page.Uint8Array(data.buffer,data.byteOffset,bytes);
     box=String.fromCharCode(...view.subarray(4,8));
     if(rec&&!rec.lost){
      const seq=rec.nextSeq++;
      const kind=box==='ftyp'?'init':'media';
      if(bytes>MAX_SEG||pendingBytes+bytes>MAX_PENDING){rec.lost=true;rec.stopReason=bytes>MAX_SEG?'segment-too-large':'hard-pending-limit';backpressureStops++;hardLimitStops++;lifecycle('hard-limit-stop');report('CAPTURE_BACKPRESSURE_STOP',{sourceBufferId:rec.id,seq,bytes,pendingBytes,limit:MAX_PENDING,softLimit:SOFT_PENDING,unrecoverableGap:true});}
      else{
       if(pendingBytes<=SOFT_PENDING&&pendingBytes+bytes>SOFT_PENDING){softPressureEvents++;report('RC385J_SOFT_PRESSURE',{sourceBufferId:rec.id,seq,pendingBytes,upcomingBytes:bytes,softLimit:SOFT_PENDING,hardLimit:MAX_PENDING});lifecycle('soft-pressure');}
       const snapshot=new Uint8Array(bytes);snapshot.set(view);pendingBytes+=bytes;rec.captured++;peakPendingBytes=Math.max(peakPendingBytes,pendingBytes);
       rec.queue=rec.queue.then(()=>sendSegment(rec,kind,snapshot,seq));
       report('SEGMENT_CAPTURED',{sourceBufferId:rec.id,mime:rec.mime,kind,seq,bytes});
      }
     }
    }
   }catch(e){captureErrors++;lifecycle('capture-error');report('CAPTURE_ERROR',{sourceBufferId:tag.id,error:String(e).slice(0,180)});}
   // RC386 trace: the first 10 appends after a quiet gap (>2 s) show how a source resumes (header vs raw payload).
   {const nowMs=Date.now();if(nowMs-(window.__rc386Last||nowMs)>2000)window.__rc386Burst=10;window.__rc386Last=nowMs;
    if((window.__rc386Burst||0)>0){window.__rc386Burst--;report('RC386_RESUME_APPEND',{id:tag.id,n:appendNumber,seq:rec?rec.nextSeq-1:null,bytes,box:/^[a-z0-9]{4}$/.test(box)?box:'(payload)',lost:rec?rec.lost:null});}}
   appendNumber++;if(appendNumber%25===0)lifecycle('periodic');if(appendNumber<=25||appendNumber%50===0)report('APPEND_BUFFER',{id:tag.id,mime:tag.mime,bytes,box,appendNumber});
   return;
  };
  let rejectedAppends=0;
  const hookAppend=function(data){
   let result;
   try{result=origAppend.call(this,data);}
   catch(e){
    rejectedAppends++;
    if(rejectedAppends<=5||rejectedAppends%50===0)report('RC387_APPEND_REJECTED',{error:String(e&&e.name||e).slice(0,60),bytes:Number(data?.byteLength||0),rejected:rejectedAppends});
    throw e;
   }
   captureAppend.call(this,data);
   return result;
  };
  // RC386 TRACE (diagnostic): note abort()/remove() and per-append box labels after the first 340 appends.
  const origAbort=SB.prototype.abort,origRemove=SB.prototype.remove;
  const hookAbort=function(){try{const rec=buffers.find(x=>x.ref===key(this))||null;report('RC386_SB_ABORT',{id:rec?.id,appendNumber,nextSeq:rec?.nextSeq});}catch(_){}return origAbort.call(this);};
  const hookRemove=function(a,b){try{const rec=buffers.find(x=>x.ref===key(this))||null;report('RC386_SB_REMOVE',{id:rec?.id,start:a,end:b,appendNumber,nextSeq:rec?.nextSeq});}catch(_){}return origRemove.call(this,a,b);};
  SB.prototype.abort=exportFunction(hookAbort,page,{allowCrossOriginArguments:true});
  SB.prototype.remove=exportFunction(hookRemove,page,{allowCrossOriginArguments:true});
  MS.prototype.addSourceBuffer=exportFunction(hookAdd,page,{allowCrossOriginArguments:true});
  SB.prototype.appendBuffer=exportFunction(hookAppend,page,{allowCrossOriginArguments:true});
  lifecycle('hook-installed');report('HOOK_INSTALLED',{scope:'page',mode:'rc385j-ordered-bounded-staging',maxSegmentMiB:18,softPendingMiB:32,hardPendingMiB:192});
 }catch(e){report('HOOK_FAILED',{message:String(e).slice(0,200)});}
})();
