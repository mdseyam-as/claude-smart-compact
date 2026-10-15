import { expect, mock, test } from 'claude-code/testing'

const turn = { answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' as const }
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

function usageAt(tokens: number) {
  return { value: { startedAt: 0, rateLimits: [], context: { tokens, window: 1_000_000, percent: Math.round(tokens / 10000) } } }
}

function haiku(text: string) {
  return { value: { isAnswered: true as const, text, usage } }
}

test('compacts right after the turn at 350k', async ($, on) => {
  const clock = mock.clock(on)
  let compacted = 0
  on('session.usage', () => usageAt(360_000))
  on('model.complete', () => haiku('- path src/a.ts'))
  on('session.compact', () => {
    compacted++
    return { messages: [], tokensBefore: 360_000, tokensAfter: 30_000 }
  })
  await $.turn.complete(turn)
  await clock.advance(2000)
  expect(compacted).toBe(1)
})

test('compacts a finished task after a short pause', async ($, on) => {
  const clock = mock.clock(on)
  let compacted = 0
  on('session.usage', () => usageAt(200_000))
  on('model.complete', (_, e) => haiku(e.prompt.includes('"phase"') ? '{"phase":"done","confidence":0.9}' : '- summary'))
  on('session.compact', () => {
    compacted++
    return { messages: [] }
  })
  await $.turn.complete(turn)
  await clock.advance(61_000)
  expect(compacted).toBe(1)
})

test('mid-work, compacts before a 5-minute cache goes cold', async ($, on) => {
  const clock = mock.clock(on)
  let compacted = 0
  on('session.usage', () => usageAt(200_000))
  on('model.complete', () => haiku('{"phase":"mid","confidence":0.9}'))
  on('session.compact', () => {
    compacted++
    return { messages: [] }
  })
  await $.turn.complete(turn)
  await clock.advance(3 * 60_000)
  expect(compacted).toBe(0)
  await clock.advance(90_000)
  expect(compacted).toBe(1)
})

test('a new turn cancels the pending compaction', async ($, on) => {
  const clock = mock.clock(on)
  let compacted = 0
  on('session.usage', () => usageAt(200_000))
  on('model.complete', () => haiku('{"phase":"mid","confidence":0.9}'))
  on('session.compact', () => {
    compacted++
    return { messages: [] }
  })
  await $.turn.complete(turn)
  await clock.advance(60_000)
  await $.turn.start({ text: 'more', turnId: 't2' } as never)
  await clock.advance(20 * 60_000)
  expect(compacted).toBe(0)
})

test('does nothing below the threshold', async ($, on) => {
  const clock = mock.clock(on)
  let compacted = 0
  on('session.usage', () => usageAt(90_000))
  on('session.compact', () => {
    compacted++
    return { messages: [] }
  })
  await $.turn.complete(turn)
  await clock.advance(60 * 60_000)
  expect(compacted).toBe(0)
})
