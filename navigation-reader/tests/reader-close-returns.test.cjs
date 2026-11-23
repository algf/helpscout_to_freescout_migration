const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness,connect}=require('./reader-harness.cjs');
// Andrew, 21 Nov 2026: the reader's "Close and next" becomes "Close". After a confirmed close the reader returns to the
// inbox list it came from (no next conversation opens), and focus lands on the row that takes the closed row's place.
function inbox(ids){
 const focused=[];
 const rows=ids.map(id=>{const attrs={};const link={href:`https://mail.test/conversation/${id}?folder_id=1`,isConnected:true,focus(){focused.push(id)}};
  return {dataset:{conversation_id:String(id)},style:{},isConnected:true,hasAttribute(n){return n in attrs},setAttribute(n,v){attrs[n]=v},querySelector(s){return s==='td.conv-subject a[href]'?link:null}};});
 return {rows,focused,document:{querySelectorAll(s){return s==='tr.conv-row'?rows.filter(r=>r.style.display!=='none'):[]}}};
}
function reader(ids){
 const list=inbox(ids);const h=harness({document:list.document});const calls={hidden:[],changed:0,begin:[],end:[]};
 h.window.crockdQuickClose={begin(id){calls.begin.push(id);return true},end(id){calls.end.push(id)},activity(){},changed(){calls.changed++},hideRow(row){row.style.display='none';calls.hidden.push(row.dataset.conversation_id)}};
 return {h,list,calls,close:()=>h.elements.find(e=>e.className==='inbox-reader-close-next')};
}
test('the button reads Close and says where it goes',()=>{
 const {h,close}=reader([41,42,43]);h.window.inboxNavigation.open('/conversation/42');
 assert.equal(close().textContent,'Close');
 assert.equal(close().getAttribute('aria-label'),'Close conversation and return to the inbox');
});
test('confirmed Close returns to the inbox, opens no next conversation and focuses the next row',()=>{
 const {h,list,calls,close}=reader([41,42,43]);
 h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42);
 close().onclick();assert.deepEqual(calls.begin,[42]);
 assert.equal(h.app.inert,true,'reader stays until the server confirms');
 a.win.respond({status:'success'});
 assert.equal(h.app.inert,false,'back on the inbox list');
 assert.equal(a.frame.removed,true);
 assert.deepEqual(h.elements.filter(e=>e.src&&!e.removed),[],'no next conversation was opened');
 assert.deepEqual(calls.hidden,['42']);assert.ok(calls.changed>=1,'list refresh requested');
 assert.deepEqual(list.focused,[43]);assert.deepEqual(calls.end,[42]);
});
test('closing the last row focuses the row above it',()=>{
 const {h,list,close}=reader([41,42]);h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42);
 close().onclick();a.win.respond({status:'success'});assert.deepEqual(list.focused,[41]);
});
test('a refused close keeps the reader open on the same conversation with the reason',()=>{
 const {h,calls,close}=reader([41,42,43]);h.window.inboxNavigation.open('/conversation/42');const a=connect(h,42);
 close().onclick();a.win.respond({status:'error',msg:'Not enough permissions'});
 assert.equal(h.app.inert,true);assert.equal(a.frame.removed,undefined);assert.deepEqual(calls.hidden,[]);
 assert.equal(h.elements.find(e=>e.className==='inbox-reader-status').textContent,'Not enough permissions');
 assert.equal(close().disabled,false,'can try again');
});
