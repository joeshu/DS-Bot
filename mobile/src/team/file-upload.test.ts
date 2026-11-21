import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FILE_CHUNK_BYTES } from '../../../ds-bot/src/shared/file-chunks.js'
import { bytesToBase64, humanSize, uploadFile, type FileSource } from './file-upload.ts'

// A file held in memory, streamed in small pieces like a disk read would.
function memorySource(bytes: Uint8Array, name = 'notes.txt', mimeType = 'text/plain'): FileSource {
  return {
    name,
    size: bytes.length,
    mimeType,
    stream: async function* () {
      const piece = 64 * 1024
      for (let at = 0; at < bytes.length; at += piece) yield bytes.subarray(at, Math.min(bytes.length, at + piece))
    },
  }
}

// A fake computer that keeps what it is sent, the way the host's file-upload does.
function fakeHost() {
  const received: { offset: number; data: string; done: boolean }[] = []
  let size = 0
  const call = async (endpoint: string, payload: object) => {
    const body = payload as Record<string, unknown>
    assert.equal(endpoint, 'file-upload')
    if (body.uploadId === undefined) {
      size = Number(body.size)
      return { uploadId: 'u1', nextOffset: 0 }
    }
    const offset = Number(body.offset)
    const data = String(body.data)
    const bytes = Buffer.from(data, 'base64')
    assert.equal(offset, received.reduce((sum, chunk) => sum + Buffer.from(chunk.data, 'base64').length, 0))
    received.push({ offset, data, done: body.done === true })
    const nextOffset = offset + bytes.length
    if (body.done === true || nextOffset === size) {
      return { uploadId: 'u1', path: '/root/.dsh/bot/uploads/notes.txt', name: 'notes.txt', size, done: true }
    }
    return { uploadId: 'u1', nextOffset, done: false }
  }
  const reassembled = () => Buffer.concat(received.map(chunk => Buffer.from(chunk.data, 'base64')))
  return { call, received, reassembled }
}

test('bytesToBase64 matches Buffer for every length residue', () => {
  for (let length = 0; length < 12; length += 1) {
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i += 1) bytes[i] = (i * 37 + 11) % 256
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'))
  }
  const big = new Uint8Array(70000)
  for (let i = 0; i < big.length; i += 1) big[i] = i % 251
  assert.equal(bytesToBase64(big), Buffer.from(big).toString('base64'))
})

test('humanSize reads in words', () => {
  assert.equal(humanSize(0), '0 B')
  assert.equal(humanSize(512), '512 B')
  assert.equal(humanSize(2048), '2.0 KB')
  assert.equal(humanSize(3 * 1024 * 1024), '3.0 MB')
  assert.equal(humanSize(2.5 * 1024 * 1024 * 1024), '2.50 GB')
})

test('uploadFile sends one small file in a single chunk', async () => {
  const host = fakeHost()
  const bytes = Buffer.from('hello file upload', 'utf8')
  const receipt = await uploadFile(host.call, memorySource(bytes))
  assert.deepEqual(receipt, { path: '/root/.dsh/bot/uploads/notes.txt', name: 'notes.txt', size: bytes.length })
  assert.equal(host.received.length, 1)
  assert.equal(host.received[0].done, true)
  assert.deepEqual(host.reassembled(), bytes)
})

test('uploadFile splits a large file into 512 KB chunks at the right offsets', async () => {
  const host = fakeHost()
  const size = FILE_CHUNK_BYTES * 2 + 100
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251
  const receipt = await uploadFile(host.call, memorySource(bytes, 'video.mp4', 'video/mp4'))
  assert.equal(receipt.size, size)
  assert.equal(host.received.length, 3)
  assert.deepEqual(host.received.map(chunk => chunk.offset), [0, FILE_CHUNK_BYTES, FILE_CHUNK_BYTES * 2])
  assert.deepEqual(host.received.map(chunk => Buffer.from(chunk.data, 'base64').length), [FILE_CHUNK_BYTES, FILE_CHUNK_BYTES, 100])
  assert.equal(host.received[2].done, true)
  assert.deepEqual(host.reassembled(), Buffer.from(bytes))
})

test('uploadFile refuses an empty file and a host that loses its place', async () => {
  const host = fakeHost()
  await assert.rejects(uploadFile(host.call, memorySource(new Uint8Array(0))), /empty/)
  const lying = {
    call: async (endpoint: string, payload: object) => {
      const body = payload as Record<string, unknown>
      assert.equal(endpoint, 'file-upload')
      if (body.uploadId === undefined) return { uploadId: 'u1', nextOffset: 0 }
      return { uploadId: 'u1', nextOffset: 999, done: false }
    },
  }
  await assert.rejects(uploadFile(lying.call, memorySource(Buffer.from('hello', 'utf8'))), /lost track/)
})

test('uploadFile stops when the file changes size mid-stream', async () => {
  const host = fakeHost()
  const shrinking: FileSource = {
    name: 'notes.txt',
    size: 100,
    mimeType: 'text/plain',
    stream: async function* () { yield new Uint8Array(10) },
  }
  await assert.rejects(uploadFile(host.call, shrinking), /changed while sending/)
})
