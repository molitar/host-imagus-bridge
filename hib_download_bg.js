/* 3.1 optional player Download button: the player iframe asks for the title of the page it is embedded in, to name the saved files. */
browser.runtime.onMessage.addListener((m,sender)=>{
 if(!m||m.type!=='hib-dl-title')return;
 return Promise.resolve({title:(sender&&sender.tab&&sender.tab.title)||''});
});

/* 3.1 "Block real video playback inside gallery thumbnails": the content script could not read an animated preview picture itself (cross-origin),
 * so the background page fetches it and hands the bytes back; the content script then makes a still picture of the first frame. */
browser.runtime.onMessage.addListener(m=>{
 if(!m||m.type!=='hib-still-fetch')return;
 return (async()=>{
  try{
   const u=new URL(m.url);if(!/^https?:$/.test(u.protocol))throw Error('bad address');
   const r=await fetch(u.href,{credentials:'include'});if(!r.ok)throw Error('HTTP '+r.status);
   const buf=await r.arrayBuffer();if(buf.byteLength>30*1024*1024)throw Error('too large');
   return {ok:true,buf,mime:r.headers.get('content-type')||''};
  }catch(e){return {ok:false,error:String(e&&e.message||e)};}
 })();
});

/* 3.0.1: the player frame cannot use browser.downloads; it hands over the blob address and the file name, and this page saves it (waits until it has finished). */
browser.runtime.onMessage.addListener(m=>{
 if(!m||m.type!=='hib-dl-save')return;
 return (async()=>{
  try{
   const id=await browser.downloads.download({url:String(m.url),filename:String(m.filename||'video').replace(/[\\/:*?"<>|\x00-\x1f]+/g,' ').trim().slice(0,150)||'video',saveAs:false,conflictAction:'uniquify'});
   await new Promise(res=>{
    const l=d=>{if(d.id===id&&d.state&&d.state.current!=='in_progress'){browser.downloads.onChanged.removeListener(l);res();}};
    browser.downloads.onChanged.addListener(l);
    browser.downloads.search({id}).then(r=>{if(r[0]&&r[0].state!=='in_progress'){browser.downloads.onChanged.removeListener(l);res();}}).catch(()=>{});
   });
   return {ok:true,id};
  }catch(e){return {ok:false,error:String(e&&e.message||e)};}
 })();
});
