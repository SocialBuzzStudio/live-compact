import type { ApiMessage, ModelForkResult, ModelUsage, On, SessionContextBreakdown, SessionMessage } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

const THRESHOLD = 367_000
const START = THRESHOLD - 40_000

const msg = (role: SessionMessage['role'], text: string, more: Partial<SessionMessage> = {}): SessionMessage => ({ role, text, toolUses: [], ...more })
const call = (id: string) => msg('assistant', '', { toolUses: [{ tool_use_id: id, tool: 'Bash', input: {} }] })
const result = (id: string) => msg('user', '', { toolResults: [{ tool_use_id: id, text: `out ${id}`, isError: false }] })
const handled = (messages: SessionMessage[]) => messages.map((m, i) => ({ ...m, handle: `h${i}` }))

/** The API form of sequential rows: consecutive rows of one role merged, as the engine merges one response's. */
function apiOf(rows: readonly SessionMessage[]): ApiMessage[] {
  const out: ApiMessage[] = []
  for (const m of rows) {
    const blocks = [
      ...(m.text ? [{ type: 'text', text: m.text }] : []),
      ...m.toolUses.map(u => ({ type: 'tool_use', id: u.tool_use_id, name: u.tool, input: {} })),
      ...(m.toolResults ?? []).map(r => ({ type: 'tool_result', tool_use_id: r.tool_use_id, content: r.text })),
    ]
    const last = out.at(-1)
    if (last?.role === m.role) last.content.push(...blocks)
    else out.push({ role: m.role, content: blocks })
  }
  return out
}

// What the session holds when the fork starts: the request ending at result t1 is answered by call t2, still running.
const AT_FORK = [msg('user', 'start'), call('t1'), result('t1'), call('t2')]
// What a compaction later sees: t2 answered and the turn went on.
const AT_COMPACT = handled([...AT_FORK, result('t2'), msg('assistant', 'done')])
const NATIVE = [msg('user', 'native summary')]
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as ModelUsage
const answered: ModelForkResult = { isAnswered: true, text: ' SUMMARY ', usage }

type World = {
  tokens: number
  threshold?: number
  messages?: SessionMessage[]
  api?: ApiMessage[]
  fork?: ModelForkResult | (() => Promise<ModelForkResult>)
  isAutoCompactEnabled?: boolean
  env?: Record<string, string>
}

/** The engine beneath the mod: a session at `tokens`, a fork that answers `fork`, native compaction answering NATIVE. */
function world(on: On, opts: World) {
  const s = {
    tokens: opts.tokens,
    threshold: opts.threshold ?? THRESHOLD,
    messages: opts.messages ?? AT_FORK,
    api: opts.api,
    fork: opts.fork ?? answered,
    forks: 0,
    failMessages: false,
    reads: [] as string[],
    logs: [] as string[],
    files: new Map<string, string>(),
    nativeWait: undefined as Promise<void> | undefined,
    apiWait: undefined as Promise<void> | undefined,
    rowsWait: undefined as Promise<void> | undefined,
  }
  const clock = mock.clock(on)
  mock.env(on, opts.env ?? {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('session.id', () => ({ value: 's1' }))
  on('classic.SessionStart', () => ({}))
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        tokens: s.tokens,
        window: 1_000_000,
        breakdown: e.breakdown
          ? ({ autoCompactThreshold: s.threshold, isAutoCompactEnabled: opts.isAutoCompactEnabled ?? true } as SessionContextBreakdown)
          : undefined,
      },
    },
  }))
  on('session.messages', async (_, e) => {
    if (s.failMessages) throw new Error('boom')
    await (e.as === 'api' ? s.apiWait : s.rowsWait)
    s.reads.push(e.as ?? 'rows')
    return { value: e.as === 'api' ? (s.api ?? apiOf(s.messages)) : s.messages }
  })
  on('model.fork', async () => {
    s.forks++
    return { value: typeof s.fork === 'function' ? await s.fork() : s.fork }
  })
  on('ui.log', (_, e) => {
    s.logs.push(e.text)
    return { value: undefined }
  })
  on('fs.write', (_, e) => {
    s.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.compact', async () => {
    await s.nativeWait
    return { messages: NATIVE }
  })
  return { s, clock }
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: null, isInteractive: false })

