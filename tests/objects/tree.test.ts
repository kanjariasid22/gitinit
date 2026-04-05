import { describe, it, expect } from 'vitest'
import {
  createTree,
  serializeTree,
  deserializeTree,
} from '../../src/objects/tree'
import type { TreeEntry } from '../../src/objects/types'

// A real blob hash for "hello\n" — used across multiple tests
const HELLO_BLOB_HASH = 'ce013625030ba8dba906f756967f9e9ca394464a'

describe('tree', () => {
  describe('createTree', () => {
    it('sets type to "tree"', () => {
      const tree = createTree([])
      expect(tree.type).toBe('tree')
    })

    it('stores the entries', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', hash: HELLO_BLOB_HASH },
      ]
      const tree = createTree(entries)
      expect(tree.entries).toEqual(entries)
    })
  })

  describe('serializeTree', () => {
    it('produces a buffer with the correct entry structure', () => {
      const hash = HELLO_BLOB_HASH
      const tree = createTree([{ mode: '100644', name: 'hello.txt', hash }])
      const buf = serializeTree(tree)

      // Header: "100644 hello.txt\0"
      const header = Buffer.from('100644 hello.txt\0')
      expect(buf.slice(0, header.length)).toEqual(header)

      // Hash: 20 raw binary bytes
      const hashBytes = Buffer.from(hash, 'hex')
      expect(buf.slice(header.length)).toEqual(hashBytes)
    })

    it('total length is header bytes + 20 bytes per entry', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'a.txt', hash: HELLO_BLOB_HASH },
        { mode: '100644', name: 'b.txt', hash: HELLO_BLOB_HASH },
      ]
      const buf = serializeTree(createTree(entries))
      const expectedLength =
        'a.txt'.length +
        '100644 '.length +
        1 +
        20 + // entry 1
        'b.txt'.length +
        '100644 '.length +
        1 +
        20 // entry 2
      expect(buf.length).toBe(expectedLength)
    })

    it('sorts entries in Git tree order before serializing', () => {
      // Provide entries out of order — serialize must sort them
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'z.txt', hash: HELLO_BLOB_HASH },
        { mode: '100644', name: 'a.txt', hash: HELLO_BLOB_HASH },
        { mode: '100644', name: 'm.txt', hash: HELLO_BLOB_HASH },
      ]
      const buf = serializeTree(createTree(entries))
      // First entry in buffer should be "100644 a.txt\0..."
      expect(buf.slice(0, 13)).toEqual(Buffer.from('100644 a.txt\0'))
    })

    it('sorts directories with trailing "/" — file before dir when names differ at "/"', () => {
      // "foo-bar" (file) vs "foo" (dir sorts as "foo/")
      // '-' (ASCII 45) < '/' (ASCII 47), so "foo-bar" comes before "foo/"
      const fakeHash = HELLO_BLOB_HASH
      const entries: TreeEntry[] = [
        { mode: '040000', name: 'foo', hash: fakeHash }, // sorts as "foo/"
        { mode: '100644', name: 'foo-bar', hash: fakeHash },
      ]
      const buf = serializeTree(createTree(entries))
      // "foo-bar" should appear first in the buffer
      expect(buf.slice(0, 15)).toEqual(Buffer.from('100644 foo-bar\0'))
    })
  })

  describe('deserializeTree', () => {
    it('round-trips a single-entry tree', () => {
      const original = createTree([
        { mode: '100644', name: 'file.txt', hash: HELLO_BLOB_HASH },
      ])
      const restored = deserializeTree(serializeTree(original))
      expect(restored.type).toBe('tree')
      expect(restored.entries).toHaveLength(1)
      expect(restored.entries[0]).toEqual(original.entries[0])
    })

    it('round-trips a tree with multiple entries', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'readme.md', hash: HELLO_BLOB_HASH },
        { mode: '100755', name: 'run.sh', hash: HELLO_BLOB_HASH },
        {
          mode: '040000',
          name: 'src',
          hash: HELLO_BLOB_HASH,
        },
      ]
      const restored = deserializeTree(serializeTree(createTree(entries)))
      // After round-trip, entries come back in sort order
      expect(restored.entries).toHaveLength(3)
      const names = restored.entries.map((e) => e.name)
      expect(names).toContain('readme.md')
      expect(names).toContain('run.sh')
      expect(names).toContain('src')
    })

    it('preserves file modes', () => {
      const tree = createTree([
        { mode: '100755', name: 'exec', hash: HELLO_BLOB_HASH },
        { mode: '040000', name: 'dir', hash: HELLO_BLOB_HASH },
      ])
      const restored = deserializeTree(serializeTree(tree))
      const byName = Object.fromEntries(
        restored.entries.map((e) => [e.name, e]),
      )
      expect(byName['exec'].mode).toBe('100755')
      expect(byName['dir'].mode).toBe('040000')
    })

    it('throws on malformed data', () => {
      expect(() => deserializeTree(Buffer.from('bad data'))).toThrow()
    })
  })
})
