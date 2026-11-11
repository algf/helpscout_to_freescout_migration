const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const quickBox = { exports: {} };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../src/CrockdHelpScoutFolders/quick-close.js'), 'utf8'), { module: quickBox });
const { createCloser, createCoordinator, createRefreshQueue } = quickBox.exports;
const moduleBox = { exports: {} };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../src/UnSub/Resources/assets/unsub.js'), 'utf8'), { module: moduleBox });
const { createAction } = moduleBox.exports;

function setup() {
  const lock = createCoordinator(), requests = [], events = [], row = {};
  const shared = { ...lock, activity: n => events.push(['activity', n]), changed: () => events.push(['changed']), hideRow: r => events.push(['hide', r]) };
  const action = createAction({ shared: () => shared, busy: (b, n) => events.push(['busy', n]), request: (b, data, ok, fail) => requests.push({ data, ok, fail }), becomeLink: () => events.push(['link']), notify: (type, message) => events.push([type, message]), mark: () => events.push(['mark']), reload: () => events.push(['reload']) });
  const button = id => ({ dataset: { conversation: String(id) }, closest: () => row });
  return { lock, requests, events, row, action, button };
}

test('different tickets run concurrently; same ticket close and unsubscribe cannot overlap', () => {
  const x = setup(), closes = [];
  const close = createCloser({ begin: x.lock.begin, end: x.lock.end, canChange: () => true, setBusy() {}, activity() {}, hide: () => () => {}, folderId: () => '', request: (p, ok, fail) => closes.push({ p, ok, fail }), rowClosed() {}, error() {} });
  assert.equal(x.action(x.button(1)), true);
  assert.equal(close(1, 'row', {}), false);
  for (let i = 2; i <= 11; i++) assert.equal(close(i, 'row', {}), true);
  assert.equal(closes.length, 10);
  assert.equal(x.action(x.button(1)), false);
  x.requests[0].ok({ token: 't', items: [{ automatic: true, key: 'k' }] });
  x.requests[0].ok({ token: 't', items: [{ automatic: true, key: 'k' }] });
  assert.equal(x.requests.length, 2);
  x.requests[1].ok({ accepted: true, closed: true });
  x.requests[1].ok({ accepted: true, closed: true });
  assert.equal(x.events.filter(e => e[0] === 'hide').length, 1);
  assert.equal(x.events.filter(e => e[0] === 'changed').length, 1);
  assert.equal(x.events.filter(e => e[0] === 'success').length, 1);
  assert.equal(x.lock.begin(1), true);
});

test('failed or unconfirmed requests release their lock and never report success', () => {
  const x = setup();
  assert.equal(x.action(x.button(1)), true);
  x.requests[0].ok({ token: 't', items: [{ automatic: true, key: 'k' }] });
  x.requests[1].fail({});
  x.requests[1].ok({ accepted: true, closed: true });
  assert.equal(x.events.filter(e => e[0] === 'success').length, 0);
  assert.equal(x.events.filter(e => e[0] === 'hide').length, 0);
  assert.equal(x.action(x.button(1)), true);
  x.requests[2].fail({});
  assert.equal(x.lock.begin(1), true);
});

test('refresh discards an older response after another action starts', () => {
  const callbacks = [], timers = [], applied = [];
  const q = createRefreshQueue({ later: fn => (timers.push(fn), fn), cancel() {}, fetch: ok => callbacks.push(ok), apply: r => applied.push(r), error() {} });
  q.activity(1); q.changed(); q.activity(-1);
  timers.pop()();
  q.activity(1);
  callbacks[0]('stale');
  assert.deepEqual(applied, []);
  q.changed(); q.activity(-1); timers.pop()(); callbacks[1]('fresh');
  assert.deepEqual(applied, ['fresh']);
});

