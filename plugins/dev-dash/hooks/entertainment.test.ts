import { describe, expect, test } from 'claude-code/testing'

import { TABS, isTab, nowPlayingCommand, parseNowPlaying, unavailable } from './entertainment'

const AT = 1_800_000_000_000

describe('tabs', () => {
  test('Dashboard comes first, then Entertainment, then Custom', () => {
    expect(TABS.map(t => t.id)).toEqual(['dashboard', 'entertainment', 'custom'])
    expect(TABS.map(t => t.label)).toEqual(['Dashboard', 'Entertainment', 'Custom'])
  })

  test('only the three known tabs are accepted from stored state', () => {
    expect(isTab('custom')).toBe(true)
    expect(isTab('settings')).toBe(false)
    expect(isTab(undefined)).toBe(false)
    expect(isTab('')).toBe(false)
  })
})

describe('now playing', () => {
  test('Windows: the media session says playing or paused, with the track', () => {
    expect(parseNowPlaying('windows', 'Playing|Daft Punk - Around the World\r\n', 0, AT)).toEqual({ state: 'playing', track: 'Daft Punk - Around the World', at: AT })
    expect(parseNowPlaying('windows', 'Paused|Daft Punk - Around the World\r\n', 0, AT)).toEqual({ state: 'paused', track: 'Daft Punk - Around the World', at: AT })
  })

  test('Windows: no media session means open with nothing started, or closed', () => {
    expect(parseNowPlaying('windows', 'OPEN\r\n', 0, AT).state).toBe('idle')
    expect(parseNowPlaying('windows', 'CLOSED\r\n', 0, AT).state).toBe('closed')
  })

  test('Windows: a stopped session or an empty track is idle, not playing', () => {
    expect(parseNowPlaying('windows', 'Stopped|Daft Punk - Around the World', 0, AT).state).toBe('idle')
    expect(parseNowPlaying('windows', 'Playing| - ', 0, AT).state).toBe('idle')
    expect(parseNowPlaying('windows', 'Playing|', 0, AT).state).toBe('idle')
  })

  test('Windows: output nobody expected is "unavailable", never a made-up track', () => {
    expect(parseNowPlaying('windows', 'Spotify Premium', 0, AT).state).toBe('unavailable')
    expect(parseNowPlaying('windows', '', 0, AT).state).toBe('unavailable')
  })

  test('macOS: the script prints a status line, nothing when stopped, or NOT_RUNNING', () => {
    expect(parseNowPlaying('mac', 'Playing|Bonobo - Kerala\n', 0, AT)).toEqual({ state: 'playing', track: 'Bonobo - Kerala', at: AT })
    expect(parseNowPlaying('mac', 'Paused|Bonobo - Kerala\n', 0, AT).state).toBe('paused')
    expect(parseNowPlaying('mac', '\n', 0, AT).state).toBe('idle')
    expect(parseNowPlaying('mac', 'NOT_RUNNING\n', 0, AT).state).toBe('closed')
  })

  test('Linux: playerctl prints status and track, and fails when there is no player', () => {
    expect(parseNowPlaying('linux', 'Playing|Four Tet - Baby\n', 0, AT)).toEqual({ state: 'playing', track: 'Four Tet - Baby', at: AT })
    expect(parseNowPlaying('linux', 'Paused|Four Tet - Baby\n', 0, AT)).toEqual({ state: 'paused', track: 'Four Tet - Baby', at: AT })
    expect(parseNowPlaying('linux', 'No players found', 1, AT).state).toBe('closed')
    expect(parseNowPlaying('linux', '', 0, AT).state).toBe('closed')
  })

  test('a track title that contains a pipe survives', () => {
    expect(parseNowPlaying('linux', 'Playing|A | B - C', 0, AT).track).toBe('A | B - C')
  })

  test('an unreadable player is "unavailable", never "closed"', () => {
    expect(unavailable(AT)).toEqual({ state: 'unavailable', track: '', at: AT })
  })

  test('the commands are separate arguments with no shell and no user input in them', () => {
    expect(nowPlayingCommand('windows').slice(0, 3)).toEqual(['powershell', '-NoProfile', '-Command'])
    expect(nowPlayingCommand('windows')).toHaveLength(4)
    expect(nowPlayingCommand('mac')[0]).toBe('osascript')
    expect(nowPlayingCommand('linux')).toEqual(['playerctl', '-p', 'spotify', 'metadata', '--format', '{{status}}|{{artist}} - {{title}}'])
    for (const p of ['windows', 'mac', 'linux'] as const) for (const arg of nowPlayingCommand(p)) expect(typeof arg).toBe('string')
  })

  test('the Windows script only reads: no write, delete, start or stop', () => {
    const script = nowPlayingCommand('windows')[3]
    expect(script).toContain('GlobalSystemMediaTransportControlsSessionManager')
    for (const bad of [/Remove-Item/i, /Set-Content/i, /Out-File/i, /Start-Process/i, /Stop-Process/i, /Invoke-WebRequest/i, /Invoke-RestMethod/i, /TryTogglePlayPause/i, /TrySkip/i]) {
      expect(script).not.toMatch(bad)
    }
  })
})
