import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { finishDemo, resetBrowserState, waitForReview } from './helpers';

// The full visitor flow: landing, live guard playground, the demo replay with
// guarded commands, an approved edit, passing tests and a verified ledger.

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await resetBrowserState(page);
});

test('landing page explains the product and runs the guard live', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The coding agent that shows its work.');
  await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the studio' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Install app|Installed/ })).toBeVisible();
  await expect(page.getByText('Made by')).toBeVisible();

  // The playground asks the real guard model about a command.
  const input = page.getByLabel('A shell command for the guard to judge');
  await expect(input).toHaveValue('rm -rf ~/.cache');
  await expect(page.locator('.pg-verdict .pill')).toBeVisible();
  await input.fill('npm test');
  await expect(page.locator('.pg-verdict .pill')).toBeVisible();
  await expect(page.locator('.pg-compute')).toContainText('logic operations');
  expect(errors).toEqual([]);
});

test('demo replay: guarded commands, approved edit, passing tests, verified ledger', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Try the demo' }).click();

  // The router decides live.
  await expect(page.locator('.route-chip').first()).toBeVisible();

  // The edit waits for the visitor, after the failing tests ran and the cache
  // command went to the guard.
  const accept = await waitForReview(page);
  await expect(page.locator('.tool-card', { hasText: 'Run test/config.test.js' }).first()).toContainText(/tests pass/);
  // rm -rf ~/.cache is blocked before it runs, with the clauses that decided it.
  const cacheCard = page.locator('.tool-card', { hasText: 'rm -rf ~/.cache' }).first();
  await expect(cacheCard).toHaveClass(/d-block/);
  await expect(cacheCard.locator('.tool-status')).toHaveText('Not run');
  await expect(cacheCard.locator('.evidence .ev-clause').first()).toBeVisible();
  await expect(page.locator('.tab.is-review')).toBeVisible();
  await accept.click();

  // Tests pass after the fix, the force push is judged, and the ledger verifies.
  await finishDemo(page);
  await expect(page.locator('.tool-card', { hasText: 'Run test/config.test.js' }).last()).toContainText('3/3 tests pass');
  // So is git push --force.
  const pushCard = page.locator('.tool-card', { hasText: 'git push --force' }).first();
  await expect(pushCard).toHaveClass(/d-block/);
  await expect(pushCard.locator('.evidence .ev-clause').first()).toBeVisible();

  // The edited file is open.
  await expect(page.locator('.tab.active')).toContainText('config.js');

  // The ledger panel verifies on demand too, and catches tampering.
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.locator('.verify-status.ok')).toContainText('Chain intact');
  await page.getByRole('button', { name: 'Tamper test' }).click();
  await expect(page.locator('.tamper-note')).toContainText('verification fails');

  expect(errors).toEqual([]);
});

test('phone layout is a clean read-only view', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = watchConsole(page);
  await page.goto('./#/studio');
  await expect(page.getByRole('tab', { name: 'Agent' })).toBeVisible();
  await expect(page.locator('#composer-input')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'src/config.js' }).click();
  await expect(page.locator('.phone-code')).toContainText('parseConfig');
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);

  // With the demo's tool cards and an expanded decision, nothing spills sideways.
  await page.getByRole('tab', { name: 'Agent' }).click();
  await page.getByRole('button', { name: /Play the demo|Replay the demo/ }).click();
  const cacheCard = page.locator('.tool-card', { hasText: 'rm -rf ~/.cache' }).first();
  await expect(cacheCard).toBeVisible({ timeout: 120_000 });
  await expect(cacheCard.locator('.tool-status')).not.toHaveText('Checking');
  expect(await fits()).toBe(true);
  await page.getByRole('tab', { name: 'Decisions' }).click();
  await page.locator('.phone-dec', { hasText: 'rm -rf' }).first().click();
  await expect(page.locator('.phone-decisions .evidence')).toBeVisible();
  expect(await fits()).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});
