import { test, expect } from '@playwright/test';
import { reset, inspect, readTrace } from '../scripts/local.mjs';
import { rowSelector } from './measurement';

for (const mailbox of [1, 2, 3]) {
  test(`fixed-position mobile close taps during unsubscribe in mailbox ${mailbox}`, async ({ page }, info) => {
    test.skip((process.env.BENCH_VARIANT || 'candidate') !== 'candidate', 'Candidate mobile workflow only.');
    test.skip(info.project.name !== 'mobile', 'This test uses the mobile layout and touchscreen.');
    const fixture: any = await reset({ delayMs: 10000, outcome: 'accepted' });
    await page.setExtraHTTPHeaders({'X-Action-Speed-Generation': fixture.generation});
    const box = fixture.mailboxes[mailbox];
    const closeIds: number[] = box.closeIds.slice(0, 10);
    const serverErrors: number[] = [];
    const closeRequests: string[] = [];
    page.on('response', response => { if (response.status() >= 500) serverErrors.push(response.status()); });
    page.on('request', request => {
      const params = new URLSearchParams(request.postData() || '');
      if (params.get('action') === 'conversation_change_status') closeRequests.push(params.get('conversation_id') || '');
    });
    await page.goto(`/staging-login/1?to=${encodeURIComponent(box.folderUrl)}`);
    await page.waitForSelector('.mailbox-one-click-close');
    await page.evaluate(() => new Promise<void>(resolve => (window as any).jQuery(() => resolve())));
    const initialCount = Number(await page.locator('#folders > li.active .active-count').innerText());
    await page.locator(`${rowSelector(box.unsubId)} td.conv-subject a`).first().click();
    await page.waitForFunction(() => document.documentElement.dataset.unsubReady === '1');
    await page.evaluate(() => new Promise<void>(resolve => (window as any).jQuery(() => resolve())));
    await page.locator('#conv-toolbar .unsub-review').click();
    await expect.poll(() => readTrace().filter((e: any) => e.event === 'start').length, { timeout: 10000 }).toBe(1);
    await page.goBack({ waitUntil: 'load' });
    await page.waitForSelector('.mailbox-one-click-close');
    await page.evaluate(() => new Promise<void>(resolve => (window as any).jQuery(() => resolve())));
    const rect = await page.locator(`${rowSelector(closeIds[0])} .mailbox-one-click-close`).boundingBox();
    expect(rect).not.toBeNull();
    const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
    await info.attach('mobile-before-taps', { body: await page.screenshot(), contentType: 'image/png' });
    const start = Date.now();
    for (const [index, id] of closeIds.entries()) {
      const wait = start + index * 250 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      const target = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)?.closest('.mailbox-one-click-close') as HTMLElement | null;
        return el?.dataset.conversationId || null;
      }, { x, y });
      expect(target, `Tap ${index + 1} must target conversation ${id} at the original position`).toBe(String(id));
      await page.touchscreen.tap(x, y);
    }
    await expect.poll(() => inspect().conversations.filter((c: any) => closeIds.includes(Number(c.id)) && Number(c.status) === 3).length, { timeout: 25000 }).toBe(10);
    await expect.poll(() => readTrace().filter((e: any) => e.event === 'end').length, { timeout: 25000 }).toBe(1);
    await expect.poll(() => inspect().conversations.some((c: any) => Number(c.id) === Number(box.unsubId) && Number(c.status) === 3 && c.accepted), { timeout: 10000 }).toBe(true);
    await expect(page.locator(rowSelector(box.unsubId))).toBeHidden({ timeout: 10000 });
    for (const id of closeIds) await expect(page.locator(rowSelector(id))).toBeHidden();
    await expect.poll(async () => Number(await page.locator('#folders > li.active .active-count').innerText()), { timeout: 10000 }).toBe(initialCount - 11);
    const header = page.locator('.sidebar-title-extra-value.active-count');
    await expect(header).toBeVisible();
    await expect.poll(async () => (await header.innerText()).trim(), { timeout: 10000 }).toMatch(new RegExp(`\\(${initialCount - 11}\\)$`));
    const serverHtml = await (await page.request.get(box.folderUrl)).text();
    const serverHeader = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector('.sidebar-title-extra-value.active-count')?.textContent?.trim(), serverHtml);
    expect((await header.innerText()).trim()).toBe(serverHeader);
    expect(closeRequests).toHaveLength(10);
    expect(new Set(closeRequests)).toEqual(new Set(closeIds.map(String)));
    expect(readTrace().filter((e: any) => e.event === 'start')).toHaveLength(1);
    expect(serverErrors).toEqual([]);
    await info.attach('mobile-after-reconciliation', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
