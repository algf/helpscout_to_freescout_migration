(function (root) {
    'use strict';
    var doc = root.document;
    if (!doc || doc.documentElement.dataset.inboxNavigation) return;
    doc.documentElement.dataset.inboxNavigation = 'ready';
    function conversationUrl(value) {
        try { var u = new URL(value, root.location.href); return u.origin === root.location.origin && /^\/conversation\/\d+$/.test(u.pathname) ? u : null; } catch (_) { return null; }
    }
    // A real opened document keeps all native composer, permission and action code.
    // No hidden conversation is loaded in advance: that would mark it as viewed.
    if (root.parent !== root) {
        try {
            if (root.parent.inboxNavigation && root.frameElement && root.frameElement.hasAttribute('data-inbox-navigation-frame')) {
                doc.documentElement.classList.add('inbox-reader-child');
                root.parent.inboxNavigation.connected(root);
            }
        } catch (_) { /* ordinary embedded views keep native behaviour */ }
        return;
    }
    if (!doc.querySelector('.table-conversations')) return;
    var app = doc.getElementById('app'), pane, frame, back, next, full, status;
    var opened = false, owner, currentId, returnFocus, baseTitle, changed = false, closing = false;
    var draftFrames = [], readerHistory = false;
    function pruneDrafts() { draftFrames = draftFrames.filter(function(item) { if(shouldRetain(item.owner)) return true; item.frame.remove(); return false; }); }
    function message(text) { status.textContent = text || ''; }
    function invalidateWarm(settings) {
        var warm=doc.getElementById('inbox-navigation-prefetch');if(warm)warm.remove();
        // Existing InboxSpeed owns other speculative entries; invalidate those too.
        if(root.jQuery) root.jQuery(doc).trigger('ajaxSend',[{},settings||{type:'POST',url:'/conversation/ajax',data:'action=conversation_change_status'}]);
    }
    function isBusy(win) {
        try { return !!(win.fs_reply_changed || (win.fs_editor_change_timeout && win.fs_editor_change_timeout !== -1) || win.fs_processing_save_draft || win.fs_processing_send_reply || win.upload_in_progress || win.document.querySelector('.unsub-review.is-busy, .mailbox-one-click-close[aria-busy="true"]') || win.inboxNavigationPendingWrites); }
        catch (_) { return true; }
    }
    function shouldRetain(win) {
        if(isBusy(win))return true;
        try {
            // Retention is distinct from write activity. A saved open editor still
            // holds reply mode, recipients, selection and attachments in its document.
            var editor=win.document.querySelector('.note-editable');
            return !!(editor && editor.getClientRects().length);
        } catch(_) {return true;}
    }
    function ensurePane() {
        if (pane) return;
        pane = doc.createElement('section'); pane.className = 'inbox-reader'; pane.hidden = true;
        pane.setAttribute('role','dialog'); pane.setAttribute('aria-modal','true'); pane.setAttribute('aria-label','Read conversation');
        var bar = doc.createElement('div'); bar.className = 'inbox-reader-bar';
        back = doc.createElement('button'); back.type = 'button'; back.textContent = 'Back to inbox'; back.onclick = hide;
        full = doc.createElement('a'); full.className = 'inbox-reader-full'; full.textContent = 'Full page'; full.target = '_blank'; full.rel = 'noopener';
        next = doc.createElement('button'); next.type = 'button'; next.className = 'inbox-reader-close-next'; next.textContent = 'Close and next'; next.onclick = closeNext; next.disabled = true;
        bar.append(back, full, next); status = doc.createElement('div'); status.className = 'inbox-reader-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
        pane.append(bar,status); doc.body.append(pane);
        pane.addEventListener('keydown', function(e) { if (e.key === 'Escape') { e.preventDefault(); hide(); } });
        back.addEventListener('keydown',function(e){ if(e.key==='Tab'&&e.shiftKey){e.preventDefault();if(frame&&frame.dataset.inboxNavigationReady==='ready')frame.focus();else full.focus();} });
    }
    function rows() { return Array.from(doc.querySelectorAll('tr.conv-row')).filter(function(r){return r.style.display!=='none' && !r.hasAttribute('data-quick-close-hidden');}); }
    function rowFor(id) { return rows().find(function(r){return String(r.dataset.conversation_id)===String(id);}); }
    function rowUrl(row) { var a=row&&row.querySelector('td.conv-subject a[href]'); return a&&conversationUrl(a.href); }
    function open(url, trigger) {
        var u=conversationUrl(url); if(!u) return;
        if(closing) { message('Wait for the current close action to finish.'); return; }
        pruneDrafts();
        ensurePane();
        var id=u.pathname.split('/').pop();
        // Retain an unsaved native composer rather than destroying its document.
        if(frame && String(currentId)!==id) {
            if(owner && shouldRetain(owner)) {
                if(draftFrames.length>=3) { message('Finish or close an open editor before opening another conversation.'); return; }
                frame.hidden=true; draftFrames.push({id:String(currentId),frame:frame,owner:owner});
            } else frame.remove();
            frame=null;owner=null;
        }
        currentId=id; full.href=u.href;
        if(!opened) { baseTitle=doc.title;returnFocus=trigger||returnFocus;app.inert=true;app.setAttribute('aria-hidden','true');pane.hidden=false;opened=true;back.focus();
            if(!readerHistory) { root.history.pushState({inboxNavigationReader:true},'',root.location.href); readerHistory=true; } }
        var retained=draftFrames.find(function(item){return item.id===id;});
        if(retained&&retained.invalidated) { message('The previous action is still finishing. Return to the inbox and reopen this conversation shortly.');next.disabled=true;return; }
        if(retained) { draftFrames=draftFrames.filter(function(item){return item!==retained;});frame=retained.frame;owner=retained.owner;frame.hidden=false;connected(owner);return; }
        if(frame) { frame.hidden=false;next.disabled=frame.dataset.inboxNavigationReady!=='ready';message(next.disabled?'Opening conversation…':'');if(frame.dataset.inboxNavigationReady==='failed')failFrame(frame,frame.inboxNavigationReadiness);else if(owner)connected(owner);return; }
        next.disabled=true;message('Opening conversation…');
        frame=doc.createElement('iframe');frame.setAttribute('data-inbox-navigation-frame','');frame.title='Conversation';holdFrame(frame,id);frame.src=u.href; pane.append(frame);
        var createdFrame=frame;
        frame.addEventListener('load',function(){
            if(frame!==createdFrame) {
                var retained=draftFrames.find(function(item){return item.frame===createdFrame;});
                if(retained) {try {if(!conversationUrl(createdFrame.contentWindow.location.href))retained.invalidated=true;}catch(_){retained.invalidated=true;}}
                return;
            }
            try {
                var win=createdFrame.contentWindow;
                if(/^\/mailbox\//.test(win.location.pathname)) { changed=true;hide();return; }
                if(!win.document.querySelector('#conv-layout')) { failFrame(createdFrame,createdFrame.inboxNavigationReadiness);return; }
                connected(win);
            } catch(_){failFrame(createdFrame,createdFrame.inboxNavigationReadiness);}
        });
    }
    function hide(fromHistory) {
        if(!opened)return;
        if(fromHistory!==true && readerHistory) {
            // Dismiss now even if native iframe navigation added child history.
            hide(true); root.history.back(); return;
        }
        readerHistory=false;
        pane.hidden=true;opened=false;app.inert=false;app.removeAttribute('aria-hidden');doc.title=baseTitle;
        if(returnFocus&&returnFocus.isConnected) returnFocus.focus({preventScroll:true});
        if(changed&&root.crockdQuickClose){root.crockdQuickClose.changed();changed=false;}
        // Keep only a busy composer mounted; a clean document must be read fresh on reopen.
        if(frame && !closing && (!owner || !shouldRetain(owner))) { frame.remove(); frame=null;owner=null; }
        pruneDrafts();
    }
    // Visibility and focus follow native action readiness, not progressively rendered HTML.
    // Keep [hidden] exclusively for inactive retained documents.
    function holdFrame(target, expectedId) {
        var previous=target.inboxNavigationReadiness;
        if(previous) {root.clearTimeout(previous.timer);root.clearTimeout(previous.poll);}
        var state={expectedId:expectedId,document:null,queued:false,nativeReady:false};
        target.inboxNavigationReadiness=state;
        target.dataset.inboxNavigationReady='pending';target.inert=true;
        target.setAttribute('aria-hidden','true');target.setAttribute('aria-busy','true');
        if(target===frame) {next.disabled=true;message('Opening conversation…');if(doc.activeElement===target)back.focus();}
        state.timer=root.setTimeout(function(){failFrame(target,state);},15000);
        return state;
    }
    function failFrame(target,state) {
        if(!state||target.inboxNavigationReadiness!==state||target.dataset.inboxNavigationReady==='ready')return;
        root.clearTimeout(state.timer);root.clearTimeout(state.poll);state.failed=true;
        target.dataset.inboxNavigationReady='failed';target.removeAttribute('aria-busy');
        if(target===frame) {next.disabled=true;message('This conversation could not open here. Use Full page or Back to inbox.');}
    }
    function connected(win) {
        if(!frame||win!==frame.contentWindow)return;
        var target=frame,childDoc;
        try {childDoc=win.document;}catch(_){failFrame(target,target.inboxNavigationReadiness);return;}
        var state=target.inboxNavigationReadiness;
        if(!state||state.document&&state.document!==childDoc)state=holdFrame(target,null);
        if(state.failed){failFrame(target,state);return;}
        if(target.dataset.inboxNavigationReady==='ready') {connectReady(win);return;}
        if(state.document===childDoc)return;
        state.document=childDoc;
        // A native navigation reuses the WindowProxy. Document and state identity
        // prevent its old ready callback from releasing the new document.
        win.addEventListener('pagehide',function(){
            if(target.inboxNavigationReadiness!==state)return;
            holdFrame(target,null);
            if(target===frame)owner=null;
        },{once:true});
        function check() {
            if(state.failed||target.inboxNavigationReadiness!==state||!target.isConnected)return;
            try {
                if(win.document!==childDoc)return;
                var activeUrl=conversationUrl(win.location.href),id=activeUrl&&activeUrl.pathname.split('/').pop();
                if(childDoc.readyState!=='loading'&&(!activeUrl||!childDoc.querySelector('#conv-layout')||String(childDoc.body.dataset.conversation_id)!==id||state.expectedId&&String(state.expectedId)!==id)) {failFrame(target,state);return;}
                if(!state.queued&&win.jQuery) {
                    state.queued=true;
                    win.jQuery(function(){state.nativeReady=true;root.clearTimeout(state.poll);state.poll=root.setTimeout(check,0);});
                }
                if(childDoc.readyState!=='loading'&&state.nativeReady&&(!childDoc.querySelector('.unsub-review')||childDoc.documentElement.dataset.unsubReady==='1')) {
                    if(target!==frame)return;
                    connectReady(win);
                    if(target!==frame||win.document!==childDoc||target.inboxNavigationReadiness!==state)return;
                    root.clearTimeout(state.timer);root.clearTimeout(state.poll);
                    target.dataset.inboxNavigationReady='ready';target.inert=false;
                    target.removeAttribute('aria-hidden');target.removeAttribute('aria-busy');
                    return;
                }
                state.poll=root.setTimeout(check,25);
            }catch(_){failFrame(target,state);}
        }
        check();
    }
    function connectReady(win) {
        if(!frame||win!==frame.contentWindow)return;
        try {
            var navigation=win.performance&&win.performance.getEntriesByType('navigation')[0];
            if(opened&&navigation&&navigation.type==='back_forward'){hide(true);return;}
        }catch(_){}
        owner=win;var activeUrl=conversationUrl(win.location.href);
        if(!activeUrl){next.disabled=true;return;}
        currentId=activeUrl.pathname.split('/').pop();full.href=activeUrl.href;
        win.document.documentElement.classList.add('inbox-reader-child');
        if(!win.document.querySelector('#conv-layout'))return;
        if(root.inboxNavigationReadState)root.inboxNavigationReadState(win.document);
        next.disabled=false;message('');
        if(win.document.documentElement.dataset.inboxNavigationBridge)return;
        win.document.documentElement.dataset.inboxNavigationBridge='ready';
        win.addEventListener&&win.addEventListener('popstate',function(){if(opened&&owner===win)hide(true);});
        win.addEventListener&&win.addEventListener('pageshow',function(e){if(e.persisted&&opened&&owner===win)hide(true);});
        win.document.addEventListener('input',function(e){if(e.target.closest&&e.target.closest('.note-editable'))win.inboxNavigationEditorTouched=true;},true);
        var childList=win.crockdQuickClose,parentList=root.crockdQuickClose;
        if(childList&&parentList){childList.begin=parentList.begin;childList.end=parentList.end;}
        if(parentList&&win.fsAjax&&!win.inboxNavigationOriginalAjax) {
            var originalAjax=win.fsAjax;
            win.inboxNavigationOriginalAjax=originalAjax;
            win.fsAjax=function(data,url,success,loader,error) {
                var parsed=typeof data==='string'?new URLSearchParams(data):null;
                var action=parsed?parsed.get('action'):(data&&data.action);
                if(!data||!/^(conversation_change_status|conversation_change_user|send_reply)$/.test(action||''))return originalAjax.apply(this,arguments);
                var ownUrl=conversationUrl(win.location.href);
                var id=Number((parsed?parsed.get('conversation_id'):data.conversation_id)||(ownUrl&&ownUrl.pathname.split('/').pop()));
                if(!Number.isSafeInteger(id)||id<=0||!parentList.begin(id)){
                    var note='An action on this conversation is still running.';message(note);
                    if(success)success({status:'error',msg:note});else if(error)error();return;
                }
                win.inboxNavigationPendingWrites=(win.inboxNavigationPendingWrites||0)+1;
                var done=false;
                function release(){if(done)return;done=true;win.inboxNavigationPendingWrites--;parentList.end(id);}
                var args=Array.prototype.slice.call(arguments);
                args[2]=function(){release();if(success)return success.apply(this,arguments);};
                args[4]=function(){release();if(error)return error.apply(this,arguments);};
                try{return originalAjax.apply(this,args);}catch(e){release();throw e;}
            };
        }

        win.document.addEventListener('keydown',function(e){
            if(e.key==='Tab'&&!win.document.querySelector('.modal.in')) {
                var candidates=Array.from(win.document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(function(el){return !el.disabled&&el.tabIndex>=0&&el.getClientRects().length;});
                if(e.shiftKey&&(win.document.activeElement===candidates[0]||!candidates.length)){e.preventDefault();next.focus();return;}
                if(!e.shiftKey&&(win.document.activeElement===candidates[candidates.length-1]||!candidates.length)){e.preventDefault();back.focus();return;}
            }
            if(e.key==='Escape'&&!win.document.querySelector('.modal.in')){e.preventDefault();hide();}});
        win.document.addEventListener('click',function(e){
            var a=e.target.closest&&e.target.closest('.conv-next-prev a[href]');
            if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
            if(a){e.preventDefault();e.stopImmediatePropagation();open(a.href);return;}
            var other=e.target.closest&&e.target.closest('a[href]');
            if(other&&!other.target&&other.getAttribute('href').charAt(0)!=='#'&&isBusy(win)){e.preventDefault();e.stopImmediatePropagation();message('Save your draft or finish the current action before leaving this conversation.');}
        },true);
        if(win.jQuery) win.jQuery(win.document).on('ajaxSend.inboxNavigation',function(_e,_xhr,settings){if(settings.type==='POST'&&!/\/polycast\//.test(settings.url||''))invalidateWarm(settings);});
        if(win.jQuery) win.jQuery(win.document).on('ajaxSuccess.inboxNavigation',function(_e,_xhr,settings,data){
            if(settings.type!=='POST'||!data||data.status!=='success')return;
            var params=new URLSearchParams(typeof settings.data==='string'?settings.data:'');
            if(!/^(conversation_change_status|conversation_change_user|send_reply|save_draft|execute)$/.test(params.get('action')||''))return;
            changed=true;
            if(params.get('action')==='conversation_change_status'&&params.get('status')==='3') {
                var closedId=params.get('conversation_id');
                var r=rowFor(closedId);if(r&&parentList)parentList.hideRow(r);
                draftFrames=draftFrames.filter(function(item){if(item.id!==String(closedId))return true;if(isBusy(item.owner)){item.invalidated=true;return true;}item.frame.remove();return false;});
            }
            if(parentList)parentList.changed();
        });
    }
    function closeNext() {
        if(!owner||closing||next.disabled)return;
        if(isBusy(owner)){message('Finish saving your draft or current action before closing this conversation.');return;}
        var list=root.crockdQuickClose,id=Number(currentId),win=owner,closingFrame=frame;
        if(!list||!win.fsAjax||!win.laroute||!Number.isSafeInteger(id))return;
        if(win.fsApplyFilter&&!win.fsApplyFilter('conversation.can_change_status',true,{trigger:win.jQuery(next)}))return;
        if(!list.begin(id)){message('An action on this conversation is still running.');return;}
        var current=rowFor(id),all=rows(),index=all.indexOf(current),following=index<0?null:rowUrl(all[index+1]);
        invalidateWarm();closing=true;next.disabled=true;list.activity(1);message('Closing conversation…');
        var ended=false;function finish(){if(ended)return false;ended=true;closing=false;list.end(id);list.activity(-1);next.disabled=false;return true;}
        try {(win.inboxNavigationOriginalAjax||win.fsAjax).call(win,{action:'conversation_change_status',conversation_id:id,status:3,x_embed:1,folder_id:new URL(win.location.href).searchParams.get('folder_id')||''},win.laroute.route('conversations.ajax'),function(response){
            if(!finish())return;
            if(!response||response.status!=='success'){message(response&&response.msg||'Could not close this conversation.');return;}
            if(current)list.hideRow(current);list.changed();changed=true;
            // The write is confirmed before the next conversation becomes active.
            if(frame!==closingFrame||String(currentId)!==String(id))return;
            closingFrame.remove();frame=null;owner=null;
            if(opened&&following)open(following.href);else hide();
        },true,function(){if(finish())message('Close could not be confirmed. Refresh the inbox before trying again.');});}
        catch(_){if(finish())message('Close could not be confirmed. Refresh the inbox before trying again.');}
    }
    root.addEventListener('popstate',function(){if(opened)hide(true);readerHistory=false;});
    root.inboxNavigation={connected:connected,open:open,back:hide};
    doc.addEventListener('click',function(e){
        if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
        var a=e.target.closest&&e.target.closest('tr.conv-row td.conv-subject a[href],tr.conv-row td.conv-customer a[href]');
        if(!a||a.target||!conversationUrl(a.href))return;
        e.preventDefault();e.stopImmediatePropagation();open(a.href,a);
    },true);
})(window);
