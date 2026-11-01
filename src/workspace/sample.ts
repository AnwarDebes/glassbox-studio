// The bundled sample project: a tiny Node service whose config parser has a
// real bug, with real tests that fail until it is fixed. The studio runs these
// tests in its browser sandbox, so "tests pass" is an actual result.

export const SAMPLE_NAME = 'my-app';

const CONFIG_JS = `// Parse KEY=VALUE lines (like a .env file) into a config object.
// Keys are lower-cased; "true", "false" and numbers are converted.
export function parseConfig(text) {
  const config = {};
  for (const line of text.split("\\n")) {
    if (!line || line.startsWith("#")) continue;
    const [key, value] = line.split("=");
    config[key.toLowerCase()] = coerce(value);
  }
  return config;
}

function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
}
`;

/** The corrected parser the demo agent proposes. */
export const CONFIG_JS_FIXED = `// Parse KEY=VALUE lines (like a .env file) into a config object.
// Keys are lower-cased; "true", "false" and numbers are converted.
export function parseConfig(text) {
  const config = {};
  for (const raw of text.split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    config[key.toLowerCase()] = coerce(value);
  }
  return config;
}

function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
}
`;

const CONFIG_TEST_JS = `import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config.js";

test("parses KEY=VALUE pairs", () => {
  assert.deepEqual(parseConfig("PORT=3000\\nDEBUG=true"), { port: 3000, debug: true });
});

test("tolerates spaces around =", () => {
  assert.deepEqual(parseConfig("PORT = 3000\\nDEBUG = true"), { port: 3000, debug: true });
});

test("keeps everything after the first =", () => {
  assert.deepEqual(parseConfig("GREETING=a=b"), { greeting: "a=b" });
});
`;

const GREET_JS = `// Build the greeting the server sends back.
export function greet(name, config = {}) {
  const word = config.greeting ?? "hello";
  const who = String(name || "friend").trim();
  return \`\${word}, \${who}!\`;
}
`;

const GREET_TEST_JS = `import { test } from "node:test";
import assert from "node:assert/strict";
import { greet } from "../src/greet.js";

test("greets by name", () => {
  assert.equal(greet("Ada", { greeting: "hello" }), "hello, Ada!");
});

test("falls back to friend", () => {
  assert.equal(greet("", {}), "hello, friend!");
});
`;

const SERVER_JS = `import http from "node:http";
import fs from "node:fs";
import { parseConfig } from "./config.js";
import { greet } from "./greet.js";

// Settings come from .env in the project root.
const config = parseConfig(fs.readFileSync(".env", "utf8"));
const port = config.port ?? 3000;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const body = greet(url.searchParams.get("name"), config);
  if (config.debug) console.log(req.method, url.pathname);
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(body);
});

server.listen(port, () => {
  console.log(\`my-app listening on http://localhost:\${port}\`);
});
`;

const ENV = `# Local settings for my-app
PORT = 3000
DEBUG = true
GREETING = hello from my-app
`;

const PACKAGE_JSON = `{
  "name": "my-app",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  }
}
`;

const README = `# my-app

A tiny HTTP service that greets people. It reads its settings from \`.env\`.

## Run

\`\`\`bash
npm start        # http://localhost:3000/?name=Ada
npm test         # node's built-in test runner
\`\`\`

## Layout

- \`src/config.js\` parses \`.env\` into a config object
- \`src/greet.js\` builds the reply
- \`src/server.js\` wires both into an HTTP server
- \`test/\` holds the tests
`;

const ARCHITECTURE = `# How my-app fits together

1. On start, \`src/server.js\` reads \`.env\` from the project root.
2. \`parseConfig\` in \`src/config.js\` turns each \`KEY=VALUE\` line into a
   lower-cased key with a converted value (\`true\`/\`false\`/numbers).
3. The server listens on \`config.port\` and falls back to 3000.
4. Every request is answered by \`greet\` in \`src/greet.js\`, which uses
   \`config.greeting\` when present.

Known issue: settings written with spaces around \`=\` (for example
\`PORT = 3000\`) are not read correctly.
`;

const GITIGNORE = `node_modules/
.cache/
`;

export function sampleFiles(): Record<string, string> {
  return {
    'README.md': README,
    'package.json': PACKAGE_JSON,
    '.env': ENV,
    '.gitignore': GITIGNORE,
    'docs/architecture.md': ARCHITECTURE,
    'src/config.js': CONFIG_JS,
    'src/greet.js': GREET_JS,
    'src/server.js': SERVER_JS,
    'test/config.test.js': CONFIG_TEST_JS,
    'test/greet.test.js': GREET_TEST_JS,
  };
}
