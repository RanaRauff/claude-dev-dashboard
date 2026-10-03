# dev-dash: what to put on the dashboard

Research date: 2026-10-03. Every claim about what people build or say is linked. Where something could not be verified, it says so.

## 0. The headline finding: Anthropic now ships a session list

Anthropic shipped **agent view** (`claude agents`, research preview). It lists every background session grouped as Pinned / Ready for review (has PR) / Needs input / Working / Completed. Each row has a one-line status written by Haiku, an age, and a PR label. It also has peek, attach, rename and pin ([docs](https://code.claude.com/docs/en/agent-view)). Anthropic's Thariq described it on X as "kind of like tmux built for CC". That quote comes from the [search snippet of the post](https://x.com/trq212/status/2053979505346425179); X itself returned HTTP 402, and the xcancel mirror returned 451.

**What this means for dev-dash:** a plain "list of sessions and their state" now exists inside Claude Code. dev-dash should win on what agent view does **not** show:
- cost, context and rate-limit pace
- git and PR state across all your work
- how much review is piling up
- your own wellbeing
- doing all of this inside a pane while you keep working

The Sessions section is still useful, but it should not be the main reason to install dev-dash.

Small discrepancy: PR #1's description says sessions "running the plugin" write status files every 5 s to `~/.claude/dev-dash/sessions/`, while the brief says the plugin reads `~/.claude/sessions/<pid>.json`. Check which one is current. [recon](https://github.com/gavraz/recon) reads `~/.claude/sessions/{PID}.json` and works without each session running a plugin.

---

## 1. Top ideas, ranked (value × coolness ÷ effort)

Effort: S = a day or two, M = about a week, L = more. "Feasible" refers to the function-hooks API described in the brief.

| # | Idea | Group | Feasible | Effort |
|---|------|-------|----------|--------|
| 1 | Limit runway / pace gauge | Cost & limits | Yes | S |
| 2 | "Needs you" inbox + unread completions | Oversight | Yes (jump-to-session: partly) | S |
| 3 | Review-load meter (what agents produced that you haven't reviewed) | Code & git / PRs | Yes | M |
| 4 | Context health with thresholds + compaction nudge | Cost & limits | Yes | S |
| 5 | Stuck / looping / burning detector | Oversight | Yes | M |
| 6 | File-collision radar across sessions | Oversight / Code | Yes | M |
| 7 | Spend today / per project / per session, with sparkline | Cost & limits | Partly | M |
| 8 | Focus guardrails: WIP limit, session clock, after-hours nudge | Focus & wellbeing | Yes | S |
| 9 | CI transition alerts (red→green, merged) with sound/toast | PRs/CI | Yes | S |
| 10 | Worktree & branch janitor | Code & git | Yes | S |
| 11 | One-line "what is it doing" summaries per session | Oversight | Yes (costs tokens) | M |
| 12 | Permission-prompt heatmap → suggested allow rules | Oversight | Yes | M |
| 13 | End-of-day recap / standup draft | Team / Focus | Yes | M |
| 14 | Session creatures (pet per session/worktree, mood = hygiene) | Fun | Yes | M |
| 15 | Personal DORA-lite (PR cycle time, review turnaround) | PRs/CI | Yes | M |
| 16 | Tool-call timeline per session | Oversight | Yes | M |
| 17 | Other agents (Codex, Gemini CLI, Aider) in the same list | Oversight | Partly | M–L |
| 18 | Team broadcast (post status to Slack / shared board) | Team | Partly | L |

### 1. Limit runway / pace gauge
**Pitch:** "5h window: 62%, resets 15:40. At the current pace you hit 100% at 14:55, 45 min early." The same is shown for the 7-day window.

**Why developers want it:**
- Usage visibility is called "the #1 most-requested feature category", consolidating 10+ issues ([anthropics/claude-code#33978](https://github.com/anthropics/claude-code/issues/33978)).
- In Jan 2026 developers complained about hitting limits "within 10–15 minutes", and one said "my analytics in the console are all blank" ([The Register](https://www.theregister.com/2026/01/05/claude_devs_usage_limits/)).
- [Claude HUD](https://github.com/jarrodwatts/claude-hud) (28.3k stars when fetched) has an optional "pace" indicator for this.
- [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) is built around burn rate and runway prediction.
- Codex CLI's `/status` shows the same two windows ([viberank guide](https://www.viberank.app/blog/how-to-check-codex-usage)).

**Data:** `$.session.usage()` rate limits. Officially these are `five_hour` / `seven_day` `used_percentage` + `resets_at` ([statusline docs](https://code.claude.com/docs/en/statusline)). Sample them with `$.clock.every`, keep a short history and fit a slope.

**Feasible:** Yes. Two caveats from the docs: the data exists only for Pro/Max users (or behind a gateway) and only after the first API response. With many sessions, take the maximum across sessions, because they share one account. Agent view's docs say "10 sessions ≈ 10× token usage".

**Effort:** S. A toast at 80% and at a projected early exhaustion makes it great.

### 2. "Needs you" inbox + unread completions
**Pitch:** One list, sorted by how long each session has waited. It has two kinds of entries:
- blocked on you (permission, question)
- **finished since you last looked**

Pressing a key focuses the session or sends it a message.

**Why developers want it:**
- Boris Cherny (creator of Claude Code) runs 5 terminal Claudes and relies on system notifications to know which needs input ([VentureBeat](https://venturebeat.com/technology/the-creator-of-claude-code-just-revealed-his-workflow-and-developers-are)).
- [tmux-agent-status](https://github.com/samleeney/tmux-agent-status) has a separate "unread completion inbox" plus "wait and park" modes.
- [Executive](https://news.ycombinator.com/item?id=46858990) plays a chime on completion.
- Notifier tools are a whole category on [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) (ai-agent-notifier, Claudio sounds, Lockpaw).

**Data:** session registry plus a per-session "last seen" timestamp stored with `$.fs`, then `turn complete` and `tool.check` hooks.

**Feasible:** Yes for the list, sound and toast. "Reply" can use `$.session.send`. Actually switching your terminal focus to another session is **partly** possible at best; the API has no "focus window".

**Effort:** S. The Attention section already does half of this. "Unread completions" is the new part.

### 3. Review-load meter
**Pitch:** "Unreviewed agent output: 4 branches, +1,830/−412 lines, 2 with failing tests." A bar turns red past your personal limit, and the list is sorted smallest-first so you can clear it quickly.

**Why developers want it:**
- Faros AI (10k+ devs): high-AI teams merged 98% more PRs, but PR review time rose 91% and PR size grew 154% ([Faros](https://www.faros.ai/blog/ai-software-engineering)).
- DORA 2025: AI raises throughput but still hurts stability, and review is the bottleneck ([Faros summary](https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025), [RedMonk](https://redmonk.com/rstephens/2025/12/18/dora2025/)).
- Simon Willison: "I can only focus on reviewing and landing one significant change at a time" ([blog](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)).
- Addy Osmani: "The bottleneck is no longer generation. It's verification." ([blog](https://addyosmani.com/blog/code-agent-orchestra/)).

**Data:** `git diff --shortstat` per worktree/branch vs base (`$.process.run`), plus `gh pr list` for agent PRs and the last test result seen in `tool.call` (Bash `npm test` exit codes).

**Feasible:** Yes. **Effort:** M. This is the strongest "only dev-dash does this" feature.

### 4. Context health + compaction nudge
**Pitch:** A context bar per session with 50/75/90% thresholds. When a session crosses one, you get a toast: "Session `api-fix` at 78%: consider /compact or /clear."

**Why developers want it:**
- [anthropics/claude-code#65292](https://github.com/anthropics/claude-code/issues/65292) asks for exactly this: 50%/75% warnings plus a `/clear` suggestion, after sessions grew silently to 1M tokens. It was closed as not planned, so the gap is still there.
- Gemini CLI users ask for the same ([gemini-cli#12788](https://github.com/google-gemini/gemini-cli/issues/12788)).
- Claude HUD colors its bar green → yellow (70%) → red (85%) ([repo](https://github.com/jarrodwatts/claude-hud)).

**Data:** `$.session.usage()` context %. **Feasible:** Yes. **Effort:** S.

### 5. Stuck / looping / burning detector
**Pitch:** Flags a session when any of these happen:
- the same tool+args repeats N times
- a Bash command keeps failing
- no file has changed in 15 min of "running"
- cost rises fast with no diff

The flag reads: "`refactor-auth` looks stuck: 6× `npm test` failing, $3.10 in 12 min."

**Why developers want it:**
- On the [Agents Observe Show HN](https://news.ycombinator.com/item?id=47602986), commenters described agents "running fine but producing bad outputs" and "sanitised optimism" (claiming success while hiding errors).
- A Reddit user quoted in press coverage: "One session in a loop can drain your daily budget in minutes". Only seen in a search-result snippet for an [AOL/Yahoo syndicated article](https://www.aol.com/articles/claude-code-users-hitting-usage-115924704.html); not verified on Reddit.

**Data:** the `tool.call` hook stream (name, args, result), cost deltas from `$.session.usage()`, `git diff --stat`. **Feasible:** Yes. **Effort:** M. Start with simple rules and add a `$.model` judge later.

### 6. File-collision radar
**Pitch:** "⚠ `src/auth.ts` is being edited by 2 sessions (`api-fix`, `login-ui`)." Clicking it messages one session through `$.session.send`.

**Why developers want it:**
- Merge conflicts between parallel agents are a top pain ([Addy Osmani](https://addyosmani.com/blog/code-agent-orchestra/)). That is why claude-squad, Conductor and Vibe Kanban all isolate each agent in a worktree ([claude-squad](https://smtg-ai.github.io/claude-squad/), [comparison](https://nimbalyst.com/compare/nimbalyst-vs-conductor-vs-vibe-kanban/)).
- [Crew](https://news.ycombinator.com/item?id=48782800) goes further and injects what other sessions are doing into each session's context.

**Data:** Edit/Write `tool.call` paths written to a shared file under `~/.claude/dev-dash/`. **Feasible:** Yes. Worktree sessions can't collide on disk, but they can on the same logical file, which surfaces conflicts before merge. **Effort:** M. Very "cool" and cheap to demo.

### 7. Spend: today / per project / per session
**Pitch:** "Today $18.40 (▁▂▅▇▃). Top: `monorepo` $11.2. This week $64." Cache-read savings are shown separately.

**Why developers want it:**
- [ccusage](https://ccusage.com/) exists to answer this: it parses local JSONL, works offline, and gives daily/session/5h-block views.
- [#33978](https://github.com/anthropics/claude-code/issues/33978) stresses cache-aware cost, because "cost estimates that ignore cache tokens are inaccurate."

**Data:** `$.session.usage()` gives live per-session cost. For history, parse `~/.claude/projects/*/*.jsonl` with `$.fs`, or run `npx ccusage --json` via `$.process.run`.

**Feasible:** Partly. Seat/subscription users may get no dollar figure ([#56629](https://github.com/anthropics/claude-code/issues/56629) says session cost shows only with API-key billing). For them, show tokens and limit % instead. **Effort:** M.

### 8. Focus guardrails
**Pitch:**
- A WIP indicator: "4 active agents (your limit: 3)".
- A per-day session clock.
- A gentle nudge after 21:00 or after 3h without a break.
- An optional "park all" that tells idle sessions to stop.

**Why developers want it:**
- Willison calls parallel agents "mentally exhausting" ([blog](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)).
- Addy Osmani: "Your cognitive bandwidth doesn't parallelize"; he recommends 3–4 focused threads ([blog](https://addyosmani.com/blog/cognitive-parallel-agents/)) and WIP limits of 3–5 ([blog](https://addyosmani.com/blog/code-agent-orchestra/)).
- LeadDev cites a 19.6% rise in after-hours submissions (Multitudes) and the "slot machine" pull ([LeadDev](https://leaddev.com/ai/addictive-agentic-coding-has-developers-losing-sleep)).
- See also [Axios](https://www.axios.com/2026/04/04/ai-agents-burnout-addiction-claude-code-openclaw) and [Built In on "AI brain fry"](https://builtin.com/articles/ai-brain-fry-software-developers).

**Data:** registry + clock. **Feasible:** Yes. **Effort:** S. It must be opt-in and non-preachy.

### 9. CI transition alerts
**Pitch:** A toast and sound only on *changes*: "PR #42 CI ✗ → ✓", "PR #40 merged 🎉", "new review requested". No repeated nagging.

**Why developers want it:** [gh-dash](https://github.com/dlvhdr/gh-dash) is popular for keeping PR/CI triage in the terminal ([metabureau write-up](https://metabureau.com.au/blog/gh-dash-terminal-github-dashboard)), and Executive's chime shows people like audio cues ([HN](https://news.ycombinator.com/item?id=46858990)).

**Data:** the existing `gh` poll, diffed against the previous poll. **Feasible:** Yes. **Effort:** S.

### 10. Worktree & branch janitor
**Pitch:** "3 worktrees with merged branches, 2 stale stashes (>14 d), 1 orphaned `.claude/worktrees/*`. [Clean]". Cleaning asks for confirmation first.

**Why developers want it:**
- Agent view's own docs warn about leftovers ("use `git worktree remove` for leftovers"; [docs](https://code.claude.com/docs/en/agent-view)).
- [TermaGITchi](https://github.com/TevvvB/termagitchi) turns worktree tidiness (uncommitted files, unpushed commits, failing tests) into a health score.

**Data:** `git worktree list`, `git branch --merged`, `git stash list`. **Feasible:** Yes. **Effort:** S. dev-dash already collects most of this.

### 11. One-line "what is it doing" summaries
**Pitch:** Each session row gets a model-written line, e.g. "Waiting: asks whether to drop the `legacy_users` table".

**Evidence:** agent view does this with Haiku ([docs](https://code.claude.com/docs/en/agent-view)), which shows Anthropic thinks it is worth it.

**Data / feasibility:** `$.session.messages` + `$.model`. Feasible, but each summary costs tokens. Summarize only on state change and only while the pane is open. **Effort:** M. Lower rank because agent view already has it.

### 12. Permission-prompt heatmap → allow-rule suggestions
**Pitch:** "This week you approved `Bash(npm test:*)` 87×. Add to allowlist?"

**Evidence:**
- Anthropic: "Claude Code users approve 93% of permission prompts" ([engineering blog](https://www.anthropic.com/engineering/claude-code-auto-mode)).
- "Permission fatigue is a security risk" ([Atomic Object](https://spin.atomicobject.com/permission-fatigue-claude-code/)).

**Data:** the `tool.check` hook. Log decisions to `$.fs`. **Feasible:** Yes (suggest only; let the user edit settings). **Effort:** M.

### 13. End-of-day recap / standup draft
**Pitch:** "/dash recap" writes: today's merged PRs, commits per repo, sessions run, spend, and open loops for tomorrow.

**Evidence:**
- Claude Code's OTel metrics already count commits, PRs, lines of code and active time ([docs](https://code.claude.com/docs/en/monitoring-usage), [SigNoz](https://signoz.io/blog/claude-code-monitoring-with-opentelemetry/)).
- [JKershaw/dash](https://github.com/JKershaw/dash) analyzes session logs for patterns. This shows people want reflection, not only live status.

**Data:** git log, gh, `$.model`. **Feasible:** Yes. **Effort:** M.

### 14. Session creatures
**Pitch:** Each session or worktree gets a stable pixel or kaomoji pet. Its mood follows state and hygiene: it sleeps when idle, waves when it needs you, and gets sick on red CI.

**Evidence:**
- [recon](https://github.com/gavraz/recon) has a "Tamagotchi view" made for a side monitor.
- [TermaGITchi](https://github.com/TevvvB/termagitchi) uses 5 hearts lost on dirty or unpushed state.
- [Claude-Code-Personalities](https://github.com/kumamaki/Claude-Code-Personalities) has 30+ reactive kaomoji.
- [claude-bestiary](https://github.com/sainteye/claude-bestiary) is another example.
- The value isn't only cuteness: a stable identity helps you tell 6 sessions apart at a glance (TermaGITchi README).

**Feasible:** Yes (Text glyphs). **Effort:** M. Best as an optional theme.

### 15. Personal DORA-lite
**Pitch:** Your PR cycle time, time to first review, review turnaround for others, and CI flake rate over the last 30 days.

**Evidence:** DORA/LinearB-style metrics are the classic dashboards. DORA 2025 says AI moves the bottleneck downstream ([RedMonk](https://redmonk.com/rstephens/2025/12/18/dora2025/)).

**Data:** `gh api` search. **Feasible:** Yes. **Effort:** M. Refresh rarely, e.g. hourly.

### 16. Tool-call timeline
**Pitch:** A compact strip per session (`R R E B✗ B✓ E`) to scan what happened, with the last N calls expandable.

**Evidence:** Agents Observe: "there's a huge amount of value in just having a clear visual timeline" ([HN](https://news.ycombinator.com/item?id=47602986), [repo](https://github.com/simple10/agents-observe)).

**Feasible:** Yes via `tool.call`. **Effort:** M.

### 17. Other agents in the same list
**Pitch:** Codex CLI, Gemini CLI and Aider sessions shown next to Claude ones.

**Evidence:**
- [tmux-agent-status](https://github.com/samleeney/tmux-agent-status) tracks Claude, Codex and Devin with different glyphs.
- [claude-squad](https://github.com/YarikMix/claude-squad) supports Codex, OpenCode and Amp.

**Feasible:** Partly. These agents don't run dev-dash's hooks, so only process detection via `$.process.run` (`ps`/`tasklist`) or their own hook/status-file setups would work. **Effort:** M–L.

### 18. Team broadcast
**Pitch:** Post "what my agents are doing / PRs ready" to Slack or a shared board.

**Evidence:**
- [Claude Threads](https://github.com/hesreallyhim/awesome-claude-code) streams sessions into Slack.
- Cursor has a team usage leaderboard and lets teammates view cloud agents ([Cursor search summary](https://cursor.com/docs/account/teams/analytics); not fully verified).
- Vibe Kanban's team/cloud features were shut down for lack of a business ([review](https://vibecoding.app/blog/vibe-kanban-review)).

**Feasible:** Partly (would need a webhook via `$.process.run curl`, plus credentials). **Effort:** L. Defer.

---

## 2. Ideas by group

- **Agent/session oversight:** #2 Needs-you inbox, #5 Stuck detector, #6 Collision radar, #11 Summaries, #12 Permission heatmap, #16 Timeline, #17 Other agents.
- **Cost & limits:** #1 Runway/pace, #4 Context health, #7 Spend.
- **Code & git:** #3 Review-load meter, #10 Janitor.
- **PRs/CI/reviews:** #3 (also), #9 CI transitions, #15 DORA-lite.
- **Focus & wellbeing:** #8 Guardrails, #13 Recap.
- **Team/collaboration:** #13 Recap as standup, #18 Broadcast.
- **Fun/delight:** #14 Creatures, the merge celebration in #9, and sound packs (cf. [Claudio](https://github.com/hesreallyhim/awesome-claude-code)).

---

## 3. What's out there (most relevant)

1. **Agent view (`claude agents`)**, from Anthropic. A first-party multi-session list with Needs input / Working / Completed, Haiku status lines, PR labels and worktree isolation. It is the baseline dev-dash must complement. [docs](https://code.claude.com/docs/en/agent-view)
2. **ccusage**, the de-facto local cost analyzer (daily, session and 5-hour block views, offline). Its `blocks --live` monitor was removed in v18 in favor of a statusline command; no reason is given in the docs. [site](https://ccusage.com/), [live-monitoring page](https://ccusage.com/guide/live-monitoring)
3. **Claude HUD**, the most popular status-line plugin (28.3k stars on GitHub when fetched). It shows context, rate limits with a pace indicator, tools, agents and todos, with no network. [repo](https://github.com/jarrodwatts/claude-hud)
4. **Claude-Code-Usage-Monitor**, which does burn-rate and runway predictions and auto-detects your plan. Its "ML predictions" claim is questioned in [issue #165](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/165). A third-party site lists ~8.7k stars, not verified on GitHub. [repo](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)
5. **claude-squad**, a Go TUI that runs many agents (Claude, Codex, Aider, Amp…) in tmux + git worktrees, with review-before-ship. [site](https://smtg-ai.github.io/claude-squad/)
6. **recon**, a tmux-native table + "Tamagotchi" dashboard. It reads `~/.claude/sessions/{PID}.json`, the same source dev-dash uses, and had 263 stars when fetched. [repo](https://github.com/gavraz/recon)
7. **tmux-agent-status**, which is hook-driven and covers several agents. It has an unread-completion inbox and wait/park modes. [repo](https://github.com/samleeney/tmux-agent-status)
8. **Agents Observe**, a hooks → SQLite → React live timeline of agent teams with subagent hierarchy. Its HN thread has useful lessons on hook performance. [repo](https://github.com/simple10/agents-observe), [HN](https://news.ycombinator.com/item?id=47602986)
9. **gh-dash**, a configurable PR/issue sections TUI built on GitHub search syntax. It is the model to copy for the PRs & CI section. [repo](https://github.com/dlvhdr/gh-dash)
10. **Conductor / Vibe Kanban**, GUI orchestrators that put diff-first review at the center. Vibe Kanban's company shut down in April 2026; the local tool lives on as OSS. [comparison](https://nimbalyst.com/compare/nimbalyst-vs-conductor-vs-vibe-kanban/), [review](https://vibecoding.app/blog/vibe-kanban-review)

Also seen:
- [Executive](https://news.ycombinator.com/item?id=46858990): dashboard + chime + autopilot.
- [Crew](https://news.ycombinator.com/item?id=48782800): cross-session context injection.
- [amux](https://news.ycombinator.com/item?id=47363707): web/phone multiplexer.
- [TermaGITchi](https://github.com/TevvvB/termagitchi) and [Claude-Code-Personalities](https://github.com/kumamaki/Claude-Code-Personalities): fun.
- Claude Code [OTel monitoring](https://code.claude.com/docs/en/monitoring-usage): team-level Grafana.

---

## 4. Pitfalls people report

- **Noise / overload.** "When everything is highlighted, nothing is", and "information density has diminishing returns" ([status-line essay](https://ovidiueftimie.substack.com/p/claude-code-status-lines-that-actually)). Alert only on *transitions*, and keep one Attention list.
- **Hook overhead.** On the Agents Observe HN thread, several commenters agreed "blocking hooks degrade performance" and that stacked plugins add up ([HN](https://news.ycombinator.com/item?id=47602986)). Keep `tool.call`/`tool.check` handlers non-blocking and O(1); batch writes.
- **GitHub rate limits.** Dashboards that keep polling after a 403 burn requests every tick. Back off until `resetAt` ([dashpot#306](https://github.com/ned2/dashpot/issues/306)). `gh` can also cache stale rate-limit headers for up to 24 h ([cli/cli#12812](https://github.com/cli/cli/issues/12812)). Poll only while the pane is open, as PR #1 already does.
- **Inaccurate numbers kill trust.** A wrong usage figure also breaks the burn-rate projection built on it ([ccusage#326](https://github.com/ccusage/ccusage/issues/326)). Cost that ignores cache tokens is wrong ([#33978](https://github.com/anthropics/claude-code/issues/33978)). Label every estimate as an estimate.
- **Data availability.** `rate_limits` exists only for Pro/Max (or a gateway) and only after the first response ([docs](https://code.claude.com/docs/en/statusline)). Session cost is unavailable for some subscription/enterprise users ([#56629](https://github.com/anthropics/claude-code/issues/56629)). Degrade gracefully.
- **Privacy.** "I'm pretty wary of giving something full context of my agents" ([Crew HN](https://news.ycombinator.com/item?id=48782800)). Stay local; no network except `gh`. Make any `$.model` summarization opt-in, since it sends transcript snippets to a model.
- **Token cost of the dashboard itself.** Model-written summaries and judges cost money, and parallel sessions already multiply usage ([agent view docs](https://code.claude.com/docs/en/agent-view)). Throttle them hard.
- **Approval fatigue.** Users approve 93% of prompts ([Anthropic](https://www.anthropic.com/engineering/claude-code-auto-mode)). A dashboard that adds more interruptions makes this worse.
- **Wellbeing features can feel preachy.** Make them opt-in and quiet. The evidence that people want them is indirect: articles about burnout ([LeadDev](https://leaddev.com/ai/addictive-agentic-coding-has-developers-losing-sleep), [Addy Osmani](https://addyosmani.com/blog/cognitive-parallel-agents/)), not direct feature requests.
- **Overlap with first-party features.** Agent view and the built-in status line keep improving. Build where Anthropic isn't: cross-cutting git/PR/review/cost views.

---

## 5. Sources that could not be reached

- **Reddit:** WebFetch is blocked for reddit.com, and `site:reddit.com` searches returned no Reddit pages. Reddit sentiment here is second-hand, via [The Register](https://www.theregister.com/2026/01/05/claude_devs_usage_limits/) and AOL/TechRadar coverage.
- **X/Twitter:** x.com returned HTTP 402 and the xcancel mirror returned 451. X content is cited only from search-result snippets (Thariq on agent view, and [Kol Tregaskes summarizing Boris Cherny](https://x.com/koltregaskes/status/2007498194960441387)).
- **Not verified:** star counts other than Claude HUD (28.3k) and recon (263), both read from GitHub pages fetched today. The Cursor leaderboard/team-agents details come from search summaries only.
