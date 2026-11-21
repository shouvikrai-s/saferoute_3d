#!/usr/bin/env python3
"""SafeRoute 3D - incremental patch: route preview + OSM POI categories + honest safety wording + rainfall retry.
Baseline expected: your CURRENT HelloWorld.html (already containing the UI-2..8 shell, bottom nav, Explore panel,
profile/AI sheets, offline banner and the 192.168.1.6 routing URL).
Usage:  python apply_saferoute_patch.py HelloWorld.html HelloWorld.merged-test.html
- Never modifies the input. Refuses to write to HelloWorld.html / HelloWorld.original.html.
- Every edit asserts its anchor appears EXACTLY once; on any mismatch it stops and writes nothing.
- Never edits backendUrl, ROUTING_CONFIG, the client key or the Ion token (verified before writing)."""
import sys, os, re
if len(sys.argv) != 3: sys.exit("usage: apply_saferoute_patch.py <input.html> <output-test-copy.html>")
IN, OUT = sys.argv[1], sys.argv[2]
if os.path.abspath(IN) == os.path.abspath(OUT) or os.path.basename(OUT).lower() in ("helloworld.html", "helloworld.original.html"):
    sys.exit("Refusing: output must be a NEW file name, e.g. HelloWorld.merged-test.html")
raw = open(IN, "rb").read()
bom = raw.startswith(b"\xef\xbb\xbf")
s = raw.decode("utf-8-sig")
crlf = "\r\n" in s
s = s.replace("\r\n", "\n")
# ---- baseline guards ----
need = ['id="srNav"', 'window.__srBridge = { resources: resourceData, route: setDestination };', 'id="exploreOpenPermits"',
        'function trackNavigationProgress(lat, lon){', 'function setDestination(lat, lon){', 'backendUrl: "http://192.168.1.6:8080/api/route"']
for n in need:
    if s.count(n) != 1: sys.exit("Baseline check failed (expected exactly once): " + n[:70])
for bad in ['startNavButton', '__srPoi', 'srRetryWeather']:
    if bad in s: sys.exit("This patch (or part of it) is already applied: found " + bad)
def keep(s): return [re.search(r'backendUrl:[^\n]*', s).group(0), re.search(r'Cesium\.Ion\.defaultAccessToken =\n[^\n]*', s).group(0), re.search(r'SAFEROUTE_CLIENT_KEY = [^\n]*', s).group(0)]
before = keep(s)
def rep(a, b):
    global s
    c = s.count(a)
    if c != 1: sys.exit("ANCHOR ERROR (found %d, need exactly 1): %r" % (c, a[:90]))
    s = s.replace(a, b)
# 1. Honest safety wording
rep('<span id="safetyChipText">Safety: Checking…</span>','<span id="safetyChipText">Checking safety data…</span>')
rep('safetyChipText.textContent = "Safety: ELEVATED";','safetyChipText.textContent = "Rainfall: ELEVATED";')
rep('safetyChipText.textContent = "Safety: LOW";','safetyChipText.textContent = "Rainfall: LOW";')

