# What people built with Claude Code mods

Source: the @ClaudeDevs launch post, https://x.com/ClaudeDevs/status/2105721434807083061 (Oct 1, 2026), its replies, and its quote posts. Read on Oct 3, 2026.

**Coverage:** X loaded 312 of the post's 625 replies and 75 quote posts. Each list below is what was in those. Descriptions come from the authors' own post text, plus a few screenshots I looked at. I didn't watch videos or install anything. Repo links are as X displays them (sometimes cut short); I haven't checked that the repos exist or what they contain.

> **Safety note from the thread:** one reply ([ahmetmertugrul](https://x.com/ahmetmertugrul/status/2106019619139903724)) warns about an account impersonating @ClaudeDevs and pointing to a fake site. Anthropic's own thread says mods run with Claude Code's full access to your machine, so install only from sources you trust ([ClaudeDevs](https://x.com/ClaudeDevs/status/2105721440490361312)).

## 1. Everything people showed off

### Anthropic's own examples
| Mod | What it does | Link |
| --- | --- | --- |
| Token Weather | Forecast of how full the context window is, plus a sparkline of the last 12 turns | [post](https://x.com/ClaudeDevs/status/2105721436270993609) |
| Blast Radius | Catches risky shell commands (`rm -rf`, `git reset --hard`, force push) before they run; shows what they'd touch in a side pane | [post](https://x.com/ClaudeDevs/status/2105721437701259338) |
| Replay Theater | Records every file edit in a turn; `/replay` steps through the diffs in a docked pane | [post](https://x.com/ClaudeDevs/status/2105721439206994232) |
| /diff and AGENTS.md support | Built-in Claude Code features that are themselves mods | [post](https://x.com/ClaudeDevs/status/2105721442826686614) |

### Monitoring and status
| Mod | What it does | Link |
| --- | --- | --- |
| usage-weather | Usage as a weather forecast: context from sunny to stormy, 5h and weekly limits with reset times, cost and cache hit rate. Sits above the prompt; CLI and desktop | [post](https://x.com/AndersonD89/status/2105795831135883358) · github.com/AndersonDavi/claude-mods |
| usage-meter | Usage meter shown in the desktop app | [post](https://x.com/HolyGrail/status/2105773955626004973) · github.com/HolyGrail/claude-mods (plugins/usage-meter) |
| Session + disk monitor | Shows what the session is working on and warns when the machine's disk is nearly full | [post](https://x.com/dominikmartn/status/2106044283455406335) |
| Live plan progress bar | Progress bar for plans, with stages, sounds and several tasks side by side | [post](https://x.com/kirillvserditov/status/2105790255144063241) |
| Usage + agent progress | Tracks usage allowance and progress reported by agents (screenshot) | [post](https://x.com/dev_lecarvalho/status/2106139107483320761) |
| Supercharged status line | A much richer status line (video) | [post](https://x.com/Ozy311/status/2105965049269424460) |
| URL tracker | Shows every URL Claude touches (searches, fetches, curl, browser tabs) live, to check sources | [post](https://x.com/brankopetric00/status/2105759582261760488) |
| Sidebar | One shared panel for mods, two layers: status on top, findings below, newest first, oldest drops off | [post](https://x.com/KorOglan/status/2105739377897091139) |
| TL;DR panel | A side pane summarising the conversation | [post](https://x.com/jdorfman/status/2106080197925859526) |
| Tech news ticker | A news ticker scrolling above the prompt | [post](https://x.com/CamilleRoux/status/2105930786427834511) · github.com/camilleroux/flash-veille |

### Notifications
| Mod | What it does | Link |
| --- | --- | --- |
| Mini Clawd | A desktop buddy that taps your shoulder when a session needs you | [post](https://x.com/xNotDanx/status/2105769003490668860) |
| Long-task ping | Pings you when a long task finishes, so you stop watching the terminal | [post](https://x.com/attacomsian/status/2105768990274715653) |

### Workflow
| Mod | What it does | Link |
| --- | --- | --- |
| prompt-rail | Jump back to earlier prompts in the conversation (`/plugin marketplace add oikon48/prompt-rail`) | [post](https://x.com/oikon48/status/2105807552005218477) · [reply](https://x.com/oikon48/status/2105803503570747836) |
| md-prompt | A Markdown prompt mod (screenshot only) | [post](https://x.com/_nogu66/status/2106204998023708721) |
| Secret masking | Replaces secrets with look-alike strings locally, so credentials never reach the API | [post](https://x.com/pratikbin/status/2106088508486271473) |
| RemCTL reminders | Apple Reminders in Claude Code, including a sidebar of what's left today | [post](https://x.com/viticci/status/2105785691569533333) · github.com/viticci/remctl |
| terminal-browser (zenbu-labs) | Browse the web, e.g. a GitHub PR, inside Claude Code | [post](https://x.com/karanb192/status/2106024971814469828) |
| Video into frames | Turns a video into frames (linked post) | [post](https://x.com/Ya0ooo/status/2106075317060423996) |
| Position tracker | Live crypto positions, token prices and charts | [post](https://x.com/nathan_liow/status/2106031981800689898) |

### Fun
| Mod | What it does | Link |
| --- | --- | --- |
| Clawd coworker | A tiny Clawd next to the thinking line acts out what Claude does (74 acts) | [post](https://x.com/SMuntenas/status/2106038082374078545) · github.com/raresmun/claude-mods |
| Max the cat | Cat companion that taps its paw, runs, waits, waves and celebrates as Claude works | [post](https://x.com/KnightHawk1103/status/2106145564467614093) |
| German flashcards | Flashcards instead of a spinner while Claude works, words from your own code | [post](https://x.com/ShahriarBijoy/status/2106130548498514387) |
| Lumbergh | Office Space's Lumbergh asks about your TPS reports | [post](https://x.com/vgnshiyer/status/2105812813113643271) |
| Doom | Play Doom in the Claude Code terminal | [post](https://x.com/original_ngv/status/2106095077030510900) |
| Sound art | Experiments with the mod sound API | [post](https://x.com/teropa/status/2105746616774803660) |

### Resources
| What | Link |
| --- | --- |
| Community list of mods (awesome-claude-code-mods) | [post](https://x.com/karanb192/status/2106024971814469828) · github.com/karanb192/awesome-claude-code-mods |
| Map of every place a mod can draw in the UI | [post](https://x.com/_nixa_/status/2105747351524528202) |
| Getting-started guide (Addy Osmani) | [post](https://x.com/addyosmani/status/2105908136154673323) |
| Korean translation of the guide, 23 pages | [post](https://x.com/lucas_flatwhite/status/2106018176010211773) |

### Wishes and feedback worth noting
| Request | Link |
| --- | --- |
| A team token-usage pane ("we track this with a script today") | [post](https://x.com/oleksiypodolian/status/2105748459051471146) |
| Before installing a mod: a clear list of what it touches | [post](https://x.com/kabelsalat_info/status/2105731634062561713) |
| Fewer panels: show nothing unless it's clearly useful | [post](https://x.com/weirdlyai/status/2105963485179834390) |
| A marketplace or community hub for mods | [post](https://x.com/ido_vadavker/status/2106029958996938847) |
| Publish the type declarations as an npm package | [post](https://x.com/mary_ext/status/2105814643151438271) |

## 2. What dev-dash should take from this

✅ = already in dev-dash. 

### Features
| # | Idea | Inspired by | dev-dash today | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Status band above the prompt**: one line ("◆ 2 need you · 5h 62% · 3 agents") that's always visible, even with the pane closed | news ticker, usage-weather | — | S |
| 2 | **Per-turn context sparkline** and **cache hit rate** next to the limit bars | Token Weather, usage-weather | limits ✅, context % ✅ | S |
| 3 | **Sound and notification for "needs you"**, and for long tasks finishing (e.g. over 5 min) | Mini Clawd, long-task ping, sound API | toasts ✅ | S |
| 4 | **Risky command alerts** across sessions (`rm -rf`, force push, `reset --hard`) in Attention | Blast Radius | — | S |
| 5 | **Plan and todo progress** per session: stage bar from the session's todo list | live plan progress bar | — | M |
| 6 | **Sources feed**: URLs sessions and agents fetched or searched, newest first | URL tracker | agents' latest step ✅ | M |
| 7 | **Changes per session**: files each session edited this turn, with +/− counts | Replay Theater | uncommitted lines ✅ | M |
| 8 | **Machine health**: disk space, with a warning when it's low | session + disk monitor | — | S |
| 9 | **One-line session summary** ("what is it doing?"), opt-in since it costs tokens | TL;DR panel, agent view | latest step for agents ✅ | M |
| 10 | **Team usage view**: teammates' cost and limits in one place (needs a shared store) | team token-usage wish | — | L |

### Interface
| # | Idea | Inspired by |
| --- | --- | --- |
| 11 | Two layers: status at the top, findings flowing below, newest first, oldest dropping off. dev-dash's header and event feed already work this way; keep it | sidebar |
| 12 | Weather metaphor for health (☀ → ⛈) as an optional, friendlier header than raw percentages | usage-weather, Token Weather |
| 13 | An optional mascot whose mood reflects overall status (calm, busy, needs you) | Clawd coworker, Max the cat |
| 14 | Show nothing when there's nothing to say: collapse quiet sections automatically | "fewer panels" feedback |
| 15 | Make sure it renders well in the desktop app too, not just the terminal | usage-meter in desktop |

### Trust
| # | Idea | Inspired by |
| --- | --- | --- |
| 16 | A "What dev-dash reads" section in the README and a `/dash-about` command listing every file and command it touches | "what it touches" feedback, impersonation warning |
| 17 | List it in the awesome-claude-code-mods list and the Claude directory | community list, ClaudeDevs |
