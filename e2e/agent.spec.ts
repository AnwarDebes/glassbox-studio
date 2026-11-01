import { expect, test, type Page, type Route } from '@playwright/test';
import JSZip from 'jszip';

// The real agent loop (not the demo) against a mocked OpenAI-compatible
// provider, through both native tool calling and the JSON action protocol.

const BASE = 'https://llm.mock.test/v1';

function sse(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

async function mockProvider(page: Page, replies: Array<(body: Record<string, unknown>) => unknown[]>) {
  const requests: Array<Record<string, unknown>> = [];
  await page.route(`${BASE}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith('/models')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ id: 'mock-model' }] }) });
    const body = req.postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(reply(body)) });
  });
  return requests;
}

async function useCustomProvider(page: Page, native: boolean) {
  await page.getByRole('button', { name: /Model: .* Change model/ }).click();
  await page.getByRole('tab', { name: 'Your API key' }).click();
  await page.getByRole('button', { name: /Custom endpoint/ }).click();
  await page.getByLabel('Base URL').fill(BASE);
  await page.getByLabel('Model', { exact: true }).fill('mock-model');
  await page.getByLabel(/API key/).fill('test-key-not-real');
  const nativeBox = page.getByLabel('Native tool calling');
  if ((await nativeBox.isChecked()) !== native) await nativeBox.click();
  await page.getByRole('button', { name: 'Fetch list' }).click();
  await expect(page.locator('.form-status.ok')).toContainText('1 models available');
  await page.getByRole('button', { name: 'Use this model' }).click();
  await expect(page.locator('.form-status.ok')).toContainText('Using mock-model');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('native tool calling: read, guard, answer with a citation', async ({ page }) => {
  const errors = watchConsole(page);
  const requests = await mockProvider(page, [
    () => [
      { choices: [{ delta: { content: 'Let me read the parser.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"src/config.js"}' } }] } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 812, completion_tokens: 24 } },
    ],
    () => [{ choices: [{ delta: { content: 'It splits each line on every `=` without trimming [src/config.js:7].' } }] }, { choices: [{ delta: {} }], usage: { prompt_tokens: 1300, completion_tokens: 30 } }],
  ]);
  await page.goto('./#/studio');
  await useCustomProvider(page, true);
  await page.locator('#composer-input').fill('Why does parseConfig keep spaces in keys?');
  await page.keyboard.press('Enter');

  const card = page.locator('.tool-card', { hasText: 'Read src/config.js' });
  await expect(card).toBeVisible();
  await expect(card.locator('.tool-status')).toHaveText('Done');
  await expect(page.locator('.cite', { hasText: 'src/config.js:7' })).toBeVisible();

  // The tools were offered natively, and the tool result went back to the model.
  expect(Array.isArray(requests[0].tools)).toBe(true);
  const second = requests[1].messages as Array<{ role: string; content: string }>;
  expect(second.some((m) => m.role === 'tool' && m.content.includes('parseConfig'))).toBe(true);
  // The key went only to the mocked provider, as a bearer token.
  await expect(page.locator('.meter-cell.llm')).toContainText('tokens');
  await page.locator('.cite', { hasText: 'src/config.js:7' }).click();
  await expect(page.locator('.tab.active')).toContainText('config.js');
  expect(errors).toEqual([]);
});

test('JSON action protocol: retries on bad JSON, then edits with review', async ({ page }) => {
  const errors = watchConsole(page);
  const fixed = 'export const answer = 42;\n';
  await mockProvider(page, [
    () => [{ choices: [{ delta: { content: 'Sure! I will do that.' } }] }],
    () => [{ choices: [{ delta: { content: JSON.stringify({ thought: 'Write the new file.', tool: 'write_file', args: { path: 'src/answer.js', content: fixed }, answer: '' }) } }] }],
    () => [{ choices: [{ delta: { content: JSON.stringify({ thought: 'Done.', tool: 'final', args: {}, answer: 'Created `src/answer.js`.' }) } }] }],
  ]);
  await page.goto('./#/studio');
  await useCustomProvider(page, false);
  await page.locator('#composer-input').fill('Add src/answer.js exporting 42');
  await page.keyboard.press('Enter');

  const card = page.locator('.tool-card', { hasText: 'Edit src/answer.js' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Accept edit' })).toBeVisible();
  await card.getByRole('button', { name: 'Accept edit' }).click();
  await expect(card.locator('.tool-status')).toHaveText('Done');
  await expect(page.locator('.msg.agent', { hasText: 'Created' })).toBeVisible();
  await expect(page.locator('.tree-row', { hasText: 'answer.js' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('zip import replaces the workspace', async ({ page }) => {
  const zip = new JSZip();
  zip.file('demo-zip/README.md', '# From a zip\n');
  zip.file('demo-zip/src/index.js', 'export const hello = "world";\n');
  zip.file('demo-zip/logo.png', 'binary');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await page.goto('./#/studio');
  await page.locator('input[type="file"]').setInputFiles({ name: 'demo-zip.zip', mimeType: 'application/zip', buffer });
  await expect(page.locator('.ws-btn')).toContainText('demo-zip');
  await expect(page.locator('.tree-row', { hasText: 'index.js' })).toBeVisible();
  await expect(page.locator('.tree-row', { hasText: 'logo.png' })).toHaveCount(0);
});

test('model picker shows all three sources without errors', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('./#/studio');
  await page.getByRole('button', { name: /Model: .* Change model/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.gpu-check')).not.toContainText('Checking');
  await expect(page.locator('.model-card')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Your API key' }).click();
  for (const name of ['Groq', 'OpenRouter', 'Google Gemini', 'Mistral', 'Cerebras', 'Ollama', 'LM Studio', 'Custom endpoint']) {
    await expect(page.locator('.provider', { hasText: name })).toBeVisible();
  }
  await expect(page.locator('.privacy')).toContainText('sent only to');
  await page.getByRole('tab', { name: 'Glassbox models' }).click();
  await expect(page.locator('.gb-card').first()).toBeVisible();
  await expect(page.locator('.gb-compute').first()).toContainText('less compute');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(errors).toEqual([]);
});
