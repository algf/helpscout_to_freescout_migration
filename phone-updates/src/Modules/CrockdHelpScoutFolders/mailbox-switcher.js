(function (root) {
    'use strict';
    // Mailbox switcher at the top of the phone Folders panel. See MailboxSwitcher.php.
    // The current mailbox keeps its native folder list (live counts, Views labels, Auto Workflows). Another mailbox's
    // folders render in one nested list inside a single wrapper item, so `#folders > li` still means the current
    // mailbox's folders for every other script and test.

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }

    // Safe same-origin path, or null.
    function safeUrl(url, origin) {
        try {
            var parsed = new URL(url, origin);
            return parsed.origin === origin && /^https?:$/.test(parsed.protocol) ? parsed.href : null;
        } catch (e) { return null; }
    }

    // Folder list HTML for one mailbox, with Views and Clients section labels like the native sidebar.
    function folderItems(mailbox, origin) {
        var html = '', section = null;
        (mailbox.folders || []).forEach(function (folder) {
            var url = safeUrl(folder.url, origin);
            if (!url) return;
            var label = folder.section && folder.section !== section ? folder.section : '';
            section = folder.section || section;
            var count = Number(folder.count) > 0 ? '<' + (folder.strong ? 'strong' : 'span') + ' class="active-count">' + Number(folder.count) + '</' + (folder.strong ? 'strong' : 'span') + '>' : '';
            html += (label ? '<li class="hs-switch-section" aria-hidden="true">' + escapeHtml(label) + '</li>' : '')
                + '<li class="hs-switch-folder"><a href="' + escapeHtml(url) + '"' + (Number(folder.count) > 0 ? '' : ' class="no-active"') + '>'
                + '<i class="glyphicon glyphicon-' + escapeHtml(folder.icon || 'folder-close') + '" aria-hidden="true"></i> '
                + '<span class="folder-name">' + escapeHtml(folder.name) + '</span>' + count + '</a></li>';
        });
        return html;
    }

    function tabsHtml(mailboxes, currentId) {
        return mailboxes.map(function (mailbox) {
            var selected = String(mailbox.id) === String(currentId);
            var count = Number(mailbox.unassigned) > 0 ? '<span class="hs-mailbox-tab-count" aria-hidden="true">' + Number(mailbox.unassigned) + '</span>' : '';
            var label = mailbox.name + (Number(mailbox.unassigned) > 0 ? ', ' + Number(mailbox.unassigned) + ' unassigned' : '');
            return '<button type="button" role="tab" class="hs-mailbox-tab" data-mailbox-id="' + Number(mailbox.id) + '" aria-selected="' + selected + '"'
                + ' aria-label="' + escapeHtml(label) + '"><span class="hs-mailbox-tab-name">' + escapeHtml(mailbox.name) + '</span>' + count + '</button>';
        }).join('');
    }

    if (typeof module === 'object' && module.exports) { module.exports = { folderItems: folderItems, tabsHtml: tabsHtml, safeUrl: safeUrl }; return; }
    var doc = root.document;
    if (!doc || doc.documentElement.dataset.mailboxSwitcher || doc.documentElement.classList.contains('inbox-reader-child')) return;
    doc.documentElement.dataset.mailboxSwitcher = 'ready';

    function init() {
        var list = doc.querySelector('#folders.sidebar-menu');
        var toggle = doc.querySelector('.sidebar-2col .sidebar-menu-toggle');
        var match = /\/mailbox\/(\d+)/.exec(root.location.pathname);
        if (!list || !toggle || list.classList.contains('chats') || !match || !root.hsMailboxSwitcherUrl) return;
        var currentId = match[1], origin = root.location.origin, data = null, loadedAt = 0, loading = null, showing = currentId, panelKey = '';
        var phone = root.matchMedia('(width <= 1000px)');

        // Names and order come from the navbar's Mailbox menu, already on the page with the same access rules, so the
        // tabs are there (and stay put) from the first opening. Only counts and other mailboxes' folders are loaded.
        var mailboxes = [], seen = {};
        Array.prototype.forEach.call(doc.querySelectorAll('#app-navbar-collapse .dropdown-menu a[href]'), function (a) {
            var url = safeUrl(a.getAttribute('href'), origin), m = url && /\/mailbox\/(\d+)$/.exec(new URL(url).pathname);
            if (!m || seen[m[1]]) return;
            seen[m[1]] = true;
            mailboxes.push({ id: Number(m[1]), name: a.textContent.replace(/\s+/g, ' ').trim(), unassigned: 0 });
        });
        if (mailboxes.length < 2 || !seen[currentId]) return;

        var wrapper = doc.createElement('li');
        wrapper.className = 'hs-mailbox-switch';
        wrapper.innerHTML = '<div class="hs-mailbox-tabs" role="tablist" aria-label="Mailboxes">' + tabsHtml(mailboxes, currentId) + '</div>'
            + '<ul class="hs-switch-folders" role="tabpanel" hidden></ul>';
        list.insertBefore(wrapper, list.firstChild);
        var tabs = wrapper.querySelector('.hs-mailbox-tabs'), panel = wrapper.querySelector('.hs-switch-folders');

        function setCount(container, selector, count, make) {
            var el = container.querySelector(selector);
            if (count > 0) {
                if (!el) { el = make(); container.appendChild(el); }
                if (el.textContent !== String(count)) el.textContent = String(count);
            } else if (el) el.remove();
        }
        // Counts change in place; the tab buttons themselves are never rebuilt, so a tap in flight is never lost.
        function updateCounts() {
            mailboxes.forEach(function (mailbox) {
                var tab = tabs.querySelector('[data-mailbox-id="' + mailbox.id + '"]');
                if (!tab) return;
                var fresh = data && data.find(function (m) { return Number(m.id) === mailbox.id; });
                var count = fresh ? Number(fresh.unassigned) || 0 : null;
                if (String(mailbox.id) === String(currentId) && fresh && fresh.unassigned_folder_id) {
                    // The current mailbox's count is its live badge (Close and new mail keep it current).
                    var badge = list.querySelector(':scope > li[data-folder_id="' + Number(fresh.unassigned_folder_id) + '"] .active-count');
                    count = badge ? Number(badge.textContent.trim()) || 0 : 0;
                }
                if (count === null) return;
                setCount(tab, '.hs-mailbox-tab-count', count, function () {
                    var span = doc.createElement('span'); span.className = 'hs-mailbox-tab-count'; span.setAttribute('aria-hidden', 'true'); return span;
                });
                tab.setAttribute('aria-label', mailbox.name + (count > 0 ? ', ' + count + ' unassigned' : ''));
            });
        }
        function structure(mailbox) {
            return (mailbox.folders || []).map(function (f) { return [f.id, f.name, f.url, f.section, f.icon].join('|'); }).join('\n');
        }
        function showPanel() {
            if (String(showing) === String(currentId)) {
                list.removeAttribute('data-hs-switch');
                panel.hidden = true; panel.innerHTML = ''; panelKey = '';
                return;
            }
            list.setAttribute('data-hs-switch', 'other');
            panel.hidden = false;
            var mailbox = data && data.find(function (m) { return String(m.id) === String(showing); });
            if (!mailbox) {
                if (panelKey !== 'loading') { panel.innerHTML = '<li class="hs-switch-section" role="status">Loading folders…</li>'; panelKey = 'loading'; }
                return;
            }
            panel.setAttribute('aria-label', mailbox.name + ' folders');
            var key = showing + '\n' + structure(mailbox);
            if (key !== panelKey) {
                panel.innerHTML = folderItems(mailbox, origin);
                panelKey = key;
                return;
            }
            // Same folders: update counts in place so the link under a finger stays the same element.
            var links = panel.querySelectorAll('li.hs-switch-folder > a');
            var folders = (mailbox.folders || []).filter(function (f) { return safeUrl(f.url, origin); });
            Array.prototype.forEach.call(links, function (a, i) {
                var folder = folders[i]; if (!folder) return;
                var count = Number(folder.count) || 0, tag = folder.strong ? 'strong' : 'span';
                setCount(a, '.active-count', count, function () { var el = doc.createElement(tag); el.className = 'active-count'; return el; });
                a.classList.toggle('no-active', count <= 0);
            });
        }
        function load(force) {
            if (loading) return loading;
            if (!force && data && Date.now() - loadedAt < 30000) return Promise.resolve();
            var url = safeUrl(root.hsMailboxSwitcherUrl, origin);
            if (!url) return Promise.resolve();
            loading = root.fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } })
                .then(function (response) { if (!response.ok) throw new Error('switcher ' + response.status); return response.json(); })
                .then(function (json) {
                    data = Array.isArray(json.mailboxes) ? json.mailboxes : [];
                    loadedAt = Date.now();
                    updateCounts();
                    showPanel();
                })
                .catch(function () { if (panelKey === 'loading') panel.innerHTML = '<li class="hs-switch-section" role="status">Could not load folders. Open the mailbox from the menu.</li>'; })
                .then(function () { loading = null; });
            return loading;
        }
        function select(id, focus) {
            showing = String(id);
            Array.prototype.forEach.call(tabs.querySelectorAll('.hs-mailbox-tab'), function (tab) {
                tab.setAttribute('aria-selected', String(tab.getAttribute('data-mailbox-id') === showing));
            });
            showPanel();
            if (focus) { var tab = tabs.querySelector('[data-mailbox-id="' + showing + '"]'); if (tab) tab.focus({ preventScroll: true }); }
            list.scrollTop = 0;
        }

        // Tabs live inside the panel: keep their taps from reaching the page click that closes the panel.
        wrapper.addEventListener('click', function (event) {
            var tab = event.target.closest && event.target.closest('.hs-mailbox-tab');
            if (!tab) return;
            event.preventDefault();
            event.stopPropagation();
            select(tab.getAttribute('data-mailbox-id'), true);
        });
        tabs.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            var all = Array.prototype.slice.call(tabs.querySelectorAll('.hs-mailbox-tab'));
            var index = all.indexOf(doc.activeElement);
            if (index < 0) return;
            event.preventDefault();
            select(all[(index + (event.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].getAttribute('data-mailbox-id'), true);
        });
        // Each opening starts on the current mailbox and loads counts when the last load is older than 30 seconds.
        var wasOpen = false;
        new MutationObserver(function () {
            var open = list.classList.contains('active');
            if (open && !wasOpen) { select(currentId, false); updateCounts(); load(false); }
            wasOpen = open;
        }).observe(list, { attributes: true, attributeFilter: ['class'] });

        // On phones the mailbox name and folder in the header open the same panel: "Crockd ▾ / Unassigned (14)".
        // Desktop keeps a plain heading. The heading's own text stays its accessible name, with a hint added.
        var title = doc.querySelector('.sidebar-2col .sidebar-title');
        if (title) {
            var hint = doc.createElement('span');
            hint.className = 'sr-only hs-switch-hint';
            hint.textContent = ' Switch mailbox or folder';
            var applyTrigger = function () {
                if (phone.matches) {
                    title.setAttribute('data-hs-switch-trigger', '1'); title.setAttribute('role', 'button'); title.setAttribute('tabindex', '0');
                    title.setAttribute('aria-expanded', String(list.classList.contains('active')));
                    if (!hint.isConnected) title.appendChild(hint);
                } else {
                    ['data-hs-switch-trigger', 'role', 'tabindex', 'aria-expanded'].forEach(function (name) { title.removeAttribute(name); });
                    if (hint.isConnected) hint.remove();
                }
            };
            applyTrigger();
            if (phone.addEventListener) phone.addEventListener('change', applyTrigger); else if (phone.addListener) phone.addListener(applyTrigger);
            new MutationObserver(function () { if (phone.matches) title.setAttribute('aria-expanded', String(list.classList.contains('active'))); })
                .observe(list, { attributes: true, attributeFilter: ['class'] });
            var open = function (event) {
                if (!phone.matches) return;
                event.preventDefault(); event.stopPropagation();
                toggle.click();
            };
            title.addEventListener('click', open);
            title.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') open(event); });
        }
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { root.setTimeout(init, 0); });
    else root.setTimeout(init, 0);
})(typeof window === 'undefined' ? {} : window);
