// UI regression fixture. No requests reach any ledger; screenshots stay in /tmp.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='/tmp/quorum-cover-canvas';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [1440,1024,768,390,320]){
 const context=await browser.newContext({viewport:{width,height:1000},ignoreHTTPSErrors:true});const page=await context.newPage();let mandate=null;const posts=[],errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.route('**/api/quorum/**',async route=>{
  const req=route.request(),action=new URL(req.url()).pathname.replace('/api/quorum','');let data={ok:true,network:'testnet'};
  if(req.method()==='POST')posts.push({action,body:req.postDataJSON()});
  if(action==='/quote')data={ok:true,days:30,nextDueAt:'2026-10-09T00:00:00Z',quote:{ok:true,settled:{premium:10,payout:1398.8}}};
  if(action==='/activate'){
   assert.equal(req.postDataJSON().acceptTerms,true);mandate={id:'fixture-only',rules:req.postDataJSON(),place:{name:'Medellín, Colombia',lat:6.2442,lon:-75.5812},status:'scheduled',enabled:true,accountId:'0.0.200',createdAt:'2026-09-09T00:00:00Z',expiresAt:'2026-12-09T00:00:00Z',nextDueAt:'2026-10-09T00:00:00Z',maxPurchases:3,maxTotalPremium:30,message:null,attempts:[{cycle:0,status:'complete',requestId:'fixture-only',policy:{serial:'999',premium:10,payout:1398.8,beneficiaryId:'0.0.201',lapsesAt:'2026-10-09T00:00:00Z',saleTxId:'0.0.1@1.0',scheduleId:'0.0.202',termsPointer:'hcs://0.0.203/1'}}]};
  }
  if(action==='/pause'){mandate.enabled=false;mandate.status='paused';}
  if(action==='/resume'){mandate.enabled=true;mandate.status='scheduled';}
  if(['/','/activate','/pause','/resume','/run'].includes(action))data={...data,mandate,scheduler:{intervalSeconds:30,lastCheckedAt:new Date().toISOString()}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('https://127.0.0.1:5185/quorum');await page.getByRole('button',{name:'Review my plan'}).waitFor();await page.getByRole('button',{name:'Review my plan'}).click();
 const activate=page.getByRole('button',{name:'Activate & buy first cover'});await activate.waitFor();assert(await activate.isDisabled());assert.equal(posts.filter(p=>p.action==='/activate').length,0);
 await page.screenshot({path:`${output}/fixture-review-${width}.png`,fullPage:true});
 await page.getByRole('checkbox').check();await activate.click();await page.getByRole('button',{name:'Pause agent'}).waitFor();
 assert.equal(posts.filter(p=>p.action==='/activate').length,1);assert.equal(posts.filter(p=>p.action==='/start').length,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`${output}/fixture-active-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Pause agent'}).click();await page.getByRole('button',{name:'Resume agent'}).waitFor();await page.reload();await page.getByRole('button',{name:'Resume agent'}).waitFor();
 await page.getByRole('button',{name:'Resume agent'}).click();await page.getByRole('button',{name:'Check renewal now'}).click();await page.getByText('No extra policy purchased.',{exact:false}).waitFor();
 assert.equal(posts.filter(p=>p.action==='/activate').length,1);assert.deepEqual(errors,[]);assert(!requests.some(u=>/\/assets\/(App-|wallet-)/.test(u)),'Focused canvas must not load legacy office or wallet bundles');
 console.log('PASS',width,'consent, rules, receipt, pause/resume, reload, no overflow, no legacy wallet bundle');await context.close();
}}finally{await browser.close();}
