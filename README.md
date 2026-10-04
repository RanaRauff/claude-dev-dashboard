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
| **Focus card** | | The Flight Deck look: every section is a card with a rounded border in its colour (you, sessions, agents, limits, PRs). The first thing that needs you grows into a focus card at the top: who, what they are asking, the last tool step, the copy / snooze / dismiss buttons, and the next two in the queue (`1 of N`). When nothing needs you it turns green and says so, with the latest event. Nothing was removed: the Attention list, every section and every key work as before. |
| **Header** | | Overall status (green all clear, yellow needs you), session and agent counts, total cost, usage-limit bars, and **claude beat**: a bold red line graph of how much effort Claude put in at each sync, drawn as one connected line of solid line characters (`─ │ ╭ ╮ ╰ ╯`; five rows high in a wide dock, four when narrow). Effort is a score: 3 for each running session, 2 for each agent at work, 1 for each session waiting on you, and 0.6 for each tool call this session made since the last sync. The line rises and falls with it, scaled to the busiest sync in view, and runs flat along the bottom when nothing is happening. |
| **Attention** | 1 | Sessions waiting on you (and what for), sessions that look stuck, risky commands (`rm -rf`, force push, `reset --hard`, …), two sessions editing the same file, a usage limit about to run out, a disk running low, your PRs with failing CI or conflicts, and PRs awaiting your review. |
| **Sessions** | 2 | Every running Claude Code session on this machine, CLI or desktop, plugin or not: its title, repo and branch, state and for how long, and uptime. Sessions that also load the plugin add context use, cost, their latest step and a test badge (`✓ tests pass · npm test · 2m ago` or `✗ tests failed`) for the last test run they started. |
| **Agents** | 3 | Every subagent of every running session: description, type, owning session, steps taken, and what it's doing now. Finished and stopped agents stay for 30 minutes. |
| **Monitor** | 4 | Usage limits (5-hour, 7-day) with a forecast of when you'll run out at the current pace, context bars per session with a per-turn sparkline and prompt-cache hit rate, free disk space, and a live event feed. |
| **Work in flight** | 5 | Current branch, ahead/behind, uncommitted lines (+/−), stashes, recent and merged branches, and worktrees. |
| **PRs & CI** | 6 | Your open PRs across all your GitHub repos, with CI, review state, age and conflicts, plus the PRs waiting for your review. |
| **Plan** | 7 | A progress bar per session that keeps a todo list (`TodoWrite`): done of total, and the task in progress. A finished plan stays for 10 minutes. Plugin sessions only. |
| **Sources** | 8 | URLs and searches sessions fetched (`WebFetch`, `WebSearch`), newest first, with the session that made them. Plugin sessions only. |
| **Files** | 9 | Files each session edited this turn, with lines added and removed against `HEAD`. Plugin sessions only. |

## Tabs

The pane has three tabs along its top edge. Move onto one with the arrow keys or **Tab** and press **Enter**.

| Tab | Holds |
| --- | --- |
| **Dashboard** | Everything described above: Attention, Sessions, Agents, Monitor, Work in flight, PRs & CI, Plan, Sources and Files. |
| **Entertainment** | Cards for things you keep for fun. Today: **Now playing**, the track the Spotify app on this machine is playing (opt-in, off by default), and a **Stocks** card that says it is not set up (see below). |
| **Custom** | Empty on purpose, kept for widgets you choose yourself. |

On Entertainment and Custom the large header is replaced by one line, so a session waiting for you still shows. The `1`–`9` fold keys belong to the Dashboard tab.

**Now playing** is off until you turn it on, with the **turn on** button on the card or `/dash-spotify on` (`off` or no argument to switch back). Nothing is read while it is off. When on, it uses a local command and no network or login: the Windows media session (the info behind the volume overlay), AppleScript on macOS, `playerctl` on Linux. It shows playing or paused, is read only while the pane is open and the Entertainment tab is showing, every few seconds at most, and the track name is shown but never stored. Only your on/off choice is remembered.

**Stocks** needs prices from the internet, and dev-dash makes no network calls beyond `git` and `gh` (see [CONTRIBUTING.md](CONTRIBUTING.md)), so nothing is fetched. A source has to be approved by the project owner before a watchlist can go there.

## Keyboard

The pane uses the same keys as the rest of Claude Code, with no letter shortcuts to learn.

| Key | Does |
| --- | --- |
| **ctrl+x tab** | Take the keyboard from the prompt to the pane. `/dash` does the same and opens the pane if it is closed. |
| **Esc** | Give the keyboard back to the prompt. |
| **↑ ↓** or **Tab** | Move the highlight to the previous or next row or button. |
| **Enter** | Press the highlighted button. On a row marker (`›`), it opens that row's actions. |
| **1**–**9** | Fold or unfold a section. |

