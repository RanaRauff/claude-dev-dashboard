// dev-dash: the Watching section, drawn from what /dash-watch is keeping an eye on. Each watch is an outlined box:
// an icon for where it lives (GitHub), what it is, its title, and a row of small marks (an icon and a word or two)
// that say where it stands. Boxes sit side by side when the pane is wide enough, so the section takes as little
// height as it can. Kept out of render.tsx so changes to the pane and to this section merge cleanly; render.tsx
// passes in what it already has. Hidden when nothing is watched.

import type { DashSection, IconStyle, WatchChip, WatchRow, WatchTone } from '../types'
import { iconFor, sourceOf } from './icons'
import { watchName } from './watch'

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
  /** The card border the theme draws with. */
  border?: string
  tone: { ok: string; warn: string; bad: string; info: string; mute: string }
  fmt: { ago: (ms: number) => string; cut: (s: string, n: number) => string }
}

const short = (repo: string) => repo.split('/').pop() ?? repo

/** Two columns when there is room for two readable boxes, else one. */
export const boxWidth = (W: number) => (W >= 76 ? Math.floor((W - 1) / 2) : W)

const toneColor = (t: WatchTone | undefined, c: WatchView['tone']) => (t === 'ok' ? c.ok : t === 'warn' ? c.warn : t === 'bad' ? c.bad : t === 'info' ? c.info : c.mute)

export function watchingSection(v: WatchView) {
  const { Box, Text, Heading, folded, watches, iconStyle, W, now, tone, fmt } = v
  if (watches.length === 0) return null
  const fired = watches.filter(w => w.firedAt > 0)
  // What has changed comes first, then the rest in the order they were added.
  const shown = [...watches].sort((a, b) => Number(b.firedAt > 0) - Number(a.firedAt > 0))
  const bw = boxWidth(W)
  const inner = Math.max(10, bw - 4)

  const card = (w: WatchRow) => {
    const isFired = w.firedAt > 0
    const border = isFired ? tone.warn : toneColor(w.tone, tone)
    const chips: WatchChip[] = w.chips ?? []
    return (
      <Box flexDirection="column" borderStyle={(v.border ?? 'round') as 'round'} borderColor={border} paddingX={1} width={bw}>
        <Box flexDirection="row">
          <Text bold>{iconFor(sourceOf(w.kind), iconStyle)} </Text>
          <Text bold>{watchName(w)}</Text>
          {isFired && <Text bold color={tone.warn}> ◆</Text>}
          <Text dimColor wrap="truncate-end"> · {short(w.repo)} · {w.checkedAt ? fmt.ago(now - w.checkedAt) : 'new'}</Text>
        </Box>
        <Text wrap="truncate-end">{fmt.cut(w.title || w.repo, inner)}</Text>
        {chips.length === 0 ? (
          <Text dimColor>waiting for the first look</Text>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {chips.map(c => (
              <Text color={toneColor(c.tone, tone)}>
                {c.icon}
                {c.text ? ` ${fmt.cut(c.text, 16)}` : ''}
              </Text>
            ))}
          </Box>
        )}
        {isFired && <Text color={tone.warn} wrap="truncate-end">◆ {fmt.cut(w.fired, inner - 8)} {fmt.ago(now - w.firedAt)}</Text>}
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
        summary={fired.length ? fired.map(w => `${watchName(w)} ${w.fired}`).join(' · ') : `${watches.length} quiet`}
      />
      {!folded.includes('watching') && (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {shown.map(card)}
          </Box>
          <Text dimColor wrap="truncate-end">/dash-watch pr|issue|run … · clear &lt;n|all&gt;</Text>
        </Box>
      )}
    </Box>
  )
}
