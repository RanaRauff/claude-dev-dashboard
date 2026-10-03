// dev-dash: the Pane's drawing. A drop-in for register.tsx's `ui.render` hook.
//
// Wiring (see design.md, "Dropping it in"):
//   import { registerDashPane, pushActivity, activity } from './render'
//   registerDashPane(on, { onHide: () => { ctx.isOpen = false } })   // replaces the old on('ui.render', ...)
//   // optional, feeds the header sparkline; outside any render hook:
//   await update($, activity, h => pushActivity(h, sessions))
//
// Only elements from `$.ui.resolve(e)` (Box, Text, Button), JSX on `h`, no DOM/Node.
// Width comes from the Pane's `e.props.bodyColumns` (the box inside the frame),
// then `e.viewport.columns`, then 60.

import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { AgentRow, AgentState, CiState, DashSection, DiskRow, EventRow, LimitRow, PrRow, SessionRow, SessionState, Snapshot } from '../types'
import { attentionOf, isLimitAtRisk, itemsOf } from './attention'
import { HELP_KEYS, actionsFor, dismissAdd, ids, itemById, snoozeAdd } from './keys'
import type { Item, Muting, RowAction } from './keys'
import { bytes, isDiskLow } from './monitor'
import { progressSections } from './progress-view'

export const PANE = 'dev-dash'

export const snap = atom({ plugin: 'dev-dash', key: 'snap' } as const, null)
export const collapsed = atom({ plugin: 'dev-dash', key: 'collapsed' } as const, [])
export const activity = atom({ plugin: 'dev-dash', key: 'activity' } as const, [])
export const openRow = atom({ plugin: 'dev-dash', key: 'openRow' } as const, '')
export const snoozed = atom({ plugin: 'dev-dash', key: 'snoozed' } as const, {})
export const dismissed = atom({ plugin: 'dev-dash', key: 'dismissed' } as const, [])
export const showHelp = atom({ plugin: 'dev-dash', key: 'help' } as const, false)

// ---------------------------------------------------------------------------
// Palette: semantic roles on the 8 ANSI names, which every terminal theme
// (dark or light) remaps to readable values. No hex: a fixed hex that reads on
// black can vanish on white. Swap the right-hand side to retheme.
// ---------------------------------------------------------------------------
export const TONE = {
  ok: 'green',
  warn: 'yellow',
  bad: 'red',
  info: 'cyan',
  accent: 'magenta',
  mute: 'gray',
} as const

const STATE_TONE: Record<SessionState, string> = { running: TONE.ok, waiting: TONE.warn, idle: TONE.mute, ended: TONE.mute }
const STATE_BADGE: Record<SessionState, string> = { running: ' RUN  ', waiting: ' WAIT ', idle: ' IDLE ', ended: ' END  ' }

// ---------------------------------------------------------------------------
// Pure helpers (no $, safe to unit test)
// ---------------------------------------------------------------------------
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const pad2 = (n: number) => String(n).padStart(2, '0')

/** Cut to at most `n` cells with a trailing ellipsis. */
export const cut = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

