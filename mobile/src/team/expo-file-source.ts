import { File } from 'expo-file-system'
import type { PickedFile, FileSource } from './file-upload.ts'

// A picked document as a FileSource: read from disk in a stream, so a large
// file never sits whole in memory. When the picker did not report a size, the
// file is read once to learn it.
export async function expoFileSource(asset: PickedFile): Promise<FileSource> {
  const file = new File(asset.uri)
  let size = asset.size
  let bytes: Uint8Array | undefined
  if (size === undefined || !Number.isSafeInteger(size) || size < 0) {
    bytes = new Uint8Array(await file.arrayBuffer())
    size = bytes.length
  }
  return {
    name: asset.name,
    size,
    mimeType: asset.mimeType ?? 'application/octet-stream',
    stream: bytes !== undefined
      ? async function* () { yield bytes as Uint8Array }
      : async function* () {
          const reader = file.readableStream().getReader()
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) return
              if (value !== undefined) yield value
            }
          } finally {
            await reader.cancel().catch(() => {})
          }
        },
  }
}
