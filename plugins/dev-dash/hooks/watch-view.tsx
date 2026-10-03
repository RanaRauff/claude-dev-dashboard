// dev-dash: the Watching section. Each thing being watched is an outlined box: an icon for where it lives (GitHub,
// mail), what it is, its title, and a row of small marks (icon plus a word or two) that say where it stands.
// Boxes sit side by side when the pane is wide enough, so the section takes as little height as it can.
//
// Kept out of render.tsx so changes to the pane and to this section merge cleanly; render.tsx passes in what it
// already has. Hidden when nothing is watched.

import type { DashSection, IconStyle, WatchChip, WatchKind, WatchRow, WatchTone } from '../types'
import { BRAND, iconFor, sourceOf } from './icons'

// The Box, Text and Heading render.tsx resolved for this render.
// biome-ignore lint/suspicious/noExplicitAny: element components come from `$.ui.resolve(e)`
type El = (props: any) => any

export type WatchView = {
  Box: El
  Text: El
  Heading: (p: { id: DashSection; hotkey: string; title: string; tone?: string; summary: string }) => unknown
  folded: readonly DashSection[]
  watches: readonly WatchRow[]
  iconStyle?: IconStyle
  W: number
  now: number
  tone: { ok: string; warn: string; bad: string; info: string; mute: string }
  fmt: { ago: (ms: number) => string; cut: (s: string, n: number) => string }
}

/** What to call each kind. Where it lives is drawn by the source icon (see icons.ts). */
export const KIND_LABEL: Record<WatchKind, string> = { pr: 'PR', issue: 'Issue', run: 'Run', mail: 'Mail' }

/** The box's heading: `PR #11`, `Issue #4`, `Run #123456`, or just `Mail`. */
export const kindName = (w: WatchRow) => (w.kind === 'mail' ? KIND_LABEL.mail : `${KIND_LABEL[w.kind]} #${w.number}`)

/** What the box says it is: the title read from the source, or the subject being watched, or the repository. */
export const subjectOf = (w: WatchRow) => w.title || w.query || w.repo

/** Two columns when there is room for two readable boxes, else one. */
export const boxWidth = (W: number) => (W >= 76 ? Math.floor((W - 1) / 2) : W)

const toneColor = (t: WatchTone | undefined, c: WatchView['tone']) => (t === 'ok' ? c.ok : t === 'warn' ? c.warn : t === 'bad' ? c.bad : t === 'info' ? c.info : c.mute)

export function watchingSection(v: WatchView) {
  const { Box, Text, Heading, folded, watches, iconStyle, W, now, tone, fmt } = v
  if (watches.length === 0) return null
  const fired = watches.filter(w => w.firedAt > 0)
  // What has changed comes first, then what is going wrong, then the rest in the order they were added.
  const shown = [...watches].sort((a, b) => Number(b.firedAt > 0) - Number(a.firedAt > 0) || Number(!!b.problem) - Number(!!a.problem))
  const bw = boxWidth(W)
  const inner = Math.max(10, bw - 4)

  const card = (w: WatchRow) => {
    const isFired = w.firedAt > 0
    const border = w.problem ? tone.bad : isFired ? tone.warn : toneColor(w.tone, tone)
    const source = sourceOf(w.kind)
    const chips: WatchChip[] = w.chips ?? []
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={border} paddingX={1} width={bw}>
        <Box flexDirection="row">
          <Text bold color={BRAND[source]}>{iconFor(source, iconStyle)} </Text>
          <Text bold>{kindName(w)}</Text>
          {isFired && <Text bold color={tone.warn}> ◆</Text>}
          <Text dimColor wrap="truncate-end"> · {w.checkedAt ? fmt.ago(now - w.checkedAt) : 'new'}</Text>
        </Box>
        <Text wrap="truncate-end">{fmt.cut(subjectOf(w), inner)}</Text>
        {chips.length === 0 ? (
          !w.problem && <Text dimColor>waiting for the first look</Text>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {chips.map(c => (
              <Text color={toneColor(c.tone, tone)}>
                {c.icon}
                {c.text ? ` ${fmt.cut(c.text, 16)}` : ''}
                {c.at ? ` ${fmt.ago(now - c.at)}` : ''}
              </Text>
            ))}
          </Box>
        )}
        {isFired && <Text color={tone.warn} wrap="truncate-end">◆ {fmt.cut(w.fired, inner - 8)} {fmt.ago(now - w.firedAt)}</Text>}
        {/* A watch that cannot be refreshed keeps what it last knew, and says why it is stale. */}
        {w.problem && <Text color={tone.bad} wrap="truncate-end">⚠ {fmt.cut(w.problem, inner - 2)}</Text>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Heading
        id="watching"
        hotkey="0"
        title={fired.length ? `Watching (${watches.length} · ${fired.length} fired)` : `Watching (${watches.length})`}
        tone={fired.length ? tone.warn : undefined}
        summary={fired.length ? fired.map(w => `${kindName(w)} ${w.fired}`).join(' · ') : `${watches.length} quiet`}
      />
      {!folded.includes('watching') && (
        <Box flexDirection="column" paddingLeft={0}>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {shown.map(card)}
          </Box>
          <Text dimColor wrap="truncate-end">/dash-watch pr|issue|run|mail … · clear &lt;n|all&gt;</Text>
        </Box>
      )}
    </Box>
  )
}
