// dev-dash: the icons for where a watch lives. Pure data, so it tests without a session.
//
// The official GitHub mark is not a Unicode character, so a terminal can only show it from the font it is set to.
// Nerd Fonts carry it, but in most terminals it shows as an empty box, so the default is the emoji style, which
// every font has; `/dash-icons nerd` opts in to the official mark and `ascii` falls back to plain letters. The
// style is the person's choice and is remembered. A source gets its own entry here when there are watches for it.

import type { IconStyle, WatchKind } from '../types'

export type Source = 'github'

export const ICON_STYLES: readonly IconStyle[] = ['emoji', 'nerd', 'ascii']
export const DEFAULT_ICON_STYLE: IconStyle = 'emoji'

/** Nerd Fonts: Font Awesome `nf-fa-github` (U+F09B). */
export const ICONS: Record<Source, Record<IconStyle, string>> = {
  github: { emoji: '🐙', nerd: '', ascii: 'GH' },
}

export const sourceOf = (_kind: WatchKind): Source => 'github'

export const iconFor = (source: Source, style: IconStyle | undefined): string => ICONS[source][style ?? DEFAULT_ICON_STYLE]

/** `nerd`, `emoji` or `ascii` (any case), else null. */
export const parseIconStyle = (s: string): IconStyle | null => {
  const t = s.trim().toLowerCase()

  return (ICON_STYLES as readonly string[]).includes(t) ? (t as IconStyle) : null
}
