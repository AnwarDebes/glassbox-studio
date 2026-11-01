"""Synthetic, labelled chat prompts for the router (answer | edit | run | search | research).

Intent definitions used for labelling:

answer    reply directly from knowledge and the visible conversation: explain a
          concept, an error, a snippet or a command; opinions; small talk.
          "How do I run tests in pytest?" is answer (it asks for instructions).
edit      change files in the workspace: add, fix, refactor, rename, write
          tests or docs, delete code, change config.
run       execute something: tests, builds, linters, installs, scripts,
          servers, git operations, deploys.  "Does the build pass?" is run.
search    locate or show things inside the workspace: where is X defined,
          find usages, list files, show me a file.
research  look up external, possibly fresh information: latest versions,
          docs, changelogs, CVEs, benchmarks, library recommendations, URLs.
"""
from __future__ import annotations

import random

FILES = ["src/App.tsx", "the README", "package.json", "auth.py", "server.go", "utils/date.ts", "the login page", "api/routes.py",
         "Navbar.tsx", "the Dockerfile", "vite.config.ts", "tsconfig.json", "main.rs", "the CI workflow", "index.html", "styles.css",
         "the users migration", "models/user.py", "src/lib/api.ts", "checkout.tsx", "config.yaml", "the Makefile", "db.go"]
FUNCS = ["fetchUser", "handleSubmit", "parseConfig", "useAuth", "calculateTotal", "formatDate", "validateEmail", "debounce",
         "getOrders", "renderList", "connectDb", "retryRequest", "slugify", "parse_invoice", "send_email", "loadSettings"]
COMPONENTS = ["navbar", "login form", "sidebar", "settings page", "checkout modal", "search bar", "user avatar", "pagination",
              "toast", "footer", "cart badge", "dashboard", "date picker", "file uploader", "pricing table"]
LIBS = ["React", "Vue", "Svelte", "Angular", "Express", "Django", "FastAPI", "Flask", "Tailwind", "Prisma", "Zod", "lodash", "axios",
        "Vite", "webpack", "Next.js", "Remix", "Astro", "Jest", "Vitest", "Playwright", "Redux", "Zustand", "TanStack Query",
        "SQLAlchemy", "Pydantic", "NumPy", "pandas", "Bun", "Deno", "Node.js", "Kubernetes", "Docker", "Terraform", "PostgreSQL",
        "Redis", "MongoDB", "GraphQL", "tRPC", "esbuild", "Electron", "Tauri", "htmx", "Solid", "Qwik"]
LANGS = ["JavaScript", "TypeScript", "Python", "Rust", "Go", "Java", "C#", "Kotlin", "Ruby", "C++", "Swift", "Elixir"]
CONCEPTS = ["closures", "promises", "async/await", "the event loop", "generics", "dependency injection", "memoization", "CORS",
            "JWT auth", "hoisting", "the virtual DOM", "React hooks", "useEffect cleanup", "tail recursion", "big-O notation",
            "race conditions", "deadlocks", "database indexes", "ACID transactions", "eventual consistency", "websockets",
            "server components", "hydration", "tree shaking", "monads", "currying", "immutability", "garbage collection",
            "the borrow checker", "lifetimes in Rust", "goroutines", "channels", "decorators in Python", "list comprehensions",
            "type narrowing", "discriminated unions", "optional chaining", "CSS specificity", "flexbox", "CSS grid",
            "Tsetlin machines", "gradient descent", "hash maps", "binary search", "recursion", "SQL joins", "normalization",
            "OAuth flows", "rate limiting", "caching strategies", "semantic versioning", "git rebase", "debouncing", "SSR",
            "the actor model", "pure functions", "event sourcing", "CQRS", "content security policy", "XSS"]
PAIRS = [("let", "const"), ("== ", "==="), ("interface", "type"), ("REST", "GraphQL"), ("SQL", "NoSQL"), ("merge", "rebase"),
         ("props", "state"), ("useMemo", "useCallback"), ("threads", "processes"), ("a list", "a tuple"), ("map", "forEach"),
         ("null", "undefined"), ("unit tests", "integration tests"), ("PUT", "PATCH"), ("cookies", "localStorage"),
         ("abstract classes", "interfaces"), ("async", "defer"), ("SSR", "SSG"), ("var", "let"), ("Box", "Rc")]
