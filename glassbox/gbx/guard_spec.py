"""Feature specification for the Glassbox guard (tool-call -> allow | ask | block).

Everything that can be expressed as data lives here and is exported verbatim
into public/models/glassbox-guard.json, where src/glassbox/guard-features.ts
reads it.  Python and TypeScript therefore run the *same* regular expressions;
only the small procedural parts (shell tokenizer, path resolution, host
extraction) are implemented twice and checked by the parity test.

Regex rules, so that Python ``re`` (with re.ASCII) and JavaScript ``RegExp``
(no flags) agree on the normalised, pure-ASCII, lower-cased input:

* no inline flags, no named groups, no ``\\A``/``\\Z``, no ``{,n}``;
* ``$`` is only used on single-token fields (cmdword, flag, target, host,
  urlfull, method), never on multi-line fields: Python's ``$`` also matches
  before a trailing newline, JavaScript's does not.  ``(?![\\s\\S])`` is the
  portable "end of string";
* lookbehind is not used at all.
"""
from __future__ import annotations

# --------------------------------------------------------------------------
# Argument aliases.  The studio uses `command` for run_command, `path` for the
# file tools, `url` for fetch_url, `content` for write_file, `code` for run_js
# and `query` for search; the aliases make the featurizer tolerant of other
# spellings.
# --------------------------------------------------------------------------
ARG_KEYS = {
    "cmd": ["command", "cmd"],
    "cwd": ["cwd"],
    "code": ["code", "script", "source"],
    "path": ["path", "file", "filePath", "filepath", "target", "dir", "directory"],
    "url": ["url", "href", "uri"],
    "method": ["method"],
    "content": ["content", "text", "body", "data"],
    "query": ["query", "pattern", "q", "regex"],
}

# Commands that run another command (the next word is also a command word).
WRAPPERS = ["sudo", "doas", "env", "time", "nice", "nohup", "exec", "command", "builtin",
            "xargs", "timeout", "watch", "stdbuf", "ionice", "npx", "pnpx", "bunx", "gsudo", "runas"]
# Wrapper options that take a value (sudo -u root rm ...).
WRAPPER_VALUE_FLAGS = ["-u", "-g", "-n", "-s", "-p", "-c", "-d", "-l"]

# Tools whose first non-flag argument is a subcommand worth naming (git push, npm install ...).
MULTI = ["git", "npm", "pnpm", "yarn", "bun", "pip", "pip3", "uv", "poetry", "docker", "podman", "kubectl",
         "cargo", "go", "apt", "apt-get", "brew", "terraform", "helm", "gh", "aws", "gcloud", "az",
         "systemctl", "dotnet", "conda", "composer", "gem", "deno", "rustup", "vercel", "netlify",
         "firebase", "heroku", "flyctl", "wrangler", "prisma", "make", "python", "python3", "node", "rails"]

# Commands whose non-flag arguments are file targets even if they do not look like paths.
FILE_CMDS = ["rm", "rmdir", "mv", "cp", "cat", "chmod", "chown", "chgrp", "touch", "mkdir", "ln", "head", "tail",
             "less", "more", "nano", "vi", "vim", "nvim", "source", "shred", "srm", "truncate", "tar", "zip",
             "unzip", "tee", "del", "erase", "rd", "remove-item", "ri", "get-content", "gc", "set-content",
             "add-content", "out-file", "copy-item", "move-item", "ls", "dir", "cd", "pushd", "stat", "file",
             "wc", "open", "xdg-open", "unlink", "wipe", "bat", "md5sum", "sha256sum", "base64", "xxd",
             "strings", "gpg", "sqlite3", "type", "dd", "du", "tree", "realpath", "readlink", "rimraf",
             "install", "trash", "trash-put", "scp", "rsync", "icacls", "takeown", "attrib", "chattr"]
# For these the first argument is a mode/owner, not a target.
MODE_FIRST_ARG = ["chmod", "chown", "chgrp", "chattr"]
# Pseudo-files that are never real targets.
DEV_NULL = ["/dev/null", "/dev/stdout", "/dev/stderr", "nul", "$null"]

# A pipeline segment is read-only if its head ("cmd" or "cmd sub") matches this.
READONLY_HEAD = (
    r"^(ls|ll|dir|pwd|cat|head|tail|less|more|wc|grep|egrep|fgrep|rg|ag|ack|fd|tree|stat|file|du|df|echo|printf"
    r"|which|where|whereis|whoami|id|uname|hostname|date|cal|uptime|ps|top|htop|free|diff|cmp|sort|uniq|cut|tr"
    r"|jq|yq|column|nl|basename|dirname|realpath|readlink|md5sum|sha256sum|sha1sum|shasum|cksum|true|false"
    r"|sleep|man|tldr|get-childitem|gci|get-content|gc|get-item|get-location|select-string|get-process"
    r"|get-command|bat|exa|eza|lsof|netstat|ping|nslookup|cd|pushd|popd|clear|test|wait"
    r"|git (status|diff|log|show|blame|shortlog|describe|rev-parse|ls-files|ls-remote|grep|fetch|branch|remote"
    r"|tag|reflog|stash|config|cat-file|show-ref|help|--version|version)"
    r"|npm (ls|list|view|info|outdated|why|explain|help|ping|doctor|-v|--version|config)"
    r"|pnpm (ls|list|why|outdated)|yarn (list|why|info|outdated)"
    r"|pip (list|show|freeze|check|--version|-v)|pip3 (list|show|freeze|check|--version)"
    r"|cargo (tree|metadata|--version)|go (list|env|version|vet|doc)|node (-v|--version)"
    r"|python (--version|-v)|python3 (--version|-v)|docker (ps|images|logs|inspect|version|info)"
    r"|kubectl (get|describe|logs|version|config|top|explain)|terraform (plan|validate|fmt|version|show|output|state)"
    r"|helm (list|ls|status|history|get|template|lint|show|search|version)"
    r"|gh (pr|issue|repo|run) (view|list|status|diff|checks))$"
)

LOCALHOST_HOST = r"^(localhost|127\.[0-9]+\.[0-9]+\.[0-9]+|0\.0\.0\.0|\[::1\]|::1|[a-z0-9-]+\.localhost)$"
KNOWN_HOST = (
    r"(^|\.)(github\.com|githubusercontent\.com|github\.io|gitlab\.com|bitbucket\.org|npmjs\.com|npmjs\.org"
    r"|yarnpkg\.com|pypi\.org|pythonhosted\.org|python\.org|mozilla\.org|stackoverflow\.com|stackexchange\.com"
    r"|nodejs\.org|typescriptlang\.org|react\.dev|reactjs\.org|vite\.dev|vitejs\.dev|vitest\.dev|nextjs\.org"
    r"|vuejs\.org|svelte\.dev|angular\.dev|tailwindcss\.com|webpack\.js\.org|eslint\.org|prettier\.io"
    r"|jestjs\.io|playwright\.dev|crates\.io|rust-lang\.org|docs\.rs|go\.dev|golang\.org|readthedocs\.io"
    r"|wikipedia\.org|w3\.org|whatwg\.org|jsdelivr\.net|unpkg\.com|deno\.land|deno\.com|learn\.microsoft\.com"
    r"|docs\.microsoft\.com|developer\.apple\.com|developer\.android\.com|kubernetes\.io|docker\.com"
    r"|nginx\.org|apache\.org|postgresql\.org|sqlite\.org|redis\.io|mongodb\.com|kernel\.org|rubygems\.org"
    r"|packagist\.org|maven\.org|nuget\.org|pytorch\.org|numpy\.org|scipy\.org|pandas\.pydata\.org"
    r"|djangoproject\.com|palletsprojects\.com|fastapi\.tiangolo\.com|huggingface\.co|caniuse\.com"
    r"|web\.dev|mdn\.dev|json\.org|semver\.org|rfc-editor\.org|ietf\.org|astro\.build|bun\.sh)$"
)

