# claude-dev-dashboard

A developer dashboard for [Claude Code](https://claude.com/claude-code). It opens a pane inside your session that answers "what needs me right now?" across every Claude session and subagent on your machine, your usage limits, your git work, and your pull requests.

```
╭──────────────────────────────────────────────╮
│ ◆ 2 need you · 4 sess · 1 live · 2 agents    │
│ 5h ▰▰▰▰▰▱▱▱ 62%  7d ▰▰▱▱▱▱▱▱ 23%            │
│ ▁▂▃▅▆▇▆▅ activity · synced 2s ago            │
╰──────────────────────────────────────────────╯
▾ Attention (2) ──────────────────────────────
  ◆ Fix flaky tests · input needed 3m
  ⟳ Login work may be stuck · npm test failed 3× in a row
▾ Sessions (4) ───────────────────────────────
  [WAIT] Fix flaky tests · input needed 3m
         ▰▰▰▰▰▰▰▱ ctx 85% · $1.25 · Bash: npm test   compact soon
▾ Agents (2) ─────────────────────────────────
  ◐ Research dashboard ideas · working 4m
    general-purpose · Claude mods · 23 steps
    ↳ WebSearch: claude code dashboards
▾ Monitor ────────────────────────────────────
  5h  ▰▰▰▰▰▱▱▱  62% out in ~40m at this pace · resets in 1h20
  events  🔔 alerts on
    14:02 ◆ Fix flaky tests needs input
    13:58 ✓ agent finished: Research dashboard ideas
▸ Work in flight  main · 3 dirty · +120 −30
▸ PRs & CI  1 mine · 0 to review
```

## What it shows

| Section | Key | Contents |
| --- | --- | --- |
| **Band above the prompt** | | One line under your conversation while the pane is closed: the most urgent thing that needs you, plus limits, context, running sessions and busy agents. `/dash-band off` hides it. |
| **Header** | | Overall status (green all clear, yellow needs you), session and agent counts, total cost, usage-limit bars, and an activity sparkline. |
| **Attention** | 1 | Sessions waiting on you (and what for), sessions that look stuck, risky commands (`rm -rf`, force push, `reset --hard`, …), two sessions editing the same file, a usage limit about to run out, a disk running low, your PRs with failing CI or conflicts, and PRs awaiting your review. |
| **Sessions** | 2 | Every running Claude Code session on this machine, CLI or desktop, plugin or not: its title, repo and branch, state and for how long, and uptime. Sessions that also load the plugin add context use, cost and their latest step. |
| **Agents** | 3 | Every subagent of every running session: description, type, owning session, steps taken, and what it's doing now. Finished and stopped agents stay for 30 minutes. |
| **Monitor** | 4 | Usage limits (5-hour, 7-day) with a forecast of when you'll run out at the current pace, context bars per session with a per-turn sparkline and prompt-cache hit rate, free disk space, and a live event feed. |
| **Work in flight** | 5 | Current branch, ahead/behind, uncommitted lines (+/−), stashes, recent and merged branches, and worktrees. |
| **PRs & CI** | 6 | Your open PRs across all your GitHub repos, with CI, review state, age and conflicts, plus the PRs waiting for your review. |
| **Plan** | 7 | A progress bar per session that keeps a todo list (`TodoWrite`): done of total, and the task in progress. A finished plan stays for 10 minutes. Plugin sessions only. |
| **Sources** | 8 | URLs and searches sessions fetched (`WebFetch`, `WebSearch`), newest first, with the session that made them. Plugin sessions only. |
| **Files** | 9 | Files each session edited this turn, with lines added and removed against `HEAD`. Plugin sessions only. |

Keys work while the pane has focus (**ctrl+x tab**): **1–6** fold a section, **a** toggles alerts, **r** refreshes, **h** hides the pane.

## Alerts

dev-dash shows a short toast, with a soft chime, when something needs you: a session starts waiting, a task that ran over 5 minutes finishes, an agent finishes, CI goes red or back to green, a session looks stuck or runs a risky command, a disk runs low, or this session's context crosses 75%. Everything else only goes to the event feed. Turn alerts off with `/dash-alerts off` (or **a** in the pane); the choice is remembered.

The chime plays where Claude Code has an audio player: macOS terminals and the desktop app. Windows and Linux terminals stay silent. Risky commands are only flagged, never blocked.

## Session summaries (opt-in)

`/dash-summaries on` makes each session that runs dev-dash write a short label after every finished turn, e.g. `↳ Fixing the login redirect bug`, shown under it in the Sessions section. Each label is **one small Haiku call per finished turn** through your own Claude Code session (a few hundred input tokens, at most 40 output), so it uses a little of your usage. It's off by default, and `/dash-summaries off` clears the labels.

What's sent to the model is your last prompt (first 300 characters), the last few tool steps, and the start of Claude's reply (first 500 characters). The label is stored in your session's status file in `~/.claude/dev-dash/sessions/`. Sessions that don't run dev-dash have no label.

## Install

The plugin is built on Claude Code's mods (function hooks) API, which is in **early access** and may change between releases.

```
/plugin marketplace add RanaRauff/claude-dev-dashboard
/plugin install dev-dash@claude-dev-dashboard
```

Then, in any session:

- `/dash` opens the dashboard; it never opens by itself
- `/dash-hide` closes it
- `/dash-alerts on|off` turns toasts and the chime on or off
- `/dash-band on|off` shows or hides the line above the prompt
- `/dash-summaries on|off` adds a one-line "what is it doing" under each session (off by default, see below)
- `/dash-refresh` (or **r** in the pane) refreshes everything now, PRs included

### Requirements

- `git` on your `PATH`.
- For **PRs & CI**, the [GitHub CLI](https://cli.github.com/) logged in with `gh auth login`. Without it, that section shows a hint and the rest still works.
- Usage limits appear on Pro and Max plans, after the session's first reply.

## What dev-dash reads and writes

Mods run with Claude Code's access to your machine, so here is everything this one touches.

**Reads**
- `~/.claude/sessions/*.json`: Claude Code's list of running sessions. The `.key` files beside them are never read.
- `~/.claude/projects/<project>/<session>.jsonl`, only for sessions that have no title, keeping just the AI-generated title or last-prompt lines.
- `~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl` and `.meta.json`: each subagent's description, type, step count and latest step.
- `~/.claude/dev-dash/sessions/*.json`: status files written by other sessions running dev-dash.
- `git` in your working directories, `tasklist` (Windows) or `ps` to see which sessions are still alive, `gh api graphql` for your PRs, and once a minute PowerShell `Get-PSDrive` (Windows) or `df -Pk` for free disk space.

**Writes**
- `~/.claude/dev-dash/sessions/<session-id>.json`, every 5 seconds: this session's state, its one-line summary (only if summaries are on), cost, context use and its per-turn trend, cache hit rate, latest step, a stuck flag, a risky-command flag (the pattern name, not the command), and the files it edited in the last 30 minutes.
- In that same file, for the Plan, Sources and Files sections: the text of the task in progress in its todo list, the URLs it fetched (scheme, host and path only; credentials, query strings and fragments are dropped before anything is stored) and the searches it ran (cut to 80 characters), and the paths of files it edited this turn with their added and removed line counts.
- `~/.claude/dev-dash/handoffs/<time>-<session>.md`, once each time this session's conversation compacts (`/compact` or automatic): a short note with the session's repo, branch and directory, a `claude --resume` line, how far its todo list got, its last step, the files it edited recently, and the summary text the compaction kept (cut to 2000 characters). These files stay on your machine and are never deleted by dev-dash; remove them whenever you like. Compactions inside subagents are not written.
- Its own plugin store (only the alerts, band and summaries on/off choices).

**Network:** the `gh` call to GitHub and, only if you turn summaries on, one small model call per finished turn through your own Claude Code session. Nothing else leaves your machine.

`CLAUDE_CONFIG_DIR` is honoured if you have moved Claude's config directory. The session registry and transcript formats are internal to Claude Code and may change between releases.

## Development

```
plugins/dev-dash/
├── .claude-plugin/plugin.json   manifest
├── hooks/hooks.json             points at the hooks module
├── hooks/register.tsx           data collection, hooks and commands
├── hooks/render.tsx             the pane's drawing
├── hooks/monitor.ts             pure monitoring logic (agents, limits, events, stuck, collisions)
├── hooks/*.test.ts(x)           tests
├── sounds/chime.wav             the alert chime
└── types/index.d.ts             state contract
```

Load your working copy into a session, then check and test it:

```
claude --plugin-dir ./plugins/dev-dash
claude plugin validate ./plugins/dev-dash
claude plugin test ./plugins/dev-dash
```

Once the plugin has loaded, Claude Code writes its type declarations to `plugins/dev-dash/.claude-plugin/types/` (git-ignored), and `tsc -p plugins/dev-dash` type-checks it.

Ideas and research: [docs/dashboard-ideas.md](docs/dashboard-ideas.md), [docs/x-thread-mods.md](docs/x-thread-mods.md) and [what people are building with mods](docs/mods-research.md). See [TODO.md](TODO.md) for what is planned and who has what, and [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes.

## License

[MIT](LICENSE)
