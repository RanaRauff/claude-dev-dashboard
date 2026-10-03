# Claude Mods in the Wild

_Research · 3 October 2026 · Claude Code 2.1.287_

What developers built in the first three days after Claude Code mods launched on 1 October 2026: 82 examples in eight kinds, the posts and repos behind them, and what dev-dash should take from it. A browsable version with filters is in `mods-research.html`.

## Six findings

- **Mods arrived on October 1, 2026, with Claude Code 2.1.287.** They are small TypeScript functions, shipped inside plugins, that can rewrite prompts, add UI or replace built-in features, in both the CLI and the desktop app. Anthropic says they are not sandboxed and run with the same access as Claude Code.
- **Three days in, the ecosystem is already large.** The community list reports 1,017 mods in its scan of GitHub on October 3. GitHub search shows dozens of mod repositories pushed this week, most with under 30 stars.
- **Usage and context readouts are the first thing people build.** More than a dozen mods show limits, cost, cache or context, and the official examples lead with one. The newest wave adds forecasts: when you will run out, when the cache expires.
- **The most-liked builds are fun, not useful.** ASCII video, Tetris, Doom and chess draw the most attention. Useful mods get fewer likes. The replies show steady requests for a team usage pane and for a way to see what a mod touches before installing it.
- **Trust is the open question.** Anthropic's own posts warn about full machine access. A scanner now publishes what each mod can read, write or run, and replies in the launch thread ask for that before installing.
- **Anthropic ships overlapping features.** Its agent view already lists every session by state. Tools that only list sessions will overlap; the room is in cost and limits, reviewing agent output, and git and PR state across projects.

## What people are building

A sample of 82 examples picked from the launch thread, GitHub search, Hacker News and the community list. Counts per kind: While you wait 21, Dashboards and usage 19, Agents and workflows 11, Rendering and panes 8, Git, PRs and CI 6, Safety and privacy 6, Memory and context 6, Personal workflow 5.

### Dashboards and usage

