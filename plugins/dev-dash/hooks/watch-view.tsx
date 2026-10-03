// dev-dash: the Watching section, drawn from what /dash-watch is keeping an eye on. Kept out of render.tsx so
// changes to the pane and to this section merge cleanly; render.tsx passes in what it already has.
// Hidden when nothing is watched.

import type { DashSection, WatchRow } from '../types'

// The Box, Text and Heading render.tsx resolved for this render.
// biome-ignore lint/suspicious/noExplicitAny: element components come from `$.ui.resolve(e)`
type El = (props: any) => any

export type WatchView = {
  Box: El
  Text: El
  Heading: (p: { id: DashSection; hotkey: string; title: string; tone?: string; summary: string }) => unknown
  folded: readonly DashSection[]
  watches: readonly WatchRow[]
  W: number
  now: number
  tone: { ok: string; warn: string; bad: string; info: string }
  fmt: { ago: (ms: number) => string; cut: (s: string, n: number) => string }
}

const short = (repo: string) => repo.split('/').pop() ?? repo

export function watchingSection(v: WatchView) {
  const { Box, Text, Heading, folded, watches, W, now, tone, fmt } = v
  if (watches.length === 0) return null
  const fired = watches.filter(w => w.firedAt > 0)

  return (
    <Box flexDirection="column">
      <Heading
        id="watching"
        hotkey="0"
        title={fired.length ? `Watching (${watches.length} · ${fired.length} fired)` : `Watching (${watches.length})`}
        tone={fired.length ? tone.warn : undefined}
        summary={fired.length ? fired.map(w => `#${w.number} ${w.fired}`).join(' · ') : `${watches.length} quiet`}
      />
      {!folded.includes('watching') && (
        <Box flexDirection="column" paddingLeft={2}>
          {watches.map((w, i) => {
            const isFired = w.firedAt > 0
            const name = `#${w.number} ${short(w.repo)}`
            return (
              <Box flexDirection="column">
                <Box flexDirection="row">
                  <Text color={isFired ? tone.warn : tone.info} bold={isFired}>{isFired ? '◆' : '·'} </Text>
                  <Text bold={isFired} wrap="truncate-end">{fmt.cut(`${i + 1}. ${name}${w.title ? ` · ${w.title}` : ''}`, W - 6)}</Text>
                </Box>
                <Box paddingLeft={2}>
                  {isFired ? (
                    <Text color={tone.warn} wrap="truncate-end">{fmt.cut(`${w.fired} ${fmt.ago(now - w.firedAt)} ago · now ${w.detail}`, W - 8)}</Text>
                  ) : (
                    <Text dimColor wrap="truncate-end">
                      {w.checkedAt === 0 ? 'waiting for the first look' : `${w.detail} · checked ${fmt.ago(now - w.checkedAt)} ago`}
                    </Text>
                  )}
                </Box>
              </Box>
            )
          })}
          <Text dimColor>/dash-watch clear &lt;number|all&gt; removes one</Text>
        </Box>
      )}
    </Box>
  )
}
