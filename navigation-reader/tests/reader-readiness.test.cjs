const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {harness,connect}=require('./reader-harness.cjs');
function close(h){return h.elements.find(e=>e.className==='inbox-reader-close-next')}
function status(h){return h.elements.find(e=>e.className==='inbox-reader-status')}
test('pending document stays inert and outside focus while recovery controls stay available',()=>{
 const h=harness();let writes=0;h.window.crockdQuickClose={begin(){writes++;return true},end(){},activity(){},changed(){}};
 h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42,{ready:false});
 assert.equal(a.frame.dataset.inboxNavigationReady,'pending');assert.equal(a.frame.inert,true);
 assert.equal(a.frame.getAttribute('aria-hidden'),'true');assert.equal(a.frame.getAttribute('aria-busy'),'true');
 assert.equal(close(h).disabled,true);close(h).onclick();assert.equal(writes,0);
 assert.equal(status(h).textContent,'Opening conversation…');assert.equal(a.frame.hidden,false,'pending is distinct from retained inactive frames');
 const back=h.elements.find(e=>e.textContent==='Back to inbox'),full=h.elements.find(e=>e.textContent==='Full page');
 assert.equal(back.disabled,undefined);assert.equal(full.href,'https://mail.test/conversation/42');
 let prevented=false;back.dispatch('keydown',{key:'Tab',shiftKey:true,preventDefault(){prevented=true}});
 assert.equal(prevented,true);assert.equal(h.doc.activeElement,full,'reverse Tab skips the pending child');
 const css=fs.readFileSync(path.join(__dirname,'../modules/InboxNavigation/navigation.css'),'utf8');
 assert.match(css,/iframe\[data-inbox-navigation-ready\]:not\(\[data-inbox-navigation-ready="ready"\]\)\s*\{[^}]*visibility:hidden;[^}]*pointer-events:none;/);
});
test('native ready queue and UnSub marker both precede a single release',()=>{
 const h=harness();let reads=0;h.window.inboxNavigationReadState=()=>reads++;
 h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42,{ready:false,unsub:true});
 a.flushReady();assert.equal(a.frame.dataset.inboxNavigationReady,'pending');assert.equal(reads,0);
 a.win.document.documentElement.dataset.unsubReady='1';h.clock.advance(25);
 assert.equal(a.frame.dataset.inboxNavigationReady,'ready');assert.equal(a.frame.inert,false);
 assert.equal(a.frame.getAttribute('aria-hidden'),null);assert.equal(a.frame.getAttribute('aria-busy'),null);
 assert.equal(a.win.document.documentElement.dataset.inboxNavigationBridge,'ready');assert.equal(close(h).disabled,false);assert.equal(status(h).textContent,'');assert.equal(reads,1);
 a.flushReady();h.clock.advance(15000);assert.equal(reads,1);assert.equal(a.frame.dataset.inboxNavigationReady,'ready');
});
test('pagehide gates the reused WindowProxy and an old document callback cannot release its successor',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');const old=connect(h,42,{ready:false});
 const oldDoc=old.win.document;old.listeners.pagehide();
 const fresh=connect(h,43,{ready:false,win:old.win});assert.equal(fresh.win,old.win);assert.notEqual(fresh.win.document,oldDoc);
 old.flushReady();assert.equal(fresh.frame.dataset.inboxNavigationReady,'pending');assert.equal(close(h).disabled,true);assert.equal(fresh.win.document.documentElement.dataset.inboxNavigationBridge,undefined);
 fresh.flushReady();assert.equal(fresh.frame.dataset.inboxNavigationReady,'ready');assert.equal(fresh.win.document.body.dataset.conversation_id,'43');
});
test('failure timeout stays gated, ignores late ready and supports Back then fresh reopen',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');const old=connect(h,42,{ready:false});
 h.clock.advance(15000);assert.equal(old.frame.dataset.inboxNavigationReady,'failed');assert.equal(old.frame.inert,true);assert.equal(close(h).disabled,true);
 assert.match(status(h).textContent,/Full page or Back to inbox/);old.flushReady();assert.equal(old.frame.dataset.inboxNavigationReady,'failed');
 h.window.inboxNavigation.back();assert.equal(h.app.inert,false);assert.equal(old.frame.removed,true);
 h.window.inboxNavigation.open('/conversation/42');const fresh=connect(h,42);assert.notEqual(fresh.frame,old.frame);assert.equal(fresh.frame.dataset.inboxNavigationReady,'ready');
});
test('initial mismatched identity fails closed without enabling native actions',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');const wrong=connect(h,43);
 assert.equal(wrong.frame.dataset.inboxNavigationReady,'failed');assert.equal(wrong.frame.inert,true);assert.equal(close(h).disabled,true);
 assert.equal(wrong.win.document.documentElement.dataset.inboxNavigationBridge,undefined);assert.match(status(h).textContent,/Full page/);
});
test('Back while callbacks are queued cannot expose or replace the fresh reader',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');const old=connect(h,42,{ready:false});h.window.inboxNavigation.back();
 h.window.inboxNavigation.open('/conversation/99');const fresh=connect(h,99,{ready:false});old.flushReady();
 assert.equal(old.frame.removed,true);assert.equal(fresh.frame.dataset.inboxNavigationReady,'pending');assert.equal(close(h).disabled,true);
 fresh.flushReady();assert.equal(fresh.frame.dataset.inboxNavigationReady,'ready');assert.equal(fresh.win.document.body.dataset.conversation_id,'99');
});
