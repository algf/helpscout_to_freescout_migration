(function (root) {
    'use strict';
    // Unsubscribe buttons (list rows and the conversation toolbar). One click, no review step:
    //   one_click (button): request the unsubscribe, then close the conversation.
    //   page / email (links): open the unsubscribe page, or a filled-in unsubscribe email, in a new tab.
    if (typeof module === 'object' && module.exports) { module.exports = { createAction: createAction, createResume: createResume }; return; }
    if (document.documentElement.dataset.unsubReady) return;
    document.documentElement.dataset.unsubReady = '1';

    function notify(type, text) {
        if (typeof window.showFloatingAlert === 'function') window.showFloatingAlert(type, text);
        else window.alert(text);
    }

    // After a failed one-click request, the next click opens the unsubscribe page instead.
    function becomeLink(button, url) {
        var link = document.createElement('a');
        link.className = button.className;
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.dataset.unsubMode = 'page';
        link.title = 'Open the unsubscribe page in a new tab';
        link.setAttribute('aria-label', link.title);
        link.innerHTML = button.innerHTML;
        button.replaceWith(link);
    }

    function createAction(deps) {
        return function (button) {
            var shared = deps.shared(), id = button.dataset.conversation;
            if (shared && (typeof shared.begin !== 'function' || typeof shared.end !== 'function' || typeof shared.activity !== 'function' || typeof shared.changed !== 'function' || typeof shared.hideRow !== 'function')) shared = null;
            if (shared && !shared.begin(id)) return false;
            var released = false, settled = false, executing = false, manual = null;
            function release() {
                if (released) return;
                released = true;
                deps.busy(button, false);
                if (deps.pending) deps.pending(id, false);
                if (shared) { shared.end(id); shared.activity(-1); }
            }
            function failed(message, manualUrl) {
                if (settled) return;
                settled = true;
                release();
                if (manualUrl) { deps.becomeLink(button, manualUrl); message += ' Click Unsub again to open the unsubscribe page.'; }
                deps.notify('error', message);
            }
            deps.busy(button, true);
            if (deps.pending) deps.pending(id, true);
            if (shared) shared.activity(1);
            try {
                deps.request(button, { action: 'preview', ids: [id] }, function (plan) {
                    if (settled || executing) return;
                    executing = true;
                    var item = plan.items && plan.items[0];
                    manual = item ? item.manual_url : null;
                    if (!item || !item.automatic) { failed(item ? item.reason : 'This message cannot be unsubscribed in one click.', manual); return; }
                    try {
                        if (deps.save) deps.save({ id: id, url: button.dataset.url, token: plan.token, key: item.key });
                        deps.request(button, { action: 'execute', token: plan.token, key: item.key, close: '1' }, function (data) {
                            if (settled) return;
                            if (deps.clear) deps.clear(id);
                            if (!data.accepted) { failed(data.message || 'The unsubscribe request was not accepted.', manual); return; }
                            settled = true;
                            var row = button.closest('tr.conv-row');
                            var displayFailed = false;
                            try {
                                if (row && data.closed && shared) {
                                    try { shared.hideRow(row); } finally { shared.changed(); }
                                } else if (row || !data.closed) deps.mark(button, data.closed);
                            } catch (error) { displayFailed = true; }
                            finally { release(); }
                            deps.notify(displayFailed ? 'error' : 'success', displayFailed
                                ? 'Unsubscribed and closed, but the screen could not update. Please refresh.'
                                : (data.closed ? 'Unsubscribed and closed.' : 'Unsubscribed.'));
                            if (!row && data.closed) deps.reload();
                        }, function (xhr) { failed((xhr && xhr.responseJSON && xhr.responseJSON.message) || 'Could not confirm the unsubscribe request. Please refresh before trying again.', manual); });
                    } catch (e) { failed('Could not confirm the unsubscribe request. Please refresh before trying again.', null); }
                }, function (xhr) { failed((xhr && xhr.responseJSON && xhr.responseJSON.message) || 'Could not start the unsubscribe request.', null); });
            } catch (e) { failed('Could not start the unsubscribe request.', null); }
            return true;
        };
    }

    // A new document only reads the result of an existing execute. It never repeats it.
    function createResume(deps) {
        return function (record) {
            var shared = deps.shared(), id = record.id, released = false, unknownSince = null, retryDelay = 1000;
            var listActive = !!deps.row(id);
            if (!shared || typeof shared.begin !== 'function' || typeof shared.end !== 'function' || typeof shared.activity !== 'function' || typeof shared.changed !== 'function' || typeof shared.hideRow !== 'function') shared = null;
            if (shared && !shared.begin(id)) return false;
            if (shared && listActive) shared.activity(1);
            if (deps.pending) deps.pending(id, true);
            function finish(message, result) {
                if (released) return;
                released = true;
                try {
                    if (result && result.accepted && result.closed && shared) {
                        var row = deps.row(id);
                        if (row) { try { shared.hideRow(row); } finally { shared.changed(); } }
                        else if (deps.isCurrent && deps.isCurrent(id) && deps.reload) deps.reload();
                    } else if (result && result.accepted && !result.closed && deps.mark) {
                        deps.mark(id);
                    }
                } catch (error) { message = 'Unsubscribed and closed, but the screen could not update. Please refresh.'; }
                finally {
                    deps.clear(id);
                    if (deps.pending) deps.pending(id, false);
                    if (shared) { shared.end(id); if (listActive) shared.activity(-1); }
                }
                deps.notify(result && result.accepted && !message ? 'success' : 'error', message || (result.closed ? 'Unsubscribed and closed.' : 'Unsubscribed.'));
            }
            function poll() {
                if (released) return;
                if (deps.now() >= record.expires) { finish('Could not confirm the unsubscribe request. Please refresh before trying again.'); return; }
                try {
                    deps.request(record, function (response) {
                        if (released) return;
                        retryDelay = 1000;
                        if (response && response.state === 'complete' && response.result) {
                            var result = response.result;
                            finish(result.accepted ? '' : (result.message || 'The unsubscribe request was not accepted.'), result);
                        } else if (response && response.state === 'pending') {
                            unknownSince = null;
                            deps.later(poll, 1000);
                        } else {
                            if (unknownSince === null) unknownSince = deps.now();
                            if (deps.now() - unknownSince >= 3000) finish('Could not confirm the unsubscribe request. Please refresh before trying again.');
                            else deps.later(poll, 1000);
                        }
                    }, function (xhr) {
                        if (released) return;
                        var status = xhr && Number(xhr.status) || 0;
                        if (status === 0 || status >= 500) {
                            deps.later(poll, Math.min(retryDelay, Math.max(0, record.expires - deps.now())));
                            retryDelay = Math.min(retryDelay * 2, 5000);
                        } else finish('Could not check the unsubscribe request. Please refresh before trying again.');
                    });
                } catch (error) { finish('Could not check the unsubscribe request. Please refresh before trying again.'); }
            }
            poll();
            return true;
        };
    }

    var storagePrefix = 'crockd-unsub-pending:';
    function storageClear(id) { try { window.sessionStorage.removeItem(storagePrefix + id); } catch (e) {} }
    function storageSave(record) {
        try {
            var url = new URL(record.url, window.location.href);
            if (url.origin !== window.location.origin || !/^https?:$/.test(url.protocol)) return;
            record.url = url.pathname + url.search;
            record.expires = Date.now() + 120000;
            window.sessionStorage.setItem(storagePrefix + record.id, JSON.stringify(record));
        } catch (e) { /* Storage is optional; the current page still works. */ }
    }

    var pendingControls = new WeakMap();
    function pendingClose(id, on) {
        document.querySelectorAll('.mailbox-one-click-close').forEach(function (button) {
            if (String(button.dataset.conversationId) !== String(id)) return;
            if (on) {
                if (pendingControls.has(button)) return;
                pendingControls.set(button, { disabled: button.disabled, title: button.getAttribute('title'), busy: button.getAttribute('aria-busy') });
                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                button.setAttribute('title', 'Unsubscribe in progress');
            } else {
                var previous = pendingControls.get(button);
                if (!previous) return;
                button.disabled = previous.disabled;
                if (previous.title === null) button.removeAttribute('title'); else button.setAttribute('title', previous.title);
                if (previous.busy === null) button.removeAttribute('aria-busy'); else button.setAttribute('aria-busy', previous.busy);
                pendingControls.delete(button);
            }
        });
    }
    function markUnsubscribed(button, closed) {
        var status = document.createElement('span');
        status.className = 'mailbox-already-closed';
        status.textContent = closed ? 'Unsubscribed · Closed' : 'Unsubscribed';
        button.replaceWith(status);
    }

    var unsubscribeNow = createAction({
        shared: function () { return window.crockdQuickClose; },
        pending: pendingClose,
        save: storageSave,
        clear: storageClear,
        request: function (button, data, success, failure) {
            var $ = window.jQuery;
            $.ajax({ url: button.dataset.url, type: 'POST', data: data, dataType: 'json', timeout: 120000,
                headers: { 'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content') } }).done(success).fail(failure);
        },
        busy: function (button, on) {
            var label = button.querySelector('.mailbox-unsub-label');
            if (on && label) button.dataset.unsubOriginal = label.textContent;
            button.disabled = on;
            button.classList.toggle('is-busy', on);
            if (label) label.textContent = on ? 'Unsub…' : button.dataset.unsubOriginal;
        },
        becomeLink: becomeLink,
        notify: notify,
        mark: markUnsubscribed,
        reload: function () { window.location.reload(); }
    });

    var resuming = {};
    function resumePending() {
        var records = [];
        try {
            for (var i = 0; i < window.sessionStorage.length; i++) {
                var key = window.sessionStorage.key(i);
                if (key && key.indexOf(storagePrefix) === 0) {
                    try { records.push(JSON.parse(window.sessionStorage.getItem(key))); } catch (e) { window.sessionStorage.removeItem(key); i--; }
                }
            }
        } catch (e) { return; }
        var resume = createResume({
            shared: function () { return window.crockdQuickClose; },
            clear: function (id) { delete resuming[id]; storageClear(id); },
            pending: pendingClose,
            isCurrent: function (id) { return document.body.dataset.conversation_id === String(id); },
            reload: function () { window.location.reload(); },
            mark: function (id) {
                var row = Array.prototype.find.call(document.querySelectorAll('tr.conv-row'), function (r) { return r.dataset.conversation_id === String(id); });
                var button = row && row.querySelector('button.unsub-review');
                if (button) markUnsubscribed(button, false);
            },
            now: Date.now,
            later: window.setTimeout.bind(window),
            row: function (id) { return Array.prototype.find.call(document.querySelectorAll('tr.conv-row'), function (row) { return row.dataset.conversation_id === String(id); }); },
            notify: notify,
            request: function (record, success, failure) {
                var $ = window.jQuery;
                $.ajax({ url: record.url, type: 'POST', dataType: 'json', timeout: 10000,
                    data: { action: 'status', token: record.token, key: record.key },
                    headers: { 'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content') } }).done(success).fail(failure);
            }
        });
        records.forEach(function (record) {
            try {
                var url = new URL(record.url, window.location.href);
                if (!record.id || !record.token || !record.key || !Number.isFinite(record.expires) || url.origin !== window.location.origin || !/^https?:$/.test(url.protocol) || record.expires > Date.now() + 120000) throw new Error('invalid');
                record.url = url.pathname + url.search;
                if (!resuming[record.id]) {
                    resuming[record.id] = true;
                    if (!resume(record)) {
                        delete resuming[record.id];
                        if (Date.now() < record.expires) window.setTimeout(resumePending, 1000);
                    }
                }
            } catch (e) { if (record && record.id) storageClear(record.id); }
        });
    }
    // Run after other deferred scripts have installed the shared coordinator.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.setTimeout(resumePending, 0); });
    else window.setTimeout(resumePending, 0);
    window.addEventListener('pageshow', function (event) { if (event.persisted) window.setTimeout(resumePending, 0); });

    // Capture phase: a list row opens its conversation on click, so stop the click here.
    // Links keep their default action (a new tab); the one-click button runs the request.
    document.addEventListener('click', function (event) {
        var control = event.target.closest ? event.target.closest('.unsub-review') : null;
        if (!control) return;
        event.stopPropagation();
        if (control.tagName === 'A') return;
        event.preventDefault();
        if (control.disabled || !window.jQuery || !control.dataset.url) return;
        unsubscribeNow(control);
    }, true);
})(typeof window === 'undefined' ? {} : window);
