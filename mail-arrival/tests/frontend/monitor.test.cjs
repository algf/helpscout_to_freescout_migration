const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const exported={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/Modules/MailArrival/Resources/assets/mail-arrival.js'),'utf8'),{module:exported,URLSearchParams});
const {createMonitor,safeToRefresh}=exported.exports;
function setup(options = {}) {
 let visible = true, safe = true, response = {status:'success', mailbox_id:1, version:'1'}, refreshes = [], notices = [], scheduled = [], nextId = 0;
 const timers = new Map();
 const monitor = createMonitor({initialVersion:'1',mailboxId:1, later(fn,ms){const id=++nextId;timers.set(id,{fn,ms});scheduled.push(ms);return id;}, cancel(id){timers.delete(id);},visible:()=>visible,safe:()=>safe,
 fetch:()=> options.fetch ? options.fetch() : Promise.resolve(response), refresh:r=>{refreshes.push(r);return options.refresh ? options.refresh(r) : true;},notice:n=>notices.push(n)});
 return {monitor,refreshes,notices,scheduled,timers,setResponse:r=>response=r,setVisible:v=>visible=v,setSafe:v=>safe=v};
}
test('same initial receipt performs no inbox refresh and schedules cheap poll', async()=>{const h=setup();await h.monitor.poll();assert.equal(h.refreshes.length,0);assert.equal(h.scheduled.at(-1),1000);});
test('first poll catches import after server render rather than adopting a new baseline',async()=>{const h=setup();h.setResponse({status:'success',mailbox_id:1,version:'2'});await h.monitor.poll();assert.equal(h.refreshes.length,1);assert.equal(h.monitor.state().baseline,'2');});
test('receipt is acknowledged only after refresh and paint promise settles',async()=>{let finish;const h=setup({refresh:()=>new Promise(r=>finish=r)});h.setResponse({status:'success',mailbox_id:1,version:'2'});const poll=h.monitor.poll();await new Promise(setImmediate);assert.equal(h.monitor.state().baseline,'1');finish(true);await poll;assert.equal(h.monitor.state().baseline,'2');});
test('unsafe work defers without losing receipt, then refreshes once safe',async()=>{const h=setup();h.setSafe(false);h.setResponse({status:'success',mailbox_id:1,version:'2'});await h.monitor.poll();assert.equal(h.refreshes.length,0);assert.equal(h.notices.at(-1),'pending');h.setSafe(true);await h.monitor.attempt();await h.monitor.attempt();assert.equal(h.refreshes.length,1);});
test('stale response discarded at apply stays pending and retries',async()=>{let allowed=false;const h=setup({refresh:()=>allowed});h.setResponse({status:'success',mailbox_id:1,version:'2'});await h.monitor.poll();assert.equal(h.monitor.state().baseline,'1');allowed=true;await h.monitor.poll();assert.equal(h.monitor.state().baseline,'2');});
test('refresh failure never acknowledges receipt',async()=>{const h=setup({refresh:()=>Promise.reject(Error('network'))});h.setResponse({status:'success',mailbox_id:1,version:'2'});await h.monitor.poll();assert.equal(h.monitor.state().baseline,'1');assert.equal(h.notices.at(-1),'pending-error');});
test('hidden tab does not poll; returning resumes and failure backoff recovers',async()=>{let fail=true,calls=0;const h=setup({fetch:()=>{calls++;return fail?Promise.reject(Error()):Promise.resolve({status:'success',mailbox_id:1,version:'1'});}});h.setVisible(false);await h.monitor.poll();assert.equal(calls,0);h.setVisible(true);h.monitor.visibility();assert.equal(h.scheduled.at(-1),0);await h.monitor.poll();assert.equal(h.scheduled.at(-1),2000);fail=false;await h.monitor.poll();assert.equal(h.scheduled.at(-1),1000);});
test('overlapping polls coalesce and stopped responses cannot refresh',async()=>{let finish,calls=0;const h=setup({fetch:()=>{calls++;return new Promise(r=>finish=r);}});const first=h.monitor.poll();await new Promise(setImmediate);await h.monitor.poll();assert.equal(calls,1);h.monitor.stop();finish({status:'success',mailbox_id:1,version:'2'});await first;assert.equal(h.refreshes.length,0);assert.equal(h.timers.size,0);});
test('wrong mailbox and malformed receipts cannot mutate visible inbox',async()=>{for(const value of [{status:'success',mailbox_id:2,version:'2'},{status:'success',mailbox_id:1,version:''},{status:'error',mailbox_id:1,version:'2'}]){const h=setup();h.setResponse(value);await h.monitor.poll();assert.equal(h.refreshes.length,0);assert.equal(h.monitor.state().baseline,'1');}});
test('BFCache resume has one scheduled poll and preserves baseline',()=>{const h=setup();h.monitor.start();h.monitor.stop();h.monitor.start();assert.equal(h.timers.size,1);assert.equal(h.monitor.state().baseline,'1');});
function win(matches=[],children=[]) {return {document:{querySelector:s=>matches.some(m=>s.includes(m))?{}:null,querySelectorAll:()=>children,activeElement:null}};}
test('selection, reader, drafts, busy actions and child editor prevent refresh',()=>{
 for(const selector of ['input.conv-checkbox:checked','tr.conv-row.selected','.inbox-reader:not([hidden])','[aria-busy="true"]','.unsub-review.is-busy','.thread-type-draft','.modal.in'])assert.equal(safeToRefresh(win([selector]),0),false,selector);
 const child=win(['.note-editable']);assert.equal(safeToRefresh(win([],[{contentWindow:child}]),0),true,'clean retained reader does not block');child.inboxNavigationEditorTouched=true;assert.equal(safeToRefresh(win([],[{contentWindow:child}]),0),false,'touched retained reader stays safe');
 const clean=win();assert.equal(safeToRefresh(clean,0),true);assert.equal(safeToRefresh(clean,1),false);
 clean.fs_reply_changed=true;assert.equal(safeToRefresh(clean,0),false);
});
test('focused search/filter input defers; ordinary unfocused inbox remains safe',()=>{const w=win();w.document.activeElement={tagName:'INPUT'};assert.equal(safeToRefresh(w,0),false);w.document.activeElement={tagName:'A'};assert.equal(safeToRefresh(w,0),true);});
test('native refresh deferral is retried even without a new importer receipt',async()=>{const h=setup();h.setSafe(false);h.monitor.invalidate();await h.monitor.poll();assert.equal(h.refreshes.length,0);h.setSafe(true);await h.monitor.poll();assert.equal(h.refreshes.length,1);assert.equal(h.monitor.state().baseline,'1');});
test('stalled receipt or body times out, releases monitor and retries after backoff',async()=>{
 const {createTransport}=exported.exports;
 let timeout,aborted=false,stalled=true;
 class Controller {signal={};abort(){aborted=true;}}
 const transport=createTransport({AbortController:Controller,later(fn){timeout=fn;return 1;},cancel(){},fetch:()=>stalled?new Promise(()=>{}):Promise.resolve({status:'success',mailbox_id:1,version:'1'})});
 const h=setup({fetch:()=>transport.read('/receipt',{},value=>value)});
 const first=h.monitor.poll();await new Promise(setImmediate);assert.equal(h.monitor.state().active,true);
 timeout();await first;assert.equal(aborted,true);assert.equal(h.monitor.state().active,false);assert.equal(h.scheduled.at(-1),2000);
 stalled=false;await h.monitor.poll();assert.equal(h.scheduled.at(-1),1000);
});
test('pagehide/hidden transport abort settles even if fetch never rejects and ignores late results',async()=>{
 const {createTransport}=exported.exports;let finish,aborted=0;
 class Controller {signal={};abort(){aborted++;}}
 const transport=createTransport({AbortController:Controller,later(){return 1;},cancel(){},fetch:()=>new Promise(r=>finish=r)});
 const pending=transport.read('/inbox',{},value=>value);await new Promise(setImmediate);transport.abort();await assert.rejects(pending,/cancelled/);assert.equal(aborted,1);finish('late');transport.abort();assert.equal(aborted,1);
});
test('table context includes page, sorting, filters and parameters with stable key order',()=>{
 const {tableContext,sameContext}=exported.exports;
 const a=tableContext({dataset:{page:'2',sorting_order:'asc',param_user_id:'59',filter_customer_id:'12',sorting_sort_by:'subject'}});
 const b=tableContext({dataset:{filter_customer_id:'12',param_user_id:'59',sorting_sort_by:'subject',sorting_order:'asc',page:'2'}});
 assert.equal(a.page,'2');assert.equal(a.sorting.sort_by,'subject');assert.equal(a.sorting.order,'asc');assert.equal(a.filter.customer_id,'12');assert.equal(a.params.user_id,'59');assert.equal(sameContext(a,b),true);
 b.sorting.order='desc';assert.equal(sameContext(a,b),false);
});
test('pointer and keyboard gestures invalidate old responses and require 350ms quiet',()=>{
 const {createInteraction}=exported.exports;let now=0;const gesture=createInteraction(()=>now),before=gesture.epoch();
 gesture.start('p1');assert.equal(gesture.safe(),false);assert.notEqual(gesture.epoch(),before);
 gesture.end('p1');assert.equal(gesture.safe(),false);now=349;assert.equal(gesture.safe(),false);now=350;assert.equal(gesture.safe(),true);
 gesture.start('kEnter');assert.equal(gesture.safe(),false);gesture.clear();now=700;assert.equal(gesture.safe(),true);
});
test('snapshot failures back off despite successful receipt polls and retain pending receipt',async()=>{
 let fail=true;const h=setup({refresh:()=>fail?Promise.reject(Error('snapshot failed')):true});
 h.setResponse({status:'success',mailbox_id:1,version:'2'});
 await h.monitor.poll();assert.equal(h.scheduled.at(-1),2000);assert.equal(h.monitor.state().baseline,'1');
 await h.monitor.poll();assert.equal(h.scheduled.at(-1),4000);assert.equal(h.monitor.state().baseline,'1');
 fail=false;await h.monitor.poll();assert.equal(h.scheduled.at(-1),1000);assert.equal(h.monitor.state().baseline,'2');
});
test('shared child locks also hold native refresh queue and duplicate end cannot decrement twice',()=>{
 const {bridgeCoordinator}=exported.exports;const busy=new Set();let activity=0,pending=0;
 const c={begin(id){if(busy.has(Number(id)))return false;busy.add(Number(id));return true;},end(id){busy.delete(Number(id));},activity(n){activity+=n;}};
 bridgeCoordinator(c,()=>pending++,()=>pending--);
 assert.equal(c.begin('42'),true);assert.equal(c.begin(42),false);assert.equal(activity,1);assert.equal(pending,1);
 c.end(42);c.end('42');assert.equal(activity,0);assert.equal(pending,0);
 // An independent native row close still accounts for its own queue activity.
 c.activity(1);assert.equal(c.begin(43),true);assert.equal(activity,2);c.end(43);c.activity(-1);assert.equal(activity,0);
});
test('shared lock end releases native refresh queue even if native end throws',()=>{
 const {bridgeCoordinator}=exported.exports;let activity=0,pending=0;
 const c={begin(){return true;},end(){throw Error('native end failed');},activity(n){activity+=n;}};
 bridgeCoordinator(c,()=>pending++,()=>pending--);c.begin(42);assert.throws(()=>c.end(42),/native end failed/);assert.equal(activity,0);assert.equal(pending,0);
});
