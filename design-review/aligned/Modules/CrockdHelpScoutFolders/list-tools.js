/* Conversation list tools. Re-applied whenever FreeScout replaces the list (paging, sorting, one-click Close refresh). */
(function () {
    'use strict';
    var LINK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    var CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

    function copyButton(id, number) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'mailbox-copy-link';
        b.setAttribute('data-conversation-id', id);
        b.setAttribute('aria-label', 'Copy link to conversation #' + number);
        b.setAttribute('data-label', 'Copy link to conversation #' + number);
        b.title = 'Copy link';
        b.innerHTML = LINK + '<span>Copy link</span>';
        return b;
    }

    function addCopyButtons() {
        var cells = document.querySelectorAll('.table-conversations tr.conv-row > td.conv-number');
        for (var i = 0; i < cells.length; i++) {
            var td = cells[i];
            if (td.parentNode.querySelector('.mailbox-copy-link')) continue;
            var id = td.parentNode.getAttribute('data-conversation_id');
            if (!/^\d+$/.test(id || '')) continue;
            td.appendChild(copyButton(id, (td.textContent || '').replace(/\D/g, '')));
        }
        var nav = document.querySelector('.conv-numnav');
        var convId = document.body.getAttribute('data-conversation_id');
        if (nav && /^\d+$/.test(convId || '') && !nav.querySelector('.mailbox-copy-link')) {
            var strong = nav.querySelector('strong');
            nav.appendChild(copyButton(convId, strong ? strong.textContent.trim() : convId));
        }
    }

    function apply() {
        addCopyButtons();
    }

    function announce(text) {
        var status = document.getElementById('hs-copy-status');
        if (!status) {
            status = document.createElement('div'); status.id = 'hs-copy-status';
            status.className = 'hs-copy-status'; status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite'); document.body.appendChild(status);
        }
        status.textContent = text; status.hidden = false;
        clearTimeout(status._timer); status._timer = setTimeout(function () { status.hidden = true; }, 2500);
    }
    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
        return new Promise(function (resolve, reject) {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            area.parentNode.removeChild(area);
            ok ? resolve() : reject(new Error('copy failed'));
        });
    }

    document.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('.mailbox-copy-link') : null;
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        var url = window.location.origin + '/conversation/' + button.getAttribute('data-conversation-id');
        copyText(url).then(function () {
            button.classList.add('is-copied');
            button.innerHTML = CHECK + '<span>Link copied</span>';
            announce('Conversation link copied.');
            button.setAttribute('aria-label', 'Link copied');
            button.title = 'Copied';
        }, function () {
            button.title = 'Copy failed: ' + url;
            button.classList.add('copy-failed');
            button.innerHTML = LINK + '<span>Try again</span>';
            announce('Could not copy the link. Try again.');
        }).then(function () {
            clearTimeout(button._resetTimer);
            button._resetTimer = setTimeout(function () {
                button.classList.remove('is-copied');
                button.innerHTML = LINK + '<span>Copy link</span>';
                button.classList.remove('copy-failed');
                button.setAttribute('aria-label', button.getAttribute('data-label'));
                button.title = 'Copy link';
            }, 2500);
        });
    }, true);

    var scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        (window.requestAnimationFrame || setTimeout)(function () { scheduled = false; apply(); });
    }

    function init() {
        apply();
        if (window.MutationObserver) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
