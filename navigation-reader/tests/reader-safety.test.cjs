const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness,connect}=require('./reader-harness.cjs');
test('Back restores inbox and discards an unfinished ownerless document',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');
 assert.equal(h.app.inert,true);assert.equal(h.window.pushed,true);
 const frame=h.elements.find(e=>e.src);h.window.inboxNavigation.back();
 assert.equal(h.app.inert,false);assert.equal(frame.removed,true);
 h.window.inboxNavigation.open('/conversation/42');assert.notEqual(h.elements.filter(e=>e.src&&!e.removed).at(-1),frame);
});
test('late load from a discarded frame cannot inspect current frame',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');
 const old=h.elements.find(e=>e.src);h.window.inboxNavigation.open('/conversation/43');
 assert.equal(old.removed,true);assert.doesNotThrow(()=>old.load());
});
test('Back discards a clean reader so reopening reads a fresh document',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42);
 h.window.inboxNavigation.back();assert.equal(a.frame.removed,true);
 h.window.inboxNavigation.open('/conversation/42');assert.notEqual(h.elements.filter(e=>e.src).at(-1),a.frame);
});
test('Back and reopen preserve an unsaved native editor document',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42);a.win.fs_reply_changed=true;
 h.window.inboxNavigation.back();assert.equal(a.frame.removed,undefined);
 h.window.inboxNavigation.open('/conversation/42');assert.equal(h.elements.filter(e=>e.src).at(-1),a.frame);
});
test('pending close cannot replace or destroy another conversation',()=>{
 const h=harness();let beginId;
 h.window.crockdQuickClose={begin(id){beginId=id;return true},end(){},activity(){},changed(){}};
 h.window.inboxNavigation.open('/conversation/42');const initial=connect(h,42);initial.listeners.pagehide();const a=connect(h,43,{win:initial.win});
 const close=h.elements.find(e=>e.className==='inbox-reader-close-next');close.onclick();
 assert.equal(beginId,43,'close uses current native URL, not original row');
 h.window.inboxNavigation.back();h.window.inboxNavigation.open('/conversation/99');
 assert.equal(h.elements.filter(e=>e.src).length,1,'switching waits until close completes');
 a.win.respond({status:'success'});assert.equal(a.frame.removed,true);
 h.window.inboxNavigation.open('/conversation/99');assert.equal(h.elements.filter(e=>e.src).at(-1).src,'https://mail.test/conversation/99');
});
test('native child writes share the parent lock and release exactly once',()=>{
 const h=harness();const held=new Set();let releases=0;
 h.window.crockdQuickClose={begin(id){if(held.has(id))return false;held.add(id);return true},end(id){held.delete(id);releases++},activity(){},changed(){}};
 h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42);
 a.win.fsAjax({action:'conversation_change_status',conversation_id:42},'/ajax',()=>{});
 assert.equal(held.has(42),true);assert.equal(a.win.inboxNavigationPendingWrites,1);
 const first=a.win.respond;
 a.win.fsAjax({action:'conversation_change_user',conversation_id:42},'/ajax',()=>{});
 assert.equal(a.win.respond,first,'second write never reaches transport');
 first({status:'success'});first({status:'success'});
 assert.equal(releases,1);assert.equal(a.win.inboxNavigationPendingWrites,0);
});
test('readonly AJAX polling does not block close',()=>{
 const h=harness();let requested=false;
 h.window.crockdQuickClose={begin(){requested=true;return true},end(){},activity(){},changed(){}};
 h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42);
 a.win.jQuery={active:10};h.elements.find(e=>e.className==='inbox-reader-close-next').onclick();
 assert.equal(requested,true);
});

test('visible editor survives Back before native debounce flags update',()=>{
 const h=harness();h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42);
 const query=a.win.document.querySelector;const editor={getClientRects(){return [{}]},textContent:'Draft before debounce'};
 a.win.document.querySelector=s=>s==='.note-editable'?editor:query(s);
 h.window.inboxNavigation.back();assert.equal(a.frame.removed,undefined);
 h.window.inboxNavigation.open('/conversation/42');assert.equal(h.elements.filter(e=>e.src).at(-1),a.frame);
 assert.equal(a.win.document.querySelector('.note-editable').textContent,'Draft before debounce');
});
