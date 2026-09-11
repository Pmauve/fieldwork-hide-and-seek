/* Spherical distances; output boundaries are densified for display and polygon clipping. */
(function (root) {
  const T = typeof turf !== 'undefined' ? turf : require('./vendor/turf.min.js');
  const fc = features => T.featureCollection(features.filter(Boolean));
  const intersect = (a, b) => a && b ? T.intersect(fc([a, b])) : null;
  const subtract = (a, b) => !a ? null : !b ? a : T.difference(fc([a, b]));
  const union = features => features.length === 1 ? features[0] : T.union(fc(features));
  const point = p => [p.lng, p.lat];
  const distance = (a, b) => T.distance(point(a), point(b));
  const circle = (p, km) => T.circle(point(p), km, {steps: 256});
  const frame = T.bboxPolygon([8, 45, 18, 50]);
  const bufferCache = new WeakMap();
  function featureBand(geometry, km) {
    if (!geometry || !['LineString','MultiLineString','Polygon','MultiPolygon'].includes(geometry.type)) throw new Error('Select a line or boundary geometry');
    if (!Number.isFinite(km) || km < .001 || km > 1500) throw new Error('Distance must be 0.001-1500 km');
    let cache=bufferCache.get(geometry);
    if(!cache){cache=new Map();bufferCache.set(geometry,cache);}
    if(!cache.has(km)){
      const band=T.buffer(T.feature(geometry),km,{units:'kilometers',steps:24});
      if(!band)throw new Error('Could not calculate distance band');
      if(cache.size>=4)cache.delete(cache.keys().next().value);
      cache.set(km,band);
    }
    return cache.get(km);
  }
  function vector(p) {
    const lat = p.lat * Math.PI / 180, lng = p.lng * Math.PI / 180;
    return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
  }
  function nearer(a, b) {
    if (distance(a, b) < 0.001) throw new Error('Points must be at least one metre apart.');
    const av = vector(a), bv = vector(b), n = av.map((v, i) => v - bv[i]);
    const signed = p => vector({lng:p[0], lat:p[1]}).reduce((s,v,i) => s + v*n[i], 0);
    // Clip a dense Austria-sized rectangle by the exact spherical equal-distance test.
    const ring = [];
    const corners = [[8,45],[18,45],[18,50],[8,50]];
    corners.forEach((a,i) => {
      const b = corners[(i+1)%4];
      for(let j=0;j<200;j++) ring.push([a[0]+(b[0]-a[0])*j/200,a[1]+(b[1]-a[1])*j/200]);
    });
    const output=[];
    for(let i=0;i<ring.length;i++) {
      const a=ring[i], b=ring[(i+1)%ring.length], fa=signed(a), fb=signed(b);
      if(fa>=0) output.push(a);
      if((fa>=0)!==(fb>=0)) {
        let lo=0, hi=1;
        for(let k=0;k<45;k++) { const m=(lo+hi)/2, f=signed([a[0]+(b[0]-a[0])*m,a[1]+(b[1]-a[1])*m]); if((f>=0)===(fa>=0)) lo=m; else hi=m; }
        output.push([a[0]+(b[0]-a[0])*(lo+hi)/2,a[1]+(b[1]-a[1])*(lo+hi)/2]);
      }
    }
    if(output.length<3) return null;
    // Densify the joining great-circle edge, avoiding a straight Mercator bisector.
    const dense=[];
    for(let i=0;i<output.length;i++) {
      const a=output[i], b=output[(i+1)%output.length]; dense.push(a);
      if(Math.abs(signed(a))<1e-10 && Math.abs(signed(b))<1e-10) {
        const dist=T.distance(a,b), bearing=T.bearing(a,b), count=Math.ceil(dist/2);
        for(let j=1;j<count;j++) dense.push(T.destination(a,dist*j/count,bearing).geometry.coordinates);
      }
    }
    dense.push(dense[0]); return T.polygon([dense]);
  }
  function constraint(item, context) {
    let region;
    if(item.type==='radar') { region=circle(item.a,item.radius); return item.answer==='hit'?region:subtract(frame,region); }
    if(item.type==='thermometer') return item.answer==='warmer'?nearer(item.b,item.a):nearer(item.a,item.b);
    if(item.type==='admin') {
      region=item.regionGeometry || context[item.level]?.features.find(f=>String(f.properties.iso)===item.region);
      if(!region) throw new Error('Administrative boundary not found');
      return item.answer==='hit'?region:subtract(frame,region);
    }
    if(item.type==='matching') {
      const chosen=item.points[0]; region=frame;
      for(const other of item.points.slice(1)) region=intersect(region,nearer(chosen,other));
      return item.answer==='hit'?region:subtract(frame,region);
    }
    if(item.type==='measuring') {
      if(item.measureGeo){region=item.bandDistance===item.distance&&item.bandGeometry?item.bandGeometry:featureBand(item.measureGeo,item.distance);return item.answer==='closer'?region:subtract(frame,region);}
      const radius=item.distance || Math.min(...item.points.map(p=>distance(item.a,p)));
      if(radius<=0) throw new Error('Reference distance must be greater than zero');
      region=union(item.points.map(p=>circle(p,radius)));
      return item.answer==='closer'?region:subtract(frame,region);
    }
    if(item.type==='drawing' && item.effect!=='note') {
      region=item.shape==='Circle'?circle(item.center,item.radius):item.geo;
      return item.effect==='keep'?region:subtract(frame,region);
    }
    return null;
  }
  const api={point,distance,circle,nearer,intersect,subtract,union,frame,constraint,featureBand};
  root.Geo=api;
  if(typeof module!=='undefined') module.exports=api;
})(globalThis);