Every row in Attention, Sessions, Agents and PRs starts with a small `›`. Move onto it and press **Enter** and the row's buttons appear under it:

- **copy …**: puts `claude --resume <id>` on the clipboard for a session or agent, the link for a PR, or a one-line summary for the rest.
- **snooze 15m** and **dismiss** (Attention rows only): hide the item in the pane, the band above the prompt and the toasts. Snooze lasts 15 minutes; dismiss lasts until the item changes (a session that waits again, or fails differently, comes back). **bring back** appears under Attention while anything is hidden.

The buttons at the bottom (**refresh**, **alerts**, **help**, **close**) are reached the same way. **help** lists these keys inside the pane.

Snoozes are forgotten when Claude Code restarts. Rows in the Plan, Sources and Files sections have no `›` yet.

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

- `/dash` opens the dashboard with the keyboard on it (or brings the keyboard back to it); it never opens by itself
- `/dash-hide` closes it (or press the **close** button)
- `/dash-alerts on|off` turns toasts and the chime on or off
- `/dash-band on|off` shows or hides the line above the prompt
- `/dash-handoff on|off` writes (or stops writing) a handoff note each time a session compacts (on by default)
- `/dash-beat [line|buddy <name>|list]` chooses what the header draws: `line` (the default) is the red claude beat; a **buddy** is a small pixel-art character that lives in the beat's own slot (5 rows, 4 in a narrow pane) and acts out what your sessions are doing: it sleeps with rising z's when all is quiet, walks, runs or flies across the slot while a session works, and hops and uses its power (fire breath, thunder, a shadow ball, a water gun, leaves) when something needs you. dev-dash draws the scene itself in half blocks (two square pixels per cell, so the slot is about 30 x 10 pixels); in the terminal it is repainted in place about eight times a second, elsewhere it steps with the pane. A buddy is a pack in `~/.claude/dev-dash/buddy/<name>.json` that dev-dash only reads (no program, no network), made with `tools/make-buddy.py` (Python only): from a hand-drawn `.sprite` text file (`python tools/make-buddy.py tools/ember.sprite` builds the example; the format, motions and effects are in the file and the tool's help), which gives the sharpest result at this size, or from animated GIFs with a pixel-art-aware downscale (`python tools/make-buddy.py <name> --idle a.gif --working b.gif --motion working=fly --fx working=fire`), which works best with small, flat sprites. Packs made by the earlier version (pre-drawn text frames) still play. Sprites are other people's artwork: make packs from art you may use, and do not commit them here.
- `/dash-theme [name|list]` changes the colours: `auto` (the default, follows your terminal's own colours), `claude`, `nord`, `neon`, `crt` (amber), `light`, `hacker` (terminal green) and `mono` (glyphs and weight only). With no name it cycles, and so does the **theme** button in the footer. The exact-colour themes want a truecolor terminal. The choice is remembered.
- `/dash-focus on|off` folds the Sessions, Agents, Monitor, Work and PRs cards to one line each while something urgently needs you (on by default); open one with its arrow.
- `/dash-icons emoji|nerd|ascii` chooses how the icon in the Watching boxes is drawn. `emoji` (the default, 🐙) works in any font. `nerd` draws the **official GitHub mark**, which is not an ordinary character: it needs a [Nerd Font](https://www.nerdfonts.com/) set as your terminal's font, and shows as an empty box without one. `ascii` is plain letters. The choice is remembered.
- `/dash-watch pr <number or URL>` keeps an eye on a pull request and shows it in a **Watching** section at the top of the pane, one outlined box each (the GitHub icon, `PR #11`, its title and small icon marks such as `✔ ready  ● CI  ✔ approved`; boxes sit two across when the pane is wide, and a box turns yellow with a `◆` line when something changed) with where it stands (`draft`, `open`, or `ready to merge`: open, not a draft, no merge conflicts, CI neither failing nor running, no review outstanding), its CI (`passing`, `failing`, `running`, `no CI checks`) and whether it is `approved`, `not approved` or has `changes requested`, and marks it when any of that changes or it is merged or closed.
- `/dash-watch issue <number or URL>` does the same for a GitHub issue (open or closed, how many comments, who it is assigned to; it fires on new comments, assignment and label changes, closing and reopening), and `/dash-watch run <run id or URL>` for a GitHub Actions run (queued, running, passed, failed, cancelled; it fires when it finishes). A GitHub URL is read as what it is, and a bare number is a pull request. Anything else (a GitLab, Jira or Linear link, say) is not followed yet: the command says so, and names what reading it would need (a CLI or an MCP server connected to Claude Code). Nothing is contacted.
- `/dash-watch list` shows what is watched, `/dash-watch clear <number|all>` removes them. A bare number means the repository of the session you typed it in
- `/dash-summaries on|off` adds a one-line "what is it doing" under each session (off by default, see below)
- `/dash-refresh` (or the **refresh** button) refreshes everything now, PRs included

### Requirements

- `git` on your `PATH`. If `git` or `gh` is installed but this session can't find it (an app started before it was installed keeps its old `PATH` until it is restarted), dev-dash tries the standard Windows install folders (`%ProgramFiles%\Git\cmd\git.exe`, `%ProgramFiles%\GitHub CLI\gh.exe`) before giving up. Without `git` the Files section still lists what was edited, just without line counts.
- For **PRs & CI** and `/dash-watch`, the [GitHub CLI](https://cli.github.com/) logged in with `gh auth login`. Without it, that section shows a hint and the rest still works. If `gh` is installed but this session can't find it (an app started before it was installed keeps its old `PATH` until it is restarted), dev-dash tries the standard Windows install folder (`%ProgramFiles%\GitHub CLI\gh.exe`) before giving up.
- Usage limits appear on Pro and Max plans, after the session's first reply.

## What dev-dash reads and writes

Mods run with Claude Code's access to your machine, so here is everything this one touches.

**Reads**
- `~/.claude/sessions/*.json`: Claude Code's list of running sessions. The `.key` files beside them are never read.
- `~/.claude/projects/<project>/<session>.jsonl`, only for sessions that have no title, keeping just the AI-generated title or last-prompt lines.
- `~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl` and `.meta.json`: each subagent's description, type, step count and latest step.
- `~/.claude/dev-dash/sessions/*.json`: status files written by other sessions running dev-dash.
- On the Entertainment tab only, while it is showing: only if you turned Spotify on: what the Spotify app on this machine is playing, from the Windows media session (PowerShell, read-only), `osascript` (macOS) or `playerctl` (Linux). The track name is shown in the pane and not stored. No network.
- `git` in your working directories, `tasklist` (Windows) or `ps` to see which sessions are still alive, `gh api graphql` for your PRs, `gh pr view`, `gh issue view` or `gh run view` for each GitHub item you asked `/dash-watch` to follow (about once a minute, only while the pane is open, and once when you add one), and once a minute PowerShell `Get-PSDrive` (Windows) or `df -Pk` for free disk space.

**Writes**
- `~/.claude/dev-dash/sessions/<session-id>.json`, every 5 seconds: this session's state, its one-line summary (only if summaries are on), cost, context use and its per-turn trend, cache hit rate, latest step, a stuck flag, a risky-command flag (the pattern name, not the command), and the files it edited in the last 30 minutes.
- In that same file, for the Plan, Sources and Files sections: the text of the task in progress in its todo list, the URLs it fetched (scheme, host and path only; credentials, query strings and fragments are dropped before anything is stored) and the searches it ran (cut to 80 characters), and the paths of files it edited this turn with their added and removed line counts. For the test badge: the last test run it started, as a runner label such as `npm test` or `pytest`, whether it passed, and when. Never the command line, its arguments or its output.
- `~/.claude/dev-dash/handoffs/<time>-<session>.md`, once each time this session's conversation compacts (`/compact` or automatic): a short note with the session's repo, branch and directory, a `claude --resume` line, how far its todo list got, its last step, the files it edited recently, and the summary text the compaction kept (cut to 2000 characters). These files stay on your machine. Only the newest 30 are kept: when a new note is written, dev-dash deletes older files in that folder, only files named like its own notes (a date and time, a short session id and `.md`), one bare file name at a time inside that folder, and nothing else. `/dash-handoff off` stops writing them. Compactions inside subagents are not written.
- `~/.claude/dev-dash/last-error.txt`, only when a refresh fails: the time, where it failed, and the first 1500 characters of the error's stack trace (which can contain local file paths). Only the latest error is kept: the file is overwritten, never appended to.
- Its own plugin store: the alerts, band, summaries and handoff on/off choices, the icon style, and the `/dash-watch` list (for each watch: its kind (pull request, issue or run), `owner/repo`, number, title, its last state in words such as `open · CI passing · approved`, `open · 2 comments · unassigned` or `running`, the small marks drawn from it (an icon and a word each, such as `✔ approved` or `👤 ana`, so an assignee's login can be among them), and times; at most 10, dropped 24 hours after they were added or last changed). `/dash-watch clear all` empties it.

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
