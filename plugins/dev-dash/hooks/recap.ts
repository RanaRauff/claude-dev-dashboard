// dev-dash: the pieces of /dash-recap that need no session: reading what git, gh and the heartbeat files say, and
// laying out the short text recap. Pure, so it tests without an engine; recap-run.ts does the reading.

export type RecapSession = { id: string; name: string; cwd: string; branch: string; costUsd: number | null; startedAt: number }
export type RecapCommit = { repo: string; hash: string; subject: string }
export type RecapPr = { repo: string; number: number; title: string }

/** Local midnight at or before `now`. */
export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)

  return d.getTime()
}

/** `2026-10-03` in local time, the form `gh search` takes. */
export function dayStamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The sessions that were active today, from the heartbeat files (`text` is one file's contents, `mtimeMs` its
 * modified time). Files that are not a session row are skipped; a session seen in two files is counted once.
 */
export function sessionsToday(files: readonly { text: string; mtimeMs: number }[], since: number): RecapSession[] {
  const byId = new Map<string, RecapSession>()
  for (const f of files) {
    let row: Record<string, unknown>
    try {
      row = JSON.parse(f.text) as Record<string, unknown>
    } catch {
      continue
    }
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) continue
    const startedAt = typeof row.startedAt === 'number' ? row.startedAt : 0
    const updatedAt = typeof row.updatedAt === 'number' ? row.updatedAt : f.mtimeMs
    if (Math.max(updatedAt, f.mtimeMs, startedAt) < since) continue
    byId.set(row.id, {
      id: row.id,
      name: String(row.name ?? '').trim() || row.id.slice(0, 8),
      cwd: String(row.cwd ?? ''),
      branch: String(row.branch ?? ''),
      costUsd: typeof row.costUsd === 'number' && Number.isFinite(row.costUsd) ? row.costUsd : null,
      startedAt,
    })
  }

  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt)
}

/** `git log --pretty=format:%h%x09%s` output as commits of `repo`. */
export function parseCommits(repo: string, stdout: string): RecapCommit[] {
  const out: RecapCommit[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    out.push({ repo, hash: line.slice(0, tab).trim(), subject: line.slice(tab + 1).trim() })
  }

  return out
}

/** `gh search prs --json number,title,repository` output, or null if it is not that. */
export function parseMerged(stdout: string): RecapPr[] | null {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(json)) return null
  const out: RecapPr[] = []
  for (const j of json as Record<string, unknown>[]) {
    const repo = (j?.repository ?? {}) as Record<string, unknown>
    const number = Number(j?.number)
    if (!Number.isInteger(number)) continue
    out.push({ repo: String(repo.nameWithOwner ?? repo.name ?? ''), number, title: String(j.title ?? '').trim() })
  }

  return out
}

export const money = (usd: number | null) => (usd === null ? '–' : `$${usd.toFixed(2)}`)

const MAX = 10
const more = (n: number) => (n > MAX ? [`  … and ${n - MAX} more`] : [])
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const clock = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export type Recap = {
  day: string
  sessions: RecapSession[]
  /** null when git could not be read. */
  commits: RecapCommit[] | null
  /** null when gh could not be read (not installed, not signed in, offline). */
  merged: RecapPr[] | null
}

/** The short text recap. A part that could not be read says so rather than looking empty. */
export function recapText(r: Recap): string {
  const lines: string[] = [`Recap for ${r.day}`, '']
  const total = r.sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0)
  const priced = r.sessions.some(s => s.costUsd !== null)
  lines.push(`Sessions: ${r.sessions.length === 0 ? 'none seen today' : `${r.sessions.length}${priced ? `, ${money(total)} in all` : ''}`}`)
  for (const s of r.sessions.slice(0, MAX)) {
    lines.push(`  ${s.name}${s.branch ? ` (${s.branch})` : ''} · ${money(s.costUsd)}${s.startedAt ? ` · from ${clock(s.startedAt)}` : ''}`)
  }
  lines.push(...more(r.sessions.length))

  lines.push('')
  if (r.commits === null) lines.push('Commits: could not read git')
  else {
    const repos = new Set(r.commits.map(c => c.repo))
    lines.push(`Commits: ${r.commits.length === 0 ? 'none today' : `${r.commits.length} in ${plural(repos.size, 'repo')}`}`)
    for (const c of r.commits.slice(0, MAX)) lines.push(`  ${c.repo} ${c.hash} ${c.subject}`)
    lines.push(...more(r.commits.length))
  }

  lines.push('')
  if (r.merged === null) lines.push('PRs merged: could not read gh (is it installed and signed in?)')
  else {
    lines.push(`PRs merged: ${r.merged.length === 0 ? 'none today' : r.merged.length}`)
    for (const p of r.merged.slice(0, MAX)) lines.push(`  ${p.repo}#${p.number} ${p.title}`)
    lines.push(...more(r.merged.length))
  }

  return lines.join('\n')
}
