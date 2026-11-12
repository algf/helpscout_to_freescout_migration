(function (root) {
    'use strict';
    // Reconcile from a native authenticated document, never inferred counters.
    root.inboxNavigationReadState = function (freshDocument) {
        var current = root.document.querySelector('.web-notifications');
        var fresh = freshDocument.querySelector('.web-notifications');
        if (!current || !fresh) return;
        ['.web-notifications-count', '.web-notifications-mark-read'].forEach(function (selector) {
            var target = current.querySelector(selector), source = fresh.querySelector(selector);
            if (!target || !source) return;
            target.classList.toggle('hidden', source.classList.contains('hidden'));
            if (selector === '.web-notifications-count') target.textContent = source.textContent;
        });
        var bell = current.querySelector('.dropdown-toggle'), freshBell = fresh.querySelector('.dropdown-toggle');
        if (bell && freshBell) bell.classList.toggle('has-unread', freshBell.classList.contains('has-unread'));
        var states = {};
        fresh.querySelectorAll('[data-notification_id]').forEach(function (item) {
            states[item.getAttribute('data-notification_id')] = item.classList.contains('is-unread');
        });
        current.querySelectorAll('[data-notification_id]').forEach(function (item) {
            var id = item.getAttribute('data-notification_id');
            if (Object.prototype.hasOwnProperty.call(states, id)) item.classList.toggle('is-unread', states[id]);
        });
    };
})(window);
