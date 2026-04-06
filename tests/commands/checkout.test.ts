import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/commands/init'
import { add } from '../../src/commands/add'
import { commit } from '../../src/commands/commit'
import { createBranch } from '../../src/commands/branch'
import { checkout } from '../../src/commands/checkout'
import type { Repository } from '../../src/repository'

let tmp: string
let repo: Repository

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-checkout-'))
  repo = await init(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function stage(name: string, content = 'content'): Promise<void> {
  const parts = name.split('/')
  if (parts.length > 1) {
    await mkdir(join(tmp, ...parts.slice(0, -1)), { recursive: true })
  }
  await writeFile(join(tmp, name), content)
  await add(repo, join(tmp, name))
}

describe('checkout command', () => {
  describe('branch checkout', () => {
    it('updates HEAD to point at the new branch', async () => {
      await stage('a.txt')
      await commit(repo, 'initial')
      await createBranch(repo, 'feature')

      await checkout(repo, 'feature')
      expect(await repo.refStore.readHeadBranch()).toBe('feature')
    })

    it('restores files from the target branch tree', async () => {
      // Commit on main with a.txt
      await stage('a.txt', 'from main')
      await commit(repo, 'initial')

      // Create feature branch and switch to it
      await createBranch(repo, 'feature')
      await checkout(repo, 'feature')

      // a.txt should still be present with main's content
      const content = await readFile(join(tmp, 'a.txt'), 'utf8')
      expect(content).toBe('from main')
    })

    it('removes files that exist in current branch but not in target', async () => {
      // Commit a.txt on main
      await stage('a.txt', 'only on main')
      const mainHash = await commit(repo, 'initial')

      // Go back to an earlier state by checking out the commit directly
      // (simulate a branch that doesn't have a.txt by using detached HEAD)
      // Instead: create a feature branch before a.txt was added — not possible
      // in this linear history. Test the removal by checking out a commit
      // that predates the file.

      // Add b.txt and commit — now main has both a.txt and b.txt
      await stage('b.txt', 'also on main')
      await commit(repo, 'add b')

      // Checkout the first commit (detached) — b.txt should be gone
      await checkout(repo, mainHash)

      const { readFileMaybe } = await import('../../src/utils/fs')
      const bContent = await readFileMaybe(join(tmp, 'b.txt'))
      expect(bContent).toBeNull()
    })

    it('updates the index to match the restored tree', async () => {
      await stage('a.txt', 'hello')
      await commit(repo, 'initial')
      await createBranch(repo, 'feature')
      await checkout(repo, 'feature')

      const index = await repo.indexManager.readIndex()
      expect(index['a.txt']).toBeDefined()
    })

    it('throws when the branch does not exist and target is not a valid hash', async () => {
      await expect(checkout(repo, 'nonexistent')).rejects.toThrow()
    })
  })

  describe('detached HEAD checkout', () => {
    it('sets HEAD to the commit hash directly', async () => {
      await stage('a.txt')
      const hash = await commit(repo, 'initial')

      await stage('b.txt')
      await commit(repo, 'second')

      await checkout(repo, hash)
      expect(await repo.refStore.readHead()).toBe(hash)
      expect(await repo.refStore.readHeadBranch()).toBeNull()
    })

    it('restores the working tree to the checked-out commit state', async () => {
      await stage('a.txt', 'version 1')
      const first = await commit(repo, 'first')

      await stage('a.txt', 'version 2')
      await commit(repo, 'second')

      await checkout(repo, first)

      const content = await readFile(join(tmp, 'a.txt'), 'utf8')
      expect(content).toBe('version 1')
    })
  })

  describe('subdirectory handling', () => {
    it('restores files in subdirectories', async () => {
      await stage('src/main.ts', 'export {}')
      await commit(repo, 'with subdir')
      await createBranch(repo, 'feature')

      // Wipe the working dir manually and re-checkout
      await rm(join(tmp, 'src'), { recursive: true })
      await checkout(repo, 'feature')

      const content = await readFile(join(tmp, 'src', 'main.ts'), 'utf8')
      expect(content).toBe('export {}')
    })

    it('index contains subdirectory paths after checkout', async () => {
      await stage('src/index.ts', 'code')
      await commit(repo, 'initial')
      await createBranch(repo, 'feature')
      await checkout(repo, 'feature')

      const index = await repo.indexManager.readIndex()
      expect(index['src/index.ts']).toBeDefined()
    })
  })
})
