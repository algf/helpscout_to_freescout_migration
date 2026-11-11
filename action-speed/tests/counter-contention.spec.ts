import { test, expect } from '@playwright/test';
import { reset, inspect, readTrace } from '../scripts/local.mjs';
import { rowSelector } from './measurement';

// Correctness gate only. The short sender delay makes unsubscribe closure occur
// during the close burst, rather than after all ten writes in the 10-second benchmark.
for (const mailbox of [1, 2, 3]) {
  test(`counter contention mailbox ${mailbox}`, async ({ page }, info) => {
    test.skip((process.env.BENCH_VARIANT || 'candidate') !== 'candidate' || info.project.name !== 'desktop', 'Candidate desktop regression gate');
    const fixture = reset({ delayMs: 500, outcome: 'accepted' });
    await page.setExtraHTTPHeaders({'X-Action-Speed-Generation': fixture.generation});
    const box = fixture.mailboxes[mailbox];
    const closeIds = box.closeIds.slice(0, 10);
    const failedResponses: number[] = [];
    const closeResponses: Array<{ id: string|null; ok: boolean }> = [];
    page.on('response', response => {
      if (new URL(response.url()).origin === 'http://localhost:53927' && response.status() >= 500) failedResponses.push(response.status());
    });
    page.on('requestfinished', async request => {
      const params = new URLSearchParams(request.postData() || '');
      if (params.get('action') !== 'conversation_change_status') return;
      const response = await request.response();
      const data = await response?.json().catch(() => null);
      closeResponses.push({ id: params.get('conversation_id'), ok: Boolean(response?.ok() && data?.status === 'success') });
    });
    await page.goto(`/staging-login/1?to=${encodeURIComponent(box.folderUrl)}`);
    await page.waitForSelector('.mailbox-one-click-close');
    await page.waitForFunction(() => document.documentElement.dataset.unsubReady === '1' && Boolean((window as any).crockdQuickClose));
    await page.evaluate(() => new Promise<void>(resolve => (window as any).jQuery(() => resolve())));
    const counter = page.locator('#folders > li.active .active-count');
    const initialCount = Number((await counter.innerText()).trim());
    expect(Number.isFinite(initialCount)).toBe(true);
    await page.locator(`${rowSelector(box.unsubId)} .unsub-review`).click();
    await expect.poll(() => readTrace().filter((event: any) => event.event === 'start').length, { timeout: 10000 }).toBe(1);
    const burstStart = Date.now();
    for (const [index, id] of closeIds.entries()) {
      const remaining = burstStart + index * 250 - Date.now();
      if (remaining > 0) await page.waitForTimeout(remaining);
      await page.locator(`${rowSelector(id)} .mailbox-one-click-close`).click();
    }
    await expect.poll(() => closeResponses.length, { timeout: 25000 }).toBe(10);
    for (const id of closeIds) expect(closeResponses.filter(response => response.id === String(id) && response.ok)).toHaveLength(1);
    const expectedIds = [box.unsubId, ...closeIds];
    await expect.poll(() => {
      const rows = inspect().conversations;
      return expectedIds.every(id => rows.some((row: any) => Number(row.id) === id && Number(row.status) === 3));
    }, { timeout: 15000 }).toBe(true);
    const state = inspect();
    const unsub = state.conversations.find((row: any) => Number(row.id) === box.unsubId);
    expect(unsub?.accepted).toBe(true);
    expect(Number(unsub?.activityCount)).toBe(1);
    const trace = readTrace();
    expect(trace.filter((event: any) => event.event === 'start')).toHaveLength(1);
    expect(trace.filter((event: any) => event.event === 'end')).toHaveLength(1);
    expect(trace.every((event: any) => Number(event.id) === box.unsubId)).toBe(true);
    await expect.poll(async () => Number((await counter.innerText()).trim()), { timeout: 10000 }).toBe(initialCount - 11);
    for (const id of expectedIds) await expect(page.locator(rowSelector(id))).toBeHidden();
    expect(failedResponses, 'Same-origin HTTP 5xx responses').toEqual([]);
  });
}
