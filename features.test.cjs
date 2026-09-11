const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const G=require('./geometry.js'),T=require('./vendor/turf.min.js');
const pack=JSON.parse(fs.readFileSync('assets/features-public-20260911.json'));
test('a line band follows segments rather than endpoint circles',()=>{
 const geo=T.lineString([[14,47],[16,47]]).geometry;
 const clue={type:'measuring',measureGeo:geo,distance:5,answer:'closer'};
 assert(T.booleanPointInPolygon([15,47.01],G.constraint(clue,{})));
 assert(!T.booleanPointInPolygon([15,47.2],G.constraint(clue,{})));
 assert(T.booleanPointInPolygon([15,47.2],G.constraint({...clue,answer:'further'},{})));
 assert.throws(()=>G.constraint({...clue,distance:0},{}));
});
test('new district snapshots survive unavailable or replaced datasets',()=>{
 for(const city of ['example-city','unavailable-city']){
  const f=T.polygon([[[14,47],[14.1,47],[14.1,47.1],[14,47.1],[14,47]]]);
  assert.equal(G.constraint({type:'admin',level:city,region:'old-id',regionGeometry:f,answer:'hit'},{}),f);
 }
});
test('all preset bands compute and are cacheable',()=>{
 for(const [name,preset] of Object.entries(pack.presets)){
  const started=performance.now(),band=G.featureBand(preset.geometry,5);
  assert(T.area(band)>0);
  assert.equal(G.featureBand(preset.geometry,5),band);
  console.log(name,Math.round(performance.now()-started)+'ms',JSON.stringify(band).length+' bytes');
 }
 assert(pack.presets.highspeed.provisional);
});
test('international border is not the artificial Salzburg-Tirol exclusion boundary',()=>{
 const states=JSON.parse(fs.readFileSync('assets/austria-states.geojson')).features;
 const tyrol=states.find(f=>f.properties.name==='Tirol');
 const salzburg=states.find(f=>f.properties.name==='Salzburg');
 // Known internal boundary area near Gerlos Pass, far from an international border.
 const p=[12.13,47.24];
 assert(!T.booleanPointInPolygon(p,G.featureBand(pack.presets.international.geometry,2)));
 assert(tyrol&&salzburg);
});
