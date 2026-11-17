import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyFile, mkdtemp, stat, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
const {chromium}=await import(pathToFileURL(process.env.DRILL_PLAYWRIGHT).href);
const source=process.argv[2];
assert(source && source !== ':memory:' && (await stat(source)).size>0, 'Supply a verified restored database');
const started=performance.now();
const dir=await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(),'gc-drill-app-'));
const clone=join(dir,'app.sqlite');
await copyFile(source,clone,constants.COPYFILE_FICLONE);
const port=19417;
const origin='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:resolve(process.env.DRILL_REPO || 'gaugecraft'),env:{PATH:process.env.PATH,GAUGECRAFT_DB:clone,REQUIRE_EXISTING_DB:'1',COLLECT:'0',BACKUP_ENABLED:'0',HOST:'127.0.0.1',PORT:String(port),CHAINS:'8453,10,42161,1,57073,4663,5042'},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';
server.stdout.on('data',buf=>stdout+=buf);
server.stderr.on('data',buf=>stderr+=buf);
let browser;
try {
 for(let i=0;!stdout.includes('listening on port');i++){
  if(server.exitCode !== null || i>300) throw new Error('Server failed to start '+stderr);
  await pause(100);
 }
 const alive=await fetch(origin+'/health/live');
 assert.equal(alive.status,200);
 const upSeconds=(performance.now()-started)/1000;
 const fresh=await (await fetch(origin+'/health/data')).json();
 const store=await (await fetch(origin+'/health/storage')).json();
 assert.equal(store.backup.enabled,false);
 browser=await chromium.launch({...(process.env.DRILL_CHROME ? {executablePath:process.env.DRILL_CHROME} : {channel:'chrome'}),headless:true,args:['--no-sandbox']});
 const results={time:new Date().toISOString(),upSeconds,clone,health:fresh,views:[]};
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,serviceWorkers:'block'});
  const page=await context.newPage();
  const errors=[],external=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin) {external.push(url.origin);return route.abort();}
   if(url.pathname.startsWith('/api/'))requests.push(url.pathname+url.search);
   return route.continue();
  });
  const statePromise=page.waitForResponse(r=>r.url().includes('/api/state?'));
  await page.goto(origin+'/#markets');
  const state=await (await statePromise).json();
  assert.equal(state.mode,'live');
  assert.equal(state.collectorEnabled,false);
  assert(state.markets.length>0);
  const market=page.locator('.market-panel');
  await market.getByRole('heading',{name:/Markets/}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.market-card').length>0);
  assert.equal(Number(await market.locator('h2 .count').innerText()),state.markets.length);
  const marketRow=(await market.locator('.market-card .pool-button').first().textContent()).trim();
  await market.getByRole('textbox',{name:'Search pools'}).fill('WETH');
  await page.waitForFunction(()=>{const rows=[...document.querySelectorAll('.market-card .pool-button')];return rows.length && rows.every(row=>row.textContent.includes('WETH'))});
  const view={width,marketCount:state.markets.length,marketRow,searchRows:await market.locator('.market-card').count()};
  await page.getByRole('button',{name:'Opportunities',exact:true}).click();
  const opp=page.locator('section.shortlist');
  await opp.waitFor();
  await page.waitForFunction(()=>document.querySelector('.shortlist-rows li,section.shortlist .empty')!==null);
  view.wallClockOpportunity=await opp.locator('h2').innerText();
  view.wallClockPicks=await opp.locator('.shortlist-rows li').count();
  if(fresh.stalePools===state.markets.length){
   assert.equal(view.wallClockPicks,0);
   assert((await page.locator('main').innerText()).includes('stale observations'));
  }
  // Replay the application with the browser set to the restored observation time.
  if(view.wallClockPicks===0){
   await page.clock.setFixedTime(new Date((fresh.newest+1)*1000));
   await page.reload();
   await opp.locator('.shortlist-rows li').first().waitFor({timeout:30000});
  }
  view.atSnapshotPicks=await opp.locator('.shortlist-rows li').count();
  view.atSnapshotHeading=await opp.locator('h2').innerText();
  view.atSnapshotTop=(await opp.locator('.shortlist-rows li').first().innerText()).split('\n').filter(Boolean).slice(0,9);
  assert(view.atSnapshotPicks>0);
  const perfPromise=page.waitForResponse(r=>r.url().includes('/api/performance?'));
  await page.getByRole('button',{name:'Performance',exact:true}).click();
  const perf=await (await perfPromise).json();
  await page.locator('.benchmark-pair').first().waitFor();
  assert(perf.decisions.length>0 && perf.totalStored>0);
  assert(perf.evaluations.some(e=>e.status==='proxy'));
  view.evaluations=perf.evaluations.length;view.savedDecisions=perf.decisions.length;view.storedForecasts=perf.totalStored;
  view.benchmarks=await page.locator('.benchmark-pair').evaluateAll(items=>items.map(item=>[item.querySelector('h3').innerText,item.querySelector('p').innerText]));
  await page.getByText('Forecast ledger',{exact:true}).first().waitFor();
  assert.deepEqual(errors,[]);
  assert.deepEqual(external,[]);
  assert(requests.length>=2 && requests.every(r=>r.includes('mode=live')));
  view.apiRequests=requests;
  results.views.push(view);
  await context.close();
 }
 results.checksSeconds=(performance.now()-started)/1000;
 await writeFile(join(process.env.RUNNER_TEMP || tmpdir(),'gc-drill-views-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
}catch(e){console.error({stdout,stderr});throw e;} finally{
 if(browser) await browser.close();
 if(server.exitCode===null){const closed=once(server,'close');server.kill('SIGTERM');await closed;}
}
