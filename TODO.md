# TODO

Where dev-dash is going. Updated 3 October 2026. Owners: **Claude** (leads the project for Rahul), **Connor**, **Rahul** (owns the repo).
Mark an item done by changing `[ ]` to `[x]` in the PR that finishes it.

## Now

### Keyboard-first navigation (Claude)
Goal: every part of the pane reachable and usable from the keyboard, with the keys always visible on screen.

- [ ] Open `/dash` with the keyboard already on the pane (no ctrl+x tab needed).
- [ ] A selection cursor: `j` / `k` move down and up through items, `g` jumps to the top.
- [ ] Row actions on the selected item: `c` copy (session id, PR link or branch), `s` snooze 15 minutes, `x` dismiss.
- [ ] Snooze and dismiss respect the band above the prompt and the toasts too, not just the pane.
- [ ] `h` opens a full key reference inside the pane; `q` closes the pane.
- [ ] The key legend in the footer always matches the real keys (one keymap table drives both).
- [ ] Sections added by others (Plan, Sources, Files) can register their rows into the cursor list.
- [ ] Tests for the cursor, snooze, dismiss and the keymap; README gets a Keyboard section.

Why Buttons and not a custom key listener: a pane that has the keyboard presses any Button whose hotkey is one digit or one lowercase letter, and arrows already scroll. That covers everything above with no new module. Arrow-key selection would need a separate `Client` module and is not planned.

### In review
- [ ] **PR #6** (Connor): Plan, Sources and Files sections. Changes requested: strip URL query strings before saving, and stop re-running git on idle sessions. Then re-run the checks and merge. (Connor, then Claude)
- [ ] **PR #4** (Claude): opt-in one-line session summaries. Needs a live test with `/dash-summaries on`, then merge. (Rahul or Claude)

## Next

### UI redesign (later)
Mocks: https://claude.ai/artifact/JYNHbTvB7nbN8Qx8TgTai3 (private link; the same plan is below). Rahul picks the direction.

- [ ] Choose a direction: **A** tabs, **B** board for wide docks, **C** triage inbox. Recommendation: tabs with the triage inbox as the landing tab, board layout for wide docks afterwards.
- [ ] Shared upgrades, whichever direction wins:
  - [ ] nest agents under the session that owns them
  - [ ] one colour meaning per colour (yellow = needs you, red = broken or at risk, green = fine, cyan = detail, magenta = agents)
  - [ ] relative times everywhere, clock times only in the timeline
  - [ ] density switch (compact, comfortable)
  - [ ] calm state by default when nothing needs you
- [ ] Move Plan, Sources and Files into the new layout. (Claude)

### From the research (docs/mods-research.md)
- [ ] **Cache clock**: time until each session's prompt cache expires, with a warning before an idle session loses it. (Claude)
- [ ] **Rule-based advisor**: a few fixed rules, no model calls (cache about to expire, context past 80%, the same command failing). (Claude)
- [ ] **Get discovered**: open a PR to be listed in karanb192/awesome-claude-code-mods (the repo already has the `claude-code-mod` topic). (Claude)
- [ ] **Check the desktop app**: run dev-dash there and fix what looks off. (Claude)
- [x] **Handoff on /compact**: write a short handoff note whenever a session compacts. (Connor, PR open)
- [ ] **Agent drill-down**: click an agent to read its conversation, with a Stop button. (open, large)
- [ ] **Session recap card**: a shareable summary of the day across sessions. (open)
- [ ] **Optional mascot** whose mood follows overall status, off by default. (open)
- [ ] **Team usage view**: teammates' usage and limits in one place; needs shared storage. (open, large)

### Watch (Connor, from the ideas list)
- [x] `/dash-watch pr <number or URL>`: a Watching section at the top of the pane; polls `gh pr view` about once a minute while the pane is open; fires on a change after the first look (event feed and a mark, no toast).
- [ ] **Rahul to decide**: may explicit watches poll while the pane is closed? May non-GitHub sources (Jenkins, a status page, news) run through a command the person wrote, or an MCP server they already connected? Both need a change to CONTRIBUTING.md. Tweets/X are not reliably reachable and stay out.
- [x] `/dash-watch issue` and `/dash-watch run` (`gh issue view`, `gh run view`), same rules as the PR watch. (Connor, PR open)
- [ ] Other `gh` watches: release, a branch moving (`git ls-remote`). (Connor)

## Housekeeping
- [ ] Type-check the plugin (`tsc` is not installed on the machines used so far). (anyone)
- [ ] Branch protection on `main`: require a PR and one review for people other than the owner. (Rahul)
- [ ] Reddit coverage for the research page; tools could not reach Reddit. (Rahul can paste threads)

## Done
- [x] Dashboard pane, agents, monitor, band above the prompt, alerts (PRs #1, #2, #3)
- [x] Research on what people build with mods (PR #5)
- [x] Connor invited as a collaborator; PR #6 opened
- [x] **Test badge**: a pass/fail badge on each session row for the last test run it started (Connor, PR open)
