import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { IndexManager } from '../../src/index/index-manager'
import type { Index } from '../../src/index/index-manager'

let tmp: string
let manager: IndexManager

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-index-'))
  await mkdir(join(tmp, '.gitinit'), { recursive: true })
  manager = new IndexManager(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)

describe('IndexManager', () => {
  describe('readIndex', () => {
    it('returns an empty object when no index file exists', async () => {
      expect(await manager.readIndex()).toEqual({})
    })

    it('returns the stored index after a write', async () => {
      const index: Index = {
        'src/main.ts': { hash: HASH_A, mode: '100644', mtime: 1000, size: 42 },
      }
      await manager.writeIndex(index)
      expect(await manager.readIndex()).toEqual(index)
    })
  })

  describe('writeIndex / readIndex round-trip', () => {
    it('persists multiple entries', async () => {
      const index: Index = {
        'a.txt': { hash: HASH_A, mode: '100644', mtime: 1000, size: 10 },
        'b.txt': { hash: HASH_B, mode: '100755', mtime: 2000, size: 20 },
      }
      await manager.writeIndex(index)
      const restored = await manager.readIndex()
      expect(restored['a.txt'].hash).toBe(HASH_A)
      expect(restored['b.txt'].mode).toBe('100755')
    })
  })

  describe('stageFile', () => {
    it('adds a new entry with the correct hash and mode', async () => {
      const file = join(tmp, 'hello.txt')
      await writeFile(file, 'hello')

      const index = await manager.stageFile({}, 'hello.txt', HASH_A, '100644', file)
      expect(index['hello.txt'].hash).toBe(HASH_A)
      expect(index['hello.txt'].mode).toBe('100644')
    })

    it('records mtime and size from the actual file', async () => {
      const file = join(tmp, 'hello.txt')
      await writeFile(file, 'hello world')
      const fileStat = await stat(file)

      const index = await manager.stageFile({}, 'hello.txt', HASH_A, '100644', file)
      expect(index['hello.txt'].mtime).toBe(fileStat.mtimeMs)
      expect(index['hello.txt'].size).toBe(fileStat.size)
    })

    it('overwrites an existing entry for the same path', async () => {
      const file = join(tmp, 'hello.txt')
      await writeFile(file, 'v1')
      const before: Index = {
        'hello.txt': { hash: HASH_A, mode: '100644', mtime: 0, size: 0 },
      }
      const after = await manager.stageFile(
        before,
        'hello.txt',
        HASH_B,
        '100644',
        file,
      )
      expect(after['hello.txt'].hash).toBe(HASH_B)
    })

    it('does not mutate the original index', async () => {
      const file = join(tmp, 'hello.txt')
      await writeFile(file, 'content')
      const original: Index = {}
      await manager.stageFile(original, 'hello.txt', HASH_A, '100644', file)
      expect(original).toEqual({})
    })
  })

  describe('removeFile', () => {
    it('removes an existing entry', () => {
      const index: Index = {
        'a.txt': { hash: HASH_A, mode: '100644', mtime: 0, size: 0 },
        'b.txt': { hash: HASH_B, mode: '100644', mtime: 0, size: 0 },
      }
      const result = manager.removeFile(index, 'a.txt')
      expect(result['a.txt']).toBeUndefined()
      expect(result['b.txt']).toBeDefined()
    })

    it('does not mutate the original index', () => {
      const index: Index = {
        'a.txt': { hash: HASH_A, mode: '100644', mtime: 0, size: 0 },
      }
      manager.removeFile(index, 'a.txt')
      expect(index['a.txt']).toBeDefined()
    })

    it('no-ops silently for a path that is not staged', () => {
      const index: Index = {}
      expect(() => manager.removeFile(index, 'nonexistent.txt')).not.toThrow()
    })
  })

  describe('isUnchanged', () => {
    it('returns true when mtime and size match the staged entry', async () => {
      const file = join(tmp, 'check.txt')
      await writeFile(file, 'content')
      const fileStat = await stat(file)

      const entry = {
        hash: HASH_A,
        mode: '100644' as const,
        mtime: fileStat.mtimeMs,
        size: fileStat.size,
      }
      expect(await manager.isUnchanged(entry, file)).toBe(true)
    })

    it('returns false when size differs', async () => {
      const file = join(tmp, 'check.txt')
      await writeFile(file, 'content')
      const fileStat = await stat(file)

      const entry = {
        hash: HASH_A,
        mode: '100644' as const,
        mtime: fileStat.mtimeMs,
        size: fileStat.size + 1, // wrong size
      }
      expect(await manager.isUnchanged(entry, file)).toBe(false)
    })

    it('returns false when the file no longer exists', async () => {
      const entry = {
        hash: HASH_A,
        mode: '100644' as const,
        mtime: 1000,
        size: 42,
      }
      expect(
        await manager.isUnchanged(entry, join(tmp, 'ghost.txt')),
      ).toBe(false)
    })
  })
})