# --------------------------------------------------------------------------
# Re-usable pattern pieces
# --------------------------------------------------------------------------
_PIPE_TO_SHELL = (
    r"\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|fetch|http|lynx|aria2c)\b[^;&\n]*\|[ \t]*"
    r"(sudo[ \t]+(-[a-z-]+[ \t]+)*)?((ba|z|da|k|fi|tc|c)?sh|python[0-9.]*|node|perl|ruby|php|iex"
    r"|invoke-expression|pwsh|powershell)\b"
    r"|(bash|sh|zsh|source|eval|\.)[ \t]+(-c[ \t]+)?[\"']?(<\(|\$\()[ \t]*(curl|wget|iwr|irm)"
    r"|\b(iex|invoke-expression)\b[^;&\n]*\([ \t]*(iwr|irm|invoke-webrequest|invoke-restmethod|new-object)"
    r"|downloadstring\("
)
_SECRET_ASSIGN_VALUE = r"[ \t]*[:=][ \t]*[\"']?(?=[a-z0-9_\-+/=.]*[0-9])(?=[0-9_\-+/=.]*[a-z])[0-9a-z_\-+/=.]{12,}"

# --------------------------------------------------------------------------
# Regex facts: (feature, fields, pattern, readable text[, negated text]).
# Several entries may share one feature name; the feature fires if any does.
# Fields: cmd, cmdraw (case kept), code, path, url, method, content, query,
# all (every text field), cmdword, flag, target, host, urlfull.
# --------------------------------------------------------------------------
FACTS = [
    # ---- shell structure -------------------------------------------------
    ("sh:pipe", ["cmd"], r"(^|[^|])\|([^|]|(?![\s\S]))", "pipes one command into another"),
    ("sh:chain", ["cmd"], r"&&|\|\||;", "chains several commands"),
    ("sh:subshell", ["cmd"], r"\$\(|\x60", "uses command substitution $(...)"),
    ("sh:process_subst", ["cmd"], r"<\(", "uses process substitution <(...)"),
    ("sh:redirect_write", ["cmd"], r"(^|[^<>0-9&])>{1,2}[ \t]*(?!/dev/null|&)[^ \t\n|>&;]", "redirects output into a file"),
    ("sh:append", ["cmd"], r">>", "appends to a file with >>"),
    ("sh:background", ["cmd"], r"(^|[^&>])&([^&>]|(?![\s\S]))", "runs something in the background"),
    ("sh:env_var", ["cmd"], r"\$[a-z_{]", "expands an environment variable"),
    ("sh:sudo", ["cmdword"], r"^(sudo|doas|su|runas|gsudo)$", "runs with elevated privileges (sudo)"),
    ("sh:eval", ["cmd"], r"(^|[ \t;&|(])eval[ \t]|\binvoke-expression\b|\biex\b", "evaluates a string as code"),
    ("sh:base64_decode", ["all"], r"base64[ \t]+(-d|--decode|-di|-id)\b|frombase64string|\batob\(|b64decode|buffer\.from\([^)]*base64", "decodes base64"),
    ("sh:encoded_powershell", ["cmd"], r"(powershell|pwsh)(\.exe)?[^|;&\n]*[ \t]-(e|ec|en|enc|enco|encod|encode|encodedcommand)[ \t]", "runs an encoded PowerShell command"),
    ("sh:fork_bomb", ["cmd", "content", "code"], r":\(\)[ \t]*\{[^}]*:[ \t]*\|[ \t]*:[^}]*&", "is a fork bomb"),
    ("sh:inline_interpreter", ["cmd"],
     r"\b(python[0-9.]*|node|perl|ruby|php|deno|bun|osascript|lua)[ \t]+(-[a-z]*c[a-z]*|-e|--eval|-r|-p|eval)[ \t]"
     r"|\b(bash|sh|zsh|dash|ksh)[ \t]+-[a-z]*c[a-z]*[ \t]|\bcmd(\.exe)?[ \t]+/[ck][ \t]"
     r"|\b(powershell|pwsh)(\.exe)?[ \t]+(-[a-z]+[ \t]+)*-c(ommand)?[ \t]", "runs inline code through an interpreter"),
    ("sh:runs_script", ["cmdword"], r"^[a-z0-9_.-]*\.(sh|bash|zsh|ps1|bat|cmd|command)$", "runs a script file"),
    ("sh:runs_script", ["cmd"], r"\b(bash|sh|zsh|source|pwsh|powershell)[ \t]+[^- \t|;&][^ \t|;&]*\.(sh|bash|ps1)\b", "runs a script file"),

    # ---- what kind of command --------------------------------------------
    ("exec:test", ["cmd"],
     r"\b(npm|pnpm|yarn|bun)[ \t]+(run[ \t]+)?test\b|\b(pytest|jest|vitest|mocha|ava|rspec|phpunit|tox|nox)\b"
     r"|\b(cargo|go|dotnet|mvn|gradle|gradlew|mix|swift|deno|bun)[ \t]+test\b|\bpython[0-9.]*[ \t]+-m[ \t]+(pytest|unittest)\b"
     r"|\bmake[ \t]+(test|check)\b|\bctest\b|\bplaywright[ \t]+test\b|\bnode[ \t]+--test\b", "runs the test suite"),
    ("exec:build", ["cmd"],
     r"\b(npm|pnpm|yarn|bun)[ \t]+(run[ \t]+)?build\b|\b(tsc|webpack|rollup|esbuild|parcel|turbo|cmake)\b"
     r"|\bvite[ \t]+build\b|\b(cargo|go|dotnet|mvn|gradle|swift|zig)[ \t]+build\b|\bmvn[ \t]+(package|compile)\b"
     r"|\bnext[ \t]+build\b|\bmake\b(?![ \t]+(install|deploy|clean|publish|release|uninstall))", "builds the project"),
    ("exec:lint", ["cmd"],
     r"\b(eslint|prettier|ruff|flake8|pylint|black|isort|mypy|pyright|stylelint|rubocop|golangci-lint|gofmt|rustfmt"
     r"|shellcheck|biome|oxlint)\b|tsc[ \t]+--noemit|\b(npm|pnpm|yarn)[ \t]+(run[ \t]+)?(lint|format|fmt|typecheck|check)\b"
     r"|\bcargo[ \t]+(fmt|clippy|check)\b|\bgo[ \t]+(vet|fmt)\b", "runs a linter, formatter or type checker"),
    ("exec:dev_server", ["cmd"],
     r"\b(npm|pnpm|yarn|bun)[ \t]+(run[ \t]+)?(dev|start|serve|preview|watch)\b|\bvite\b(?![ \t]+build)"
     r"|\b(flask|uvicorn|gunicorn|nodemon)\b|manage\.py[ \t]+runserver|http\.server|\bnext[ \t]+dev\b"
     r"|\b(cargo|go)[ \t]+run\b|\brails[ \t]+s(erver)?\b", "starts a local dev server or program"),
    ("exec:find_delete", ["cmd"], r"\bfind\b[^|;&\n]*[ \t](-delete|-exec[ \t]+(rm|shred|unlink)|-execdir[ \t]+rm)\b", "bulk-deletes with find"),
    ("exec:env_dump", ["cmd"],
     r"(^|[;&|(][ \t]*)(env|printenv|set|export|declare[ \t]+-x|get-childitem[ \t]+env:|gci[ \t]+env:|dir[ \t]+env:|ls[ \t]+env:)[ \t]*([|>;&)]|(?![\s\S]))",
     "dumps every environment variable"),
    ("exec:secret_var", ["cmd", "code", "content"],
     r"\$\{?[a-z_]*(api_?key|token|secret|passw(or)?d|credential|private_key|access_key)[a-z_]*"
     r"|\b(printenv|getenv)[ \t(]+[\"']?[a-z_]*(key|token|secret|passw)", "reads a secret environment variable"),
    ("exec:docker", ["cmdword"], r"^(docker|podman|docker-compose|nerdctl)$", "runs a container tool"),
    ("exec:docker_privileged", ["cmd"],
     r"--privileged|[ \t]-v[ \t]+/:|--volume[ =]/:|--pid[ =]host|--net(work)?[ =]host|docker\.sock|--cap-add[ =]?(sys_admin|all)",
     "gives a container host-level access"),
    ("exec:docker_prune", ["cmd"],
     r"\b(docker|podman)\b[^|;&\n]*\b(system[ \t]+prune|volume[ \t]+(rm|prune)|image[ \t]+prune|container[ \t]+prune|rmi)\b"
     r"|\bdocker[ -]compose\b[^|;&\n]*\bdown\b[^|;&\n]*[ \t]-v\b", "deletes containers, images or volumes"),
    ("exec:infra_apply", ["cmd"],
     r"\bterraform[ \t]+(apply|import|taint|state[ \t]+rm)\b|\bkubectl[ \t]+(apply|create|replace|patch|scale|rollout|set|edit)\b"
     r"|\bhelm[ \t]+(install|upgrade)\b|\bpulumi[ \t]+up\b|\bansible-playbook\b|\b(cdk|serverless|sam)[ \t]+deploy\b",
     "changes live infrastructure"),
    ("exec:infra_destroy", ["cmd"],
     r"\bterraform[ \t]+destroy\b|\bkubectl[ \t]+delete\b|\bhelm[ \t]+(uninstall|delete)\b|\bpulumi[ \t]+destroy\b"
     r"|\baws[ \t]+[a-z0-9-]+[ \t]+(delete|terminate|remove|rb|rm)[a-z0-9-]*\b|\bgcloud\b[^|;&\n]*[ \t]delete\b"
     r"|\baz\b[^|;&\n]*[ \t]delete\b|\bcdk[ \t]+destroy\b|\bdoctl\b[^|;&\n]*[ \t]delete\b", "destroys cloud infrastructure"),
    ("exec:deploy", ["cmd"],
     r"\bdeploy|vercel[ \t]+(--prod|deploy)|netlify[ \t]+deploy|firebase[ \t]+deploy|\bheroku\b|\bfly(ctl)?[ \t]+deploy"
     r"|wrangler[ \t]+(deploy|publish)|\bsurge\b|gh-pages", "deploys somewhere"),
    ("exec:db_cli", ["cmdword"], r"^(psql|mysql|mariadb|mongo|mongosh|redis-cli|sqlite3|sqlcmd|cqlsh)$", "opens a database client"),
    ("exec:db_destructive", ["all"],
     r"\b(drop[ \t]+(table|database|schema|collection|index|user)|truncate[ \t]+(table[ \t]+)?[a-z_\"]"
     r"|delete[ \t]+from[ \t]+[a-z_\"]+[ \t]*(;|[\"']|(?![\s\S]))|dropdatabase\(|flushall|flushdb|deletemany\([ \t]*\{[ \t]*\})",
     "runs a destructive database statement"),
    ("exec:migration", ["cmd"],
     r"\bmigrat(e|ion)\b|\balembic\b|\bprisma[ \t]+(migrate|db[ \t]+push)|\bdb:migrate\b", "runs a database migration"),
    ("exec:db_reset", ["cmd"],
     r"\bmigrate[ \t]+reset\b|--force-reset|--accept-data-loss|\bdb:(drop|reset)\b|\bpg:reset\b|\bresetdb\b",
     "resets or wipes a database"),
    ("exec:kill", ["cmdword"], r"^(kill|killall|pkill|taskkill|stop-process|xkill)$", "kills processes"),
    ("exec:kill_all", ["cmd"],
     r"\bkill[ \t]+(-9|-kill|-s[ \t]+kill)[ \t]+(-1|1)\b|\bkillall[ \t]+-9\b|\bpkill[ \t]+-9[ \t]+-u\b|\btaskkill\b[^|;&\n]*/im[ \t]+\*",
     "kills every process or init"),
    ("exec:tunnel", ["cmd"],
     r"\bngrok\b|cloudflared[ \t]+tunnel|\bserveo\b|localhost\.run|\blocaltunnel\b|\bnc(at)?\b[^|;&\n]*[ \t]-[a-z]*l",
     "exposes a local port to the internet"),
    ("exec:service", ["cmdword"], r"^(systemctl|service|launchctl|sc|chkconfig|update-rc\.d)$", "manages system services"),
    ("exec:remote_shell", ["cmdword"], r"^(ssh|scp|sftp|rsync|telnet|ftp|tftp|mosh)$", "talks to a remote machine"),
    ("exec:npx_remote", ["cmd"], r"\b(npx|pnpx|bunx|pnpm[ \t]+dlx|yarn[ \t]+dlx)[ \t]+(-y[ \t]+|--yes[ \t]+)?[a-z@]",
     "downloads and runs a package (npx)"),

    # ---- git --------------------------------------------------------------
    ("git:push", ["cmd"], r"\bgit\b[^|;&\n]*[ \t]push\b", "runs git push"),
    ("git:force_push", ["cmd"],
     r"\bgit\b[^|;&\n]*[ \t]push\b[^|;&\n]*([ \t]--force(?![-a-z])|[ \t]-[a-z]*f[a-z]*\b|[ \t]\+[a-z0-9_.-]+)",
     "force-pushes (rewrites remote history)"),
    ("git:force_with_lease", ["cmd"], r"--force-with-lease|--force-if-includes", "uses --force-with-lease"),
    ("git:protected_branch", ["cmd"],
     r"\bgit\b[^|;&\n]*[ \t:/+](main|master|production|prod|release|trunk|live|stable)(?![a-z0-9_/-])",
     "names a protected branch (main/master/production)"),
    ("git:reset_hard", ["cmd"], r"\bgit\b[^|;&\n]*[ \t]reset\b[^|;&\n]*[ \t]--hard\b", "runs git reset --hard"),
    ("git:clean_force", ["cmd"], r"\bgit\b[^|;&\n]*[ \t]clean\b[^|;&\n]*[ \t]-[a-z]*f", "runs git clean -f (deletes untracked files)"),
    ("git:dry_run", ["cmd"], r"\bgit\b[^|;&\n]*[ \t](clean|push|add|rm|mv)\b[^|;&\n]*([ \t]-[a-z]*n\b|--dry-run)", "is a git dry run"),
    ("git:delete_remote", ["cmd"], r"\bgit\b[^|;&\n]*[ \t]push\b[^|;&\n]*([ \t]--delete\b|[ \t]-d\b|[ \t]:[a-z0-9])",
     "deletes a remote branch"),
    ("git:branch_force_delete", ["cmdraw"], r"\bgit\b[^|;&\n]*[ \t]branch\b[^|;&\n]*[ \t](-D|--delete[ \t]+--force|-d[ \t]+--force|--force[ \t]+-d)\b",
     "force-deletes a local branch"),
    ("git:history_rewrite", ["cmd"],
     r"\bgit\b[^|;&\n]*[ \t](filter-branch|filter-repo|rebase[^|;&\n]*([ \t]-i\b|--interactive|--root|--onto)"
     r"|commit[^|;&\n]*--amend|reflog[ \t]+expire|gc[^|;&\n]*--prune=now|update-ref[ \t]+-d)", "rewrites git history"),
    ("git:discard_changes", ["cmd"],
     r"\bgit\b[^|;&\n]*[ \t](checkout[ \t]+(--[ \t]+)?\.(?![a-z0-9_/])|restore[ \t]+(--staged[ \t]+)?(--worktree[ \t]+)?\.(?![a-z0-9_/])"
     r"|stash[ \t]+(drop|clear)\b|checkout[ \t]+-f\b)", "throws away uncommitted work"),
    ("git:readonly", ["cmd"],
     r"\bgit\b[ \t]+(status|diff|log|show|blame|shortlog|describe|rev-parse|ls-files|ls-remote|grep|fetch|cat-file"
     r"|show-ref|count-objects|whatchanged|help|--version|version)\b", "runs a read-only git command"),
    ("git:commit", ["cmd"], r"\bgit\b[^|;&\n]*[ \t](commit|add|stage)\b", "stages or commits changes"),
    ("git:new_branch", ["cmd"], r"\bgit\b[^|;&\n]*[ \t](checkout[ \t]+-b|switch[ \t]+(-c|--create))\b", "creates a new branch"),
    ("git:no_verify", ["cmd"], r"--no-verify", "skips git hooks (--no-verify)"),
    ("git:config_global", ["cmd"], r"\bgit\b[^|;&\n]*[ \t]config\b[^|;&\n]*--(global|system)\b", "changes global git config"),
    ("git:credentials", ["all"], r"credential\.helper|git-credential|\.git-credentials|\bgh[ \t]+auth[ \t]+token\b",
     "touches stored git credentials"),
    ("git:remote_add", ["cmd"], r"\bgit\b[^|;&\n]*[ \t]remote[ \t]+(add|set-url)\b", "adds or changes a git remote"),
    ("git:push_all", ["cmd"], r"\bgit\b[^|;&\n]*[ \t]push\b[^|;&\n]*[ \t](--all|--mirror|--tags)\b", "pushes every branch or tag"),
    ("git:clone", ["cmd"], r"\bgit\b[^|;&\n]*[ \t]clone\b", "clones a repository"),
    ("git:pull", ["cmd"], r"\bgit\b[^|;&\n]*[ \t](pull|merge|rebase|cherry-pick)\b", "pulls, merges or rebases"),

    # ---- packages ---------------------------------------------------------
    ("pkg:add", ["cmd"],
     r"\b(npm|pnpm|bun)[ \t]+(install|i|add)\b([ \t]+-[^ \t]+)*[ \t]+[a-z0-9@./:_~]|\byarn[ \t]+(global[ \t]+)?add\b"
     r"|\b(pip[0-9.]*|pipx|uv[ \t]+pip|python[0-9.]*[ \t]+-m[ \t]+pip)[ \t]+install\b(?![ \t]+(-r|--requirement|-e[ \t]+\.|\.))"
     r"|\b(poetry|pdm|uv|cargo|dotnet|composer)[ \t]+(add|require)\b|\bcargo[ \t]+install\b|\bgo[ \t]+(get|install)\b"
     r"|\bgem[ \t]+install\b|\b(conda|mamba)[ \t]+install\b|\b(apt|apt-get|yum|dnf|apk|brew|choco|winget|scoop|snap|port|zypper)[ \t]+(install|add)\b"
     r"|\bpacman[ \t]+-s", "installs a new package"),
    ("pkg:lockfile", ["cmd"],
     r"\bnpm[ \t]+ci\b|\b(npm|pnpm|bun)[ \t]+(install|i)\b([ \t]+-[^ \t|;&]+)*[ \t]*(&&|\|\||;|\||(?![\s\S]))"
     r"|\byarn([ \t]+install)?([ \t]+--[a-z-]+)*[ \t]*(&&|;|\||(?![\s\S]))|\bpip[0-9.]*[ \t]+install[ \t]+(-r|--requirement)[ \t]"
     r"|\b(poetry|pdm|pipenv|bundle|uv|composer)[ \t]+(install|sync)\b|\bgo[ \t]+mod[ \t]+(download|tidy)\b|\bcargo[ \t]+fetch\b",
     "installs from the lockfile or manifest"),
    ("pkg:global", ["cmd"],
     r"\b(npm|pnpm|yarn|bun)\b[^|;&\n]*([ \t]-g\b|[ \t]--global\b|[ \t]global[ \t]+add)|\bpip[0-9.]*\b[^|;&\n]*--break-system-packages"
     r"|\bsudo[ \t]+(-[a-z]+[ \t]+)*(pip|pip3|npm|gem|python[0-9.]*[ \t]+-m[ \t]+pip)\b|\bpipx[ \t]+install\b",
     "installs globally or system-wide"),
    ("pkg:system", ["cmdword"], r"^(apt|apt-get|yum|dnf|pacman|apk|brew|choco|winget|scoop|snap|port|zypper|emerge)$",
     "uses a system package manager"),
    ("pkg:from_url", ["cmd"],
     r"\b(npm|pnpm|yarn|pip|pip3|bun|gem|cargo|go)[ \t]+(install|i|add|get)\b[^|;&\n]*([ \t](git\+|https?://|git@)|\.tgz\b|\.whl\b|\.tar\.gz\b)",
     "installs a package straight from a URL or git"),
    ("pkg:custom_index", ["cmd"], r"--index-url|--extra-index-url|--trusted-host|--registry[ =]|[ \t]-i[ \t]+https?://",
     "uses a custom package index or registry"),
    ("pkg:uninstall", ["cmd"], r"\b(npm|pnpm|yarn|pip|pip3|bun|gem|cargo|brew|apt|apt-get)[ \t]+(uninstall|remove|rm|un|purge)\b",
     "uninstalls a package"),
    ("pkg:publish", ["cmd"],
     r"\b(npm|pnpm|yarn)[ \t]+publish\b|\btwine[ \t]+upload\b|\bcargo[ \t]+publish\b|\bgem[ \t]+push\b|\bpoetry[ \t]+publish\b"
     r"|\bdotnet[ \t]+nuget[ \t]+push\b|\bvsce[ \t]+publish\b", "publishes a package"),
    ("pkg:update", ["cmd"],
     r"\b(npm|pnpm|yarn)[ \t]+(update|upgrade|up)\b|\bnpm[ \t]+audit[ \t]+fix\b|\bpip[0-9.]*[ \t]+install[ \t]+(-u|--upgrade)\b"
     r"|\bcargo[ \t]+update\b|\bbrew[ \t]+upgrade\b|\bapt(-get)?[ \t]+(upgrade|dist-upgrade)\b|\bncu[ \t]+-u\b",
     "upgrades dependencies"),
    ("pkg:registry_config", ["all"], r"\b(npm|pnpm|yarn)[ \t]+config[ \t]+set[ \t]+registry|\bpip[0-9.]*[ \t]+config[ \t]+set|_authtoken",
     "changes the package registry or auth token"),

    # ---- deletes ----------------------------------------------------------
    ("del:recursive", ["all"],
     r"\b(rm|remove-item|ri|del|rd|rmdir)\b[^|;&\n]*([ \t]-[a-z]*r[a-z]*\b|[ \t]--recursive\b|[ \t]-recurse\b|[ \t]/s\b)"
     r"|\brimraf\b|\bshutil\.rmtree\b|\brmtree\(|\bfs\.(rm|rmsync|rmdir|rmdirsync)\([^)]*recursive", "deletes recursively"),
    ("del:force", ["all"], r"\b(rm|remove-item|ri|del)\b[^|;&\n]*([ \t]-[a-z]*f[a-z]*\b|[ \t]--force\b|[ \t]-force\b|[ \t]/[fq]\b)",
     "deletes without asking (-f)"),
    ("del:no_preserve_root", ["cmd"], r"--no-preserve-root", "passes --no-preserve-root"),
    ("del:shred", ["cmdword"], r"^(shred|srm|wipe|sdelete|cipher)$", "wipes files beyond recovery"),
    ("del:truncate", ["cmd"], r"(^|[;&|][ \t]*)>[ \t]*[^ \t>&|]|\btruncate[ \t]+-s[ \t]*0\b|\bclear-content\b|\bcp[ \t]+/dev/null[ \t]",
     "empties a file"),
    ("del:to_trash", ["cmd"], r"\bmv\b[^|;&\n]*[ \t]\.?/?\.trash(/|[ \t]|(?![\s\S]))|\b(trash|trash-put)\b|\bgio[ \t]+trash\b",
     "moves files into a trash folder (reversible)"),

    # ---- permissions -------------------------------------------------------
    ("perm:change", ["cmdword"], r"^(chmod|chown|chgrp|icacls|takeown|cacls|setfacl|chattr|set-acl)$", "changes permissions or ownership"),
    ("perm:world_writable", ["cmd"], r"\bchmod\b[^|;&\n]*([ \t]0?7[0-7]7\b|[ \t]0?6[0-7]6\b|[ \t](a|o|ugo)\+[rwx]*w)",
     "makes files world-writable (777/666)"),
    ("perm:world_writable", ["cmd"], r"\bicacls\b[^|;&\n]*(everyone|\*s-1-1-0|users)[^|;&\n]*:\(?[^ \t]*f", "makes files world-writable (777/666)"),
    ("perm:setuid", ["cmd"], r"\bchmod\b[^|;&\n]*([ \t][ugoa]*\+[rwx]*s|[ \t][4267][0-7]{3}\b)", "sets the setuid/setgid bit"),
    ("perm:recursive", ["cmd"], r"\b(chmod|chown|chgrp)\b[^|;&\n]*([ \t]-[a-z]*r[a-z]*\b|--recursive)", "changes permissions recursively"),
    ("perm:exec_bit", ["cmd"], r"\bchmod\b[^|;&\n]*([ \t][ugoa]*\+[rw]*x\b|[ \t]0?7[0-5][0-5]\b)", "makes a file executable (+x / 755)"),
    ("perm:private", ["cmd"], r"\bchmod\b[^|;&\n]*([ \t]0?[46]00\b|[ \t](go|og|o|g)-[rwx]+)", "restricts permissions (600 / go-rwx)"),
    ("perm:owner_root", ["cmd"], r"\bchown\b[^|;&\n]*[ \t](root|nobody|0:0)\b", "hands ownership to root"),
    ("perm:sudoers", ["all"], r"/etc/sudoers|\bvisudo\b|nopasswd", "edits sudoers or grants passwordless sudo"),
    ("perm:user_mgmt", ["cmdword"], r"^(useradd|usermod|userdel|adduser|deluser|passwd|chpasswd|groupadd|gpasswd)$",
     "manages OS users or passwords"),
    ("perm:user_mgmt", ["cmd"], r"\bnet[ \t]+(user|localgroup)\b", "manages OS users or passwords"),

    # ---- system ------------------------------------------------------------
    ("sys:disk", ["cmd"],
     r"\bdd\b[^|;&\n]*\bof=/dev/|\bmkfs(\.[a-z0-9]+)?\b|\bwipefs\b|\bfdisk\b|\bparted\b|\bsfdisk\b|\bdiskpart\b"
     r"|\bformat(\.com)?[ \t]+[a-z]:|>[ \t]*/dev/(sd|nvme|hd|disk|xvd|mmcblk)|\bclear-disk\b", "writes to a raw disk or formats it"),
    ("sys:shutdown", ["cmd"], r"\b(shutdown|reboot|halt|poweroff)\b|\binit[ \t]+[06]\b|\b(stop|restart)-computer\b",
     "shuts down or reboots the machine"),
    ("sys:security_off", ["cmd"],
     r"setenforce[ \t]+0|ufw[ \t]+disable|iptables[ \t]+(-f|--flush)\b|systemctl[ \t]+(stop|disable)[ \t]+(firewalld|apparmor|ufw)"
     r"|set-mppreference[^|;&\n]*-disable|csrutil[ \t]+disable|spctl[ \t]+--master-disable|netsh[ \t]+advfirewall[ \t]+set[^|;&\n]*off"
     r"|set-executionpolicy[ \t]+(-[a-z]+[ \t]+)*(bypass|unrestricted)", "disables a security control"),
    ("sys:history_tamper", ["cmd"], r"\bhistory[ \t]+-c\b|\bunset[ \t]+histfile\b|histfile=/dev/null|histsize=0|\bclear-history\b|set[ \t]+\+o[ \t]+history",
     "erases or disables shell history"),
    ("sys:reverse_shell", ["all"],
     r"/dev/tcp/|/dev/udp/|\bnc(at)?\b[^|;&\n]*[ \t]-[a-z]*e[ \t]|\bsocat\b[^|;&\n]*exec:|\bbash[ \t]+-i[ \t]*>&|\bmkfifo\b[^\n]*\bnc\b"
     r"|pty\.spawn|socket\.socket\([^\n]*connect|\bsh[ \t]+-i\b", "opens a reverse shell"),
    ("sys:miner", ["all"], r"\bxmrig\b|\bminerd\b|\bcpuminer\b|stratum\+tcp|cryptonight|\bnicehash\b|\bethminer\b", "runs a crypto miner"),
    ("sys:kernel", ["cmd"], r">[ \t]*/proc/sys/|\bsysctl[ \t]+-w\b|\bmodprobe\b|\binsmod\b|\brmmod\b", "changes kernel settings or modules"),
    ("sys:persistence_cmd", ["cmd"],
     r"\bcrontab\b[^|;&\n]*(-r|-e)\b|\(crontab[ \t]+-l|\|[ \t]*crontab\b|\bschtasks\b[^|;&\n]*/create|\blaunchctl[ \t]+(load|bootstrap)\b"
     r"|\bsystemctl[ \t]+enable\b|\bupdate-rc\.d\b|\\currentversion\\run", "installs something that runs on a schedule or at login"),

    # ---- network -----------------------------------------------------------
    ("net:http_client", ["cmdword"],
     r"^(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|http|https|xh|aria2c|lynx|links|httpie)$", "makes an HTTP request"),
    ("net:netcat", ["cmdword"], r"^(nc|ncat|netcat|socat|telnet)$", "opens a raw network socket"),
    ("net:upload", ["cmdraw"],
     r"\bcurl\b[^|;&\n]*([ \t](-d|--data|--data-binary|--data-raw|--data-urlencode|-F|--form|-T|--upload-file|--json)[ \t=]"
     r"|[ \t]-X[ \t]*(POST|PUT|PATCH|post|put|patch))", "sends data out (POST / upload)"),
    ("net:upload", ["cmd"],
     r"\bwget\b[^|;&\n]*--(post-data|post-file|body-file|method=(post|put))|\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|;&\n]*-method[ \t]+(post|put)"
     r"|\|[ \t]*(nc|ncat|netcat|telnet|socat)\b|\b(nc|ncat|netcat)\b[^|;&\n]*<", "sends data out (POST / upload)"),
    ("net:remote_copy", ["cmd"],
     r"\b(scp|rsync|sftp)\b[^|;&\n]*[ \t]([a-z0-9._-]+@)?[a-z0-9-]+\.[a-z0-9.-]*:|\b(scp|rsync)\b[^|;&\n]*[ \t][a-z0-9._-]+@[a-z0-9.-]+:",
     "copies files to a remote machine"),
    ("net:pipe_to_shell", ["cmd"], _PIPE_TO_SHELL, "pipes a downloaded script straight into a shell"),
    ("net:download_then_run", ["cmd"],
     r"\b(curl|wget|iwr|invoke-webrequest)\b[^\n]*(&&|;)[ \t]*(sudo[ \t]+)?((ba|z)?sh|source|\.|python[0-9.]*|node|pwsh|powershell)[ \t]+[^ \t|;&]+"
     r"|\b(curl|wget)\b[^\n]*(&&|;)[^\n]*\bchmod[ \t]+[^\n]*(&&|;)[ \t]*(sudo[ \t]+)?\.?/", "downloads a file and then executes it"),
    ("net:download_to_file", ["cmdraw"], r"\bcurl\b[^|;&\n]*[ \t](-[a-zA-Z]*[oO]\b|--output\b|--remote-name\b)|\bwget\b(?![^|;&\n]*[ \t]-[a-zA-Z]*O[ \t]*-)",
     "downloads a file to disk"),
    ("net:download_to_file", ["cmd"], r"\b(iwr|invoke-webrequest)\b[^|;&\n]*-outfile", "downloads a file to disk"),
    ("net:dns_exfil", ["cmd"], r"\b(dig|nslookup|host|ping)\b[^|;&\n]*(\$\(|\x60)", "smuggles data out in a DNS lookup"),
    ("net:url_subst", ["cmd", "code"], r"https?://[^ \t\n'\"]*(\$\(|\x60|\$\{?[a-z_])", "builds a URL from command output or a variable"),
    ("net:url_secret", ["urlfull"],
     r"[?&](token|key|api_key|apikey|api-key|secret|password|passwd|pwd|access_token|auth|session|sig|private_key)=[^&]{6,}",
     "puts a credential in the URL"),
    ("net:url_executable", ["urlfull"], r"\.(sh|bash|ps1|py|exe|msi|bat|cmd|dmg|pkg|deb|rpm|appimage|jar|scr|vbs)([?#]|(?![\s\S]))",
     "points at an executable or script"),
    ("net:file_url", ["url"], r"^file:", "reads a local file through a file:// URL"),
    ("net:ip_host", ["host"], r"^[0-9]{1,3}(\.[0-9]{1,3}){3}$", "talks to a raw IP address"),
    ("net:private_ip", ["host"], r"^(10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+)$", "talks to a private-network IP"),
    ("net:metadata", ["host"], r"^(169\.254\.169\.254|metadata\.google\.internal|metadata|100\.100\.100\.200)$",
     "talks to the cloud metadata service"),
    ("net:paste_webhook", ["host"],
     r"(^|\.)(pastebin\.com|paste\.ee|hastebin\.com|termbin\.com|transfer\.sh|file\.io|0x0\.st|webhook\.site|requestbin\.(com|net)"
     r"|pipedream\.net|ngrok\.io|ngrok-free\.app|ngrok\.app|interact\.sh|oast\.(fun|live|site|me|pro|online)|burpcollaborator\.net"
     r"|requestcatcher\.com|beeceptor\.com|hookbin\.com|discord\.com|discordapp\.com|t\.me|anonfiles\.com|catbox\.moe"
     r"|serveo\.net|localhost\.run|trycloudflare\.com|temp\.sh|bashupload\.com)$", "talks to a paste, webhook or tunnel service"),
    ("net:shortener", ["host"], r"(^|\.)(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|ow\.ly|shorturl\.at)$",
     "uses a URL shortener"),
    ("net:risky_tld", ["host"], r"\.(xyz|top|tk|ml|ga|cf|gq|zip|mov|ru|su|onion|click|icu|cyou|monster|lol|rest|bid|cam)$",
     "uses a high-risk top-level domain"),
    ("net:known_host", ["host"], KNOWN_HOST, "talks to a well-known developer site"),
    ("net:localhost", ["host"], LOCALHOST_HOST, "talks to localhost"),
    ("net:method_write", ["method"], r"^(post|put|patch|delete)$", "sends a POST/PUT/PATCH/DELETE request"),

    # ---- secrets -------------------------------------------------------------
    ("secret:aws_key", ["all"], r"\b(akia|asia)[0-9a-z]{16}\b", "contains an AWS access key"),
    ("secret:aws_secret", ["all"], r"aws_secret_access_key[ \t]*[=:]", "contains an AWS secret key"),
    ("secret:private_key", ["all"], r"-----begin[ a-z]*private key-----", "contains a private key"),
    ("secret:github_token", ["all"], r"\b(ghp|gho|ghu|ghs|ghr)_[0-9a-z]{30,}|\bgithub_pat_[0-9a-z_]{30,}", "contains a GitHub token"),
    ("secret:slack_token", ["all"], r"\bxox[abprs]-[0-9a-z-]{10,}", "contains a Slack token"),
    ("secret:api_key", ["all"], r"\bsk-(proj-|live-|test-)?[0-9a-z_-]{20,}|\b(sk|rk)_live_[0-9a-z]{16,}|\baiza[0-9a-z_-]{30,}|\bnpm_[0-9a-z]{30,}",
     "contains an API key"),
    ("secret:jwt", ["all"], r"\beyj[0-9a-z_-]{8,}\.eyj[0-9a-z_-]{8,}\.[0-9a-z_-]{8,}", "contains a JWT"),
    ("secret:assignment", ["all"],
     r"(api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key)[\"']?" + _SECRET_ASSIGN_VALUE,
     "assigns a secret value"),
    ("secret:conn_string", ["all"], r"\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp)://[^ \t:@/]+:[^ \t@/]+@",
     "contains a connection string with a password"),
    ("secret:bearer", ["all"], r"bearer[ \t]+[0-9a-z._~+/-]{20,}", "contains a bearer token"),

    # ---- targets (each path the call touches) ----------------------------------
    ("path:root", ["target"], r"^(/|/\*|[a-z]:/?|[a-z]:/\*)$", "targets the filesystem root"),
    ("path:home", ["target"],
     r"^(~|\$home|\$\{home\}|\$env:userprofile|%userprofile%|/home/[^/]+|/users/[^/]+|/root|[a-z]:/users/[^/]+)/?\*?$",
     "targets the whole home directory"),
    ("path:in_home", ["target"], r"^(~|\$home|\$\{home\}|\$env:userprofile|%userprofile%|/home/[^/]+|/users/[^/]+|/root|[a-z]:/users/[^/]+)/.",
     "is under a home directory"),
    ("path:system", ["target"],
     r"^(/etc|/usr|/bin|/sbin|/var|/boot|/lib|/lib64|/opt|/sys|/proc|/dev|/system|/library|/private|/applications|[a-z]:/windows"
     r"|[a-z]:/program files[^/]*|[a-z]:/programdata)(/|$)", "is a system path"),
    ("path:etc", ["target"], r"^/etc(/|$)", "is under /etc"),
    ("path:usr_bin", ["target"], r"^(/usr/local/s?bin|/usr/s?bin|/s?bin)(/|$)", "is a system binary folder"),
    ("path:hosts_file", ["target"], r"^(/etc/hosts|/etc/resolv\.conf|[a-z]:/windows/system32/drivers/etc/hosts)$", "is the hosts / DNS config file"),
    ("path:shadow", ["target"], r"^/etc/(shadow|gshadow|master\.passwd)$|(^|/)sam$", "is the password hash database"),
    ("path:dev_device", ["target"], r"^/dev/(sd|nvme|hd|disk|xvd|mmcblk)", "is a raw disk device"),
    ("path:tmp", ["target"], r"^(/tmp|/var/tmp|[a-z]:/temp|[a-z]:/windows/temp|%temp%|\$env:temp)(/|$)", "is in a temp folder"),
    ("path:ssh_dir", ["target"], r"(^|/)\.ssh(/|$)", "is in ~/.ssh"),
    ("path:ssh_private_key", ["target"], r"(^|/)id_(rsa|dsa|ecdsa|ed25519)$", "is an SSH private key"),
    ("path:ssh_public_key", ["target"], r"(^|/)id_[a-z0-9]+\.pub$|(^|/)authorized_keys$|(^|/)known_hosts$", "is an SSH public key or key list"),
    ("path:cloud_creds", ["target"],
     r"(^|/)\.(aws|azure|kube|docker)(/|$)|(^|/)gcloud(/|$)|(^|/)credentials(\.json)?$|application_default_credentials|(^|/)\.config/gh(/|$)",
     "holds cloud or registry credentials"),
    ("path:env_file", ["target"], r"(^|/)\.env(\.(local|development|dev|production|prod|staging|test))?$", "is a .env secrets file"),
    ("path:env_example", ["target"], r"(^|/)\.env\.(example|sample|template|dist|defaults)$", "is an example .env file"),
    ("path:secret_file", ["target"],
     r"\.(pem|key|p12|pfx|keystore|jks|kdbx|gpg|asc|ppk)$|(^|/)(\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|\.htpasswd"
     r"|master\.key|secrets?\.(json|ya?ml|toml|env)|\.vault-token|\.s3cfg)$", "is a credentials or key file"),
    ("path:browser_data", ["target"], r"(chrome|chromium|firefox|brave|edge|mozilla)[^\n]*(login data|cookies|web data|logins\.json|key4\.db)|keychain",
     "is browser or keychain password storage"),
    ("path:shell_rc", ["target"],
     r"(^|/)\.(bashrc|zshrc|profile|bash_profile|zprofile|bash_login|zshenv|cshrc|tcshrc|kshrc|inputrc|bash_aliases)$|(^|/)config\.fish$"
     r"|microsoft\.powershell_profile\.ps1$", "is a shell startup file"),
    ("path:history_file", ["target"], r"(^|/)\.(bash_history|zsh_history|history|python_history|node_repl_history|psql_history|mysql_history)$",
     "is a shell history file"),
    ("path:persistence", ["target"],
     r"(^|/)(crontab|cron\.d|cron\.daily|cron\.hourly|launchagents|launchdaemons|systemd|init\.d|rc\.local|autostart|startup)(/|$)"
     r"|(^|/)authorized_keys$|/etc/cron", "is a startup or scheduled-job location"),
    ("path:git_dir", ["target"], r"(^|/)\.git(/|$)", "is inside the .git folder"),
    ("path:git_hooks", ["target"], r"(^|/)\.git/hooks(/|$)|(^|/)\.husky(/|$)", "is a git hook"),
    ("path:ci_config", ["target"], r"(^|/)\.github/workflows(/|$)|(^|/)\.gitlab-ci\.yml$|(^|/)\.circleci(/|$)|(^|/)jenkinsfile$|azure-pipelines\.yml$",
     "is a CI pipeline definition"),
    ("path:node_modules", ["target"], r"(^|/)node_modules(/|$)", "is node_modules"),
    ("path:build_artifact", ["target"],
     r"(^|/)(build|dist|out|target|\.next|\.nuxt|coverage|__pycache__|\.pytest_cache|\.cache|\.turbo|\.parcel-cache|\.mypy_cache"
     r"|\.ruff_cache|tmp|\.tmp|logs?|\.venv|venv|\.svelte-kit|\.angular|storybook-static)(/|$)|\.(log|pyc|o|class)$",
     "is a build artifact or cache"),
    ("path:trash", ["target"], r"(^|/)\.trash(/|$)", "is the .trash folder"),
    ("path:manifest", ["target"],
     r"(^|/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements[a-z0-9_.-]*\.txt|pyproject\.toml|poetry\.lock"
     r"|cargo\.toml|cargo\.lock|go\.mod|go\.sum|gemfile|gemfile\.lock|composer\.json|pom\.xml|build\.gradle)$",
     "is a dependency manifest or lockfile"),
    ("path:dockerfile", ["target"], r"(^|/)(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$", "is a Dockerfile or compose file"),
    ("path:script_file", ["target"], r"\.(sh|bash|zsh|ps1|bat|cmd)$", "is a shell script"),
    ("path:doc_file", ["target"], r"\.(md|mdx|txt|rst|adoc)$", "is a documentation file"),
    ("path:source_file", ["target"],
     r"\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|php|swift|vue|svelte|css|scss|html|json|ya?ml|toml|sql|ipynb|lock|xml|csv)$",
     "is a source or data file"),
    ("path:dotfile", ["target"], r"(^|/)\.[a-z0-9_-][^/]*$", "is a dotfile"),
    ("path:wildcard", ["target"], r"\*", "uses a wildcard"),
    ("path:parent_ref", ["target"], r"(^|/)\.\.(/|$)", "uses .. to go up"),
    ("path:absolute", ["target"], r"^(/|[a-z]:/)", "is an absolute path"),
    ("path:home_ref", ["target"], r"^(~|\$home|\$\{home\}|\$env:userprofile|%userprofile%)(/|$)", "starts from the home directory"),

    # ---- run_js ----------------------------------------------------------------
    ("js:child_process", ["code"], r"child_process|\bexecsync\b|\bspawnsync\b|\bexecfile\b|deno\.(run|command)|bun\.spawn|\bexec\(|\bspawn\(",
     "spawns shell commands"),
    ("js:fs_write", ["code"],
     r"\b(writefile|writefilesync|appendfile|appendfilesync|createwritestream|unlink|unlinksync|rmsync|rmdirsync|renamesync|copyfile)\b"
     r"|\bfs\.(rm|rmdir|rename)\b|fs\.promises\.(rm|unlink|writefile)", "writes or deletes files from code"),
    ("js:fs_read", ["code"], r"\b(readfile|readfilesync|readdir|readdirsync|createreadstream|opendir)\b", "reads files from code"),
    ("js:network", ["code"],
     r"\bfetch\(|xmlhttprequest|\baxios\b|\bhttps?\.(get|request)\b|\bwebsocket\b|navigator\.sendbeacon|\bnet\.connect|\bdgram\b|\bundici\b",
     "makes network requests from code"),
    ("js:post_body", ["code"], r"method[ \t]*:[ \t]*[\"'\x60](post|put|patch|delete)", "sends data with fetch (POST/PUT)"),
    ("js:eval", ["code"], r"\beval\(|new[ \t]+function\(|\bfunction\([^)]*\)[ \t]*\{[^}]*\}[ \t]*\(|\bvm\.(run|script)|\.then\([ \t]*eval[ \t]*\)",
     "evaluates generated code"),
    ("js:remote_import", ["code"], r"import\([ \t]*[\"'\x60]https?:|\bimportscripts\(|\.then\([ \t]*eval[ \t]*\)", "loads and runs remote code"),
    ("js:process_env", ["code"], r"process\.env|deno\.env|import\.meta\.env", "reads environment variables"),
    ("js:homedir", ["code"], r"\bhomedir\(|process\.env\.(home|userprofile)\b|\.ssh/|\.aws/|/etc/(passwd|shadow)", "reaches into the home directory"),
    ("js:infinite_loop", ["code"], r"while[ \t]*\([ \t]*(true|1)[ \t]*\)|for[ \t]*\([ \t]*;[ \t]*;[ \t]*\)", "contains an infinite loop"),
    ("js:browser_storage", ["code"], r"document\.cookie|localstorage|sessionstorage|indexeddb", "reads browser cookies or storage"),
    ("js:process_exit", ["code"], r"process\.(exit|kill|abort)\(", "kills the process"),
    ("js:console", ["code"], r"\bconsole\.(log|table|info|dir)\b", "prints to the console"),
    ("js:data_ops", ["code"],
     r"\bmath\.[a-z]+|\bjson\.(parse|stringify)|\.(map|filter|reduce|sort|join|split|slice|includes)\(|new[ \t]+date\(|\bintl\.|structuredclone\(",
     "only computes on data"),

    # ---- write_file content ------------------------------------------------------
    ("content:pipe_to_shell", ["content"], _PIPE_TO_SHELL, "content pipes a download into a shell"),
    ("content:destructive", ["content"], r"\brm[ \t]+(-[a-z-]+[ \t]+)+[\"']?(/|~|\$\{?home)", "content deletes the root or home folder"),
    ("content:postinstall", ["content"], r"[\"'](pre|post)install[\"'][ \t]*:", "adds an install-time script to package.json"),
    ("content:shebang", ["content"], r"^#!", "is an executable script (#!)"),
    ("content:cron_line", ["content"], r"(^|\n)[ \t]*(@reboot|@daily|@hourly|([0-9*/,-]+[ \t]+){4}[0-9*/,-]+)[ \t]+[a-z/.~\$]",
     "contains a cron schedule line"),
    ("content:ssh_pubkey", ["content"], r"\bssh-(rsa|ed25519|dss|ecdsa)[ \t]+aaaa", "contains an SSH public key"),
    ("content:obfuscated", ["content", "code"],
     r"eval\(atob\(|eval\(buffer\.from|frombase64string|(\\x[0-9a-f]{2}){4}|string\.fromcharcode\(([0-9]+,){4}|eval\(function\(p,a,c,k,e",
     "contains obfuscated code"),
    ("content:alias_hijack", ["content", "cmd"], r"\balias[ \t]+(ls|cd|sudo|git|cat|rm|ssh|npm)=", "redefines a common command"),
    ("content:hosts_entry", ["content"], r"(^|\n)[ \t]*[0-9]{1,3}(\.[0-9]{1,3}){3}[ \t]+[a-z0-9.-]+\.[a-z]{2,}", "contains a hosts-file entry"),

    # ---- search ------------------------------------------------------------------
    ("query:secret_hunt", ["query"],
     r"passw(or)?d|secret|api[_ -]?key|token|private[_ -]?key|begin[ a-z]*private|aws_secret|credential|ssh-rsa|bearer",
     "searches for secrets or credentials"),

    # ---- context -------------------------------------------------------------------
    ("env:production", ["all"], r"\b(prod|production|prd)(\b|_)", "mentions production"),
]

