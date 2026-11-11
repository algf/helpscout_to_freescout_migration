(function () {
    'use strict';

    // "Close selected" and the C shortcut. Selected rows leave the list at once; the server
    // confirms in the background and a failure puts them back with an error. FreeScout's own
    // bulk endpoint still decides permissions. Falls back to the native bulk action (which
    // reloads the page) when the shared optimistic list helpers are not on the page.
    function init() {
        var toolbar = document.getElementById('conversations-bulk-actions');
        if (!toolbar || !document.querySelector('.table-conversations') || toolbar.dataset.inboxShortcuts) return;
        var button = toolbar.querySelector('.inbox-close-selected');
        var close = toolbar.querySelector('.conv-status a[data-status="3"]');
        if (!button || !close) return;
        toolbar.dataset.inboxShortcuts = 'ready';
        var busy = false;

        // FreeScout replaces the table during background updates and pagination.
        // Resolve it when acting, never retain the detached original table.
        function selectedBoxes() {
            var table = document.querySelector('.table-conversations');
            return table ? Array.prototype.slice.call(table.querySelectorAll('input.conv-checkbox:checked')) : [];
        }

        function closeNatively() {
            busy = true;
            button.disabled = true;
            close.click();
            return true;
        }

        function closeSelected() {
            var boxes = selectedBoxes();
            if (busy || !boxes.length) return false;
            if (!toolbar.getClientRects().length || close.classList.contains('disabled')) return false;
            var list = window.crockdQuickClose;
            if (!list || typeof window.fsAjax !== 'function' || !window.laroute) return closeNatively();
            var ids = boxes.map(function (box) { return box.value; });
            var acquired = [];
            if (typeof list.begin === 'function' && typeof list.end === 'function') {
                for (var i = 0; i < ids.length; i++) {
                    if (!list.begin(ids[i])) {
                        acquired.forEach(function (id) { list.end(id); });
                        if (typeof window.showFloatingAlert === 'function') window.showFloatingAlert('error', 'A selected conversation is being updated. Wait for it to finish, then try again.');
                        return false;
                    }
                    acquired.push(ids[i]);
                }
            }
            // Only rows the server will move out of this list are hidden: those that show a Close button.
            var undos = [];
            try {
                boxes.forEach(function (box) {
                    var row = box.closest('tr.conv-row');
                    if (row && row.querySelector('.mailbox-one-click-close')) undos.push(list.hideRow(row));
                });
            } catch (error) {
                undos.forEach(function (undo) { try { undo(); } catch (e) {} });
                acquired.forEach(function (id) { list.end(id); });
                if (typeof window.showFloatingAlert === 'function') window.showFloatingAlert('error', 'Could not update the selected conversations on screen. Please refresh and try again.');
                return false;
            }
            busy = true;
            button.disabled = true;
            list.activity(1);
            var settled = false;
            function finish(ok, message) {
                if (settled) return;
                settled = true;
                acquired.forEach(function (id) { list.end(id); });
                if (!ok) undos.forEach(function (undo) { try { undo(); } catch (e) { /* refreshed away */ } });
                busy = false;
                button.disabled = false;
                if (ok) list.changed();
                list.activity(-1);
                if (!ok && typeof window.showFloatingAlert === 'function') window.showFloatingAlert('error', message);
            }
            try { window.fsAjax({ action: 'bulk_conversation_change_status', conversation_id: ids, status: 3 }, window.laroute.route('conversations.ajax'),
                function (response) {
                    if (response && response.status === 'success') finish(true);
                    else finish(false, response && response.msg ? response.msg : 'Could not close the selected conversations. Please try again.');
                }, true, function () {
                    finish(false, 'Connection problem. The close action could not be confirmed. Please refresh before trying again.');
                }); } catch (error) {
                finish(false, 'Could not confirm the close action. Please refresh before trying again.');
            }
            return true;
        }

        button.addEventListener('click', closeSelected);
        function isCloseKey(event) {
            if (event.key !== 'c' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented) return false;
            var target = event.target;
            if (!target || !target.closest || target.isContentEditable) return false;
            // Checkbox focus is expected after selecting rows. Text entry is not.
            if (target.closest('textarea, select, input:not([type="checkbox"]):not([type="radio"]), [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return false;
            var modals = document.querySelectorAll('.modal');
            for (var i = 0; i < modals.length; i++) {
                if (modals[i].getClientRects().length) return false;
            }
            return selectedBoxes().length > 0;
        }
        // Act on key down (what the user feels), then swallow the matching key up: the vendor
        // KeyboardShortcuts module opens "New conversation" on C key up.
        var swallowKeyup = false;
        document.addEventListener('keydown', function (event) {
            if (event.repeat || !isCloseKey(event)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            swallowKeyup = true;
            closeSelected();
        }, true);
        document.addEventListener('keyup', function (event) {
            if (event.key !== 'c') return;
            if (swallowKeyup || isCloseKey(event)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (!swallowKeyup) closeSelected();
                swallowKeyup = false;
            }
        }, true);
        // The native fallback reloads on success. An error must allow a deliberate retry.
        if (window.jQuery) {
            window.jQuery(document).on('ajaxComplete.inboxShortcuts', function (_event, xhr, settings) {
                if (!settings || typeof settings.data !== 'string' || !/(^|&)action=bulk_conversation_change_status(&|$)/.test(settings.data)) return;
                if (xhr.responseJSON && xhr.responseJSON.status === 'success') return;
                busy = false;
                button.disabled = false;
            });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
