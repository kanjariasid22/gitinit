import type { TreeEntry, TreeObject } from './types'

export function createTree(entries: readonly TreeEntry[]): TreeObject {
  return { type: 'tree', entries }
}

/**
 * Serialize a tree to its raw content bytes (without the Git object header).
 *
 * Real Git's tree binary format — each entry is:
 *   "<mode> <name>\0<20-byte-raw-hash>"
 *
 * Two critical details:
 * 1. The hash is stored as 20 raw binary bytes, not the 40-char hex string.
 * 2. Entries must be sorted in Git's tree sort order (see sortKey below) for
 *    the resulting SHA-1 to match real Git's output for the same directory.
 */
export function serializeTree(tree: TreeObject): Buffer {
  const sorted = [...tree.entries].sort(compareEntries)
  const parts = sorted.map((entry) => {
    const header = Buffer.from(`${entry.mode} ${entry.name}\0`)
    const hashBytes = Buffer.from(entry.hash, 'hex')
    return Buffer.concat([header, hashBytes])
  })
  return Buffer.concat(parts)
}

/**
 * Reconstruct a TreeObject from the raw content bytes read from the store.
 */
export function deserializeTree(data: Buffer): TreeObject {
  const entries: TreeEntry[] = []
  let offset = 0

  while (offset < data.length) {
    // Read "<mode> <name>\0"
    const nullPos = data.indexOf(0x00, offset)
    if (nullPos === -1) throw new Error('Malformed tree: missing null byte')

    const header = data.slice(offset, nullPos).toString('utf8')
    const spacePos = header.indexOf(' ')
    if (spacePos === -1)
      throw new Error('Malformed tree: missing space in header')

    const mode = header.slice(0, spacePos)
    const name = header.slice(spacePos + 1)

    // Read the 20-byte raw binary hash that follows the null byte
    const hashStart = nullPos + 1
    const hashEnd = hashStart + 20
    if (hashEnd > data.length) throw new Error('Malformed tree: truncated hash')

    const hash = data.slice(hashStart, hashEnd).toString('hex')

    entries.push({ mode: mode as TreeEntry['mode'], name, hash })
    offset = hashEnd
  }

  return { type: 'tree', entries }
}

/**
 * Git's tree sort order.
 *
 * Entries are sorted by comparing their names, but directories sort as if
 * their name has a trailing '/' appended. This means a directory "foo" and
 * a file "foo-bar" sort with "foo-bar" first, because '-' (ASCII 45) comes
 * before '/' (ASCII 47).
 *
 * Getting this order wrong produces different tree hashes than real Git.
 */
function compareEntries(a: TreeEntry, b: TreeEntry): number {
  const keyA = a.mode === '040000' ? `${a.name}/` : a.name
  const keyB = b.mode === '040000' ? `${b.name}/` : b.name
  if (keyA < keyB) return -1
  if (keyA > keyB) return 1
  return 0
}
