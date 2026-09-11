importScripts('/vendor/turf.min.js','/geometry.js');
onmessage=event=>{
  try{
    const band=Geo.featureBand(event.data.geometry,event.data.distance);
    const simplified=turf.simplify(band,{tolerance:0.000025,highQuality:true});
    postMessage({band:turf.truncate(simplified,{precision:6,coordinates:2})});
  }catch(error){postMessage({error:error.message});}
};
