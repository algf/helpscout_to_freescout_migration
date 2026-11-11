import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { reset, inspect, readTrace } from '../scripts/local.mjs';
import { instrument, samples, rowSelector } from './measurement';
const variant=process.env.BENCH_VARIANT||'candidate';
const files=variant==='baseline'?['baseline/quick-close.js','baseline/unsub.js','baseline/UnsubscribeController.php','baseline/inbox-shortcuts.js','baseline/Middleware.php']:['src/CrockdHelpScoutFolders/quick-close.js','src/UnSub/Resources/assets/unsub.js','src/UnSub/Http/Controllers/UnsubscribeController.php','src/InboxShortcuts/Resources/assets/inbox-shortcuts.js','src/InboxSpeed/Middleware.php'];
const sourceHashes=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
for(let repeat=0;repeat<Number(process.env.BENCH_REPEATS||1);repeat++) for(const mailbox of [1,2,3]) {
  test(`unsubscribe-only mailbox ${mailbox} repeat ${repeat+1}`,async({page},info)=>{
    test.skip(info.project.name==='mobile','Mobile has no list unsubscribe control. Toolbar persistence is covered by the mixed workload.');
    let box:any;
    const result:any={runId:process.env.BENCH_RUN_ID,variant,project:info.project.name,mailbox,scenario:'unsubscribe-only',repeat,sourceHashes,actions:[],responses:[],failures:[],config:{closeCount:0,delayMs:10000}};
    await instrument(page);
    try {
      const fixture=await reset({delayMs:10000,outcome:'accepted'});
      await page.setExtraHTTPHeaders({'X-Action-Speed-Generation': fixture.generation});
      box=fixture.mailboxes[mailbox];
      await page.goto(`/staging-login/1?to=${encodeURIComponent(box.folderUrl)}`);
      await page.waitForSelector('.unsub-review');
      await page.evaluate(()=>new Promise<void>(resolve=>(window as any).jQuery(()=>resolve())));
      result.initialCount=await page.locator('#folders > li.active .active-count').innerText();
      await page.evaluate(({id,count})=>{
        const w=window as any;
        w.__unsubState={hiddenEpochMs:null,counterEpochMs:null};
        const start=performance.now();
        const poll=()=>{
          const row=document.querySelector(`tr.conv-row[data-conversation_id="${id}"]`);
          const hidden=!row||getComputedStyle(row).display==='none';
          const current=document.querySelector('#folders > li.active .active-count')?.textContent?.trim();
          const now=performance.timeOrigin+performance.now();
          if(hidden&&w.__unsubState.hiddenEpochMs===null) requestAnimationFrame(()=>{if(w.__unsubState.hiddenEpochMs===null)w.__unsubState.hiddenEpochMs=performance.timeOrigin+performance.now();});
          if(current===String(Number(count)-1)&&w.__unsubState.counterEpochMs===null)w.__unsubState.counterEpochMs=now;
          if(performance.now()-start<16000)requestAnimationFrame(poll);
        };requestAnimationFrame(poll);
      },{id:box.unsubId,count:result.initialCount});
      await page.locator(`${rowSelector(box.unsubId)} .unsub-review`).click();
      await expect.poll(()=>readTrace().filter((e:any)=>e.event==='end').length,{timeout:20000}).toBe(1);
      await expect.poll(()=>{result.database=inspect();return result.database.conversations.some((c:any)=>c.id===box.unsubId&&c.status===3&&c.accepted);},{timeout:10000}).toBe(true);
      if(variant==='candidate')await expect(page.locator(rowSelector(box.unsubId))).toBeHidden({timeout:5000});
      await page.waitForTimeout(2200);
      result.trace=readTrace();
      result.database=inspect();
      result.actions=await samples(page);
      result.state=await page.evaluate(()=>(window as any).__unsubState);
      const end=result.trace.find((e:any)=>e.event==='end').timeMs;
      result.transportToHiddenMs=result.state.hiddenEpochMs===null?null:result.state.hiddenEpochMs-end;
      result.transportToCounterMs=result.state.counterEpochMs===null?null:result.state.counterEpochMs-end;
      result.finalCount=await page.locator('#folders > li.active .active-count').innerText();
      const html=await (await page.request.get(box.folderUrl)).text();
      result.serverCount=await page.evaluate(html=>new DOMParser().parseFromString(html,'text/html').querySelector('#folders > li.active .active-count')?.textContent?.trim(),html);
      const check=(ok:boolean,message:string)=>{if(!ok)result.failures.push(message);};
      check(result.trace.filter((e:any)=>e.event==='end').length===1,'Transport did not finish exactly once');
      check(end-result.trace.find((e:any)=>e.event==='start')?.timeMs>=10000,'Controlled transport did not run for at least 10 seconds');
      check(result.trace.filter((e:any)=>e.event==='start').length===1,'Transport called more than once');
      check(result.database.conversations.some((c:any)=>c.id===box.unsubId&&c.status===3&&c.accepted),'Unsubscribe was not accepted and closed in DB');
      check(result.state.hiddenEpochMs!==null,'Accepted unsubscribe row stayed visible');
      check(result.finalCount===result.serverCount,'Counter does not match server after reconciliation');
      check(Number(result.finalCount)===Number(result.initialCount)-1,'Counter did not drop by exactly one');
    }catch(error){result.failures.push(String(error));throw error;}
    finally{mkdirSync('results',{recursive:true});writeFileSync(`results/${variant}-${info.project.name}-m${mailbox}-unsubscribe-only-${repeat}.json`,JSON.stringify(result,null,2));await info.attach('raw measurements',{body:JSON.stringify(result,null,2),contentType:'application/json'});}
    if(variant==='candidate')expect(result.failures).toEqual([]);
  });
}