test('forks 40k tokens before the threshold and answers the compaction itself', async ($, on) => {
  const { s, clock } = world(on, { tokens: START })
  await start($)
  await $.classic.SessionStart({ source: 'startup', transcript_path: '/t/session.jsonl' })
  await clock.advance(5_000)
  expect(s.forks).toBe(1)

  const r = await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })
  const out = r.messages ?? []
  expect(out[0]?.text).toContain('SUMMARY')
  expect(out[0]?.text).toContain('/t/session.jsonl')
  // The tail starts at the response the fork never saw; tool results go back rebuilt, without a handle.
  expect(out.slice(1).map(m => m.handle)).toEqual(['h3', undefined, 'h5'])
  expect(out[2]?.toolResults?.[0]?.tool_use_id).toBe('t2')
  expect(s.logs).toEqual(['live-compact: compacted with the summary prepared in the background; 3 recent messages kept verbatim; skills carried over: 0'])
})

test('does not fork below the start', async ($, on) => {
  const { s, clock } = world(on, { tokens: START - 1 })
  await start($)
  await clock.advance(5_000)
  expect(s.forks).toBe(0)
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)
  expect(s.logs).toEqual(['live-compact: no summary ready yet; standard compaction'])
})

test('with a small threshold the margin is 20% of it', async ($, on) => {
  const { s, clock } = world(on, { tokens: 79_999, threshold: 100_000 })
  await start($)
  await clock.advance(5_000)
  expect(s.forks).toBe(0)
  s.tokens = 80_000
  await clock.advance(5_000)
  expect(s.forks).toBe(1)
})

test('reads the threshold again after a minute', async ($, on) => {
  const { s, clock } = world(on, { tokens: 300_000 })
  await start($)
  await clock.advance(5_000)
  s.threshold = 320_000
  await clock.advance(5_000)
  expect(s.forks).toBe(0)
  await clock.advance(60_000)
  expect(s.forks).toBe(1)
})

test('does not fork with auto-compaction off', async ($, on) => {
  const { s, clock } = world(on, { tokens: START, isAutoCompactEnabled: false })
  await start($)
  await clock.advance(5_000)
  expect(s.forks).toBe(0)
})

test('waits while the conversation ends on a user message', async ($, on) => {
  const { s, clock } = world(on, { tokens: START, messages: AT_FORK.slice(0, 3) })
  await start($)
  await clock.advance(5_000)
  expect(s.forks).toBe(0)
  s.messages = AT_FORK
  await clock.advance(5_000)
  expect(s.forks).toBe(1)
})

test('anchors parallel tool calls at the request, not at a result inside the response', async ($, on) => {
  // One response calls A, B and C; A's and B's results already sit between its rows.
  const rows = [msg('user', 'go'), msg('assistant', ''), call('A'), result('A'), call('B'), result('B'), call('C')]
  const api: ApiMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: ['A', 'B', 'C'].map(id => ({ type: 'tool_use', id, name: 'Read', input: {} })) },
    { role: 'user', content: ['A', 'B'].map(id => ({ type: 'tool_result', tool_use_id: id, content: '' })) },
  ]
  const { s, clock } = world(on, { tokens: START, messages: rows, api })
  await start($)
  await clock.advance(5_000)
  expect(s.forks).toBe(1)
  const out = (await $.session.compact({ trigger: 'auto', messages: handled([...rows, result('C'), msg('assistant', 'done')]) })).messages ?? []
  expect(out.slice(1).map(m => m.toolUses[0]?.tool_use_id ?? m.toolResults?.[0]?.tool_use_id ?? m.text)).toEqual(['', 'A', 'A', 'B', 'B', 'C', 'C', 'done'])
})

test('reads the rows before the API form, and skips a tick whose API form has a call the rows lack', async ($, on) => {
  const rows = [msg('user', 'go'), msg('assistant', '')]
  const api: ApiMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'A', name: 'Read', input: {} }] },
  ]
  const { s, clock } = world(on, { tokens: START, messages: rows, api })
  await start($)
  await clock.advance(5_000)
  expect(s.reads).toEqual(['rows', 'api'])
  expect(s.forks).toBe(0)
})

test('no fork while the anchor has no key or the rows may be cut', async ($, on) => {
  const { s, clock } = world(on, { tokens: START, messages: [msg('user', ''), msg('assistant', 'a')] })
  await start($)
  await clock.advance(5_000)
  s.messages = [...Array.from({ length: 4094 }, (_, i) => msg('user', `m${i}`)), ...AT_FORK.slice(2)]
  await clock.advance(5_000)
  expect(s.forks).toBe(0)
})

