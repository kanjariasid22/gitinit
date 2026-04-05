import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RefStore } from '../../src/refs/ref-store'

let tmp: string
let refs: RefStore

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-refs-'))
  // The ref store expects .gitinit/ to exist (mirroring a real init)
  await mkdir(join(tmp, '.gitinit', 'refs', 'heads'), { recursive: true })
  refs = new RefStore(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)

describe('RefStore', () => {
  describe('HEAD — symbolic ref (normal state)', () => {
    it('readHead returns null when HEAD does not exist', async () => {
      expect(await refs.readHead()).toBeNull()
    })

    it('readHead returns null for an unborn branch (HEAD set but branch has no commits)', async () => {
      await refs.writeHeadSymbolic('main')
      // "main" branch file doesn't exist yet
      expect(await refs.readHead()).toBeNull()
    })

    it('readHead resolves symbolic ref to the branch commit hash', async () => {
      await refs.writeHeadSymbolic('main')
      await refs.writeBranch('main', HASH_A)
      expect(await refs.readHead()).toBe(HASH_A)
    })

    it('readHeadBranch returns the current branch name', async () => {
      await refs.writeHeadSymbolic('main')
      expect(await refs.readHeadBranch()).toBe('main')
    })

    it('readHeadBranch returns the correct name after switching branches', async () => {
      await refs.writeHeadSymbolic('feature')
      expect(await refs.readHeadBranch()).toBe('feature')
    })
  })

  describe('HEAD — detached state', () => {
    it('readHead returns the hash directly in detached state', async () => {
      await refs.writeHeadDetached(HASH_A)
      expect(await refs.readHead()).toBe(HASH_A)
    })

    it('readHeadBranch returns null in detached HEAD state', async () => {
      await refs.writeHeadDetached(HASH_A)
      expect(await refs.readHeadBranch()).toBeNull()
    })
  })

  describe('branches', () => {
    it('readBranch returns null for a branch that does not exist', async () => {
      expect(await refs.readBranch('main')).toBeNull()
    })

    it('writeBranch and readBranch round-trip', async () => {
      await refs.writeBranch('main', HASH_A)
      expect(await refs.readBranch('main')).toBe(HASH_A)
    })

    it('writeBranch overwrites — advancing the branch pointer', async () => {
      await refs.writeBranch('main', HASH_A)
      await refs.writeBranch('main', HASH_B)
      expect(await refs.readBranch('main')).toBe(HASH_B)
    })

    it('multiple branches are independent', async () => {
      await refs.writeBranch('main', HASH_A)
      await refs.writeBranch('feature', HASH_B)
      expect(await refs.readBranch('main')).toBe(HASH_A)
      expect(await refs.readBranch('feature')).toBe(HASH_B)
    })
  })

  describe('listBranches', () => {
    it('returns an empty array when no branches exist', async () => {
      expect(await refs.listBranches()).toEqual([])
    })

    it('returns branch names sorted alphabetically', async () => {
      await refs.writeBranch('main', HASH_A)
      await refs.writeBranch('alpha', HASH_A)
      await refs.writeBranch('feature', HASH_A)
      expect(await refs.listBranches()).toEqual(['alpha', 'feature', 'main'])
    })
  })

  describe('deleteBranch', () => {
    it('removes the branch so readBranch returns null', async () => {
      await refs.writeBranch('temp', HASH_A)
      await refs.deleteBranch('temp')
      expect(await refs.readBranch('temp')).toBeNull()
    })

    it('removes the branch from listBranches', async () => {
      await refs.writeBranch('main', HASH_A)
      await refs.writeBranch('temp', HASH_A)
      await refs.deleteBranch('temp')
      expect(await refs.listBranches()).toEqual(['main'])
    })

    it('throws when deleting a branch that does not exist', async () => {
      await expect(refs.deleteBranch('nonexistent')).rejects.toThrow(
        'Branch not found',
      )
    })
  })
})
