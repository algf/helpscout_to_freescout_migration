const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '../src/CrockdHelpScoutFolders/quick-close.js');
const loaded = new Module(source + '.cjs', module);
loaded._compile(fs.readFileSync(source, 'utf8'), source + '.cjs');
const { createCloser, createRefreshQueue, restoreScroll, createRowHider } = loaded.exports;

test('scroll restoration avoids FreeScout’s element-based global scrollTo helper', () => {
    const scroller = { scrollLeft: 0, scrollTop: 0 };
    const browser = {
        document: { scrollingElement: scroller },
        scrollTo() { throw new TypeError("Cannot read properties of undefined (reading 'top')"); },
    };
    restoreScroll(browser, 20, 480);
    assert.deepEqual(scroller, { scrollLeft: 20, scrollTop: 480 });
});

function harness(overrides = {}) {
    const calls = { requests: [], busy: [], errors: [], navigation: [], reloads: 0, closed: [], activity: [] };
    const close = createCloser({
        canChange: () => true,
        setBusy: value => calls.busy.push(value),
        folderId: () => '58',
        request: (payload, success, failure) => calls.requests.push({ payload, success, failure }),
        reload: () => calls.reloads++,
        rowClosed: id => calls.closed.push(id),
        activity: delta => calls.activity.push(delta),
        navigate: url => calls.navigation.push(url),
        error: message => calls.errors.push(message),
        ...overrides,
    });
    return { close, calls };
}

test('row closes exactly one conversation and keeps the current list', () => {
    const { close, calls } = harness();
    assert.equal(close('123', 'row'), true);
    assert.deepEqual(calls.requests[0].payload, {
        action: 'conversation_change_status', conversation_id: 123, status: 3, folder_id: '58', x_embed: 1,
    });
    calls.requests[0].success({ status: 'success', redirect_url: '/conversation/123' });
    assert.equal(calls.reloads, 0);
    assert.deepEqual(calls.closed, [123]);
    assert.deepEqual(calls.navigation, []);
});

test('email follows the native post-close navigation preference', () => {
    const { close, calls } = harness();
    close(456, 'conversation');
    assert.equal(calls.requests[0].payload.x_embed, undefined);
    calls.requests[0].success({ status: 'success', redirect_url: '/conversation/789?folder_id=58' });
    assert.deepEqual(calls.navigation, ['/conversation/789?folder_id=58']);
    assert.equal(calls.reloads, 0);
});

test('different rows can close concurrently but duplicates are blocked', () => {
    const { close, calls } = harness();
    close(123, 'row');
    assert.equal(close(123, 'row'), false);
    assert.equal(close(456, 'row'), true);
    calls.requests[0].success({ status: 'success' });
    assert.equal(close(123, 'row'), false);
    assert.equal(calls.requests.length, 2);
});