# 2. Inner hooks: preview gate, destination hook, weather retry, POI fetch (reuses Overpass endpoint, bbox logic, haversine)
rep('function trackNavigationProgress(lat, lon){','function trackNavigationProgress(lat, lon){\n if (window.__srPreview) { return; } // route preview: no voice/reroute/arrival until the user starts navigation')
rep('function setDestination(lat, lon){','function setDestination(lat, lon){\n if (window.__srOnDestination) { window.__srOnDestination(); }')
rep('window.__srBridge = { resources: resourceData, route: setDestination };','''window.__srBridge = { resources: resourceData, route: setDestination,
 retryWeather: function(){ isFetchingWeather = false; lastWeatherFetchTime = 0; fetchWeatherRisk(); } };
// POI categories: extends the existing Overpass setup (same endpoint, same viewport-bbox method,
// bounded cache, throttle). Only real OSM fields are returned.
const POI_DEFS = {
 hotel:["Hotels",['["tourism"~"hotel|guest_house|hostel|motel"]']],
 food:["Food",['["amenity"~"restaurant|fast_food|food_court"]']],
 cafe:["Cafes",['["amenity"="cafe"]']],
 fuel:["Fuel",['["amenity"="fuel"]']],
 parking:["Parking",['["amenity"="parking"]']],
 tourist:["Tourist places",['["tourism"~"attraction|museum|gallery|zoo|theme_park"]']],
 viewpoint:["Viewpoints",['["tourism"="viewpoint"]']],
 attraction:["Attractions",['["historic"]','["amenity"="place_of_worship"]']],
 pharmacy:["Pharmacies",['["amenity"="pharmacy"]']],
 atm:["ATMs",['["amenity"="atm"]']],
 ev:["EV charging",['["amenity"="charging_station"]']]
};
const poiCache = new Map(); let lastPoiFetch = 0;
window.__srPoi = { defs: POI_DEFS, fetch: function(key, cb){
 const def = POI_DEFS[key];
 if (!def) { return; }
 if (!navigator.onLine) { cb({status:"offline"}); return; }
 if (viewer.camera.positionCartographic.height > OSM_MAX_CAMERA_HEIGHT_M) { cb({status:"zoom"}); return; }
 let rect = null; try { rect = viewer.camera.computeViewRectangle(); } catch (e) { rect = null; }
 if (!rect) { cb({status:"zoom"}); return; }
 const bbox = [rect.south, rect.west, rect.north, rect.east].map(function(r){ return Cesium.Math.toDegrees(r).toFixed(2); }).join(",");
 const ck = key + "|" + bbox;
 if (poiCache.has(ck)) { cb({status: poiCache.get(ck).length ? "ok" : "empty", items: poiCache.get(ck), label: def[0]}); return; }
 if (Date.now() - lastPoiFetch < 2000) { cb({status:"busy"}); return; }
 lastPoiFetch = Date.now();
 cb({status:"loading"});
 let q = "[out:json][timeout:20];(";
 def[1].forEach(function(sel){ q += "node" + sel + "(" + bbox + ");way" + sel + "(" + bbox + ");"; });
 q += ");out center 60;";
 const ctl = new AbortController(); const tm = setTimeout(function(){ ctl.abort(); }, 15000);
 fetch("https://overpass-api.de/api/interpreter", { method:"POST", body:"data=" + encodeURIComponent(q), signal: ctl.signal })
 .then(function(r){ if (!r.ok) { throw new Error("Overpass HTTP " + r.status); } return r.json(); })
 .then(function(data){
  clearTimeout(tm);
  let items = (data.elements || []).map(function(el){
   const t = el.tags || {}; const lat = el.lat || (el.center && el.center.lat); const lon = el.lon || (el.center && el.center.lon);
   if (!lat || !lon) { return null; }
   const d = (lastUserLat !== null && lastUserLon !== null) ? haversineDistanceKm(lastUserLat, lastUserLon, lat, lon) : null;
   return { name: t.name || t.brand || t.operator || null, lat: lat, lon: lon, osm: el.type + "/" + el.id, km: d };
  }).filter(function(x){ return x; });
  items.sort(function(a,b){ return (a.km === null ? 1e9 : a.km) - (b.km === null ? 1e9 : b.km); });
  if (poiCache.size >= 40) { poiCache.delete(poiCache.keys().next().value); }
  poiCache.set(ck, items);
  cb({status: items.length ? "ok" : "empty", items: items, label: def[0]});
 }).catch(function(err){ clearTimeout(tm); console.error("POI fetch failed"); cb({status: err && err.name === "AbortError" ? "timeout" : "error"}); });
} };''')

# 3. CSS
rep('</style>\n</head>','''@keyframes srUp{ from{ opacity:0; transform:translateY(12px);} to{ opacity:1; transform:none;} }
.sr-sheet{ animation:srUp .18s ease-out; }
button:active{ transform:scale(.97); }
.cesium-geocoder-input:focus{ outline:3px solid var(--sr-primary) !important; }
.sr-cat{ min-height:48px !important; }
.sr-skel{ height:56px; border-radius:12px; background:var(--sr-surface-2); margin:6px 0; }
.sr-state{ padding:12px; border-radius:var(--sr-r-sm); background:var(--sr-surface-2); font-size:14px; }
.sr-state.err{ background:var(--sr-danger-soft); color:var(--sr-danger-strong); }
#startNavButton{ flex:1; width:auto; margin:0 8px 0 0; }
</style>
</head>''')

# 4. Explore category UI (all real-OSM-backed)
a=s.index('<div class="sr-sheet-section-title">Not available yet</div>'); b=s.index('<button class="sr-act" id="exploreOpenPermits">')
chips=''.join(f'<button class="sr-cat" data-poi="{k}" aria-pressed="false">{l}</button>' for k,l in [('hotel','Hotels'),('food','Food'),('cafe','Cafes'),('fuel','Fuel'),('parking','Parking'),('tourist','Tourist places'),('viewpoint','Viewpoints'),('attraction','Attractions'),('pharmacy','Pharmacies'),('atm','ATMs'),('ev','EV charging')])
s=s[:a]+'<div class="sr-sheet-section-title">Places from OpenStreetMap (current map view)</div>\n <div class="sr-chipgrid" role="group" aria-label="OpenStreetMap categories">'+chips+'</div>\n <div class="sr-note">&copy; OpenStreetMap contributors. Coverage varies: a missing place does not mean none exists. Only fields present in OpenStreetMap are shown; no ratings, prices or hours. This app does not determine administrative region: Sikkim is a state, while Darjeeling and Kalimpong are in West Bengal.</div>\n '+s[b:]

