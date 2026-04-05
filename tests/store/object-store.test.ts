import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObjectStore } from '../../src/store/object-store'
import { createBlob, createTree, createCommit } from '../../src/objects'
import type { GitSignature } from '../../src/objects'
import { sha1 } from '../../src/utils/hash'

let tmp: string
let store: ObjectStore

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-store-'))
  store = new ObjectStore(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const AUTHOR: GitSignature = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  timestamp: 1712345678,
  timezone: '+0000',
}

describe('ObjectStore', () => {
  describe('writeObject / hasObject', () => {
    it('returns false for an object that has not been written', async () => {
      expect(await store.hasObject('a'.repeat(40))).toBe(false)
    })

    it('returns the SHA-1 hash of the object', async () => {
      const blob = createBlob(Buffer.from('hello\n'))
      const hash = await store.writeObject(blob)
      expect(hash).toHaveLength(40)
      expect(hash).toMatch(/^[0-9a-f]{40}$/)
    })

    it('returns true after writing an object', async () => {
      const blob = createBlob(Buffer.from('hello\n'))
      const hash = await store.writeObject(blob)
      expect(await store.hasObject(hash)).toBe(true)
    })

    it('is idempotent — writing the same object twice returns the same hash', async () => {
      const blob = createBlob(Buffer.from('same content'))
      const h1 = await store.writeObject(blob)
      const h2 = await store.writeObject(blob)
      expect(h1).toBe(h2)
    })

    it('produces the correct SHA-1 for a known blob (cross-verify with real Git)', async () => {
      // `echo "hello" | git hash-object --stdin` → ce013625...
      const blob = createBlob(Buffer.from('hello\n'))
      const hash = await store.writeObject(blob)
      expect(hash).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    })
  })

  describe('readObject', () => {
    it('round-trips a blob', async () => {
      const original = createBlob(Buffer.from('round trip content'))
      const hash = await store.writeObject(original)
      const restored = await store.readObject(hash)

      expect(restored.type).toBe('blob')
      if (restored.type === 'blob') {
        expect(restored.content).toEqual(original.content)
      }
    })

    it('round-trips a tree', async () => {
      const blobHash = await store.writeObject(
        createBlob(Buffer.from('file content')),
      )
      const original = createTree([
        { mode: '100644', name: 'file.txt', hash: blobHash },
      ])
      const treeHash = await store.writeObject(original)
      const restored = await store.readObject(treeHash)

      expect(restored.type).toBe('tree')
      if (restored.type === 'tree') {
        expect(restored.entries).toHaveLength(1)
        expect(restored.entries[0].name).toBe('file.txt')
        expect(restored.entries[0].hash).toBe(blobHash)
      }
    })

    it('round-trips a root commit', async () => {
      const treeHash = await store.writeObject(createTree([]))
      const original = createCommit({
        treeHash,
        parentHashes: [],
        author: AUTHOR,
        committer: AUTHOR,
        message: 'initial commit',
      })
      const commitHash = await store.writeObject(original)
      const restored = await store.readObject(commitHash)

      expect(restored.type).toBe('commit')
      if (restored.type === 'commit') {
        expect(restored.treeHash).toBe(treeHash)
        expect(restored.parentHashes).toEqual([])
        expect(restored.message).toBe('initial commit')
        expect(restored.author.name).toBe('Ada Lovelace')
      }
    })

    it('round-trips a commit with a parent', async () => {
      const treeHash = await store.writeObject(createTree([]))
      const parentHash = await store.writeObject(
        createCommit({
          treeHash,
          parentHashes: [],
          author: AUTHOR,
          committer: AUTHOR,
          message: 'first',
        }),
      )
      const original = createCommit({
        treeHash,
        parentHashes: [parentHash],
        author: AUTHOR,
        committer: AUTHOR,
        message: 'second',
      })
      const hash = await store.writeObject(original)
      const restored = await store.readObject(hash)

      expect(restored.type).toBe('commit')
      if (restored.type === 'commit') {
        expect(restored.parentHashes).toEqual([parentHash])
      }
    })

    it('throws when the object does not exist', async () => {
      await expect(store.readObject('a'.repeat(40))).rejects.toThrow(
        'Object not found',
      )
    })

    it('stores the object compressed — raw file is not plaintext', async () => {
      const blob = createBlob(Buffer.from('hello\n'))
      const hash = await store.writeObject(blob)

      // Read the raw file — it should be zlib-compressed, not "blob 6\0hello\n"
      const { readFile } = await import('node:fs/promises')
      const { objectPath } = await import('../../src/utils/fs')
      const raw = await readFile(objectPath(tmp, hash))

      expect(raw.toString('utf8')).not.toContain('hello')
    })

    it('different content produces different hashes', async () => {
      const h1 = await store.writeObject(createBlob(Buffer.from('foo')))
      const h2 = await store.writeObject(createBlob(Buffer.from('bar')))
      expect(h1).not.toBe(h2)
    })

    it('hash matches manual computation of the Git object format', async () => {
      const content = Buffer.from('test content')
      const blob = createBlob(content)
      const hash = await store.writeObject(blob)

      // Manually compute: SHA-1("blob 12\0test content")
      const header = Buffer.from(`blob ${content.length}\0`)
      const expected = sha1(Buffer.concat([header, content]))
      expect(hash).toBe(expected)
    })
  })
})
