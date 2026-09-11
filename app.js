const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const uid = () => crypto.randomUUID();
const CACHE = 'fieldwork-workbook-v2';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let book = {version:2,rounds:[{id:'round-1',name:'Round 1',items:[]}]}, revision=0;
let active=localStorage.getItem('fieldwork-active') || 'round-1', dirty=false, saving=false, conflict=null, ready=false, serial=0;
let csrfToken='', authRedirecting=false;
let boundaries={}, gameArea, remaining, editItem=null, formType='', picking=null, undoStack=[], renderTimer;
const shapeLayers=new Map(), errors=new Map(), previews=L.featureGroup();
const map=L.map('map',{minZoom:5,maxZoom:19,preferCanvas:true}).setView([47.7,14.9],7);
map.createPane('exclusions'); map.getPane('exclusions').style.zIndex=350; map.getPane('exclusions').style.pointerEvents='none';
map.createPane('rail'); map.getPane('rail').style.zIndex=380;
const mask=L.geoJSON(null,{pane:'exclusions',interactive:false,style:{stroke:false,fillColor:'#b43e32',fillOpacity:.3}}).addTo(map);
const outlines=L.featureGroup().addTo(map), drawings=L.featureGroup().addTo(map);
previews.addTo(map);
const osmAttribution='<a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const street=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; '+osmAttribution});
const railBase=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,className:'rail-background',attribution:'&copy; '+osmAttribution});
const satellite=L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'});
const rails=L.geoJSON(null,{pane:'rail',interactive:false,pmIgnore:true,style:f=>({color:f.properties.kind==='narrow_gauge'?'#96743f':'#34576b',weight:2.2,opacity:.9,pmIgnore:true})});
const stationLayer=L.geoJSON(null,{pane:'rail',pmIgnore:true,pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4,weight:1.5,color:'#203747',fillColor:'#fffaf0',fillOpacity:1,pmIgnore:true}),onEachFeature:(f,l)=>l.bindTooltip(esc(f.properties.name || 'Rail station'))});
let railDataLoaded=false, stationPoints=[];
L.control.scale({imperial:false}).addTo(map);
map.attributionControl.addAttribution('Boundaries: <a href="https://github.com/ginseng666/GeoJSON-TopoJSON-Austria">Flooh Perlot / Statistik Austria</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>');

