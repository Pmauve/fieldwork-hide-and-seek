const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const T=require('./vendor/turf.min.js'),G=require('./geometry.js');
const preset=JSON.parse(fs.readFileSync('assets/highspeed-corridors-20260910-v2.json'));
const old=JSON.parse(fs.readFileSync('assets/features-public-20260911.json')).presets.highspeed;
const distance=(p,geometry)=>Math.min(...geometry.coordinates.map(line=>T.pointToLineDistance(p,T.lineString(line))));
test('corridor includes Linz Hbf, Wels and Attnang, unlike the legacy Linz gap',()=>{
 for(const [name,p] of [['Linz',[14.2918619,48.2902408]],['Wels',[14.0265101,48.1659478]],['Attnang',[13.7208855,48.0126112]]]){
  const km=distance(p,preset.geometry);console.log(name,Math.round(km*1000)+' m from track');assert(km<.15);
 }
 assert(distance([14.2918619,48.2902408],old.geometry)>3);
});
test('rail geometry uses actual paths, includes tunnel and city corridors, excludes Salzburg',()=>{
 assert.equal(preset.corridors.length,4);
 for(const f of preset.corridors){
  const length=T.length(f);console.log(f.properties.name,length.toFixed(1)+' km');assert(length>20&&length<260);
 }
 assert(distance([13.0457,47.8132],preset.geometry)>20);
 assert(distance([15.4165166,47.0723984],preset.geometry)<.25);
 assert(distance([14.3137028,46.6156856],preset.geometry)<.25);
});
test('new measurement keeps Linz for a 1 km closer answer',()=>{
 const band=G.featureBand(preset.geometry,1);
 assert(T.booleanPointInPolygon([14.2918619,48.2902408],band));
 assert(preset.provisional);assert.notEqual(preset.id,old.id);
});
