"use strict";
/* RC462: why status marks appeared / disappeared (RC386_TAG_* events from the hover player), added to every captured report */
async function hibMarkTrace(){try{const r=await browser.runtime.sendMessage({type:'hib-rc360-get',tabId:0});return (r&&r.trace386||[]).filter(x=>/TAG_|OPEN_/.test(x.e)).slice(-220);}catch(_){return [];}}
/* ===== START SECTION 2 — CARD INVENTORY MONITOR / TELEMETRY ===== */

/* RC153 / ACTIVATION_MONITOR — persistent readable diagnostics.
 * Every refresh shows the current state, independent of old content.js.
 * Copy diagnostics retains full telemetry; Clear resets historical log.
 */
(async()=>{
 const $=id=>document.getElementById(id);let tabId=Number(new URLSearchParams(location.search).get('tabId'))||0;let records=[],latest=null,lastSignature=null,lastSerial=-1,milestones=[],activeHost='',milestoneState=new Map(),lastSectionSignature='';
 let refreshing=false,refreshQueued=false,lastResetSeen='';const rendered=new Map();
 const activeKey="hibRc224ActiveDiagnosticTab";
 async function syncTarget(){const value=(await browser.storage.local.get(activeKey))[activeKey];if(!Number.isInteger(value)||value<=0||value===tabId)return;tabId=value;lastSignature=null;lastSerial=-1;lastSectionSignature="";milestoneState.clear();records=[];milestones=[];render("events","");render("milestones","");render("quality","[]");render("selected","No card selected yet");}

 const render=(id,value)=>{const str=String(value??'');if(rendered.get(id)===str)return;rendered.set(id,str);$(id).textContent=str;};
 const milestone=(v,key=v)=>{if(milestoneState.get(key)===v)return;milestoneState.set(key,v);milestones.push({at:new Date().toISOString(),text:v});if(milestones.length>80)milestones.shift();render('milestones',milestones.map(x=>x.text).join('\n'));};
 const yes=x=>x===true?'YES':x===false?'NO':'N/A';
 function add(label,data){records.push({at:new Date().toISOString(),label,data});if(records.length>1000)records.shift();render('events',records.slice(-30).map(x=>`[${x.at.slice(11,19)}] ${x.label}: ${typeof x.data==='string'?x.data:JSON.stringify(x.data)}`).join('\n'));}
 async function refresh(){if(refreshing){refreshQueued=true;return;} refreshing=true;try{
 await syncTarget();
 if(!Number.isInteger(tabId)||tabId<=0){
   const candidates=(await browser.tabs.query({})).filter(t=>t.active&&/^https?:\/\//i.test(t.url||''));
   const candidate=candidates.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
   if(!candidate)throw new Error('No active website tab found; reopen diagnostics using the HIB toolbar.');
   tabId=candidate.id;
 }
 const tab=await browser.tabs.get(tabId);const host=new URL(tab.url).hostname.replace(/^www\./,'').toLowerCase();activeHost=host;render('url','Site found: '+tab.url);
 const gate=await browser.runtime.sendMessage({type:'hib-rc153-read-activation',host});let probe=null,probeError=null;
 try{probe=await browser.tabs.sendMessage(tabId,{type:'hib-rc153-activation-ping'});}catch(e){probeError=String(e);}
 let cards=null,cardError=null;
 try{cards=await browser.tabs.sendMessage(tabId,{type:'hib-rc155-card-snapshot'});}catch(e){cardError=String(e);}
 latest={tabId,url:tab.url,gate,probe,probeError,cards,cardError,imageQualityTraces:cards?.imageQualityTraces||[]};render('layout','Apply post-fix: '+(cards?.postFix?'ON':'OFF'));if(cards?.lastSiteReset?.at&&cards.lastSiteReset.at!==lastResetSeen){lastResetSeen=cards.lastSiteReset.at;milestone('Site settings reset: '+cards.lastSiteReset.status+' — '+(cards.lastSiteReset.error||'verified clean'),'site-reset');}
 if(cards&&cards.serial!==lastSerial){lastSerial=cards.serial;
  for(const evt of cards.events.filter(e=>!records.some(r=>r.at===e.at&&r.label===e.event)))
   {add(evt.event,evt.data);if(evt.event==='ELEMENT_INSPECTED')milestone('Inspected '+(evt.data?.type||'card')+' — '+(evt.data?.reason||'details captured'));else if(evt.event==='CARD_SELECTED')milestone('Card selected: '+evt.data.type);}
 }
 milestone('Site enabled for video: '+yes(gate.effectiveVideoEnabled),'site-enabled');if(cards?.enabled)milestone('Stage: Card detection','stage');
 const types=cards?.counts||{};
 render('counts',Object.entries(types).map(([type,count])=>`${String(count).padStart(3)}  ${type}`).join('\n') + `\n──────\n${cards?.total??'N/A'}  TOTAL CARDS`);
 if(cards?.enabled)milestone('Stage: Cards counted and tallied — '+(cards.total??0)+' total','card-count');
 render('quality',JSON.stringify((cards?.imageQualityTraces||[]).slice(-24),null,2));
 render('selected',cards?.lastSelected?`${cards.lastSelected.type}\n${cards.lastSelected.reason||''}\n${cards.lastSelected.url}`:'No card selected yet');
 render('status',`HIB registered: ${yes(gate.registered)}\nVideo enabled in registered HIB: ${yes(gate.permanentVideo)}\nScan for video (TEST): ${yes(gate.override)}\nEFFECTIVE VIDEO ENABLED: ${yes(gate.effectiveVideoEnabled)}\nContent probe loaded: ${yes(probe?.alive===true)}\nActivation source: ${gate.activationSource}\nCard scan: ${cards?.enabled?'ENABLED':cards?'DISABLED':'N/A'}\nLanding detection: N/A\nVideo detection: N/A`);
 // Optional diagnostic section breakdown. Does not influence card counts.
 try {const info=await browser.tabs.sendMessage(tabId,{type:'hib-rc160-capture-info'});
  const sec=info.sections||[];const changes=info.changes||[];
  render('sections',sec.map(x=>x.count+'  '+x.name).join('\n')+'\nDOM changes since page load: '+changes.length+(changes.length?'\nLatest: +'+changes.at(-1).added+' / -'+changes.at(-1).removed:''));
  const ss=JSON.stringify(sec);if(ss!==lastSectionSignature){lastSectionSignature=ss;milestone('Section inventory updated: '+sec.length+' sections','section-count');}
 }catch(e){render('sections','Section diagnostics unavailable: '+String(e));}
 const signature=JSON.stringify({url:tab.url,registered:gate.registered,test:gate.override,effective:gate.effectiveVideoEnabled,probe:!!probe,probeError});if(signature!==lastSignature){lastSignature=signature;add('ACTIVATION_STATE_CHANGED',{registered:gate.registered,test:gate.override,effective:gate.effectiveVideoEnabled,probe:!!probe,probeError});}
 }catch(e){add('CHECK_ERROR',String(e));render('status','Activation check failed: '+String(e));}
 finally{refreshing=false;if(refreshQueued){refreshQueued=false;queueMicrotask(refresh);}}}
 
 $('layout').onclick=async()=>{if(!activeHost)return;const key='hibRc158CardLayouts',stored=(await browser.storage.local.get(key))[key]||{};if(latest?.cards?.postFix)stored[activeHost]='automatic';else stored[activeHost]='post-fix';await browser.storage.local.set({[key]:stored});milestone('Card layout: '+(stored[activeHost]||'automatic'));await refresh();};
 let inspecting=false; $('inspect').onclick=async()=>{inspecting=!inspecting;try{await browser.tabs.sendMessage(tabId,{type:'hib-rc156-inspect-mode',enabled:inspecting});$('inspect').textContent='Inspect missed card: '+(inspecting?'ON':'OFF');}catch(e){add('INSPECT_ERROR',String(e));}};
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const loadImage=data=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Captured tile could not be decoded'));img.src=data;});
 const escapeHTML=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 $('capture').onclick=async()=>{
  const button=$('capture');button.disabled=true;button.textContent='Capturing page…';let original=null,captured=0,partialReason='',tiles=[],diagnostics=null,reportImage=null,stitchedCSSHeight=0;
  try {
   diagnostics=await browser.tabs.sendMessage(tabId,{type:'hib-rc160-capture-info'});
   original={x:diagnostics.document.scrollX,y:diagnostics.document.scrollY};
   const d=diagnostics.document;
   // Limit image memory and capture time. Report partial results explicitly.
   const maxCanvasHeight=Math.min(16000,Math.floor(48000000/Math.max(1,d.width)));
   const captureHeight=Math.min(d.height,maxCanvasHeight);stitchedCSSHeight=captureHeight;
   if(captureHeight<d.height)partialReason='Page exceeds safe stitched-image size; limited to '+captureHeight+' CSS pixels of '+d.height;
   if(d.width>8000)throw Error('Page width too large for safe capture: '+d.width);
   const viewport=Math.max(1,d.viewportHeight),step=Math.max(1,Math.floor(viewport*.86));
   let coords=[];for(let y=0;y<captureHeight;y+=step){coords.push(y);if(coords.length>=35)break;}
   if(coords.length&&coords[coords.length-1]+viewport<captureHeight){partialReason=partialReason||'Stopped at 35 tiles to limit capture duration';}
   const targetCanvas=document.createElement('canvas');
   for(let i=0;i<coords.length;i++){
    const pos=await browser.tabs.sendMessage(tabId,{type:'hib-rc160-scroll-tile',y:coords[i]});
    await sleep(350);
    const response=await browser.runtime.sendMessage({type:'hib-rc160-capture-tile',tabId});
    if(response?.error)throw Error(response.error);
    const img=await loadImage(response.image);
    if(!i){const scale=img.width/d.viewportWidth;targetCanvas.width=img.width;targetCanvas.height=Math.floor(captureHeight*scale);
     if(targetCanvas.height>16000||targetCanvas.width*targetCanvas.height>48000000)throw Error('Canvas exceeds safe image dimensions');}
    const scale=targetCanvas.width/d.viewportWidth;
    const actualY=pos.y;const sourceHeight=img.height;
    const dy=Math.max(0,Math.round(actualY*scale));
    const previousEnd=tiles.length?tiles.at(-1).end:0;
    const top=Math.max(0,previousEnd-dy);const destY=dy+top;
    const drawHeight=Math.min(sourceHeight-top,targetCanvas.height-destY);
    if(drawHeight>0){targetCanvas.getContext('2d').drawImage(img,0,top,img.width,drawHeight,0,destY,img.width,drawHeight);tiles.push({y:actualY,end:destY+drawHeight});captured++;}
    button.textContent='Capturing '+(i+1)+'/'+coords.length;
    if(tiles.at(-1)?.end>=targetCanvas.height-1)break;
   }
   const covered=tiles.at(-1)?.end||0;
   if(covered<targetCanvas.height-2)partialReason=partialReason||'Captured '+Math.round(covered/(targetCanvas.width/d.viewportWidth))+' of '+captureHeight+' CSS pixels';
   reportImage=await new Promise((resolve,reject)=>targetCanvas.toBlob(b=>b?resolve(b):reject(Error('PNG encoding failed')),'image/png'));
   diagnostics=await browser.tabs.sendMessage(tabId,{type:'hib-rc160-capture-info'});
   milestone('Full-page diagnostic capture: '+(partialReason?'PARTIAL':'COMPLETE')+' — '+captured+' tiles','capture');
  }catch(e){partialReason=partialReason||String(e);add('CAPTURE_ERROR',partialReason);}
  finally{if(original){try{await browser.tabs.sendMessage(tabId,{type:'hib-rc160-restore-scroll',...original});}catch(e){add('SCROLL_RESTORE_ERROR',String(e));}}
   button.disabled=false;button.textContent='Capture report (HTML)';}
  const payload={version:'RC160',captured:new Date().toISOString(),latest,events:records,markTrace:await hibMarkTrace(),diagnostics,stitchedCSSHeight,tiles:captured,partial:!!partialReason,reason:partialReason};
  const safe=JSON.stringify(payload,null,2).replaceAll('<','\\u003c');
  const overlayJSON=JSON.stringify(diagnostics?.cards||[]).replaceAll('<','\\u003c');
  const reportStem='HIB_RC200_Full_Page_'+new Date().toISOString().replace(/[:.]/g,'-');
  const imageName=reportImage?reportStem+'.png':'';
  const html='<!doctype html><html><head><meta charset="utf-8"><title>HIB RC160 Full-Page Diagnostic Report</title><style>body{font:14px system-ui;background:#151920;color:#fff;padding:20px}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#252b36;padding:15px}.capture{position:relative;display:inline-block;max-width:100%}.capture img{display:block}.card{position:absolute;border:2px dashed #46dbfe;box-sizing:border-box;pointer-events:none;color:#fff;font:11px sans-serif}.card b{background:#00677e;padding:2px}label{margin-right:14px}</style></head><body><h1>HIB RC160 Full-Page Diagnostic Capture</h1><p>Site: '+escapeHTML(latest?.url)+'</p><p>Status: '+(partialReason?'PARTIAL: '+escapeHTML(partialReason):'Complete')+'; tiles: '+captured+'</p><label><input type="checkbox" id="showOverlay"> Numbered card boundaries</label><div id="capture" class="capture"><img id="stitched" alt="Stitched page screenshot" src="'+imageName+'"><div id="overlay" style="display:none;position:absolute;inset:0;pointer-events:none"></div></div><h2>Section breakdown</h2><pre>'+escapeHTML(JSON.stringify(diagnostics?.sections||[],null,2))+'</pre><h2>Full diagnostics</h2><pre id="report"></pre><script type="application/json" id="diagnostic-data">'+safe+'</script><script type="application/json" id="overlay-data">'+overlayJSON+'</script><script>const data=JSON.parse(document.getElementById("diagnostic-data").textContent);document.getElementById("report").textContent=JSON.stringify(data,null,2);const cards=JSON.parse(document.getElementById("overlay-data").textContent);const overlay=document.getElementById("overlay");const d=data.diagnostics?.document;for(const c of cards){if(!d)continue;const el=document.createElement("div");el.className="card";el.style.left=(100*c.rect.x/d.width)+"%";el.style.top=(100*c.rect.y/(data.stitchedCSSHeight||d.height)) +"%";el.style.width=(100*c.rect.width/d.width)+"%";el.style.height=(100*c.rect.height/(data.stitchedCSSHeight||d.height))+"%";el.innerHTML="<b>"+c.index+"</b>";overlay.append(el)}document.getElementById("showOverlay").onchange=e=>overlay.style.display=e.target.checked?"block":"none";<\/script></body></html>';
  // Download a separate PNG and lightweight HTML with identical stems.
  // The HTML uses a relative filename; no multi-megabyte Base64 HTML attribute.
  const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
  if(reportImage)download(reportImage,imageName);
  download(new Blob([html],{type:'text/html'}),reportStem+'.html');
  add('REPORT_CAPTURED',{tiles:captured,partial:!!partialReason,reason:partialReason,imageSeparate:!!reportImage,html:reportStem+'.html',png:imageName});
 };
 $('refresh').onclick=refresh;$('clear').onclick=async()=>{records=[];milestones=[];milestoneState.clear();lastSerial=-1;$('events').textContent='';$('milestones').textContent='';try{await browser.tabs.sendMessage(tabId,{type:'hib-rc155-clear-card-events'});}catch(_){};await refresh();};
 $('copy').onclick=async()=>{const report=JSON.stringify({version:'RC160',captured:new Date().toISOString(),latest,events:records,markTrace:await hibMarkTrace()},null,2);try{await navigator.clipboard.writeText(report)}catch(_){const t=document.createElement('textarea');t.value=report;document.body.append(t);t.select();document.execCommand('copy');t.remove()}};
 browser.tabs.onUpdated.addListener((id,change)=>{if(id===tabId&&change.status==='complete')refresh()});browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.enabledSites||changes.siteMediaModes||changes.hibRc139ScanVideoHosts||changes.hibRc158CardLayouts||changes[activeKey]))refresh();});setInterval(refresh,2500);await refresh();
})();
/* ===== END SECTION 2 — CARD INVENTORY MONITOR / TELEMETRY ===== */
