import assert from 'node:assert/strict'
import test from 'node:test'
import { sameItem } from './item-equality.ts'
import type { ChatItem } from './items.tsx'

const bot = (over: Partial<ChatItem> = {}): ChatItem => ({
  kind: 'bot',
  seq: 7,
  text: '你好，这是一条很长的机器人回复。',
  time: 1794000000000,
  ...over,
})

test('sameItem accepts two separate objects with identical fields', () => {
  assert.equal(sameItem(bot(), bot()), true)
  assert.equal(sameItem(bot(), bot()), true)
})

test('sameItem rejects a changed text, time or local state', () => {
  assert.equal(sameItem(bot(), bot({ text: '改了一个字' })), false)
  assert.equal(sameItem(bot(), bot({ time: 1794000000001 })), false)
  assert.equal(sameItem(bot({ local: 'sending' }), bot({ local: 'failed' })), false)
})

test('sameItem rejects a flipped tool status inside a steps item', () => {
  const before = bot({ kind: 'steps', tools: [{ name: 'read', label: '读文件', ok: true }] })
  const after = bot({ kind: 'steps', tools: [{ name: 'read', label: '读文件', ok: false }] })
  assert.equal(sameItem(before, after), false)
  assert.equal(sameItem(before, bot({ kind: 'steps', tools: [{ name: 'read', label: '读文件', ok: true }] })), true)
})

test('sameItem rejects a changed image ref', () => {
  const before = bot({ imageRefs: [{ attachmentId: 'a1', mime: 'image/png', name: 'shot.png' }] })
  const after = bot({ imageRefs: [{ attachmentId: 'a2', mime: 'image/png', name: 'shot.png' }] })
  assert.equal(sameItem(before, after), false)
})

test('sameItem falls back to the exact check for view payloads', () => {
  const before = bot({ kind: 'view', view: { rows: [1, 2] } })
  assert.equal(sameItem(before, bot({ kind: 'view', view: { rows: [1, 2] } })), true)
  assert.equal(sameItem(before, bot({ kind: 'view', view: { rows: [1, 3] } })), false)
})

test('sameItem notices an added field and ignores key order', () => {
  const extra = bot() as ChatItem & { extra?: string }
  extra.extra = 'server sent something new'
  assert.equal(sameItem(bot(), extra), false)
  const reordered = { text: bot().text, time: bot().time, seq: bot().seq, kind: 'bot' as const }
  assert.equal(sameItem(bot(), reordered), true)
})
