import { deflate, inflate } from 'node:zlib'
import { promisify } from 'node:util'

const deflateAsync = promisify(deflate)
const inflateAsync = promisify(inflate)

/**
 * Compress a buffer using zlib DEFLATE (RFC 1950).
 *
 * Real Git compresses every object with zlib before writing it to disk.
 * Node's `zlib.deflate` uses the same format (not gzip, not raw deflate).
 */
export async function compress(data: Buffer): Promise<Buffer> {
  return deflateAsync(data)
}

/**
 * Decompress a zlib-compressed buffer.
 *
 * Used when reading objects from the object store.
 */
export async function decompress(data: Buffer): Promise<Buffer> {
  return inflateAsync(data)
}
