import type { EngineInterface, Register } from 'claude-code'
import { compacted, forkAnchor, type SentDuringTurn } from './compaction'
import { skillsSection } from './skills'
import { SUMMARY_PROMPT, headText } from './summary-prompt'

const FORK_MARGIN = 40_000 // tokens before the threshold, also the tail kept verbatim: forks took 13-47 s, p90 growth ~14k a minute (E1-D6)
const MAX_MARGIN_SHARE = 0.2 // with a small threshold, a long tail would leave little room after compaction
const RETRY_AFTER = 20_000 // tokens of growth before another fork after a failed one
const TICK_MS = 5_000
const THRESHOLD_TTL_MS = 60_000

let threshold: number | undefined
let thresholdReadAt = -Infinity
let generation = 0
let busy = false
let retryAt = 0
let ready: { summary: string; anchor: string; tokens: number } | undefined
let transcriptPath: string | undefined
const logLines = new Map<string, string[]>()
let lastResult: string | undefined // tool_use_id of the main conversation's newest tool result
const sentAfter = new Map<string, SentDuringTurn>() // messages sent while a turn ran, by the result each was filed after
const typedWithMedia = new Set<string>() // prompts typed during a turn with an image, until the engine files them
const shownErrors = new Set<string>()

/** Drops what was prepared: after any compaction, `/clear` or a resume it describes another conversation. */
function reset() {
  generation++
  ready = undefined
  sentAfter.clear() // what was sent is in the summary or in the messages kept
  retryAt = 0
  shownErrors.clear() // once per reason in a cycle, not once per process
}

/**
 * Appends an event to `$LIVE_COMPACT_LOG_DIR/<session id>.jsonl`; does nothing when the variable is unset.
 * Never rejects: the log must not stop a fork or a compaction.
 */
async function log($: EngineInterface, event: Record<string, unknown>) {
  try {
    const dir = await $.env.get('LIVE_COMPACT_LOG_DIR')
    if (!dir) return
    const id = await $.session.id()
    const lines = logLines.get(id) ?? []
    logLines.set(id, lines)
    lines.push(JSON.stringify({ t: await $.clock.now(), ...event }))
    await $.fs.write(`${dir}/${id}.jsonl`, lines.join('\n') + '\n')
  } catch {
    // dropped: see above
  }
}

/** One line in the transcript (not sent to the model) for a failed tick or fork, once per distinct message. */
function showError($: EngineInterface, message: string) {
  if (shownErrors.has(message)) return
  shownErrors.add(message)
  $.ui.log(`live-compact: background summary failed: ${message}`)
}

async function tick($: EngineInterface) {
  if (busy || ready) return
  busy = true
  try {
    await prepare($)
  } finally {
    busy = false
  }
}