ERRORS = ["TypeError: Cannot read properties of undefined (reading 'map')", "ModuleNotFoundError: No module named 'requests'",
          "ECONNREFUSED 127.0.0.1:5432", "error TS2339: Property 'id' does not exist on type 'never'",
          "Hydration failed because the initial UI does not match", "No 'Access-Control-Allow-Origin' header is present",
          "segmentation fault (core dumped)", "fatal: refusing to merge unrelated histories", "panic: runtime error: index out of range",
          "Maximum update depth exceeded", "SyntaxError: Unexpected token '<'", "npm ERR! code ERESOLVE",
          "Error: listen EADDRINUSE: address already in use :::3000", "borrowed value does not live long enough",
          "Uncaught ReferenceError: process is not defined", "KeyError: 'user_id'", "java.lang.NullPointerException"]
TASKS = ["parse dates", "validate forms", "handle file uploads", "send emails", "rate-limit an API", "store sessions", "generate PDFs",
         "resize images", "build a CLI", "do i18n", "add auth", "virtualize long lists", "schedule background jobs",
         "stream responses", "deploy a static site", "cache API responses", "test React components", "manage feature flags",
         "process payments", "render markdown", "draw charts", "handle websockets", "write end-to-end tests"]
SERVICES = ["Stripe", "Twilio", "SendGrid", "GitHub Actions", "Vercel", "Netlify", "Cloudflare Workers", "AWS Lambda", "Supabase",
            "Firebase", "Mapbox", "the GitHub REST API", "the OpenWeather API", "Sentry", "Fly.io"]
VERSIONS = ["5", "19", "4.0", "3.12", "22", "8", "2.0", "1.80", "15", "7", "6.2", "3"]
CMDS = ["npm test", "the tests", "the unit tests", "the e2e tests", "the build", "the linter", "the type checker", "prettier",
        "the migrations", "the seed script", "pytest", "cargo test", "go test ./...", "the benchmarks", "storybook",
        "docker compose up", "the formatter", "npm run build", "npm run lint", "tsc", "the integration suite", "make"]
PKGS = ["lodash", "zod", "axios", "date-fns", "requests", "pydantic", "serde", "tailwindcss", "vitest", "prisma", "dayjs", "httpx"]
BRANCHES = ["feature/login", "fix/cart-total", "chore/deps", "dark-mode", "refactor-api"]
TERMS = ["API_URL", "TODO", "useEffect", "localStorage", "deprecated", "console.log", "fetch(", "process.env", "any", "FIXME",
         "setTimeout", "eval", "SELECT *", "@ts-ignore", "password"]
FEATURES = ["dark mode", "a search filter", "infinite scroll", "keyboard shortcuts", "a loading state", "form validation",
            "an undo button", "rate limiting", "a retry button", "a copy-to-clipboard button", "CSV export", "pagination",
            "a health check endpoint", "a confirmation dialog", "optimistic updates"]
URLS = ["https://react.dev/blog/2024/12/05/react-19", "https://nodejs.org/en/blog/release/v22.11.0",
        "https://github.com/vitejs/vite/discussions/15886", "https://web.dev/articles/inp", "https://martinfowler.com/articles/microservices.html",
        "https://blog.example.com/postgres-tips", "https://arxiv.org/abs/1804.01508"]
CODE = ["for (let i = 0; i <= arr.length; i++) { sum += arr[i] }", "const x = await fetch(url).json()",
        "def add(a, b=[]):\n    b.append(a)\n    return b", "useEffect(() => { setCount(count + 1) })", "SELECT * FROM users WHERE name = '" + "' + name",
        "if (user = null) return", "let v: Vec<i32> = vec![1, 2]; let r = &v; drop(v);", "x == null ? 'a' : 'b'"]
COLORS = ["blue", "emerald", "#10b981", "dark gray", "amber", "red"]

Q = "q"
IMP = "imp"