test('ten closes settle independently while unsubscribe is pending; activity balances', () => {
  const x = setup(), requests = [], activity = [], closed = [];
  const close = createCloser({ begin: x.lock.begin, end: x.lock.end, canChange: () => true, setBusy() {}, activity: n => activity.push(n), hide: () => () => {}, folderId: () => '', request: (p, ok, fail) => requests.push({ ok, fail }), rowClosed: id => closed.push(id), error() {} });
  assert.equal(x.action(x.button(1)), true);
  for (let i = 2; i <= 11; i++) assert.equal(close(i, 'row', {}), true);
  requests.forEach(r => r.ok({ status: 'success' }));
  assert.equal(closed.length, 10);
  assert.equal(activity.reduce((a, b) => a + b, 0), 0);
  assert.equal(x.lock.begin(1), false);
  x.requests[0].ok({ token: 't', items: [{ automatic: true, key: 'k' }] });
  x.requests[1].ok({ accepted: true, closed: false });
  assert.equal(x.events.filter(e => e[0] === 'hide').length, 0);
  assert.equal(x.events.filter(e => e[0] === 'changed').length, 0);
  assert.equal(x.events.filter(e => e[0] === 'mark').length, 1);
  assert.equal(x.events.filter(e => e[0] === 'activity').reduce((a, e) => a + e[1], 0), 0);
});

test('unsubscribe cannot start while close owns the same ticket', () => {
  const x = setup(), requests = [];
  const close = createCloser({ begin: x.lock.begin, end: x.lock.end, canChange: () => true, setBusy() {}, activity() {}, hide: () => () => {}, folderId: () => '', request: (p, ok, fail) => requests.push({ ok, fail }), rowClosed() {}, error() {} });
  assert.equal(close(1, 'row', {}), true);
  assert.equal(x.action(x.button(1)), false);
  assert.equal(x.requests.length, 0);
  requests[0].fail();
  assert.equal(x.action(x.button(1)), true);
});

test('bulk close aborts without side effects when any selected ticket is locked', () => {
  const lock = createCoordinator(), messages = [], requests = [], hidden = [];
  lock.begin(2);
  const button = { disabled: false, addEventListener: (_name, fn) => { button.click = fn; } };
  const boxes = [1, 2, 3].map(value => ({ value, closest: () => ({ querySelector: () => true }) }));
  const toolbar = { dataset: {}, getClientRects: () => [1], querySelector: selector => selector === '.inbox-close-selected' ? button : { classList: { contains: () => false } } };
  const document = { readyState: 'complete', getElementById: () => toolbar, querySelector: () => ({ querySelectorAll: () => boxes }), addEventListener() {} };
  const window = { crockdQuickClose: { ...lock, hideRow: r => hidden.push(r), activity() {}, changed() {} }, fsAjax: (...args) => requests.push(args), laroute: { route: () => '' }, showFloatingAlert: (_type, msg) => messages.push(msg) };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../src/InboxShortcuts/Resources/assets/inbox-shortcuts.js'), 'utf8'), { document, window });
  assert.equal(button.click(), false);
  assert.equal(requests.length, 0); assert.equal(hidden.length, 0);
  assert.match(messages[0], /being updated/);
  assert.equal(lock.begin(1), true); assert.equal(lock.begin(2), false); assert.equal(lock.begin(3), true);
});

test('legacy shared object without coordination falls back safely', () => {
  const requests = [], events = [];
  const action = createAction({ shared: () => ({ hideRow() {} }), busy: (b, n) => events.push(n), request: (b, data, ok) => requests.push(ok), mark: () => events.push('marked'), notify: type => events.push(type), becomeLink() {}, reload() {} });
  assert.equal(action({ dataset: { conversation: '1' }, closest: () => null }), true);
  requests[0]({ token: 't', items: [{ automatic: true, key: 'k' }] });
  requests[1]({ accepted: true, closed: false });
  assert.deepEqual(events, [true, 'marked', false, 'success']);
});

