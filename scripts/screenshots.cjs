// Run against a NEW local development database, never a live/shared deployment.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const origin=process.env.DEMO_ORIGIN||'http://127.0.0.1:4173';
 const url=new URL(origin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1365,height:850},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>ready&&featurePack);
  const initial=await page.evaluate(()=>({revision,book}));
  assert.equal(initial.revision,0,'Use a NEW empty development database, not a game workbook.');
  assert(initial.book.rounds.every(r=>r.items.length===0));
  const demo=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/demo.json')));
  await page.evaluate(demo=>change(()=>{book=demo;active=demo.rounds[0].id;}),demo);
  await page.waitForFunction(()=>!dirty&&!saving);
  await page.reload();await page.waitForFunction(()=>ready&&railDataLoaded);
  assert.equal(await page.evaluate(()=>round().items.length),3);
  await page.evaluate(()=>map.setView([48.29,14.29],11,{animate:false}));
  await page.waitForTimeout(2000);
  const out=path.join(__dirname,'../docs/screenshots');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{showMobile('map');map.invalidateSize();map.setView([48.29,14.29],10,{animate:false});});
  await page.waitForTimeout(1500);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'mobile.png')});
  await page.click('#mobileAdd');await page.click('[data-question=radar]');
  await page.fill('#pointA','48.2902, 14.2919');await page.fill('#radius','5');
  await page.fill('#itemLabel','Fictional example / station radar');
  await page.screenshot({path:path.join(out,'clue.png')});
  assert.deepEqual(errors,[]);
  console.log('Captured fictional screenshots; demo save/reload and mobile width passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exit(1);});