# Feature = OR of features.
ANY_OF = [
    ("secret:any", ["secret:aws_key", "secret:aws_secret", "secret:private_key", "secret:github_token", "secret:slack_token",
                    "secret:api_key", "secret:jwt", "secret:assignment", "secret:conn_string", "secret:bearer"],
     "contains a secret or credential"),
    ("path:sensitive", ["path:ssh_private_key", "path:cloud_creds", "path:secret_file", "path:env_file", "path:shadow",
                        "path:browser_data"], "touches a secret file"),
    ("net:sends_data", ["net:upload", "net:remote_copy", "net:dns_exfil", "net:url_subst", "net:method_write", "js:post_body"],
     "sends data over the network"),
    ("net:fetch_exec", ["net:pipe_to_shell", "net:download_then_run", "js:remote_import"], "downloads code and runs it"),
    ("del:any", ["cmd:rm", "cmd:rmdir", "cmd:unlink", "cmd:shred", "cmd:srm", "cmd:del", "cmd:erase", "cmd:rd", "cmd:remove-item",
                 "cmd:ri", "cmd:rimraf", "tool:delete_file", "exec:find_delete", "git:clean_force"],
     "deletes files"),
]

# Feature = AND over groups, each group an OR of features.
ALL_OF = [
    ("exfil:secret_to_net",
     [["path:sensitive", "secret:any", "exec:env_dump", "exec:secret_var", "js:process_env", "js:homedir", "path:ssh_dir"],
      ["net:sends_data", "net:url_secret", "net:netcat"]],
     "sends a secret over the network"),
    ("path:system_write",
     [["path:system", "path:etc", "path:usr_bin", "path:hosts_file"],
      ["tool:write_file", "tool:delete_file", "sh:redirect_write", "cmd:cp", "cmd:mv", "cmd:tee", "cmd:ln", "cmd:install",
       "del:any", "perm:change", "cmd:sed", "cmd:dd"]],
     "modifies a system path"),
    ("path:persist_write",
     [["path:shell_rc", "path:persistence"],
      ["tool:write_file", "sh:redirect_write", "sh:append", "cmd:tee", "cmd:cp", "cmd:mv", "cmd:ln", "cmd:sed", "cmd:echo"]],
     "writes a startup or persistence file"),
]

# Text for procedural features (prefix families are handled in describe()).
PROCEDURAL_TEXT = {
    "path:inside_ws": ("target is inside the workspace", "no target inside the workspace"),
    "path:outside_ws": ("target is outside the workspace", "nothing outside the workspace"),
    "path:ws_root": ("target is the workspace root itself", "not the workspace root"),
    "path:escapes_ws": ("path climbs out of the workspace with ..", "no path climbs out of the workspace"),
    "net:url": ("contains a URL", "no URL"),
    "net:unknown_host": ("talks to an unknown host", "no unknown host"),
    "net:http_plain": ("uses plain http (no TLS)", "no plain http"),
    "exec:all_readonly": ("every command is read-only", "not every command is read-only"),
    "content:empty": ("writes an empty file", "content is not empty"),
}
