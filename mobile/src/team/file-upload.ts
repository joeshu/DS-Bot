import { FILE_CHUNK_BYTES } from '../../../ds-bot/src/shared/file-chunks.js'

// A file the phone sends to the computer, read in chunks so a large file never
// sits whole in memory as base64. The computer saves it under uploads/ in its
// DSH home and hands back where it landed, so the Bot can read it.
export interface PickedFile { uri: string; name: string; size?: number; mimeType?: string }

export interface FileSource {
  name: string
  size: number
  mimeType: string
  // Yields the file's bytes in order, in chunks of any size.
  stream(): AsyncIterable<Uint8Array>
}

export interface UploadReceipt { path: string; name: string; size: number }

// A file size in words, for the file chip and the receipt the Bot reads.
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// Bytes to base64 without btoa, so the encoder is the same everywhere it runs.
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += BASE64_ALPHABET[b0 >> 2]
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : '='
  }
  return out
}

interface UploadAnswer { uploadId?: string; nextOffset?: number; path?: string; name?: string; size?: number; done?: boolean }

// Sends one file to the computer in FILE_CHUNK_BYTES pieces, one call each:
// the link carries a few MB per message, so a whole file does not fit in one.
export async function uploadFile(
  call: (endpoint: string, payload: object) => Promise<unknown>,
  source: FileSource,
): Promise<UploadReceipt> {
  if (!Number.isSafeInteger(source.size) || source.size < 1) throw new Error('This file is empty.')
  const { uploadId } = await call('file-upload', { name: source.name, mime: source.mimeType, size: source.size }) as { uploadId: string }
  if (typeof uploadId !== 'string' || uploadId === '') throw new Error('The computer did not start this upload. Send the file again.')
  let offset = 0
  let buf = new Uint8Array(0)
  const sendChunk = async (chunk: Uint8Array, done: boolean): Promise<UploadReceipt | undefined> => {
    const answer = await call('file-upload', { uploadId, offset, data: bytesToBase64(chunk), done }) as UploadAnswer
    if (answer.done === true) {
      if (typeof answer.path !== 'string' || typeof answer.name !== 'string' || answer.size !== source.size) {
        throw new Error('The computer did not confirm this upload. Send the file again.')
      }
      return { path: answer.path, name: answer.name, size: answer.size }
    }
    const next = Number(answer.nextOffset)
    if (!Number.isSafeInteger(next) || next !== offset + chunk.length) throw new Error('The computer lost track of this upload. Send the file again.')
    offset = next
    return undefined
  }
  for await (const piece of source.stream()) {
    const merged = new Uint8Array(buf.length + piece.length)
    merged.set(buf, 0)
    merged.set(piece, buf.length)
    buf = merged
    if (offset + buf.length > source.size) throw new Error('This file changed while sending. Send it again.')
    while (buf.length >= FILE_CHUNK_BYTES) {
      const receipt = await sendChunk(buf.subarray(0, FILE_CHUNK_BYTES), false)
      if (receipt !== undefined) return receipt
      buf = buf.subarray(FILE_CHUNK_BYTES)
    }
  }
  if (offset + buf.length !== source.size) throw new Error('This file changed while sending. Send it again.')
  const receipt = await sendChunk(buf, true)
  if (receipt === undefined) throw new Error('The computer did not confirm this upload. Send the file again.')
  return receipt
}