function round(){return book.rounds.find(r=>r.id===active) || book.rounds[0];}
function status(text){$('saveStatus').textContent=text;}
function cache(){try{localStorage.setItem(CACHE,JSON.stringify({book,revision,dirty}));}catch{status('Local storage full; export backup');}}
async function api(path,body){
  const response=await fetch(path.startsWith('/auth/')?path:'/api/'+path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json','X-Fieldwork-CSRF':csrfToken},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(response.status===401){cache();authRedirecting=true;location.replace('/login');throw new Error('Sign in required; draft retained');}
  const data=await response.json();
  if(!response.ok){const e=new Error(data.error || 'Server request failed');e.code=response.status;e.data=data;throw e;}return data;
}
function warning(message,isConflict=false){$('syncWarning').hidden=false;$('syncMessage').textContent=message;$('recoverConflict').hidden=!isConflict;$('loadServer').hidden=!isConflict;$('retrySave').hidden=isConflict;}
function change(mutator){
  if(!ready)return;
  undoStack.push(clone(book));if(undoStack.length>30)undoStack.shift();
  mutator();dirty=true;serial++;cache();render();status('Saving...');clearTimeout(renderTimer);renderTimer=setTimeout(save,300);
}
async function save(){
  if(!dirty||saving||conflict||!ready)return;
  saving=true;const sent=serial;
  try{const result=await api('workbook',{revision,book:clone(book)});revision=result.revision;if(sent===serial)dirty=false;cache();$('syncWarning').hidden=true;status(dirty?'Saving...':'Saved to server');}
  catch(e){if(e.code===409){conflict=e.data;warning('Another device changed this workbook. Your draft is retained.',true);status('Save conflict');}else{warning('Connection lost. Draft saved on this phone; retry when online.');status('Offline draft');}cache();}
  finally{saving=false;if(dirty&&!conflict&&sent!==serial)setTimeout(save,300);}
}
async function poll(){
  if(!ready||saving||dirty||conflict||document.querySelector('dialog[open]')||picking||map.pm.globalDrawModeEnabled()||[...shapeLayers.values()].some(l=>l.pm?.enabled())||document.activeElement===$('roundName'))return;
  try{const data=await api('workbook');if(data.revision!==revision){book=data.book;revision=data.revision;undoStack=[];cache();render();}status('Saved to server');}catch{status('Server unreachable');}
}
$('retrySave').onclick=()=>save();
$('recoverConflict').onclick=()=>{
  if(!conflict)return;
  const drafts=book.rounds.filter(r=>JSON.stringify(r)!==JSON.stringify(conflict.book.rounds.find(s=>s.id===r.id))).map(r=>({...clone(r),id:uid(),name:(r.name+' (recovered draft)').slice(0,120)}));
  book=conflict.book;revision=conflict.revision;book.rounds.push(...drafts);if(drafts.length)active=drafts[0].id;conflict=null;dirty=true;serial++;cache();render();save();
};
$('loadServer').onclick=()=>{if(!conflict||!confirm('Replace this phone\'s unsaved draft with the server version? Export first to keep a copy.'))return;book=conflict.book;revision=conflict.revision;conflict=null;dirty=false;undoStack=[];cache();$('syncWarning').hidden=true;render();status('Saved to server');};
window.addEventListener('online',()=>save());
window.addEventListener('beforeunload',e=>{if(dirty&&!authRedirecting){cache();e.preventDefault();e.returnValue='';}});

function setBase(){
  [street,railBase,satellite,rails].forEach(l=>map.removeLayer(l));
  const value=$('basemap').value;({street,rail:railBase,satellite}[value]).addTo(map);
  if(value==='rail')rails.addTo(map);updateStations();localStorage.setItem('fieldwork-basemap',value);
}
function updateStations(){map.removeLayer(stationLayer);if($('stations').checked&&map.getZoom()>=9)stationLayer.addTo(map);}
$('basemap').onchange=setBase;$('stations').onchange=updateStations;map.on('zoomend',updateStations);
$('basemap').value=localStorage.getItem('fieldwork-basemap') || 'rail';setBase();
$('shade').onchange=()=>{mask.setStyle({fillOpacity:$('shade').checked?.3:0});};
$('fitGame').onclick=()=>gameArea&&map.fitBounds(L.geoJSON(gameArea).getBounds(),{padding:[35,35]});
$('fitRemaining').onclick=()=>remaining&&map.fitBounds(L.geoJSON(remaining).getBounds(),{padding:[35,35],maxZoom:16});
$('panelToggle').onclick=()=>showMobile('clues');
$('helpButton').onclick=()=>$('help').showModal();$('closeHelp').onclick=()=>$('help').close();
function gps(callback){
  if(!navigator.geolocation)return alert('Location is unavailable in this browser.');
  navigator.geolocation.getCurrentPosition(p=>{const point={lat:p.coords.latitude,lng:p.coords.longitude};if(confirm('Use this GPS fix? Accuracy approximately '+Math.round(p.coords.accuracy)+' metres.'))callback(point);},e=>alert(e.message),{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
}
$('locate').onclick=()=>gps(p=>{previews.clearLayers();pin(p,'GPS',previews);map.setView(p,14);});

function pin(p,label,group){return L.marker(p,{pmIgnore:true,icon:L.divIcon({className:'point-pin',html:esc(label),iconSize:[26,26]})}).addTo(group);}
let featurePack=null;
const featureHelp=document.createElement('p');featureHelp.textContent='Measuring supports boundary presets and drawn lines. Enter your distance, check the feature definition and preview the band. Buffers are approximate, not for resolving exact ties. High-speed rail uses game corridors including slower station approaches: West corridor through Linz to Attnang-Puchheim, Koralmbahn and Pottendorfer Linie. Check the full scope in the measuring form. Existing clues retain their geometry snapshots.';
$('help').insertBefore(featureHelp,$('closeHelp'));
let measurementWorker=null,editorGeneration=0;
function calculateBand(geometry,distance){
  return new Promise((resolve,reject)=>{
    if(measurementWorker)return reject(new Error('A calculation is already running'));
    const worker=new Worker('/measurement-worker.js');measurementWorker=worker;
    $('formError').textContent='Calculating distance band... large border datasets may take a moment.';
    $('fields').inert=true;$('questionForm').querySelector('[type=submit]').disabled=true;$('previewQuestion').disabled=true;
    const finish=(error,band)=>{clearTimeout(timer);worker.terminate();measurementWorker=null;$('fields').inert=false;$('questionForm').querySelector('[type=submit]').disabled=false;$('previewQuestion').disabled=false;error?reject(new Error(error)):resolve(band);};
    const timer=setTimeout(()=>finish('Calculation timed out. Try a smaller drawn line.'),120000);
    worker.onmessage=e=>finish(e.data.error,e.data.band);
    worker.onerror=e=>{console.error('Measurement worker:',e.message);finish('Distance calculation failed: '+(e.message||'reload and retry'));};
    worker.postMessage({geometry,distance});
  });
}
function measurementEditor(item){
  select('measureSource','Measure distance to',[['points','Places / map pins'],['international','International border'],['states','Bundesland border'],['districts','Political Bezirk border'],['highspeedCorridors','High-speed rail (corridors)'],...(item?.measureSource==='highspeed'?[['highspeed','High-speed rail (saved legacy preset)']]:[]),['drawn','A line drawn on this map']],item?.measureSource||'points');
  html('<div id="featureInputs"><label>Our distance in kilometres<input id="featureDistance" type="number" min="0.001" max="1500" step="any" placeholder="e.g. 5.2" value="'+esc(item?.distance||'')+'"></label><label id="drawnLineLabel">Drawn line<select id="drawnLine"></select></label><p id="featureInfo" class="hint"></p><label><input type="checkbox" id="featureVerified"> I checked the feature coverage and definition; apply this answer</label><p class="hint">Unchecked answers stay provisional. Distances are straight-line, not travel distances. Preview shows the eligible features and the distance band.</p></div>');
  const lines=round().items.filter(i=>i.type==='drawing'&&i.shape==='Line');
  for(const line of lines){const option=document.createElement('option');option.value=line.id;option.textContent=line.label||'Line '+line.id.slice(0,6);$('drawnLine').append(option);}
  if(item?.measureGeo&&item.measureSource==='drawn'){const o=document.createElement('option');o.value='saved';o.textContent='Saved line snapshot (unchanged)';$('drawnLine').prepend(o);$('drawnLine').value='saved';}
  const update=()=>{
    const key=$('measureSource').value,points=key==='points';
    $('pointInputs').hidden=!points;$('featureInputs').hidden=points;
    $('pointA').closest('.location-box').hidden=!points;
    $('drawnLineLabel').hidden=key!=='drawn';
    const preset=featurePack?.presets[key];
    $('featureInfo').textContent=key==='drawn'?'Use Add clue > Draw & measure > Line first. The selected line is copied into this answer; later drawing edits do not move this clue.':item?.measureSource===key&&item?.sourceNote?'Saved snapshot: '+item.sourceNote:preset?preset.source+'. '+preset.warning:'Preset unavailable. Reload to retry, or use places / a drawn line.';
    $('featureVerified').checked=!!(item?.measureSource===key&&!item.provisional);
  };
  $('measureSource').onchange=update;update();
}
function summary(item){
  if(item.type==='radar')return item.radius+' km radar / '+item.answer;
  if(item.type==='thermometer')return 'Thermometer / '+item.answer+' / '+Geo.distance(item.a,item.b).toFixed(2)+' km A to B';
  if(item.type==='admin')return item.regionName+' / '+item.answer;
  if(item.type==='matching')return 'Nearest '+(item.category||'place')+' / '+item.answer;
  if(item.type==='measuring')return (item.category||'Places')+' / '+item.answer+' / '+(item.distance||Math.min(...item.points.map(p=>Geo.distance(item.a,p)))).toFixed(2)+' km';
  if(item.type==='drawing')return item.shape+(item.shape==='Circle'?' / '+Number(item.radius).toFixed(2)+' km radius':'')+' / '+item.effect;
  return 'Observation';
}
function addOutline(item,group){
  const color=item.type==='drawing'?(item.color||'#bb8833'):'#2d6575';
  const style={color,weight:2,fillOpacity:.035,pmIgnore:true};
  if(item.type==='radar'){L.circle(item.a,{...style,radius:item.radius*1000}).addTo(group);pin(item.a,'R',group);}
  if(item.type==='thermometer'){L.polyline([item.a,item.b],{...style,dashArray:'6 5'}).addTo(group);pin(item.a,'A',group);pin(item.b,'B',group);}
  if(item.type==='admin'){const f=item.regionGeometry||boundaries[item.level]?.features.find(f=>String(f.properties.iso)===item.region);if(f)L.geoJSON(f,{style,interactive:false}).addTo(group);}
  if(item.points)item.points.forEach((p,i)=>pin(p,String(i+1),group));
  if(item.type==='measuring'&&item.measureGeo){
    L.geoJSON(item.measureGeo,{style:{...style,color:'#926220'},interactive:false}).addTo(group);
    L.geoJSON(item.bandGeometry||Geo.featureBand(item.measureGeo,item.distance),{style:{...style,dashArray:'5 4'},interactive:false}).addTo(group);
  }else if(item.type==='measuring'){
    if(item.a)pin(item.a,'S',group);const r=item.distance||Math.min(...item.points.map(p=>Geo.distance(item.a,p)));
    item.points.forEach(p=>L.circle(p,{...style,radius:r*1000}).addTo(group));
  }
  if(item.type==='drawing'){
    let layer;
    if(item.shape==='Circle')layer=L.circle(item.center,{...style,pmIgnore:false,radius:item.radius*1000});
    else layer=L.geoJSON(item.geo,{style:{...style,pmIgnore:false},pmIgnore:false}).getLayers()[0];
    layer.options.pmIgnore=false;L.PM.reInitLayer(layer);layer.addTo(group);
    if(item.shape==='Line')layer.bindTooltip(turf.length(item.geo).toFixed(2)+' km');
    if(group===drawings){shapeLayers.set(item.id,layer);layer.on('pm:update',()=>{change(()=>{const current=round().items.find(i=>i.id===item.id);if(current.shape==='Circle'){current.center=layer.getLatLng();current.radius=layer.getRadius()/1000;}else current.geo=layer.toGeoJSON();});});}
  }
}
function render(){
  if(!book.rounds.some(r=>r.id===active))active=book.rounds[0].id;
  localStorage.setItem('fieldwork-active',active);$('tabs').replaceChildren();
  $('mapSelect').replaceChildren();
  book.rounds.forEach(r=>{const b=document.createElement('button');b.textContent=r.name;b.classList.toggle('active',r.id===active);b.setAttribute('aria-current',r.id===active?'page':'false');b.onclick=()=>switchMap(r.id);$('tabs').append(b);const option=document.createElement('option');option.value=r.id;option.textContent=r.name;$('mapSelect').append(option);});
  $('mapSelect').value=active;$('clueCount').textContent=round().items.length;$('mapSwitchButton').textContent=round().name+' / Maps';
  $('roundName').value=round().name;$('undo').disabled=!undoStack.length;
  outlines.clearLayers();drawings.clearLayers();shapeLayers.clear();errors.clear();mask.clearLayers();remaining=gameArea;
  let provisional=0;
  round().items.forEach(item=>{
    if(item.enabled===false)return;
    try{
      addOutline(item,item.type==='drawing'?drawings:outlines);
      if(item.provisional){provisional++;return;}
      if(gameArea&&item.type!=='note'&&!(item.type==='drawing'&&item.effect==='note'))remaining=Geo.intersect(remaining,Geo.constraint(item,boundaries));
    }catch(e){errors.set(item.id,e.message);}
  });
  if(gameArea){
    try{const excluded=Geo.subtract(gameArea,remaining);if(excluded)mask.addData(excluded);const pct=remaining?turf.area(remaining)/turf.area(gameArea)*100:0;
      $('areaStatus').textContent=errors.size?'Some clues failed: check history':!remaining?'No area remains: check answers':pct.toFixed(1)+'% remains'+(provisional?' / '+provisional+' provisional':'');
    }catch(e){$('areaStatus').textContent='Geometry error: '+e.message;}
  }
  $('history').replaceChildren();$('emptyState').hidden=round().items.length>0;
  [...round().items].reverse().forEach(item=>{
    const card=document.createElement('article');card.className='item'+(item.enabled===false?' disabled':'')+(item.provisional?' provisional':'');
    card.innerHTML='<div class="row"><h3>'+esc(summary(item))+'</h3><label><input type="checkbox" '+(item.enabled!==false?'checked':'')+' aria-label="Enable clue"></label></div><p>'+esc(item.label||'')+'</p>'+(item.provisional?'<p class="tag">PROVISIONAL: outline only, not used to exclude</p>':'')+(errors.has(item.id)?'<p class="error">'+esc(errors.get(item.id))+'</p>':'')+'<div class="buttons"></div>';
    card.querySelector('input').onchange=e=>change(()=>{item.enabled=e.target.checked;});
    const action=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=fn;card.querySelector('.buttons').append(b);};
    action('Edit',()=>openEditor(item.type,item));action('Zoom',()=>zoomItem(item));
    if(item.type==='drawing')action('Edit shape',()=>{const layer=shapeLayers.get(item.id);if(!layer)return;showMobile('map');layer.pm.enable({allowSelfIntersection:false});showBanner('Move vertices, then finish editing.',()=>{layer.pm.disable();hideBanner();});});
    action('Delete',()=>{if(confirm('Delete this clue?'))change(()=>{round().items=round().items.filter(i=>i.id!==item.id);});});
    $('history').append(card);
  });
}
function zoomItem(item){showMobile('map');const g=L.featureGroup();addOutline(item,g);const bounds=g.getBounds();if(bounds.isValid())map.fitBounds(bounds,{padding:[60,60],maxZoom:15});}
$('roundName').onchange=()=>change(()=>{round().name=$('roundName').value.trim()||'Untitled round';});
$('roundMenu').textContent='Manage';$('roundMenu').onclick=()=>openMaps();
$('undo').onclick=()=>{if(!undoStack.length)return;book=undoStack.pop();dirty=true;serial++;cache();render();save();};

function coordinate(raw){
  let s=raw.trim();let match=s.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if(!match){try{s=decodeURIComponent(s);}catch{}match=s.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/)||s.match(/(?:[?&](?:q|query)=|\/search\/)(-?[\d.]+)[, +]+(-?[\d.]+)/);}
  if(!match)return null;const p={lat:Number(match[1]),lng:Number(match[2])};
  if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)throw new Error('Invalid latitude / longitude');return p;
}
async function resolveLocation(input){const p=coordinate(input.value);if(p)return p;if(input.value.trim().startsWith('https://'))return api('resolve',{url:input.value.trim()});const matches=stationPoints.filter(f=>f.properties.name.toLocaleLowerCase()===input.value.trim().toLocaleLowerCase());if(matches.length===1)return {lng:matches[0].geometry.coordinates[0],lat:matches[0].geometry.coordinates[1]};throw new Error(matches.length>1?'Ambiguous station name; pick the correct point on the map.':'Enter latitude, longitude, a listed station, or a Google Maps dropped-pin link.');}
function showBanner(text,finish){$('pickBanner').hidden=false;$('pickBanner').querySelector('span').textContent=text;$('cancelPick').textContent=finish?'Finish / return':'Cancel';$('cancelPick').onclick=finish||cancelPick;}
function hideBanner(){$('pickBanner').hidden=true;document.body.classList.remove('picking');map.getContainer().classList.remove('pick-mode');map.invalidateSize();}
function cancelPick(){picking=null;hideBanner();if(formType&&!$('editor').open)$('editor').showModal();}
function pickInput(input){$('editor').close();picking=input;document.body.classList.add('picking');map.getContainer().classList.add('pick-mode');map.invalidateSize();$('map').scrollIntoView();showBanner('Tap the exact point on the map.');}
map.on('click',e=>{if(!picking)return;const input=picking;input.value=e.latlng.lat.toFixed(6)+', '+e.latlng.lng.toFixed(6);picking=null;hideBanner();$('editor').showModal();input.closest('.location-box').querySelector('.location-feedback').textContent='Point selected. Use Preview to check it.';});
function locationBox(id,title,value,parent=$('fields')){
  const box=document.createElement('div');box.className='location-box';
  box.innerHTML='<label for="'+id+'">'+esc(title)+'</label><input id="'+id+'" autocomplete="off" placeholder="48.185335, 16.380676 or Maps link"><div class="location-buttons"><button type="button" data-action="pick">Pick on map</button><button type="button" data-action="preview">Resolve / preview</button><button type="button" data-action="gps">GPS</button></div><p class="location-feedback"></p>';
  parent.append(box);const input=$(id);input.setAttribute('list','stationNames');if(value)input.value=value.lat+', '+value.lng;
  box.querySelector('[data-action=pick]').onclick=()=>pickInput(input);
  box.querySelector('[data-action=gps]').onclick=()=>gps(p=>{input.value=p.lat.toFixed(6)+', '+p.lng.toFixed(6);});
  box.querySelector('[data-action=preview]').onclick=async()=>{try{const p=await resolveLocation(input);input.value=p.lat+', '+p.lng;box.querySelector('.location-feedback').textContent=p.lat.toFixed(6)+', '+p.lng.toFixed(6);previews.clearLayers();pin(p,'P',previews);map.setView(p,14);$('editor').close();$('map').scrollIntoView();showBanner('Check this pin, then return to the question.',()=>{hideBanner();$('editor').showModal();});}catch(e){box.querySelector('.location-feedback').textContent=e.message;}};
  return input;
}
function html(value){$('fields').insertAdjacentHTML('beforeend',value);}
function select(id,label,options,value){html('<label>'+label+'<select id="'+id+'">'+options.map(([v,t])=>'<option value="'+v+'" '+(v===value?'selected':'')+'>'+t+'</option>').join('')+'</select></label>');}
function addCandidate(p){const count=document.querySelectorAll('#candidateRows .location-box').length;const parent=$('candidateRows');const input=locationBox('candidate-'+uid(),count===0&&formType==='matching'?'1. Your nearest place':'Candidate place',p,parent);input.classList.add('candidate');const b=document.createElement('button');b.type='button';b.textContent='Remove';b.onclick=()=>input.closest('.location-box').remove();input.closest('.location-box').querySelector('.location-buttons').append(b);}
function openEditor(type,item=null){
  editorGeneration++;
  if(!ready)return;$('questionPicker').close();stopDrawing();editItem=item?clone(item):null;formType=type;previews.clearLayers();$('fields').replaceChildren();$('formError').textContent='';$('itemLabel').value=item?.label||'';
  $('editorTitle').textContent=(item?'Edit ':'Add ')+({admin:'region match',circle:'exact circle',note:'observation'}[type]||type);
  if(['radar','thermometer','measuring'].includes(type))locationBox('pointA',type==='thermometer'?'Start point A':type==='measuring'?'Seekers (optional if distance is entered)':'Seekers at question time',item?.a);
  if(type==='thermometer')locationBox('pointB','End point B',item?.b);
  if(type==='radar'||type==='circle'||(type==='drawing'&&item?.shape==='Circle')){
    if(type!=='radar')locationBox('pointA','Circle centre',item?.center);
    html('<label>Radius in kilometres<input id="radius" type="number" min="0.001" max="1500" step="any" value="'+esc(item?.radius||5)+'"></label>');
  }
  if(type==='admin'){
    select('adminLevel','Boundary level',[['states','Bundesland'],['districts','Political Bezirk (Vienna as one)'],['vienna','Vienna municipal district'],...Object.keys(featurePack?.cities||{}).map(k=>[k,k]),...(item?.regionGeometry&&!boundaries[item.level]?[[item.level,'Saved district snapshot']]:[])],item?.level||'states');
    html('<label>Region<select id="region"></select></label><p class="hint">Or identify a region from a point:</p>');locationBox('regionPoint','Point inside the region');html('<button type="button" id="findRegion">Find containing region</button>');
    const options=()=>{$('region').replaceChildren();const features=[...(boundaries[$('adminLevel').value]?.features||[])];if(item?.regionGeometry&&item.level===$('adminLevel').value&&!features.some(f=>String(f.properties.iso)===item.region))features.push(item.regionGeometry);features.sort((a,b)=>a.properties.name.localeCompare(b.properties.name)).forEach(f=>{const o=document.createElement('option');o.value=f.properties.iso;o.textContent=f.properties.name;$('region').append(o);});if(item?.region&&item.level===$('adminLevel').value)$('region').value=item.region;};
    options();$('adminLevel').onchange=options;$('findRegion').onclick=async()=>{try{const p=await resolveLocation($('regionPoint'));const f=boundaries[$('adminLevel').value].features.find(f=>turf.booleanPointInPolygon(Geo.point(p),f));if(!f)throw new Error('No region at that point for this level');$('region').value=f.properties.iso;}catch(e){$('formError').textContent=e.message;}};
  }
  if(type==='matching'||type==='measuring'){
    html('<div id="pointInputs"></div>');
    const start=$('fields').children.length;
    html('<label>Feature category<input id="category" list="categories" placeholder="Mountain, airport, park..."><datalist id="categories"><option>Mountain</option><option>Commercial airport</option><option>Park</option><option>Museum</option><option>Hospital</option><option>Rail station</option><option>Library</option><option>Zoo</option></datalist></label>');$('category').value=item?.category||'';
    html('<p class="hint">'+(type==='matching'?'First candidate = your nearest place. Add every other eligible competitor.':'Add the eligible places. The comparison uses distance to the nearest candidate, not necessarily the same one for both teams.')+' Only include places inside the game map.</p><div id="candidateRows"></div><button type="button" id="addCandidate">+ Candidate place</button>');
    (item?.points||[null,...(type==='matching'?[null]:[])]).forEach(p=>addCandidate(p));$('addCandidate').onclick=()=>addCandidate();
    if(type==='measuring')html('<label>Our distance in km (or calculate from seekers)<input id="referenceDistance" type="number" min="0.001" step="any" placeholder="Otherwise calculated from seekers" value="'+esc(item?.distance||'')+'"></label>');
    html('<label><input type="checkbox" id="verified" '+(item&&!item.provisional?'checked':'')+'> Candidate set checked; apply to remaining area</label><p class="hint">Unchecked clues are provisional previews only. For coastlines, borders or altitude, use a manual shape / note instead of substituting a point.</p>');
    [...$('fields').children].slice(start).forEach(node=>$('pointInputs').append(node));
    if(type==='measuring'){measurementEditor(item);$('fields').prepend($('measureSource').parentElement);}
  }
  if(['radar','admin','matching'].includes(type))select('answer','Answer',[['hit','Hit / same'],['miss','Miss / different']],item?.answer||'hit');
  if(type==='thermometer')select('answer','At B, the hider is...',[['warmer','Warmer (closer to B)'],['colder','Colder (closer to A)']],item?.answer||'warmer');
  if(type==='measuring')select('answer','Hider compared with seekers',[['closer','Closer to nearest feature'],['further','Further from nearest feature']],item?.answer||'closer');
  if(type==='circle'||type==='drawing'){
    select('effect','Shape purpose',(item?.shape==='Line')?[['note','Annotation / distance only']]:[['note','Annotation only'],['keep','Keep only the inside'],['exclude','Exclude the inside']],item?.effect||'note');
    html('<label>Colour<input id="shapeColor" type="color" value="'+esc(item?.color||'#bb8833')+'"></label>');
  }
  $('editor').showModal();
}
async function formItem(){
  const generation=editorGeneration;
  const item={...(editItem||{}),id:editItem?.id||uid(),type:formType,label:$('itemLabel').value.trim(),enabled:editItem?.enabled??true,created:editItem?.created||new Date().toISOString()};
  const featureMode=formType==='measuring'&&$('measureSource').value!=='points';
  if($('pointA')&&!featureMode){if(formType!=='measuring'||$('pointA').value.trim()||!$('referenceDistance').value)item.a=await resolveLocation($('pointA'));else delete item.a;}
  if($('pointB'))item.b=await resolveLocation($('pointB'));
  if($('answer'))item.answer=$('answer').value;
  if($('radius')){item.radius=Number($('radius').value);if(!Number.isFinite(item.radius)||item.radius<.001||item.radius>1500)throw new Error('Radius must be 0.001-1500 km');}
  if(formType==='thermometer'&&Geo.distance(item.a,item.b)<.001)throw new Error('Start and end must differ by at least one metre');
  if(formType==='admin'){item.level=$('adminLevel').value;item.region=$('region').value;item.regionName=$('region').selectedOptions[0]?.textContent;if(!item.region)throw new Error('This district dataset is unavailable. Reload to retry.');if(!editItem||editItem.level!==item.level||editItem.region!==item.region){item.regionGeometry=clone(boundaries[item.level].features.find(f=>String(f.properties.iso)===item.region));item.datasetVersion=['linz','graz'].includes(item.level)?'20260910':'legacy-2021';}}
  if(featureMode){
    const key=$('measureSource').value;
    item.distance=Number($('featureDistance').value);item.measureSource=key;item.provisional=!$('featureVerified').checked;
    if(key==='drawn'){
      const line=$('drawnLine').value==='saved'?editItem?.measureGeo:round().items.find(i=>i.id===$('drawnLine').value)?.geo?.geometry;
      if(!line)throw new Error('Draw a line on this map first, then select it here.');
      item.measureGeo=clone(line);item.category='Drawn line';item.datasetVersion='manual-snapshot';
    }else{
      const preset=featurePack?.presets[key];if(!preset)throw new Error('Preset unavailable. Reload to retry.');
      item.measureGeo=editItem?.measureSource===key&&editItem?.measureGeo?editItem.measureGeo:clone(preset.geometry);
      item.category=editItem?.measureSource===key?editItem.category:preset.name;item.datasetVersion=editItem?.measureSource===key?editItem.datasetVersion:preset.id;
      item.sourceNote=editItem?.measureSource===key&&editItem.sourceNote?editItem.sourceNote:preset.source+'. '+preset.warning;
    }
    delete item.points;delete item.a;
    if(!Number.isFinite(item.distance)||item.distance<.001||item.distance>1500)throw new Error('Distance must be 0.001-1500 km');
    if(!(editItem?.bandGeometry&&editItem.distance===item.distance&&JSON.stringify(editItem.measureGeo)===JSON.stringify(item.measureGeo))){item.bandGeometry=await calculateBand(item.measureGeo,item.distance);item.bandDistance=item.distance;}
    if(generation!==editorGeneration||!$('editor').open)throw new Error('Calculation cancelled; no clue was saved.');
    $('formError').textContent='';
  }else if(['matching','measuring'].includes(formType)){
    delete item.measureGeo;delete item.measureSource;delete item.sourceNote;delete item.datasetVersion;delete item.bandGeometry;delete item.bandDistance;
    item.points=[];for(const input of document.querySelectorAll('.candidate'))item.points.push(await resolveLocation(input));
    if(item.points.length<(formType==='matching'?2:1))throw new Error('Add '+(formType==='matching'?'your place and at least one competitor':'at least one place'));
    if(item.points.length>40)throw new Error('Use at most 40 candidates per clue');
    if(item.points.some(p=>!turf.booleanPointInPolygon(Geo.point(p),gameArea)))throw new Error('A candidate is outside the game map. Only include eligible places inside it.');
    item.category=$('category').value.trim();item.provisional=!$('verified').checked;
    if(formType==='measuring'){item.distance=$('referenceDistance').value?Number($('referenceDistance').value):null;if(item.distance!==null&&(!Number.isFinite(item.distance)||item.distance<=0||item.distance>1500))throw new Error('Invalid reference distance');}
  }
  if(formType==='circle'||formType==='drawing'){item.type='drawing';item.effect=$('effect').value;item.color=$('shapeColor').value;if(formType==='circle'||item.shape==='Circle'){item.shape='Circle';item.center=item.a;delete item.a;}}
  if(item.type!=='note'&&!(item.type==='drawing'&&item.effect==='note'))Geo.constraint(item,boundaries);
  return item;
}
$('questionForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const item=await formItem();change(()=>{const i=round().items.findIndex(i=>i.id===item.id);if(i<0)round().items.push(item);else round().items[i]=item;});closeEditor();}catch(error){$('formError').textContent=error.message;}finally{button.disabled=false;}};
$('previewQuestion').onclick=async()=>{try{const item=await formItem();previews.clearLayers();addOutline(item,previews);if(item.type!=='note'&&!(item.type==='drawing'&&item.effect==='note')){const c=Geo.intersect(gameArea,Geo.constraint(item,boundaries));if(c)L.geoJSON(c,{interactive:false,style:{color:'#287050',weight:2,fillOpacity:.17}}).addTo(previews);}const b=previews.getBounds();if(b.isValid())map.fitBounds(b,{padding:[40,40],maxZoom:15});$('editor').close();$('map').scrollIntoView();showBanner('Preview only. Green is consistent with this answer.',()=>{hideBanner();$('editor').showModal();});}catch(e){$('formError').textContent=e.message;}};
function closeEditor(){editorGeneration++;$('editor').close();formType='';editItem=null;previews.clearLayers();picking=null;hideBanner();}
$('closeEditor').onclick=closeEditor;$('editor').addEventListener('cancel',()=>{editorGeneration++;formType='';previews.clearLayers();hideBanner();});
document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>openEditor(b.dataset.question));
function stopDrawing(){map.pm.disableDraw();[...shapeLayers.values()].forEach(l=>{if(l.pm?.enabled())l.pm.disable();});hideBanner();}
document.querySelectorAll('[data-draw]').forEach(b=>b.onclick=()=>{stopDrawing();showMobile('map');map.pm.enableDraw(b.dataset.draw,{allowSelfIntersection:false,snappable:false,continueDrawing:false,finishOn:'dblclick',pathOptions:{color:'#bb8833',fillOpacity:.12}});showBanner('Drawing '+b.dataset.draw+'. Tap points; double-tap to finish a line.',()=>stopDrawing());});
$('cancelDraw').onclick=stopDrawing;
map.on('pm:create',e=>{let item={id:uid(),type:'drawing',shape:e.shape,effect:'note',color:'#bb8833',enabled:true};if(e.shape==='Circle'){item.center=e.layer.getLatLng();item.radius=e.layer.getRadius()/1000;}else item.geo=e.layer.toGeoJSON();map.removeLayer(e.layer);hideBanner();openEditor('drawing',item);});

