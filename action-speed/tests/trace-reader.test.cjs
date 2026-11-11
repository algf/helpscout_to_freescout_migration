'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTraceReader } = require('../scripts/trace-reader.cjs');
const url = 'http://localhost:53927/action-speed-trace.jsonl';
const ok = data => ({ status: 0, stdout: data + '\n__TRACE_HTTP_STATUS__:200' });
function harness(results) {
    const calls = [], diagnostics = [], sleeps = [];
    const read = createTraceReader({ run: args => { calls.push(args); return results.shift(); }, diagnose: e => diagnostics.push(e), sleep: n => sleeps.push(n), now: () => 100 });
    return { read, calls, diagnostics, sleeps };
}
test('timeout then success retries once with a fresh no-cache request', () => {
    const h = harness([{ status: 28 }, ok('{"id":1}\n')]);
    assert.deepEqual(h.read(url), [{ id: 1 }]); assert.equal(h.calls.length, 2); assert.deepEqual(h.sleeps, [50]);
    assert.notEqual(h.calls[0].at(-1), h.calls[1].at(-1));
    assert.ok(h.calls[0].includes('Cache-Control: no-cache'));
    assert.equal(h.diagnostics[0].errorCode, 28);
});
test('partial JSON retries, all failures surface, and attempts stay bounded', () => {
    const h = harness([ok('{"id":'), ok('{"id":2}\n')]);
    assert.deepEqual(h.read(url), [{ id: 2 }]); assert.equal(h.calls.length, 2);
    const bad = harness([{ status: 7 }, { status: 28 }, ok('{"id":3}')]);
    assert.throws(() => bad.read(url), /transport/); assert.equal(bad.calls.length, 2);
});
test('non-transient HTTP and transport errors do not retry', () => {
    for (const result of [{ status: 0, stdout: '\n__TRACE_HTTP_STATUS__:404' }, { status: 60 }]) {
        const h = harness([result]); assert.throws(() => h.read(url)); assert.equal(h.calls.length, 1); assert.deepEqual(h.sleeps, []);
    }
});
test('each read returns fresh data and failure never returns an old result', () => {
    const h = harness([ok('{"id":1}'), ok('{"id":2}'), { status: 7 }, { status: 7 }]);
    assert.deepEqual(h.read(url), [{ id: 1 }]); assert.deepEqual(h.read(url), [{ id: 2 }]); assert.throws(() => h.read(url));
});
test('only permitted local trace endpoints are accepted', () => {
    const h = harness([]); for (const input of ['http://example.com:53927/action-speed-trace.jsonl', 'http://localhost:53927/other']) assert.throws(() => h.read(input));
    assert.equal(h.calls.length, 0);
});
