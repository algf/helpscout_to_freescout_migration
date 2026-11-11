'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const transient = new Set([5, 6, 7, 18, 28, 52, 55, 56]);
const marker = '\n__TRACE_HTTP_STATUS__:';

function validate(input) {
    const url = new URL(input);
    if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.port !== '53927' || url.username || url.password || url.hash || !['/action-speed-trace.jsonl', '/action-speed-close-trace.jsonl'].includes(url.pathname)) throw new Error('Invalid local trace endpoint');
    return url;
}

function createTraceReader(options = {}) {
    const run = options.run || ((args) => spawnSync('curl', args, { encoding: 'utf8', timeout: 500, maxBuffer: 5 * 1024 * 1024 }));
    const sleep = options.sleep || (ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
    const now = options.now || Date.now;
    const diagnose = options.diagnose || (entry => {
        try {
            const dir = path.resolve(__dirname, '../results/observer-diagnostics');
            fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(path.join(dir, `trace-reader-${process.pid}.jsonl`), JSON.stringify(entry) + '\n');
        } catch (_) { /* Diagnostics must not turn a valid trace into a failure. */ }
    });
    return function readJsonLines(input) {
        const base = validate(input);
        let lastError;
        for (let attempt = 1; attempt <= 2; attempt++) {
            const started = now();
            const url = new URL(base.href);
            url.searchParams.set('_fresh', `${started}-${attempt}-${Math.random().toString(36).slice(2)}`);
            let status, errorCode, retry = false;
            try {
                const result = run(['--silent', '--show-error', '--connect-timeout', '0.3', '--max-time', '0.5', '--header', 'Cache-Control: no-cache', '--header', 'Pragma: no-cache', '--write-out', marker + '%{http_code}', url.href]);
                if (result.error || result.status !== 0) {
                    errorCode = result.error && result.error.code === 'ETIMEDOUT' ? 28 : result.status;
                    retry = transient.has(errorCode);
                    throw new Error(`Trace transport failed (${errorCode == null ? 'unknown' : errorCode})`);
                }
                const output = String(result.stdout || ''), index = output.lastIndexOf(marker);
                if (index < 0) { errorCode = 'partial-json'; retry = true; throw new Error('Trace response was incomplete'); }
                status = Number(output.slice(index + marker.length).trim());
                if (status !== 200) { retry = status >= 500; throw new Error(`Trace HTTP ${status}`); }
                let records;
                try { records = output.slice(0, index).split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); }
                catch (_) { errorCode = 'partial-json'; retry = true; throw new Error('Trace JSON was incomplete'); }
                diagnose({ endpoint: base.pathname, attempt, elapsedMs: Math.max(0, now() - started), status });
                return records;
            } catch (error) {
                lastError = error;
                const entry = { endpoint: base.pathname, attempt, elapsedMs: Math.max(0, now() - started) };
                if (status !== undefined) entry.status = status;
                if (errorCode !== undefined) entry.errorCode = errorCode;
                diagnose(entry);
                if (!retry || attempt === 2) break;
                sleep(50);
            }
        }
        throw lastError;
    };
}

const readJsonLines = createTraceReader();
module.exports = { createTraceReader, readJsonLines };
