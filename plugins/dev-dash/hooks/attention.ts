// dev-dash: what needs the person, and which rows the cursor can land on. Pure, so it tests without a
// session. The pane, the band above the prompt and the toasts all draw from attentionOf, so a snooze or a
// dismissal reaches all three.

import type { DashSection, LimitRow, Snapshot } from '../types'
import { type Caps, type Item, type Muting, ids, isMuted, isShown, resumeCommand } from './keys'
import { bytes, collisionsOf, isDiskLow } from './monitor'

/** True when the limit will run out before it resets, at the recent pace. */
export const isLimitAtRisk = (l: LimitRow, now: number) =>
  l.etaMs !== null && (l.resetsAt === null || now + l.etaMs < l.resetsAt)

/** What the Attention section counts, in urgency order, less anything snoozed or dismissed. */
export const attentionOf = (s: Snapshot, m: Muting) => {
  const keep = <T,>(list: readonly T[], id: (t: T) => string) => list.filter(t => !isMuted(m, id(t)))
  const all = {
    waiting: s.sessions.filter(r => r.state === 'waiting'),
    stuck: s.sessions.filter(r => r.stuck),
    risky: s.sessions.filter(r => r.risky),
    disks: (s.disks ?? []).filter(isDiskLow),
    collisions: collisionsOf(s.sessions),
    limits: (s.limits ?? []).filter(l => l.pct >= 90 || isLimitAtRisk(l, m.now)),
    failing: (s.prs?.mine ?? []).filter(p => p.ci === 'failing' || p.conflicts),
    reviews: s.prs?.toReview ?? [],
  }
  const waiting = keep(all.waiting, ids.wait)
  const stuck = keep(all.stuck, ids.stuck)
  const risky = keep(all.risky, ids.risky)
  const disks = keep(all.disks, ids.disk)
  const collisions = keep(all.collisions, c => ids.clash(c.file))
  const limits = keep(all.limits, ids.limit)
  const failing = keep(all.failing, ids.ci)
  const reviews = keep(all.reviews, ids.review)
  const urgent = waiting.length + stuck.length + risky.length + collisions.length + limits.length + disks.length + failing.length
  const total = urgent + reviews.length
  const before = Object.values(all).reduce((n, list) => n + list.length, 0)

  return { waiting, stuck, risky, collisions, limits, disks, failing, reviews, urgent, total, hidden: before - total }
}

export type Attention = ReturnType<typeof attentionOf>

/** The rows the cursor can land on, in the order the pane draws them. A folded section has none. */
export const itemsOf = (s: Snapshot, att: Attention, folded: readonly DashSection[], caps: Caps): Item[] => {
  const out: Item[] = []
  const resume = (sessionId: string) => resumeCommand(sessionId)

  if (isShown(folded, 'attention')) {
    for (const r of att.waiting) out.push({ id: ids.wait(r), kind: 'attention', copy: resume(r.id), what: 'resume command', canMute: true })
    for (const r of att.stuck) out.push({ id: ids.stuck(r), kind: 'attention', copy: resume(r.id), what: 'resume command', canMute: true })
    for (const r of att.risky) out.push({ id: ids.risky(r), kind: 'attention', copy: resume(r.id), what: 'resume command', canMute: true })
    for (const d of att.disks) out.push({ id: ids.disk(d), kind: 'attention', copy: `disk ${d.name} low: ${bytes(d.freeBytes)} free of ${bytes(d.totalBytes)}`, what: 'disk summary', canMute: true })
    for (const c of att.collisions) out.push({ id: ids.clash(c.file), kind: 'attention', copy: c.file, what: 'file path', canMute: true })
    for (const l of att.limits) out.push({ id: ids.limit(l), kind: 'attention', copy: `${l.kind} limit ${Math.round(l.pct)}%`, what: 'limit summary', canMute: true })
    for (const p of att.failing) out.push({ id: ids.ci(p), kind: 'attention', copy: p.url || `#${p.number}`, what: 'PR link', canMute: true })
    for (const p of att.reviews.slice(0, caps.reviews)) out.push({ id: ids.review(p), kind: 'attention', copy: p.url || `#${p.number}`, what: 'PR link', canMute: true })
  }
  if (isShown(folded, 'sessions')) {
    for (const r of s.sessions.slice(0, caps.sessions)) out.push({ id: ids.session(r), kind: 'session', copy: resume(r.id), what: 'resume command', canMute: false })
  }
  if (isShown(folded, 'agents')) {
    for (const a of (s.agents ?? []).slice(0, caps.agents)) out.push({ id: ids.agent(a), kind: 'agent', copy: resume(a.sessionId), what: 'resume command for its session', canMute: false })
  }
  if (isShown(folded, 'prs') && s.prs && !s.prs.error) {
    for (const p of s.prs.mine) out.push({ id: ids.pr(p), kind: 'pr', copy: p.url || `#${p.number}`, what: 'PR link', canMute: false })
    for (const p of s.prs.toReview) out.push({ id: ids.rv(p), kind: 'review', copy: p.url || `#${p.number}`, what: 'PR link', canMute: false })
  }

  return out
}
