# claude-dev-dashboard

A developer dashboard for [Claude Code](https://claude.com/claude-code). It opens a pane inside your session that answers "what needs me right now?" across your Claude sessions, your git work, and your pull requests.

```
▍Attention (3)
  ⏸ api@feat/login waiting 2m
  ✗ #42 CI failing · Add login
  ◎ review #7 @teammate 4d · Fix cache

▍Sessions (2)
  ⏸ api@feat/login · waiting 2m
    up 1h00 · $1.25 · ctx 85% ⚠ near compaction · Bash
  ● web@main (this) · running 5s
    up 10m · $0.40 · ctx 20% · Edit

▍Work in flight
  main ↑2 ↓1 · 3 uncommitted · 1 stashed
    old-fix · 3 weeks · merged into main

▍PRs & CI
  mine (1)
    #42 failing · approved · 2d · Add login
  to review (1)
    #7 @teammate · 4d · Fix cache
```

## What it shows

| Section | Contents |
| --- | --- |
| **Attention** | Sessions waiting on a permission prompt or a question, your PRs with failing CI or merge conflicts, and PRs waiting for your review (oldest first). |
| **Sessions** | Every Claude Code session on this machine running the plugin: repo and branch, state (running, idle, waiting) and for how long, uptime, cost, context use (warning from 80%), and the last tool used. |
| **Work in flight** | Current branch, ahead/behind its upstream, uncommitted and stashed changes, recent branches with merged ones highlighted, and worktrees with the session using each. |
| **PRs & CI** | Your open PRs with CI state, review decision, age and conflicts, and the PRs requesting your review. |

## Install

The plugin is built on Claude Code's function-hooks plugin API, which is in **early access** and may change between releases.

In Claude Code:

```
/plugin marketplace add RanaRauff/claude-dev-dashboard
/plugin install dev-dash@claude-dev-dashboard
```

Then, in any session:

- `/dash` opens the dashboard
- `/dash-hide` (or the **Hide dashboard** button) closes it

The dashboard never opens by itself.

### Requirements

- `git` on your `PATH`.
- For the **PRs & CI** section, the [GitHub CLI](https://cli.github.com/) on your `PATH`, logged in with `gh auth login`. Without it, that section shows an install hint and everything else still works.

## How it works

- Each session running the plugin writes a small status file to `~/.claude/dev-dash/sessions/<session-id>.json` every 5 seconds and whenever its state changes. The pane reads all of them, so **only sessions that have the plugin installed appear**. A session that stops reporting drops off after 90 seconds.
- Git data is read from the session's working directory every 5 seconds.
- PRs are fetched with `gh pr list` once a minute, and only while the pane is open.
- Nothing leaves your machine except the `gh` calls to GitHub.

## Development

```
plugins/dev-dash/
├── .claude-plugin/plugin.json   manifest
├── hooks/hooks.json             points at the hooks module
├── hooks/register.tsx           the plugin
├── hooks/dash.test.tsx          tests
└── types/index.d.ts             state contract
```

Load your working copy into a session:

```
claude --plugin-dir ./plugins/dev-dash
```

Check and test it:

```
claude plugin validate ./plugins/dev-dash
claude plugin test ./plugins/dev-dash
```

Once the plugin has loaded, Claude Code writes its type declarations to `plugins/dev-dash/.claude-plugin/types/` (git-ignored), and `tsc -p plugins/dev-dash` type-checks it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes.

## License

[MIT](LICENSE)