- **cctop** (tomstagl): A btop-style pane beside the session: context fill, tokens, cost, cache hit ratio, rate limits, per-tool latency and subagents. Its advisor is 36 fixed rules with no model calls. [repo](https://github.com/tomstagl/cctop)
- **flightdeck** (scasella): A live agent dashboard: context and cost, an advisor timeline, every permission verdict, subagent cards and swimlanes. Its repo scan reports no network, file or process access. [repo](https://github.com/scasella/claude-flightdeck)
- **usage-weather** (AndersonD89): Usage as a weather forecast above the prompt: context from sunny to stormy, 5-hour and weekly limits with reset times, cost and cache hit rate. CLI and desktop. [post](https://x.com/AndersonD89/status/2105795831135883358) · [repo](https://github.com/AndersonDavi/claude-mods)
- **token-weather-usage** (augiefra): One line with context weather, a bar per prompt sized by the tokens it added, and 5-hour and 7-day gauges. [repo](https://github.com/augiefra/claude-mods/tree/main/plugins/token-weather-usage)
- **usage-meter** (HolyGrail): A usage meter that shows in the desktop app, where mods can draw rich panels. [post](https://x.com/HolyGrail/status/2105773955626004973) · [repo](https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter)
- **usage-band** (pawandeepdhall): 5-hour and weekly limits with reset countdowns, turning amber or red when you are on pace to run out, plus buttons for a new chat and for committing and pushing. [repo](https://github.com/pawandeepdhall/claude-mods/tree/main/plugins/usage-band)
- **token-ledger, context-lens, quota-meter** (Arunjay4213): Three small mods: session cost with cache hit ratio, a live /context line with growth per turn, and the plan windows as a pinned line. [repo](https://github.com/Arunjay4213/claude-mods/tree/main/plugins)
- **burn-meter** (OneWave-AI): Session spend as a growing fire bar above the prompt, with plan limits and a /burn pane of per-turn cost. [repo](https://github.com/OneWave-AI/claude-code-mods/tree/main/burn-meter)
- **session-wrapped** (OneWave-AI): /wrapped plays an animated recap of the session and writes a shareable PNG card, with week and month totals from local transcripts. [repo](https://github.com/OneWave-AI/claude-code-mods/tree/main/session-wrapped)
- **hud** (hoobnn): The claude-hud status line as a mod: quota alerts, a usage forecast, a daily budget, a one-line task summary forked from the conversation, and twelve themes. [repo](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/hud)
- **statuspane** (xuanji86): A floating status card with model, effort, context, limits, cost and branch, plus GitHub CI rows that any script can feed. [repo](https://github.com/xuanji86/claude-statuspane)
- **wavy-usage** (BatuhanCakmakk): Desktop usage rings with an estimate of cache lifetime, recent turn costs and the observed growth of the 5-hour window; a text band in the terminal. [repo](https://github.com/BatuhanCakmakk/wavy-usage)
- **receipt** (hoobnn, yash-gadodia): One row after each turn: files changed, lines added and removed, commands run and failed. One version adds a toast when the model goes in circles. [hoobnn](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/receipt) · [yash-gadodia](https://github.com/yash-gadodia/claude-mods/tree/main/receipt)
- **todo-bar** (hoobnn): The task list as a progress bar above the prompt, with the running task's time, read from the todo tools' own results. [repo](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/todo-bar)
- **Live plan progress** (kirillvserditov, zycck): Progress bars for plans, with stages, sounds and several tasks side by side. [post](https://x.com/kirillvserditov/status/2105790255144063241) · [repo](https://github.com/zycck/claude-mods)
- **Session and disk monitor** (dominikmartn): Shows what the session is working on and warns when the machine's disk is about to fill. [post](https://x.com/dominikmartn/status/2106044283455406335)
- **Idle-cache compactor** (new_runnable): After 50 idle minutes it compacts once, so the prompt cache does not expire and force a full reprocess of the history. [post](https://x.com/new_runnable/status/2103703876625162546)
- **cache-ttl (prompt)** (kamyker): A ready-made prompt that has Claude build a tiny mod showing how much of the session cache's lifetime is left. [post](https://x.com/kamyker/status/2106024356442735022)
- **Token Weather** (Anthropic): Official example: a forecast of the context window with a sparkline of the last 12 turns. [post](https://x.com/ClaudeDevs/status/2105721436270993609) · [guide](https://claude.dev/blog/getting-started-with-claude-code-mods/)

### While you wait

- **ASCII video player** (edwinarbus): Plays any video, with sound, in the terminal as ASCII art. The most-liked build in the launch thread. [post](https://x.com/edwinarbus/status/2105869772219105325)
- **Tetris** (community (via Boris Cherny)): The first game people shipped, running inside a session. [post](https://x.com/bcherny/status/2099551291601248485)
- **Doom** (original_ngv): Doom playable in the Claude Code terminal. [post](https://x.com/original_ngv/status/2106095077030510900)
- **Chess vs Claude** (dani_avila7): A sidebar board where you play Claude while the session keeps running; each Claude move shows its token cost. [post](https://x.com/dani_avila7/status/2103887582002045065)
- **Code Race** (_nixa_): Race other Claude users typing real code, above the prompt, while Claude does the actual work. [post](https://x.com/_nixa_/status/2106110790428237849)
- **cc-arcade** (sezaakgun): Nine games above the prompt, paused when Claude finishes, plus a pet fed by the tests, commits and edits Claude makes. [repo](https://github.com/sezaakgun/cc-arcade)
- **claude-games** (mohi-devhub): A dodge race, Breakout, a dino runner and a shooter that react to Claude's real edits and commits. [repo](https://github.com/mohi-devhub/claude-games)
- **boss-fight** (OneWave-AI): Failing tests spawn a pixel boss with one hit point per failure; each run that fixes tests lands a hit. [repo](https://github.com/OneWave-AI/claude-code-mods/tree/main/boss-fight)
- **intermission** (jarrodwatts): Doom deathmatch in a separate Ghostty or kitty pane on macOS, returning you to Claude when it needs input. It downloads Odamex and joins a shared server, so its access is wider than most. [repo](https://github.com/jarrodwatts/intermission)
- **Clawd coworker** (SMuntenas): A tiny Clawd beside the thinking line acts out what Claude is doing, with 74 acts. [post](https://x.com/SMuntenas/status/2106038082374078545) · [repo](https://github.com/raresmun/claude-mods)
- **clawd-spinner** (saiharsha03): A scene for each of the 189 spinner words, drawn locally with no model calls or network. [repo](https://github.com/saiharsha03/clawd-spinner)
- **clawdhouse** (ishuagrawal): Makes the Claude mascot a coworker who reads with you and codes alongside. [repo](https://github.com/ishuagrawal/clawdhouse)
- **Max the cat** (KnightHawk1103): A cat companion in the desktop app that taps, runs, waits, waves and celebrates as Claude works. [post](https://x.com/KnightHawk1103/status/2106145564467614093)
- **Mini Clawd** (xNotDanx): A desktop buddy that taps your shoulder when one of your sessions needs you. [post](https://x.com/xNotDanx/status/2105769003490668860)
- **Claude-Fables, pixelband, nibbl** (various): Pixel art and pets above the prompt: a cartoon drawn as you work, seven animated scenes, and a pet that drops a bug when a tool fails and eats it when tests pass. [Claude-Fables](https://github.com/henrik-thevibe/Claude-Fables) · [pixelband](https://github.com/furqan-khan07/pixelband) · [nibbl](https://github.com/nuromirzak/nibbl)
- **Mindful-Claude** (halluton): A guided breathing band while a turn runs; the spinner counts the breath with you. [repo](https://github.com/halluton/Mindful-Claude)
- **German flashcards** (ShahriarBijoy): Flashcards instead of a spinner while Claude works, with words taken from your own code. [post](https://x.com/ShahriarBijoy/status/2106130548498514387)
- **Zen koans** (daniel_mac8): Shows a Zen koan while Claude works. Posted with a /claude-mod-builder skill for building your own. [post](https://x.com/daniel_mac8/status/2099850309807776222)
- **Lumbergh** (vgnshiyer): Brings Office Space's Lumbergh into the session, asking about your TPS reports. [post](https://x.com/vgnshiyer/status/2105812813113643271)
- **Sound art** (teropa): Experiments with the mod sound API. [post](https://x.com/teropa/status/2105746616774803660)
- **Tech news ticker** (CamilleRoux): A news ticker scrolling above the prompt, open source. [post](https://x.com/CamilleRoux/status/2105930786427834511) · [repo](https://github.com/camilleroux/flash-veille)

### Git, PRs and CI

- **cc-pr-tracker** (sezaakgun): Watched pull requests as lines above the prompt with merge state, review and required checks, and a toast when one changes. [repo](https://github.com/sezaakgun/cc-pr-tracker)
- **gh-ci-status** (diegorv): GitHub Actions runs of the session's repo pinned above the prompt, with links to the PR and the run. [repo](https://github.com/diegorv/claude-functions-hook/tree/main/plugins/gh-ci-status)
- **vercel-deploy-status** (ray-amjad): The Vercel deploy queue of the linked project under the prompt, woken by a push or merge. [repo](https://github.com/ray-amjad/awesome-claude-code-function-hooks/tree/main/plugins/vercel-deploy-status)
- **deploy-verify** (yash-gadodia): After a deploy command it checks configured live URLs, waits for the GitHub Actions run and adds the result to the model's context. [repo](https://github.com/yash-gadodia/claude-mods/tree/main/deploy-verify)
- **RemCTL reminders** (viticci): Apple Reminders in Claude Code: what is left today or in a list, with a sidebar. Shipped as an update to an existing CLI. [post](https://x.com/viticci/status/2105785691569533333) · [repo](https://github.com/viticci/remctl)
- **xcode-mods** (artemnovichkov): Xcode build, tests, console and SwiftUI previews inside Claude Code. [repo](https://github.com/artemnovichkov/xcode-mods)

### Safety and privacy

- **Blast Radius** (Anthropic): Official example: catches rm -rf, git reset --hard and force pushes before they run, and shows what they would touch in a side pane. [post](https://x.com/ClaudeDevs/status/2105721437701259338)
- **secret-redactor** (ray-amjad): Swaps secrets, emails and IPs for stable placeholders before the model reads them, and restores them in tool calls. [repo](https://github.com/ray-amjad/awesome-claude-code-function-hooks/tree/main/plugins/secret-redactor)
- **Secret masking** (pratikbin): Masks credentials locally so they never reach the API servers. [post](https://x.com/pratikbin/status/2106088508486271473)
- **honmoon-redact** (pleaseai): Redacts API keys and identifiers from Read, Bash and Grep output before the model sees it. [repo](https://github.com/pleaseai/honmoon/tree/main/packages/claude-plugin)
- **launch-codes** (OneWave-AI): Requires a one-time code and confirmation for risky commands such as a force push or a production deploy. [repo](https://github.com/OneWave-AI/claude-code-mods/tree/main/launch-codes)
- **scope-guard, merge-gate** (yash-gadodia): Tracks edits against a threshold with a model judge, and checks permission before merge commands and pushes to trunk. [scope-guard](https://github.com/yash-gadodia/claude-mods/tree/main/scope-guard) · [merge-gate](https://github.com/yash-gadodia/claude-mods/tree/main/merge-gate)

### Memory and context

- **prompt-rail** (oikon48): A rail of your session's prompts: hover to read, click to jump back. Install with /plugin marketplace add oikon48/prompt-rail. [post](https://x.com/oikon48/status/2105807552005218477) · [repo](https://github.com/oikon48/prompt-rail)
- **Jev Skill Suggestion** (dani_avila7): Keeps skills out of the context window until needed: a router picks the relevant ones for each request. [post](https://x.com/dani_avila7/status/2101885477158547753)
- **lcm** (lossless-claude): Lossless context management: DAG-based summarization that keeps every message reachable. [repo](https://github.com/lossless-claude/lcm)
- **segmem** (mahuebel): Scoped memory in one SQLite file: wakes at session start, recalls on every prompt, nags when stale. [repo](https://github.com/mahuebel/segmem)
- **aside** (JayDoubleu): A read-only side chat in a pane: ask about the session so far and a tool-less fork of the transcript answers. [repo](https://github.com/JayDoubleu/aside)
- **Handoff on /compact** (arasmehe): Part of a set of terminal mods: a live pane with context and limits, files changed, a per-turn timeline, and a handoff file saved on every /compact. [post](https://x.com/arasmehe/status/2105920103045022140)

### Rendering and panes

- **terminal-browser** (zenbu-labs): A browser beside the conversation for websites, local HTML and GitHub pull requests. Featured at the top of the awesome list. [post](https://x.com/karanb192/status/2106024971814469828) · [repo](https://github.com/zenbu-labs/terminal-browser)
- **Browser while you wait** (abhishekray): A browser inside the terminal, built as a mod, to scroll X and Hacker News while an agent runs. [post](https://x.com/abhishekray/status/2105859484283543862)
- **image-viewer** (jarrodwatts): Renders images you paste above the prompt input. [post](https://x.com/jarrodwatts/status/2106153410697564235)
- **claude-mermaid** (galElmalah): Draws every mermaid block Claude writes as colour box art where the fence was. [repo](https://github.com/galElmalah/claude-mermaid)
- **mdview** (xuanji86): Click a markdown path in the conversation to read it rendered in a side pane, and point at a block to have Claude edit it. [repo](https://github.com/xuanji86/claude-mdview)
- **TL;DR panel** (jdorfman): A side pane that summarises the conversation. [post](https://x.com/jdorfman/status/2106080197925859526)
- **Shared sidebar** (KorOglan): One panel for several mods in two layers: status on top, findings below with the newest first. [post](https://x.com/KorOglan/status/2105739377897091139)
- **Replay Theater** (Anthropic): Official example: records every file edit in a turn and steps through the diffs in a docked pane with /replay. [post](https://x.com/ClaudeDevs/status/2105721439206994232)

### Agents and workflows

- **agent-flow** (Charlie0113-T): /flow opens a live tree of the session's subagents and teammates beside the transcript. [repo](https://github.com/Charlie0113-T/claude-agent-flow)
- **agentpane** (xuanji86): A side pane of subagents with each one's current tool call and tokens, its conversation on click, and Stop. Opens when an agent starts and folds when they finish. [repo](https://github.com/xuanji86/claude-agentpane)
- **agent-race** (OneWave-AI): Puts several sessions on one track for the same task and scores tools, edits, tests and cost per lane. [repo](https://github.com/OneWave-AI/claude-code-mods/tree/main/agent-race)
- **AFKSwitch** (augbastos): A one-click presence switch that tells live sessions when you leave and collects their status when you return. [repo](https://github.com/augbastos/afkswitch)
- **next-steps** (pawandeepdhall): After each reply, up to six Haiku-written next steps appear above the prompt; pick some and send a combined prompt. [repo](https://github.com/pawandeepdhall/claude-mods/tree/main/plugins/next-steps)
- **What's Agent Doing** (tzafrir): Explains each step the agent takes, in plain language. Shared on Hacker News. [Show HN](https://news.ycombinator.com/item?id=49934165) · [repo](https://github.com/tzafrir/whats-agent-doing)
- **Multi-harness delegation** (franciscocarloserra): Hands work from Claude Code to other agent harnesses. [HN](https://news.ycombinator.com/item?id=49934033) · [repo](https://github.com/franciscocarloserra/claude-code-multiharness-delegation)
- **claude-autoresearch-mod** (bn-l): A one-to-one port of the pi-autoresearch loop to Claude Code using the mods API. [HN](https://news.ycombinator.com/item?id=49927599) · [repo](https://github.com/bn-l/claude-autoresearch-mod)
- **Jev Model Router** (dani_avila7): Before every turn it asks a router which model should run the subagent and the main thread, through Jev's API or the Vercel AI Gateway. [post](https://x.com/dani_avila7/status/2101176629745561686) · [also](https://x.com/dr_cintas/status/2102153763083432049)
- **URL tracker** (brankopetric00): Shows every URL Claude touches (searches, fetches, curl, browser tabs) live, to check sources. [post](https://x.com/brankopetric00/status/2105759582261760488)
- **Long-task ping** (attacomsian): Pings you when a long task finishes so you stop watching the terminal. [post](https://x.com/attacomsian/status/2105768990274715653)

### Personal workflow

- **mod-scout** (walls_jason1): Reads your last two weeks of sessions and ranks the mods you would actually use; /mod-scout design hands the top three to Claude to spec. [post](https://x.com/walls_jason1/status/2105784023721079113)
- **Position tracker** (nathan_liow): Live crypto positions, token prices and charts without leaving the terminal. [post](https://x.com/nathan_liow/status/2106031981800689898)
- **Supercharged status line** (Ozy311): A much richer status line built with mods (video). [post](https://x.com/Ozy311/status/2105965049269424460)
- **claude-mod-builder, claude-mods-skill** (daniel_mac8, BeLazy167): Skills that teach Claude to build a mod for you, with a working example to copy. [post](https://x.com/daniel_mac8/status/2099850309807776222) · [repo](https://github.com/BeLazy167/claude-mods-skill)
- **roof-mod** (kagamiurayama): Replaces the system prompt and English reminders with your own wording, without touching the binary. [repo](https://github.com/kagamiurayama/claude-code-roof-mod)

## Top posts on X

Likes as X displayed them on 3 October 2026.

| Author | Likes | What it was | Link |
| --- | ---: | --- | --- |
| Boris Cherny (@bcherny) | 2.7K | Mods are landing, and someone already built Tetris in a session. | [post](https://x.com/bcherny/status/2099551291601248485) |
| Daniel San (@dani_avila7) | 1.4K | Jev Model Router: route subagent and main models per request. | [post](https://x.com/dani_avila7/status/2101176629745561686) |
| Jarrod Watts (@jarrodwatts) | 656 | image-viewer: pasted images rendered above the prompt. | [post](https://x.com/jarrodwatts/status/2106153410697564235) |
| Edwin Arbus (@edwinarbus) | 625 | Play any video in the terminal, as ASCII art, with sound. | [post](https://x.com/edwinarbus/status/2105869772219105325) |
| Alvaro Cintas (@dr_cintas) | 443 | Jev model router, shared to a wider audience. | [post](https://x.com/dr_cintas/status/2102153763083432049) |
| Claude Code Log (@ClaudeCodeLog) | 309 | Release notes for 2.1.287, the version that added mods. | [post](https://x.com/ClaudeCodeLog/status/2105721911036481778) |
| Oikon (@oikon48) | 226 | prompt-rail: jump back to earlier prompts. | [post](https://x.com/oikon48/status/2105807552005218477) |
| takahirom (@new_runnable) | 189 | A mod that compacts once before the idle cache expires. | [post](https://x.com/new_runnable/status/2103703876625162546) |
| Federico Viticci (@viticci) | 141 | RemCTL ships a Claude Code mod with a Reminders sidebar. | [post](https://x.com/viticci/status/2105785691569533333) |
| Dan McAteer (@daniel_mac8) | 113 | A koans mod, plus a /claude-mod-builder skill. | [post](https://x.com/daniel_mac8/status/2099850309807776222) |
| Hamza (@ihamzafer) | 90 | See what the agent is reading and writing, live. | [post](https://x.com/ihamzafer/status/2106076435932688427) |
| nixa (@_nixa_) | 69 | Code Race: race other users typing code above the prompt. | [post](https://x.com/_nixa_/status/2106110790428237849) |

## GitHub repos with the most stars

| Repo | Stars | What it is |
| --- | ---: | --- |
| [karanb192/awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods) | 92 | Curated list with a scanner that reports what each mod can read, write or run. |
| [0xDarkMatter/claude-mods](https://github.com/0xDarkMatter/claude-mods) | 46 | Skills, agents, commands, hooks and output styles with session continuity. |
| [karanb192/claude-code-mods](https://github.com/karanb192/claude-code-mods) | 33 | A builder skill and a set of mods. |
| [ucsandman/claude-harness](https://github.com/ucsandman/claude-harness) | 28 | A daily-driver harness published as mods. |
| [oikon48/prompt-rail](https://github.com/oikon48/prompt-rail) | 20 | Prompt rail with hover and click-to-jump. |
| [kagamiurayama/claude-code-roof-mod](https://github.com/kagamiurayama/claude-code-roof-mod) | 17 | Swap the system prompt text without patching the binary. |
| [henrik-thevibe/Claude-Fables](https://github.com/henrik-thevibe/Claude-Fables) | 14 | A cartoon drawn as you work. |
| [HolyGrail/claude-mods](https://github.com/HolyGrail/claude-mods) | 13 | Desktop-friendly mods, including a usage meter. |
| [artemnovichkov/xcode-mods](https://github.com/artemnovichkov/xcode-mods) | 10 | Xcode build, tests and previews in a session. |
| [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) | 9 | Live view of what the agent reads and writes. |
| [zycck/claude-mods](https://github.com/zycck/claude-mods) | 8 | Live plan progress bars above the prompt. |
| [furqan-khan07/pixelband](https://github.com/furqan-khan07/pixelband) | 6 | Animated pixel art above the prompt. |

## Official material

- [Customize Claude Code with mods in TypeScript](https://claude.com/blog/claude-code-mods): The launch post: what a mod is, the events it can hook, stacking, admin controls, and the warning that mods are not sandboxed.
- [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/): Builds Token Weather in about 80 lines, then tours Blast Radius and Replay Theater.
- [Mods overview (docs)](https://code.claude.com/docs/en/plugins/mods/overview): Reference for how plugins may now modify deeper behavior.
- [Function Hooks design thread](https://github.com/anthropics/claude-code/issues/91870): The design discussion with demos and community updates.
- [Anthropic's built-in mods](https://github.com/anthropics/claude-code/tree/main/mods): Source for the diff, security default and telemetry mods, with the test kit.
- [The launch thread on X](https://x.com/ClaudeDevs/status/2105721434807083061): The @ClaudeDevs announcement and its replies, read for this report.
- [Mods directory and scanner](https://mods.aidojo.si/): Search page for the awesome list's scan data.

## Where dev-dash sits

| Tool | Scope | What it does well |
| --- | --- | --- |
| [cctop](https://github.com/tomstagl/cctop) | A btop-style pane docked beside Claude Code | Rule-based advisor with no model calls; metrics registry |
| [flightdeck](https://github.com/scasella/claude-flightdeck) | Agent dashboard with permission verdicts and swimlanes | Strictly read-only; deep subagent and permission view |
| [agentpane / agent-flow](https://github.com/xuanji86/claude-agentpane) | Subagents of the current session | Drill into an agent's conversation, Stop button |
| [cc-pr-tracker / gh-ci-status](https://github.com/sezaakgun/cc-pr-tracker) | PRs and CI as lines above the prompt | Watched pull requests with a toast when one changes |
| [AFKSwitch / agent-race](https://github.com/augbastos/afkswitch) | Several sessions at once | Presence handoff; side-by-side scoring of runs |
| [Anthropic's agent view](https://code.claude.com/docs/en/agent-view) | All sessions grouped by needs input, working, completed | Built in, with one-line status written by a model |

## What to add to dev-dash

Effort: S is a day or two, M about a week, L more.

1. **Cache clock** (effort S, Claude). Show how long until the prompt cache expires per session, and warn before an idle session loses it. _Why:_ One author reports that an hour of idle time forces a full reprocess that eats limits. Two separate posts built fixes, and wavy-usage and cctop show cache figures. _Prior art:_ [compact-before-expiry](https://x.com/new_runnable/status/2103703876625162546) · [cache-ttl prompt](https://x.com/kamyker/status/2106024356442735022) · [cctop](https://github.com/tomstagl/cctop)
2. **Per-turn receipt** (effort M, Connor (item 8)). After each turn: files changed, lines added and removed, commands run and failed. _Why:_ Two authors built nearly the same receipt. It answers the review-load worry directly. _Prior art:_ [receipt (hoobnn)](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/receipt) · [receipt (yash-gadodia)](https://github.com/yash-gadodia/claude-mods/tree/main/receipt)
3. **Plan and todo progress** (effort M, Connor (item 6)). A progress bar per session from its todo list, with the running task's time. _Why:_ Three independent builds; it is the most common status bar after usage. _Prior art:_ [todo-bar](https://github.com/hoobnn/hoobnn-agent-mods/tree/main/claude-code/todo-bar) · [plan bars](https://github.com/zycck/claude-mods) · [post](https://x.com/kirillvserditov/status/2105790255144063241)
4. **Sources feed** (effort M, Connor (item 7)). URLs that sessions and agents searched or fetched, newest first. _Why:_ Checking where an answer came from drew 31 likes on a single post and fits the Agents section. _Prior art:_ [URL tracker](https://x.com/brankopetric00/status/2105759582261760488)
5. **Rule-based advisor** (effort M, Claude). A small set of fixed rules with no model calls, such as cache about to expire, context past 80%, the same command failing, a long-idle waiting session. _Why:_ cctop and flightdeck both lead with an advisor, and cctop does it with fixed rules, so it costs nothing to run. _Prior art:_ [cctop](https://github.com/tomstagl/cctop) · [flightdeck](https://github.com/scasella/claude-flightdeck)
6. **Get discovered, show the footprint** (effort S, Claude). Add the claude-code-mod topic so the awesome list's nightly scan finds dev-dash, then open a PR to be listed. Keep the reads-and-writes section current. _Why:_ The list scans GitHub for that topic and publishes what each mod can reach. Several posts asked for exactly that before installing. _Prior art:_ [awesome list](https://github.com/karanb192/awesome-claude-code-mods) · [what it touches](https://x.com/kabelsalat_info/status/2105731634062561713)
7. **Agent drill-down** (effort L, Later). Click an agent to read its conversation in place, with a Stop button. _Why:_ agentpane does this; today dev-dash shows only the latest step. _Prior art:_ [agentpane](https://github.com/xuanji86/claude-agentpane) · [agent-flow](https://github.com/Charlie0113-T/claude-agent-flow)
8. **Session recap card** (effort M, Later). /wrapped-style summary of the day across sessions, with a shareable image. _Why:_ A shareable image suits how mods get shown off. session-wrapped is the one example found. _Prior art:_ [session-wrapped](https://github.com/OneWave-AI/claude-code-mods/tree/main/session-wrapped)
9. **Handoff on /compact** (effort S, Later). Write a short handoff note whenever a session compacts. _Why:_ One of the mod sets in the thread does this; it pairs with the context warnings dev-dash already has. _Prior art:_ [post](https://x.com/arasmehe/status/2105920103045022140)
10. **Optional mascot** (effort S, Later). A small character whose mood follows the overall status, off by default. _Why:_ 'While you wait' is the biggest category in the catalogue below, and mascots and pets are much of it. They draw attention, but on a work tool they should stay optional. _Prior art:_ [Clawd coworker](https://x.com/SMuntenas/status/2106038082374078545) · [Mini Clawd](https://x.com/xNotDanx/status/2105769003490668860)
11. **Check the desktop app** (effort S, Claude). Run dev-dash in the Claude desktop app, where mods can draw richer panels, and fix whatever looks off. _Why:_ Several mods are desktop-first, and usage-meter and Max the cat run only there. _Prior art:_ [usage-meter](https://x.com/HolyGrail/status/2105773955626004973) · [Max the cat](https://x.com/KnightHawk1103/status/2106145564467614093)

## Method and limits

- **X:** Read in your Chrome. The launch thread had 625 replies; X loaded about 310, plus 75 quote posts and about 70 search results. Like counts are what X showed on October 3.
- **Reddit:** Not covered. The browser tool and the web search tool both refused Reddit, so no Reddit threads are in this report.
- **GitHub:** Searched with the GitHub API (stars as of October 3) and read the awesome list's README. Repos are listed, not inspected.
- **Hacker News:** Searched through HN's public search API; three relevant builds, all with few points.
- **Anthropic:** Read the launch post and the getting-started guide.
- **What I did not do:** I did not install or run any mod. Descriptions are the authors' own, paraphrased, and a few rely on the awesome list's summary of a mod's access.
