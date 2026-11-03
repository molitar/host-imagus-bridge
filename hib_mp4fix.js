"use strict";
/* ===== START VIDEO SECTION - MP4 SEEK-POINT REPAIR (hib_mp4fix.js) - VIDEO FINAL (RC507) =====
/* RC489: SEEK-POINT REPAIR for progressive MP4 files whose index (moov) lists almost no sync samples.
 *
 * Some files (hentaisea: 34 084 HEVC frames, 'stss' holds ONE entry - the first frame) really contain a random-access picture every ~10 s (HEVC CRA / IDR, H.264 IDR),
 * but the container does not say so. A browser seeks by the container's table, so any jump decodes everything from the first frame: tens of seconds, or "never".
 * This module finds those pictures from the sample sizes (a random-access picture is by far the largest in its neighbourhood) and CONFIRMS each candidate by reading its
 * first bytes (NAL unit type), then rewrites the 'stss' box of a COPY of the index (the chunk offsets are shifted by the size change). The page's file is never
 * touched; the corrected index is only used in HIB's own local copy of the file. Generic: any file, no site rules.
 *
 *   hibMp4Fix.analyze(head)                         -> info | null   (head = first bytes of the file, must contain the whole moov, moov before mdat)
 *   await hibMp4Fix.findSyncs(info, readBytes)      -> sorted 1-based sample numbers (always includes 1)      readBytes(offset,len) -> Promise<Uint8Array>
 *   hibMp4Fix.patch(head, info, syncs)              -> { head: Uint8Array (ftyp + corrected moov), origLen }   file bytes from origLen on follow unchanged
 */