ANSWER = [
    (Q, "what is {concept}?"), (Q, "what are {concept}?"), (IMP, "explain {concept}"), (IMP, "explain {concept} like I'm five"),
    (Q, "can you explain {concept} in {lang}?"), (Q, "how does {concept} work?"), (Q, "how do {concept} work in {lang}?"),
    (Q, "why do we need {concept}?"), (Q, "what's the difference between {p1} and {p2}?"), (Q, "when should I use {p1} instead of {p2}?"),
    (Q, "is {lib} a framework or a library?"), (Q, "what does this error mean: {error}"), (Q, "why am I getting {error}?"),
    (Q, "what does {func} do?"), (IMP, "explain what {func} does"), (IMP, "explain this code: ```{code}```"),
    (IMP, "review this snippet ```{code}```"), (Q, "is this a good way to write it? ```{code}```"),
    (Q, "what's the time complexity of binary search?"), (Q, "how do I write a for loop in {lang}?"),
    (Q, "how do I declare a constant in {lang}?"), (IMP, "give me an example of {concept} in {lang}"), (IMP, "summarize what we did so far"),
    (Q, "thanks, that worked!"), (Q, "hi"), (Q, "hello there"), (Q, "good morning"), (Q, "what can you do?"), (Q, "who are you?"),
    (Q, "what's a good name for a function that {does}?"), (Q, "should I use tabs or spaces?"), (Q, "is it bad practice to {practice}?"),
    (Q, "what's a good way to structure a {lib} project?"), (Q, "how do I center a div?"), (Q, "how would you approach {task_ing}?"),
    (Q, "what are the pros and cons of {lib}?"), (Q, "what does `{cmd_text}` do?"), (Q, "how do I run tests in pytest?"),
    (Q, "what's the command to start the dev server?"), (IMP, "explain the search algorithm in binarySearch"),
    (Q, "why would someone use git rebase?"), (Q, "can you walk me through how {concept} works?"), (Q, "I don't understand {concept}"),
    (IMP, "ELI5 {concept}"), (Q, "what is the purpose of {file}?"), (Q, "why is my {component} re-rendering so often?"),
    (Q, "what's wrong with this code? ```{code}```"), (Q, "what does idempotent mean?"), (Q, "is {lib} better than {lib2}?"),
    (Q, "how do I edit a file in vim?"), (Q, "what happens when I run npm install?"), (Q, "how should I name {component} props?"),
    (Q, "does {concept} matter for a small app?"), (Q, "can you tell me why {concept} is useful?"), (IMP, "describe {concept} in one paragraph"),
    (Q, "is {code_short} valid {lang}?"), (Q, "what is the output of {code_short}?"), (Q, "why is {concept} considered hard?"),
    (IMP, "tell me a fun fact about {lang}"), (Q, "how do I search an array in JavaScript?"), (Q, "how do I install packages with pip?"),
    (Q, "what is a monorepo and should I use one?"), (Q, "what's the point of {file}?"), (Q, "makes sense, but why does {concept} need {concept2}?"),
    (IMP, "compare {p1} and {p2} for me"), (Q, "which is more readable, {p1} or {p2}?"), (Q, "how should I think about {concept}?"),
]
EDIT = [
    (IMP, "add {feature} to the {component}"), (IMP, "fix the bug in {func}"), (IMP, "fix {error} in {file}"), (IMP, "rename {func} to {func2}"),
    (IMP, "refactor {file} to use {lib}"), (IMP, "write unit tests for {func}"), (IMP, "write a test for {func} that covers empty input"),
    (IMP, "create a new {component} component"), (IMP, "update the README with setup instructions"), (IMP, "change the button color to {color}"),
    (IMP, "remove the unused imports in {file}"), (IMP, "convert {file} to TypeScript"), (IMP, "implement {feature}"), (IMP, "make {func} async"),
    (IMP, "add error handling to {func}"), (IMP, "replace moment with date-fns"), (IMP, "add types to {file}"), (IMP, "move {func} into utils"),
    (IMP, "delete the old {component} component"), (IMP, "bump the version to {ver}.0.0 in package.json"), (IMP, "add .env to .gitignore"),
    (IMP, "fix the failing test in {file}"), (IMP, "make the tests pass"), (IMP, "set up eslint and prettier in the repo"),
    (IMP, "add a dark mode toggle"), (IMP, "translate the UI strings to Norwegian"), (IMP, "optimize {func}"), (IMP, "add logging to {func}"),
    (IMP, "use zod for validation in {file}"), (IMP, "add a loading spinner to the {component}"), (IMP, "make the {component} responsive"),
    (IMP, "extract the {component} into its own file"), (IMP, "add a docstring to {func}"), (IMP, "add comments to {file}"),
    (IMP, "change the port from 3000 to 8080"), (IMP, "add a /health endpoint"), (IMP, "write a migration that adds an email column"),
    (IMP, "create a GitHub Actions workflow that runs the tests"), (IMP, "add pagination to the orders endpoint"),
    (IMP, "fix the typo in the header"), (IMP, "find and fix the off-by-one error in {func}"), (IMP, "search and replace foo with bar across the project"),
    (IMP, "run through {file} and add type hints"), (IMP, "write a script that runs the tests"), (Q, "can you make the search bar debounce?"),
    (IMP, "update {func} so it handles null"), (IMP, "implement the TODO in {file}"), (IMP, "add retry logic to {func}"),
    (IMP, "make {func} return a Result instead of throwing"), (IMP, "split {file} into smaller modules"), (IMP, "remove the console.logs from src"),
    (IMP, "add aria labels to the {component}"), (IMP, "rewrite {func} without recursion"), (IMP, "change {func} to use {lib}"),
    (IMP, "add a {lib} config file"), (IMP, "make the {component} accessible"), (IMP, "add a prop to the {component} for {feature_small}"),
    (IMP, "fix this: {error}"), (IMP, "the {component} looks broken on mobile, fix it"), (IMP, "add input validation to the {component}"),
    (IMP, "change the copy on the {component} to say 'Welcome back'"), (IMP, "write the missing tests"), (IMP, "add {feature} please"),
    (IMP, "port {func} from {lang} to {lang2}"), (IMP, "make {func} generic"), (IMP, "clean up {file}"), (IMP, "edit {file} to export {func}"),
    (IMP, "put the API url in an env variable"), (IMP, "add a CHANGELOG entry for this release"), (Q, "can you add {feature} to the {component}?"),
    (Q, "could you fix the {component} styling?"), (IMP, "patch {func} to avoid the race condition"), (IMP, "replace the any types in {file}"),
]
RUN = [
    (IMP, "run the tests"), (IMP, "run {cmd}"), (Q, "can you run {cmd}?"), (IMP, "start the dev server"), (IMP, "build the project"),
    (IMP, "execute the migrations"), (IMP, "install {pkg}"), (IMP, "npm install {pkg}"), (IMP, "`npm test`"), (IMP, "check if it compiles"),
    (Q, "does it build?"), (IMP, "run the linter"), (IMP, "lint the code"), (IMP, "type-check the project"), (IMP, "run the e2e tests"),
    (IMP, "deploy to staging"), (IMP, "restart the server"), (IMP, "run {file}"), (IMP, "execute scripts/seed.py"), (IMP, "benchmark {func}"),
    (IMP, "run git status"), (IMP, "commit the changes"), (IMP, "commit with message '{msg}'"), (IMP, "push the branch"),
    (IMP, "create a branch called {branch}"), (IMP, "show me the test output"), (Q, "are the tests passing?"), (IMP, "try compiling with --strict"),
    (IMP, "kill the process on port 3000"), (IMP, "open a python shell"), (IMP, "format all files with prettier"), (IMP, "update the dependencies"),
    (IMP, "run npm audit"), (IMP, "rebuild the docker image"), (IMP, "run the seed script"), (IMP, "start the database"),
    (IMP, "clear the cache and rebuild"), (IMP, "re-run the failing tests"), (IMP, "check the bundle size"), (IMP, "time how long the build takes"),
    (IMP, "ping the API to see if it's up"), (Q, "what's the output of `ls -la`?"), (Q, "does `npm run build` pass?"), (IMP, "pip install {pkg}"),
    (IMP, "cargo build --release"), (IMP, "go test ./..."), (IMP, "run the app"), (IMP, "execute the notebook"), (IMP, "generate the coverage report"),
    (IMP, "run tsc"), (IMP, "start storybook"), (IMP, "spin up the containers"), (IMP, "tail the server logs"), (IMP, "run {cmd} again"),
    (IMP, "rerun {cmd} with verbose output"), (Q, "can you check whether {cmd} passes?"), (IMP, "test it"), (IMP, "try running it"),
    (IMP, "execute {cmd} and tell me what fails"), (IMP, "run the tests for {func}"), (IMP, "install the dependencies"), (IMP, "yarn add {pkg}"),
    (IMP, "uninstall {pkg}"), (IMP, "merge {branch} into main"), (IMP, "stash my changes"), (IMP, "pull the latest from main"),
    (IMP, "run the dev server on port 8080"), (IMP, "start the backend"), (IMP, "run make build"), (IMP, "run the formatter"),
    (Q, "is the server still running?"), (Q, "do the tests pass now?"), (IMP, "run the benchmarks and compare"), (IMP, "fire up the api"),
    (IMP, "execute `{cmd_text}`"), (IMP, "run `{cmd_text}` for me"),
]
SEARCH = [
    (Q, "where is {func} defined?"), (IMP, "find all usages of {func}"), (Q, "which files import {lib}?"), (IMP, "search the codebase for {term}"),
    (IMP, "grep for {term}"), (IMP, "list all TODO comments"), (IMP, "show me {file}"), (IMP, "open {file}"), (IMP, "find the {component} component"),
    (Q, "where do we handle {feature_small}?"), (IMP, "list the files in src"), (Q, "what files are in the components folder?"),
    (IMP, "locate the config for {lib}"), (IMP, "find where the API base url is set"), (IMP, "search for '{term}' in the project"),
    (Q, "which component renders the {component}?"), (Q, "are there any hardcoded API keys in the repo?"), (IMP, "find duplicated code in utils"),
    (Q, "where is the database connection configured?"), (IMP, "show me the tests for {func}"), (IMP, "find the file that handles routing"),
    (Q, "what calls {func}?"), (Q, "who uses {func}?"), (Q, "is {func} used anywhere?"), (IMP, "look for any usage of eval in the codebase"),
    (IMP, "list every place we call fetch"), (IMP, "find the env vars the app reads"), (Q, "which tests cover {func}?"),
    (Q, "where's the {component} styled?"), (IMP, "find {file}"), (Q, "do we have a util for {task}?"), (IMP, "check if there's already a {component} component"),
    (IMP, "show the contents of {file}"), (IMP, "print {file}"), (IMP, "find references to {lib} in the code"), (IMP, "grep the repo for TODOs"),
    (Q, "where does the app read the PORT variable?"), (IMP, "find the migration that created the users table"), (IMP, "search our code for deprecated APIs"),
    (IMP, "locate where errors are logged"), (IMP, "show me the folder structure"), (Q, "in which file is {func}?"), (IMP, "find {term} in {file}"),
    (Q, "where in the code do we call {service_short}?"), (IMP, "list the React components we have"), (IMP, "show me where {func} is imported"),
    (Q, "which files changed the most?"), (IMP, "find the {component} styles"), (Q, "do we use {lib} anywhere?"), (IMP, "look up {func} in the codebase"),
    (IMP, "search the repo for {term}"), (IMP, "find every {lib} import"), (Q, "where are the routes declared?"), (IMP, "show me {func}"),
    (Q, "what's in {file}?"), (IMP, "pull up {file}"), (Q, "where did we put the {component}?"), (IMP, "find the tests folder"),
    (Q, "how many files reference {func}?"), (IMP, "scan the project for {term}"), (IMP, "locate {func}"),
]
RESEARCH = [
    (Q, "what's the latest version of {lib}?"), (IMP, "look up the docs for {lib}"), (IMP, "search the web for {topic}"),
    (IMP, "find the official guide for {topic}"), (IMP, "compare {lib} and {lib2} performance in 2026"), (Q, "is {lib} still maintained?"),
    (Q, "are there any known vulnerabilities in {lib} {ver}?"), (Q, "what's the recommended way to {task} according to the {lib} docs?"),
    (IMP, "find a library to {task}"), (Q, "what are people using to {task} these days?"), (IMP, "check the changelog for {lib} {ver}"),
    (Q, "what changed in {lib} {ver}?"), (IMP, "google how to {task}"), (IMP, "look up the {service} API rate limits"),
    (IMP, "find benchmarks for {lib} vs {lib2}"), (Q, "what's the browser support for {web_feature}?"), (Q, "is {web_feature} supported in Safari?"),
    (IMP, "find the GitHub issue about {error}"), (IMP, "research best practices for {topic} in 2026"), (Q, "what's the pricing of {service}?"),
    (IMP, "read the RFC for {protocol}"), (IMP, "fetch the docs at {url}"), (IMP, "summarize this article: {url}"), (Q, "what does {url} say about {topic}?"),
    (Q, "any news on {lib} {ver}?"), (IMP, "find a tutorial on {topic}"), (IMP, "search stack overflow for {error}"),
    (IMP, "look online for why {error} happens"), (Q, "which {category} libraries are most popular right now?"), (Q, "what's the current LTS version of Node?"),
    (IMP, "find recent papers on Tsetlin machines"), (Q, "what do the {lib} maintainers recommend to {task}?"), (IMP, "check npm for a package that can {task}"),
    (IMP, "look up the {lib} migration guide from {ver} to {ver2}"), (Q, "is there an official {lib} plugin for {lib2}?"), (Q, "when was {lib} {ver} released?"),
    (Q, "what's the community consensus on {lib} vs {lib2} in 2026?"), (IMP, "find examples of how to {task} on GitHub"), (IMP, "search for a library to {task}"),
    (Q, "has {lib} fixed the {error} bug yet?"), (Q, "what's new in {lang} this year?"), (IMP, "check if {lib} {ver} has breaking changes"),
    (Q, "does {service} support webhooks?"), (IMP, "look up how {service} handles retries"), (IMP, "browse the {lib} docs for {topic}"),
    (Q, "what is the most recent stable release of {lib}?"), (IMP, "find out whether {lib} works with {lib2} now"), (Q, "which cloud is cheapest for {task_ing} today?"),
    (IMP, "research {topic}"), (IMP, "go read {url} and tell me the key points"), (Q, "is there a CVE for {lib} {ver}?"), (IMP, "check the {service} status page"),
    (Q, "what are the {service} API limits these days?"), (IMP, "dig up the {lib} roadmap"), (IMP, "look up {topic} online"),
    (Q, "what's trending in {lang} tooling right now?"), (IMP, "find the docs page for {lib}'s config options"), (IMP, "search github for {lib} starter templates"),
]
TOPICS = ["JWT refresh tokens", "React server components", "edge rendering", "WebGPU", "passkeys", "OAuth 2.1", "CSS container queries",
          "Postgres connection pooling", "monorepo tooling", "Rust async runtimes", "LLM evaluation", "web accessibility",
          "zero-downtime deploys", "SQLite in production", "Tsetlin machine interpretability", "WebAssembly components"]