$('exportBook').onclick=()=>{const blob=new Blob([JSON.stringify(book,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fieldwork-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function importRounds(data){
  if(data.version!==2||!Array.isArray(data.rounds)||!data.rounds.length)throw new Error('Use a Fieldwork v2 workbook export');
  if(book.rounds.length+data.rounds.length>100)throw new Error('Maximum 100 rounds');
  for(const r of data.rounds){if(typeof r.name!=='string'||!Array.isArray(r.items)||r.items.length>500)throw new Error('Invalid round');for(const i of r.items){if(!['radar','thermometer','admin','matching','measuring','drawing','note'].includes(i.type))throw new Error('Unknown clue type');if(i.type!=='note'&&!(i.type==='drawing'&&i.effect==='note'))Geo.constraint(i,boundaries);}}
  change(()=>{for(const r of data.rounds)book.rounds.push({...clone(r),id:uid(),name:r.name.slice(0,110)+' (imported)',items:r.items.map(i=>({...i,id:uid()}))});active=book.rounds.at(-1).id;});
}
$('importBook').onchange=async e=>{try{const f=e.target.files[0];if(f){if(f.size>7000000)throw new Error('File too large');importRounds(JSON.parse(await f.text()));}}catch(error){alert(error.message);}e.target.value='';};

async function init(){
  let cached=null;try{cached=JSON.parse(localStorage.getItem(CACHE)||'null');}catch{status('Local recovery copy unreadable; loading server');}
  try{
    const authentication=await fetch('/auth/session',{cache:'no-store'});
    if(authentication.status===401){authRedirecting=true;location.replace('/login');return;}
    if(!authentication.ok)throw new Error('Could not check your login');
    csrfToken=(await authentication.json()).csrf;
    const [states,districts]=await Promise.all(['austria-states','austria-districts'].map(n=>fetch('assets/'+n+'.geojson').then(r=>{if(!r.ok)throw new Error('Boundary asset unavailable');return r.json();})));
    boundaries.states=states;boundaries.districts={type:'FeatureCollection',features:districts.features.filter(f=>!String(f.properties.iso).startsWith('9')||String(f.properties.iso)==='900')};boundaries.vienna={type:'FeatureCollection',features:districts.features.filter(f=>String(f.properties.iso).startsWith('9')&&String(f.properties.iso)!=='900')};
    gameArea=Geo.union(states.features.filter(f=>!['Tirol','Vorarlberg'].includes(f.properties.name)));
    try{const response=await fetch('assets/features-public-20260911.json');if(!response.ok)throw new Error('Feature data unavailable');featurePack=await response.json();Object.assign(boundaries,featurePack.cities);}catch(e){console.warn('Measuring presets unavailable:',e.message);}
    try{const response=await fetch('assets/highspeed-corridors-20260910-v2.json');if(!response.ok)throw new Error('Corridor data unavailable');const preset=await response.json();if(featurePack)featurePack.presets.highspeedCorridors=preset;}catch(e){console.warn('High-speed corridor preset unavailable:',e.message);}
    L.geoJSON(Geo.subtract(turf.bboxPolygon([-180,-85,180,85]),gameArea),{pane:'exclusions',interactive:false,pmIgnore:true,style:{stroke:false,fillColor:'#283029',fillOpacity:.3}}).addTo(map);
    L.geoJSON(states,{interactive:false,style:{color:'#475548',weight:1,fill:false,pmIgnore:true}}).addTo(map);
    const data=await api('workbook');book=data.book;revision=data.revision;
    if(cached?.dirty){book=cached.book;revision=cached.revision;dirty=true;if(revision!==data.revision){conflict=data;warning('Recovered unsaved draft; the server also changed.',true);}}
    ready=true;render();$('fitGame').click();if(dirty&&!conflict)save();else status(conflict?'Recovered draft':'Saved to server');cache();
  }catch(e){
    if(cached&&gameArea){book=cached.book;revision=cached.revision;dirty=cached.dirty;ready=true;render();warning('Using the saved copy on this phone. Reconnect to save.');status('Offline');}
    else{status('Could not load workbook');$('areaStatus').textContent=e.message;warning('Could not load the server or map. Reload to retry.');}
  }
  try{const data=await fetch('assets/rail-network.geojson').then(r=>{if(!r.ok)throw new Error('Rail snapshot unavailable');return r.json();});rails.addData({type:'FeatureCollection',features:data.features.filter(f=>f.geometry.type==='LineString')});stationPoints=data.features.filter(f=>f.geometry.type==='Point');stationLayer.addData({type:'FeatureCollection',features:stationPoints});for(const name of [...new Set(stationPoints.map(f=>f.properties.name).filter(Boolean))].sort()){const option=document.createElement('option');option.value=name;$('stationNames').append(option);}railDataLoaded=true;updateStations();}catch(e){status('Rail layer unavailable; street works');}
  setInterval(poll,5000);
}
let nameAction=null;
let mapViews={};try{mapViews=JSON.parse(localStorage.getItem('fieldwork-views')||'{}');}catch{}
function rememberView(){if(!active)return;mapViews[active]={center:map.getCenter(),zoom:map.getZoom()};try{localStorage.setItem('fieldwork-views',JSON.stringify(mapViews));}catch{}}
function showMobile(view){document.body.classList.toggle('mobile-clues',view==='clues');$('showMap').classList.toggle('active',view==='map');$('showClues').classList.toggle('active',view==='clues');map.invalidateSize();}
function switchMap(id){
  if(!ready||!book.rounds.some(r=>r.id===id))return;
  stopDrawing();rememberView();active=id;undoStack=[];previews.clearLayers();render();showMobile('map');
  const view=mapViews[id];if(view)map.setView(view.center,view.zoom,{animate:false});else $('fitGame').click();
}
function openMapName(action,id){
  if(!ready)return;nameAction={action,id};$('mapManager').close();
  const source=book.rounds.find(r=>r.id===id);
  $('mapNameTitle').textContent=action==='rename'?'Rename map':action==='duplicate'?'Duplicate map':'Create a new map';
  $('newMapName').value=action==='rename'?source.name:action==='duplicate'?(source.name+' copy').slice(0,120):'Round '+(book.rounds.length+1);
  $('mapNameHint').textContent=action==='rename'?'Changes only this map\'s name.':action==='duplicate'?'Copies these clues into a separate map. The original stays saved.':'Starts with a clean Austria map. Your other maps stay saved.';
  $('mapNameDialog').showModal();$('newMapName').focus();$('newMapName').select();
}
function openMaps(){
  if(!ready)return;$('mapList').replaceChildren();
  book.rounds.forEach(r=>{const card=document.createElement('article');card.className='map-entry'+(r.id===active?' current':'');
    card.innerHTML='<h3>'+esc(r.name)+'</h3><p>'+r.items.length+' clues'+(r.id===active?' / currently open':' / saved on server')+'</p><div class="buttons"></div>';
    const action=(label,fn,cls='')=>{const b=document.createElement('button');b.textContent=label;b.className=cls;b.onclick=fn;card.querySelector('.buttons').append(b);return b;};
    action(r.id===active?'Return to map':'Open map',()=>{$('mapManager').close();switchMap(r.id);},'primary');
    action('Rename',()=>openMapName('rename',r.id));action('Duplicate',()=>openMapName('duplicate',r.id));
    const del=action('Delete',()=>{if(!confirm('Delete "'+r.name+'" and its '+r.items.length+' clues? Other maps will remain.'))return;change(()=>{book.rounds=book.rounds.filter(m=>m.id!==r.id);});openMaps();},'danger');del.disabled=book.rounds.length===1;
    $('mapList').append(card);
  });if(!$('mapManager').open)$('mapManager').showModal();
}
$('newMap').onclick=()=>openMapName('create');$('managerNew').onclick=()=>openMapName('create');
$('allMaps').onclick=openMaps;$('closeMaps').onclick=()=>$('mapManager').close();
$('cancelMapName').onclick=()=>$('mapNameDialog').close();
$('mapNameForm').onsubmit=e=>{
  e.preventDefault();const name=$('newMapName').value.trim();if(!name)return;
  if(nameAction.action!=='rename'&&book.rounds.length>=100)return alert('Maximum 100 maps. Export and remove an old map first.');
  rememberView();let target=nameAction.id;
  change(()=>{if(nameAction.action==='rename'){book.rounds.find(r=>r.id===target).name=name;}else{const source=nameAction.action==='duplicate'?clone(book.rounds.find(r=>r.id===target)):{items:[]};target=uid();book.rounds.push({...source,id:target,name});}});
  $('mapNameDialog').close();switchMap(target);
};
$('mapSelect').onchange=e=>switchMap(e.target.value);
function openPicker(){if(!ready)return;$('pickerMap').textContent='Adding to '+round().name;$('questionPicker').showModal();}
$('openQuestionPicker').onclick=openPicker;$('mobileAdd').onclick=openPicker;$('closePicker').onclick=()=>$('questionPicker').close();
$('showMap').onclick=()=>showMobile('map');$('showClues').onclick=()=>showMobile('clues');
$('pickerDraw').onclick=()=>{$('questionPicker').close();showMobile('clues');$('drawTools').open=true;$('drawTools').scrollIntoView({block:'start'});};
// Move the original controls, keeping their event handlers and single source of state.
$('layerTools').append($('basemap'),$('shade').parentElement,$('stations').parentElement);
$('viewTools').append($('fitGame'),$('fitRemaining'),$('locate'));
$('fileTools').append(document.querySelector('#panel footer'));
$('toolsButton').onclick=()=>$('mapTools').showModal();
$('closeTools').onclick=()=>$('mapTools').close();
$('mapSwitchButton').onclick=openMaps;
['fitGame','fitRemaining','locate','helpButton'].forEach(id=>$(id).addEventListener('click',()=>$('mapTools').close()));
$('logout').onclick=async()=>{try{if(dirty){await save();if(dirty)return alert('Your changes are not saved yet. Retry saving or export your workbook first.');}await api('/auth/logout',{});authRedirecting=true;location.replace('/login');}catch(e){alert(e.message);}};
init();
