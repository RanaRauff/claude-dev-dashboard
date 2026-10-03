// dev-dash: the Plan, Sources and Files sections. Each is drawn from the sessions' heartbeats,
// and kept out of render.tsx so changes to the pane and to these sections merge cleanly.
//
// render.tsx passes in what it already has (its Heading, Box and Text, widths, the fold list),
// so there is nothing here to keep in step with the rest of the pane.

import type { ChangedFile, DashSection, SessionRow, SourceRow } from '../types'
import { isPlanLive, shortUrl, totals } from './progress'

// The Box, Text and Heading render.tsx resolved for this render.
// biome-ignore lint/suspicious/noExplicitAny: element components come from `$.ui.resolve(e)`
type El = (props: any) => any

export type ProgressView = {
  Box: El
  Text: El
  Heading: (p: { id: DashSection; hotkey: string; title: string; tone?: string; summary: string }) => unknown
  folded: readonly DashSection[]
  sessions: readonly SessionRow[]
  selfId: string
  W: number
  isNarrow: boolean
  now: number
  tone: { ok: string; warn: string; bad: string; info: string }
  fmt: {
    ago: (ms: number) => string
    cut: (s: string, n: number) => string
    bar: (pct: number, cells: number) => string
  }
}

const label = (r: SessionRow) => r.name || (r.branch ? `${r.repo}@${r.branch}` : r.repo)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

export function progressSections(v: ProgressView) {
  const { Box, Text, Heading, folded, W, isNarrow, now, tone, fmt } = v
  const live = v.sessions.filter(r => r.hasPlugin)

  // ---- Plan: one line per session that keeps a todo list -------------------------
  const planned = live.filter(r => isPlanLive(r.plan, now, r.planAt ?? 0))
  const doneCount = planned.filter(r => r.plan && r.plan.done >= r.plan.total).length
  const plan = (
    <Box flexDirection="column">
      <Heading
        id="plan"
        hotkey="7"
        title={`Plan (${planned.length})`}
        summary={planned.length ? `${planned.length - doneCount} in progress · ${doneCount} done` : 'no plans'}
      />
      {!folded.includes('plan') && (
        <Box flexDirection="column" paddingLeft={2}>
          {planned.length === 0 && <Text dimColor>No session has a todo list right now.</Text>}
          {planned.map(r => {
            const p = r.plan as NonNullable<SessionRow['plan']>
            const isDone = p.done >= p.total
            const cells = isNarrow ? 5 : 10
            return (
              <Box flexDirection="column">
                <Box flexDirection="row">
                  <Text color={isDone ? tone.ok : tone.info}>{fmt.bar((p.done / p.total) * 100, cells)} </Text>
                  <Text bold={r.id === v.selfId}>
                    {p.done}/{p.total}
                  </Text>
                  <Text dimColor wrap="truncate-end"> · {fmt.cut(label(r), W - cells - 12)}</Text>
                </Box>
                {!isDone && p.current && (
                  <Box paddingLeft={2}>
                    <Text dimColor wrap="truncate-end">↳ {fmt.cut(p.current, W - 8)}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )

  // ---- Sources: what sessions looked up, newest first ----------------------------
  const sources: Array<SourceRow & { who: string }> = live
    .flatMap(r => (r.sources ?? []).map(s => ({ ...s, who: label(r) })))
    .sort((a, b) => b.at - a.at)
  const shown = sources.slice(0, isNarrow ? 5 : 8)
  const sources_ = (
    <Box flexDirection="column">
      <Heading
        id="sources"
        hotkey="8"
        title={`Sources (${sources.length})`}
        summary={sources.length ? `${sources.filter(s => s.kind === 'fetch').length} fetched · ${sources.filter(s => s.kind === 'search').length} searched` : 'none yet'}
      />
      {!folded.includes('sources') && (
        <Box flexDirection="column" paddingLeft={2}>
          {sources.length === 0 && <Text dimColor>Nothing fetched or searched yet.</Text>}
          {shown.map(s => (
            <Text wrap="truncate-end">
              <Text color={s.kind === 'fetch' ? tone.info : tone.ok}>{s.kind === 'fetch' ? '↓' : '⌕'} </Text>
              {fmt.cut(s.kind === 'fetch' ? shortUrl(s.label) : s.label, W - 14 - (isNarrow ? 0 : fmt.cut(s.who, 14).length))}
              <Text dimColor> · {fmt.ago(now - s.at)}{isNarrow ? '' : ` · ${fmt.cut(s.who, 14)}`}</Text>
            </Text>
          ))}
          {sources.length > shown.length && <Text dimColor>+{sources.length - shown.length} more</Text>}
        </Box>
      )}
    </Box>
  )

  // ---- Files: what each session changed this turn --------------------------------
  const changed = live.filter(r => (r.turnFiles ?? []).length > 0)
  const all: ChangedFile[] = changed.flatMap(r => r.turnFiles ?? [])
  const sum = totals(all)
  const files = (
    <Box flexDirection="column">
      <Heading
        id="files"
        hotkey="9"
        title={`Files (${all.length})`}
        summary={all.length ? `${plural(all.length, 'file')} · +${sum.added} -${sum.removed}` : 'no edits this turn'}
      />
      {!folded.includes('files') && (
        <Box flexDirection="column" paddingLeft={2}>
          {changed.length === 0 && <Text dimColor>No session has edited files this turn.</Text>}
          {changed.map(r => {
            const t = totals(r.turnFiles ?? [])
            const rows = (r.turnFiles ?? []).slice(0, isNarrow ? 3 : 5)
            return (
              <Box flexDirection="column">
                <Box flexDirection="row">
                  <Text bold={r.id === v.selfId} wrap="truncate-end">{fmt.cut(label(r), W - 22)}</Text>
                  <Text dimColor> · {plural((r.turnFiles ?? []).length, 'file')} </Text>
                  <Text color={tone.ok}>+{t.added}</Text>
                  <Text color={tone.bad}> -{t.removed}</Text>
                </Box>
                {rows.map(f => (
                  <Box paddingLeft={2} flexDirection="row">
                    <Text wrap="truncate-end">{fmt.cut(baseName(f.path), W - 18)}</Text>
                    <Text color={tone.ok}> +{f.added}</Text>
                    <Text color={tone.bad}> -{f.removed}</Text>
                  </Box>
                ))}
                {(r.turnFiles ?? []).length > rows.length && (
                  <Box paddingLeft={2}>
                    <Text dimColor>+{(r.turnFiles ?? []).length - rows.length} more</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )

  return { plan, sources: sources_, files }
}