test('a repeated text names one message: the anchor is its last occurrence', async ($, on) => {
  const rows = [msg('user', 'ok'), msg('assistant', 'a'), msg('user', 'ok'), msg('assistant', 'b')]
  const { s, clock } = world(on, { tokens: START, messages: rows })
  await start($)
  await clock.advance(5_000)
  expect(s.forks).toBe(1)
  const out = (await $.session.compact({ trigger: 'auto', messages: handled([...rows, msg('user', 'ok'), msg('assistant', 'c')]) })).messages ?? []
  expect(out.slice(1).map(m => m.text)).toEqual(['b', 'ok', 'c'])
})

test('falls back to native compaction when the anchor is gone', async ($, on) => {
  const { s, clock } = world(on, { tokens: START })
  await start($)
  await clock.advance(5_000)
  const rewound = handled([msg('user', 'start'), call('t1'), result('t1x'), msg('assistant', 'x')])
  expect((await $.session.compact({ trigger: 'auto', messages: rewound })).messages).toEqual(NATIVE)
  expect(s.logs).toEqual(['live-compact: summary not used (anchor-missing); standard compaction'])
})

test('falls back to native compaction when the messages may be cut', async ($, on) => {
  const { s, clock } = world(on, { tokens: START })
  await start($)
  await clock.advance(5_000)
  const long = handled([...Array.from({ length: 4090 }, (_, i) => msg('user', `m${i}`)), ...AT_COMPACT])
  expect((await $.session.compact({ trigger: 'auto', messages: long })).messages).toEqual(NATIVE)
  expect(s.logs).toEqual(['live-compact: summary not used (too-long); standard compaction'])
})

test('after a failed fork, tries again only 20k tokens later', async ($, on) => {
  const failed: ModelForkResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage }
  const { s, clock } = world(on, { tokens: START, fork: failed })
  await start($)
  await clock.advance(5_000)
  s.tokens = START + 19_999
  await clock.advance(5_000)
  expect(s.forks).toBe(1)
  s.tokens = START + 20_000
  await clock.advance(5_000)
  expect(s.forks).toBe(2)
  expect(s.logs).toEqual(['live-compact: background summary failed: api-error 529'])
})

test('an empty fork reply is a failure; an aborted fork is retried at once', async ($, on) => {
  const { s, clock } = world(on, { tokens: START, fork: { isAnswered: true, text: '  ', usage } })
  await start($)
  await clock.advance(5_000)
  await clock.advance(5_000)
  expect(s.forks).toBe(1)
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)

  s.fork = { isAnswered: false, reason: 'aborted', usage }
  await clock.advance(5_000)
  await clock.advance(5_000)
  expect(s.forks).toBe(3)
  expect(s.logs.filter(l => l.includes('failed'))).toEqual(['live-compact: background summary failed: empty-reply'])
})

test('one fork at a time, and a fork that ends after a compaction is dropped', async ($, on) => {
  let release: (r: ModelForkResult) => void = () => undefined
  const { s, clock } = world(on, { tokens: START, fork: () => new Promise(r => (release = r)) })
  await start($)
  await clock.advance(5_000)
  s.tokens = START + 20_000 // past retryAt: only the running fork holds the next one back
  await clock.advance(5_000)
  expect(s.forks).toBe(1)
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)
  release(answered)
  await clock.advance(1)
  s.fork = answered
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)
})

test('a fork that starts during a standard compaction is dropped', async ($, on) => {
  let finish = () => {}
  const { s, clock } = world(on, { tokens: START })
  s.nativeWait = new Promise(r => (finish = r))
  await start($)
  const native = $.session.compact({ trigger: 'manual', instructions: 'keep X', messages: AT_COMPACT })
  await clock.advance(5_000)
  expect(s.forks).toBe(1)
  finish()
  expect((await native).messages).toEqual(NATIVE)
  s.nativeWait = undefined
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)
})

test('a /clear, a resume or a fork drops the prepared summary', async ($, on) => {
  const { clock } = world(on, { tokens: START })
  await start($)
  for (const source of ['clear', 'resume', 'fork'] as const) {
    await clock.advance(5_000)
    await $.classic.SessionStart({ source })
    expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)
  }
})