WEB_FEATURES = ["the View Transitions API", "CSS nesting", "popover", "the File System Access API", "WebGPU", ":has()", "WebTransport", "import maps"]
PROTOCOLS = ["HTTP/3", "OAuth 2.1", "WebSocket", "TLS 1.3", "JSON Patch", "CORS"]
CATEGORIES = ["state management", "charting", "form", "date", "testing", "ORM", "animation", "auth"]
DOES = ["checks if a user is an admin", "turns a title into a URL slug", "retries a failed request", "groups items by key"]
PRACTICES = ["use any in TypeScript", "commit node_modules", "catch all exceptions", "use global variables", "put logic in templates"]
MSGS = ["fix cart total", "add dark mode", "wip", "update deps"]
CMD_TEXT = ["npm run build", "git rebase -i HEAD~3", "docker compose up -d", "pytest -x", "npx tsc --noEmit", "ls -la", "cargo clippy"]
CODE_SHORT = ["`[] + {}`", "`typeof null`", "`0.1 + 0.2`", "`'5' * 2`", "`len([1, 2, 3])`"]
FEATURE_SMALL = ["auth", "file uploads", "payments", "errors", "retries", "caching", "logging", "routing"]
SERVICE_SHORT = ["Stripe", "the payments API", "S3", "Sentry", "the weather API"]

