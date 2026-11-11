import { test, expect } from '@playwright/test';
import { reset, configure, inspect, readCloseTrace } from '../scripts/local.mjs';
import { rowSelector } from './measurement';

for (const mailbox of [1, 2, 3]) {
  test(`queued closes survive navigation in mailbox ${mailbox}`, async ({ page }, info) => {
    test.skip((process.env.BENCH_VARIANT || 'candidate') !== 'candidate', 'Candidate handoff only.');
    const fixture: any = await reset({ delayMs: 0 });
    await page.setExtraHTTPHeaders({'X-Action-Speed-Generation': fixture.generation});
    const box = fixture.mailboxes[mailbox];
    const ids: number[] = box.closeIds.slice(0, 10);
    await configure({ delayMs: 0, closeDelayMs: 5000, closeDelayIds: ids.slice(0, 3) });
    await page.goto(`/staging-login/1?to=${encodeURIComponent(box.folderUrl)}`);
    await page.waitForSelector('.mailbox-one-click-close');
    await page.evaluate(() => new Promise<void>(resolve => (window as any).jQuery(() => resolve())));
    const initialCount = Number(await page.locator('#folders > li.active .active-count').innerText());
    for (const id of ids) {
      const close = page.locator(`${rowSelector(id)} .mailbox-one-click-close`);
      if (info.project.name === 'mobile') await close.tap();
      else await close.click();
    }
    await expect.poll(() => readCloseTrace().filter((e: any) => e.event === 'start').length, { timeout: 4000 }).toBe(3);
    const beforeNavigation = readCloseTrace().filter((e: any) => e.event === 'start');
    expect(beforeNavigation.map((e: any) => Number(e.id)).sort((a: number, b: number) => a - b)).toEqual(ids.slice(0, 3).sort((a, b) => a - b));
    expect(readCloseTrace().filter((e: any) => e.event === 'end')).toHaveLength(0);
    await page.goto('/');
    await expect.poll(() => inspect().conversations.filter((c: any) => ids.includes(Number(c.id)) && Number(c.status) === 3 && Number(c.closeActivityCount) === 1).length, { timeout: 30000 }).toBe(10);
    await expect.poll(() => readCloseTrace().filter((e: any) => e.event === 'end' && ids.includes(Number(e.id))).length, { timeout: 30000 }).toBe(10);
    const trace = readCloseTrace();
    for (const id of ids) {
      expect(trace.filter((e: any) => Number(e.id) === id && e.event === 'start')).toHaveLength(1);
      expect(trace.filter((e: any) => Number(e.id) === id && e.event === 'end')).toHaveLength(1);
      expect(trace.filter((e: any) => Number(e.id) === id && e.event === 'error')).toHaveLength(0);
    }
    await page.goto(box.folderUrl);
    await page.waitForSelector('.table-conversations');
    for (const id of ids) await expect(page.locator(rowSelector(id))).toHaveCount(0);
    await expect(page.locator('#folders > li.active .active-count')).toHaveText(String(initialCount - 10));
    await info.attach('after-close-navigation', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
