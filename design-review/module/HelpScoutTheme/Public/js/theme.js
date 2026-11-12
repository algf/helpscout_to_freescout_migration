/* Help Scout theme: adds the view header above conversation lists. Presentation only. */
(function () {
    'use strict';
    function addListHeader() {
        var table = document.querySelector('.table-conversations');
        var active = document.querySelector('#folders > li.active .folder-name');
        if (!table || !active || document.querySelector('.hs-list-header')) return;
        var header = document.createElement('div');
        header.className = 'hs-list-header';
        var title = document.createElement('h2');
        title.className = 'hs-list-title';
        title.textContent = active.textContent.trim();
        header.appendChild(title);
        var mailbox = document.querySelector('.sidebar-title .mailbox-name');
        if (mailbox) {
            var badge = document.createElement('span');
            badge.className = 'hs-list-badge';
            badge.textContent = mailbox.textContent.trim();
            header.appendChild(badge);
        }
        var alerts = document.querySelector('.content-2col > .alerts');
        if (alerts) alerts.insertAdjacentElement('afterend', header);
        else table.parentNode.insertBefore(header, table);
    }
    // Conversation page: mark the pinned toolbar so it can show a shadow over the scrolling thread.
    function watchToolbar() {
        var toolbar = document.getElementById('conv-toolbar'), layout = document.getElementById('conv-layout');
        if (!toolbar || !layout || !document.body.classList.contains('body-conv')) return;
        var queued = false, heading = document.getElementById('conv-subject');
        function update() {
            queued = false;
            var top = toolbar.getBoundingClientRect().top;
            var natural = layout.getBoundingClientRect().top; // the toolbar's unpinned position
            toolbar.classList.toggle('hs-stuck', top <= 0 && natural < 0);
            var toolbarHeight = Math.ceil(toolbar.getBoundingClientRect().height) + 'px';
            var headingHeight = Math.ceil(heading ? heading.getBoundingClientRect().height : 0) + 'px';
            var style = document.documentElement.style;
            if (style.getPropertyValue('--hs-conversation-toolbar-height') !== toolbarHeight) style.setProperty('--hs-conversation-toolbar-height', toolbarHeight);
            if (style.getPropertyValue('--hs-conversation-heading-height') !== headingHeight) style.setProperty('--hs-conversation-heading-height', headingHeight);
        }
        window.addEventListener('scroll', function () {
            if (queued) return;
            queued = true;
            window.requestAnimationFrame(update);
        }, { passive: true });
        window.addEventListener('resize', update, { passive: true });
        update();
        // workspaceLabels moves controls and tags before this frame runs.
        requestAnimationFrame(update);
    }
    // Workflow editor (issue #130): name each row's controls for screen readers, such as "Value for To". The
    // Workflows module swaps the visible operator and value when the type changes, so the names follow the choice.
    function labelWorkflowRows() {
        if (!document.querySelector('.wf-blocks')) return;
        function label(block) {
            var type = block.querySelector('select.wf-block-type');
            if (!type) return;
            var pane = block.closest('.tab-pane');
            var kind = pane && pane.id === 'tab-actions' ? 'Action' : 'Condition';
            var option = type.options[type.selectedIndex];
            var name = type.value && option ? option.text.trim() : kind;
            type.setAttribute('aria-label', kind);
            block.querySelectorAll('.wf-block-operator select').forEach(function (control) {
                control.setAttribute('aria-label', 'Operator for ' + name);
            });
            block.querySelectorAll('.wf-block-value input, .wf-block-value select, .wf-block-value textarea').forEach(function (control) {
                if (control.type !== 'hidden') control.setAttribute('aria-label', 'Value for ' + name);
            });
        }
        function labelAll() { document.querySelectorAll('.wf-blocks .wf-or-block').forEach(label); }
        labelAll();
        document.addEventListener('change', function (e) {
            var block = e.target.closest && e.target.closest('.wf-or-block');
            if (block && e.target.matches('select.wf-block-type')) label(block);
        });
        // + AND and + OR add rows by cloning an existing one.
        document.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.wf-block-and-trigger, .wf-block-or-trigger')) setTimeout(labelAll, 0);
        });
    }
    // Privacy mode (issue #135): hides message text and contact details for screenshots and screen sharing. The user
    // menu turns it on; a pill says it is on and turns it off. The class is set in <head> (start.php), so pages never
    // flash content, and the CSS covers anything loaded later. It never changes data.
    function privacyMode() {
        var root = document.documentElement;
        function isOn() { return root.classList.contains('hs-privacy'); }
        function sync() {
            document.querySelectorAll('.hs-privacy-toggle').forEach(function (toggle) {
                toggle.setAttribute('aria-pressed', isOn() ? 'true' : 'false');
                var label = toggle.querySelector('.hs-privacy-label');
                if (label) label.textContent = isOn() ? 'Turn off privacy mode' : 'Privacy mode';
            });
            var pill = document.querySelector('.hs-privacy-pill');
            if (isOn() && !pill) {
                pill = document.createElement('div');
                pill.className = 'hs-privacy-pill';
                pill.setAttribute('role', 'status');
                var text = document.createElement('span');
                text.textContent = 'Privacy mode on';
                var off = document.createElement('button');
                off.type = 'button';
                off.className = 'hs-privacy-off';
                off.textContent = 'Show content';
                pill.appendChild(text);
                pill.appendChild(off);
                document.body.appendChild(pill);
            } else if (!isOn() && pill) {
                pill.remove();
            }
        }
        function set(on) {
            root.classList.toggle('hs-privacy', on);
            try { if (on) localStorage.setItem('hs-privacy', '1'); else localStorage.removeItem('hs-privacy'); } catch (e) { /* private window: this page only */ }
            sync();
        }
        document.addEventListener('click', function (e) {
            var control = e.target.closest && e.target.closest('.hs-privacy-toggle, .hs-privacy-off');
            if (!control) return;
            e.preventDefault();
            set(control.classList.contains('hs-privacy-off') ? false : !isOn());
        });
        // The menu item is a link acting as a button, so Space toggles it too.
        document.addEventListener('keydown', function (e) {
            if (e.key === ' ' && e.target.classList && e.target.classList.contains('hs-privacy-toggle')) { e.preventDefault(); e.target.click(); }
        });
        // Another tab turned it on or off.
        window.addEventListener('storage', function (e) {
            if (e.key === 'hs-privacy') { root.classList.toggle('hs-privacy', e.newValue === '1'); sync(); }
        });
        sync();
    }
    // Keep the native controls and their handlers. Labels and grouping are presentation only.
    function workspaceLabels() {
        workspaceLayout();
        workspaceAccessibility();
        function label(control, className, text) {
            if (!control || control.querySelector('.' + className)) return;
            var span = document.createElement('span');
            span.className = className;
            span.textContent = text;
            control.appendChild(span);
        }
        [['email-conv-switch', 'Email'], ['phone-conv-switch', 'Phone']].forEach(function (item) {
            var button = document.getElementById(item[0]);
            if (button) { button.setAttribute('aria-label', item[1] + ' conversation'); label(button, 'hs-compose-mode-label', item[1]); }
        });
        var folderToggle = document.querySelector('.sidebar-menu-toggle');
        if (folderToggle) {
            var menuLabel = document.querySelector('#folders') ? 'Folders' : (document.querySelector('.content-2col input[name="q"]') ? 'Filters' : 'Menu');
            folderToggle.textContent = menuLabel; folderToggle.setAttribute('aria-label', 'Show ' + menuLabel.toLowerCase());
            folderToggle.setAttribute('title', menuLabel); folderToggle.setAttribute('data-original-title', menuLabel);
        }
        var sidebar = document.querySelector('.sidebar-2col');
        var compose = sidebar && sidebar.querySelector('.sidebar-buttons [aria-label="New Conversation"]');
        var folders = sidebar && sidebar.querySelector('#folders');
        if (compose && folders && !sidebar.querySelector('.hs-compose')) {
            var wrap = document.createElement('div');
            wrap.className = 'hs-compose';
            label(compose, 'hs-compose-label', 'New conversation');
            wrap.appendChild(compose);
            folders.before(wrap);
        }
        label(document.getElementById('search-dt'), 'hs-search-label', 'Search mail');
        var searchInput = document.querySelector('.form-nav-search input[name="q"]');
        if (searchInput) { searchInput.setAttribute('aria-label', 'Search mail'); searchInput.placeholder = 'Search conversations and customers'; }
        document.querySelectorAll('.conv-next-prev a').forEach(function (link) {
            link.setAttribute('aria-label', link.getAttribute('data-original-title') || link.title || 'Next conversation');
        });
        var resultsSearch = document.querySelector('.content-2col input[name="q"]');
        if (resultsSearch) resultsSearch.setAttribute('aria-label', 'Search mail');
        var customerSettings = document.querySelector('.customer-trigger > a');
        if (customerSettings) customerSettings.setAttribute('aria-label', 'Customer settings');
        var settings = sidebar && sidebar.querySelector('.sidebar-buttons .dropdown-toggle');
        if (settings) {
            settings.setAttribute('aria-label', 'Mailbox settings');
            label(settings, 'hs-settings-label', 'Mailbox settings');
        }
        document.querySelectorAll('#conv-toolbar [title="Reply"], #conv-toolbar [title="Note"]').forEach(function (control) {
            label(control, 'hs-action-label', control.getAttribute('title'));
        });
        // Make return navigation readable on settings screens too.
        var back = sidebar && !sidebar.querySelector('#folders') && sidebar.querySelector('.btn-sidebar, .sidebar-buttons a[href*="/mailbox/"]');
        if (back) { back.setAttribute('aria-label', 'Back to inbox'); label(back, 'hs-settings-label', 'Back to inbox'); }
        // Label the original footer template before the editor clones it.
        document.querySelectorAll('body.body-conv select[name="status"], .conv-new select[name="status"]').forEach(function (control) {
            control.setAttribute('aria-label', 'Conversation status');
        });
        document.querySelectorAll('body.body-conv select[name="user_id"], .conv-new select[name="user_id"]').forEach(function (control) {
            control.setAttribute('aria-label', 'Assign to');
        });
    }
    function workspaceLayout() {
        if (document.documentElement.dataset.hsLayoutReady) return;
        document.documentElement.dataset.hsLayoutReady = '1';
        function make(tag, cls, text) {
            var el = document.createElement(tag); el.className = cls;
            if (text) el.textContent = text;
            return el;
        }
        function lists() {
            document.querySelectorAll('.table-conversations').forEach(function (table) {
                table.dataset.hsLayout = 'ready';
                var max = 0;
                table.querySelectorAll('tr.conv-row').forEach(function (row) {
                    var customer = row.querySelector('td.conv-customer > a');
                    if (customer) {
                        var name = customer.querySelector('.hs-customer-name');
                        if (!name) {
                            name = make('span', 'hs-customer-name');
                            var textNodes = Array.from(customer.childNodes).filter(function (node) { return node.nodeType === 3 && node.textContent.trim(); });
                            customer.insertBefore(name, textNodes[0] || customer.firstChild);
                            textNodes.forEach(function (node) { name.appendChild(node); });
                            name.title = name.textContent.trim();
                        }
                        var range = document.createRange();
                        Array.from(name.childNodes).forEach(function (node) {
                            range.selectNodeContents(node);
                            max = Math.max(max, range.getBoundingClientRect().width + (customer.querySelector('.conv-counter') ? 24 : 0));
                        });
                    }
                    var date = row.querySelector('td.conv-date > a');
                    if (date) {
                        var fullTime = date.textContent.trim();
                        var compactTime = fullTime.replace(/^(\d+)\s+(?:minutes?|mins?)\s+ago$/i, '$1m')
                            .replace(/^(\d+)\s+hours?\s+ago$/i, '$1h')
                            .replace(/^(\d+)\s+days?\s+ago$/i, '$1d')
                            .replace(/^(\d+)\s+weeks?\s+ago$/i, '$1w');
                        if (date.dataset.hsCompactTime !== compactTime) date.dataset.hsCompactTime = compactTime;
                        if (date.getAttribute('aria-label') !== fullTime) date.setAttribute('aria-label', fullTime);
                    }
                    var actions = row.querySelector('td.mailbox-close-column');
                    var copy = row.querySelector('.mailbox-copy-link');
                    if (actions) {
                        var group = actions.querySelector('.hs-row-actions');
                        if (!group) {
                            group = make('div', 'hs-row-actions');
                            while (actions.firstChild) group.appendChild(actions.firstChild);
                            actions.appendChild(group);
                        }
                        var more = group.querySelector('.hs-row-more');
                        if (!more) {
                            more = make('details', 'hs-row-more');
                            var trigger = make('summary', '', 'More');
                            trigger.setAttribute('aria-label', 'More conversation actions');
                            more.appendChild(trigger);
                            more.appendChild(make('div', 'hs-row-more-panel'));
                            more.addEventListener('click', function (event) { event.stopPropagation(); });
                            more.addEventListener('toggle', function () {
                                if (more.open && window.matchMedia('(width <= 1000px)').matches) {
                                    document.querySelectorAll('.hs-row-more[open]').forEach(function (other) { if (other !== more) other.open = false; });
                                }
                            });
                            more.addEventListener('keydown', function (event) {
                                if (event.key === 'Escape') { event.preventDefault(); more.open = false; trigger.focus(); }
                            });
                            group.appendChild(more);
                        }
                        var panel = more.querySelector('.hs-row-more-panel');
                        var compact = window.matchMedia('(width <= 1000px)').matches;
                        var destination = compact ? panel : group;
                        // Native details has an anonymous content box in Chromium. Move the
                        // real controls out on desktop so each action participates in flex layout.
                        [copy, group.querySelector('.mailbox-unsub-row')].forEach(function (control) {
                            if (control && control.parentNode !== destination) destination.appendChild(control);
                        });
                        more.hidden = !compact;
                        if (more.dataset.compact !== String(compact)) {
                            more.open = false; more.dataset.compact = String(compact);
                        }
                    }
                    var subject = row.querySelector('.conv-subject p:not(.conv-preview)');
                    var preview = row.querySelector('.conv-preview');
                    if (subject && preview) {
                        var normalise = function (text) { return text.replace(/\s+/g, ' ').trim(); };
                        preview.classList.toggle('hs-duplicate-preview', normalise(subject.textContent) === normalise(preview.textContent));
                    }
                    var tags = row.querySelector('.conv-subject .conv-tags');
                    if (tags && !tags.classList.contains('hs-row-tags')) {
                        tags.classList.add('hs-row-tags');
                        row.querySelector('td.conv-subject').appendChild(tags);
                        var all = Array.from(tags.querySelectorAll('.tag'));
                        all.forEach(function (tag) {
                            tag.title = tag.textContent.trim();
                            tag.setAttribute('tabindex', '0'); tag.setAttribute('role', 'link');
                        });
                        if (all.length > 1) {
                            var more = make('details', 'hs-more-tags');
                            more.appendChild(make('summary', '', '+' + (all.length - 1)));
                            var contents = make('span', 'hs-tag-popover');
                            all.slice(1).forEach(function (tag) { contents.appendChild(tag); });
                            more.appendChild(contents); tags.appendChild(more);
                        }
                    }
                });
                if (table.querySelector('col.conv-number') && Array.from(table.querySelectorAll('tr.conv-row')).every(function (row) { return row.querySelector('.mailbox-copy-link'); })) {
                    table.querySelectorAll('col.conv-number, th.conv-number, td.conv-number').forEach(function (el) { el.remove(); });
                    var nav = table.querySelector('tfoot .conv-nav');
                    if (nav && nav.colSpan > 1) nav.colSpan -= 1;
                }
                // Measure rendered text after fonts load; cap pathological names on narrow lists.
                var width = Math.ceil(Math.max(112, Math.min(max + 20, 260, table.clientWidth * 0.23)));
                if (table.style.getPropertyValue('--hs-customer-width') !== width + 'px') table.style.setProperty('--hs-customer-width', width + 'px');
            });
        }
        var navHeader = document.querySelector('.navbar-header');
        var originalSearch = document.querySelector('.form-nav-search');
        if (navHeader && originalSearch) {
            var mobileSearch = make('details', 'hs-mobile-search');
            mobileSearch.appendChild(make('summary', '', 'Search'));
            var form = make('form', 'hs-mobile-search-form');
            form.action = originalSearch.action; form.method = 'get';
            var searchLabel = make('label', '', 'Search mail'); searchLabel.htmlFor = 'hs-mobile-query';
            var input = make('input', 'form-control'); input.id = 'hs-mobile-query'; input.name = 'q'; input.type = 'search';
            input.placeholder = 'Conversations and customers'; input.autocomplete = 'off';
            var submit = make('button', 'btn btn-primary', 'Search'); submit.type = 'submit';
            form.append(searchLabel, input, submit); mobileSearch.appendChild(form); navHeader.appendChild(mobileSearch);
            mobileSearch.addEventListener('toggle', function () { if (mobileSearch.open) input.focus(); });
            mobileSearch.addEventListener('keydown', function (e) { if (e.key === 'Escape') { mobileSearch.open = false; mobileSearch.querySelector('summary').focus(); } });
        }
        if (document.body.classList.contains('hs-dashboard')) {
            var heading = document.querySelector('.heading');
            if (heading) heading.textContent = 'Your mailboxes';
            document.querySelectorAll('.dash-card').forEach(function (card) {
                card.querySelectorAll('.dash-card-list-item').forEach(function (link) {
                    var name = (link.childNodes[0].textContent || '').trim();
                    if (name === 'Starred') { link.remove(); return; }
                    var date = link.querySelector('.waiting-since');
                    if (date) date.textContent = 'Oldest: ' + date.textContent.replace(/^\s*\/\s*/, '');
                });
                var open = card.querySelector('.dash-card-footer a[data-original-title="Open Mailbox"], .dash-card-footer a[title="Open Mailbox"]');
                if (open) { open.appendChild(make('span', '', 'Open inbox')); open.classList.add('hs-open-inbox'); }
                var compose = card.querySelector('[aria-label="New Conversation"]');
                if (compose) compose.appendChild(make('span', '', 'Compose'));
                var details = make('details', 'hs-mailbox-details');
                var summary = make('summary', 'hs-mailbox-summary');
                var name = card.querySelector('h3').textContent.trim();
                summary.appendChild(make('span', 'hs-mailbox-summary-name', name));
                summary.appendChild(make('span', 'hs-mailbox-summary-toggle', 'Details'));
                var counts = make('span', 'hs-mailbox-summary-counts');
                Array.from(card.querySelectorAll('.dash-card-list-item')).slice(0, 2).forEach(function (link) {
                    var item = make('span', 'hs-mailbox-queue');
                    item.appendChild(make('span', '', link.childNodes[0].textContent.trim()));
                    item.appendChild(make('strong', '', link.querySelector('strong').textContent.trim()));
                    var oldest = link.querySelector('.waiting-since');
                    if (oldest) item.appendChild(make('small', '', oldest.textContent));
                    counts.appendChild(item);
                });
                summary.appendChild(counts); details.appendChild(summary);
                while (card.firstChild) details.appendChild(card.firstChild);
                card.appendChild(details);
                details.addEventListener('toggle', function () {
                    summary.querySelector('.hs-mailbox-summary-toggle').textContent = details.open ? 'Hide details' : 'Details';
                });
                var phoneDashboard = window.matchMedia('(width <= 1000px)');
                var cardBody = Array.from(details.children).filter(function (node) { return node !== summary; });
                function adaptCard() {
                    details.hidden = !phoneDashboard.matches;
                    details.open = !phoneDashboard.matches;
                    cardBody.forEach(function (node) { (phoneDashboard.matches ? details : card).appendChild(node); });
                }
                adaptCard(); phoneDashboard.addEventListener('change', adaptCard);
            });
        }
        var sidebar = document.getElementById('conv-layout-customer');
        if (sidebar && document.body.classList.contains('body-conv') && document.querySelector('#conv-layout-main .ct-toolbar')) {
            var overview = make('details', 'hs-overview conv-sidebar-block');
            overview.open = window.matchMedia('(width >= 768px)').matches;
            overview.appendChild(make('summary', 'hs-panel-title', 'Overview'));
            var fields = make('ul', 'conv-info hs-overview-fields');
            [['conv-status', 'Status'], ['conv-assignee', 'Assigned to'], ['conv-client', 'Client']].forEach(function (item) {
                var control = document.getElementById(item[0]);
                if (!control) return;
                var li = control.closest('li');
                li.insertBefore(make('span', 'hs-field-label', item[1]), control);
                fields.appendChild(li);
            });
            overview.appendChild(fields);
            var subjectText = document.querySelector('#conv-subject .conv-subjtext > span');
            if (subjectText) {
                subjectText.title = subjectText.textContent.trim();
                var fullSubject = make('section', 'hs-overview-subject');
                fullSubject.appendChild(make('h3', 'hs-field-label', 'Subject'));
                fullSubject.appendChild(make('p', '', subjectText.textContent.trim()));
                overview.appendChild(fullSubject);
            }
            document.querySelectorAll('.thread-person strong').forEach(function (sender) {
                sender.title = sender.textContent.trim();
            });
            // Move the native tag nodes, retaining IDs and directly bound native events.
            // The add-tag dropdown stays in the toolbar, outside the details disclosure.
            var conversationTags = document.getElementById('conv_tags');
            if (conversationTags) {
                var tagSection = make('section', 'hs-overview-tags');
                tagSection.appendChild(make('h3', 'hs-panel-title', 'Tags'));
                tagSection.appendChild(conversationTags); overview.appendChild(tagSection);
            }
            sidebar.prepend(overview);
            document.body.classList.add('hs-conversation-layout');
            var customer = sidebar.querySelector('.conv-customer-block');
            if (customer) {
                var customerHeading = make('div', 'hs-customer-heading');
                customerHeading.appendChild(make('h2', 'hs-panel-title', 'Customer'));
                // Move the native dropdown, keeping its handlers and menu intact.
                var customerTrigger = customer.querySelector('.customer-trigger');
                if (customerTrigger) customerHeading.appendChild(customerTrigger);
                customer.prepend(customerHeading);
            }
            var mobile = window.matchMedia('(width <= 1000px)');
            var context = Array.from(sidebar.children).filter(function (node) { return node !== overview && node.classList.contains('conv-sidebar-block'); });
            var reference = document.querySelector('.conv-numnav');
            var referenceSlot = document.createComment('Conversation reference');
            if (reference) reference.before(referenceSlot);
            function placeContext() {
                overview.open = !mobile.matches;
                overview.querySelector('summary').textContent = mobile.matches ? 'Conversation details' : 'Overview';
                context.forEach(function (node) { (mobile.matches ? overview : sidebar).appendChild(node); });
                if (reference) { if (mobile.matches) overview.appendChild(reference); else referenceSlot.after(reference); }
            }
            placeContext(); mobile.addEventListener('change', placeContext);
            var toolbar = document.querySelector('.ct-toolbar');
            if (toolbar) {
                var jump = make('button', 'hs-jump-reply', 'Jump to reply'); jump.type = 'button';
                jump.addEventListener('click', function () {
                    var reply = document.querySelector('.cc-composer, .conv-reply-block');
                    if (reply) {
                        var offset = ['conv-toolbar', 'conv-subject'].reduce(function (height, id) {
                            var sticky = document.getElementById(id);
                            return height + (sticky && /sticky|fixed/.test(getComputedStyle(sticky).position) ? sticky.getBoundingClientRect().height : 0);
                        }, 0);
                        // FreeScout overrides window.scrollTo with a jQuery helper.
                        document.scrollingElement.scrollTop = window.scrollY + reply.getBoundingClientRect().top - offset - 8;
                        var editor = reply.querySelector('[contenteditable="true"]'); if (editor) editor.focus({preventScroll:true});
                    }
                });
                toolbar.appendChild(jump);
            }
        }
        document.querySelectorAll('.hs-view-source').forEach(function (source) {
            if (source.querySelector('details')) return;
            var detail = make('details', 'hs-routing-details');
            detail.appendChild(make('summary', '', 'How this view works'));
            var body = make('div', 'hs-routing-body');
            while (source.firstChild) body.appendChild(source.firstChild);
            detail.appendChild(body);
            // Keep configuration problems visible even while the explanation is closed.
            if (/No rule adds|turned off|will not appear/.test(body.textContent)) source.appendChild(make('span', 'hs-routing-warning', 'Check routing rules for this view.'));
            source.appendChild(detail);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && event.target.matches('.hs-row-tags .tag')) { event.preventDefault(); event.target.click(); }
            if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.conv-actions [role="button"]:not(button)')) { event.preventDefault(); event.target.click(); }
        });
        document.querySelectorAll('.conv-actions [role="button"]:not(button)').forEach(function (el) { el.tabIndex = 0; });
        document.addEventListener('click', function (event) {
            if (!window.matchMedia('(width <= 1000px)').matches) return;
            document.querySelectorAll('.hs-row-more[open]').forEach(function (details) {
                if (!details.contains(event.target)) details.open = false;
            });
        });
        var scheduled = false;
        function schedule() {
            if (scheduled) return; scheduled = true;
            requestAnimationFrame(function () { scheduled = false; lists(); });
        }
        lists();
        if (document.fonts) document.fonts.ready.then(schedule);
        window.addEventListener('resize', schedule, {passive:true});
        var content = document.querySelector('.content-2col') || document.querySelector('.table-conversations');
        if (content) new MutationObserver(function (changes) {
            if (changes.some(function (change) { return Array.from(change.addedNodes).some(function (node) { return node.nodeType === 1 && (node.matches('tr, table, .mailbox-copy-link') || node.querySelector('tr.conv-row')); }); })) schedule();
        }).observe(content, {childList:true, subtree:true});
    }
    function workspaceAccessibility() {
        if (document.documentElement.dataset.hsAccessibilityReady) return;
        document.documentElement.dataset.hsAccessibilityReady = '1';
        var sequence = 0;
        function attr(node, name, value) {
            if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
        }
        function identify(node, prefix) {
            if (!node.id) node.id = prefix + (++sequence);
            return node.id;
        }
        function sync() {
            document.querySelectorAll('select.recipient-select, select#to_email, .conv-recipient select').forEach(function (select) {
                var group = select.closest('.form-group, .conv-recipient');
                if (!group) return;
                var label = Array.from(group.querySelectorAll('label')).find(function (candidate) { return candidate.htmlFor === select.id; }) || group.querySelector('label.control-label');
                if (!label) return;
                var id = identify(label, 'hs-recipient-label-');
                if (select.id) attr(label, 'for', select.id);
                group.querySelectorAll('.select2-selection, .select2-search__field').forEach(function (field) {
                    attr(field, 'aria-labelledby', id);
                });
            });
            document.querySelectorAll('.note-editable[contenteditable="true"]').forEach(function (editor) {
                var composer = editor.closest('.cc-composer, .conv-reply-block, .conv-new') || editor.parentElement;
                var hint = composer.querySelector('.cc-mode-hint');
                if (!hint) {
                    hint = composer.querySelector('.hs-editor-context');
                    if (!hint) {
                        hint = document.createElement('span'); hint.className = 'sr-only hs-editor-context';
                        composer.appendChild(hint);
                    }
                    var note = composer.classList.contains('conv-note-block') || composer.querySelector('input[name="is_note"][value="1"]');
                    var context = note ? 'Internal note. Only your team can read this message.' : 'Reply to customer.';
                    if (hint.textContent !== context) hint.textContent = context;
                }
                attr(editor, 'role', 'textbox'); attr(editor, 'aria-label', 'Message'); attr(editor, 'aria-multiline', 'true');
                var id = identify(hint, 'hs-editor-context-');
                var descriptions = (editor.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
                if (descriptions.indexOf(id) === -1) { descriptions.push(id); attr(editor, 'aria-describedby', descriptions.join(' ')); }
            });
            document.querySelectorAll('#conv_tags .tag-remove').forEach(function (control) {
                var name = control.parentElement.querySelector('.tag-name');
                attr(control, 'aria-label', 'Remove tag ' + (name ? name.textContent.trim() : ''));
            });
            document.querySelectorAll('.conv-add-tags').forEach(function (control) { attr(control, 'aria-label', 'Add tags'); attr(control, 'tabindex', '0'); });
            document.querySelectorAll('#add-tag-wrap .input-group-btn button').forEach(function (control) { attr(control, 'aria-label', 'Apply tags'); });
            document.querySelectorAll('.btn-send-menu').forEach(function (control) { attr(control, 'aria-label', 'Send options'); });
            document.querySelectorAll('.thread-options > .dropdown-toggle').forEach(function (control) {
                attr(control, 'aria-label', 'Message actions'); attr(control, 'tabindex', '0');
            });
            document.querySelectorAll('.sidebar-menu-toggle').forEach(function (toggle) {
                var menu = toggle.parentElement.querySelector('.sidebar-menu');
                if (!menu) return;
                var expanded = menu.classList.contains('active');
                var noun = document.querySelector('#folders') ? 'folders' : (document.querySelector('.content-2col input[name="q"]') ? 'filters' : 'menu');
                attr(toggle, 'aria-controls', identify(menu, 'hs-folder-menu-'));
                attr(toggle, 'aria-expanded', String(expanded));
                attr(toggle, 'aria-label', (expanded ? 'Hide ' : 'Show ') + noun);
            });
            document.querySelectorAll('.table-conversations').forEach(function (table) {
                var current = table.getAttribute('data-sorting_sort_by');
                var order = table.getAttribute('data-sorting_order');
                table.querySelectorAll('thead th').forEach(function (header) { attr(header, 'scope', 'col'); });
                table.querySelectorAll('.conv-col-sort').forEach(function (control) {
                    // Keep the original span and direct native click listener in place.
                    attr(control, 'role', 'button'); attr(control, 'tabindex', '0');
                    var name = control.textContent.replace(/[↑↓]/g, '').trim();
                    attr(control, 'aria-label', 'Sort by ' + name);
                    var header = control.closest('th');
                    if (header) attr(header, 'aria-sort', control.getAttribute('data-sort-by') === current ? (order === 'desc' ? 'descending' : 'ascending') : 'none');
                });
            });
            var subject = document.querySelector('#conv-subject .conv-subjtext > span');
            if (subject) { attr(subject, 'role', 'heading'); attr(subject, 'aria-level', '1'); }
            var main = document.querySelector('.content-2col');
            if (main && !document.querySelector('main, [role="main"]')) attr(main, 'role', 'main');
        }
        var scheduled = false;
        function schedule() {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(function () { scheduled = false; sync(); });
        }
        document.addEventListener('keydown', function (event) {
            // Bootstrap already activates this dropdown on Space; add the missing Enter path.
            if (event.key === 'Enter' && event.target.matches('.conv-new-tag.conv-add-tags')) {
                event.preventDefault(); event.target.click();
            }
            if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.thread-options > .dropdown-toggle')) {
                event.preventDefault(); event.target.click();
            }
            if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.conv-col-sort')) {
                event.preventDefault(); event.target.click(); schedule();
            }
            if (event.key === 'Escape') {
                var toggle = document.querySelector('.sidebar-menu-toggle.active');
                if (toggle) { event.preventDefault(); toggle.click(); toggle.focus(); schedule(); }
            }
        });
        // Native folder clicks stop bubbling. Class observation also covers outside-click dismissal.
        var content = document.querySelector('.content-2col') || document.body;
        var relevant = '#field-to, .field-cc, .recipient-select, .conv-recipient, .select2-container, .note-editor, .note-editable, .cc-composer, .cc-mode-hint, .conv-reply-block, .conv-col-sort, .table-conversations, .sidebar-menu, .sidebar-menu-toggle, .btn-send-menu, .conv-add-tags, #conv_tags, #conv_tags .tag, #conv_tags .tag-name';
        var observer = new MutationObserver(function (changes) {
            if (changes.some(function (change) {
                if (change.type === 'attributes') return change.target.matches(relevant);
                return Array.from(change.addedNodes).some(function (node) { return node.nodeType === 1 && (node.matches(relevant) || node.querySelector(relevant)); }) || change.target.matches('.cc-mode-hint, #conv_tags, #conv_tags .tag, #conv_tags .tag-name');
            })) schedule();
        });
        observer.observe(content, {childList:true, subtree:true, attributes:true, attributeFilter:['class', 'data-cc-mode', 'data-sorting_sort_by', 'data-sorting_order']});
        document.querySelectorAll('.sidebar-2col').forEach(function (sidebar) {
            if (!content.contains(sidebar)) observer.observe(sidebar, {subtree:true, attributes:true, attributeFilter:['class']});
        });
        sync();
        // workspaceLabels still updates the folder's initial name during this call stack.
        schedule();
    }
    function init() {
        // Avoid duplicate listeners if the theme is included more than once.
        if (document.documentElement.dataset.hsWorkspaceReady) return;
        document.documentElement.dataset.hsWorkspaceReady = '1';
        addListHeader(); watchToolbar(); labelWorkflowRows(); privacyMode(); workspaceLabels();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
