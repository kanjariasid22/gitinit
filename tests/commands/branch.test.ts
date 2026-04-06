import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/commands/init'
import { add } from '../../src/commands/add'
import { commit } from '../../src/commands/commit'
import {
  createBranch,
  listBranches,
  deleteBranch,
} from '../../src/commands/branch'
import type { Repository } from '../../src/repository'

let tmp: string
let repo: Repository

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-branch-'))
  repo = await init(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function makeCommit(name = 'a.txt'): Promise<string> {
  await writeFile(join(tmp, name), 'content')
  await add(repo, join(tmp, name))
  return commit(repo, `add ${name}`)
}

describe('branch command', () => {
  describe('createBranch', () => {
    it('throws on an unborn repo', async () => {
      await expect(createBranch(repo, 'feature')).rejects.toThrow('unborn')
    })

    it('creates a branch pointing at HEAD', async () => {
      const hash = await makeCommit()
      await createBranch(repo, 'feature')
      expect(await repo.refStore.readBranch('feature')).toBe(hash)
    })

    it('throws if the branch already exists', async () => {
      await makeCommit()
      await createBranch(repo, 'feature')
      await expect(createBranch(repo, 'feature')).rejects.toThrow(
        'already exists',
      )
    })
  })

  describe('listBranches', () => {
    it('returns main as the only branch after init + commit', async () => {
      await makeCommit()
      const { branches, current } = await listBranches(repo)
      expect(branches).toContain('main')
      expect(current).toBe('main')
    })

    it('lists all branches alphabetically', async () => {
      await makeCommit()
      await createBranch(repo, 'zebra')
      await createBranch(repo, 'alpha')
      const { branches } = await listBranches(repo)
      expect(branches).toEqual(['alpha', 'main', 'zebra'])
    })

    it('marks the current branch correctly', async () => {
      await makeCommit()
      await createBranch(repo, 'feature')
      const { current } = await listBranches(repo)
      expect(current).toBe('main')
    })
  })

  describe('deleteBranch', () => {
    it('deletes a non-current branch', async () => {
      await makeCommit()
      await createBranch(repo, 'temp')
      await deleteBranch(repo, 'temp')
      expect(await repo.refStore.readBranch('temp')).toBeNull()
    })

    it('throws when deleting the currently checked-out branch', async () => {
      await makeCommit()
      await expect(deleteBranch(repo, 'main')).rejects.toThrow(
        'currently checked-out',
      )
    })

    it('throws when deleting a branch that does not exist', async () => {
      await makeCommit()
      await expect(deleteBranch(repo, 'nonexistent')).rejects.toThrow()
    })
  })
})
