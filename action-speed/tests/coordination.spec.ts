import { test, expect } from '@playwright/test';
import { reset, inspect, readTrace } from '../scripts/local.mjs';
import { rowSelector } from './measurement';

for (const mailbox of [1, 2, 3]) {
  test(`bulk close respects pending unsubscribe in mailbox ${mailbox}`, async ({ page }, info) => {
    test.skip((process.env.BENCH_VARIANT || 'candidate') !== 'candidate', 'Candidate coordination only.');
    test.skip(info.project.name === 'mobile', 'Bulk selection is hidden on mobile.');
    const fixture: any = await reset({ delayMs: 3000, outcome: 'accepted' });
    await page.setExtraHTTPHeaders({'X-Action-Speed-Generation': fixture.generation});
    const box = fixture.mailboxes[mailbox];
    const unsubRow = page.locator(rowSelector(box.unsubId));
    const otherId = box.closeIds[0];
    const otherRow = page.locator(rowSelector(otherId));
    const bulkRequests: string[] = [];
    page.on('request', request => {
      const body = request.postData() || '';
      if (new URLSearchParams(body).get('action') === 'bulk_conversation_change_status') bulkRequests.push(body);
    });
    await page.goto(`/staging-login/1?to=${encodeURIComponent(box.folderUrl)}`);
    await page.waitForSelector('.unsub-review');
    await page.evaluate(() => new Promise<void>(resolve => (window as any).jQuery(() => resolve())));
    await page.evaluate(() => {
      const w = window as any;
      w.__coordinationAlerts = [];
      const original = w.showFloatingAlert;
      w.showFloatingAlert = function (type: string, message: string) {
        w.__coordinationAlerts.push({ type, message });
        return original.apply(this, arguments);
      };
    });
    await unsubRow.locator('.unsub-review').click();
    await expect.poll(() => readTrace().filter((e: any) => e.event === 'start').length, { timeout: 10000 }).toBe(1);
    await expect(unsubRow.locator('.mailbox-one-click-close')).toBeDisabled();
    await expect(unsubRow.locator('.mailbox-one-click-close')).toHaveAttribute('aria-busy', 'true');
    await expect(otherRow.locator('.mailbox-one-click-close')).toBeEnabled();
    await unsubRow.locator('input.conv-checkbox').check({ force: true });
    await otherRow.locator('input.conv-checkbox').check({ force: true });
    await page.locator('#conversations-bulk-actions .inbox-close-selected').click();
    await expect.poll(() => page.evaluate(() => (window as any).__coordinationAlerts.some((a: any) => a.type === 'error' && /being updated/.test(a.message)))).toBe(true);
    expect(bulkRequests).toHaveLength(0);
    await expect(unsubRow).toBeVisible();
    await expect(otherRow).toBeVisible();
    await otherRow.locator('.mailbox-one-click-close').click();
    await expect.poll(() => inspect().conversations.some((c: any) => Number(c.id) === Number(otherId) && Number(c.status) === 3), { timeout: 10000 }).toBe(true);
    await expect.poll(() => readTrace().filter((e: any) => e.event === 'end').length, { timeout: 15000 }).toBe(1);
    await expect.poll(() => inspect().conversations.some((c: any) => Number(c.id) === Number(box.unsubId) && Number(c.status) === 3 && c.accepted), { timeout: 10000 }).toBe(true);
    expect(readTrace().filter((e: any) => e.event === 'start')).toHaveLength(1);
    expect(bulkRequests).toHaveLength(0);
  });
}
