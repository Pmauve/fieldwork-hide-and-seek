const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('./geometry.js'), T=require('./vendor/turf.min.js');
const inside=(p,f)=>!!f&&T.booleanPointInPolygon(G.point(p),f);
test('radar hit and miss are opposite for near/far points',()=>{
 const a={lat:48.18,lng:16.38},near={lat:48.19,lng:16.38},far={lat:48.8,lng:16.38};
 assert(inside(near,G.constraint({type:'radar',a,radius:5,answer:'hit'})));
 assert(!inside(far,G.constraint({type:'radar',a,radius:5,answer:'hit'})));
 assert(inside(far,G.constraint({type:'radar',a,radius:5,answer:'miss'})));
});
test('thermometer spherical split agrees with direct distance across Austria',()=>{
 const a={lat:48.185,lng:16.38},b={lat:48.05,lng:15.7};
 for(const answer of ['warmer','colder']){
  const region=G.constraint({type:'thermometer',a,b,answer});
  for(let lat=46;lat<49;lat+=.1)for(let lng=9.5;lng<17;lng+=.2){const p={lat,lng},delta=G.distance(p,a)-G.distance(p,b);if(Math.abs(delta)<.01)continue;assert.equal(inside(p,region),answer==='warmer'?delta>0:delta<0,JSON.stringify(p));}
 }
});
test('nearest matching region compares every candidate',()=>{
 const points=[{lat:48,lng:14},{lat:48,lng:15},{lat:47,lng:14}];
 const hit=G.constraint({type:'matching',points,answer:'hit'});
 const miss=G.constraint({type:'matching',points,answer:'miss'});
 assert(inside(points[0],hit));assert(!inside(points[1],hit));assert(inside(points[1],miss));
});
test('measuring uses nearest feature, which may differ for each team',()=>{
 const a={lat:48,lng:14},points=[{lat:48,lng:14.1},{lat:47,lng:15}];
 const region=G.constraint({type:'measuring',a,points,answer:'closer'});
 assert(inside({lat:47.001,lng:15},region));assert(!inside({lat:48,lng:16},region));
});
test('contradictory radar answers produce an empty intersection',()=>{
 const a={lat:48,lng:14},q={type:'radar',a,radius:5};
 assert.equal(G.intersect(G.constraint({...q,answer:'hit'}),G.constraint({...q,answer:'miss'})),null);
});