/** Starts the background fork once the context is within the margin of the threshold. */
async function prepare($: EngineInterface) {
  const gen = generation // before any read: a compaction during the reads makes this fork stale
  const now = await $.clock.now()
  if (now - thresholdReadAt > THRESHOLD_TTL_MS) {
    const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
    threshold = breakdown?.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined
    thresholdReadAt = now
  }
  if (threshold === undefined) return
  const { tokens } = (await $.session.usage()).context
  if (!tokens || tokens < Math.max(retryAt, threshold - Math.min(FORK_MARGIN, threshold * MAX_MARGIN_SHARE))) return
  const rows = await $.session.messages() // rows first: see forkAnchor
  const anchor = forkAnchor(rows, await $.session.messages({ as: 'api' }))
  if (anchor === undefined || gen !== generation) return

  retryAt = tokens + RETRY_AFTER // stands if the fork fails or throws
  await log($, { ev: 'fork-start', tokens, threshold })
  const res = await $.model.fork({ prompt: SUMMARY_PROMPT })
  const summary = res.isAnswered ? res.text.trim() : ''
  const failure = res.isAnswered ? (summary ? undefined : 'empty-reply') : res.reason === 'api-error' ? `api-error ${res.status}` : res.reason
  const stale = gen !== generation
  if (!stale && summary) ready = { summary, anchor, tokens }
  else if (!stale && failure === 'aborted') retryAt = 0
  else if (!stale && failure) showError($, failure)
  const u = 'usage' in res ? res.usage : undefined
  await log($, {
    ev: 'fork-end',
    ms: (await $.clock.now()) - now,
    stale,
    ...(res.isAnswered ? { chars: summary.length } : { reason: res.reason }),
    ...(u ? { usage: u, ctx: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens } : {}),
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    $.clock.every(TICK_MS, () =>
      void tick($).catch(err => {
        showError($, String(err))
        void log($, { ev: 'tick-error', message: String(err) })
      }),
    )
    return r
  })

  // A message sent while a turn runs is filed beside the next tool result, out of the compact hook's
  // messages; rebuilding that result would drop it, so it is kept here (E0-T4).
  on('prompt.submit', async ($, e, next) => {
    if (e.turnId && e.attachments?.length) typedWithMedia.add(e.text)
    return next(e)
  })

  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const id = e.message.content.findLast(b => b.type === 'tool_result')?.tool_use_id
    if (!e.agentId && typeof id === 'string') lastResult = id
    return next(e)
  })

  on('session.append', { door: 'delivery' }, async ($, e, next) => {
    if (!e.agentId && e.message.name === 'queued_command' && lastResult) {
      const text = e.message.content.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')
      const typed = [...typedWithMedia].find(t => text.includes(t))
      if (typed !== undefined) typedWithMedia.delete(typed)
      const earlier = sentAfter.get(lastResult)
      sentAfter.set(lastResult, { text: [earlier?.text, text].filter(Boolean).join('\n\n'), media: !!earlier?.media || typed !== undefined })
    }
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    // A main compaction resets in session.compact; a subagent's start or compaction is not this conversation.
    if (e.agent_id || e.source === 'compact') return next(e)
    transcriptPath = e.transcript_path || undefined
    if (e.source !== 'startup') reset()
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId) return next(e)
    if (e.trigger === 'precompute') return { skip: 'live-compact prepares its own summary' }
    const prepared = ready
    const sent = new Map(sentAfter)
    reset()
    const eligible = e.trigger === 'auto' || (e.trigger === 'manual' && !e.instructions)
    const skills = prepared && eligible ? skillsSection(await $.session.messages({ as: 'api' })) : undefined
    const result = prepared && skills ? compacted(e.messages, prepared.anchor, headText(prepared.summary, transcriptPath, skills.text), sent) : undefined
    const own = result && 'messages' in result ? result.messages : undefined
    const { tokens } = (await $.session.usage()).context
    void log($, {
      ev: 'compact',
      trigger: e.trigger,
      prepared: !!prepared,
      own: !!own,
      kept: own ? own.length - 1 : 0,
      of: e.messages.length,
      ...(own && skills ? { skills: skills.skills, skillCalls: e.messages.filter(m => m.toolUses.some(u => u.tool === 'Skill')).length } : {}),
      ...(own && skills?.omitted ? { skillsOmitted: skills.omitted } : {}),
      ...(sent.size ? { sentDuringTurn: sent.size } : {}),
      ...(prepared && tokens ? { tail: tokens - prepared.tokens } : {}),
      ...(result && 'reason' in result ? { reason: result.reason } : {}),
    })
    if (own) $.ui.log(`live-compact: compacted with the summary prepared in the background; ${own.length - 1} recent messages kept verbatim; skills carried over: ${skills?.skills ?? 0}`)
    else if (eligible) $.ui.log(`live-compact: ${result && 'reason' in result ? `summary not used (${result.reason})` : 'no summary ready yet'}; standard compaction`)
    if (own) {
      reset() // a fork that started while this hook read the conversation read it before compaction
      return { messages: own }
    }
    const r = await next(e)
    reset() // a fork that started while the standard compaction ran read the conversation before it
    return r
  })
}
