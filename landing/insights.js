/* RME Insights: allowlisted, content-free browser observations. */
(()=>{
  'use strict';
  const script=document.currentScript;
  if(!script || window.__rmeInsightsLoaded) return;
  const registry=[{"id":"parable","events":["page_view","engaged","scroll_50","scroll_90","ui_error","auth_start","auth_success","auth_error","onboarding_start","onboarding_complete","onboarding_error","notes_unlock_start","notes_unlock_success","notes_unlock_error","note_create_start","note_save_success","note_save_error","note_delete","chat_start","chat_result","chat_error","pairing_start","pairing_complete","pairing_error","recovery_start","recovery_complete","recovery_error","checkout_start","checkout_result","checkout_cancel","provenance_redirect","docs_open","dashboard_action"],"components":[{"id":"social","name":"Encrypted notes app","hosts":["parable.social","www.parable.social"],"routes":{"^/$":"home","^/welcome":"onboarding","^/notes":"notes","^/chat":"chat","^/activity":"activity","^/chain":"history","^/pair":"pairing","^/join":"pairing","^/restore":"recovery","^/settings":"settings","^/dashboard":"dashboard","^/docs":"docs","^/i":"marketing","^/share":"sharing","^/upgrade":"billing","^/org":"organisation","^/legacy":"migration","^/recovery-check":"recovery","^/.*":"other"}}]},{"id":"maatara","events":["page_view","engaged","scroll_50","scroll_90","ui_error","auth_start","auth_success","auth_error","onboarding_start","onboarding_complete","onboarding_error","note_create_start","note_save_success","note_save_error","provenance_start","provenance_result","verify_start","verify_result","organisation_start","organisation_complete","organisation_error","device_start","device_complete","device_error","docs_open","product_open","dashboard_action"],"components":[{"id":"provenance","name":"Provenance product","hosts":["maatara.io","app.maatara.io","www.maatara.io"],"routes":{"^/$":"home","^/pricing":"pricing","^/protect":"protect","^/detect":"detect","^/verify":"verify","^/consent":"consent","^/contact-owner":"contact","^/pair":"pairing","^/docs":"docs","^/.*":"other"}},{"id":"portal","name":"Identity portal","hosts":["id.maatara.io"],"routes":{"^/$":"home","^/authorize":"authorise","^/mint":"identity","^/devices":"devices","^/pair":"pairing","^/restore":"recovery","^/org":"organisation","^/oauth":"oauth","^/.*":"other"}},{"id":"console","name":"Administration console","hosts":["console.maatara.io"],"routes":{"^/$":"home","^/apps":"apps","^/orgs":"organisation","^/admin":"admin","^/health":"health","^/.*":"other"}},{"id":"docs","name":"Documentation","hosts":["docs.ma-atara.io","docs.maatara.io"],"routes":{"^/$":"home","^/.*":"docs"}},{"id":"city","name":"Parable City","hosts":["city.ma-atara.io","parable.city","www.parable.city"],"routes":{"^/$":"home","^/dashboard":"dashboard","^/.*":"other"}}]},{"id":"ride","events":["page_view","engaged","scroll_50","scroll_90","ui_error","auth_gate_shown","oauth_start","oauth_result","view_change","trip_create","trip_open","trip_update","trip_delete","waypoint_add","waypoint_edit","waypoint_delete","waypoint_reorder","place_search","place_selected","route_calculate","route_result","alternative_route_select","journal_save","attachment_add","ride_start","ride_exit","share_create","share_copy","share_page_view","share_map_expand","share_waypoint_select","share_gallery_open","share_route_select","share_download","share_import_trip","share_cta"],"components":[{"id":"planner","name":"Trip planner","hosts":["ride.incitat.io"],"routes":{"^/$":"home","^/about.html$":"about","^/trip.html$":"shared_trip","^/[A-Za-z0-9]{6}$":"shared_trip","^/admin.html$":"admin","^/(privacy|terms|deletion).html$":"legal","^/.*":"other"}}]},{"id":"nwatch","events":["page_view","engaged","scroll_50","scroll_90","ui_error","portal_cta_click","contact_click","find_group_start","find_group_submit","find_group_mailto","find_group_copy","docs_open","portal_signin_start","portal_signin_success","portal_signin_error","onboarding_start","group_create_start","group_create_success","group_create_error","invite_start","invite_success","invite_error"],"components":[{"id":"marketing","name":"Product site","hosts":["nwatch.app","www.nwatch.app","nwatch.com.au","www.nwatch.com.au","nwatch.org","www.nwatch.org"],"routes":{"^/$":"home","^/(?:au|nz|us|ca)/?$":"home","^/join/[^/]+$":"join","^/(?:support|app-support)$":"support","^/privacy$":"privacy","^/terms$":"terms","^/security$":"security","^/account-deletion$":"account-deletion","^/.*":"other"}},{"id":"portal","name":"Customer portal","hosts":["portal.nwatch.app","portal.nwatch.com.au","portal.nwatch.org"],"routes":{"^/$":"home","^/signin$":"signin","^/start(?:/waiting)?$":"onboarding","^/groups(?:/[^/]+)?$":"group","^/groups(?:/[^/]+)?/invite$":"invite","^/groups(?:/[^/]+)?/incidents$":"incidents","^/groups(?:/[^/]+)?/settings$":"settings","^/.*":"other"}},{"id":"docs","name":"Documentation","hosts":["docs.nwatch.app","docs.nwatch.com.au","docs.nwatch.org"],"routes":{"^/$":"docs","^/.*":"docs"}},{"id":"admin","name":"Administration","hosts":["admin.nwatch.app","admin.nwatch.com.au","admin.nwatch.org"],"routes":{"^/$":"admin","^/.*":"admin"}}]},{"id":"cmail","events":["page_view","engaged","scroll_50","scroll_90","ui_error","github_click","assurance_open","tour_open","deploy_start","deployment_guide_click","docs_open"],"components":[{"id":"marketing","name":"Product page","hosts":["cmail.maatara.io"],"routes":{"^/$":"home","^/assurance/?$":"assurance","^/.*":"other"}}]}];
  const app=registry.find(a=>a.id===script.dataset.app);
  const component=app?.components.find(c=>c.id===script.dataset.component);
  if(!component || !component.hosts.includes(location.hostname)) return;
  const endpoint=script.dataset.endpoint;
  if(endpoint!=='https://events.rmesolutions.com.au/collect') return;
  const optedOut=()=>navigator.globalPrivacyControl===true || navigator.doNotTrack==='1' || window.doNotTrack==='1';
  if(optedOut() || !crypto.randomUUID) return;
  window.__rmeInsightsLoaded=true;
  const key='rme-insights-v1:'+app.id+':'+component.id;
  let state, queue=[], sending=false, visibleMs=0, lastTick=Date.now(), engaged=false, scrolls=new Set(), previousRoute;
  const routes=Object.entries(component.routes).map(([pattern,label])=>[new RegExp(pattern),label]);
  const group=()=>routes.find(([re])=>re.test(location.pathname))?.[1]||'other';
  const device=innerWidth<768?'mobile':innerWidth<1100?'tablet':'desktop';
  const classifySource=()=>{
    if(!document.referrer) return 'direct';
    try { const host=new URL(document.referrer).hostname;
      if(registry.some(a=>a.components.some(c=>c.hosts.includes(host)))) return 'internal';
      if(/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(host)) return 'search';
      if(/(^|\.)(facebook\.com|instagram\.com|linkedin\.com|t\.co|x\.com|reddit\.com|bsky\.app)$/.test(host)) return 'social';
    } catch {} return 'referral';
  };
  const source=classifySource();
  try { state=JSON.parse(sessionStorage.getItem(key)||'null'); } catch {}
  const fresh=()=>({id:crypto.randomUUID(),seq:0,last:Date.now(),device,source});
  const ensure=()=>{if(!state || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(state.id||'') || !Number.isInteger(state.seq) || state.seq<0 || state.seq>150 || !Number.isFinite(state.last) || state.last>Date.now() || Date.now()-state.last>1800000 || !['desktop','mobile','tablet'].includes(state.device) || !['direct','search','social','referral','internal'].includes(state.source)) { state=fresh(); engaged=false;visibleMs=0;scrolls.clear(); } };
  ensure();
  const save=()=>{try {sessionStorage.setItem(key,JSON.stringify(state));} catch {}};
  function track(event,value){
    if(optedOut() || !app.events.includes(event)) return;
    ensure(); if(state.seq>=150 || queue.length>=40) return;
    state.seq++;state.last=Date.now();save();
    queue.push({session:state.id,event:{id:crypto.randomUUID(),seq:state.seq,event,route:group(),device:state.device,source:state.source,...(typeof value==='number' && Number.isFinite(value)?{value:Math.min(600000,Math.max(0,value))}:{})}});
    if(queue.length>=10) void flush();
  }
  async function flush(){
    if(sending || !queue.length) return;
    if(optedOut()){queue=[];return;}
    sending=true;
    const session=queue[0].session;
    const batch=queue.filter(x=>x.session===session).slice(0,20);
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app:app.id,component:component.id,session,events:batch.map(x=>x.event)}),credentials:'omit',referrerPolicy:'no-referrer',keepalive:true});
      // Retry transient failures with the same IDs; drop invalid or rate-limited payloads.
      if(response.ok || (response.status>=400 && response.status<500)){const sent=new Set(batch);queue=queue.filter(x=>!sent.has(x));}
    }catch{}finally{sending=false;}
  }
  function navigation(){const route=location.pathname;if(route===previousRoute)return;previousRoute=route;visibleMs=0;engaged=false;scrolls.clear();track('page_view');}
  window.addEventListener('rme:insight',e=>{if(e.detail && typeof e.detail.event==='string')track(e.detail.event);});
  document.addEventListener('click',e=>{const target=e.target instanceof Element?e.target.closest('[data-insight]'):null;if(target)track(target.getAttribute('data-insight'));},{passive:true});
  window.addEventListener('error',()=>track('ui_error'));
  window.addEventListener('unhandledrejection',()=>track('ui_error'));
  window.addEventListener('scroll',()=>{
    if(document.visibilityState!=='visible')return;
    const height=document.documentElement.scrollHeight-innerHeight;
    if(height<200)return;
    const percent=100*scrollY/height;
    for(const threshold of [50,90])if(percent>=threshold&&!scrolls.has(threshold)){scrolls.add(threshold);track('scroll_'+threshold);}
  },{passive:true});
  window.addEventListener('popstate',navigation);
  for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){const result=original.apply(this,args);queueMicrotask(navigation);return result;};}
  document.addEventListener('visibilitychange',()=>{lastTick=Date.now();if(document.visibilityState==='hidden')void flush();});
  window.addEventListener('pagehide',()=>void flush());
  setInterval(()=>{
    const now=Date.now();if(document.visibilityState==='visible')visibleMs+=Math.min(1500,now-lastTick);lastTick=now;
    if(visibleMs>=30000&&!engaged){engaged=true;track('engaged');}
  },1000);
  setInterval(()=>void flush(),5000);
  navigation();
})();
