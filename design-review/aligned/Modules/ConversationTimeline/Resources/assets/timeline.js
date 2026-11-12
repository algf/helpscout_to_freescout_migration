(function () {
 'use strict';
 function start() {
  var root=document.getElementById('conv-layout-main');
  // New Conversation reuses #conv-layout-main but has no threads, so conversation.before_threads never prints the toolbar.
  if(!root||root.dataset.ctActive||!root.querySelector('.ct-toolbar'))return;
  root.dataset.ctActive='true';root.classList.add('ct-timeline');
  var latest=null,scheduled=false,expandedAll=false;
  function rows(){return Array.from(root.children).filter(function(e){return e.classList.contains('thread')&&e.querySelector('.ct-metadata');});}
  function setOpen(row,open){
   if(!row.dataset.ctReady)return;
   row.classList.toggle('ct-collapsed',!open);row.classList.toggle('ct-expanded',open);
   var button=row.querySelector('.ct-summary');if(!button)return;
   button.setAttribute('aria-expanded',String(open));
   button.setAttribute('aria-label',(open?'Collapse ':'Expand ')+row.dataset.ctDescription+(!open&&row.dataset.ctPreview?'. '+row.dataset.ctPreview:''));
   button.querySelector('.ct-summary-text').textContent=open?'Collapse message':row.dataset.ctPreview;
  }
  function prepare(row){
   if(row.dataset.ctReady)return;
   var body=row.querySelector('.thread-body'),header=row.querySelector('.thread-header');
   if(!body||!header||row.classList.contains('thread-type-draft'))return;
   var content=body.querySelector('.thread-content')||body;
   var clone=content.cloneNode(true);
   clone.querySelectorAll('script,style,.thread-attachments,.thread-meta').forEach(function(e){e.remove();});
   var withQuotes=clone.cloneNode(true);
   clone.querySelectorAll('blockquote').forEach(function(e){e.remove();});
   clone.querySelectorAll('br').forEach(function(e){e.replaceWith(document.createTextNode(' '));});
   clone.querySelectorAll('p,div,li').forEach(function(e){e.appendChild(document.createTextNode(' '));});
   var preview=(clone.textContent||'').replace(/\s+/g,' ').trim();
   // A forwarded email may consist entirely of quoted text. Use it when
   // there is no new text instead of falsely calling the message empty.
   if(!preview)preview=(withQuotes.textContent||'').replace(/\s+/g,' ').trim();
   row.dataset.ctPreview=preview.slice(0,200)||(body.querySelector('.thread-attachments a,.attachment')?'Attachment':'Empty message');
   row.dataset.ctActivity=/^Imported Help Scout activity\b/.test(preview)?'true':'false';
   var button=document.createElement('button');button.type='button';button.className='ct-summary';
   var chevron=document.createElement('span');chevron.className='ct-chevron';chevron.setAttribute('aria-hidden','true');
   var icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
   icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','12');icon.setAttribute('height','12');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','2');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('focusable','false');
   var path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m9 18 6-6-6-6');icon.appendChild(path);chevron.appendChild(icon);
   var author=header.querySelector('.thread-person strong')||header.querySelector('.thread-person');
   var date=header.querySelector('.thread-date');
   var sender=document.createElement('span');sender.className='ct-summary-sender';
   sender.textContent=(author&&author.textContent.trim())||(row.classList.contains('thread-type-note')?'Unknown author':'Unknown sender');
   if(row.classList.contains('thread-type-note'))sender.textContent+=' · Note';
   var time=document.createElement('span');time.className='ct-summary-time';
   time.textContent=date?date.textContent.trim():'';if(date&&date.title)time.title=date.title;
   row.dataset.ctDescription=(row.classList.contains('thread-type-note')?'note':'message')+' from '+sender.textContent+(time.textContent?', '+time.textContent:'');
   var label=document.createElement('span');label.className='ct-summary-text';
   button.append(chevron,sender,time,label);body.id=body.id||row.id+'-body';button.setAttribute('aria-controls',body.id);
   button.addEventListener('click',function(){setOpen(row,button.getAttribute('aria-expanded')!=='true');});
   header.insertAdjacentElement('afterend',button);row.dataset.ctReady='true';setOpen(row,false);
  }
  function refresh(){
   scheduled=false;var list=rows();if(!list.length)return;
   list.forEach(prepare);
   var sorted=list.slice().sort(function(a,b){var x=a.querySelector('.ct-metadata').dataset,y=b.querySelector('.ct-metadata').dataset;return Number(x.time)-Number(y.time)||Number(x.id)-Number(y.id);});
   if(list.some(function(row,i){return row!==sorted[i];}))sorted.forEach(function(row){root.appendChild(row);});
   var messages=sorted.filter(function(row){return row.dataset.ctReady&&row.dataset.ctActivity!=='true';});
   var newest=messages[messages.length-1];
   if(newest&&newest!==latest){if(latest&&!expandedAll)setOpen(latest,false);latest=newest;setOpen(latest,true);}
   if(expandedAll)sorted.forEach(function(row){if(row.dataset.ctReady)setOpen(row,true);});
  }
  root.querySelector('.ct-expand-all').addEventListener('click',function(){expandedAll=true;rows().forEach(function(row){setOpen(row,true);});});
  root.querySelector('.ct-latest').addEventListener('click',function(){expandedAll=false;rows().forEach(function(row){setOpen(row,row===latest);});if(latest)latest.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
  function revealHash(){var id=location.hash.slice(1);if(!/^thread-\d+$/.test(id))return;var row=document.getElementById(id);if(row&&root.contains(row)){setOpen(row,true);row.scrollIntoView({block:'start'});}}
  var initialY=window.scrollY,interacted=false;
  function cancelInitial(){interacted=true;}
  window.addEventListener('wheel',cancelInitial,{once:true,passive:true});
  window.addEventListener('touchstart',cancelInitial,{once:true,passive:true});
  window.addEventListener('keydown',cancelInitial,{once:true});
  refresh();revealHash();window.addEventListener('hashchange',revealHash);
  var settleFrames=0,stableFrames=0,previousLayout='';
  function positionInitial(){
   var navigation=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];
   if(!latest||location.hash||initialY||window.scrollY||interacted||(navigation&&navigation.type==='back_forward')||root.querySelector('.thread-type-draft')||window.fs_reply_changed||window.fs_processing_save_draft||window.fs_processing_send_reply||(window.fs_editor_change_timeout&&window.fs_editor_change_timeout!==-1))return;
   if(document.activeElement&&document.activeElement.matches('input,textarea,[contenteditable="true"]'))return;
   // Native editor and theme enhancement finish after the first frame. Wait for
   // a bounded stable layout before the single initial scroll, never after interaction.
   var toolbar=document.getElementById('conv-toolbar'),heading=document.getElementById('conv-subject');
   var layout=[document.documentElement.scrollHeight,Math.round(latest.getBoundingClientRect().top),toolbar&&Math.round(toolbar.getBoundingClientRect().height),heading&&Math.round(heading.getBoundingClientRect().height)].join(':');
   stableFrames=layout===previousLayout?stableFrames+1:0;previousLayout=layout;settleFrames++;
   if(stableFrames<2){if(settleFrames<6)requestAnimationFrame(positionInitial);return;}
   // Align just below the persistent controls; never move focus away from the user's control.
   latest.scrollIntoView({block:'start',behavior:'instant'});
  }
  requestAnimationFrame(positionInitial);
  new MutationObserver(function(changes){if(changes.some(function(c){return Array.from(c.addedNodes).some(function(n){return n.nodeType===1&&(n.classList.contains('thread')||n.querySelector('.thread'));});})&&!scheduled){scheduled=true;requestAnimationFrame(refresh);}}).observe(root,{childList:true,subtree:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