IMP_PREFIX = ["", "", "", "", "", "please ", "can you ", "could you ", "hey, ", "pls ", "I need you to ", "go ahead and ", "now ", "ok ",
              "would you ", "let's ", "next, ", "also ", "quickly ", "kindly ", "yo ", "alright, "]
Q_PREFIX = ["", "", "", "", "", "", "quick question: ", "hey, ", "I'm curious: ", "so ", "ok so ", "hmm, ", "btw ", "question: "]
SUFFIX = ["", "", "", "", "", "", " please", " thanks", " thx", ".", "!", " asap", " when you get a chance", " for me",
          " \U0001F64F", " :)", " - thanks!", " — cheers"]


def _fill(r: random.Random, t: str) -> str:
    lib, lib2 = r.sample(LIBS, 2)
    lang, lang2 = r.sample(LANGS, 2)
    func, func2 = r.sample(FUNCS, 2)
    p1, p2 = r.choice(PAIRS)
    concept, concept2 = r.sample(CONCEPTS, 2)
    v1, v2 = r.sample(VERSIONS, 2)
    vals = {
        "concept": concept, "concept2": concept2, "lang": lang, "lang2": lang2, "p1": p1.strip(), "p2": p2.strip(), "lib": lib,
        "lib2": lib2, "error": r.choice(ERRORS), "func": func, "func2": func2, "code": r.choice(CODE), "does": r.choice(DOES),
        "practice": r.choice(PRACTICES), "task": r.choice(TASKS), "task_ing": r.choice(TASKS).replace("do ", "doing ")
        .replace("build ", "building ").replace("add ", "adding "), "cmd_text": r.choice(CMD_TEXT), "file": r.choice(FILES),
        "component": r.choice(COMPONENTS), "feature": r.choice(FEATURES), "color": r.choice(COLORS), "ver": v1, "ver2": v2,
        "cmd": r.choice(CMDS), "pkg": r.choice(PKGS), "msg": r.choice(MSGS), "branch": r.choice(BRANCHES), "term": r.choice(TERMS),
        "feature_small": r.choice(FEATURE_SMALL), "service_short": r.choice(SERVICE_SHORT), "topic": r.choice(TOPICS),
        "service": r.choice(SERVICES), "web_feature": r.choice(WEB_FEATURES), "protocol": r.choice(PROTOCOLS), "url": r.choice(URLS),
        "category": r.choice(CATEGORIES), "code_short": r.choice(CODE_SHORT),
    }
    return t.format(**vals)