test('a subagent starting or compacting keeps the main summary and transcript', async ($, on) => {
  const { clock } = world(on, { tokens: START })
  await start($)
  await $.classic.SessionStart({ source: 'startup', transcript_path: '/t/session.jsonl' })
  await clock.advance(5_000)
  await $.classic.SessionStart({ source: 'compact', agent_id: 'a1', transcript_path: '/t/sub.jsonl' })
  await $.classic.SessionStart({ source: 'startup', agent_id: 'a1', transcript_path: '/t/sub.jsonl' })
  // The main conversation's own compaction resets in session.compact, not here.
  await $.classic.SessionStart({ source: 'compact', transcript_path: '/t/after.jsonl' })
  const head = (await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages?.[0]?.text
  expect(head).toContain('SUMMARY')
  expect(head).toContain('/t/session.jsonl')
})

test('a fork that starts while the compaction hook reads the conversation is dropped', async ($, on) => {
  let release = () => {}
  const { s, clock } = world(on, { tokens: START })
  await start($)
  await clock.advance(5_000)
  s.apiWait = new Promise(r => (release = r))
  const own = $.session.compact({ trigger: 'auto', messages: AT_COMPACT })
  await clock.advance(5_000) // a tick while the hook waits on the API form
  release()
  expect((await own).messages?.[0]?.text).toContain('SUMMARY')
  await clock.advance(1)
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)
})

test('a tick whose reads span a compaction neither forks nor holds the next fork back', async ($, on) => {
  let release = () => {}
  const { s, clock } = world(on, { tokens: START })
  await start($)
  s.rowsWait = new Promise(r => (release = r))
  await clock.advance(5_000) // the tick waits on the rows
  await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })
  release()
  s.rowsWait = undefined
  await clock.advance(5_000)
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages?.[0]?.text).toContain('SUMMARY')
})

test('a failed fork is shown again in the next cycle', async ($, on) => {
  const failed: ModelForkResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage }
  const { s, clock } = world(on, { tokens: START, fork: failed })
  await start($)
  await clock.advance(5_000)
  await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })
  await clock.advance(5_000)
  expect(s.logs.filter(l => l.includes('failed'))).toHaveLength(2)
})

test('a summary serves one compaction only', async ($, on) => {
  const { clock } = world(on, { tokens: START })
  await start($)
  await clock.advance(5_000)
  await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)
})

/** A tool result filed in the main conversation, as the engine files one. */
const resultFiled = ($: Engine, id: string) =>
  $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `out ${id}` }] },
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Bash' },
    uuid: `r-${id}`,
  })

/** A message typed while the turn ran: the person's Enter, then the row the engine files after the result that takes it in. */
async function sendDuringTurn($: Engine, text: string, image = false) {
  await $.prompt.submit({ text, turnId: 'turn-1', wait: false, origin: { kind: 'composer' }, ...(image ? { attachments: [{ type: 'image' as const }] } : {}) })
  await $.session.append({
    message: {
      type: 'attachment',
      name: 'queued_command',
      role: 'user',
      content: [{ type: 'text', text: `<system-reminder>
The user sent a new message while you were working:
${text}
</system-reminder>` }],
    },
    door: 'delivery',
    origin: { kind: 'composer' },
    uuid: `q-${text}`,
  })
}

test('a message sent during the turn after the fork stays once, with the result it came after', async ($, on) => {
  const { clock } = world(on, { tokens: START })
  await start($)
  await resultFiled($, 't1')
  await sendDuringTurn($, 'seen by the fork')
  await clock.advance(5_000)
  await resultFiled($, 't2')
  await sendDuringTurn($, 'PELIKAN-9')
  const out = (await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages ?? []
  expect(out[0]?.text).toContain('SUMMARY')
  expect(out.slice(1).map(m => m.text.includes('PELIKAN-9'))).toEqual([false, true, false])
  expect(out.some(m => m.text.includes('seen by the fork'))).toBe(false)
  // The next compaction finds it in the rebuilt message, not again beside it.
  await clock.advance(5_000)
  const again = (await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages ?? []
  expect(again.slice(1).map(m => m.text)).toEqual(['', '', 'done'])
})

test('a message typed with an image during the turn after the fork means a standard compaction', async ($, on) => {
  const { s, clock } = world(on, { tokens: START })
  await start($)
  await clock.advance(5_000)
  await resultFiled($, 't2')
  await sendDuringTurn($, 'see the screenshot', true)
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages).toEqual(NATIVE)
  expect(s.logs).toEqual(['live-compact: summary not used (image-sent-during-turn); standard compaction'])
})

test('leaves subagents, precompute, plugins and /compact with instructions to the engine', async ($, on) => {
  const { clock } = world(on, { tokens: START })
  await start($)
  await clock.advance(5_000)
  expect((await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: AT_COMPACT })).messages).toEqual(NATIVE)
  expect(await $.session.compact({ trigger: 'precompute', messages: AT_COMPACT })).toEqual({ skip: 'live-compact prepares its own summary' })
  expect((await $.session.compact({ trigger: 'manual', instructions: 'keep X', messages: AT_COMPACT })).messages).toEqual(NATIVE)
  await clock.advance(5_000)
  expect((await $.session.compact({ trigger: 'plugin', messages: AT_COMPACT })).messages).toEqual(NATIVE)
})

