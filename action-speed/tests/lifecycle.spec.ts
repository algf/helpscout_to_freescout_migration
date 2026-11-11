import { test, expect } from '@playwright/test';
import { reset, inspect, readTrace } from '../scripts/local.mjs';
import { rowSelector } from './measurement';

test('reset drains unsubscribe and rejects writes from the prior generation', async ({ page }, info) => {
  test.skip((process.env.BENCH_VARIANT || 'candidate') !== 'candidate' || info.project.name !== 'desktop', 'Candidate desktop lifecycle regression');
  const first = reset({ delayMs: 2000, outcome: 'accepted' });
  const oldGeneration = first.generation;
  expect(oldGeneration).toMatch(/^[a-f0-9]{32}$/);
  await page.setExtraHTTPHeaders({ 'X-Action-Speed-Generation': oldGeneration });
  const box = first.mailboxes[1];
  await page.goto(`/staging-login/1?to=${encodeURIComponent(box.folderUrl)}`);
  await page.waitForFunction(() => document.documentElement.dataset.unsubReady === '1' && Boolean((window as any).crockdQuickClose));
  await page.evaluate(() => new Promise<void>(resolve => (window as any).jQuery(() => resolve())));
  const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  expect(csrf).toBeTruthy();
  const ajaxUrl = await page.evaluate(() => (window as any).laroute.route('conversations.ajax'));
  await page.locator(`${rowSelector(box.unsubId)} .unsub-review`).click();
  await expect.poll(() => readTrace().filter((event: any) => event.event === 'start').length, { timeout: 10000 }).toBe(1);

  // This synchronous call must wait for the active server write before seeding.
  // Keep the old document/header to exercise a genuinely stale subsequent write.
  const second = reset({ delayMs: 0, outcome: 'accepted' });
  expect(second.generation).toMatch(/^[a-f0-9]{32}$/);
  expect(second.generation).not.toBe(oldGeneration);
  const targetId = second.mailboxes[1].closeIds[0];
  const post = (generation: string) => page.request.post(ajaxUrl, {
    headers: { 'X-Action-Speed-Generation': generation, 'X-CSRF-TOKEN': csrf!, 'X-Requested-With': 'XMLHttpRequest' },
    form: { action: 'conversation_change_status', conversation_id: String(targetId), status: '3', folder_id: '', x_embed: '1' },
  });
  const stale = await post(oldGeneration);
  expect(stale.status()).toBe(409);
  expect((await stale.json()).message).toMatch(/stale.*generation/i);
  await page.waitForTimeout(1000);
  const afterStale = inspect().conversations;
  for (const id of [targetId, second.mailboxes[1].unsubId]) {
    const row = afterStale.find((conversation: any) => Number(conversation.id) === Number(id));
    expect(Number(row?.status)).toBe(1);
    expect(Boolean(row?.accepted)).toBe(false);
    expect(Number(row?.closeActivityCount)).toBe(0);
    expect(Number(row?.activityCount)).toBe(0);
  }
  const current = await post(second.generation);
  expect(current.ok()).toBe(true);
  expect((await current.json()).status).toBe('success');
  await expect.poll(() => {
    const row = inspect().conversations.find((conversation: any) => Number(conversation.id) === Number(targetId));
    return Number(row?.status) === 3 && Number(row?.closeActivityCount) === 1;
  }, { timeout: 10000 }).toBe(true);
  expect(readTrace()).toEqual([]);
});