/** Compact age: 42s, 7m, 3h05, 2d. */
export const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h${pad2(Math.floor((s % 3600) / 60))}`
  return `${Math.floor(s / 86400)}d`
}

export const money = (n: number) => `$${n.toFixed(2)}`

/** Segmented meter: bar(62, 5) === '▰▰▰▱▱'. */
export const bar = (pct: number, cells: number) => {
  const on = Math.round((clamp(pct, 0, 100) / 100) * cells)
  return '▰'.repeat(on) + '▱'.repeat(Math.max(0, cells - on))
}

const SPARK = '▁▂▃▄▅▆▇█'
/** Last `width` samples as block glyphs, scaled to the window's max (min scale 1). */
export const sparkline = (values: readonly number[], width: number) => {
  const v = values.slice(-Math.max(0, width))
  if (v.length === 0) return ''
  const max = Math.max(1, ...v)
  return v.map(x => SPARK[clamp(Math.round((x / max) * 7), 0, 7)]).join('')
}

/** One activity sample per tick: sessions that are running or waiting. Keeps the last `keep`. */
export const pushActivity = (history: readonly number[] | undefined, sessions: readonly SessionRow[], keep = 48) =>
  [...(history ?? []), sessions.filter(r => r.state === 'running' || r.state === 'waiting').length].slice(-keep)

export const ctxTone = (pct: number) => (pct >= 80 ? TONE.bad : pct >= 60 ? TONE.warn : TONE.ok)

/** Responsive metrics for a body `cols` wide. Narrow below 60. */
export const layoutFor = (cols: number | undefined) => {
  const W = clamp(Math.floor(cols ?? 60), 30, 140)
  const isNarrow = W < 60
  return {
    W,
    isNarrow,
    barCells: isNarrow ? 5 : 10,
    sparkCells: clamp(W - 26, 8, 32),
    branchRows: isNarrow ? 4 : 6,
    sessionRows: isNarrow ? 6 : 10,
  }
}

const where = (r: SessionRow) => (r.branch ? `${r.repo}@${r.branch}` : r.repo)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const toggle = (list: readonly DashSection[] | undefined, id: DashSection) =>
  (list ?? []).includes(id) ? (list ?? []).filter(x => x !== id) : [...(list ?? []), id]

// ---------------------------------------------------------------------------
// Monitoring helpers
// ---------------------------------------------------------------------------
export const limitTone = (l: LimitRow, now: number) =>
  l.pct >= 90 || isLimitAtRisk(l, now) ? TONE.bad : l.pct >= 70 ? TONE.warn : TONE.ok

export const limitNote = (l: LimitRow, now: number) => {
  const resets = l.resetsAt !== null ? `resets in ${ago(l.resetsAt - now)}` : ''
  if (isLimitAtRisk(l, now)) return `out in ~${ago(l.etaMs ?? 0)} at this pace${resets ? ` · ${resets}` : ''}`
  return resets || 'no reset time'
}

const AGENT_LOOK: Record<AgentState, { glyph: string; tone: string; word: string }> = {
  working: { glyph: '◐', tone: TONE.ok, word: 'working' },
  quiet: { glyph: '◌', tone: TONE.warn, word: 'quiet' },
  done: { glyph: '✓', tone: TONE.mute, word: 'done' },
  stopped: { glyph: '■', tone: TONE.mute, word: 'stopped' },
}

/** A spinner frame for working agents, advancing every sync. */
const SPIN = '◐◓◑◒'
export const spinFrame = (at: number) => SPIN[Math.floor(at / 5000) % SPIN.length]

const EVENT_TONE: Record<EventRow['tone'], string> = { ok: TONE.ok, warn: TONE.warn, bad: TONE.bad, info: TONE.info }
const EVENT_GLYPH: Record<EventRow['tone'], string> = { ok: '✓', warn: '◆', bad: '✗', info: '·' }

export const clockOf = (at: number) => {
  const d = new Date(at)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const CI: Record<CiState, { glyph: string; tone: string; inverse: boolean }> = {
  failing: { glyph: ' ✗ CI ', tone: TONE.bad, inverse: true },
  pending: { glyph: '◌ CI', tone: TONE.warn, inverse: false },
  passing: { glyph: '✓ CI', tone: TONE.ok, inverse: false },
  none: { glyph: '· no CI', tone: TONE.mute, inverse: false },
}

const reviewChip = (p: PrRow): { text: string; tone: string } => {
  if (p.review === 'approved') return { text: '✓ approved', tone: TONE.ok }
  if (p.review.startsWith('changes')) return { text: '± changes', tone: TONE.bad }
  if (p.review.includes('required')) return { text: '… review', tone: TONE.warn }
  return { text: 'no review', tone: TONE.mute }
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------
export function registerDashPane(on: On, hooks: { onHide?: () => void } = {}) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const folded = (await read($, collapsed)) ?? []
    const samples = (await read($, activity)) ?? []
    const L = layoutFor(e.props.bodyColumns ?? (e.viewport ? e.viewport.columns - 2 : undefined))
    const { W, isNarrow } = L
    const now = Date.now()
    const muting: Muting = {
      snoozed: (await read($, snoozed)) ?? {},
      dismissed: (await read($, dismissed)) ?? [],
      now,
    }
    const opened = (await read($, openRow)) || ''
    const isHelpOn = (await read($, showHelp)) === true

    const rule = (used: number) => '─'.repeat(clamp(W - used, 0, W))

    // A section heading: `1: ▾ Title ─────────`, or, folded, `1: ▸ Title  summary`.
    // The plain Button with a hotkey is the fold control (pressable while the pane holds the keys).
    const Heading = (p: { id: DashSection; hotkey: string; title: string; tone?: string; summary: string }) => {
      const isOpen = !folded.includes(p.id)
      return (
        <Box flexDirection="row" marginTop={1}>
          <Button
            key={`fold-${p.id}`}
            plain
            hotkey={p.hotkey}
            label={isOpen ? '▾' : '▸'}
            onPress={() => update($, collapsed, list => toggle(list, p.id))}
          />
          <Text bold color={p.tone}> {p.title} </Text>
          {isOpen ? (
            <Text dimColor wrap="truncate-end">{rule(p.title.length + 6)}</Text>
          ) : (
            <Text dimColor wrap="truncate-end">{cut(p.summary, W - p.title.length - 7)}</Text>
          )}
        </Box>
      )
    }

    // What the buttons under an opened row do. (The row's own press only opens or closes them.)
    const undo = async () => {
      await update($, snoozed, () => ({}))
      await update($, dismissed, () => [])
      return $.ui.toast('Brought back what you snoozed or dismissed')
    }
    const runAction = async (action: RowAction['id'], it: Item) => {
      await update($, openRow, () => '')
      if (action === 'copy') {
        const r = await $.ui.copy({ text: it.copy, surface: e.surface })
        return $.ui.toast(r.isCopied ? `Copied the ${it.what}` : 'Could not copy to the clipboard')
      }
      if (action === 'snooze') {
        await update($, snoozed, m => snoozeAdd(m ?? {}, it.id, Date.now()))
        return $.ui.toast('Snoozed for 15 minutes')
      }
      await update($, dismissed, d => dismissAdd(d ?? [], it.id))
      return $.ui.toast('Dismissed until it changes')
    }

    // A selectable row. Its marker is a stop for Tab and the arrow keys; Enter on it opens or closes the row's
    // actions, which are buttons right under it. The first marker takes the focus ring when the pane gets the keyboard.
    const Row = (p: { id: string; children?: unknown }) => {
      const it = itemById(items, p.id)
      const isOpen = p.id === opened
      return (
        <Box key={`row-${p.id}`} flexDirection="column">
          <Box flexDirection="row">
            <Button
              key={`pick-${p.id}`}
              plain
              dimColor
              autoFocus={p.id === items[0]?.id ? true : undefined}
              label={isOpen ? '▾' : '›'}
              onPress={() => update($, openRow, v => (v === p.id ? '' : p.id))}
            />
            <Text> </Text>
            <Box flexDirection="column" flexGrow={1}>{p.children}</Box>
          </Box>
          {isOpen && it && (
            <Box paddingLeft={2} flexDirection="row" flexWrap="wrap" columnGap={1}>
              {actionsFor(it).map(a => (
                <Button key={`act-${a.id}-${p.id}`} label={a.label} onPress={() => runAction(a.id, it)} />
              ))}
            </Box>
          )}
        </Box>
      )
    }

    if (!s) {
      return (
        <Box flexDirection="column">
          <Box borderStyle="round" borderColor={TONE.mute} paddingX={1} width={W}>
            <Text dimColor>Collecting… first sync takes a few seconds</Text>
          </Box>
        </Box>
      )
    }

    const att = attentionOf(s, muting)
    const caps = { reviews: isNarrow ? 3 : 5, sessions: L.sessionRows, agents: isNarrow ? 4 : 8 }
    const items = itemsOf(s, att, folded, caps)
    const g = s.git
    const costs = s.sessions.map(r => r.costUsd).filter((c): c is number => c !== null)
    const cost = costs.length ? costs.reduce((a, b) => a + b, 0) : null
    const live = s.sessions.filter(r => r.state === 'running').length
    const headTone = att.urgent > 0 ? TONE.warn : att.total > 0 ? TONE.info : TONE.ok
    const agents = s.agents ?? []
    const busyAgents = agents.filter(a => a.state === 'working' || a.state === 'quiet')
    const limits = s.limits ?? []
    const spark = sparkline(samples, L.sparkCells)

    // ---- header card ------------------------------------------------------
    const header = (
      <Box borderStyle="round" borderColor={headTone} paddingX={1} flexDirection="column" width={W}>
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold color={headTone}>{att.total > 0 ? `◆ ${att.total} need${att.total === 1 ? 's' : ''} you` : '✓ all clear'}</Text>
          <Text dimColor> · {plural(s.sessions.length, isNarrow ? 'sess' : 'session', isNarrow ? 'sess' : 'sessions')}</Text>
          {live > 0 && <Text color={TONE.ok}> · {live} live</Text>}
          {busyAgents.length > 0 && (
            <Text color={TONE.accent}> · {plural(busyAgents.length, 'agent')}</Text>
          )}
          {cost !== null && <Text dimColor> · {money(cost)}</Text>}
        </Box>
        {limits.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {limits.map(l => (
              <Text color={limitTone(l, now)}>
                {l.kind} {bar(l.pct, isNarrow ? 5 : 8)} {Math.round(l.pct)}%
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="row">
          {spark && <Text color={TONE.info}>{spark} </Text>}
          <Text dimColor wrap="truncate-end">{spark ? 'activity · ' : ''}synced {ago(now - s.updatedAt)} ago</Text>
        </Box>
      </Box>
    )

    // ---- Attention ----------------------------------------------------------
    const attention = (
      <Box flexDirection="column">
        <Heading
          id="attention"
          hotkey="1"
          title={att.total > 0 ? `Attention (${att.total})` : 'Attention'}
          tone={att.total > 0 ? headTone : TONE.ok}
          summary={
            att.total > 0
              ? [
                  att.waiting.length ? `${att.waiting.length} waiting` : '',
                  att.stuck.length ? `${att.stuck.length} stuck` : '',
                  att.risky.length ? `${att.risky.length} risky` : '',
                  att.disks.length ? 'disk' : '',
                  att.collisions.length ? `${att.collisions.length} clash` : '',
                  att.limits.length ? 'limit' : '',
                  att.failing.length ? `${att.failing.length} failing` : '',
                  att.reviews.length ? `${att.reviews.length} review` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'all clear'
          }
        />
        {!folded.includes('attention') && (
          <Box flexDirection="column" paddingLeft={2}>
            {att.total === 0 && <Text color={TONE.ok}>✓ Nothing needs you.</Text>}
            {att.total === 0 && (
              <Text dimColor wrap="truncate-end">
                {s.sessions.length === 0 ? 'No live sessions.' : `${plural(live, 'session')} working, the rest idle.`}
              </Text>
            )}
            {att.waiting.map(r => (
              <Row id={ids.wait(r)}>
                <Text color={TONE.warn} wrap="truncate-end">
                  ◆ {cut(r.name || where(r), W - 22)} · {r.waitingFor || 'waiting'} {ago(now - r.stateSince)}
                </Text>
              </Row>
            ))}
            {att.stuck.map(r => (
              <Row id={ids.stuck(r)}>
                <Text color={TONE.bad} wrap="truncate-end">
                  ⟳ {cut(r.name || where(r), W - 30)} may be stuck · {r.stuck}
                </Text>
              </Row>
            ))}
            {att.risky.map(r => (
              <Row id={ids.risky(r)}>
                <Text color={TONE.bad} wrap="truncate-end">
                  ⚡ {cut(r.name || where(r), W - 30)} ran {r.risky}
                </Text>
              </Row>
            ))}
            {att.disks.map(d => (
              <Row id={ids.disk(d)}>
                <Text color={TONE.bad} wrap="truncate-end">
                  ▼ disk {d.name} low · {bytes(d.freeBytes)} free of {bytes(d.totalBytes)}
                </Text>
              </Row>
            ))}
            {att.collisions.map(c => (
              <Row id={ids.clash(c.file)}>
                <Text color={TONE.bad} wrap="truncate-end">
                  ⚠ {cut(c.file.split('/').pop() ?? c.file, 28)} edited by {c.sessions.join(' + ')}
                </Text>
              </Row>
            ))}
            {att.limits.map(l => (
              <Row id={ids.limit(l)}>
                <Text color={TONE.bad} wrap="truncate-end">
                  ▲ {l.kind} limit {Math.round(l.pct)}% · {limitNote(l, now)}
                </Text>
              </Row>
            ))}
            {att.failing.map(p => (
              <Row id={ids.ci(p)}>
                <Text color={TONE.bad} wrap="truncate-end">
                  ✗ #{p.number} {p.conflicts ? 'conflicts' : 'CI failing'} · {p.repo ? `${p.repo} · ` : ''}{cut(p.title, W - 26 - p.repo.length)}
                </Text>
              </Row>
            ))}
            {att.reviews.slice(0, caps.reviews).map(p => (
              <Row id={ids.review(p)}>
                <Text color={TONE.info} wrap="truncate-end">
                  ◎ review #{p.number} @{p.author} · {p.repo ? `${p.repo} · ` : ''}{p.ageDays}d · {cut(p.title, W - 32 - p.author.length - p.repo.length)}
                </Text>
              </Row>
            ))}
            {att.reviews.length > caps.reviews && (
              <Text dimColor>+{att.reviews.length - caps.reviews} more reviews</Text>
            )}
            {att.hidden > 0 && (
              <Box flexDirection="row" columnGap={1}>
                <Text dimColor>+{att.hidden} snoozed or dismissed</Text>
                <Button key="act-undo" label="bring back" onPress={undo} />
              </Box>
            )}
          </Box>
        )}
      </Box>
    )

    // ---- Sessions -------------------------------------------------------------
    const sessionRow = (r: SessionRow) => {
      const isSelf = r.id === s.selfId
      const label = r.name || where(r)
      const head = `${cut(label, W - 26)}${isSelf ? ' (this)' : ''} · ${r.state === 'waiting' && r.waitingFor ? r.waitingFor : r.state} ${ago(now - r.stateSince)}`
      const up = `up ${ago(now - r.startedAt)}`
      const usage = [r.contextPct !== null ? `ctx ${Math.round(r.contextPct)}%` : '', r.costUsd !== null ? money(r.costUsd) : '', r.lastTool]
      const who = [r.name ? where(r) : '', r.app, r.hasPlugin ? '' : 'no plugin', up]
      const join = (xs: string[]) => xs.filter(Boolean).join(' · ')
      const hasCtx = r.contextPct !== null
      return (
        <Row id={ids.session(r)}>
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text inverse color={STATE_TONE[r.state]}>{STATE_BADGE[r.state]}</Text>
            <Text bold={isSelf} wrap="truncate-end"> {head}</Text>
          </Box>
          {r.summary && (
            <Box paddingLeft={7}>
              <Text color={TONE.info} wrap="truncate-end">↳ {cut(r.summary, W - 10)}</Text>
            </Box>
          )}
          {hasCtx ? (
            <Box flexDirection="row" paddingLeft={7}>
              <Text color={ctxTone(r.contextPct ?? 0)}>{bar(r.contextPct ?? 0, L.barCells)} </Text>
              <Text dimColor wrap="truncate-end">{join(isNarrow ? usage : [...usage, ...who])}</Text>
              {(r.contextPct ?? 0) >= 80 && <Text color={TONE.bad}> compact soon</Text>}
            </Box>
          ) : (
            <Box paddingLeft={7}>
              <Text dimColor wrap="truncate-end">{join([...who, ...usage])}</Text>
            </Box>
          )}
          {hasCtx && isNarrow && (
            <Box paddingLeft={7}>
              <Text dimColor wrap="truncate-end">{join(who)}</Text>
            </Box>
          )}
        </Box>
        </Row>
      )
    }
    const sessions = (
      <Box flexDirection="column">
        <Heading
          id="sessions"
          hotkey="2"
          title={`Sessions (${s.sessions.length})`}
          summary={`${live} running · ${att.waiting.length} waiting${cost !== null ? ` · ${money(cost)}` : ''}`}
        />
        {!folded.includes('sessions') && (
          <Box flexDirection="column" paddingLeft={2}>
            {s.sessions.length === 0 && <Text dimColor>No live Claude sessions.</Text>}
            {s.sessions.length > 0 && !s.summariesOn && !s.sessions.some(r => r.summary) && (
              <Text dimColor wrap="truncate-end">/dash-summaries on adds a one-line "doing" per session</Text>
            )}
            {s.sessions.slice(0, L.sessionRows).map(sessionRow)}
            {s.sessions.length > L.sessionRows && <Text dimColor>+{s.sessions.length - L.sessionRows} more</Text>}
          </Box>
        )}
      </Box>
    )

    // ---- Agents -------------------------------------------------------------------
    const agentRow = (a: AgentRow) => {
      const look = AGENT_LOOK[a.state]
      const isLive = a.state === 'working'
      const age = isLive || a.state === 'quiet' ? `${ago(now - a.startedAt)}` : `${ago(now - a.lastActive)} ago`
      return (
        <Row id={ids.agent(a)}>
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text color={look.tone} bold={isLive}>{isLive ? spinFrame(now) : look.glyph} </Text>
            <Text bold={isLive} dimColor={!isLive && a.state !== 'quiet'} wrap="truncate-end">
              {cut(a.description, W - 22)}
            </Text>
            <Text dimColor> · {look.word} {age}</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text dimColor wrap="truncate-end">
              {[a.type, a.sessionName, a.steps ? plural(a.steps, 'step') : ''].filter(Boolean).join(' · ')}
            </Text>
          </Box>
          {a.doing && (isLive || a.state === 'quiet') && (
            <Box paddingLeft={2}>
              <Text color={TONE.info} wrap="truncate-end">↳ {cut(a.doing, W - 6)}</Text>
            </Box>
          )}
        </Box>
        </Row>
      )
    }
    const agentRows = caps.agents
    const agentsSection = (
      <Box flexDirection="column">
        <Heading
          id="agents"
          hotkey="3"
          title={`Agents (${agents.length})`}
          tone={busyAgents.length > 0 ? TONE.accent : undefined}
          summary={`${busyAgents.length} working · ${agents.length - busyAgents.length} recent`}
        />
        {!folded.includes('agents') && (
          <Box flexDirection="column" paddingLeft={2}>
            {agents.length === 0 && <Text dimColor>No subagents in the last 30 minutes.</Text>}
            {agents.slice(0, agentRows).map(agentRow)}
            {agents.length > agentRows && <Text dimColor>+{agents.length - agentRows} more</Text>}
          </Box>
        )}
      </Box>
    )

    // ---- Monitor ------------------------------------------------------------------
    const withCtx = s.sessions.filter(r => r.contextPct !== null)
    const events = (s.events ?? []).slice(0, isNarrow ? 5 : 8)
    const monitor = (
      <Box flexDirection="column">
        <Heading
          id="monitor"
          hotkey="4"
          title="Monitor"
          tone={att.limits.length > 0 ? TONE.bad : undefined}
          summary={[
            ...limits.map(l => `${l.kind} ${Math.round(l.pct)}%`),
            s.events?.length ? `${s.events.length} events` : '',
            s.alertsOn ? 'alerts on' : 'alerts off',
          ]
            .filter(Boolean)
            .join(' · ')}
        />
        {!folded.includes('monitor') && (
          <Box flexDirection="column" paddingLeft={2}>
            <Text dimColor>usage limits</Text>
            {limits.length === 0 && (
              <Text dimColor wrap="wrap">{'  '}not reported yet (shows after the first reply on a Pro/Max plan)</Text>
            )}
            {limits.map(l => (
              <Box flexDirection="row">
                <Text>{'  '}{l.kind.padEnd(isNarrow ? 3 : 9)} </Text>
                <Text color={limitTone(l, now)}>{bar(l.pct, L.barCells)} {String(Math.round(l.pct)).padStart(3)}% </Text>
                <Text dimColor={!isLimitAtRisk(l, now)} color={isLimitAtRisk(l, now) ? TONE.bad : undefined} wrap="truncate-end">
                  {limitNote(l, now)}
                </Text>
              </Box>
            ))}
            {withCtx.length > 0 && <Text dimColor>context</Text>}
            {withCtx.map(r => {
              const trend = (r.ctxTrend ?? []).length > 1 ? sparkline(r.ctxTrend, isNarrow ? 6 : 12) : ''
              const cache = r.cacheHitPct !== null && r.cacheHitPct !== undefined ? `cache ${r.cacheHitPct}%` : ''
              return (
                <Box flexDirection="column">
                  <Box flexDirection="row">
                    <Text>{'  '}</Text>
                    <Text color={ctxTone(r.contextPct ?? 0)}>{bar(r.contextPct ?? 0, L.barCells)} {String(Math.round(r.contextPct ?? 0)).padStart(3)}% </Text>
                    <Text dimColor wrap="truncate-end">{cut(r.name || where(r), W - L.barCells - 14)}</Text>
                  </Box>
                  {(trend || cache) && (
                    <Box flexDirection="row" paddingLeft={2}>
                      {trend && <Text color={TONE.info}>{trend} </Text>}
                      <Text dimColor>{[trend ? 'per turn' : '', cache].filter(Boolean).join(' · ')}</Text>
                    </Box>
                  )}
                </Box>
              )
            })}
            {(s.disks ?? []).length > 0 && <Text dimColor>disk</Text>}
            {(s.disks ?? []).slice(0, 4).map((d: DiskRow) => {
              const used = 100 - (d.freeBytes / d.totalBytes) * 100
              return (
                <Box flexDirection="row">
                  <Text>{'  '}{cut(d.name, 8).padEnd(isNarrow ? 3 : 9)} </Text>
                  <Text color={isDiskLow(d) ? TONE.bad : used >= 80 ? TONE.warn : TONE.ok}>
                    {bar(used, L.barCells)} {String(Math.round(used)).padStart(3)}%{' '}
                  </Text>
                  <Text dimColor>{bytes(d.freeBytes)} free</Text>
                </Box>
              )
            })}
            <Text dimColor>events · alerts {s.alertsOn ? 'on' : 'off'} (a)</Text>
            {events.length === 0 && <Text dimColor>{'  '}quiet so far</Text>}
            {events.map(ev => (
              <Text color={EVENT_TONE[ev.tone]} wrap="truncate-end">
                {'  '}
                <Text dimColor>{clockOf(ev.at)} </Text>
                {EVENT_GLYPH[ev.tone]} {cut(ev.text, W - 12)}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )

    // ---- Work in flight -------------------------------------------------------
    const sessionByCwd = new Map(s.sessions.map(r => [r.cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(), r] as const))
    const others = g ? g.branches.filter(b => b.name !== g.branch) : []
    const merged = others.filter(b => b.isMerged)
    const work = (
      <Box flexDirection="column">
        <Heading
          id="work"
          hotkey="5"
          title="Work in flight"
          summary={g ? `${g.branch} · ${g.dirty} dirty${merged.length ? ` · ${merged.length} merged` : ''}` : 'no repo'}
        />
        {!folded.includes('work') && (
          <Box flexDirection="column" paddingLeft={2}>
            {!g && <Text dimColor>Not a git repository.</Text>}
            {g && (
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                <Text bold>{cut(g.branch, W - 6)}</Text>
                {g.upstream ? (
                  <Text color={g.behind > 0 ? TONE.warn : undefined} dimColor={g.ahead + g.behind === 0}>↑{g.ahead} ↓{g.behind}</Text>
                ) : (
                  <Text dimColor>no upstream</Text>
                )}
                {g.dirty > 0 ? <Text color={TONE.warn}>● {g.dirty} uncommitted</Text> : <Text color={TONE.ok}>✓ clean</Text>}
                {g.stashes > 0 && <Text dimColor>≡ {plural(g.stashes, 'stash', 'stashes')}</Text>}
                {(g.added ?? 0) + (g.removed ?? 0) > 0 && (
                  <Text>
                    <Text color={TONE.ok}>+{g.added}</Text> <Text color={TONE.bad}>−{g.removed}</Text>
                    <Text dimColor> not committed</Text>
                  </Text>
                )}
              </Box>
            )}
            {g &&
              others.slice(0, L.branchRows).map(b => (
                <Text color={b.isMerged ? TONE.accent : undefined} dimColor={!b.isMerged} wrap="truncate-end">
                  {b.isMerged ? '✓' : '·'} {cut(b.name, W - (b.isMerged ? 34 : 18))} · {b.age}
                  {b.isMerged ? ` · merged into ${g.base}` : ''}
                </Text>
              ))}
            {g && others.length > L.branchRows && <Text dimColor>+{others.length - L.branchRows} more branches</Text>}
            {g && g.worktrees.length > 1 && <Text dimColor>worktrees</Text>}
            {g &&
              g.worktrees.length > 1 &&
              g.worktrees.map(w => {
                const used = sessionByCwd.get(w.path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase())
                const who = used ? (used.id === s.selfId ? 'this session' : `session ${used.id.slice(0, 8)}`) : ''
                const name = w.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? w.path
                return (
                  <Text dimColor wrap="truncate-end">
                    {'  '}{cut(name, 18)} [{w.branch}]{who ? ` ← ${who}` : ''}
                  </Text>
                )
              })}
          </Box>
        )}
      </Box>
    )

    // ---- PRs & CI -------------------------------------------------------------
    const mineRow = (p: PrRow) => {
      const ci = CI[p.ci]
      const rv = reviewChip(p)
      return (
        <Row id={ids.pr(p)}>
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            <Text bold>#{p.number}</Text>
            {p.repo && <Text color={TONE.accent}>{cut(p.repo, isNarrow ? 12 : 20)}</Text>}
            <Text color={ci.tone} inverse={ci.inverse}>{ci.glyph}</Text>
            <Text color={rv.tone}>{rv.text}</Text>
            {p.conflicts && <Text color={TONE.bad}>conflicts</Text>}
            <Text dimColor>{p.ageDays}d</Text>
            {!isNarrow && <Text wrap="truncate-end">{p.title}</Text>}
          </Box>
          {isNarrow && (
            <Box paddingLeft={2}>
              <Text dimColor wrap="truncate-end">{p.title}</Text>
            </Box>
          )}
        </Box>
        </Row>
      )
    }
    const prs = s.prs
    const prSummary = !prs ? 'loading' : prs.error ? 'gh unavailable' : `${prs.mine.length} mine · ${prs.toReview.length} to review`
    const prSection = (
      <Box flexDirection="column">
        <Heading id="prs" hotkey="6" title="PRs & CI" summary={prSummary} />
        {!folded.includes('prs') && (
          <Box flexDirection="column" paddingLeft={2}>
            {!prs && <Text dimColor>loading…</Text>}
            {prs?.error && <Text color={TONE.warn} wrap="wrap">! {prs.error}</Text>}
            {prs && !prs.error && (
              <Box flexDirection="column">
                <Text dimColor>mine ({prs.mine.length})</Text>
                {prs.mine.length === 0 && <Text dimColor>{'  '}none open</Text>}
                {prs.mine.map(mineRow)}
                <Text dimColor>to review ({prs.toReview.length})</Text>
                {prs.toReview.length === 0 && <Text dimColor>{'  '}inbox zero</Text>}
                {prs.toReview.map(p => (
                  <Row id={ids.rv(p)}>
                    <Text wrap="truncate-end" color={p.ageDays >= 3 ? TONE.warn : undefined}>
                      #{p.number} @{p.author} · {p.repo ? `${p.repo} · ` : ''}{p.ageDays}d · {cut(p.title, W - 21 - p.author.length - p.repo.length)}
                    </Text>
                  </Row>
                ))}
                <Text dimColor>gh synced {ago(now - prs.fetchedAt)} ago</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    )

    const progress = progressSections({
      Box,
      Text,
      Heading,
      folded,
      sessions: s.sessions,
      selfId: s.selfId,
      W,
      isNarrow,
      now,
      tone: TONE,
      fmt: { ago, cut, bar },
    })

    // ---- footer: the buttons for the whole pane, reached with the arrows like everything else ----------
    const helpPanel = isHelpOn && (
      <Box borderStyle="round" borderColor={TONE.info} paddingX={1} flexDirection="column" width={W} marginTop={1}>
        <Text bold>Keys</Text>
        {HELP_KEYS.map(([key, what]) => (
          <Text wrap="truncate-end">
            <Text bold color={TONE.accent}>{key.padEnd(isNarrow ? 12 : 14)}</Text>
            {cut(what, W - (isNarrow ? 18 : 20))}
          </Text>
        ))}
        <Text dimColor wrap="truncate-end">A › marks a row; press it to see what you can do with that row.</Text>
      </Box>
    )

    // refresh, alerts and close are answered by ui.press hooks in register.tsx (they need that module's state).
    const footer = (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="key-refresh" label="refresh" onPress={() => undefined} />
          <Button key="key-alerts" label={s.alertsOn ? 'alerts: on' : 'alerts: off'} onPress={() => undefined} />
          <Button key="key-help" label={isHelpOn ? 'hide help' : 'help'} onPress={() => update($, showHelp, v => !v)} />
          <Button key="key-close" label="close" onPress={() => undefined} />
        </Box>
        <Text dimColor wrap="truncate-end">
          {e.props.isFocused ? '↑ ↓ move · Enter press · Esc back to the prompt' : 'ctrl+x tab to use the keys'}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column" width={W}>
        {header}
        {helpPanel}
        {attention}
        {sessions}
        {agentsSection}
        {monitor}
        {work}
        {prSection}
        {progress.plan}
        {progress.sources}
        {progress.files}
        {footer}
      </Box>
    )
  })
  // ---- The band above the prompt: one line, there while the pane is closed ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (!s || !s.bandOn || s.paneOpen || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const now = Date.now()
    const W = Math.max(30, e.props.bodyColumns)
    const att = attentionOf(s, {
      snoozed: (await read($, snoozed)) ?? {},
      dismissed: (await read($, dismissed)) ?? [],
      now,
    })
    const name = (r: SessionRow) => r.name || where(r)

    // The single most urgent thing, in the same order as the Attention section.
    const first =
      att.waiting[0] ? `${name(att.waiting[0])} · ${att.waiting[0].waitingFor || 'waiting'} ${ago(now - att.waiting[0].stateSince)}`
      : att.stuck[0] ? `${name(att.stuck[0])} may be stuck`
      : att.risky[0] ? `${name(att.risky[0])} ran ${att.risky[0].risky}`
      : att.collisions[0] ? `${att.collisions[0].sessions.join(' + ')} editing the same file`
      : att.limits[0] ? `${att.limits[0].kind} limit ${limitNote(att.limits[0], now)}`
      : att.disks[0] ? `disk ${att.disks[0].name} low`
      : att.failing[0] ? `#${att.failing[0].number} ${att.failing[0].conflicts ? 'conflicts' : 'CI failing'}`
      : ''
    const lead =
      att.urgent > 0 ? { text: `◆ ${att.urgent} need${att.urgent === 1 ? 's' : ''} you`, tone: TONE.warn }
      : att.reviews.length > 0 ? { text: `◎ ${plural(att.reviews.length, 'review')} waiting`, tone: TONE.info }
      : { text: '✓ all clear', tone: TONE.ok }

    const self = s.sessions.find(r => r.id === s.selfId)
    const running = s.sessions.filter(r => r.state === 'running').length
    const agentsBusy = (s.agents ?? []).filter(a => a.state === 'working' || a.state === 'quiet').length
    const facts: Array<{ text: string; tone?: string }> = [
      ...(s.limits ?? []).map(l => ({ text: `${l.kind} ${Math.round(l.pct)}%`, tone: limitTone(l, now) })),
      ...(self?.contextPct !== null && self?.contextPct !== undefined ? [{ text: `ctx ${Math.round(self.contextPct)}%`, tone: ctxTone(self.contextPct) }] : []),
      ...(running > 0 ? [{ text: `● ${running} running`, tone: TONE.ok }] : []),
      ...(agentsBusy > 0 ? [{ text: `◐ ${plural(agentsBusy, 'agent')}`, tone: TONE.accent }] : []),
    ]
    const room = W - lead.text.length - 9
    const detail = first ? cut(first, Math.max(0, Math.min(room - 30, 60))) : ''

    return (
      <Box flexDirection="row" width={W}>
        <Text bold={att.urgent > 0} color={lead.tone} dimColor={att.total === 0}>{lead.text}</Text>
        {detail && <Text color={lead.tone} wrap="truncate-end"> · {detail}</Text>}
        {facts.map(f => (
          <Text dimColor={att.total === 0} color={att.total === 0 ? undefined : f.tone}>  {f.text}</Text>
        ))}
        <Text dimColor>  /dash</Text>
      </Box>
    )
  })
}
