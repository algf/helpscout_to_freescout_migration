import type { Page } from '@playwright/test';
/** Event capture runs before app handlers. A double RAF records the first painted acknowledgement.
 * Samples retain null for missing acknowledgement, so failures cannot disappear from percentiles. */
export async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__actionSamples = [];
    document.addEventListener('click', (event) => {
      const target = (event.target as Element)?.closest('.mailbox-one-click-close,.unsub-review') as HTMLElement;
      if (!target) return;
      const row = target.closest('tr.conv-row') as HTMLElement;
      const sample = {id:Number(target.dataset.conversationId || target.dataset.conversation),kind:target.matches('.unsub-review')?'unsubscribe':'close',eventMs:performance.now(),eventEpochMs:performance.timeOrigin + performance.now(),ackMs:null as number|null,ackEpochMs:null as number|null};
      w.__actionSamples.push(sample);
      const start = sample.eventMs;
      const check = () => {
        const acknowledged = sample.kind === 'close' ? row && (!row.isConnected || getComputedStyle(row).display === 'none') : target.classList.contains('is-busy') || target.getAttribute('aria-busy') === 'true';
        if (acknowledged) requestAnimationFrame(() => { sample.ackMs=performance.now()-start; sample.ackEpochMs=performance.timeOrigin+performance.now(); });
        else if (performance.now()-start<30000) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, true);
  });
}
export async function samples(page: Page) { return page.evaluate(() => (window as any).__actionSamples || []); }
export const rowSelector = (id:number) => `tr.conv-row[data-conversation_id="${id}"]`;
