(function () {
    'use strict';
    // Unsubscribe buttons (list rows and the conversation toolbar). One click, no review step:
    //   one_click (button): request the unsubscribe, then close the conversation.
    //   page / email (links): open the unsubscribe page, or a filled-in unsubscribe email, in a new tab.
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

    function unsubscribeNow(button) {
        var $ = window.jQuery;
        var label = button.querySelector('.mailbox-unsub-label');
        var original = label ? label.textContent : '';
        function request(data) {
            return $.ajax({ url: button.dataset.url, type: 'POST', data: data, dataType: 'json', timeout: 120000,
                headers: { 'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content') } });
        }
        function busy(on) {
            button.disabled = on;
            button.classList.toggle('is-busy', on);
            if (label) label.textContent = on ? 'Unsub…' : original;
        }
        function failed(message, manualUrl) {
            busy(false);
            if (manualUrl) {
                becomeLink(button, manualUrl);
                message += ' Click Unsub again to open the unsubscribe page.';
            }
            notify('error', message);
        }
        busy(true);
        var manual = null;
        request({ action: 'preview', ids: [button.dataset.conversation] }).done(function (plan) {
            var item = plan.items && plan.items[0];
            manual = item ? item.manual_url : null;
            if (!item || !item.automatic) { failed(item ? item.reason : 'This message cannot be unsubscribed in one click.', manual); return; }
            request({ action: 'execute', token: plan.token, key: item.key, close: '1' }).done(function (data) {
                if (!data.accepted) { failed(data.message || 'The unsubscribe request was not accepted.', manual); return; }
                notify('success', data.closed ? 'Unsubscribed and closed.' : 'Unsubscribed.');
                var row = button.closest('tr.conv-row');
                if (row) {
                    row.classList.add('mailbox-just-closed');
                    var cell = button.closest('td');
                    if (cell) cell.innerHTML = '<span class="mailbox-already-closed">' + (data.closed ? 'Unsubscribed · Closed' : 'Unsubscribed') + '</span>';
                } else {
                    window.location.reload();
                }
            }).fail(function (xhr) {
                failed((xhr.responseJSON && xhr.responseJSON.message) || 'Could not confirm the unsubscribe request. Nothing was closed.', manual);
            });
        }).fail(function (xhr) {
            failed((xhr.responseJSON && xhr.responseJSON.message) || 'Could not start the unsubscribe request.', null);
        });
    }

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
})();
