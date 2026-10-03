// dev-dash: the Entertainment tab's data. Pure functions only, so they test without a session.
//
// "Now playing" reads what the Spotify app on THIS machine reports, with a local command and no network:
// the window title on Windows, AppleScript on macOS, playerctl on Linux. Nothing is sent anywhere or written to disk.

import type { NowPlaying, TabId } from '../types'

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'custom', label: 'Custom' },
]

export const isTab = (v: unknown): v is TabId => TABS.some(t => t.id === v)

export type Platform = 'windows' | 'mac' | 'linux'

/** The command (as separate arguments, no shell) that prints what Spotify is playing on this platform. */
export const nowPlayingCommand = (platform: Platform): string[] => {
  if (platform === 'windows') {
    return [
      'powershell',
      '-NoProfile',
      '-Command',
      '(Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1 -ExpandProperty MainWindowTitle)',
    ]
  }
  if (platform === 'mac') {
    return [
      'osascript',
      '-e', 'if application "Spotify" is not running then return "NOT_RUNNING"',
      '-e', 'tell application "Spotify"',
      '-e', 'if player state is playing then return (artist of current track) & " - " & (name of current track)',
      '-e', 'return ""',
      '-e', 'end tell',
    ]
  }

  return ['playerctl', '-p', 'spotify', 'metadata', '--format', '{{status}}|{{artist}} - {{title}}']
}

const IDLE_TITLE = /^spotify(\s+(premium|free))?$/i
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * What the command printed, as a reading. `exitCode` matters on Linux, where no player is a non-zero exit.
 * On Windows the app's title is the track while playing and just "Spotify ..." when nothing is playing.
 */
export function parseNowPlaying(platform: Platform, stdout: string, exitCode: number, at: number): NowPlaying {
  const out = clean(stdout)
  if (platform === 'windows') {
    if (!out) return { state: 'closed', track: '', at }
    if (IDLE_TITLE.test(out)) return { state: 'idle', track: '', at }

    return { state: 'playing', track: out, at }
  }
  if (platform === 'mac') {
    if (out === 'NOT_RUNNING') return { state: 'closed', track: '', at }
    if (!out) return { state: 'idle', track: '', at }

    return { state: 'playing', track: out, at }
  }
  if (exitCode !== 0 || !out) return { state: 'closed', track: '', at }
  const [status, ...rest] = out.split('|')
  const track = clean(rest.join('|'))

  return status.toLowerCase() === 'playing' && track ? { state: 'playing', track, at } : { state: 'idle', track: '', at }
}

/** The command could not run at all (the tool is missing): shown as "unavailable", not as "closed". */
export const unavailable = (at: number): NowPlaying => ({ state: 'unavailable', track: '', at })
