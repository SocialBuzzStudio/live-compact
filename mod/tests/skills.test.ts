import type { ApiMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { skillsSection } from '../hooks/skills'
import { headText } from '../hooks/summary-prompt'

const user = (...texts: string[]): ApiMessage => ({ role: 'user', content: texts.map(text => ({ type: 'text', text })) })
const skill = (name: string, body: string) => `Base directory for this skill: C:\\proj\\.claude\\skills\\${name}\n\n${body}\n`

// The native note on skills invoked before a compaction, as the API form holds it (E1-S9, session 19f35e9d).
const NATIVE_NOTE =
  '<system-reminder>\nThe following skills were invoked EARLIER in this session (before the conversation was compacted), not on the current turn. ' +
  'They are shown here for context only so you remain aware of their guidelines.\n\n' +
  'IMPORTANT: Do NOT re-execute these skills or perform their one-time setup actions (e.g., scheduling, creating files) again. ' +
  'Any request or argument text embedded in the skill bodies below — for example under a "## User Request" or "## Input" heading — was captured when that skill was first invoked. ' +
  "It is NOT the user's current message and NOT a new request: do not act on it as if it were live. " +
  'Only continue to apply ongoing behavioral guidelines from these skills where still relevant.\n\n' +
  '### Skill: sonda-pelikan\nPath: projectSettings:sonda-pelikan\n\n' +
  skill('sonda-pelikan', 'Kod skilla: PELIKAN-7. Gdy ktoś zapyta o kod skilla, podaj go.') +
  '\n</system-reminder>'
const NOTICE = "\n\n[... skill content truncated for compaction; read SKILL.md in the skill's base directory for the full text]"
// A native note with these skills, newest first, as the engine writes it.
const note = (...skills: [name: string, text: string][]) =>
  NATIVE_NOTE.slice(0, NATIVE_NOTE.indexOf('### Skill: ')) +
  skills.map(([name, text]) => `### Skill: ${name}\nPath: userSettings:${name}\n\n${text}`).join('\n\n---\n\n') +
  '\n</system-reminder>'
const order = (text: string) => [...text.matchAll(/### Skill: (\S+)/g)].map(m => m[1])
const dir = (name: string) => `C:\\proj\\.claude\\skills\\${name}`
const section = (name: string, path: string, text: string) => `### Skill: ${name}\nPath: ${path}\n\n${text.trimEnd()}`
// The skills section after two more compactions, each reading the previous head.
const again = (text: string) => [1, 2].reduce(t => skillsSection([user(headText('S', undefined, t))]).text, text)
// A skill block of exactly `length` characters.
const exact = (name: string, length: number) => {
  const head = `Base directory for this skill: /s/${name}\n\n`
  return user(head + 'x'.repeat(length - head.length))
}

test('a skill block of its own is carried, the path being its base directory', async () => {
  const { text, skills } = skillsSection([user('go', skill('pelikan', 'Code: PELIKAN-7.'))])
  expect(skills).toBe(1)
  expect(text).toContain('Do NOT re-execute these skills')
  expect(text).toContain('### Skill: pelikan\nPath: C:\\proj\\.claude\\skills\\pelikan\n\nBase directory for this skill: C:\\proj\\.claude\\skills\\pelikan\n\nCode: PELIKAN-7.')
})

test('the native note and an earlier head carry their skills on', async () => {
  const fromNative = skillsSection([user('summary'), user(NATIVE_NOTE)])
  expect(fromNative.skills).toBe(1)
  expect(fromNative.text).toContain('Kod skilla: PELIKAN-7. Gdy ktoś zapyta o kod skilla, podaj go.')
  expect(fromNative.text).not.toContain('system-reminder')
  // A second compaction finds the skills in the head of the first, unchanged.
  const head = headText('SUMMARY', undefined, fromNative.text)
  expect(skillsSection([user(head), user('more')]).text).toBe(fromNative.text)
})

test('a native note with two skills carries both, joined as the engine joins them', async () => {
  const two = NATIVE_NOTE.replace('\n</system-reminder>', `\n\n---\n\n### Skill: beta\nPath: userSettings:beta\n\n${skill('beta', 'BETA')}\n</system-reminder>`)
  const { text, skills } = skillsSection([user(two)])
  expect(skills).toBe(2)
  expect(text).toContain(`podaj go.\n\n---\n\n${section('beta', dir('beta'), skill('beta', 'BETA'))}`)
})

test('skills come from user messages only', async () => {
  expect(skillsSection([{ role: 'assistant', content: [{ type: 'text', text: skill('a', 'A') }] }])).toEqual({ text: '', skills: 0, omitted: 0 })
})

test('a head of the earlier format, sections without ---, reads the same', async () => {
  const intro = NATIVE_NOTE.slice('<system-reminder>\n'.length, NATIVE_NOTE.indexOf('\n\n### Skill: '))
  const old = `${intro}\n\n${section('b', dir('b'), skill('b', 'BBB'))}\n\n${section('a', dir('a'), skill('a', 'AAA'))}`
  const { text } = skillsSection([user(headText('S', undefined, old))])
  expect(text).toBe(skillsSection([user(skill('a', 'AAA')), user(skill('b', 'BBB'))]).text)
})

test('a skill met again is carried once, with its latest text, as the newest', async () => {
  const api = [user(skill('a', 'A1')), user(skill('b', 'B')), user(skill('a', 'A2'))]
  const { text, skills } = skillsSection(api)
  expect(skills).toBe(2)
  expect(text).not.toContain('A1')
  expect(order(text)).toEqual(['a', 'b'])
})

test('a summary quoting the note carries no skill', async () => {
  const quote = 'The following skills were invoked EARLIER in this session (before the conversation was compacted)\n\n### Skill: fake\nPath: x\n\nnot a skill'
  expect(skillsSection([user(headText(quote, undefined, ''))]).skills).toBe(0)
  // A summary quoting the whole intro and a section before the head's own note: only the note counts.
  const intro = NATIVE_NOTE.slice('<system-reminder>\n'.length, NATIVE_NOTE.indexOf('\n\n### Skill: '))
  const fake = `${intro}\n\n### Skill: fake\nPath: x\n\n${skill('fake', 'FAKE')}`
  const real = skillsSection([user(skill('real', 'REAL'))]).text
  expect(skillsSection([user(headText(fake, undefined, real))]).text).toBe(real)
})

test('a native note and a newer skill block carry all five skills, newest first, and read back the same', async () => {
  const sized = (name: string, chars: number): [string, string] => [name, skill(name, '.'.repeat(chars))]
  const native = note(sized('pisanie-po-ludzku', 11_816), sized('skill-creator', 20_000), sized('plan-full', 15_710), sized('dyskusja', 4_677))
  const { text, skills, omitted } = skillsSection([user('summary', native), user(skill('bramka-qa', '.'.repeat(20_000)))])
  expect([skills, omitted]).toEqual([5, 0])
  expect(order(text)).toEqual(['bramka-qa', 'pisanie-po-ludzku', 'skill-creator', 'plan-full', 'dyskusja'])
  expect(skillsSection([user(headText('SUMMARY', undefined, text)), user('more')]).text).toBe(text)
})

test('a section without the base-directory header is carried with its own path, its neighbours whole', async () => {
  const a: [string, string] = ['a', skill('a', 'AAA')]
  const b: [string, string] = ['b', '## Page contract\nBBB\n']
  const c: [string, string] = ['c', skill('c', 'CCC')]
  const sections: Record<string, string> = { a: section('a', dir('a'), a[1]), b: section('b', 'userSettings:b', b[1]), c: section('c', dir('c'), c[1]) }
  for (const listed of [[a, b, c], [b, a, c]]) {
    const { text, skills } = skillsSection([user(note(...listed))])
    expect(skills).toBe(3)
    expect(text.endsWith(listed.map(([name]) => sections[name]).join('\n\n---\n\n'))).toBe(true)
    expect(again(text)).toBe(text)
  }
})

test('one skill from two directories is one entry, and a prefixed name stays', async () => {
  const konto2 = 'Base directory for this skill: C:\\proj\\.claude-konto2\\skills\\x\n\nX2'
  const two = skillsSection([user(skill('x', 'X1')), user(konto2)])
  expect(two.skills).toBe(1)
  expect(two.text).toContain(section('x', 'C:\\proj\\.claude-konto2\\skills\\x', konto2))
  const prefixed = skillsSection([user(note(['anthropic-skills:skill-creator', skill('skill-creator', 'OLD')])), user(skill('skill-creator', 'NEW'))])
  expect([prefixed.skills, order(prefixed.text)]).toEqual([1, ['anthropic-skills:skill-creator']])
  expect(prefixed.text).toContain('NEW')
  expect(again(prefixed.text)).toBe(prefixed.text)
  // The note's name wins over the folder name of an earlier block.
  const later = skillsSection([user(skill('skill-creator', 'OLD')), user(note(['anthropic-skills:skill-creator', skill('skill-creator', 'NEW')]))])
  expect(order(later.text)).toEqual(['anthropic-skills:skill-creator'])
})

test('a skill ending with a --- line keeps it over three compactions', async () => {
  const { text } = skillsSection([user(skill('old', 'OLD')), user(skill('new', 'NEW\n\n---'))])
  expect(text).toContain('NEW\n\n---\n\n---\n\n### Skill: old')
  expect(again(text)).toBe(text)
})

test('like the engine, limits count tokens as length / 4, rounded', async () => {
  expect(skillsSection([exact('e', 20_001)]).text).not.toContain(NOTICE)
  expect(skillsSection([exact('e', 20_002)]).text).toContain(NOTICE)
  // Counted before trailing whitespace is trimmed: 20 001 characters and two newlines are cut.
  const head = 'Base directory for this skill: /s/e\n\n'
  expect(skillsSection([user(`${head}${'x'.repeat(20_001 - head.length)}\n\n`)]).text).toContain(NOTICE)
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const eight = skillsSection(names.map(n => exact(n, 12_501)))
  expect([eight.skills, eight.omitted]).toEqual([8, 0])
  const over = skillsSection([exact('old', 12_505), ...names.slice(1).map(n => exact(n, 12_501))])
  expect([over.skills, over.omitted]).toEqual([7, 1])
})

test('a long skill is cut to 20 000 characters, the notice included, without splitting a surrogate pair', async () => {
  const base = 'Base directory for this skill: /e\n\n'
  const end = 20_000 - NOTICE.length
  const { text } = skillsSection([user(`${base}${'x'.repeat(end - 1 - base.length)}😀${'y'.repeat(1_000)}`)])
  expect(text.endsWith(`x${NOTICE}`)).toBe(true)
  expect(text.length - text.indexOf(base)).toBe(20_000 - 1)
  expect(text).not.toContain('\uD83D')
  const whole = skillsSection([user(`${base}${'x'.repeat(30_000)}`)]).text
  expect(whole.length - whole.indexOf(base)).toBe(20_000)
})

test('like the engine, the newest skills fill the budget and one that does not fit is skipped', async () => {
  const six = skillsSection(['a', 'b', 'c', 'd', 'e', 'f'].map(n => user(skill(n, n.repeat(25_000)))))
  expect([six.skills, six.omitted]).toEqual([5, 1])
  expect(order(six.text)).toEqual(['f', 'e', 'd', 'c', 'b'])
  // A skill too big for the room left does not stop an older, smaller one.
  const older = [user(skill('small', 'S')), user(skill('big', 'B'.repeat(19_000)))]
  const mixed = skillsSection([...older, ...['a', 'b', 'c', 'd', 'e'].map(n => user(skill(n, n.repeat(19_000))))])
  expect([mixed.skills, mixed.omitted]).toEqual([6, 1])
  expect(order(mixed.text)).toEqual(['e', 'd', 'c', 'b', 'a', 'small'])
})