(()=>{
 const dvOf=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
 const fourcc=(dv,o)=>String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3));
 // lists the MP4 boxes in a byte range (type, offset, size, header size)
 function boxesIn(dv,off,end){const out=[];while(off+8<=end){let sz=dv.getUint32(off),h=8;const t=fourcc(dv,off+4);if(sz===1){if(off+16>end)break;sz=Number(dv.getBigUint64(off+8));h=16;}else if(sz===0)sz=end-off;if(sz<h)break;if(off+sz>end){if(t==='mdat')out.push({t,o:off,s:sz,h});break;}out.push({t,o:off,s:sz,h});off+=sz;}return out;}
 const kid=(dv,b,name)=>boxesIn(dv,b.o+b.h,b.o+b.s).find(x=>x.t===name);
 // parses ftyp / moov / mdat and the first video track tables; null unless the file is a plain MP4 with its index in front
 function analyze(head){
  try{
   const dv=dvOf(head),top=boxesIn(dv,0,head.length);
   const moov=top.find(b=>b.t==='moov');if(!moov||moov.s>head.length)return null;
   const mdat=top.find(b=>b.t==='mdat');if(!mdat||mdat.o<moov.o)return null;          // index must come BEFORE the media data
   if(top.some(b=>b.t==='moof'))return null;                                           // fragmented files are not this case
   for(const trak of boxesIn(dv,moov.o+moov.h,moov.o+moov.s).filter(b=>b.t==='trak')){
    const mdia=kid(dv,trak,'mdia');if(!mdia)continue;const hdlr=kid(dv,mdia,'hdlr');if(!hdlr||fourcc(dv,hdlr.o+hdlr.h+8)!=='vide')continue;
    const minf=kid(dv,mdia,'minf'),stbl=minf&&kid(dv,minf,'stbl');if(!stbl)continue;
    const T={};for(const b of boxesIn(dv,stbl.o+stbl.h,stbl.o+stbl.s))T[b.t]=b;
    if(!T.stsz||!T.stsc||!(T.stco||T.co64)||!T.stsd||!T.stts)continue;
    const n=dv.getUint32(T.stsz.o+T.stsz.h+8),fixed=dv.getUint32(T.stsz.o+T.stsz.h+4);
    const sizes=new Uint32Array(n);for(let i=0;i<n;i++)sizes[i]=fixed||dv.getUint32(T.stsz.o+T.stsz.h+12+4*i);
    const ne=dv.getUint32(T.stsc.o+T.stsc.h+4),stsc=[];for(let i=0;i<ne;i++)stsc.push([dv.getUint32(T.stsc.o+T.stsc.h+8+12*i),dv.getUint32(T.stsc.o+T.stsc.h+12+12*i)]);
    const co64=!T.stco,cb=T.stco||T.co64,nc=dv.getUint32(cb.o+cb.h+4),chunkOff=[];
    for(let i=0;i<nc;i++)chunkOff.push(co64?Number(dv.getBigUint64(cb.o+cb.h+8+8*i)):dv.getUint32(cb.o+cb.h+8+4*i));
    const offs=new Array(n);let si=0;
    for(let ci=0;ci<nc&&si<n;ci++){let per=stsc[0][1];for(const [first,p] of stsc)if(ci+1>=first)per=p;let pos=chunkOff[ci];for(let k=0;k<per&&si<n;k++){offs[si]=pos;pos+=sizes[si];si++;}}
    if(si<n)continue;
    const mdhd=kid(dv,mdia,'mdhd');let timescale=0,duration=0;if(mdhd){const v=dv.getUint8(mdhd.o+mdhd.h);if(v===1){timescale=dv.getUint32(mdhd.o+mdhd.h+20);duration=Number(dv.getBigUint64(mdhd.o+mdhd.h+24));}else{timescale=dv.getUint32(mdhd.o+mdhd.h+12);duration=dv.getUint32(mdhd.o+mdhd.h+16);}}
    const seconds=timescale>0?duration/timescale:0;
    const stsdType=fourcc(dv,T.stsd.o+T.stsd.h+12);
    const codec=/^(?:hvc1|hev1)$/.test(stsdType)?'hevc':/^(?:avc1|avc3)$/.test(stsdType)?'avc':null;
    let lenSize=4;
    try{const ent=T.stsd.o+T.stsd.h+8,esz=dv.getUint32(ent);for(const b of boxesIn(dv,ent+86,ent+esz)){if(b.t==='hvcC')lenSize=(dv.getUint8(b.o+b.h+21)&3)+1;if(b.t==='avcC')lenSize=(dv.getUint8(b.o+b.h+4)&3)+1;}}catch(_){}
    let stssCount=null;if(T.stss)stssCount=dv.getUint32(T.stss.o+T.stss.h+4);
    const others=[];   // every OTHER track (audio, subtitles ...) also points into the media data: its chunk offsets must move with the index too
    for(const tk of boxesIn(dv,moov.o+moov.h,moov.o+moov.s).filter(b=>b.t==='trak')){
     const md=kid(dv,tk,'mdia'),mi=md&&kid(dv,md,'minf'),sb=mi&&kid(dv,mi,'stbl');if(!sb)continue;
     for(const b of boxesIn(dv,sb.o+sb.h,sb.o+sb.s))if(b.t==='stco'||b.t==='co64')others.push({b,co64:b.t==='co64',nc:dv.getUint32(b.o+b.h+4)});
    }
    return {n,sizes,offs,others,seconds,fps:seconds>0?n/seconds:0,codec,lenSize,stssCount,hasStss:!!T.stss,moov,trak,mdia,minf,stbl,stss:T.stss||null,cb,co64,nc,
            chain:[moov,trak,mdia,minf,stbl],needsFix:!!codec&&!!T.stss&&seconds>0&&stssCount<Math.max(2,seconds/40)};
   }
  }catch(_){}
  return null;
 }
 /* NAL type of the first picture NAL in a sample (HEVC: 16..21 = random-access pictures; H.264: 5 = IDR) */
 function isRandomAccess(buf,info){
  let o=0;const L=info.lenSize;
  for(let guard=0;guard<8&&o+L+2<=buf.length;guard++){
   let len=0;for(let k=0;k<L;k++)len=len*256+buf[o+k];
   const h=buf[o+L];
   if(info.codec==='hevc'){const t=(h>>1)&63;if(t<=31)return t>=16&&t<=21;}
   else{const t=h&31;if(t>=1&&t<=5)return t===5;}
   o+=L+len;                                                  // AUD / SEI / parameter sets in front: skip to the next unit
  }
  return false;
 }
 // finds the random-access pictures: size candidates confirmed by their first bytes (NAL type); returns 1-based sample numbers
 async function findSyncs(info,readBytes,opts){
  const {n,sizes,offs}=info;const win=(opts&&opts.win)||Math.max(24,Math.round((info.fps||24)*5)),gapS=(opts&&opts.gapSeconds)||14;
  const sorted=Array.from(sizes).sort((a,b)=>a-b),median=sorted[n>>1]||1,minSize=Math.max(6*median,4096);
  const cand=[];
  for(let a=0;a<n;a+=win){let best=-1;for(let i=a;i<Math.min(n,a+win);i++)if(best<0||sizes[i]>sizes[best])best=i;if(best>=0&&sizes[best]>=minSize)cand.push(best);}
  const syncs=new Set([0]);let next=0;const probe=Math.min(512,Math.max(...cand.map(i=>sizes[i]),64));
  const worker=async()=>{while(next<cand.length){const i=cand[next++];try{const b=await readBytes(offs[i],Math.min(sizes[i],probe));if(isRandomAccess(b,info))syncs.add(i);}catch(_){}}};
  await Promise.all([worker(),worker(),worker(),worker(),worker(),worker()]);
  // a stretch of more than ~14 s without a confirmed picture: look at the 8 largest samples inside it as well (the picture was not the largest of its 5 s window)
  const tried=new Set(cand),fps=info.fps||24;
  for(let pass=0;pass<2;pass++){
   const have=Array.from(syncs).sort((x,y)=>x-y);have.push(n);const more=[];
   for(let k=0;k<have.length-1;k++){const a0=have[k],b0=have[k+1];if((b0-a0)/fps<=gapS)continue;
    const idx=[];for(let i=a0+1;i<b0;i++)if(!tried.has(i)&&sizes[i]>=minSize)idx.push(i);
    idx.sort((x,y)=>sizes[y]-sizes[x]);for(const i of idx.slice(0,8)){tried.add(i);more.push(i);}}
   if(!more.length)break;
   cand.push(...more);let nx=0;
   const w2=async()=>{while(nx<more.length){const i=more[nx++];try{const b=await readBytes(offs[i],Math.min(sizes[i],probe));if(isRandomAccess(b,info))syncs.add(i);}catch(_){}}};
   await Promise.all([w2(),w2(),w2(),w2(),w2(),w2()]);
  }
  if(opts&&opts.trace)opts.trace({candidates:cand.length,found:syncs.size});
  return Array.from(syncs).sort((a,b)=>a-b).map(i=>i+1);
 }
 // returns a copy of the index with a new sync table; every track chunk offset moves with the size change
 function patch(head,info,syncs){
  const copy=head.slice(0,info.moov.o+info.moov.s);const dv=dvOf(copy);
  const entries=syncs.length,newStss=new Uint8Array(16+4*entries),nd=dvOf(newStss);
  nd.setUint32(0,newStss.length);newStss.set([0x73,0x74,0x73,0x73],4);nd.setUint32(8,0);nd.setUint32(12,entries);syncs.forEach((v,i)=>nd.setUint32(16+4*i,v));
  const delta=newStss.length-info.stss.s;
  // chunk offsets point into the file after the index: they move by the index's growth
  for(const t of info.others){const cb=t.b;for(let i=0;i<t.nc;i++){if(t.co64)dv.setBigUint64(cb.o+cb.h+8+8*i,BigInt(Number(dv.getBigUint64(cb.o+cb.h+8+8*i))+delta));else dv.setUint32(cb.o+cb.h+8+4*i,dv.getUint32(cb.o+cb.h+8+4*i)+delta);}}
  for(const b of info.chain){if(b.h!==8)return null;dv.setUint32(b.o,dv.getUint32(b.o)+delta);}   // 64-bit sized boxes: not handled
  const out=new Uint8Array(copy.length+delta);
  out.set(copy.subarray(0,info.stss.o),0);out.set(newStss,info.stss.o);out.set(copy.subarray(info.stss.o+info.stss.s),info.stss.o+newStss.length);
  return {head:out,origLen:copy.length,delta};
 }
 window.hibMp4Fix=Object.freeze({analyze,findSyncs,patch});
})();
/* ===== END VIDEO SECTION - MP4 SEEK-POINT REPAIR (hib_mp4fix.js) ===== */
