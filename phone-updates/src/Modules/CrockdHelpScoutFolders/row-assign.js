(function (root) {
    'use strict';
    // Assign on inbox rows (phones). See RowAssign.php. The people come from the bulk bar's Assignee menu on the same
    // page, so the row and the bulk bar always offer the same choices. Saving uses FreeScout's own single-conversation
    // assignment action; the server checks permission and mailbox access and says why it refuses.

    function successMessage(userId, label) {
        if (Number(userId) === -1) return 'Unassigned. Anyone can pick it up.';
        if (label === 'Me') return 'Assigned to you.';
        return 'Assigned to ' + label + '.';
    }

    // People listed in the bulk bar's Assignee menu: [{ id, label }]. Empty when this list has no mailbox.
    function menuChoices(doc) {
        var links = doc.querySelectorAll('#conversations-bulk-actions .conv-user li > a[data-user_id]');
        var seen = {}, choices = [];
        Array.prototype.forEach.call(links, function (link) {
            var id = Number(link.getAttribute('data-user_id'));
            var label = String(link.textContent || '').replace(/\s+/g, ' ').trim();
            if (!Number.isSafeInteger(id) || (id <= 0 && id !== -1) || !label || seen[id] || (link.classList && link.classList.contains('disabled'))) return;
            seen[id] = true;
            choices.push({ id: id, label: label });
        });
        return choices;
    }

    function createAssigner(deps) {
        return function assign(id, userId, current, button, label) {
            id = Number(id); userId = Number(userId);
            if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(userId) || (userId <= 0 && userId !== -1)) return false;
            if (userId === Number(current)) return false;
            var shared = deps.shared();
            if (shared && (typeof shared.begin !== 'function' || typeof shared.end !== 'function' || typeof shared.activity !== 'function' || typeof shared.changed !== 'function')) shared = null;
            // Close, bulk Close and Unsubscribe hold the same per-email lock, so an Assign never races them.
            if (shared && !shared.begin(id)) { deps.notify('error', 'This email is busy with another action. Try again in a moment.'); return false; }
            var settled = false, released = false;
            deps.busy(button, true);
            if (shared) shared.activity(1);
            function release() {
                if (released) return;
                released = true;
                deps.busy(button, false);
                if (shared) { shared.end(id); shared.activity(-1); }
            }
            function fail(message) { release(); deps.notify('error', message); }
            try {
                deps.request({ action: 'conversation_change_user', conversation_id: id, user_id: userId, x_embed: 1 }, function (response) {
                    if (settled) return;
                    settled = true;
                    if (response && response.status === 'success') {
                        var displayFailed = false;
                        try { deps.assigned(button, userId, label); } catch (error) { displayFailed = true; }
                        finally {
                            // The list refresh removes the row when it no longer belongs here (Unassigned, Mine).
                            if (shared) shared.changed();
                            release();
                        }
                        deps.notify(displayFailed ? 'error' : 'success', displayFailed
                            ? 'Assigned, but the screen could not update. Please refresh.'
                            : successMessage(userId, label));
                    } else fail(response && response.msg ? String(response.msg) : 'Could not assign this email. Please try again.');
                }, function () {
                    if (settled) return;
                    settled = true;
                    fail('Connection problem. The assignment could not be confirmed. Please refresh before trying again.');
                });
            } catch (error) {
                if (!settled) { settled = true; fail('Could not assign this email. Please try again.'); }
            }
            return true;
        };
    }

    if (typeof module === 'object' && module.exports) { module.exports = { createAssigner: createAssigner, menuChoices: menuChoices, successMessage: successMessage }; return; }
    if (!root.document || root.document.documentElement.dataset.rowAssign) return;
    var doc = root.document;
    doc.documentElement.dataset.rowAssign = 'ready';

    // The theme only shows row Assign where this page has an Assignee menu to copy.
    function syncAvailability() {
        doc.documentElement.classList.toggle('hs-row-assign-available', menuChoices(doc).length > 0);
    }

    function notify(type, text) {
        if (typeof root.showFloatingAlert === 'function') root.showFloatingAlert(type, text);
        else root.alert(text);
    }

    var assign = createAssigner({
        shared: function () { return root.crockdQuickClose; },
        request: function (payload, success, failure) {
            root.fsAjax(payload, root.laroute.route('conversations.ajax'), success, true, failure);
        },
        busy: function (button, on) {
            if (!button) return;
            button.disabled = on;
            button.setAttribute('aria-busy', String(on));
            button.classList.toggle('is-busy', on);
        },
        assigned: function (button, userId, label) {
            if (!button || !button.isConnected) return;
            var name = Number(userId) === -1 ? '' : label;
            button.dataset.userId = String(userId);
            var text = button.querySelector('.mailbox-row-assign-label');
            if (text) text.textContent = name ? name.split(' ')[0] : 'Assign';
            button.setAttribute('aria-label', 'Assign conversation #' + (button.dataset.number || '') + '. Assigned to ' + (name || 'anyone'));
            button.setAttribute('title', name ? 'Assigned to ' + name + '. Change' : 'Assign');
        },
        notify: notify
    });

    var menu = null, owner = null;
    function closeMenu(focusOwner) {
        if (!menu) return;
        menu.remove();
        menu = null;
        if (owner) {
            owner.setAttribute('aria-expanded', 'false');
            if (focusOwner && owner.isConnected) owner.focus();
        }
        owner = null;
    }
    function place(button) {
        var rect = button.getBoundingClientRect();
        var width = Math.min(240, root.innerWidth - 16);
        menu.style.width = width + 'px';
        menu.style.left = Math.max(8, Math.min(rect.right - width, root.innerWidth - width - 8)) + 'px';
        var height = menu.offsetHeight;
        var below = rect.bottom + 4;
        menu.style.top = (below + height <= root.innerHeight - 8 ? below : Math.max(8, rect.top - height - 4)) + 'px';
    }
    function openMenu(button) {
        closeMenu(false);
        var choices = menuChoices(doc);
        if (!choices.length) { notify('error', 'Assign is not available in this list. Open the email to assign it.'); return; }
        var current = Number(button.dataset.userId || -1);
        owner = button;
        menu = doc.createElement('div');
        menu.className = 'hs-row-assign-menu dropdown-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Assign conversation #' + (button.dataset.number || ''));
        var heading = doc.createElement('div');
        heading.className = 'hs-row-assign-heading';
        heading.setAttribute('aria-hidden', 'true');
        heading.textContent = 'Assign to';
        menu.appendChild(heading);
        choices.forEach(function (choice) {
            var item = doc.createElement('button');
            item.type = 'button';
            item.className = 'hs-row-assign-option';
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', String(choice.id === current));
            item.dataset.userId = String(choice.id);
            item.textContent = choice.label;
            menu.appendChild(item);
        });
        doc.body.appendChild(menu);
        button.setAttribute('aria-expanded', 'true');
        place(button);
        var checked = menu.querySelector('[aria-checked="true"]') || menu.querySelector('.hs-row-assign-option');
        if (checked) checked.focus();
    }

    // Window capture phase runs before every other click handler (row links, Close, Unsub, the inbox reader).
    // While the menu is open, a tap outside it only closes the menu: the menu covers the action column of the rows
    // below, so that tap must never close, unsubscribe or open anything. Just after a choice, the second tap of a
    // double tap (same spot, within half a second) is also swallowed for the same reason.
    var guard = { until: 0, x: 0, y: 0 };
    function swallow(event) { event.preventDefault(); event.stopPropagation(); if (event.stopImmediatePropagation) event.stopImmediatePropagation(); }
    root.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var option = target.closest('.hs-row-assign-option');
        if (option && menu && menu.contains(option)) {
            swallow(event);
            var button = owner;
            var userId = Number(option.dataset.userId), label = option.textContent;
            closeMenu(true);
            // Only the same spot is guarded (a double tap); keyboard choices have no position and need no guard.
            if (event.clientX || event.clientY) guard = { until: Date.now() + 500, x: event.clientX, y: event.clientY };
            if (button && !button.disabled) assign(button.dataset.conversationId, userId, button.dataset.userId, button, label);
            return;
        }
        if (Date.now() < guard.until && Math.abs(event.clientX - guard.x) <= 24 && Math.abs(event.clientY - guard.y) <= 24) { guard.until = 0; swallow(event); return; }
        var control = target.closest('.mailbox-row-assign');
        if (control && control === owner) { swallow(event); closeMenu(true); return; }
        if (menu && !menu.contains(target)) { swallow(event); closeMenu(false); return; }
        if (control) {
            swallow(event);
            if (!control.disabled) openMenu(control);
        }
    }, true);
    doc.addEventListener('keydown', function (event) {
        if (!menu) return;
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            var items = Array.prototype.slice.call(menu.querySelectorAll('.hs-row-assign-option'));
            var index = items.indexOf(doc.activeElement);
            index = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
            event.preventDefault();
            items[index].focus();
        }
    });
    root.addEventListener('resize', function () { closeMenu(false); });
    root.addEventListener('scroll', function () { if (menu && owner) place(owner); }, true);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', syncAvailability); else syncAvailability();
})(typeof window === 'undefined' ? {} : window);
