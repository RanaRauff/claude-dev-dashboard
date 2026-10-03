// dev-dash: the Entertainment and Custom tabs. Drawn from what render.tsx passes in, and kept out of render.tsx so
// the two tabs and the Dashboard tab can change without touching each other. Add a widget by adding a card here.

import type { NowPlaying } from '../types'

// The Box, Text and Button render.tsx resolved for this render.
// biome-ignore lint/suspicious/noExplicitAny: element components come from `$.ui.resolve(e)`
type El = (props: any) => any

export type TabView = {
  Box: El
  Text: El
  Button: El
  W: number
  now: number
  tone: { ok: string; warn: string; bad: string; info: string; accent: string; mute: string }
  fmt: { ago: (ms: number) => string; cut: (s: string, n: number) => string }
}

/** A titled, bordered card: the shape every widget on the Entertainment tab shares. */
function Card(v: TabView, p: { title: string; tone?: string; children?: unknown }) {
  const { Box, Text, W, tone } = v

  return (
    <Box borderStyle="round" borderColor={p.tone ?? tone.mute} paddingX={1} flexDirection="column" width={W}>
      <Text bold color={p.tone}>{p.title}</Text>
      {p.children}
    </Box>
  )
}

function nowPlayingCard(v: TabView, np: NowPlaying | null, isOn: boolean) {
  const { Box, Text, Button, tone, fmt, W, now } = v
  // Off by default: nothing is read until the person turns it on, with this button or /dash-spotify on.
  if (!isOn) {
    return Card(v, {
      title: '♪ Now playing · Spotify',
      children: (
        <Box flexDirection="column">
          <Text dimColor wrap="wrap">Off. Nothing is read until you turn it on. When on, this shows the track the Spotify app on this machine is playing: no login, no network.</Text>
          <Box flexDirection="row" marginTop={1}>
            <Button key="spotify-toggle" variant="primary" label="turn on" onPress={() => undefined} />
          </Box>
        </Box>
      ),
    })
  }
  const body =
    np === null ? (
      <Text dimColor>Looking for Spotify…</Text>
    ) : np.state === 'playing' ? (
      <Text color={tone.ok} bold wrap="truncate-end">▶ {fmt.cut(np.track, W - 8)}</Text>
    ) : np.state === 'paused' ? (
      <Text wrap="truncate-end">⏸ {fmt.cut(np.track, W - 16)} <Text dimColor>(paused)</Text></Text>
    ) : np.state === 'idle' ? (
      <Text dimColor wrap="wrap">Spotify is open, but no song has been started. Play one and it appears here.</Text>
    ) : np.state === 'closed' ? (
      <Text dimColor>Spotify is not running.</Text>
    ) : (
      <Text color={tone.warn} wrap="wrap">Could not read Spotify here. On Linux this needs `playerctl`.</Text>
    )

  return Card(v, {
    title: '♪ Now playing · Spotify',
    tone: np?.state === 'playing' ? tone.ok : undefined,
    children: (
      <Box flexDirection="column">
        {body}
        {np && (np.state === 'playing' || np.state === 'paused') && (
          <Text dimColor>read {fmt.ago(now - np.at)} ago from the Spotify app on this machine</Text>
        )}
        <Box flexDirection="row" marginTop={1}>
          <Button key="spotify-toggle" label="turn off" dimColor onPress={() => undefined} />
        </Box>
      </Box>
    ),
  })
}

function stocksCard(v: TabView) {
  const { Box, Text } = v

  return Card(v, {
    title: '▲ Stocks',
    children: (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">Not set up. Prices need a data source, and dev-dash makes no network calls beyond git and gh (CONTRIBUTING.md), so nothing is fetched.</Text>
        <Text dimColor wrap="wrap">The project owner has to approve a source before a watchlist can go here.</Text>
      </Box>
    ),
  })
}

/** The Entertainment tab: a column of cards. */
export function entertainmentView(v: TabView, np: NowPlaying | null, isSpotifyOn: boolean) {
  const { Box, Text } = v

  return (
    <Box flexDirection="column" marginTop={1} rowGap={1}>
      {nowPlayingCard(v, np, isSpotifyOn)}
      {stocksCard(v)}
      <Text dimColor>More widgets will land here. Spotify, when on, is read only while this tab is showing.</Text>
    </Box>
  )
}

/** The Custom tab: empty on purpose for now. */
export function customView(v: TabView) {
  const { Box, Text } = v

  return (
    <Box flexDirection="column" marginTop={1}>
      {Card(v, {
        title: 'Custom',
        children: (
          <Box flexDirection="column">
            <Text dimColor>Nothing here yet.</Text>
            <Text dimColor wrap="wrap">This tab is kept for widgets you choose yourself. It stays empty until we decide what goes in it.</Text>
          </Box>
        ),
      })}
    </Box>
  )
}