test('a /compact without instructions uses the summary', async ($, on) => {
  const { clock } = world(on, { tokens: START })
  await start($)
  await clock.advance(5_000)
  expect((await $.session.compact({ trigger: 'manual', messages: AT_COMPACT })).messages?.[0]?.text).toContain('SUMMARY')
})

test('the head carries the skills the conversation holds, with no hook having seen them', async ($, on) => {
  const pelikan = 'Base directory for this skill: /s/pelikan\n\nCode: PELIKAN-7.'
  const api = [...apiOf(AT_FORK), { role: 'user' as const, content: [{ type: 'text', text: pelikan }] }]
  const { s, clock } = world(on, { tokens: START, api, env: { LIVE_COMPACT_LOG_DIR: '/logs' } })
  await start($)
  await $.classic.SessionStart({ source: 'resume' })
  await clock.advance(5_000)
  const skillCall = msg('assistant', '', { toolUses: [{ tool_use_id: 'sk', tool: 'Skill', input: {} }] })
  const messages = handled([...AT_FORK, result('t2'), skillCall, result('sk'), msg('assistant', 'done')])
  const head = (await $.session.compact({ trigger: 'auto', messages })).messages?.[0]?.text ?? ''
  expect(head).toContain('### Skill: pelikan\nPath: /s/pelikan\n\nBase directory for this skill: /s/pelikan')
  expect(s.logs[0]).toContain('skills carried over: 1')
  await clock.advance(1) // the compact event is logged without waiting
  expect([...s.files.values()][0]).toContain('"skills":1,"skillCalls":1')
  expect([...s.files.values()][0]).not.toContain('skillsOmitted')
})

test('the compact event logs the skills left out of the budget', async ($, on) => {
  const big = ['a', 'b', 'c', 'd', 'e', 'f'].map(n => ({ role: 'user' as const, content: [{ type: 'text', text: `Base directory for this skill: /s/${n}\n\n${n.repeat(25_000)}` }] }))
  const { s, clock } = world(on, { tokens: START, api: [...apiOf(AT_FORK), ...big], env: { LIVE_COMPACT_LOG_DIR: '/logs' } })
  await start($)
  await clock.advance(5_000)
  await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })
  await clock.advance(1)
  expect([...s.files.values()][0]).toContain('"skills":5,"skillCalls":0,"skillsOmitted":1')
})

test('without a transcript path the head names none', async ($, on) => {
  const { clock } = world(on, { tokens: START })
  await start($)
  await clock.advance(5_000)
  expect((await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })).messages?.[0]?.text).not.toContain('full transcript')
})

test('logs to LIVE_COMPACT_LOG_DIR and shows a failing tick once', async ($, on) => {
  const { s, clock } = world(on, { tokens: START, env: { LIVE_COMPACT_LOG_DIR: '/logs' }, fork: { ...answered, usage: { ...usage, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } } })
  await start($)
  // The engine resolves the path natively (C:\logs\s1.jsonl on Windows).
  const logFile = () => [...s.files].find(([path]) => /[\\/]logs[\\/]s1\.jsonl$/.test(path))?.[1]
  await clock.advance(5_000)
  expect(logFile()).toContain('"ev":"fork-end"')
  expect(logFile()).toContain('"ctx":6')
  s.tokens = START + 5_000
  await $.session.compact({ trigger: 'auto', messages: AT_COMPACT })
  await clock.advance(1)
  expect(logFile()).toContain('"tail":5000')
  s.failMessages = true
  await clock.advance(5_000)
  await clock.advance(5_000)
  // The engine reports a throwing hook as missing; the message is its, shown once over two ticks.
  expect(s.logs.filter(l => l.startsWith('live-compact: background summary failed: '))).toHaveLength(1)
  expect(logFile()).toContain('"ev":"tick-error"')
})
