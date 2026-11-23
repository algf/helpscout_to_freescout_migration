const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { folderItems, tabsHtml, safeUrl } = require(path.join(__dirname, '../src/Modules/CrockdHelpScoutFolders/mailbox-switcher.js'));
const origin = 'https://mail.example';
const mailbox = { id: 3, name: 'Support', unassigned: 4, folders: [
  { id: 1, name: 'Unassigned', icon: 'folder-open', url: 'https://mail.example/mailbox/3', count: 4, strong: true, section: null },
  { id: 2, name: 'Snoozed', icon: 'time', url: 'https://mail.example/mailbox/3/2', count: 0, strong: false, section: null },
  { id: 3, name: 'Pat', icon: 'user', url: 'https://mail.example/mailbox/3/3', count: 2, strong: false, section: 'Views' },
  { id: 4, name: 'Kim', icon: 'user', url: 'https://mail.example/mailbox/3/4', count: 3, strong: false, section: 'Views' },
  { id: 5, name: 'Client <b>', icon: 'briefcase', url: 'https://mail.example/mailbox/3/5', count: 3, strong: false, section: 'Clients' },
  { id: 6, name: 'Elsewhere', icon: 'user', url: 'https://evil.example/x', count: 1, strong: false, section: 'Clients' },
] };

test('folders render with counts, quiet empty folders and one label per section', () => {
  const html = folderItems(mailbox, origin);
  assert.equal((html.match(/hs-switch-section/g) || []).length, 2);
  assert.ok(html.indexOf('>Views<') < html.indexOf('Pat') && html.indexOf('>Clients<') < html.indexOf('Client'));
  assert.match(html, /<strong class="active-count">4<\/strong>/);
  assert.match(html, /href="https:\/\/mail\.example\/mailbox\/3\/2" class="no-active"/);
});
test('names are escaped and links to other sites are dropped', () => {
  const html = folderItems(mailbox, origin);
  assert.match(html, /Client &lt;b&gt;/);
  assert.doesNotMatch(html, /evil\.example|Elsewhere/);
  assert.equal(safeUrl('javascript:alert(1)', origin), null);
  assert.equal(safeUrl('/mailbox/1', origin), 'https://mail.example/mailbox/1');
});
test('tabs keep the given order, mark the current mailbox and say the count in words', () => {
  const html = tabsHtml([{ id: 1, name: 'Sales', unassigned: 8 }, { id: 2, name: 'Billing', unassigned: 0 }, { id: 3, name: 'Sup"port', unassigned: 4 }], 2);
  assert.deepEqual([...html.matchAll(/data-mailbox-id="(\d+)"/g)].map(m => m[1]), ['1', '2', '3']);
  assert.match(html, /data-mailbox-id="2" aria-selected="true"/);
  assert.match(html, /aria-label="Sales, 8 unassigned"/);
  assert.match(html, /aria-label="Billing"/, 'no count when nothing is unassigned');
  assert.match(html, /Sup&quot;port/);
});
