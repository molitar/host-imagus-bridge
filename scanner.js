"use strict";
let last="";
const status=document.getElementById("status"),report=document.getElementById("report");
const isHttp=u=>{try {const x=new URL(u);return /^https?:$/.test(x.protocol)&&!!x.hostname;}catch{return false;}};
const isMedia=u=>{try{const x=new URL(u);return /\.(mp4|webm|m4v|m3u8|mpd)(?:$|\?)/i.test(x.pathname)||(/\/index\.php$/i.test(x.pathname)&&x.searchParams.has('data'));}catch{return false;}};
const masked=u=>{try {const x=new URL(u);if(x.search) x.search='?'+[...x.searchParams.keys()].join('&')+'=[redacted]';return x.href;}catch{return '';}};
async function runFile(tabId,file){try{const raw=await browser.tabs.executeScript(tabId,{file,allFrames:true,runAt:'document_idle'});return {results:(raw||[]).filter(Boolean),error:null};}catch(e){return {results:[],error:String(e)};}}
function collectPlayer(frame){const out=[];for(const p of frame.players||[]){if(isHttp(p.src))out.push({url:p.src,source:'diag_player:src',readyState:p.readyState??0});}for(const group of frame.flowplayerSources||[])for(const s of group.sources||[])if(isHttp(s.src))out.push({url:s.src,source:'diag_player:flowplayer',readyState:0});return out;}
function collectSources(frame){const out=[];for(const v of frame.videos||[]){for(const u of [v.currentSrc,v.src])if(isHttp(u))out.push({url:u,source:'diag_sources:video',readyState:null});for(const s of v.sources||[])if(isHttp(s.src))out.push({url:s.src,source:'diag_sources:source',readyState:null});}for(const u of frame.resources||[])if(isHttp(u))out.push({url:u,source:'diag_sources:resource',readyState:null});return out;}
async function scan(){
 try{
  status.textContent='Scanning existing diagnostics...';
  const args=new URLSearchParams(location.search),tabId=Number(args.get('tabId')),expected=args.get('url');
  if(!Number.isSafeInteger(tabId)||tabId<0||!isHttp(expected))throw Error('No captured video tab; reopen scanner from HIB popup.');
  const tab=await browser.tabs.get(tabId);if(!tab||tab.url!==expected)throw Error('Captured tab navigated or closed.');
  const [baseline,player,sources,frames]=await Promise.all(['scanner_probe.js','diag_player.js','diag_sources.js','diag_frames.js'].map(f=>runFile(tabId,f)));
  const raw=[...player.results.flatMap(collectPlayer),...sources.results.flatMap(collectSources)];
  const unique=new Map();for(const c of raw){if(!unique.has(c.url))unique.set(c.url,{url:c.url,detectors:[c.source],readyState:c.readyState});else {const old=unique.get(c.url);if(!old.detectors.includes(c.source))old.detectors.push(c.source);if(c.readyState!=null)old.readyState=c.readyState;}}
  const candidates=[...unique.values()].map(c=>({url:c.url,display:masked(c.url),detectors:c.detectors,readyState:c.readyState,mediaShape:isMedia(c.url),status:'candidate — playback not verified'}));
  const summary={site:new URL(expected).hostname,page:expected,framesExamined:Math.max(baseline.results.length,player.results.length,sources.results.length),recognizedPlayers:[...new Map(baseline.results.flatMap(p=>p.playerFamilies||[]).map(p=>[p.type,p])).values()],candidateCount:candidates.length,candidates,diagnostics:{playerFrames:player.results.length,sourceFrames:sources.results.length,iframeFrames:frames.results.length,errors:{baseline:baseline.error,player:player.error,sources:sources.error,frames:frames.error}},registration:'not performed: candidate extraction does not confirm HIB playback',note:'RC65 joins existing diagnostics into one global scanner. Run this on an initialized episode page or inspect its rendered destination; do not treat an uninitialized search page as a negative site result.'};
  last=JSON.stringify(summary,null,2);report.textContent=last;status.textContent=`Found ${candidates.length} candidate(s); no site settings changed.`;
 }catch(e){status.textContent='Scan failed: '+String(e);}
}
document.getElementById('scan').onclick=scan;
document.getElementById('copy').onclick=async()=>{if(last){await navigator.clipboard.writeText(last);status.textContent='Report copied.';}};

/* RC78 verified-player test: uses the same popup discovery as hovering. */
document.getElementById('hibRc78LiveScan')?.addEventListener('click',async()=>{
 const b=document.getElementById('hibRc78LiveScan');b.disabled=true;
 try{
  const args=new URLSearchParams(location.search),url=args.get('url');
  if(!isHttp(url))throw Error('A website episode tab is required');
  status.textContent='Opening temporary video player; checking up to 60 seconds of media progression...';
  const result=await browser.runtime.sendMessage({type:'hib-rc78-scan-episode',url});
  last=JSON.stringify(result,null,2);report.textContent=last;
  status.textContent=result.ok&&result.profile?'Verified and recorded '+result.profile.type+' video profile.':
   'No verified media profile; site not auto-registered.';
  if(result.ok&&result.profile){
   await browser.runtime.sendMessage({type:'hib-v2-site-add',site:result.profile.site});
   await browser.runtime.sendMessage({type:'hib-v2-site-mode-set',site:result.profile.site,mode:'video'});
  }
 }catch(e){status.textContent='Live scan failed: '+String(e);}
 finally{b.disabled=false;}
});
