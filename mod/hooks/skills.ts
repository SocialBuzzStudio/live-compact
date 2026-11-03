import type { ApiMessage } from 'claude-code'
import { HEAD_END } from './summary-prompt'

// The engine's limits, in its token estimate (E1-D9).
const SKILL_TOKENS = 5_000 // per skill, the cut notice included
const TOTAL_TOKENS = 25_000 // all skills' text together
const tokens = (text: string) => Math.round(text.length / 4)
const BASE = 'Base directory for this skill: '
const NOTICE = "\n\n[... skill content truncated for compaction; read SKILL.md in the skill's base directory for the full text]"
const INTRO =
  'The following skills were invoked EARLIER in this session (before the conversation was compacted), not on the current turn. ' +
  'They are shown here for context only so you remain aware of their guidelines.\n\n' +
  'IMPORTANT: Do NOT re-execute these skills or perform their one-time setup actions (e.g., scheduling, creating files) again. ' +
  'Any request or argument text embedded in the skill bodies below — for example under a "## User Request" or "## Input" heading — was captured when that skill was first invoked. ' +
  "It is NOT the user's current message and NOT a new request: do not act on it as if it were live. " +
  'Only continue to apply ongoing behavioral guidelines from these skills where still relevant.'
// A skill's section in an earlier head or in the native note; the engine joins sections with a blank line, ---, a blank line.
const SECTION = /(?:\n\n---)?\n\n### Skill: ([^\n]*)\nPath: ([^\n]*)\n\n/g

type Skill = { name: string; path: string; text: string }

/**
 * Skills whose text the main conversation holds, oldest first, one per skill folder as the engine
 * keeps one per name; a skill met again moves to the end with its latest text and keeps its earlier
 * name, which may carry a prefix such as `anthropic-skills:`. A skill's text is a block of its own
 * (the Skill tool, `/name`) or a section of the note on skills invoked before a compaction, an earlier
 * head's or the native one's, all in user messages; a section without the base-directory header keeps
 * its own path. Subagents' skills are not in the main conversation.
 */
function skillsIn(api: readonly ApiMessage[]) {
  const found = new Map<string, Skill>()
  const add = (text: string, section?: { name: string; path: string }) => {
    const dir = text.startsWith(BASE) ? (text.slice(BASE.length).split('\n', 1)[0] ?? '') : undefined
    const key = dir === undefined ? (section?.name ?? '') : (dir.split(/[\\/]/).pop() ?? dir)
    const name = section?.name ?? found.get(key)?.name ?? key
    found.delete(key)
    found.set(key, { name, path: dir ?? section?.path ?? '', text })
  }
  for (const m of api)
    for (const b of m.role === 'user' ? m.content : []) {
      if (b.type !== 'text' || typeof b.text !== 'string') continue
      if (b.text.startsWith(BASE)) add(b.text)
      const at = b.text.lastIndexOf(INTRO) // the whole intro, the last: a summary before the note may quote it
      if (at < 0) continue
      let note = b.text.slice(at)
      const end = Math.max(note.lastIndexOf('\n</system-reminder>'), note.lastIndexOf(HEAD_END))
      if (end > 0) note = note.slice(0, end)
      // The note and the head list the newest skill first, as the engine sorts them.
      const heads = [...note.matchAll(SECTION)]
      heads
        .map((h, i) => ({ name: h[1] ?? '', path: h[2] ?? '', text: note.slice((h.index ?? 0) + h[0].length, heads[i + 1]?.index ?? note.length) }))
        .reverse()
        .forEach(s => add(s.text, s))
    }
  return found
}

/** A skill's text cut as native compaction cuts it, without splitting a surrogate pair. */
function cut(text: string) {
  if (tokens(text) <= SKILL_TOKENS) return text
  const end = SKILL_TOKENS * 4 - NOTICE.length
  return text.slice(0, (text.charCodeAt(end - 1) & 0xfc00) === 0xd800 ? end - 1 : end) + NOTICE
}

/**
 * The native compaction's note on skills invoked earlier, for the skills the main conversation
 * holds, newest first; like the engine, a skill that no longer fits TOTAL_TOKENS is skipped
 * (`omitted`) and older ones may still fit. `text` is empty when none is kept.
 */
export function skillsSection(api: readonly ApiMessage[]) {
  const kept: string[] = []
  let room = TOTAL_TOKENS
  let omitted = 0
  for (const { name, path, text } of [...skillsIn(api).values()].reverse()) {
    const body = cut(text)
    if (tokens(body) > room) {
      omitted++
      continue
    }
    room -= tokens(body) // counted untrimmed, as the engine counts
    kept.push(`### Skill: ${name}\nPath: ${path}\n\n${body.trimEnd()}`)
  }
  return { text: kept.length ? `${INTRO}\n\n${kept.join('\n\n---\n\n')}` : '', skills: kept.length, omitted }
}