test('screen hide failure retains confirmed outcome, refresh and releases lock', () => {
  const lock = createCoordinator(), requests = [], events = [];
  const shared = { ...lock, activity: n => events.push(['activity', n]), changed: () => events.push(['changed']), hideRow: () => { throw Error('screen'); } };
  const action = createAction({ shared: () => shared, busy: (b, n) => events.push(['busy', n]), request: (b, d, ok) => requests.push(ok), notify: (type, message) => events.push([type, message]), mark() {}, becomeLink() {}, reload() {} });
  action({ dataset: { conversation: '1' }, closest: () => ({}) });
  requests[0]({ token: 't', items: [{ automatic: true, key: 'k' }] });
  requests[1]({ accepted: true, closed: true });
  assert.equal(events.filter(e => e[0] === 'changed').length, 1);
  assert.match(events.find(e => e[0] === 'error')[1], /Unsubscribed and closed.*refresh/);
  assert.equal(events.filter(e => e[0] === 'activity').reduce((a, e) => a + e[1], 0), 0);
  assert.equal(lock.begin(1), true);
});

test('resumed unsubscribe polls read-only, holds only its ticket, and refreshes on completion', () => {
  const { createResume } = moduleBox.exports, lock = createCoordinator(), calls = [], timers = [], events = [];
  let now = 0;
  const shared = { ...lock, activity: n => events.push(['activity', n]), hideRow: () => events.push(['hide']), changed: () => events.push(['changed']) };
  const resume = createResume({ shared: () => shared, clear: id => events.push(['clear', id]), now: () => now, later: fn => timers.push(fn), row: () => ({}), notify: (type, msg) => events.push([type, msg]), request: (record, ok, fail) => calls.push({ record, ok, fail }) });
  assert.equal(resume({ id: '1', expires: 120000 }), true);
  assert.equal(lock.begin(1), false); assert.equal(lock.begin(2), true);
  calls[0].ok({ state: 'pending' }); now += 1000; timers.shift()();
  calls[1].ok({ state: 'complete', result: { accepted: true, closed: true } });
  assert.equal(events.filter(e => e[0] === 'hide').length, 1);
  assert.equal(events.filter(e => e[0] === 'changed').length, 1);
  assert.equal(events.filter(e => e[0] === 'activity').reduce((a, e) => a + e[1], 0), 0);
  assert.equal(lock.begin(1), true);
});

test('unknown status gets bounded grace then releases lock with uncertainty', () => {
  const { createResume } = moduleBox.exports, lock = createCoordinator(), timers = [], events = [];
  let now = 0;
  const shared = { ...lock, activity: n => events.push(['activity', n]), hideRow() {}, changed() {} };
  createResume({ shared: () => shared, clear: id => events.push(['clear', id]), now: () => now, later: fn => timers.push(fn), row() {}, notify: (type, msg) => events.push([type, msg]), request: (record, ok) => ok({ state: 'unknown' }) })({ id: '1', expires: 120000 });
  for (let i = 0; i < 3; i++) { now += 1000; timers.shift()(); }
  assert.match(events.find(e => e[0] === 'error')[1], /Could not confirm/);
  assert.equal(lock.begin(1), true);
  assert.equal(events.filter(e => e[0] === 'activity').reduce((a, e) => a + e[1], 0), 0);
});

test('direct and resumed unsubscribe mark only their target busy and restore it', () => {
  const x = setup(), state = new Map([[1, false], [2, false]]), events = [];
  const pending = (id, on) => { state.set(Number(id), on); events.push([Number(id), on]); };
  const requests = [], action = createAction({ shared: () => ({ ...x.lock, activity() {}, changed() {}, hideRow() {} }), pending, busy() {}, request: (b, d, ok) => requests.push(ok), mark() {}, notify() {}, becomeLink() {}, reload() {} });
  action(x.button(1));
  assert.equal(state.get(1), true); assert.equal(state.get(2), false);
  requests[0]({ token: 't', items: [{ automatic: true, key: 'k' }] });
  requests[1]({ accepted: true, closed: false });
  assert.equal(state.get(1), false);
  const resume = moduleBox.exports.createResume({ shared: () => ({ ...x.lock, activity() {}, changed() {}, hideRow() {} }), pending, clear() {}, now: () => 0, later() {}, row() {}, notify() {}, request: (r, ok) => { assert.equal(state.get(2), true); ok({ state: 'complete', result: { accepted: true, closed: false } }); }, mark: id => events.push(['mark', id]) });
  resume({ id: '2', expires: 1000 });
  assert.equal(state.get(1), false); assert.equal(state.get(2), false);
  assert.deepEqual(events, [[1, true], [1, false], [2, true], ['mark', '2'], [2, false]]);
});

