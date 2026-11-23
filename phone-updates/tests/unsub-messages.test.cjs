const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const box = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../action-speed/src/UnSub/Resources/assets/unsub.js'), 'utf8'), { module: box });
const { createAction, createResume, staysOpen, LINK_OPENED } = box.exports;

function setup() {
  const requests = [], events = [], row = {};
  const action = createAction({ shared: () => null, busy: () => {}, clear: id => events.push(['clear', id]), request: (b, data, ok, fail) => requests.push({ data, ok, fail }), becomeLink: () => events.push(['link']), notify: (type, message) => events.push([type, message]), mark: (b, closed) => events.push(['mark', closed]), reload: () => events.push(['reload']) });
  return { requests, events, row, action, button: (r = row) => ({ dataset: { conversation: '5' }, closest: () => r }) };
}

test('accepted and closed: says so', () => {
  const { requests, events, action, button } = setup();
  action(button(null));
  requests[0].ok({ token: 't', items: [{ key: 'k', automatic: true, manual_url: 'https://x.example/u' }] });
  assert.equal(requests[1].data.close, '1', 'always asks the server to close on acceptance');
  requests[1].ok({ accepted: true, closed: 1 });
  assert.deepEqual(events, [['clear', '5'], ['success', 'Unsubscribed and closed.'], ['reload']]);
});

test('accepted but not closed (the email changed): says it stays open', () => {
  const { requests, events, action, button } = setup();
  action(button());
  requests[0].ok({ token: 't', items: [{ key: 'k', automatic: true }] });
  requests[1].ok({ accepted: true, closed: 0 });
  assert.match(events.find(e => e[0] === 'success')[1], /^Unsubscribed\. The email stays open\./);
});

test('not started (21 Nov 2026 cache fault): keeps the one-click button, forgets the saved request, says nothing was sent', () => {
  const { requests, events, action, button } = setup();
  action(button());
  requests[0].ok({ token: 't', items: [{ key: 'k', automatic: true, manual_url: 'https://x.example/u' }] });
  requests[1].fail({ status: 503, responseJSON: { retry: true, accepted: false, closed: 0, message: 'Could not start the unsubscribe, so nothing was sent. The email stays open. Please try again.' } });
  assert.deepEqual(events, [['clear', '5'], ['error', 'Could not start the unsubscribe, so nothing was sent. The email stays open. Please try again.']]);
});

test('an unknown failure after sending may have reached the sender: keeps the saved request and offers the page', () => {
  const { requests, events, action, button } = setup();
  action(button());
  requests[0].ok({ token: 't', items: [{ key: 'k', automatic: true, manual_url: 'https://x.example/u' }] });
  requests[1].fail({ status: 502 });
  assert.ok(!events.some(e => e[0] === 'clear'));
  assert.deepEqual(events.at(-1), ['error', 'Could not confirm the unsubscribe request. Please refresh before trying again. The email stays open. Click Unsub again to open the unsubscribe page.']);
});

test('a bare server error or a refused request says the email stays open', () => {
  const { requests, events, action, button } = setup();
  action(button());
  requests[0].ok({ token: 't', items: [{ key: 'k', automatic: true }] });
  requests[1].fail({ status: 500, responseJSON: { message: 'Server Error' } });
  assert.deepEqual(events.at(-1), ['error', 'Server Error The email stays open.']);
  const second = setup();
  second.action(second.button());
  second.requests[0].ok({ token: 't', items: [{ key: 'k', automatic: true }] });
  second.requests[1].ok({ accepted: false, message: 'The service requires a manual step (HTTP 400). No emails were closed.' });
  assert.deepEqual(second.events.at(-1), ['error', 'The service requires a manual step (HTTP 400). No emails were closed.']);
});

test('staysOpen never contradicts a closed outcome or repeats itself', () => {
  assert.equal(staysOpen('Unsubscribed and closed, but the screen could not update. Please refresh.'), 'Unsubscribed and closed, but the screen could not update. Please refresh.');
  assert.equal(staysOpen('X. The email stays open.'), 'X. The email stays open.');
  assert.equal(staysOpen(''), 'The email stays open.');
});

test('page and email links say the email stays open until closed', () => {
  assert.match(LINK_OPENED.page, /new tab.*stays open until you close it/);
  assert.match(LINK_OPENED.email, /new tab.*stays open until you close it/);
});

test('resumed failure after navigation says the email stays open', () => {
  const events = [];
  const resume = createResume({ shared: () => null, row: () => null, clear: () => {}, notify: (t, m) => events.push([t, m]), now: () => 0, later: () => {}, request: (r, ok) => ok({ state: 'complete', result: { accepted: false, closed: 0, message: 'Could not verify one-click unsubscribe for this message. Use the manual link; no emails were closed.' } }) });
  resume({ id: 5, expires: 100 });
  assert.deepEqual(events, [['error', 'Could not verify one-click unsubscribe for this message. Use the manual link; no emails were closed.']]);
});
