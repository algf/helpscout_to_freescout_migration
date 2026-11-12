import {test, expect, Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {guard, php} from '../../scripts/local.mjs';
// Root creates unique synthetic rows and a mailbox-limited user. No production IDs.
const fixture = () => JSON.parse(readFileSync(new URL('../../results/frontend-fixture.json', import.meta.url), 'utf8'));
test.describe.configure({mode:'serial'});
test.beforeAll(() => guard());
test.afterEach(async({page},info)=>{if(page.url().includes('localhost:53927'))await page.screenshot({path:info.outputPath('inbox-refresh.png')});});
async function open(page:Page,id:number) {
 const box=fixture().mailboxes[id];
 await page.goto(`/staging-login/1?to=${encodeURIComponent(box.folderUrl)}`);
 await expect(page.locator('html')).toHaveAttribute('data-mail-arrival','ready');
 return box;
}
function bump(id:number) {
 // Receipt-only UI contract test, separate from provider/importer end-to-end tests.
 return JSON.parse(php(`\\Modules\\MailArrival\\Version::bump(${id});echo json_encode(['version'=>\\Modules\\MailArrival\\Version::forMailbox(${id}),'committed_at_ms'=>(int)round(microtime(true)*1000)]);`));
}
async function baseline(page:Page) {return page.evaluate(()=> (window as any).mailArrival.state().baseline);}
async function settled(page:Page,previous:string) {
 await expect.poll(()=>baseline(page),{timeout:30000}).not.toBe(previous);
 await expect(page.locator('.mail-arrival-notice')).toBeHidden();
}
for(const id of [1,2,3]) test(`mailbox ${id} authorised receipt refreshes real inbox and preserves focus/scroll`,async({page})=>{
 await open(page,id);
 const focusSelector=page.viewportSize()!.width<600?'tr.conv-row td.conv-customer a':'tr.conv-row td.conv-subject a';
 const link=page.locator(focusSelector).first();
 await link.focus();await expect(link).toBeFocused();const href=await link.getAttribute('href');
 await test.info().attach('focus-before',{body:JSON.stringify(await page.evaluate(()=>({html:document.activeElement?.tagName==='BODY'?'BODY':document.activeElement?.outerHTML}))),contentType:'application/json'});
 const old=await baseline(page);const y=await page.evaluate(()=>window.scrollY);
 const handle=await page.locator('.table-conversations').elementHandle();
 const receipt=bump(id);await settled(page,old);
 const visible=await page.evaluate(()=>(window as any).mailArrivalMetrics);
 await test.info().attach('receipt-to-visible-timing',{body:JSON.stringify({mailbox:id,receipt,visible,committedToVisibleMs:visible.visibleAt-receipt.committed_at_ms},null,2),contentType:'application/json'});
 expect(await handle!.evaluate(el=>el.isConnected)).toBe(false);
 await test.info().attach('focus-after',{body:JSON.stringify(await page.evaluate(()=>({html:document.activeElement?.tagName==='BODY'?'BODY':document.activeElement?.outerHTML,links:Array.from(document.querySelectorAll('tr.conv-row td.conv-subject a')).slice(0,2).map(el=>el.outerHTML)}))),contentType:'application/json'});
 await expect(page.locator(focusSelector+':focus')).toHaveAttribute('href',href!);
 expect(Math.abs(await page.evaluate(()=>window.scrollY)-y)).toBeLessThanOrEqual(2);
 const response=await page.request.get(`/mail-arrival/version?mailbox_id=${id}`);
 expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');
});
test('selection defers the real table refresh then resumes after deselection',async({page})=>{
 test.skip(page.viewportSize()!.width<600,'The accepted mobile inbox does not expose selection controls; the desktop flow covers the selection guard.');
 await open(page,1);const checkbox=page.locator('input.conv-checkbox').first();await checkbox.focus();await checkbox.press('Space');
 const old=await baseline(page);const table=await page.locator('.table-conversations').elementHandle();
 bump(1);await expect(page.locator('.mail-arrival-notice')).toContainText('New mail');
 await page.waitForTimeout(2200);expect(await baseline(page)).toBe(old);expect(await table!.evaluate(el=>el.isConnected)).toBe(true);await expect(checkbox).toBeChecked();
 await page.screenshot({path:test.info().outputPath('selection-pending.png')});
 const target=await page.getByRole('button',{name:'Refresh inbox',exact:true}).boundingBox();expect(target!.height).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 await checkbox.focus();await checkbox.press('Space');await checkbox.blur();await settled(page,old);
});
test('pristine reader Back resumes refresh without losing retained document',async({page})=>{
 const box=await open(page,2);await page.locator(`tr[data-conversation_id="${box.conversationId}"] td.conv-subject a`).click();
 const reader=page.getByRole('dialog',{name:'Read conversation'});await expect(reader).toBeVisible();
 await expect(page.locator('iframe[data-inbox-navigation-frame]:not([hidden])')).toHaveAttribute('data-inbox-navigation-ready','ready');
 const old=await baseline(page);bump(2);await expect(page.locator('.mail-arrival-notice')).toContainText('New mail');
 expect(await baseline(page)).toBe(old);await reader.getByRole('button',{name:'Back to inbox'}).click();await settled(page,old);
});
test('dirty reader Back keeps draft text and defers refresh',async({page})=>{
 const box=await open(page,3);await page.locator(`tr[data-conversation_id="${box.conversationId}"] td.conv-subject a`).click();
 const child=page.frameLocator('iframe[data-inbox-navigation-frame]:not([hidden])');
 await expect(page.locator('iframe[data-inbox-navigation-frame]:not([hidden])')).toHaveAttribute('data-inbox-navigation-ready','ready');
 const editor=child.locator('.note-editable');
 if(!await editor.isVisible())await child.locator('.conv-reply').first().click();
 await editor.click();await editor.pressSequentially('Local arrival safety draft. Keep this text.',{delay:10});
 await expect.poll(()=>child.locator('html').evaluate(()=>Boolean((window as any).inboxNavigationEditorTouched || (window as any).fs_reply_changed))).toBe(true);
 await test.info().attach('dirty-before-back',{body:JSON.stringify(await child.locator('html').evaluate(()=>({touched:(window as any).inboxNavigationEditorTouched,changed:(window as any).fs_reply_changed,saving:(window as any).fs_processing_save_draft,text:document.querySelector('.note-editable')?.textContent}))),contentType:'application/json'});
 await page.getByRole('button',{name:'Back to inbox',exact:true}).click();
 await test.info().attach('dirty-after-back',{body:JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('iframe[data-inbox-navigation-frame]')).map((f:any)=>({hidden:f.hidden,ready:f.dataset.inboxNavigationReady,doc:f.contentWindow.location.pathname,touched:f.contentWindow.inboxNavigationEditorTouched,changed:f.contentWindow.fs_reply_changed,text:f.contentDocument.querySelector('.note-editable')?.textContent})))),contentType:'application/json'});
 const old=await baseline(page);bump(3);await expect(page.locator('.mail-arrival-notice')).toContainText('New mail');await page.waitForTimeout(2200);expect(await baseline(page)).toBe(old);
 await page.locator(`tr[data-conversation_id="${box.conversationId}"] td.conv-subject a`).click();await expect(child.locator('.note-editable')).toContainText('Local arrival safety draft. Keep this text.');
});
test('pending native close blocks refresh until confirmed',async({page})=>{
 const box=await open(page,1);let release!:()=>void;const held=new Promise<void>(r=>release=r);let started=false;
 await page.route('**/conversation/ajax*',async route=>{const body=route.request().postData()||'';if(body.includes('action=conversation_change_status')){started=true;await held;}await route.continue();});
 const old=await baseline(page);const table=await page.locator('.table-conversations').elementHandle();
 await page.locator(`tr[data-conversation_id="${box.conversationId}"] .mailbox-one-click-close`).click();await expect.poll(()=>started).toBe(true);
 bump(1);await expect(page.locator('.mail-arrival-notice')).toContainText('New mail');await page.waitForTimeout(1500);expect(await baseline(page)).toBe(old);expect(await table!.evaluate(el=>el.isConnected)).toBe(true);
 release();await settled(page,old);
});
test('authentication and mailbox scope are enforced by native HTTP middleware',async({browser})=>{
 const guest=await browser.newContext({baseURL:'http://localhost:53927'});try{const r=await guest.request.get('/mail-arrival/version?mailbox_id=1',{maxRedirects:0});expect([302,401]).toContain(r.status());}finally{await guest.close();}
 const restricted=await browser.newContext({baseURL:'http://localhost:53927'});try{const page=await restricted.newPage();await page.goto(fixture().restrictedLoginUrl);const allowed=await restricted.request.get('/mail-arrival/version?mailbox_id=1');expect(allowed.status()).toBe(200);const denied=await restricted.request.get('/mail-arrival/version?mailbox_id=2');expect(denied.status()).toBe(403);expect((await denied.json()).version).toBeUndefined();}finally{await restricted.close();}
});
test('refresh errors retain baseline and recover without manual page reload',async({page})=>{
 await open(page,2);const old=await baseline(page);let fail=true;
 await page.route('**/mail-arrival/version?*',async route=>{if(fail)await route.fulfill({status:503,body:'Unavailable'});else await route.continue();});
 bump(2);await expect(page.locator('.mail-arrival-notice')).toContainText('could not be checked');expect(await baseline(page)).toBe(old);
 fail=false;await page.getByRole('button',{name:'Check again',exact:true}).click();await settled(page,old);
});
for(const id of [1,2,3]) test(`mailbox ${id} pending synthetic unsubscribe and arrival keep parallel close final`,async({page})=>{
 const {configure,readTrace}=await import('../../../action-speed/scripts/local.mjs');
 // Check the actual server binding before any unsubscribe click. No external sender.
 expect(php('echo get_class(app(\\Modules\\UnSub\\Services\\UnsubscribeTransport::class));')).toBe('ActionSpeedTransport');
 configure({delayMs:8000,outcome:'accepted'});
 const box=await open(page,id);await expect(page.locator('html')).toHaveAttribute('data-unsub-ready','1');
 const row=(n:number)=>page.locator(`tr[data-conversation_id="${n}"]`);
 const old=await baseline(page),table=await page.locator('.table-conversations').elementHandle();
 if(page.viewportSize()!.width<600){
  await row(box.unsubId).scrollIntoViewIfNeeded();await row(box.unsubId).locator('td.conv-subject a').click();
  const frame=page.frameLocator('iframe[data-inbox-navigation-frame]:not([hidden])');
  await expect(page.locator('iframe[data-inbox-navigation-frame]:not([hidden])')).toHaveAttribute('data-inbox-navigation-ready','ready');
  await expect(frame.locator('html')).toHaveAttribute('data-unsub-ready','1');
  await frame.locator('#conv-toolbar .unsub-review').click();
  await expect.poll(()=>readTrace().filter((e:any)=>e.id===box.unsubId&&e.event==='start').length).toBe(1);
  await page.getByRole('button',{name:'Back to inbox',exact:true}).click();
 }else await row(box.unsubId).locator('.unsub-review').click();
 await expect.poll(()=>readTrace().filter((e:any)=>e.id===box.unsubId&&e.event==='start').length).toBe(1);
 bump(id);
 await row(box.parallelCloseId).locator('.mailbox-one-click-close').click();
 const state=()=>JSON.parse(php(`$out=[];foreach([${box.unsubId},${box.parallelCloseId}] as $id){$c=App\\Conversation::findOrFail($id);$out[]=['id'=>$id,'status'=>(int)$c->status,'accepted'=>(bool)$c->getMeta('unsub.accepted',[]),'unsubscribeActivities'=>$c->threads()->where('action_type',167)->count(),'closeActivities'=>$c->threads()->where('type',4)->where('action_type',1)->where('status',3)->count()];}echo json_encode($out);`));
 await expect.poll(()=>state().find((c:any)=>c.id===box.parallelCloseId)?.status).toBe(3);
 await expect(page.locator('.mail-arrival-notice')).toContainText('New mail');
 // Pass the native close refresh queue's 600ms coalescing window while the
 // actual unsubscribe transport is still held. Check every 250ms, not only once.
 for(let i=0;i<5;i++){expect(readTrace().filter((e:any)=>e.id===box.unsubId&&e.event==='end')).toHaveLength(0);expect(await table!.evaluate(el=>el.isConnected)).toBe(true);await page.waitForTimeout(250);}
 expect(await table!.evaluate(el=>el.isConnected)).toBe(true);
 expect(await baseline(page)).toBe(old);
 await page.screenshot({path:test.info().outputPath('unsubscribe-arrival-pending.png')});
 await expect.poll(()=>state().find((c:any)=>c.id===box.unsubId)?.accepted,{timeout:20000}).toBe(true);
 await settled(page,old);
 const final=state();expect(final.every((c:any)=>c.status===3)).toBe(true);
 expect(final.find((c:any)=>c.id===box.unsubId).unsubscribeActivities).toBe(1);
 expect(final.find((c:any)=>c.id===box.parallelCloseId).closeActivities).toBe(1);
 expect(readTrace().filter((e:any)=>e.id===box.unsubId&&e.event==='start')).toHaveLength(1);
 expect(readTrace().filter((e:any)=>e.id===box.unsubId&&e.event==='end')).toHaveLength(1);
 await expect(row(box.unsubId)).toBeHidden();await expect(row(box.parallelCloseId)).toBeHidden();
 await page.waitForTimeout(1200);await expect(row(box.unsubId)).toBeHidden();await expect(row(box.parallelCloseId)).toBeHidden();
});
test('stalled receipt request aborts at the bound and polling recovers',async({page})=>{
 await open(page,2);const old=await baseline(page);let first=true,release!:()=>void;const held=new Promise<void>(r=>release=r);let aborted=false;
 page.on('requestfailed',request=>{if(request.url().includes('/mail-arrival/version'))aborted=true;});
 await page.route('**/mail-arrival/version?*',async route=>{if(first){first=false;await held;}await route.continue().catch(()=>{});});
 bump(2);await expect(page.locator('.mail-arrival-notice')).toContainText('could not be checked',{timeout:12000});
 expect(await baseline(page)).toBe(old);expect(aborted).toBe(true);await page.screenshot({path:test.info().outputPath('receipt-timeout-recovery.png')});
 release();await settled(page,old);
});
test('subject sorting survives the next receipt-driven snapshot',async({page})=>{
 test.skip(page.viewportSize()!.width<600,'Accepted mobile inbox does not expose column sorting controls.');
 await open(page,1);const original=await page.locator('.table-conversations').elementHandle();
 const sort=page.locator('.conv-col-sort[data-sort-by="subject"]');await sort.focus();await sort.press('Enter');
 await expect.poll(()=>original!.evaluate(el=>el.isConnected)).toBe(false);
 await expect(page.locator('.table-conversations')).toHaveAttribute('data-sorting_sort_by','subject');
 const order=await page.locator('.table-conversations').getAttribute('data-sorting_order'),old=await baseline(page);
 bump(1);await settled(page,old);
 await expect(page.locator('.table-conversations')).toHaveAttribute('data-sorting_sort_by','subject');await expect(page.locator('.table-conversations')).toHaveAttribute('data-sorting_order',order!);
});
test('late snapshot cannot replace a newly requested pagination context',async({page})=>{
 await open(page,1);const old=await baseline(page);let release!:()=>void;const held=new Promise<void>(r=>release=r);let started=false,first=true;
 await page.route('**/mail-arrival/snapshot?*',async route=>{if(first){first=false;const response=await route.fetch();started=true;await held;await route.fulfill({response});}else await route.continue();});
 bump(1);await expect.poll(()=>started).toBe(true);
 await page.locator('.table-conversations [data-page="2"]').first().click();release();
 await settled(page,old);await expect(page.locator('.table-conversations')).toHaveAttribute('data-page','2');expect(new URL(page.url()).searchParams.get('page')).toBe('2');
});
test('pointer-down close survives a receipt response arriving before pointer-up',async({page})=>{
 const box=await open(page,1),old=await baseline(page);const table=await page.locator('.table-conversations').elementHandle();
 let release!:()=>void;const held=new Promise<void>(r=>release=r);let started=false,first=true;
 await page.route('**/mail-arrival/snapshot?*',async route=>{if(first){first=false;const response=await route.fetch();started=true;await held;await route.fulfill({response});}else await route.continue();});
 bump(1);await expect.poll(()=>started).toBe(true);
 const close=page.locator(`tr[data-conversation_id="${box.gestureCloseId}"] .mailbox-one-click-close`);await close.scrollIntoViewIfNeeded();const bounds=await close.boundingBox();
 await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2);await page.mouse.down();release();await page.waitForTimeout(500);
 expect(await table!.evaluate(el=>el.isConnected)).toBe(true);expect(await baseline(page)).toBe(old);
 await page.mouse.up();
 const state=()=>JSON.parse(php(`$c=App\\Conversation::findOrFail(${box.gestureCloseId});echo json_encode(['status'=>(int)$c->status,'activities'=>$c->threads()->where('type',4)->where('action_type',1)->where('status',3)->count()]);`));
 await expect.poll(()=>state().status).toBe(3);await settled(page,old);expect(state().activities).toBe(1);await expect(page.locator(`tr[data-conversation_id="${box.gestureCloseId}"]`)).toBeHidden();
});
test('unsupported mailbox snapshot filters defer without cross-mailbox HTML',async({page})=>{
 await open(page,1);const table=await page.locator('.table-conversations').elementHandle();
 const response=await page.request.get('/mail-arrival/snapshot?mailbox_id=1&folder_id=1&filter[customer_id]=1');
 expect(response.status()).toBe(409);const data=await response.json();expect(data.status).toBe('error');expect(data.html).toBeUndefined();expect(data.sidebar_html).toBeUndefined();expect(await table!.evaluate(el=>el.isConnected)).toBe(true);
});
