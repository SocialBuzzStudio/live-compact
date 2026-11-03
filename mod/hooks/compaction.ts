import type { ApiMessage, SessionMessage } from 'claude-code'

/** A message sent while a turn ran, as the engine filed it, and whether it carried an image. */
export type SentDuringTurn = { text: string; media: boolean }

/**
 * Keys that name user messages alike in `$.session.messages()` and a compact hook's `e.messages`
 * (the first carries no `handle`): the tool_use_id of its result, else its text numbered by
 * occurrence, so a repeated "ok" names one message. Undefined for other messages and for a user
 * message with neither (an image alone).
 */
export function anchorKeys(messages: readonly SessionMessage[]) {
  const seen = new Map<string, number>()
  return messages.map(m => {
    if (m.role !== 'user') return undefined
    const id = m.toolResults?.at(-1)?.tool_use_id
    if (id) return id
    if (!m.text) return undefined
    const n = seen.get(m.text) ?? 0
    seen.set(m.text, n + 1)
    return `${n}:${m.text}`
  })
}

/**
 * The anchor for a fork started now: the last user message before the response in progress, i.e.
 * the end of the request the fork replays. Results of parallel tool calls sit between that
 * response's rows, so the response is found by its first tool_use in the API form, which merges it
 * (read `rows` before `api`: a newer api with a tool_use the rows lack skips the tick, and one
 * without a tool_use has no results yet, so the rows' last user message is the request's end).
 *
 * Undefined while the request may not have been sent (the rows end on a user message), when the
 * anchor has no key, or when the rows may be cut to the newest 4096 and occurrences shift.
 */
export function forkAnchor(rows: readonly SessionMessage[], api: readonly ApiMessage[]) {
  if (rows.at(-1)?.role !== 'assistant' || rows.length >= 4096) return undefined
  const firstUse = api.findLast(m => m.role === 'assistant')?.content.find(b => b.type === 'tool_use')?.id
  const end = firstUse === undefined ? rows.length : rows.findIndex(m => m.toolUses.some(u => u.tool_use_id === firstUse))
  const at = rows.findLastIndex((m, i) => i < end && m.role === 'user')
  return at < 0 ? undefined : anchorKeys(rows)[at]
}

export type Compaction = { messages: SessionMessage[] } | { reason: 'anchor-missing' | 'too-long' | 'image-sent-during-turn' }

/**
 * The conversation after compaction: the head message, then every message after the anchor.
 * Refused unless the anchor is found (keys are unique) and an assistant message follows it, and when
 * the messages may be cut to the newest 4096, as occurrences then shift.
 *
 * A message with tool results goes back without its `handle`: kept whole, the engine links it to
 * the pre-compaction copy of its tool_use, so `--resume` loads the full history (E1-S4). Rebuilt,
 * it would lose a message sent during the turn that the engine keeps beside it, so that one's text
 * (`sent`, by the tool_use_id of the result it came after) joins it; one with an image is refused,
 * as only text goes back.
 */
export function compacted(
  messages: readonly SessionMessage[],
  anchor: string,
  head: string,
  sent: ReadonlyMap<string, SentDuringTurn> = new Map(),
): Compaction {
  if (messages.length >= 4096) return { reason: 'too-long' }
  const hit = anchorKeys(messages).indexOf(anchor)
  if (hit < 0 || messages[hit + 1]?.role !== 'assistant') return { reason: 'anchor-missing' }
  const tail: SessionMessage[] = []
  for (const m of messages.slice(hit + 1)) {
    if (!m.toolResults?.length) {
      tail.push(m)
      continue
    }
    const s = m.toolResults.map(r => sent.get(r.tool_use_id)).find(Boolean)
    if (s?.media) return { reason: 'image-sent-during-turn' }
    tail.push({ role: m.role, text: [m.text, s?.text].filter(Boolean).join('\n\n'), toolUses: [], toolResults: m.toolResults })
  }
  return { messages: [{ role: 'user', text: head, toolUses: [] }, ...tail] }
}
