---
name: coding-agent
description: 'Delegate coding tasks to Codex, Claude Code, or Pi agents via background process. Use when: (1) building/creating new features or apps, (2) reviewing PRs (spawn in temp dir), (3) refactoring large codebases, (4) iterative coding that needs file exploration. NOT for: simple one-liner fixes (just edit), reading code (use read tool), thread-bound ACP harness requests in chat (for example spawn/run Codex or Claude Code in a Discord thread; use sessions_spawn with runtime:"acp"), or any work in ~/clawd workspace (never spawn agents here). Claude Code: prefer non-bypass --print (no PTY); for long/quoted prompts prefer stdin-fed --print. Codex/Pi/OpenCode: pty:true required.'
metadata:
  {
    "openclaw": { "emoji": "🧩", "requires": { "anyBins": ["claude", "codex", "opencode", "pi"] } },
  }
---

# Coding Agent (bash-first)

Use **bash** (with optional background mode) for all coding agent work. Simple and effective.

## ⚠️ PTY Mode: Codex/Pi/OpenCode yes, Claude Code no

For **Codex, Pi, and OpenCode**, PTY is still required (interactive terminal apps):

```bash
# ✅ Correct for Codex/Pi/OpenCode
bash pty:true command:"codex exec 'Your prompt'"
```

For **Codex on this host**, also treat an **isolated git root** as mandatory for write tasks.
Do **not** assume sandboxed Codex write modes like `codex exec --full-auto` will work here: current host receipts show `bwrap` / user-namespace failures can break model-issued `apply_patch` and shell-write steps.
When the outer environment is already bounded (OpenClaw exec sandbox, disposable scratch repo, detached worktree), prefer:

```bash
# ✅ Preferred Codex posture on this host for write tasks
bash pty:true workdir:/tmp/safe-repo command:"codex exec --dangerously-bypass-approvals-and-sandbox 'Your task'"
```

Treat `bwrap: No permissions to create a new namespace` as a **sandbox substrate issue**, not an auth/quota problem.

For **Claude Code** (`claude` CLI), the safe posture depends on the host.
On this root-host path, **do not assume** `--permission-mode bypassPermissions` is valid: Claude can map that to the dangerous-permissions path and reject it before useful work starts.
Prefer plain `--print` for one-shot runs here, or another explicit **non-bypass** mode (`default` / `auto` / `plan`) when needed.
Do **not** add `--bare` for ordinary one-shot work on this host: it suppresses the normal claude.ai auth surface here and can produce a misleading `Not logged in` even when `claude auth status` is healthy. Use `--bare` only when you intentionally want API-key/settings-only auth.
For long, quoted, or multiline prompts, prefer feeding stdin to `claude --print` via heredoc/pipe instead of relying on shell-quoted prompt arguments.
If Claude returns `Error: Input must be provided either through stdin or as a prompt argument when using --print`, treat it as an invocation/input-wiring issue; retry once with stdin rather than misclassifying it as auth/quota.
`--dangerously-skip-permissions` with PTY is also wrong on this host.

```bash
# ✅ Preferred for Claude Code on this root-host path (no PTY needed)
cd /path/to/project && claude --print 'Your task'

# ✅ Preferred for long / quoted / multiline prompts
cd /path/to/project && cat <<'EOF' | claude --print --model opus --no-session-persistence --tools ""
Your task
EOF

# Optional non-bypass posture when explicitly needed
cd /path/to/project && claude --permission-mode plan --print 'Your task'

# For background execution: use background:true on the exec tool

# ❌ Wrong for Claude Code on this host
bash pty:true command:"claude --dangerously-skip-permissions 'task'"
cd /path/to/project && claude --permission-mode bypassPermissions --print 'Your task'
```

### Bash Tool Parameters

