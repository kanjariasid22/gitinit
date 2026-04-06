import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/commands/init'
import { add } from '../../src/commands/add'
import { commit } from '../../src/commands/commit'
import { status } from '../../src/commands/status'
import type { Repository } from '../../src/repository'

let tmp: string
let repo: Repository

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-status-'))
  repo = await init(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function touch(name: string, content = 'content'): Promise<string> {
  const path = join(tmp, name)
  await writeFile(path, content)
  return path
}

async function stage(name: string, content = 'content'): Promise<void> {
  const path = await touch(name, content)
  await add(repo, path)
}

describe('status command', () => {
  describe('clean state', () => {
    it('everything is empty on an unborn repo with no files', async () => {
      const s = await status(repo)
      expect(s.staged.added).toEqual([])
      expect(s.staged.modified).toEqual([])
      expect(s.staged.deleted).toEqual([])
      expect(s.unstaged.modified).toEqual([])
      expect(s.unstaged.deleted).toEqual([])
      expect(s.untracked).toEqual([])
    })

    it('all empty after a clean commit', async () => {
      await stage('a.txt')
      await commit(repo, 'initial')
      const s = await status(repo)
      expect(s.staged.added).toEqual([])
      expect(s.unstaged.modified).toEqual([])
      expect(s.untracked).toEqual([])
    })
  })

  describe('staged changes', () => {
    it('newly staged file appears in staged.added', async () => {
      await stage('hello.txt')
      const s = await status(repo)
      expect(s.staged.added).toContain('hello.txt')
    })

    it('modified staged file appears in staged.modified', async () => {
      await stage('hello.txt', 'v1')
      await commit(repo, 'initial')

      await stage('hello.txt', 'v2')
      const s = await status(repo)
      expect(s.staged.modified).toContain('hello.txt')
    })

    it('file removed from index appears in staged.deleted', async () => {
      await stage('hello.txt')
      await commit(repo, 'initial')

      // Remove from index but leave file on disk
      const index = await repo.indexManager.readIndex()
      await repo.indexManager.writeIndex(
        repo.indexManager.removeFile(index, 'hello.txt'),
      )

      const s = await status(repo)
      expect(s.staged.deleted).toContain('hello.txt')
    })

    it('multiple staged files are all reported', async () => {
      await stage('a.txt')
      await stage('b.txt')
      const s = await status(repo)
      expect(s.staged.added).toContain('a.txt')
      expect(s.staged.added).toContain('b.txt')
    })
  })

  describe('unstaged changes', () => {
    it('file modified on disk after staging appears in unstaged.modified', async () => {
      await stage('hello.txt', 'original')
      await commit(repo, 'initial')

      // Modify on disk without staging
      await writeFile(join(tmp, 'hello.txt'), 'changed')
      const s = await status(repo)
      expect(s.unstaged.modified).toContain('hello.txt')
    })

    it('file deleted from disk appears in unstaged.deleted', async () => {
      await stage('hello.txt')
      await commit(repo, 'initial')

      await unlink(join(tmp, 'hello.txt'))
      const s = await status(repo)
      expect(s.unstaged.deleted).toContain('hello.txt')
    })

    it('file unchanged on disk does not appear in unstaged', async () => {
      await stage('hello.txt', 'same')
      await commit(repo, 'initial')

      const s = await status(repo)
      expect(s.unstaged.modified).not.toContain('hello.txt')
      expect(s.unstaged.deleted).not.toContain('hello.txt')
    })
  })

  describe('untracked files', () => {
    it('file on disk not in index appears in untracked', async () => {
      await touch('untracked.txt')
      const s = await status(repo)
      expect(s.untracked).toContain('untracked.txt')
    })

    it('staged file does not appear in untracked', async () => {
      await stage('hello.txt')
      const s = await status(repo)
      expect(s.untracked).not.toContain('hello.txt')
    })

    it('.gitinit/ is never reported as untracked', async () => {
      const s = await status(repo)
      expect(s.untracked.some((p) => p.startsWith('.gitinit'))).toBe(false)
    })

    it('untracked file in a subdirectory is reported with its path', async () => {
      await mkdir(join(tmp, 'src'))
      await touch('src/main.ts')
      const s = await status(repo)
      expect(s.untracked).toContain('src/main.ts')
    })
  })

  describe('combined states', () => {
    it('correctly categorises staged + unstaged + untracked simultaneously', async () => {
      // Commit baseline
      await stage('committed.txt', 'v1')
      await commit(repo, 'initial')

      // Stage a new file
      await stage('staged-new.txt')

      // Modify committed file on disk without staging
      await writeFile(join(tmp, 'committed.txt'), 'v2')

      // Leave an untracked file
      await touch('untracked.txt')

      const s = await status(repo)
      expect(s.staged.added).toContain('staged-new.txt')
      expect(s.unstaged.modified).toContain('committed.txt')
      expect(s.untracked).toContain('untracked.txt')
    })
  })
})
