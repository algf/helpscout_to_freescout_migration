(function (root) {
    'use strict';

    function restoreScroll(browser, left, top) {
        // FreeScout replaces window.scrollTo with an element-based helper.
        // Use the document scroller directly to preserve the list position.
        var scroller = browser.document.scrollingElement || browser.document.documentElement;
        scroller.scrollLeft = left;
        scroller.scrollTop = top;
    }

    function createCloser(deps) {
        var pending = new Set(), completed = new Set();
        var hide = deps.hide || function () { return function () {}; };
        return function close(id, mode, button) {
            id = Number(id);
            if (pending.has(id) || completed.has(id) || !Number.isSafeInteger(id) || id <= 0 || !['row', 'conversation'].includes(mode)) return false;
            if (!deps.canChange(button)) return false;
            pending.add(id);
            deps.setBusy(true, button);
            deps.activity(1);
            // Optimistic: a row leaves the list at once. The server confirms in the background,
            // and a refusal or network failure puts the row back with an error.
            var undo = mode === 'row' ? hide(id, button) : null;
            var settled = false;
            function release() {
                pending.delete(id);
                deps.setBusy(false, button);
                deps.activity(-1);
            }
            function fail(message) {
                if (undo) { try { undo(); } catch (e) { /* the row is gone; the refresh shows server state */ } }
                release();
                deps.error(message);
            }
            var payload = { action: 'conversation_change_status', conversation_id: id, status: 3, folder_id: deps.folderId() };
            if (mode === 'row') payload.x_embed = 1;
            try {
                deps.request(payload, function (response) {
                    if (settled) return;
                    settled = true;
                    if (response && response.status === 'success') {
                        completed.add(id);
                        if (mode === 'row') {
                            try { deps.rowClosed(id, button); }
                            finally { release(); }
                        } else deps.navigate(response.redirect_url);
                    } else {
                        fail(response && response.msg ? response.msg : 'Could not close this conversation. Please try again.');
                    }
                }, function () {
                    if (settled) return;
                    settled = true;
                    fail('Connection problem. The close action could not be confirmed. Please refresh before trying again.');
                });
            } catch (error) {
                if (!settled) { settled = true; fail('Could not update this conversation on screen. Please refresh to check its status.'); }
            }
            return true;
        };
    }

    // Coalesce a run of closes into one refresh; discard a response if another close started.
    function createRefreshQueue(deps) {
        var pending = 0, version = 0, timer, fetching = false, dirty = false;
        function schedule() {
            deps.cancel(timer);
            // Wait 600 ms to batch a run of closes, unless nothing is left on screen to work on.
            if (!pending && dirty) timer = deps.later(refresh, deps.empty && deps.empty() ? 0 : 600);
        }
        function refresh() {
            if (pending || fetching || !dirty) return;
            // Another control still owns a row (a one-click Unsubscribe on its way): check again shortly, fetch nothing.
            if (deps.blocked && deps.blocked()) { deps.cancel(timer); timer = deps.later(refresh, 1000); return; }
            fetching = true;
            var started = version;
            deps.fetch(function (result) {
                fetching = false;
                if (started === version && !pending) {
                    dirty = false;
                    deps.apply(result);
                } else schedule();
            }, function () {
                fetching = false;
                if (started !== version || pending) { schedule(); return; }
                dirty = false;
                deps.error('Closed successfully. Counts could not refresh; refresh the page when convenient.');
            });
        }
        return {
            activity: function (delta) { pending += delta; version++; schedule(); },
            changed: function () { dirty = true; schedule(); }
        };
    }

    // Hide a list row now and return a function that puts it back. Keeps the folder badge,
    // page title and bulk selection in step with what is on screen.
    function createRowHider(doc, jq) {
        function badge(delta) {
            var active = doc.querySelector('#folders > li.active');
            var count = active && active.querySelector('.active-count');
            var label = count && (count.getAttribute('data-original-title') || count.getAttribute('title') || '');
            if (!count || (label && !/active/i.test(label))) return;
            var n = parseInt(count.textContent, 10);
            if (isNaN(n)) return;
            n = Math.max(0, n + delta);
            count.textContent = String(n);
            active.setAttribute('data-active-count', String(n));
            var title = /^\((\d+)\)\s/.exec(doc.title);
            if (title) doc.title = doc.title.replace(/^\(\d+\)/, '(' + Math.max(0, parseInt(title[1], 10) + delta) + ')');
        }
        return function hideRow(row) {
            if (!row || row.getAttribute('data-quick-close-hidden')) return function () {};
            var counted = row.classList.contains('conv-active');
            var checkbox = row.querySelector('input.conv-checkbox');
            var wasChecked = !!(checkbox && checkbox.checked);
            row.setAttribute('data-quick-close-hidden', '1');
            row.style.display = 'none';
            if (wasChecked) {
                checkbox.checked = false;
                row.classList.remove('selected');
                if (jq) jq(checkbox).trigger('change');
            }
            if (counted) badge(-1);
            return function undo() {
                if (!row.isConnected || !row.getAttribute('data-quick-close-hidden')) return;
                row.removeAttribute('data-quick-close-hidden');
                row.style.display = '';
                if (counted) badge(1);
            };
        };
    }

    if (typeof module === 'object' && module.exports) { module.exports = { createCloser: createCloser, createRefreshQueue: createRefreshQueue, restoreScroll: restoreScroll, createRowHider: createRowHider }; return; }
    if (!root.document || root.document.documentElement.dataset.mailboxQuickClose) return;
    root.document.documentElement.dataset.mailboxQuickClose = 'ready';
    var hideRow = createRowHider(root.document, root.jQuery);
    var refreshQueue = createRefreshQueue({
        blocked: function () { return !!document.querySelector('.table-conversations .unsub-review.is-busy'); },
        empty: function () {
            var table = document.querySelector('.table-conversations');
            return !!table && !Array.prototype.some.call(table.querySelectorAll('tr.conv-row'), function (r) { return r.style.display !== 'none'; });
        },
        later: root.setTimeout.bind(root),
        cancel: root.clearTimeout.bind(root),
        fetch: function (success, failure) {
            var pageUrl = root.location.href;
            var original = document.querySelector('.table-conversations');
            var signature = original ? JSON.stringify(original.dataset) : '';
            root.fetch(pageUrl, { credentials: 'same-origin', cache: 'no-store' })
                .then(function (response) { if (!response.ok) throw new Error('refresh failed'); return response.text(); })
                .then(function (html) {
                    if (root.location.href !== pageUrl) throw new Error('page changed');
                    var page = new DOMParser().parseFromString(html, 'text/html');
                    if (!page.querySelector('.table-conversations') && !page.querySelector('.content-2col .empty-content')) throw new Error('table missing');
                    if (original !== document.querySelector('.table-conversations') || JSON.stringify(original.dataset) !== signature) { success(null); return; }
                    success(page);
                }).catch(failure);
        },
        apply: function (page) {
            if (!page) return;
            var current = document.querySelector('.table-conversations');
            var updated = page.querySelector('.table-conversations');
            if (!current) return;
            var empty = page.querySelector('.content-2col .empty-content');
            if (!updated && !empty) return;
            // A user may have paged/sorted while the background read was in flight.
            if (updated && current.getAttribute('data-page') !== updated.getAttribute('data-page')) return;
            var selected = new Set(Array.from(current.querySelectorAll('input.conv-checkbox:checked')).map(function (c) { return c.id; }));
            var touched = new Set(Array.from(current.querySelectorAll('tr.selected')).map(function (r) { return r.dataset.conversation_id; }));
            var scroll = root.scrollY, scrollLeft = root.scrollX;
            current.replaceWith(updated || empty);
            if (updated) {
            updated.querySelectorAll('input.conv-checkbox').forEach(function (c) { c.checked = selected.has(c.id); });
            updated.querySelectorAll('tr.conv-row').forEach(function (r) { r.classList.toggle('selected', touched.has(r.dataset.conversation_id)); });
            ['conversationPagination', 'starConversationInit', 'converstationBulkActionsInit', 'convListSortingInit', 'triggersInit'].forEach(function (name) {
                if (typeof root[name] === 'function') root[name]();
            });
            root.jQuery(updated).find('input.conv-checkbox').trigger('change');
            } else root.jQuery('#conversations-bulk-actions').hide();
            // Copy server-rendered badge text, preserving the sidebar and its existing handlers.
            document.querySelectorAll('.sidebar-menu a[href]').forEach(function (link) {
                var source = Array.from(page.querySelectorAll('.sidebar-menu a[href]')).find(function (a) { return a.getAttribute('href') === link.getAttribute('href'); });
                if (!source) return;
                var badge = link.querySelector('.pull-right'), fresh = source.querySelector('.pull-right');
                if (badge && fresh) badge.textContent = fresh.textContent;
                else if (badge) badge.remove();
                else if (fresh) link.appendChild(fresh.cloneNode(true));
                ['data-active-count', 'data-total-count'].forEach(function (name) {
                    var sourceFolder = source.closest('li'), targetFolder = link.closest('li');
                    if (sourceFolder && targetFolder && sourceFolder.hasAttribute(name)) targetFolder.setAttribute(name, sourceFolder.getAttribute(name));
                });
            });
            if (page.title) document.title = page.title;
            alignFooters();
            restoreScroll(root, scrollLeft, scroll);
        },
        error: function (message) { root.showFloatingAlert('error', message); }
    });
    var close = createCloser({
        canChange: function (button) {
            return typeof root.fsApplyFilter !== 'function' || root.fsApplyFilter('conversation.can_change_status', true, { trigger: root.jQuery(button) });
        },
        setBusy: function (busy, button) {
            if (!button) return;
            button.disabled = busy;
            button.setAttribute('aria-busy', String(busy));
        },
        hide: function (id, button) { return hideRow(button && button.closest('tr.conv-row')); },
        activity: function (delta) { refreshQueue.activity(delta); },
        folderId: function () { return new URL(root.location.href).searchParams.get('folder_id') || ''; },
        request: function (payload, success, error) { root.fsAjax(payload, root.laroute.route('conversations.ajax'), success, true, error); },
        rowClosed: function () { refreshQueue.changed(); },
        navigate: function (url) { root.location.href = url || root.location.href; },
        error: function (message) { root.showFloatingAlert('error', message); }
    });
    // Shared with the bulk "Close selected" control (InboxShortcuts), so both use one optimistic path.
    root.crockdQuickClose = {
        hideRow: hideRow,
        activity: function (delta) { refreshQueue.activity(delta); },
        changed: function () { refreshQueue.changed(); }
    };
    document.addEventListener('click', function (event) {
        var button = event.target.closest && event.target.closest('.mailbox-one-click-close');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        if (!button.disabled && event.detail < 2) close(button.dataset.conversationId, button.dataset.closeMode, button);
    });
    // Native column hooks do not increment the footer's colspan.
    function alignFooters() {
        document.querySelectorAll('.table-conversations').forEach(function (table) {
            var nav = table.querySelector('tfoot .conv-nav');
            if (table.querySelector('col.mailbox-close-column') && nav && !nav.dataset.quickCloseAligned) {
                nav.colSpan += 1;
                nav.dataset.quickCloseAligned = 'yes';
            }
        });
    }
    alignFooters();
    new MutationObserver(alignFooters).observe(document.body, { childList: true, subtree: true });
})(typeof window === 'undefined' ? {} : window);
