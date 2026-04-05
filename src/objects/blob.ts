import type { BlobObject } from './types'

export function createBlob(content: Buffer): BlobObject {
  return { type: 'blob', content }
}

/**
 * Serialize a blob to its raw content bytes.
 *
 * Note: this returns ONLY the content — not the full Git object format.
 * The object store is responsible for prepending the header
 * ("blob <N>\0") before hashing and writing to disk.
 */
export function serializeBlob(blob: BlobObject): Buffer {
  return blob.content
}

/**
 * Reconstruct a BlobObject from raw content bytes read from the store.
 */
export function deserializeBlob(data: Buffer): BlobObject {
  return { type: 'blob', content: data }
}
