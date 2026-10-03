// dev-dash: the icons for where a watch lives. Pure data, so it tests without a session.
//
// The official marks (the GitHub Invertocat, the Gmail "M") are not Unicode characters, so a terminal can only
// show them from the font it is set to. Nerd Fonts carry them, so that is the default style; `/dash-icons emoji`
// falls back to characters every font has, and `ascii` to plain letters. The style is the person's choice and is
// remembered.

import type { IconStyle, WatchKind } from '../types'

export type Source = 'github' | 'gmail'

export const ICON_STYLES: readonly IconStyle[] = ['nerd', 'emoji', 'ascii']
export const DEFAULT_ICON_STYLE: IconStyle = 'nerd'

/** Nerd Fonts: Font Awesome `nf-fa-github` (U+F09B) and Material Design `nf-md-gmail` (U+F02AB). */
export const ICONS: Record<Source, Record<IconStyle, string>> = {
  github: { nerd: '', emoji: '🐙', ascii: 'GH' },
  gmail: { nerd: '\u{F02AB}', emoji: '✉', ascii: '@' },
}

/** Brand colours where the mark has one the terminal should keep (Gmail red); GitHub's mark is the plain text colour. */
export const BRAND: Partial<Record<Source, string>> = { gmail: '#EA4335' }

export const sourceOf = (kind: WatchKind): Source => (kind === 'mail' ? 'gmail' : 'github')

export const iconFor = (source: Source, style: IconStyle | undefined): string => ICONS[source][style ?? DEFAULT_ICON_STYLE]

/** `nerd`, `emoji` or `ascii` (any case), else null. */
export const parseIconStyle = (s: string): IconStyle | null => {
  const t = s.trim().toLowerCase()

  return (ICON_STYLES as readonly string[]).includes(t) ? (t as IconStyle) : null
}
