// dev-dash: the handoff note written when a session compacts. Pure functions only, so they test
// without a session; register.tsx collects the facts and writes the file.
//
// The note is for the person (or the next session) picking the work up after the conversation was
// squeezed down: where the session was, what it was doing, what it had touched, and the summary
// the compaction kept.

import type { PlanProgress } from '../types'

export const SUMMARY_MAX = 2000
export const FILES_MAX = 15

export type HandoffFacts = {
  at: number
  sessionId: string
  name: string
  repo: string
  branch: string
  cwd: string
  /** What compacted: the person's `/compact`, the engine at its threshold, a plugin. */
  trigger: string
  tokensBefore?: number
  tokensAfter?: number
  plan: PlanProgress | null
  lastTool: string
  /** Files edited in the last 30 minutes, as the heartbeat keeps them. */
  files: readonly string[]
  /** The summary the compaction kept: the text of its first message. */
  summary: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-10-03 16:42` in the machine's time. */
export const stampOf = (at: number) => {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A file name for the note: sortable by time, and safe on every filesystem. */
export const handoffName = (at: number, sessionId: string) => {
  const d = new Date(at)
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

  return `${day}-${sessionId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 8) || 'session'}.md`
}

const tokens = (n: number | undefined) => (n === undefined ? '' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** A cut that says it cut. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…` : s)

export function handoffNote(f: HandoffFacts): string {
  const size = f.tokensBefore !== undefined && f.tokensAfter !== undefined ? ` (${tokens(f.tokensBefore)} -> ${tokens(f.tokensAfter)} tokens)` : ''
  const where = [f.repo, f.branch].filter(Boolean).join('@')
  const lines = [
    `# Handoff: ${f.name || where || f.sessionId}`,
    '',
    `Compacted ${stampOf(f.at)} (${f.trigger})${size}.`,
    where ? `Repo: ${where}${f.cwd ? ` · ${f.cwd}` : ''}` : f.cwd ? `Directory: ${f.cwd}` : '',
    `Resume: \`claude --resume ${f.sessionId}\``,
  ]
  if (f.plan) {
    lines.push('', `## Plan: ${f.plan.done}/${f.plan.total} done`, f.plan.done < f.plan.total && f.plan.current ? `In progress: ${f.plan.current}` : '')
  }
  if (f.lastTool) lines.push('', `Last step: ${f.lastTool}`)
  if (f.files.length > 0) {
    const shown = f.files.slice(0, FILES_MAX)
    lines.push('', '## Files touched recently', ...shown.map(p => `- ${p}`))
    if (f.files.length > shown.length) lines.push(`- … and ${f.files.length - shown.length} more`)
  }
  const summary = f.summary.trim()
  lines.push('', '## What the compaction kept', summary ? clip(summary, SUMMARY_MAX) : '(no summary text)')

  return `${lines.filter((l, i, all) => !(l === '' && all[i - 1] === '') && l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