def _typo(r: random.Random, s: str) -> str:
    words = s.split(" ")
    idx = [i for i, w in enumerate(words) if len(w) > 4 and w.isalpha()]
    if not idx:
        return s
    i = r.choice(idx)
    w = words[i]
    j = r.randrange(1, len(w) - 2)
    words[i] = w[:j] + w[j + 1] + w[j] + w[j + 2:]
    return " ".join(words)


def _surface(r: random.Random, kind: str, body: str) -> str:
    pre = r.choice(IMP_PREFIX if kind == IMP else Q_PREFIX)
    suf = r.choice(SUFFIX)
    if kind == Q and suf in (".", "!"):
        suf = ""
    s = pre + body + suf
    k = r.random()
    if k < 0.18:
        s = s[0].upper() + s[1:]
    elif k < 0.20:
        s = s.upper()
    if r.random() < 0.05:
        s = _typo(r, s)
    if kind == Q and r.random() < 0.15 and s.endswith("?"):
        s = s[:-1]
    return s


INTENTS = {"answer": (ANSWER, 540), "edit": (EDIT, 540), "run": (RUN, 520), "search": (SEARCH, 500), "research": (RESEARCH, 500)}


def build(seed: int = 11) -> list[dict]:
    r = random.Random(seed)
    seen: dict[str, str] = {}
    out: list[dict] = []
    for intent, (templates, n) in INTENTS.items():
        made = tries = 0
        while made < n and tries < n * 20:
            tries += 1
            kind, t = r.choice(templates)
            prompt = _surface(r, kind, _fill(r, t))
            key = prompt.strip().lower()
            if key in seen:
                if seen[key] != intent:
                    raise ValueError(f"label conflict: {prompt!r}")
                continue
            seen[key] = intent
            out.append({"prompt": prompt, "label": intent, "template": t})
            made += 1
    for i, d in enumerate(out):
        d["id"] = f"r{i:05d}"
    return out
