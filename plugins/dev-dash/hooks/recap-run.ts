// dev-dash: /dash-recap, a short text recap of today. Reads only what dev-dash already keeps (the heartbeat files)
// plus `git log` in the folders those sessions worked in and `gh search prs` for what you merged; nothing is
// written, no transcripts are read. The reading is passed in so register.tsx only has to wire it up.

import { dayStamp, parseCommits, parseMerged, recapText, sessionsToday, startOfDay } from './recap'
import type { RecapCommit, RecapSession } from './recap'

export type RecapDeps = {
  /** Where the heartbeat files are. */
  dir: string
  /** The folder this session is in, always included. */
  cwd: string
  fs: {
    list: (dir: string) => Promise<{ kind: string; name: string; mtimeMs: number }[]>
    read: (path: string) => Promise<string>
  }
  /** Stdout of `git <args>`, or null if it could not run or failed. */
  git: (args: string[]) => Promise<string | null>
  /** Stdout of `gh <args>`, or null if it could not run or failed. */
  gh: (args: string[]) => Promise<string | null>
  now: number
}

const MAX_REPOS = 6
const MAX_FILES = 200

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

export async function recapNow(d: RecapDeps): Promise<string> {
  const since = startOfDay(d.now)

  const entries = await d.fs.list(d.dir).catch(() => [])
  const files: { text: string; mtimeMs: number }[] = []
  for (const f of entries.filter(e => e.kind === 'file' && e.name.endsWith('.json') && e.mtimeMs >= since).slice(0, MAX_FILES)) {
    try {
      files.push({ text: await d.fs.read(`${d.dir}/${f.name}`), mtimeMs: f.mtimeMs })
    } catch {}
  }
  const sessions: RecapSession[] = sessionsToday(files, since)

  // One repository per working folder, found by its top level so two sessions in one repo count once.
  const folders = [...new Set([d.cwd, ...sessions.map(s => s.cwd)].filter(Boolean))].slice(0, MAX_REPOS * 2)
  const seen = new Set<string>()
  const commits: RecapCommit[] = []
  let gitWorked = false
  for (const folder of folders) {
    if (seen.size >= MAX_REPOS) break
    const top = (await d.git(['-C', folder, 'rev-parse', '--show-toplevel']))?.trim()
    if (!top || seen.has(top)) continue
    seen.add(top)
    gitWorked = true
    // "Mine" is whatever this repository's own configured email says; with none set there is nothing to match.
    const email = (await d.git(['-C', top, 'config', 'user.email']))?.trim()
    if (!email) continue
    const log = await d.git(['-C', top, 'log', `--since=${dayStamp(since)} 00:00`, `--author=${email}`, '--no-merges', '--pretty=format:%h%x09%s'])
    if (log) commits.push(...parseCommits(baseName(top), log))
  }

  const merged = await d.gh(['search', 'prs', '--author', '@me', '--merged-at', `>=${dayStamp(since)}`, '--json', 'number,title,repository', '--limit', '30'])

  return recapText({
    day: new Date(d.now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    sessions,
    commits: gitWorked ? commits : folders.length === 0 ? [] : null,
    merged: merged === null ? null : parseMerged(merged),
  })
}
