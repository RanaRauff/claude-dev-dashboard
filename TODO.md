# TODO

Where dev-dash is going. Updated 3 October 2026. Owners: **Claude** (leads the project for Rahul), **Connor**, **Rahul** (owns the repo).
Mark an item done by changing `[ ]` to `[x]` in the PR that finishes it.

## Now

### Keyboard-first navigation (Claude): built, waiting for a live check
Goal: every part of the pane reachable from the keyboard with the keys people already know. No letter hotkeys.

- [x] `/dash` opens with the keyboard on the pane (no ctrl+x tab needed).
- [x] ↑ ↓ and Tab move a highlight over the rows and buttons; Enter presses; Esc returns to the prompt; ctrl+x tab comes back.
- [x] Every row has a `›` marker. Enter opens its actions: copy (resume command, PR link or summary), snooze 15m, dismiss.
- [x] Snooze and dismiss reach the pane, the band above the prompt and the toasts alike; "bring back" undoes them.
- [x] Footer buttons: refresh, alerts, help, close. Help lists the keys.
- [x] Tests for the actions, snooze/dismiss and the whole flow through the engine's press path; README Keyboard section.
- [ ] **Check it in a live pane** (Rahul): `/dash`, then ↑ ↓ / Tab / Enter / Esc. Not yet seen on a real terminal.
- [ ] Sections added by others (Plan, Sources, Files) get a `›` marker too. (Claude; the row list is `itemsOf` in `hooks/attention.ts`, the marker is `Row` in `hooks/render.tsx`)

### In review
- [ ] **PR #8** (Claude): keyboard navigation, above. Needs the live check, then merge. (Rahul)
- [ ] **Handoff on /compact** (Connor, merged in #9): confirm a note appears after `/compact` in a throwaway session with the plugin loaded, and add a retention cap (keep the newest 30) and an off switch. (Connor)

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

## Housekeeping
- [ ] Type-check the plugin (`tsc` is not installed on the machines used so far). (anyone)
- [ ] Branch protection on `main`: require a PR and one review for people other than the owner. (Rahul)
- [ ] Reddit coverage for the research page; tools could not reach Reddit. (Rahul can paste threads)

## Done
- [x] Dashboard pane, agents, monitor, band above the prompt, alerts (PRs #1, #2, #3)
- [x] Research on what people build with mods (PR #5)
- [x] Connor invited as a collaborator; PRs #6 (Plan, Sources, Files), #9 and #10 (handoff on /compact, retention, off switch) and #11 (test badge) merged
- [x] Opt-in one-line session summaries (#4)
