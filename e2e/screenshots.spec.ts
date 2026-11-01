import { expect, test } from '@playwright/test';
import { finishDemo, resetBrowserState, waitForReview } from './helpers';

// Captures the README screenshots into docs/. Run with: npm run screenshots

test('desktop landing', async ({ page }) => {
  await resetBrowserState(page);
  await page.goto('./');
  await page.getByLabel('A shell command for the guard to judge').fill('git push --force');
  await expect(page.locator('.pg-verdict .pill')).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'docs/screenshot-landing.png' });
});

test('desktop studio during the demo', async ({ page }) => {
  await resetBrowserState(page);
  await page.goto('./#/demo');
  const accept = await waitForReview(page);
  // Show the guard's evidence for the cache command next to the pending review.
  await page.locator('.tool-card', { hasText: 'rm -rf ~/.cache' }).first().scrollIntoViewIfNeeded();
  const guardNode = page.locator('.tl-node.kind-guard.block').first();
  if (await guardNode.count()) await guardNode.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'docs/screenshot-studio.png' });

  // Finish the run and capture the verified ledger in the light theme.
  await accept.click();
  await finishDemo(page);
  await page.getByRole('button', { name: /Switch to light theme/ }).click();
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.locator('.verify-status.ok')).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'docs/screenshot-ledger-light.png' });
});

test('phone view', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await context.newPage();
  await resetBrowserState(page);
  await page.goto('./#/studio');
  await page.getByRole('button', { name: /Play the demo|Replay the demo/ }).click();
  const cacheCard = page.locator('.tool-card', { hasText: 'rm -rf ~/.cache' }).first();
  await expect(cacheCard).toBeVisible({ timeout: 120_000 });
  await expect(cacheCard.locator('.tool-status')).not.toHaveText('Checking');
  await page.getByRole('tab', { name: 'Decisions' }).click();
  await page.locator('.phone-dec', { hasText: 'rm -rf' }).first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/screenshot-phone.png' });
  await context.close();
});
