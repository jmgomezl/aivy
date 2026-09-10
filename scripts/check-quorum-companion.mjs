// Isolated fixtures; no request reaches a model or a ledger.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='/tmp/quorum-companion';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const [width,height] of [[1800,1080],[1440,1000],[1024,1000],[768,1000],[390,900],[320,800],[844,390]]){
 const context=await browser.newContext({viewport:{width,height},ignoreHTTPSErrors:true});
 await context.addInitScript(()=>localStorage.setItem('aivy-quorum-session-v1','c'.repeat(64)));
 const p=await context.newPage(),errors=[],posts=[],assets=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>assets.push(r.url()));
 await p.route('**/api/quorum/**',async route=>{
  const req=route.request(),url=new URL(req.url()),action=url.pathname.replace('/api/quorum','');let data={ok:true,network:'testnet'};
  if(req.method()==='POST'){posts.push(action);assert.equal(action,'/chat');}
  if(action==='/')data={...data,scheduler:{intervalSeconds:30},mandate:{rules:{monthlyBudget:10,minimumPayout:800},place:{name:'Medellín, Colombia'},status:'scheduled',enabled:true,maxTotalPremium:30,nextDueAt:'2026-10-10T05:00:00Z',attempts:[{status:'complete',policy:{serial:'701',premium:10,payout:1398.88,saleTxId:'0.0.1@1.0',scheduleId:'0.0.200',lapsesAt:'2026-10-10T05:00:00Z'}}]}};
  if(action==='/chat'){
   const body=req.postDataJSON();assert.deepEqual(Object.keys(body).sort(),body.topic?['question','topic']:['question']);
   if(body.question==='fail')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Status temporarily unavailable. No policy was changed.'})});
   data={...data,mode:'read_only',source:body.topic?'quick':'ai',message:body.question.includes('pause')?'Chat cannot change your rules. Use the canvas controls.':'Your latest policy, #701, is active. Its conditional payout has not executed.',facts:[{label:'Policy',value:'#701',tone:'neutral'},{label:'Ledger status',value:'active',tone:'mint'}],links:[{label:'Policy #701 & NFT',url:'https://quorum.aivylabs.xyz/policy/701'}],control:body.question.includes('pause'),checkedAt:new Date().toISOString(),ledgerCheckedAt:new Date().toISOString()};
  }
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await p.goto('https://127.0.0.1:5185/quorum');await p.getByRole('button',{name:'Pause agent',exact:true}).waitFor();
 const launcher=p.getByRole('button',{name:'Ask your cover companion',exact:true});await launcher.click();
 const dialog=p.getByRole('dialog',{name:'Cover companion'});await dialog.waitFor();
 if(height>560){await dialog.getByRole('button',{name:'Policy status',exact:true}).click();await dialog.getByText('Direct policy read',{exact:false}).waitFor();}
 const input=dialog.getByRole('textbox',{name:'Ask your cover companion'});await input.fill('How is my cover doing?');await input.press('Enter');await dialog.getByText('AI interpreted · Quorum data',{exact:false}).waitFor();
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.waitForFunction(()=>getComputedStyle(document.querySelector('.qc-chat-panel')).transform==='none');
 const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height);
 if(width>=1440){const board=await p.locator('.qc-board').boundingBox();assert(board.x+board.width<bounds.x,'Desktop panel should sit beside the canvas');}
 await p.waitForFunction(()=>getComputedStyle(document.querySelector('.qc-chat-panel')).transform==='none');
 await p.screenshot({path:`${out}/fixture-${width}-${height}.png`,fullPage:true});
 await p.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await p.getByRole('button',{name:'Ask your cover companion',exact:true}).getAttribute('aria-expanded'),'false');
 await p.getByRole('button',{name:'Ask your cover companion',exact:true}).click();await p.getByRole('button',{name:'Close companion',exact:true}).click();assert.equal(await dialog.count(),0);
 await p.getByRole('button',{name:'Ask your cover companion',exact:true}).click();await p.locator('.qc-intro h1').click();assert.equal(await dialog.count(),0);
 if(width===1440){
  await p.getByRole('button',{name:'Ask your cover companion',exact:true}).click();await input.fill('Please pause my agent');await input.press('Enter');await dialog.getByRole('button',{name:'Show canvas controls'}).click();assert.equal(await dialog.count(),0);assert(!posts.includes('/pause'));
  await p.getByRole('button',{name:'Ask your cover companion',exact:true}).click();await input.fill('fail');await input.press('Enter');await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').innerText(),/No policy was changed/);
  await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.qc-companion-launcher .qc-pixel-bot').evaluate(el=>getComputedStyle(el).animationName),'none');
 }
 if(!await dialog.count())await p.getByRole('button',{name:'Ask your cover companion',exact:true}).click();
 await p.locator('.qc-brand').click();await p.waitForURL('https://127.0.0.1:5185/');
 assert.deepEqual(errors,[]);assert(posts.every(x=>x==='/chat'));assert(!assets.some(u=>/\/assets\/(App-|wallet-)/.test(u)));
 console.log('PASS',width,height,'quick/chat answers, no writes, placement, close, escape, mobile fit');await context.close();
}}finally{await browser.close();}