test('transient status failures back off and recover without clearing the pending record', () => {
  const calls = [], timers = [], events = [];
  let now = 0;
  moduleBox.exports.createResume({ shared: () => null, clear: id => events.push(['clear', id]), now: () => now, later: (fn, delay) => timers.push({ fn, delay }), row() {}, notify: (type, msg) => events.push([type, msg]), request: (record, ok, fail) => calls.push({ ok, fail }) })({ id: '1', expires: 120000 });
  calls[0].fail({ status: 0 }); assert.equal(timers[0].delay, 1000); assert.equal(events.length, 0);
  now += 1000; timers.shift().fn(); calls[1].fail({ status: 503 }); assert.equal(timers[0].delay, 2000);
  now += 2000; timers.shift().fn(); calls[2].ok({ state: 'complete', result: { accepted: true, closed: true } });
  assert.equal(events.filter(e => e[0] === 'clear').length, 1); assert.equal(events.filter(e => e[0] === 'success').length, 1);
});

test('status 403 is terminal while transient failures stop at expiry', () => {
  for (const status of [403, 0]) {
    const timers = [], events = []; let now = 0;
    moduleBox.exports.createResume({ shared: () => null, clear: () => events.push('clear'), now: () => now, later: (fn, delay) => timers.push({ fn, delay }), row() {}, notify: type => events.push(type), request: (record, ok, fail) => fail({ status }) })({ id: '1', expires: 1000 });
    if (status === 0) { assert.deepEqual(events, []); now = 1000; timers.shift().fn(); }
    assert.deepEqual(events, ['clear', 'error']);
    assert.equal(timers.length, 0);
  }
});

test('double-tap detail does not suppress a different row; duplicate ticket remains blocked', () => {
  const handlers = {}, requests = [];
  const document = { documentElement: { dataset: {} }, body: {}, addEventListener: (name, fn) => { handlers[name] = fn; }, querySelectorAll: () => [], querySelector: () => null };
  const window = { document, jQuery() {}, addEventListener() {}, setTimeout() {}, clearTimeout() {}, location: { href: 'http://localhost/' }, fsAjax: (payload, route, ok) => requests.push({ payload, ok }), laroute: { route: () => '' }, showFloatingAlert() {} };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../src/CrockdHelpScoutFolders/quick-close.js'), 'utf8'), { window, document, MutationObserver: class { observe() {} }, URL, Set });
  const button = id => ({ disabled: false, dataset: { conversationId: String(id), closeMode: 'row' }, setAttribute() {}, closest: () => null });
  const tap = (b, detail) => handlers.click({ target: { closest: () => b }, detail, preventDefault() {}, stopPropagation() {} });
  const one = button(1), two = button(2);
  tap(one, 1); tap(two, 2); tap(one, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(r => r.payload.conversation_id), [1, 2]);
});

