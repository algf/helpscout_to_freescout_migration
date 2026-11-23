const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const load = (file, extra = {}) => { const box = { exports: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { module: box, ...extra }); return box.exports; };
const { createAssigner, menuChoices, successMessage } = load('../src/Modules/CrockdHelpScoutFolders/row-assign.js');
// Values made inside the script's own context have other prototypes; compare their data.
const plain = value => JSON.parse(JSON.stringify(value));
const { createCoordinator } = load('../../action-speed/src/CrockdHelpScoutFolders/quick-close.js');

function setup() {
  const lock = createCoordinator(), requests = [], events = [];
  const shared = { ...lock, activity: n => events.push(['activity', n]), changed: () => events.push(['changed']) };
  const assign = createAssigner({
    shared: () => shared,
    request: (payload, ok, fail) => requests.push({ payload, ok, fail }),
    busy: (button, on) => events.push(['busy', on]),
    assigned: (button, userId, label) => events.push(['assigned', userId, label]),
    notify: (type, message) => events.push([type, message]),
  });
  return { lock, requests, events, assign };
}

test('assign sends FreeScout\'s own single-conversation action for one email, inside the list', () => {
  const { requests, assign } = setup();
  assert.equal(assign('123', '7', '-1', {}, 'Alex Example'), true);
  assert.deepEqual(plain(requests[0].payload), { action: 'conversation_change_user', conversation_id: 123, user_id: 7, x_embed: 1 });
});

test('success updates the button, refreshes the list, releases the lock and names the person', () => {
  const { lock, requests, events, assign } = setup();
  assign(123, 7, -1, {}, 'Alex Example');
  assert.equal(lock.begin(123), false, 'email is locked while the request runs');
  requests[0].ok({ status: 'success' });
  assert.deepEqual(events, [['busy', true], ['activity', 1], ['assigned', 7, 'Alex Example'], ['changed'], ['busy', false], ['activity', -1], ['success', 'Assigned to Alex Example.']]);
  assert.equal(lock.begin(123), true, 'lock released');
});

test('Anyone and Me read naturally', () => {
  assert.equal(successMessage(-1, 'Anyone'), 'Unassigned. Anyone can pick it up.');
  assert.equal(successMessage(1, 'Me'), 'Assigned to you.');
});

test('a server refusal shows its reason, changes nothing on screen and releases the lock', () => {
  const { lock, requests, events, assign } = setup();
  assign(123, 55, -1, {}, 'Jo Other');
  requests[0].ok({ status: 'error', msg: 'Not enough permissions' });
  assert.ok(!events.some(e => e[0] === 'assigned' || e[0] === 'changed'));
  assert.deepEqual(events.at(-1), ['error', 'Not enough permissions']);
  assert.equal(lock.begin(123), true);
});

test('a dropped connection says the result is unknown and never reports success', () => {
  const { requests, events, assign } = setup();
  assign(123, 7, -1, {}, 'Alex Example');
  requests[0].fail({ status: 0 });
  requests[0].ok({ status: 'success' });
  assert.ok(!events.some(e => e[0] === 'success'));
  assert.match(events.at(-1)[1], /could not be confirmed/);
  assert.equal(events.filter(e => e[0] === 'activity').reduce((n, e) => n + e[1], 0), 0, 'activity balances');
});

test('an email busy with Close or Unsubscribe cannot be assigned at the same time', () => {
  const { lock, requests, events, assign } = setup();
  lock.begin(123);
  assert.equal(assign(123, 7, -1, {}, 'Alex Example'), false);
  assert.equal(requests.length, 0);
  assert.match(events.at(-1)[1], /busy/);
});

test('choosing the current assignee or an invalid id sends nothing', () => {
  const { requests, assign } = setup();
  assert.equal(assign(123, 7, '7', {}, 'Alex Example'), false);
  assert.equal(assign(123, 0, -1, {}, 'x'), false);
  assert.equal(assign('abc', 7, -1, {}, 'x'), false);
  assert.equal(requests.length, 0);
});

test('menu choices are exactly the bulk bar Assignee entries, in order, without duplicates or disabled people', () => {
  const link = (id, text, disabled) => ({ getAttribute: () => String(id), textContent: text, classList: { contains: c => c === 'disabled' && !!disabled } });
  const doc = { querySelectorAll: selector => { assert.equal(selector, '#conversations-bulk-actions .conv-user li > a[data-user_id]'); return [link(-1, 'Anyone'), link(1, ' Me '), link(7, 'Alex  Example'), link(8, 'Sam Example'), link(7, 'Alex Example'), link(9, 'Away', true), link('x', 'Bad')]; } };
  assert.deepEqual(plain(menuChoices(doc)), [{ id: -1, label: 'Anyone' }, { id: 1, label: 'Me' }, { id: 7, label: 'Alex Example' }, { id: 8, label: 'Sam Example' }]);
  assert.deepEqual(plain(menuChoices({ querySelectorAll: () => [] })), []);
});
