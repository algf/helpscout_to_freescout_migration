import { test, expect, type Locator } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { reset, inspect, readTrace } from '../scripts/local.mjs';
import { instrument, samples, rowSelector } from './measurement';
const variant = process.env.BENCH_VARIANT || 'candidate';
const enforced = variant === 'candidate';
const repeats = Number(process.env.BENCH_REPEATS || 1);
const sourceFiles=variant==='baseline'?['baseline/quick-close.js','baseline/unsub.js','baseline/UnsubscribeController.php','baseline/inbox-shortcuts.js','baseline/Middleware.php']:['src/CrockdHelpScoutFolders/quick-close.js','src/UnSub/Resources/assets/unsub.js','src/UnSub/Http/Controllers/UnsubscribeController.php','src/InboxShortcuts/Resources/assets/inbox-shortcuts.js','src/InboxSpeed/Middleware.php'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
for (let repeat=0;repeat<repeats;repeat++) for (const mailbox of [1,2,3]) for (const scenario of ['close-only','unsubscribe-pending','unsubscribe-rejected','unsubscribe-uncertain']) {
  test(`${scenario} mailbox ${mailbox} repeat ${repeat+1}`, async ({page}, info) => {
    const failures:string[]=[];
    const activate=(control:Locator)=>info.project.name==='mobile'?control.tap():control.click();
    const result:any={runId:process.env.BENCH_RUN_ID,variant,project:info.project.name,mailbox,scenario,repeat,sourceHashes,config:{baseURL:'http://localhost:53927',delayMs:10000,cadenceMs:250,closeCount:10,repeats,ackP95BudgetMs:100,playwright:'1.63.0'},failures,actions:[],responses:[]};
    const check=(condition:boolean,message:string)=>{if(!condition) failures.push(message);};
    let box:any;
    await instrument(page);
    const responses:any[]=[];
    page.on('requestfinished', async request => {
      const body=request.postData() || '';
      if (!/conversation_change_status|action=execute/.test(body)) return;
      const timing=request.timing();
      const response=await request.response();
      const data=await response?.json().catch(()=>null);
      const params=new URLSearchParams(body);
      const safeBody=new URLSearchParams({action:params.get('action')||'',conversation_id:params.get('conversation_id')||''}).toString();
      responses.push({url:request.url(),body:safeBody,status:response?.status(),success:response?.ok() && (body.includes('conversation_change_status')?data?.status==='success':data?.accepted===true),startEpochMs:timing.startTime,responseMs:timing.responseEnd,completedEpochMs:timing.startTime+timing.responseEnd});
    });
    let navigationCount=0;
    let measureNavigation=false;
    page.on('framenavigated',frame=>{if(measureNavigation&&frame===page.mainFrame()) navigationCount++;});
    try {
      const fixture:any=await reset({delayMs:10000,outcome:scenario==='unsubscribe-rejected'?'rejected':scenario==='unsubscribe-uncertain'?'uncertain':'accepted'});
      await page.setExtraHTTPHeaders({'X-Action-Speed-Generation': fixture.generation});
      box=fixture.mailboxes[mailbox];
      result.closeIds=box.closeIds.slice(0,10);
      result.mobileFlow=info.project.name==='mobile'?'same-page toolbar to back: server continuity after original document request abort':'same-document list';
      await page.goto(`/staging-login/1?to=${encodeURIComponent(box.folderUrl)}`);
      await page.waitForSelector('.mailbox-one-click-close');
      await page.evaluate(()=>new Promise<void>(resolve=>(window as any).jQuery(()=>resolve())));
      result.initialCount=await page.locator('#folders > li.active .active-count').innerText();
      if(scenario!=='close-only') {
        if(info.project.name==='mobile') {
          await activate(page.locator(`${rowSelector(box.unsubId)} td.conv-subject a`).first());
          await page.waitForFunction(()=>document.documentElement.dataset.unsubReady==='1');
          await page.evaluate(()=>new Promise<void>(resolve=>(window as any).jQuery(()=>resolve())));
          await activate(page.locator('#conv-toolbar .unsub-review'));
        } else await activate(page.locator(`${rowSelector(box.unsubId)} .unsub-review`));
        await expect.poll(async()=> (await readTrace()).filter((event:any)=>event.event==='start').length,{timeout:10000}).toBeGreaterThan(0);
        if(info.project.name==='mobile') {
          result.toolbarActions=await samples(page);
          await page.goBack({waitUntil:'load'});
          await page.waitForSelector('.mailbox-one-click-close');
          await page.evaluate(()=>new Promise<void>(resolve=>(window as any).jQuery(()=>resolve())));
        }
      }
      measureNavigation=true;
      const listUrl=page.url();
      const batchStart=Date.now();
      for (const [index,id] of box.closeIds.slice(0,10).entries()) {
        const wait=batchStart+index*250-Date.now();
        if(wait>0) await page.waitForTimeout(wait);
        // Real browser click, including hit testing and app event handlers.
        await activate(page.locator(`${rowSelector(id)} .mailbox-one-click-close`));
      }
      const sampled=await samples(page);
      await expect.poll(()=>responses.filter(r=>r.body.includes('conversation_change_status')).length,{timeout:25000}).toBe(10);
      if(scenario!=='close-only') await expect.poll(async()=> (await readTrace()).filter((event:any)=>event.event==='end').length,{timeout:25000}).toBeGreaterThan(0);
      if(scenario==='unsubscribe-pending') {
        await expect.poll(()=>{result.database=inspect();return result.database.conversations.some((c:any)=>Number(c.id)===box.unsubId&&Number(c.status)===3&&c.accepted);},{timeout:10000}).toBe(true);
        if(enforced) await expect(page.locator(rowSelector(box.unsubId))).toBeHidden({timeout:5000});
      }
      await page.waitForTimeout(1800);
      result.actions=await samples(page);
      // Retain samples if navigation discarded document-local timing data.
      if(!result.actions.length) result.actions=sampled;
      result.responses=responses;
      result.navigationCount=navigationCount;
      result.trace=await readTrace();
      result.database=await inspect();
      const rows=result.database.conversations;
      const counter=page.locator('#folders > li.active .active-count');
      result.finalCount=await counter.innerText();
      const serverHtml=await (await page.request.get(box.folderUrl)).text();
      result.serverCount=await page.evaluate(html=>new DOMParser().parseFromString(html,'text/html').querySelector('#folders > li.active .active-count')?.textContent?.trim(),serverHtml);
      result.expectedFinalCount=Number(result.initialCount)-10-(scenario==='unsubscribe-pending'?1:0);
      check(Number(result.finalCount)===result.expectedFinalCount,'Counter does not match independently expected delta');
      check(result.finalCount.trim()===result.serverCount,'Counter does not match the server after reconciliation');
      if(enforced && info.project.name==='mobile') {
        const header = page.locator('.sidebar-title-extra-value.active-count');
        await expect(header).toBeVisible();
        const visibleHeader = (await header.innerText()).trim();
        const serverHeader = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector('.sidebar-title-extra-value.active-count')?.textContent?.trim(), serverHtml);
        check(visibleHeader === serverHeader, 'Visible mobile header does not match the server');
        check(visibleHeader.endsWith(`(${result.expectedFinalCount})`), 'Visible mobile header has the wrong count');
      }
      const closeResponses=responses.filter(r=>r.body.includes('conversation_change_status'));
      for(const id of box.closeIds.slice(0,10)) {
        check(closeResponses.filter(r=>new URLSearchParams(r.body).get('conversation_id')===String(id)).length===1,`Close ${id} did not receive exactly one response`);
        check(rows.some((row:any)=>Number(row.id)===id&&Number(row.status)===3),`Conversation ${id} is not closed in DB`);
        check(!(await page.locator(rowSelector(id)).isVisible()),`Closed row ${id} reappeared after reconciliation`);
      }
      check(navigationCount===0&&page.url()===listUrl,'Close actions navigated away from the list');
      const closeSamples=result.actions.filter((a:any)=>a.kind==='close');
      check(closeSamples.length===10,'Missing close click timing samples');
      for(const sample of closeSamples) check(sample.ackMs!==null,`Close ${sample.id} acknowledgement is missing`);
      for(const response of closeResponses) check(response.success,`Close request returned HTTP ${response.status} without status success`);
      if(scenario!=='close-only') {
        const starts=result.trace.filter((e:any)=>e.event==='start');
        const ends=result.trace.filter((e:any)=>e.event==='end');
        check(starts.length===1&&ends.length===1,'Unsubscribe transport was not called exactly once');
        const end=ends[0]?.timeMs;
        const start=starts[0]?.timeMs;
        check(Number(ends[0]?.durationMs ?? (Number(end)-Number(start)))>=10000,'Controlled transport did not run for at least 10 seconds');
        check(Boolean(start)&&closeResponses.every(r=>r.startEpochMs>=start),'A close request started before unsubscribe transport');
        check(Boolean(end)&&closeResponses.every(r=>r.completedEpochMs<end),'Close responses did not all finish before unsubscribe transport');
        if(scenario==='unsubscribe-pending') check(!(await page.locator(rowSelector(box.unsubId)).isVisible()),'Accepted unsubscribe row reappeared or stayed visible');
        const unsub=rows.find((r:any)=>Number(r.id)===box.unsubId);
        check(scenario!=='unsubscribe-pending'?Number(unsub?.status)!==3:Number(unsub?.status)===3,'Unsubscribe final status is wrong');
        if(scenario!=='unsubscribe-pending') check(!unsub?.accepted,'Unconfirmed unsubscribe was marked accepted');
        else check(Boolean(unsub?.accepted),'Accepted unsubscribe was not recorded');
        if(scenario==='unsubscribe-pending'){
          mkdirSync('results',{recursive:true});
          result.screenshot=`results/${variant}-${info.project.name}-m${mailbox}-accepted-state-${repeat}.png`;
          await page.screenshot({path:result.screenshot,fullPage:true});
          await info.attach('accepted unsubscribe final UI',{path:result.screenshot,contentType:'image/png'});
        }
      }
    } catch(error) {
      failures.push(String(error));
      result.actions=await samples(page).catch(()=>[]);
      result.responses=responses;
      throw error;
    } finally {
      result.finishedAt=new Date().toISOString();
      mkdirSync('results',{recursive:true});
      writeFileSync(`results/${variant}-${info.project.name}-m${mailbox}-${scenario}-${repeat}.json`,JSON.stringify(result,null,2));
      await info.attach('raw measurements',{body:JSON.stringify(result,null,2),contentType:'application/json'});
    }
    if(enforced) expect(failures,failures.join('\n')).toEqual([]);
  });
}
