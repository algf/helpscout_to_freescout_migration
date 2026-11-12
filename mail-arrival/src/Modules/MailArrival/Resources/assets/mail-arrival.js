(function (root) {
    'use strict';
    function createMonitor(deps) {
        var baseline = deps.initialVersion, latest = baseline, receipt = null, timer, active = false, stopped = false, refreshing = false, failures = 0, forced = false;
        function schedule(delay) { deps.cancel(timer); if (!stopped && deps.visible()) timer = deps.later(poll, delay); }
        function attempt() {
            if (stopped || refreshing || (latest === baseline && !forced) || !deps.visible()) return Promise.resolve(false);
            if (!deps.safe()) { deps.notice('pending'); return Promise.resolve(false); }
            var requested = receipt || {status:'success',mailbox_id:deps.mailboxId,version:latest};
            forced = false;
            refreshing = true; deps.notice('refreshing');
            return Promise.resolve().then(function () { return deps.refresh(requested); }).then(function (applied) {
                if (applied) {baseline = requested.version;failures = 0;} else forced = true;
                deps.notice(latest === baseline && !forced ? 'clear' : 'pending');
                return !!applied;
            }).catch(function () { forced = true; failures = Math.min(5,failures+1); deps.notice('pending-error'); return false; }).then(function (applied) { refreshing = false; return applied; });
        }
        function poll() {
            if (stopped || active || !deps.visible()) return Promise.resolve();
            active = true;
            return Promise.resolve().then(deps.fetch).then(function (data) {
                if (stopped) return;
                if (!data || data.status !== 'success' || String(data.mailbox_id) !== String(deps.mailboxId) || typeof data.version !== 'string' || !data.version) throw new Error('Invalid receipt');
                latest = data.version; receipt = data;
                if (latest !== baseline || forced) { deps.notice('pending'); return attempt(); }
                else {failures = 0;deps.notice('clear');}
            }).catch(function () { failures = Math.min(5,failures+1); if (!stopped) deps.notice(latest !== baseline || forced ? 'pending-error' : 'error'); })
            .then(function () { active = false; schedule(Math.min(30000, 1000 * Math.pow(2, failures))); });
        }
        return {start: function () { stopped = false; schedule(0); }, poll: poll, attempt: attempt,
            invalidate: function () { forced = true; deps.notice('pending'); schedule(0); },
            visibility: function () { deps.cancel(timer); if (deps.visible()) { attempt(); schedule(0); } },
            stop: function () { stopped = true; deps.cancel(timer); },
            state: function () { return {active: active, stopped: stopped, baseline: baseline, latest: latest}; }};
    }
    function createTransport(deps) {
        var pending = new Set();
        function read(url, options, consume) {
            return new Promise(function (resolve, reject) {
                var controller = new deps.AbortController(), finished = false, timer;
                function done(error, value) {
                    if (finished) return;
                    finished = true; deps.cancel(timer); pending.delete(cancel);
                    if (error) reject(error); else resolve(value);
                }
                function cancel() { controller.abort(); done(new Error('Mail update request cancelled')); }
                pending.add(cancel);
                timer = deps.later(cancel, 8000);
                options.signal = controller.signal;
                Promise.resolve().then(function () { return deps.fetch(url, options); }).then(consume).then(function (value) { done(null, value); }, function (error) { done(error); });
            });
        }
        return {read: read, abort: function () { Array.from(pending).forEach(function (cancel) { cancel(); }); }};
    }
    function tableContext(table) {
        var result = {page:String(table.dataset.page || '1'),filter:{},params:{},sorting:{}};
        Object.keys(table.dataset).sort().forEach(function (key) {
            var match = /^(filter|param|sorting)_(.+)$/.exec(key);
            if (match) result[match[1] === 'param' ? 'params' : match[1]][match[2]] = String(table.dataset[key]);
        });
        return result;
    }
    function sameContext(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    function nativeContext(data, fallback) {
        var context = {page:String(data.page || fallback.page),filter:{},params:{},sorting:{}};
        ['filter','params','sorting'].forEach(function (group) { Object.keys(data[group] || {}).sort().forEach(function (key) { context[group][key] = String(data[group][key]); }); });
        return context;
    }
    function createInteraction(now) {
        var active = new Set(), epoch = 0, quietUntil = 0;
        return {start:function (id) { active.add(id);epoch++; },end:function (id) {active.delete(id);epoch++;quietUntil=now()+350;},clear:function () {active.clear();epoch++;quietUntil=now()+350;},safe:function () {return !active.size && now()>=quietUntil;},epoch:function () {return epoch;}};
    }
    function bridgeCoordinator(coordinator, onBegin, onEnd) {
        var begin = coordinator.begin, end = coordinator.end, owned = new Set();
        coordinator.begin = function (id) {
            var result = begin.apply(this, arguments), key = String(Number(id));
            if (result && !owned.has(key)) {
                owned.add(key); onBegin();
                try { coordinator.activity(1); } catch (error) { owned.delete(key);onEnd();end.call(this,id);throw error; }
            }
            return result;
        };
        coordinator.end = function (id) {
            var release = owned.delete(String(Number(id)));
            try { return end.apply(this, arguments); }
            finally { if (release) { onEnd();coordinator.activity(-1); } }
        };
    }
    function busyWindow(win) {
        try {
            return !!(win.fs_reply_changed || win.fs_processing_save_draft || win.fs_processing_send_reply || win.upload_in_progress || win.inboxNavigationPendingWrites || win.inboxNavigationEditorTouched ||
                (win.fs_editor_change_timeout && win.fs_editor_change_timeout !== -1) ||
                win.document.querySelector('.thread-type-draft, input.conv-checkbox:checked, tr.conv-row.selected, [aria-busy="true"], .unsub-review.is-busy, .modal.in'));
        } catch (_) { return true; }
    }
    function safeToRefresh(win, pendingWrites) {
        var doc = win.document;
        if (pendingWrites || busyWindow(win) || doc.querySelector('.inbox-reader:not([hidden])')) return false;
        var focus = doc.activeElement;
        if (focus && (focus.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(focus.tagName))) return false;
        return !Array.from(doc.querySelectorAll('iframe[data-inbox-navigation-frame]')).some(function (frame) { return busyWindow(frame.contentWindow); });
    }
    if (typeof module === 'object' && module.exports) { module.exports = {createMonitor: createMonitor, safeToRefresh: safeToRefresh, createTransport: createTransport, tableContext: tableContext, sameContext: sameContext, createInteraction:createInteraction,bridgeCoordinator:bridgeCoordinator}; return; }
    var doc = root.document, initial = root.mailArrivalInitial;
    if (!doc || root.parent !== root || !initial || !initial.version || !initial.mailbox_id || !doc.querySelector('.table-conversations, .content-2col .empty-content') || doc.documentElement.dataset.mailArrival) return;
    doc.documentElement.dataset.mailArrival = 'ready';
    var pendingWrites = 0, writeEpoch = 0, pageActive = true, desiredContext = null, noticeTimer;
    var interaction = createInteraction(Date.now);
    doc.addEventListener('pointerdown',function(e){interaction.start('p'+e.pointerId);},true);
    ['pointerup','pointercancel'].forEach(function(name){doc.addEventListener(name,function(e){interaction.end('p'+e.pointerId);},true);});
    doc.addEventListener('keydown',function(e){interaction.start('k'+(e.code||e.key));},true);
    doc.addEventListener('keyup',function(e){interaction.end('k'+(e.code||e.key));},true);
    root.addEventListener('blur',interaction.clear);
    var transport = createTransport({fetch:root.fetch.bind(root),AbortController:root.AbortController,later:root.setTimeout.bind(root),cancel:root.clearTimeout.bind(root)});
    // Shared coordinator also covers child actions and fetch-based unsubscribe writes.
    var coordinator = root.crockdQuickClose;
    if (coordinator && typeof coordinator.activity === 'function') {
        // Parent row refreshes must also wait for a child reader's pending action.
        // Existing per-action activity calls remain balanced independently.
        bridgeCoordinator(coordinator, function(){pendingWrites++;writeEpoch++;},function(){pendingWrites=Math.max(0,pendingWrites-1);});
    }
    var bar = doc.createElement('div'); bar.className = 'mail-arrival-notice'; bar.hidden = true;
    var text = doc.createElement('span'); text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite');
    var button = doc.createElement('button'); button.type = 'button'; button.textContent = 'Refresh inbox';
    bar.append(text, button);
    var list = doc.querySelector('.table-conversations, .content-2col .empty-content'); list.parentNode.insertBefore(bar, list);
    function restoreScroll(x, y) { var scrolling = doc.scrollingElement || doc.documentElement; scrolling.scrollLeft = x; scrolling.scrollTop = y; }
    function focusIdentity(el) {
        if (!el || el === doc.body) return null;
        if (el.id) return {id: el.id};
        var row = el.closest && el.closest('tr[data-conversation_id]'), cell = el.closest && el.closest('td');
        return row ? {row: row.dataset.conversation_id, cell:cell && cell.className, tag: el.tagName, href: el.getAttribute('href'), cls: el.className} : null;
    }
    function applyPage(page, original, receipt, beforeFocus, x, y, expectedContext, activeCount) {
        var updated = page.querySelector('.table-conversations'), empty = page.querySelector('.content-2col .empty-content');
        if (!updated && !empty) throw new Error('Fresh inbox missing');
        if (updated && !sameContext(tableContext(updated), expectedContext)) throw new Error('Inbox context changed');
        original.replaceWith(updated || empty);
        if (updated) ['conversationPagination', 'starConversationInit', 'converstationBulkActionsInit', 'convListSortingInit', 'triggersInit'].forEach(function (name) { if (typeof root[name] === 'function') root[name](); });
        doc.querySelectorAll('.sidebar-menu a[href]').forEach(function (link) {
            var source = Array.from(page.querySelectorAll('.sidebar-menu a[href]')).find(function (a) { return a.getAttribute('href') === link.getAttribute('href'); });
            if (!source) return;
            var badge = link.querySelector('.pull-right'), fresh = source.querySelector('.pull-right');
            if (badge && fresh) badge.textContent = fresh.textContent;
            else if (badge) badge.remove(); else if (fresh) link.appendChild(fresh.cloneNode(true));
            ['data-active-count', 'data-total-count'].forEach(function (name) { var from = source.closest('li'), to = link.closest('li'); if (from && to && from.hasAttribute(name)) to.setAttribute(name, from.getAttribute(name)); });
        });
        var count = doc.querySelector('.sidebar-title-extra-value.active-count'), freshCount = page.querySelector('.sidebar-title-extra-value.active-count');
        if (count && freshCount) count.textContent = freshCount.textContent;
        if (page.title) doc.title = page.title;
        else if (typeof activeCount === 'number') doc.title = (activeCount > 0 ? '('+activeCount+') ' : '') + doc.title.replace(/^\(\d+\) /,'');
        var focus = beforeFocus, target = focus && focus.id ? doc.getElementById(focus.id) : null;
        if (focus && focus.row) { var row = Array.from(doc.querySelectorAll('tr[data-conversation_id]')).find(function (r) { return r.dataset.conversation_id === focus.row; });
            var scope = row && Array.from(row.querySelectorAll('td')).find(function (cell) { return cell.className === focus.cell; });
            target = scope && Array.from(scope.querySelectorAll(focus.tag)).find(function (el) { return el.getAttribute('href') === focus.href && el.className === focus.cls; }); }
        if (target) target.focus({preventScroll: true});
        restoreScroll(x, y);
        return new Promise(function (resolve) { root.requestAnimationFrame(function () { root.requestAnimationFrame(function () {
            restoreScroll(x, y);
            root.mailArrivalMetrics = {visibleAt: Date.now(), version: receipt.version, committedToVisibleMs: receipt.committed_at_ms ? Date.now() - receipt.committed_at_ms : null, providerToVisibleMs: receipt.provider_at_ms ? Date.now() - receipt.provider_at_ms : null};
            doc.dispatchEvent(new CustomEvent('mail-arrival-visible', {detail: root.mailArrivalMetrics})); resolve(true);
        }); }); });
    }
    var monitor = createMonitor({initialVersion: String(initial.version), mailboxId: initial.mailbox_id,
        later: root.setTimeout.bind(root), cancel: root.clearTimeout.bind(root), visible: function () { return doc.visibilityState !== 'hidden'; },
        safe: function () { return pageActive && interaction.safe() && safeToRefresh(root, pendingWrites); },
        fetch: function () { return transport.read(initial.endpoint || ('/mail-arrival/version?mailbox_id=' + encodeURIComponent(initial.mailbox_id)), {credentials: 'same-origin', cache: 'no-store', headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}}, function (response) { if (!response.ok) throw new Error('Receipt unavailable'); return response.json(); }); },
        notice: function showNotice(state) {
            root.clearTimeout(noticeTimer);
            if(!pageActive)return;
            if(!interaction.safe()){noticeTimer=root.setTimeout(function(){showNotice(state);},360);return;}
            var x = root.scrollX, y = root.scrollY; bar.hidden = state === 'clear';
            text.textContent = state === 'pending' ? 'New mail is available. The inbox will refresh when your current work is safe.' : state === 'refreshing' ? 'Refreshing inbox…' : state === 'pending-error' ? 'New mail is available. Checking for more mail failed. Your current work is kept.' : state === 'error' ? 'Mail updates could not be checked. Retrying automatically.' : '';
            button.disabled = state === 'refreshing'; button.textContent = state === 'error' ? 'Check again' : 'Refresh inbox';
            restoreScroll(x, y);
        },
        refresh: function (receipt) {
            var url = root.location.href, original = doc.querySelector('.table-conversations, .content-2col .empty-content');
            var signature = original && JSON.stringify(original.dataset), epoch = writeEpoch, gesture = interaction.epoch(), desired = desiredContext;
            if (!original) return false;
            var context = desired || tableContext(original), endpoint = new URL(initial.endpoint || '/mail-arrival/version', root.location.href);
            endpoint.pathname = endpoint.pathname.replace(/\/version$/, '/snapshot'); endpoint.search = '';
            endpoint.searchParams.set('mailbox_id', initial.mailbox_id);
            endpoint.searchParams.set('folder_id', doc.body.dataset.folder_id || '');
            endpoint.searchParams.set('page', context.page);
            ['filter','params','sorting'].forEach(function(group){Object.keys(context[group]).forEach(function(key){endpoint.searchParams.set(group+'['+key+']',context[group][key]);});});
            return transport.read(endpoint.href, {credentials: 'same-origin', cache: 'no-store', headers: {'Accept':'application/json','X-Requested-With':'XMLHttpRequest'}}, function (response) { if (!response.ok) throw new Error('Inbox unavailable'); return response.json(); })
                .then(function (data) {
                    if (!pageActive || doc.visibilityState === 'hidden' || url !== root.location.href || epoch !== writeEpoch || gesture !== interaction.epoch() || !interaction.safe() || desired !== desiredContext || original !== doc.querySelector('.table-conversations, .content-2col .empty-content') || signature !== JSON.stringify(original.dataset) || !safeToRefresh(root, pendingWrites)) return false;
                    if (data.status !== 'success' || String(data.mailbox_id) !== String(initial.mailbox_id) || typeof data.html !== 'string' || typeof data.sidebar_html !== 'string') throw new Error('Inbox unavailable');
                    var page = new DOMParser().parseFromString('<div class="content-2col">'+data.html+'</div>'+data.sidebar_html, 'text/html');
                    return Promise.resolve(applyPage(page, original, receipt, focusIdentity(doc.activeElement), root.scrollX, root.scrollY, context, data.active_count)).then(function(applied){if(applied && desiredContext===desired)desiredContext=null;return applied;});
                });
        }});
    button.addEventListener('click', function () { monitor.poll(); });
    if (root.jQuery) root.jQuery(doc).on('ajaxSend.mailArrival', function (_e, xhr, settings) { if (xhr && typeof xhr.always === 'function' && !/^(GET|HEAD)$/i.test(settings.type || 'GET') && new URLSearchParams(typeof settings.data === 'string' ? settings.data : '').get('action') !== 'conversations_pagination') { pendingWrites++; writeEpoch++; xhr.__mailArrivalWrite = true; } })
        .on('ajaxComplete.mailArrival', function (_e, xhr) { if (xhr.__mailArrivalWrite) { pendingWrites = Math.max(0, pendingWrites - 1); delete xhr.__mailArrivalWrite; } });
    // Native realtime also calls pagination directly. Its late callback must obey
    // the same reader/draft/write guards as the receipt-driven refresh.
    if (typeof root.fsAjax === 'function') {
        var nativeAjax = root.fsAjax;
        root.fsAjax = function (data, url, success) {
            var action = typeof data === 'string' ? new URLSearchParams(data).get('action') : data && data.action;
            if (action !== 'conversations_pagination') return nativeAjax.apply(this, arguments);
            var original = doc.querySelector('.table-conversations'), epoch = writeEpoch, here = root.location.href, gesture = interaction.epoch();
            var requested = original && typeof data === 'object' ? nativeContext(data,tableContext(original)) : null;
            if(requested)desiredContext=requested;
            var signature = original && JSON.stringify(original.dataset);
            if (!original || !pageActive || !interaction.safe() || !safeToRefresh(root, pendingWrites) || doc.visibilityState === 'hidden') { monitor.invalidate(); if (root.loaderHide) root.loaderHide(); return; }
            var args = Array.prototype.slice.call(arguments);
            args[2] = function () {
                if (!pageActive || gesture !== interaction.epoch() || !interaction.safe() || epoch !== writeEpoch || here !== root.location.href || original !== doc.querySelector('.table-conversations') || signature !== JSON.stringify(original.dataset) || !safeToRefresh(root, pendingWrites) || doc.visibilityState === 'hidden') {
                    monitor.invalidate(); if (root.loaderHide) root.loaderHide(); return;
                }
                if(desiredContext===requested)desiredContext=null;
                return success && success.apply(this, arguments);
            };
            return nativeAjax.apply(this, args);
        };
    }
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') {transport.abort();interaction.clear();} monitor.visibility(); });
    root.addEventListener('pagehide', function () { pageActive = false; root.clearTimeout(noticeTimer); monitor.stop(); transport.abort(); });
    root.addEventListener('pageshow', function (event) { if (event.persisted) { pageActive = true; monitor.start(); } });
    root.mailArrival = monitor;
    monitor.start();
})(typeof window === 'undefined' ? {} : window);
