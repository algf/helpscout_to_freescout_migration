const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../modules/InboxNavigation/navigation.js'),'utf8');
function timers(){
 let now=0,sequence=0;const pending=new Map();
 return {now:()=>now,setTimeout(fn,delay=0){const id=++sequence;pending.set(id,{fn,at:now+delay});return id},clearTimeout(id){pending.delete(id)},advance(ms){const end=now+ms;let count=0;for(;;){const next=[...pending].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;if(++count>10000)throw Error('Unbounded mocked timer loop');now=next[1].at;pending.delete(next[0]);next[1].fn()}now=end;}};
}
function harness(options={}){
 const events={},elements=[],clock=timers();let document;
 function element(){const attributes={},listeners={};return {hidden:false,isConnected:true,dataset:{},style:{},classList:{add(){}},setAttribute(name,value){attributes[name]=String(value)},getAttribute(name){return attributes[name]??null},hasAttribute(name){return name in attributes},removeAttribute(name){delete attributes[name]},append(...items){elements.push(...items)},addEventListener(type,fn){(listeners[type]??=[]).push(fn);this[type]=()=>this.dispatch(type)},dispatch(type,event={}){for(const fn of listeners[type]||[])fn(event)},focus(){if(document)document.activeElement=this},remove(){this.removed=true;this.isConnected=false}};}
 const table=element(),app=element();
 document={title:'Inbox',documentElement:element(),body:element(),head:element(),createElement:element,getElementById(id){return id==='app'?app:null},querySelector(s){return s==='.table-conversations'?table:null},querySelectorAll(){return []},addEventListener(){},...options.document};
 const window={document,location:{href:'https://mail.test/mailbox/1',origin:'https://mail.test'},history:{pushState(){window.pushed=true},back(){if(events.popstate)events.popstate()}},setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,HTMLScriptElement:{supports(){return false}},addEventListener(n,f){events[n]=f},...options.window};window.parent=window;
 vm.runInNewContext(source,{window,URL,URLSearchParams,Date:{now:clock.now},CustomEvent:function(){},setTimeout:clock.setTimeout});
 return {window,doc:document,elements,app,clock,element};
}
function connect(h,id,options={}){
 const frame=h.elements.filter(e=>e.src&&!e.removed).at(-1),listeners={},handlers={},ready=[];
 const childDoc={readyState:'interactive',body:{dataset:{conversation_id:String(id)}},documentElement:h.element(),querySelector(s){if(s==='#conv-layout')return {};if(s==='.unsub-review'&&options.unsub)return {};return null},querySelectorAll(){return []},addEventListener(n,f){listeners[n]=f}};
 const win=Object.assign(options.win||{},{location:{href:`https://mail.test/conversation/${id}?folder_id=1`},document:childDoc,addEventListener(n,f){listeners[n]=f},laroute:{route(){return '/ajax'}},jQuery(value){if(typeof value==='function')ready.push(value);else return {on(name,fn){handlers[name]=fn}}},fsAjax(_data,_route,ok){win.respond=ok;win.success=ok}});
 frame.contentWindow=win;h.window.inboxNavigation.connected(win);
 function flushReady(){while(ready.length)ready.shift()();h.clock.advance(0)}
 if(options.ready!==false)flushReady();
 return {win,child:win,frame,listeners,handlers,flushReady};
}
module.exports={harness,connect,timers};
