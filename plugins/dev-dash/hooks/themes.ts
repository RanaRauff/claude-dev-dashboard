// dev-dash: colour themes (Flight Deck design, "Themes"). Pure data, so it tests without a session.
//
// Every colour in the pane is a role (you, ok, warn, bad, info, accent, mute), never a fixed value, so a theme only has
// to say what each role looks like. `auto` is the default and uses the eight named terminal colours, which every
// terminal theme (dark or light) remaps to something readable. The others use exact colours and want a truecolor terminal.

import type { ThemeId } from '../types'

export type Roles = { you: string; ok: string; warn: string; bad: string; info: string; accent: string; mute: string }

export const THEMES: ReadonlyArray<{ id: ThemeId; label: string; blurb: string; tone: Roles }> = [
  {
    id: 'auto',
    label: 'Auto',
    blurb: 'The default: your terminal\'s own colours, so it follows your terminal theme, dark or light.',
    tone: { you: 'yellow', ok: 'green', warn: 'yellow', bad: 'red', info: 'cyan', accent: 'magenta', mute: 'gray' },
  },
  {
    id: 'claude',
    label: 'Claude',
    blurb: 'Matched to Claude Code\'s clay.',
    tone: { you: '#D97757', ok: '#6CC47C', warn: '#E8B04F', bad: '#F2706A', info: '#7AA7FF', accent: '#B49CFF', mute: '#8D93A0' },
  },
  {
    id: 'nord',
    label: 'Nord',
    blurb: 'Soft and low-contrast for long sessions.',
    tone: { you: '#D08770', ok: '#A3BE8C', warn: '#EBCB8B', bad: '#BF616A', info: '#81A1C1', accent: '#B48EAD', mute: '#8892A6' },
  },
  {
    id: 'neon',
    label: 'Neon',
    blurb: 'Saturated, for screenshots and streams.',
    tone: { you: '#FF6AC1', ok: '#4DFA9A', warn: '#FFE66D', bad: '#FF5470', info: '#5CE1FF', accent: '#B98CFF', mute: '#8D86B5' },
  },
  {
    id: 'crt',
    label: 'Amber CRT',
    blurb: 'One hue with a phosphor look. State is carried by the glyphs.',
    tone: { you: '#FFE0A0', ok: '#FFC65C', warn: '#FFB43A', bad: '#FF8A4A', info: '#FFB43A', accent: '#E8A23A', mute: '#A8761F' },
  },
  {
    id: 'light',
    label: 'Light',
    blurb: 'For light terminals: the same hues, darker.',
    tone: { you: '#BC4C00', ok: '#1A7F37', warn: '#9A6700', bad: '#CF222E', info: '#0969DA', accent: '#8250DF', mute: '#6E7781' },
  },
  {
    id: 'mono',
    label: 'Mono',
    blurb: 'For 16-colour terminals and colour-blind users: glyphs and weight only.',
    tone: { you: '#FFFFFF', ok: '#C4C4C4', warn: '#FFFFFF', bad: '#FFFFFF', info: '#C4C4C4', accent: '#C4C4C4', mute: '#8C8C8C' },
  },
]

export const isTheme = (v: unknown): v is ThemeId => THEMES.some(t => t.id === v)

/** Look a theme up by what someone typed (`nord`, `Amber CRT`, `crt`); undefined when it is not one. */
export const themeByName = (name: string) => {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, '')

  return THEMES.find(t => t.id === n || t.label.toLowerCase().replace(/\s+/g, '') === n)
}

/** The theme after `id`, wrapping around: what the footer button does. */
export const nextTheme = (id: ThemeId): ThemeId => THEMES[(THEMES.findIndex(t => t.id === id) + 1) % THEMES.length].id

/** Point the live colour table at a theme. Unknown ids fall back to `auto`. */
export const applyTheme = (into: Roles, id: unknown) => {
  const t = THEMES.find(x => x.id === id) ?? THEMES[0]
  Object.assign(into, t.tone)
}
