import { expect, mock, test } from 'claude-code/testing'

import { clockOf, hintOf, stylesOf } from '../hooks/pane'
import type { Live } from '../hooks/pane'

const RUN = '/home/u/.claude/dev-loop/runs/20261016-1200-retry-backoff'

const PANE = {
  plugin: 'dev-loop',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'dev-loop',
  props: { title: 'Review', isFocused: false, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

const FEED = [
  'round 2: gpt-6-astra/high reads the change',
  '  codex  I will check the fix, then hunt the whole change',
  '         for bugs nobody reported.',
  '  $ cat src/retry.ts',
  '  think  Checking the reset path',
]

test('a wrapped message keeps the style of its first line', () => {
  const styles = stylesOf(FEED)

  expect(styles[1]).toEqual({})
  expect(styles[2]).toEqual({})
  expect(styles[3]).toEqual({ dimColor: true })
  expect(styles[4]).toEqual({ italic: true, dimColor: true })
})

test('the line under the prompt shows the round clock and the latest action, then the verdict', () => {
  const running: Live = { run: RUN, round: 2, status: 'running', started: 1000, ended: null }
  expect(hintOf(running, FEED, 1_075_000)).toBe('review round 2 · 1:15 · think  Checking the reset path')

  const done: Live = { ...running, status: 'done', ended: 1080 }
  const finished = [...FEED, 'done in 80 s: verdict fix, 1 finding · tokens: 20k new, 40k cached, 1.0k out']
  expect(hintOf(done, finished, 1_081_000)).toBe('review round 2 · done in 80 s: verdict fix, 1 finding · tokens: 20k new, 40k cached, 1.0k out')

  expect(clockOf(5)).toBe('0:05')
})

test('the pane opens when a round starts, shows its latest lines, and closes when the round ends', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const calls: string[] = []
  let live: Live = { run: RUN, round: 2, status: 'running', started: 990, ended: null }
  let feed = FEED.join('\n') + '\n'

  on('session.start', () => ({ cwd: '/work' }))
  on('env.get', () => ({ value: '/home/u' }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('/live/s1.json') ? JSON.stringify(live) : feed }))
  on('ui.open', () => {
    calls.push('open')
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    calls.push('close')
    return { value: undefined }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(1000)
  await clock.advance(1000)
  expect(calls).toEqual(['open'])

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '20261016-1200-retry-backoff · round 2 · 0:12 · running' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  think  Checking the reset path' })).toBeDefined()
  // four rows: the header and the last three lines
  expect(await ui.find({ type: 'Text', text: /codex  I will check/ })).toBeUndefined()
  await ui.unmount()

  live = { ...live, status: 'done', ended: 1003 }
  feed += 'done in 13 s: verdict fix, 1 finding\n'
  await clock.advance(1000)
  expect(calls).toEqual(['open', 'close'])
})

test('the pane says so when no review has run', async $ => {
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Text', text: 'No review has run in this session.' })).toBeDefined()
  await ui.unmount()
})
