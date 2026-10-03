// dev-dash: the Entertainment tab's data. Pure functions only, so they test without a session.
//
// "Now playing" is an opt-in (off until the person turns it on). It reads what the Spotify app on THIS machine
// reports, with a local command and no network and no login: the media information Windows shows on its volume
// overlay, AppleScript on macOS, playerctl on Linux. Nothing is sent anywhere or written to disk.

import type { NowPlaying, TabId } from '../types'

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'custom', label: 'Custom' },
]

export const isTab = (v: unknown): v is TabId => TABS.some(t => t.id === v)

export type Platform = 'windows' | 'mac' | 'linux'

// Windows keeps a "media session" for each app that plays media (the info behind the volume overlay): the app, the
// track and whether it is playing or paused. Unlike the app's window title it keeps the track while paused. It is
// there once Spotify has started a song. No session means Spotify is either open with nothing started, or closed.
const WINDOWS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'try {',
  '  Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  "  $a=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]",
  '  function W($o,$t){$k=$a.MakeGenericMethod($t).Invoke($null,@($o));$k.Wait(-1)|Out-Null;$k.Result}',
  '  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]',
  '  $m=W ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
  "  foreach($s in $m.GetSessions()){ if($s.SourceAppUserModelId -match 'Spotify'){",
  '    $p=W ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
  "    Write-Output ($s.GetPlaybackInfo().PlaybackStatus.ToString()+'|'+$p.Artist+' - '+$p.Title); return } }",
  '} catch {}',
  "if(Get-Process -Name Spotify -ErrorAction SilentlyContinue){'OPEN'}else{'CLOSED'}",
].join('\n')

/** The command (as separate arguments, no shell) that prints what Spotify is playing on this platform. */
export const nowPlayingCommand = (platform: Platform): string[] => {
  if (platform === 'windows') return ['powershell', '-NoProfile', '-Command', WINDOWS_SCRIPT]
  if (platform === 'mac') {
    return [
      'osascript',
      '-e', 'if application "Spotify" is not running then return "NOT_RUNNING"',
      '-e', 'tell application "Spotify"',
      '-e', 'if player state is playing then return "Playing|" & (artist of current track) & " - " & (name of current track)',
      '-e', 'if player state is paused then return "Paused|" & (artist of current track) & " - " & (name of current track)',
      '-e', 'return ""',
      '-e', 'end tell',
    ]
  }

  return ['playerctl', '-p', 'spotify', 'metadata', '--format', '{{status}}|{{artist}} - {{title}}']
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** `Playing|Artist - Title`, `Paused|...`, or a status with no track: Windows, macOS and Linux all print this shape. */
function statusLine(out: string, at: number): NowPlaying | null {
  const m = /^(Playing|Paused|Stopped|Changing|Opened|Closed)\|(.*)$/i.exec(out)
  if (!m) return null
  const status = m[1].toLowerCase()
  const track = clean(m[2])
  if (!track || track === '-') return { state: 'idle', track: '', at }
  if (status === 'playing') return { state: 'playing', track, at }
  if (status === 'paused') return { state: 'paused', track, at }

  return { state: 'idle', track: '', at }
}

/**
 * What the command printed, as a reading. `exitCode` matters on Linux, where no player is a non-zero exit.
 * Windows prints a status line, or OPEN (Spotify running, nothing started) or CLOSED (not running).
 */
export function parseNowPlaying(platform: Platform, stdout: string, exitCode: number, at: number): NowPlaying {
  const out = clean(stdout)
  if (platform === 'windows') {
    if (out === 'CLOSED') return { state: 'closed', track: '', at }
    if (out === 'OPEN') return { state: 'idle', track: '', at }

    return statusLine(out, at) ?? { state: 'unavailable', track: '', at }
  }
  if (platform === 'mac') {
    if (out === 'NOT_RUNNING') return { state: 'closed', track: '', at }
    if (!out) return { state: 'idle', track: '', at }

    return statusLine(out, at) ?? { state: 'unavailable', track: '', at }
  }
  if (exitCode !== 0 || !out) return { state: 'closed', track: '', at }

  return statusLine(out, at) ?? { state: 'unavailable', track: '', at }
}

/** The command could not run at all (the tool is missing): shown as "unavailable", not as "closed". */
export const unavailable = (at: number): NowPlaying => ({ state: 'unavailable', track: '', at })
