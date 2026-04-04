import { createHash } from 'node:crypto'

/**
 * Compute the SHA-1 digest of a buffer and return it as a 40-character
 * lowercase hex string.
 *
 * This is a pure cryptographic primitive. The Git-specific header
 * ("blob 42\0", "tree 128\0", etc.) is prepended by the caller before
 * hashing — that logic lives in the object store, not here.
 */
export function sha1(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex')
}
