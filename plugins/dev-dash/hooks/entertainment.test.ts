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
  test('Windows: the window title is the track while playing', () => {
    expect(parseNowPlaying('windows', 'Daft Punk - Around the World\r\n', 0, AT)).toEqual({ state: 'playing', track: 'Daft Punk - Around the World', at: AT })
  })

  test('Windows: a bare Spotify title means idle, and no window means closed', () => {
    for (const idle of ['Spotify', 'Spotify Premium', 'Spotify Free', '  spotify premium \r\n']) {
      expect(parseNowPlaying('windows', idle, 0, AT).state).toBe('idle')
    }
    expect(parseNowPlaying('windows', '', 0, AT).state).toBe('closed')
    expect(parseNowPlaying('windows', '\r\n', 0, AT).state).toBe('closed')
  })

  test('macOS: the script prints the track, nothing when paused, or NOT_RUNNING', () => {
    expect(parseNowPlaying('mac', 'Bonobo - Kerala\n', 0, AT)).toEqual({ state: 'playing', track: 'Bonobo - Kerala', at: AT })
    expect(parseNowPlaying('mac', '\n', 0, AT).state).toBe('idle')
    expect(parseNowPlaying('mac', 'NOT_RUNNING\n', 0, AT).state).toBe('closed')
  })

  test('Linux: playerctl prints status and track, and fails when there is no player', () => {
    expect(parseNowPlaying('linux', 'Playing|Four Tet - Baby\n', 0, AT)).toEqual({ state: 'playing', track: 'Four Tet - Baby', at: AT })
    expect(parseNowPlaying('linux', 'Paused|Four Tet - Baby\n', 0, AT).state).toBe('idle')
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
    expect(nowPlayingCommand('windows')[0]).toBe('powershell')
    expect(nowPlayingCommand('mac')[0]).toBe('osascript')
    expect(nowPlayingCommand('linux')).toEqual(['playerctl', '-p', 'spotify', 'metadata', '--format', '{{status}}|{{artist}} - {{title}}'])
    for (const p of ['windows', 'mac', 'linux'] as const) for (const arg of nowPlayingCommand(p)) expect(typeof arg).toBe('string')
  })
})