test('resume blocks list refresh only when target row is visible', () => {
  for (const visible of [false, true]) {
    const events = [], lock = createCoordinator(); let complete;
    const shared = { ...lock, activity: n => events.push(['activity', n]), hideRow: () => events.push(['hide']), changed: () => events.push(['changed']) };
    moduleBox.exports.createResume({ shared: () => shared, row: () => visible ? {} : null, clear() {}, now: () => 0, later() {}, notify() {}, request: (r, ok) => { complete = ok; } })({ id: '1', expires: 1000 });
    assert.deepEqual(events.filter(e => e[0] === 'activity'), visible ? [['activity', 1]] : []);
    assert.equal(lock.begin(1), false);
    complete({ state: 'complete', result: { accepted: true, closed: true } });
    assert.deepEqual(events.filter(e => e[0] === 'activity'), visible ? [['activity', 1], ['activity', -1]] : []);
    assert.equal(events.filter(e => e[0] === 'changed').length, visible ? 1 : 0);
  }
});

test('resume reloads only the matching current conversation after confirmed close', () => {
  for (const current of [false, true]) {
    let reloads = 0, complete;
    const lock = createCoordinator();
    moduleBox.exports.createResume({ shared: () => ({ ...lock, activity() {}, hideRow() {}, changed() {} }), row: () => null, isCurrent: () => current, reload: () => reloads++, clear() {}, now: () => 0, later() {}, notify() {}, request: (r, ok) => { complete = ok; } })({ id: '1', expires: 1000 });
    complete({ state: 'complete', result: { accepted: true, closed: true } });
    complete({ state: 'complete', result: { accepted: true, closed: true } });
    assert.equal(reloads, current ? 1 : 0);
  }
});

test('close request pool caps concurrency, drains FIFO and ignores duplicate callbacks', () => {
  const { createRequestPool } = quickBox.exports, started = [], finished = [];
  const pool = createRequestPool((id, ok, fail) => started.push({ id, ok, fail }), 3);
  for (let i = 1; i <= 5; i++) pool(i, () => finished.push(i), () => finished.push(-i));
  assert.deepEqual(started.map(x => x.id), [1, 2, 3]);
  started[1].ok(); started[1].fail();
  assert.deepEqual(started.map(x => x.id), [1, 2, 3, 4]);
  started[0].fail();
  assert.deepEqual(started.map(x => x.id), [1, 2, 3, 4, 5]);
  started[2].ok(); started[3].ok(); started[4].ok();
  assert.deepEqual(finished, [2, -1, 3, 4, 5]);
});

test('pool handles synchronous exceptions and settles forty queued requests', () => {
  const { createRequestPool } = quickBox.exports, started = [], results = [];
  const pool = createRequestPool((id, ok, fail) => { if (id === 1) throw Error('request'); started.push({ id, ok, fail }); }, 3);
  for (let i = 1; i <= 40; i++) pool(i, () => results.push(i), () => results.push(-i));
  assert.deepEqual(started.map(x => x.id), [2, 3, 4]);
  for (let i = 0; i < 39; i++) started[i].ok();
  assert.equal(results.length, 40); assert.equal(results[0], -1);
  assert.deepEqual(started.map(x => x.id), Array.from({ length: 39 }, (_, i) => i + 2));
});

test('pagehide handoff flushes only unsent jobs once and active callbacks cannot replay them', () => {
  const { createRequestPool } = quickBox.exports, active = [], sent = [], completed = [];
  const pool = createRequestPool((id, ok, fail) => active.push({ id, ok, fail }), 3);
  for (let i = 1; i <= 6; i++) pool(i, () => completed.push(i), () => completed.push(-i));
  const handoff = (id, ok, fail) => sent.push({ id, ok, fail });
  assert.equal(pool.flushQueued(handoff), 3);
  assert.equal(pool.flushQueued(handoff), 0);
  assert.deepEqual(active.map(x => x.id), [1, 2, 3]);
  assert.deepEqual(sent.map(x => x.id), [4, 5, 6]);
  active[0].ok(); active[0].fail();
  sent[0].fail(); sent[0].ok(); sent[1].ok(); sent[2].ok();
  active[1].ok(); active[2].ok();
  assert.equal(active.length, 3);
  assert.deepEqual(completed, [1, -4, 5, 6, 2, 3]);
});