test('invalid targets and modes never issue a request', () => {
    const { close, calls } = harness();
    for (const id of [0, -1, 1.5, '', '123,456', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(close(id, 'row'), false);
    }
    assert.equal(close(123, 'bulk'), false);
    assert.equal(calls.requests.length, 0);
});

test('native status-change filter can veto the action', () => {
    let trigger;
    const { close, calls } = harness({ canChange: button => { trigger = button; return false; } });
    const button = {};
    assert.equal(close(123, 'row', button), false);
    assert.equal(trigger, button);
    assert.equal(calls.requests.length, 0);
    assert.deepEqual(calls.busy, []);
});

test('server rejection shows the native error and permits deliberate retry', () => {
    const { close, calls } = harness();
    close(123, 'row');
    calls.requests[0].success({ status: 'error', msg: 'Not authorised' });
    assert.deepEqual(calls.errors, ['Not authorised']);
    assert.deepEqual(calls.busy, [true, false]);
    assert.equal(calls.reloads, 0);
    assert.equal(close(123, 'row'), true);
});

test('network uncertainty unlocks controls with a refresh instruction', () => {
    const { close, calls } = harness();
    close(123, 'row');
    calls.requests[0].failure();
    assert.match(calls.errors[0], /could not be confirmed.*refresh/);
    assert.deepEqual(calls.busy, [true, false]);
    assert.equal(calls.reloads, 0);
});

test('synchronous request failure does not leave controls locked', () => {
    const { close, calls } = harness({ request: () => { throw new Error('request unavailable'); } });
    close(123, 'conversation');
    assert.deepEqual(calls.busy, [true, false]);
    assert.match(calls.errors[0], /refresh/);
});

function refreshHarness() {
    let timer;
    const calls = { reads: [], applied: [], errors: [] };
    const queue = createRefreshQueue({
        later: fn => { timer = fn; return 1; },
        cancel: () => { timer = null; },
        fetch: (ok, fail) => calls.reads.push({ ok, fail }),
        apply: page => calls.applied.push(page),
        error: message => calls.errors.push(message),
    });
    return { queue, calls, tick: () => { const fn = timer; timer = null; if (fn) fn(); } };
}

test('rapid closes coalesce into a single refresh after all writes finish', () => {
    const { queue, calls, tick } = refreshHarness();
    queue.activity(1); queue.activity(1);
    queue.changed(); queue.activity(-1); tick();
    assert.equal(calls.reads.length, 0);
    queue.changed(); queue.activity(-1); tick();
    assert.equal(calls.reads.length, 1);
    calls.reads[0].ok('latest table');
    assert.deepEqual(calls.applied, ['latest table']);
});

test('stale refresh cannot bring back a row closed by a newer request', () => {
    const { queue, calls, tick } = refreshHarness();
    queue.activity(1); queue.changed(); queue.activity(-1); tick();
    queue.activity(1);
    calls.reads[0].ok('stale table');
    assert.deepEqual(calls.applied, []);
    queue.changed(); queue.activity(-1); tick();
    calls.reads[1].ok('current table');
    assert.deepEqual(calls.applied, ['current table']);
});

test('refresh failure reports stale counts without retrying the close', () => {
    const { queue, calls, tick } = refreshHarness();
    queue.changed(); tick(); calls.reads[0].fail(); tick();
    assert.equal(calls.reads.length, 1);
    assert.equal(calls.errors.length, 1);
    assert.deepEqual(calls.applied, []);
});

test('settled callbacks cannot double-update the row or activity count', () => {
    const { close, calls } = harness();
    close(123, 'row');
    calls.requests[0].success({status: 'success'});
    calls.requests[0].success({status: 'success'});
    calls.requests[0].failure();
    assert.deepEqual(calls.closed, [123]);
    assert.deepEqual(calls.activity, [1,-1]);
    assert.deepEqual(calls.errors, []);
});

// ---------- Optimistic close (24 Sep 2026) ----------


test('row leaves the list before the server answers, and stays gone on success', () => {
    const hidden = [], undone = [];
    const { close, calls } = harness({ hide: id => { hidden.push(id); return () => undone.push(id); } });
    close(123, 'row');
    assert.deepEqual(hidden, [123]);
    assert.equal(calls.requests.length, 1);
    calls.requests[0].success({ status: 'success' });
    assert.deepEqual(undone, []);
    assert.deepEqual(calls.closed, [123]);
});

test('server refusal puts the row back and shows the error', () => {
    const undone = [];
    const { close, calls } = harness({ hide: id => () => undone.push(id) });
    close(123, 'row');
    calls.requests[0].success({ status: 'error', msg: 'Not authorised' });
    assert.deepEqual(undone, [123]);
    assert.deepEqual(calls.errors, ['Not authorised']);
    assert.deepEqual(calls.closed, []);
    assert.equal(close(123, 'row'), true);
});

test('network failure puts the row back', () => {
    const undone = [];
    const { close, calls } = harness({ hide: id => () => undone.push(id) });
    close(123, 'row');
    calls.requests[0].failure();
    assert.deepEqual(undone, [123]);
    assert.match(calls.errors[0], /could not be confirmed/);
});

test('closing from inside a conversation never hides anything', () => {
    const hidden = [];
    const { close } = harness({ hide: id => { hidden.push(id); return () => {}; } });
    close(456, 'conversation');
    assert.deepEqual(hidden, []);
});

test('vetoed close does not hide the row', () => {
    const hidden = [];
    const { close } = harness({ canChange: () => false, hide: id => { hidden.push(id); return () => {}; } });
    assert.equal(close(123, 'row'), false);
    assert.deepEqual(hidden, []);
});

function fakeDom({ active = true, checked = false, label = 'Active Conversations', count = '10', title = '(10) Unassigned - Crockd' } = {}) {
    const attrs = {};
    const badge = { textContent: count, getAttribute: n => (n === 'data-original-title' ? label : null) };
    const folder = { querySelector: () => badge, setAttribute: (n, v) => { attrs[n] = v; } };
    const doc = { title, querySelector: s => (s === '#folders > li.active' ? folder : null) };
    const classes = new Set(['conv-row'].concat(active ? ['conv-active'] : []).concat(checked ? ['selected'] : []));
    const checkbox = { checked };
    const rowAttrs = {};
    const row = {
        isConnected: true, style: { display: '' },
        classList: { contains: c => classes.has(c), remove: c => classes.delete(c) },
        querySelector: () => checkbox,
        getAttribute: n => rowAttrs[n] || null, setAttribute: (n, v) => { rowAttrs[n] = v; }, removeAttribute: n => { delete rowAttrs[n]; },
    };
    const triggered = [];
    const jq = el => ({ trigger: ev => triggered.push([el, ev]) });
    return { doc, badge, row, checkbox, triggered, attrs, jq };
}

test('hiding an active row decrements the folder badge and title; undo restores both', () => {
    const d = fakeDom();
    const undo = createRowHider(d.doc, d.jq)(d.row);
    assert.equal(d.row.style.display, 'none');
    assert.equal(d.badge.textContent, '9');
    assert.equal(d.doc.title, '(9) Unassigned - Crockd');
    undo();
    assert.equal(d.row.style.display, '');
    assert.equal(d.badge.textContent, '10');
    assert.equal(d.doc.title, '(10) Unassigned - Crockd');
});

test('hiding a selected row clears its selection so bulk actions never include it', () => {
    const d = fakeDom({ checked: true });
    createRowHider(d.doc, d.jq)(d.row);
    assert.equal(d.checkbox.checked, false);
    assert.equal(d.triggered.length, 1);
});

test('pending rows and total-count folders keep their badge', () => {
    const pending = fakeDom({ active: false });
    createRowHider(pending.doc, pending.jq)(pending.row);
    assert.equal(pending.badge.textContent, '10');
    const totals = fakeDom({ label: 'Pending Conversations' });
    createRowHider(totals.doc, totals.jq)(totals.row);
    assert.equal(totals.badge.textContent, '10');
});

test('a row replaced by a refresh is not resurrected by a late undo', () => {
    const d = fakeDom();
    const undo = createRowHider(d.doc, d.jq)(d.row);
    d.row.isConnected = false;
    undo();
    assert.equal(d.row.style.display, 'none');
});

test('an emptied list refreshes at once instead of after the 600 ms batch window', () => {
    let delay;
    const calls = { reads: [] };
    const queue = createRefreshQueue({
        empty: () => true,
        later: (fn, ms) => { delay = ms; return 1; },
        cancel: () => {},
        fetch: (ok) => calls.reads.push(ok),
        apply: () => {},
        error: () => {},
    });
    queue.changed();
    assert.equal(delay, 0);
});

test('refresh waits, without fetching, while another control owns a row (Unsubscribe in flight)', () => {
    let timer, blocked = true;
    const calls = { reads: [] };
    const queue = createRefreshQueue({
        blocked: () => blocked,
        later: fn => { timer = fn; return 1; },
        cancel: () => {},
        fetch: ok => calls.reads.push(ok),
        apply: () => {},
        error: () => {},
    });
    queue.changed();
    timer();
    assert.equal(calls.reads.length, 0);
    blocked = false;
    timer();
    assert.equal(calls.reads.length, 1);
});
