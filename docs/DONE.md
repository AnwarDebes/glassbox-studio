# Glassbox Studio: status

## What works

- **Landing page** (`#/`): hero with Pixie and a live guard playground (type a
  command, the Tsetlin guard decides in the browser and shows the clauses), the
  three steps, the glassbox model cards, privacy notes, Try the demo, Open the
  studio, Install app, links to the source and the author. Footer: "Made by
  Anwar Debes".
- **Studio** (`#/studio`): file tree, Monaco editor with tabs (bundled, works
  offline), agent chat, decision timeline with an evidence inspector, ledger,
  sandbox output, Pixie in the corner, status bar. Dark glass and light themes.
  Tablet layout with a file drawer; a read-only view on phones.
- **Demo** (`#/demo` or Try the demo): a scripted session on the sample project.
  The agent reads the failing test, runs it in the sandbox (2 of 3 fail), reads
  the parser, proposes `rm -rf ~/.cache` (judged by the guard; when blocked it
  shows the evidence and takes the offered repair), proposes the fix as a diff
  that the visitor accepts, re-runs the tests (3 of 3 pass), proposes
  `git push --force` (judged by the guard), summarises, and verifies the ledger.
  The words are scripted; routing, guard decisions, repairs, test runs and the
  ledger are live.
- **Agent loop**: route() on every prompt, guard() before every tool call
  (allow runs, ask pauses with evidence, block refuses and offers repairs),
  ledger entries for route, guard, human and tool events. Native tool calling for
  OpenAI-compatible providers; a schema-constrained JSON action protocol with
  validation and two retries for in-browser models (and as an automatic fallback
  when a provider rejects tool definitions).
- **Tools**: list_files, read_file, search, write_file (always a diff you accept or
  reject; with "Ask before every edit" off, guard-allowed edits apply at once and
  keep a Revert button), delete_file, run_js (Web Worker sandbox, network and
  storage removed, 5 s timeout, node:test and node:assert shims), run_command
  (never executed; judged and shown as a proposal), fetch_url (guarded).
- **Composer switches**: Glassbox guard, Show its work, Ask before every edit,
  Research mode (plan, search, read, answer with clickable file:line citations).
  Compute meter: LLM tokens, logic operations and the estimated savings factor.
- **Models**: WebLLM in a worker (Qwen2.5-Coder 1.5B and 3B, Llama 3.2 3B,
  Phi 3.5 mini; ids checked against web-llm 0.2.87's prebuiltAppConfig) with
  download size, GPU memory, cache status and a WebGPU check; bring your own key
  for Groq, OpenRouter, Gemini, Mistral, Cerebras, Custom, Ollama and LM Studio
  (keys kept in memory, or localStorage when "Remember" is ticked, and sent only
  to that provider); the glassbox models with clause counts, held-out accuracy and
  compute per decision.
- **Workspace**: sample project, local folder through the File System Access API
  (edits written to disk after approval; Ctrl+S saves editor changes), .zip import
  and export, everything persisted in IndexedDB.
- **PWA**: installable, precached for offline use after the first load (the 6 MB
  WebLLM runtime is cached on first use instead), update prompt.

## How to run

```bash
npm install
npm run dev                  # http://localhost:5173/glassbox-studio/
npm run build                # type-check (zero errors) + production build
npm run preview              # http://localhost:4173/glassbox-studio/
npx playwright install chromium
npm run test:e2e             # all end-to-end tests
npm run screenshots          # refresh docs/*.png
```

## Verification

- `npm run build`: passes with zero TypeScript errors.
- Playwright against `npm run preview`: demo flow, phone view, mocked-provider
  agent loop (native tools and JSON protocol), zip import, model picker,
  keyboard path, and axe accessibility audits (WCAG 2.1 A and AA) in both
  themes. Every flow asserts that the console stays free of errors.

## Screenshots

- `docs/screenshot-landing.png`: landing page, 1440x900, dark.
- `docs/screenshot-studio.png`: studio mid-demo, 1440x900, dark.
- `docs/screenshot-ledger-light.png`: studio after the demo with the verified
  ledger, 1440x900, light.
- `docs/screenshot-phone.png`: read-only phone view, 390x844.

## Known limitations

- In-browser models need WebGPU (recent Chrome or Edge on desktop). They could not
  be exercised in the headless test browser, which has no GPU adapter; the
  loading path, worker and JSON protocol are covered by code review and by the
  same protocol running against a mocked provider.
- Bring-your-own-key providers are called straight from the browser. That relies
  on each provider allowing cross-origin requests; local servers (Ollama,
  LM Studio) must be configured to allow this page's origin.
- `run_command` never executes in the browser by design; `run_js` only runs
  JavaScript (ES modules and CommonJS across workspace files, no npm packages,
  no Node built-ins beyond node:test and node:assert).
- Opening a local folder needs the File System Access API (Chrome and Edge). Other
  browsers can import and export .zip files instead.
- Compute comparisons with an LLM judge are estimates, labelled as such in the UI.