# 5. Safety sheet retry + preview button
rep('<button class="sr-act" id="safetyOpenEmergency">','<button class="sr-act" id="srRetryWeather">Refresh rainfall data</button>\n <button class="sr-act" id="safetyOpenEmergency">')
rep('<div class="navBottomRow">\n <button id="clearRouteButton">','<div class="navBottomRow">\n <button id="startNavButton" class="sr-act primary" style="display:none">Start navigation</button>\n <button id="clearRouteButton">')

# 6. UI script
rep(' $("exploreOpenPermits")',''' // Route preview -> Start navigation (presentation + gate flag read by trackNavigationProgress)
 function setPreview(on){ window.__srPreview=on; $("startNavButton").style.display=on?"inline-flex":"none";
  lbl.className="navDestLabel"; lbl.textContent=on?"Route preview (navigation not started)":"Navigating"; }
 window.__srOnDestination=function(){ setPreview(true); };
 $("startNavButton").addEventListener("click",function(){ setPreview(false); });
 $("clearRouteButton").addEventListener("click",function(){ window.__srPreview=false; $("startNavButton").style.display="none"; lbl.className="navDestLabel"; lbl.textContent="Route to destination"; });
 $("srRetryWeather").addEventListener("click",function(){ $("safetyChipText").textContent="Checking safety data…"; if(window.__srBridge) window.__srBridge.retryWeather(); });
 // OSM POI categories
 var poiBtns=document.querySelectorAll(".sr-cat[data-poi]");
 function msg(list,cls,text,retry){ list.textContent=""; var d=document.createElement("div"); d.className="sr-state "+cls; d.textContent=text;
  if(retry){ var b=document.createElement("button"); b.className="sr-act"; b.textContent="Retry"; b.addEventListener("click",retry); d.appendChild(b); } list.appendChild(d); }
 function loadPoi(key,btn){
  var list=$("srExploreList"), br=window.__srBridge;
  poiBtns.forEach(function(x){x.setAttribute("aria-pressed",x===btn?"true":"false");});
  document.querySelectorAll(".sr-cat[data-cat]").forEach(function(x){x.setAttribute("aria-pressed","false");});
  if(!window.__srPoi){ msg(list,"err","Places are not ready yet. Try again shortly.",function(){loadPoi(key,btn);}); return; }
  window.__srPoi.fetch(key,function(r){
   if(r.status==="loading"){ list.textContent=""; var l=document.createElement("div"); l.setAttribute("role","status"); l.textContent="Loading places…"; l.className="sr-note"; list.appendChild(l); list.appendChild(Object.assign(document.createElement("div"),{className:"sr-skel"})); list.appendChild(Object.assign(document.createElement("div"),{className:"sr-skel"})); return; }
   var again=function(){loadPoi(key,btn);};
   if(r.status==="offline") return msg(list,"err","You're offline. Places need an internet connection.",again);
   if(r.status==="zoom") return msg(list,"","Zoom the map in a little, then tap again. Places load for the current view only.",again);
   if(r.status==="busy") return msg(list,"","Please wait a moment, then tap again.",again);
   if(r.status==="timeout"||r.status==="error") return msg(list,"err","Places could not be loaded. The OpenStreetMap service may be busy.",again);
   if(r.status==="empty") return msg(list,"","No "+r.label.toLowerCase()+" found in this map view in OpenStreetMap.");
   list.textContent="";
   r.items.slice(0,25).forEach(function(it){ var d=document.createElement("div"); d.className="sr-place";
    var t=document.createElement("div"); t.textContent=it.name||("Unnamed "+r.label.toLowerCase()); var sm=document.createElement("small");
    sm.textContent="OpenStreetMap "+it.osm+(it.km!==null?" \\u00b7 about "+it.km.toFixed(1)+" km straight-line":""); t.appendChild(sm); d.appendChild(t);
    var b=document.createElement("button"); b.textContent="Route"; b.setAttribute("aria-label","Route to "+(it.name||"this place"));
    b.addEventListener("click",function(){ hideAll(); sync(); br.route(it.lat,it.lon); }); d.appendChild(b); list.appendChild(d); });
  });
 }
 poiBtns.forEach(function(b){ b.addEventListener("click",function(){ loadPoi(b.dataset.poi,b); }); });
 $("exploreOpenPermits")''')

if keep(s) != before: sys.exit("Safety stop: routing URL / key / token lines would change. Nothing written.")
if crlf: s = s.replace("\n", "\r\n")
open(OUT, "wb").write((b"\xef\xbb\xbf" if bom else b"") + s.encode("utf-8"))
print("Wrote", OUT, "- input untouched; routing URL, client key and Ion token lines verified unchanged.")