import type { EngineInterface, Register } from 'claude-code'

const PANE = 'dev-loop'
const TITLE = 'Review'
const PANE_ROWS = 14
const POLL_MS = 1000
const HINT_KEPT_MS = 60_000

// bin/review writes this file for the session that runs it; times are in seconds
export type Live = {
  run: string
  round: number
  status: 'running' | 'done' | 'failed'
  started: number
  ended: number | null
}

type Style = { dimColor?: boolean; italic?: boolean; color?: string }

let live: Live | null = null
let feed: string[] = []
let openedFor = ''

function keyOf(l: Live): string {
  return `${l.run}#${l.round}`
}

export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function headerOf(l: Live, nowMs: number): string {
  const task = l.run.split('/').pop() ?? l.run
  const endMs = l.ended ? l.ended * 1000 : nowMs
  const elapsed = clockOf((endMs - l.started * 1000) / 1000)

  return `${task} · round ${l.round} · ${elapsed} · ${l.status}`
}

/** One style per feed line; a wrapped message's later lines keep its first line's style. */
export function stylesOf(lines: string[]): Style[] {
  let last: Style = {}

  return lines.map(line => {
    const isContinuation = /^ {9}\S/.test(line)
    if (isContinuation) return last

    if (/^\s*\$ /.test(line)) last = { dimColor: true }
    else if (/^\s*think\b/.test(line)) last = { italic: true, dimColor: true }
    else if (/^\s*exit \d+/.test(line)) last = { color: 'warning' }
    else if (/^\s*error\b/.test(line)) last = { color: 'error' }
    else if (/^done in/.test(line)) last = { color: 'success' }
    else if (/^round \d+:/.test(line)) last = { dimColor: true }
    else last = {}

    return last
  })
}

/** The line under the prompt: the round's clock and its latest action. */
export function hintOf(l: Live, lines: string[], nowMs: number): string {
  const head = `review round ${l.round}`
  const latest = [...lines].reverse().find(line => /^\s*(codex|\$|think|error)\b/.test(line))?.trim() ?? ''

  if (l.status === 'failed') return `${head} failed · see review-${l.round}.log`
  if (l.status === 'done') return `${head} · ${lines[lines.length - 1]?.trim() ?? 'done'}`

  return `${head} · ${clockOf(nowMs / 1000 - l.started)} · ${latest}`
}

async function poll($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  const session = await $.session.id()
  const previous = live

  try {
    live = JSON.parse(await $.fs.read(`${home}/.claude/dev-loop/live/${session}.json`)) as Live
    feed = (await $.fs.read(`${live.run}/review-${live.round}.feed`)).split('\n').filter(Boolean)
  } catch {
    // no review in this session yet, or the feed file is not written yet
    if (!live) return
  }

  const isRunning = live?.status === 'running'
  const isNewRound = live !== null && keyOf(live) !== openedFor
  if (isRunning && isNewRound) {
    openedFor = keyOf(live!)
    await $.ui.open({ id: PANE, title: TITLE, rows: PANE_ROWS, closeOnEscape: true })
  }

  const hasEnded = previous?.status === 'running' && !isRunning && keyOf(previous) === keyOf(live!)
  if (hasEnded) await $.ui.close({ id: PANE })

  $.ui.invalidate('ui.render')
}

async function togglePane($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  const isShown = panes.some(pane => pane.id === PANE && pane.isShown && pane.isPlaced)

  if (isShown) {
    await $.ui.close({ id: PANE })
    return
  }

  await $.ui.open({ id: PANE, title: TITLE, rows: PANE_ROWS, closeOnEscape: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(POLL_MS, () => void poll($))

    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!live) return next(e)

    const nowMs = await $.clock.now()
    const isRecent = live.status === 'running' || nowMs - (live.ended ?? 0) * 1000 < HINT_KEPT_MS
    if (!isRecent) return next(e)

    const { Button, Text } = $.ui.resolve(e)
    const color = live.status === 'failed' ? 'error' : live.status === 'done' ? 'success' : undefined

    return (
      <Button key="dev-loop-hint" plain onPress={() => void togglePane($)}>
        <Text wrap="truncate-end" color={color}>{hintOf(live, feed, nowMs)}</Text>
      </Button>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    if (!live) {
      return (
        <Box paddingX={1}>
          <Text dimColor>No review has run in this session.</Text>
        </Box>
      )
    }

    const nowMs = await $.clock.now()
    const rows = Math.max(1, (e.props.scroll?.bodyRows ?? PANE_ROWS) - 1)
    const styles = stylesOf(feed)
    const first = Math.max(0, feed.length - rows)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold wrap="truncate-end">{headerOf(live, nowMs)}</Text>
        {feed.slice(first).map((line, i) => (
          <Text key={`line-${first + i}`} wrap="truncate-end" {...styles[first + i]}>{line}</Text>
        ))}
      </Box>
    )
  })
}
