import type { Locator, Page } from '@playwright/test';

// Drives the demo the way a visitor would: whatever the guard asks about gets
// approved, so the tests do not depend on a particular model's decisions.

async function clickIfVisible(button: Locator) {
  if (await button.isVisible().catch(() => false)) await button.click().catch(() => undefined);
}

async function until(page: Page, done: () => Promise<boolean>, onTick: () => Promise<void>, timeout: number, what: string) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await done()) return;
    await onTick();
    await page.waitForTimeout(350);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Wait until the proposed edit is up for review, allowing anything asked before it. */
export async function waitForReview(page: Page, timeout = 150_000): Promise<Locator> {
  const accept = page.getByRole('button', { name: 'Accept edit' }).first();
  await until(page, () => accept.isVisible(), () => clickIfVisible(page.getByRole('button', { name: 'Allow once' }).first()), timeout, 'the edit review');
  return accept;
}

/** Approve everything until the demo has verified its ledger. */
export async function finishDemo(page: Page, timeout = 150_000) {
  const verified = page.locator('.notice.tone-success', { hasText: 'Ledger verified' });
  await until(page, () => verified.isVisible(), () => clickIfVisible(page.getByRole('button', { name: /^(Allow once|Accept edit)$/ }).first()), timeout, 'the verified ledger');
}

export async function resetBrowserState(page: Page) {
  await page.goto('./');
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases?.();
    await Promise.all(
      (dbs ?? []).map((d) =>
        d.name
          ? new Promise((r) => {
              const req = indexedDB.deleteDatabase(d.name!);
              req.onsuccess = req.onerror = req.onblocked = () => r(null);
            })
          : null,
      ),
    );
  });
}