| Parameter    | Type    | Description                                                                 |
| ------------ | ------- | --------------------------------------------------------------------------- |
| `command`    | string  | The shell command to run                                                    |
| `pty`        | boolean | **Use for coding agents!** Allocates a pseudo-terminal for interactive CLIs |
| `workdir`    | string  | Working directory (agent sees only this folder's context)                   |
| `background` | boolean | Run in background, returns sessionId for monitoring                         |
| `timeout`    | number  | Timeout in seconds (kills process on expiry)                                |
| `elevated`   | boolean | Run on host instead of sandbox (if allowed)                                 |

### Process Tool Actions (for background sessions)

| Action      | Description                                          |
| ----------- | ---------------------------------------------------- |
| `list`      | List all running/recent sessions                     |
| `poll`      | Check if session is still running                    |
| `log`       | Get session output (with optional offset/limit)      |
| `write`     | Send raw data to stdin                               |
| `submit`    | Send data + newline (like typing and pressing Enter) |
| `send-keys` | Send key tokens or hex bytes                         |
| `paste`     | Paste text (with optional bracketed mode)            |
| `kill`      | Terminate the session                                |

---

## Quick Start: One-Shot Tasks

For quick prompts/chats, create a temp git repo and run:

```bash
# Quick chat / scratch write task (Codex needs a git repo!)
SCRATCH=$(mktemp -d) && cd "$SCRATCH" && git init -b main && codex exec --dangerously-bypass-approvals-and-sandbox "Your prompt here"

# Or in a detached/safe project worktree - with PTY!
bash pty:true workdir:/tmp/safe-worktree command:"codex exec --dangerously-bypass-approvals-and-sandbox 'Add error handling to the API calls'"
```

**Why git init?** Codex refuses to run outside a trusted git directory. On this host, a temp repo / detached worktree also gives Codex the narrow safe root it needs.

---

## The Pattern: workdir + background + pty

For longer tasks, use background mode with PTY:

```bash
# Start agent in a bounded target directory (with PTY!)
bash pty:true workdir:/tmp/safe-worktree background:true command:"codex exec --dangerously-bypass-approvals-and-sandbox 'Build a snake game'"
# Returns sessionId for tracking

# Monitor progress
process action:log sessionId:XXX

# Check if done
process action:poll sessionId:XXX

# Send input (if agent asks a question)
process action:write sessionId:XXX data:"y"

# Submit with Enter (like typing "yes" and pressing Enter)
process action:submit sessionId:XXX data:"yes"

# Kill if needed
process action:kill sessionId:XXX
```

**Why workdir matters:** Agent wakes up in a focused directory, doesn't wander off reading unrelated files (like your soul.md 😅).

---

## Codex CLI

**Model:** inspect the live Codex session banner / local config rather than hard-coding an older alias; this host currently reports `gpt-5.4` in the CLI banner.

### Flags

| Flag                                         | Effect                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `exec "prompt"`                              | One-shot execution, exits when done                                                                                 |
| `--full-auto`                                | Convenience alias for sandboxed low-friction execution; **do not assume this works for write tasks on this host**   |
| `--dangerously-bypass-approvals-and-sandbox` | No sandbox / no approvals inside Codex itself; only use when the **outer** execution environment is already bounded |

### Building/Creating

```bash
# Preferred on this host: isolated root + PTY + dangerous bypass
bash pty:true workdir:/tmp/safe-worktree command:"codex exec --dangerously-bypass-approvals-and-sandbox 'Build a dark mode toggle'"

# Background for longer work in an isolated root
bash pty:true workdir:/tmp/safe-worktree background:true command:"codex exec --dangerously-bypass-approvals-and-sandbox 'Refactor the auth module'"
```

### Host-specific failure classification

- `bwrap: No permissions to create a new namespace` = sandbox substrate / userns issue on this host, **not** auth/quota
- `refresh_token_reused` / login prompts / 401 = auth issue
- explicit rate-limit / quota messages = capacity issue; stop and report
- prompt/input wiring problems = invocation issue; retry once with corrected quoting/stdin

### Reviewing PRs

**⚠️ CRITICAL: Never review PRs in OpenClaw's own project folder!**
Clone to temp folder or use git worktree.

```bash
# Clone to temp for safe review
REVIEW_DIR=$(mktemp -d)
git clone https://github.com/user/repo.git $REVIEW_DIR
cd $REVIEW_DIR && gh pr checkout 130
bash pty:true workdir:$REVIEW_DIR command:"codex review --base origin/main"
# Clean up after: trash $REVIEW_DIR

# Or use git worktree (keeps main intact)
git worktree add /tmp/pr-130-review pr-130-branch
bash pty:true workdir:/tmp/pr-130-review command:"codex review --base main"
```

### Batch PR Reviews (parallel army!)

```bash
# Fetch all PR refs first
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'

# Deploy the army - one Codex per PR (all with PTY!)
bash pty:true workdir:~/project background:true command:"codex exec 'Review PR #86. git diff origin/main...origin/pr/86'"
bash pty:true workdir:~/project background:true command:"codex exec 'Review PR #87. git diff origin/main...origin/pr/87'"

# Monitor all
process action:list

# Post results to GitHub
gh pr comment <PR#> --body "<review content>"
```

---

## Claude Code

```bash
# Foreground (short prompt)
bash workdir:~/project command:"claude --print 'Your task'"

# Foreground / Background (long or quote-heavy prompt; preferred for reviews)
bash workdir:~/project command:"cat <<'EOF' | claude --print --model opus --no-session-persistence --tools \"\"\nReview the current diff for release hygiene.\nEOF"
bash workdir:~/project background:true command:"cat <<'EOF' | claude --print --model opus --no-session-persistence --tools \"\"\nReview the current diff for release hygiene.\nEOF"
```

---

## OpenCode

```bash
bash pty:true workdir:~/project command:"opencode run 'Your task'"
```

---

## Pi Coding Agent

```bash
# Install: npm install -g @mariozechner/pi-coding-agent
bash pty:true workdir:~/project command:"pi 'Your task'"

# Non-interactive mode (PTY still recommended)
bash pty:true command:"pi -p 'Summarize src/'"

# Different provider/model
bash pty:true command:"pi --provider openai --model gpt-4o-mini -p 'Your task'"
```

**Note:** Pi now has Anthropic prompt caching enabled (PR #584, merged Jan 2026)!

---

## Parallel Issue Fixing with git worktrees

For fixing multiple issues in parallel, use git worktrees:

```bash
# 1. Create worktrees for each issue
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# 2. Launch Codex in each isolated worktree (background + PTY!)
bash pty:true workdir:/tmp/issue-78 background:true command:"pnpm install && codex exec --dangerously-bypass-approvals-and-sandbox 'Fix issue #78: <description>. Commit and push.'"
bash pty:true workdir:/tmp/issue-99 background:true command:"pnpm install && codex exec --dangerously-bypass-approvals-and-sandbox 'Fix issue #99 from the approved ticket summary. Implement only the in-scope edits and commit after review.'"

# 3. Monitor progress
process action:list
process action:log sessionId:XXX

# 4. Create PRs after fixes
cd /tmp/issue-78 && git push -u origin fix/issue-78
gh pr create --repo user/repo --head fix/issue-78 --title "fix: ..." --body "..."

# 5. Cleanup
git worktree remove /tmp/issue-78
git worktree remove /tmp/issue-99
```

---

## ⚠️ Rules

1. **Use the right execution mode per agent**:
   - Codex/Pi/OpenCode: `pty:true`
   - Claude Code: non-bypass `--print` (no PTY required); use stdin-fed `--print` for long/quoted/multiline prompts
2. **Respect tool choice** - if user asks for Codex, use Codex.
   - Orchestrator mode: do NOT hand-code patches yourself.
   - If an agent fails/hangs, respawn it or ask the user for direction, but don't silently take over.
3. **Be patient** - don't kill sessions because they're "slow"
4. **Monitor with process:log** - check progress without interfering
5. **On this host, prefer isolated-root dangerous-bypass over `--full-auto` for Codex write tasks**
6. **vanilla for reviewing** - no special flags needed
7. **Parallel is OK** - run many Codex processes at once for batch work, but keep each one inside its own narrow git root
8. **NEVER start Codex in ~/.openclaw/** - it'll read your soul docs and get weird ideas about the org chart!
9. **NEVER checkout branches in ~/Projects/openclaw/** - that's the LIVE OpenClaw instance!

---

## Progress Updates (Critical)

When you spawn coding agents in the background, keep the user in the loop.

- Send 1 short message when you start (what's running + where).
- Then only update again when something changes:
  - a milestone completes (build finished, tests passed)
  - the agent asks a question / needs input
  - you hit an error or need user action
  - the agent finishes (include what changed + where)
- If you kill a session, immediately say you killed it and why.

This prevents the user from seeing only "Agent failed before reply" and having no idea what happened.

---

## Auto-Notify on Completion

For long-running background tasks, append a wake trigger to your prompt so OpenClaw gets notified immediately when the agent finishes (instead of waiting for the next heartbeat):

```
... your task here.

When completely finished, run this command to notify me:
openclaw system event --text "Done: [brief summary of what was built]" --mode now
```

**Example:**

```bash
bash pty:true workdir:/tmp/safe-worktree background:true command:"codex exec --dangerously-bypass-approvals-and-sandbox 'Build a REST API for todos.

When completely finished, run: openclaw system event --text \"Done: Built todos REST API with CRUD endpoints\" --mode now'"
```

This triggers an immediate wake event — Skippy gets pinged in seconds, not 10 minutes.

---

## Learnings (Jan 2026)

- **PTY is essential:** Coding agents are interactive terminal apps. Without `pty:true`, output breaks or agent hangs.
- **Git repo required:** Codex won't run outside a trusted git directory. Use `mktemp -d && git init -b main` or a detached worktree for scratch work.
- **On this host, `--full-auto` is not the default write posture:** sandboxed Codex writes can fail with `bwrap: No permissions to create a new namespace`.
- **Best host posture for Codex writes:** isolated scratch repo / detached worktree + `codex exec --dangerously-bypass-approvals-and-sandbox ...` when the outer environment is already bounded.
- **exec is your friend:** `codex exec "prompt"` runs and exits cleanly - perfect for one-shots.
- **submit vs write:** Use `submit` to send input + Enter, `write` for raw data without newline.
- **Sass works:** Codex responds well to playful prompts. Asked it to write a haiku about being second fiddle to a space lobster, got: _"Second chair, I code / Space lobster sets the tempo / Keys glow, I follow"_ 🦞
