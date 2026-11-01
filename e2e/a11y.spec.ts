import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { waitForReview } from './helpers';

// Automated accessibility checks (WCAG 2.1 A and AA rules, including colour
// contrast) for the landing page and the studio in both themes.

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Monaco renders its own editor DOM; it is excluded from the audit.
    .exclude('.monaco-editor')
    .exclude('.monaco-diff-editor')
    .analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of serious) {
    console.log(`[${label}] ${v.id} (${v.impact}): ${v.help}`);
    for (const n of v.nodes.slice(0, 5)) console.log(`   ${n.target.join(' ')}: ${n.failureSummary?.split('\n')[1] ?? ''}`);
  }
  expect(serious, `${label}: serious accessibility violations`).toEqual([]);
}

for (const scheme of ['dark', 'light'] as const) {
  test(`landing is accessible (${scheme})`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('./');
    await expect(page.locator('.pg-verdict .pill')).toBeVisible();
    await audit(page, `landing ${scheme}`);
    await context.close();
  });

  test(`studio mid-demo is accessible (${scheme})`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('./#/demo');
    await waitForReview(page);
    const blocked = page.locator('.tl-node.kind-guard.block').first();
    if (await blocked.count()) await blocked.click();
    await audit(page, `studio demo ${scheme}`);
    await context.close();
  });

  test(`studio is accessible (${scheme})`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('./#/studio');
    await expect(page.locator('.tree-row').first()).toBeVisible();
    await page.waitForTimeout(800);
    await audit(page, `studio ${scheme}`);
    await context.close();
  });
}

test('keyboard can reach the composer and send a prompt', async ({ page }) => {
  await page.goto('./#/studio');
  await expect(page.locator('.tree-row').first()).toBeVisible();
  // The skip link is the first stop and jumps to the composer.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to the agent' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#composer-input')).toBeFocused();
  await page.keyboard.type('`git push --force`');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tool-card', { hasText: 'git push --force' })).toBeVisible();
  // The file tree supports arrow keys.
  await page.locator('.tree-row').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tree-row').nth(1)).toBeFocused();
});
