import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { init } from '../../src/commands/init'
import { add } from '../../src/commands/add'
import { commit } from '../../src/commands/commit'
import { createBranch } from '../../src/commands/branch'
import { checkout } from '../../src/commands/checkout'
import { merge } from '../../src/commands/merge'
import type { Repository } from '../../src/repository'

let tmp: string
let repo: Repository

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-merge-'))
  repo = await init(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function write(name: string, content: string): Promise<void> {
  const parts = name.split('/')
  if (parts.length > 1) {
    await mkdir(join(tmp, ...parts.slice(0, -1)), { recursive: true })
  }
  await writeFile(join(tmp, name), content)
}

async function stage(name: string, content: string): Promise<void> {
  await write(name, content)
  await add(repo, join(tmp, name))
}

async function makeCommit(
  name: string,
  content: string,
  message: string,
): Promise<string> {
  await stage(name, content)
  return commit(repo, message)
}

describe('merge command', () => {
  describe('up-to-date', () => {
    it('returns up-to-date when merging the current branch into itself', async () => {
      await makeCommit('a.txt', 'hello\n', 'initial')
      await createBranch(repo, 'feature')
      const result = await merge(repo, 'feature')
      expect(result.status).toBe('up-to-date')
    })

    it('returns up-to-date when target is already in our history', async () => {
      await makeCommit('a.txt', 'hello\n', 'initial')
      await createBranch(repo, 'feature')
      // Add another commit on main — feature is now behind us
      await makeCommit('b.txt', 'world\n', 'second')
      const result = await merge(repo, 'feature')
      expect(result.status).toBe('up-to-date')
    })
  })

  describe('fast-forward', () => {
    it('returns fast-forward when we are behind the target branch', async () => {
      await makeCommit('a.txt', 'hello\n', 'initial')
      await createBranch(repo, 'feature')
      await checkout(repo, 'feature')

      // Add a commit on feature that main does not have
      await makeCommit('b.txt', 'from feature\n', 'feature commit')
      await checkout(repo, 'main')

      const result = await merge(repo, 'feature')
      expect(result.status).toBe('fast-forward')
    })

    it('fast-forward advances HEAD to the target commit', async () => {
      await makeCommit('a.txt', 'hello\n', 'initial')
      await createBranch(repo, 'feature')
      await checkout(repo, 'feature')
      const featureHash = await makeCommit(
        'b.txt',
        'feature\n',
        'feature commit',
      )
      await checkout(repo, 'main')

      await merge(repo, 'feature')
      expect(await repo.refStore.readHead()).toBe(featureHash)
    })

    it('fast-forward restores the target working tree', async () => {
      await makeCommit('a.txt', 'hello\n', 'initial')
      await createBranch(repo, 'feature')
      await checkout(repo, 'feature')
      await makeCommit('b.txt', 'from feature\n', 'feature commit')
      await checkout(repo, 'main')

      await merge(repo, 'feature')
      const content = await readFile(join(tmp, 'b.txt'), 'utf8')
      expect(content).toBe('from feature\n')
    })
  })

  describe('three-way merge — no conflicts', () => {
    it('returns merged status when both branches diverged', async () => {
      // Common base
      await makeCommit('base.txt', 'base\n', 'initial')
      await createBranch(repo, 'feature')

      // Main adds a file
      await makeCommit('main.txt', 'from main\n', 'main commit')

      // Feature adds a different file
      await checkout(repo, 'feature')
      await makeCommit('feature.txt', 'from feature\n', 'feature commit')
      await checkout(repo, 'main')

      const result = await merge(repo, 'feature')
      expect(result.status).toBe('merged')
      expect(result.conflicts).toHaveLength(0)
    })

    it('creates a merge commit with two parents', async () => {
      await makeCommit('base.txt', 'base\n', 'initial')
      await createBranch(repo, 'feature')
      await makeCommit('main.txt', 'main\n', 'main commit')
      await checkout(repo, 'feature')
      await makeCommit('feature.txt', 'feature\n', 'feature commit')
      await checkout(repo, 'main')

      await merge(repo, 'feature')

      const mergeHash = await repo.refStore.readHead()
      const mergeObj = await repo.objectStore.readObject(mergeHash!)
      expect(mergeObj.type).toBe('commit')
      if (mergeObj.type === 'commit') {
        expect(mergeObj.parentHashes).toHaveLength(2)
      }
    })

    it('merged working tree contains files from both branches', async () => {
      await makeCommit('base.txt', 'base\n', 'initial')
      await createBranch(repo, 'feature')
      await makeCommit('main.txt', 'main\n', 'main commit')
      await checkout(repo, 'feature')
      await makeCommit('feature.txt', 'feature\n', 'feature commit')
      await checkout(repo, 'main')

      await merge(repo, 'feature')

      const mainContent = await readFile(join(tmp, 'main.txt'), 'utf8')
      const featureContent = await readFile(join(tmp, 'feature.txt'), 'utf8')
      expect(mainContent).toBe('main\n')
      expect(featureContent).toBe('feature\n')
    })

    it('takes the changed version when only one side modifies a file', async () => {
      await makeCommit('shared.txt', 'original\n', 'initial')
      await createBranch(repo, 'feature')

      // Only feature modifies shared.txt
      await checkout(repo, 'feature')
      await makeCommit('shared.txt', 'modified by feature\n', 'feature edit')
      await checkout(repo, 'main')

      // Main adds an unrelated file
      await makeCommit('other.txt', 'other\n', 'main commit')

      await merge(repo, 'feature')

      const content = await readFile(join(tmp, 'shared.txt'), 'utf8')
      expect(content).toBe('modified by feature\n')
    })
  })

  describe('three-way merge — conflicts', () => {
    it('returns conflict status when both branches modify the same file differently', async () => {
      await makeCommit('shared.txt', 'line1\nline2\nline3\n', 'initial')
      await createBranch(repo, 'feature')

      await makeCommit('shared.txt', 'line1\nLINE2-MAIN\nline3\n', 'main edit')
      await checkout(repo, 'feature')
      await makeCommit(
        'shared.txt',
        'line1\nLINE2-FEATURE\nline3\n',
        'feature edit',
      )
      await checkout(repo, 'main')

      const result = await merge(repo, 'feature')
      expect(result.status).toBe('conflict')
      expect(result.conflicts).toContain('shared.txt')
    })

    it('writes conflict markers into the conflicted file', async () => {
      await makeCommit('shared.txt', 'base\n', 'initial')
      await createBranch(repo, 'feature')

      await makeCommit('shared.txt', 'ours\n', 'main edit')
      await checkout(repo, 'feature')
      await makeCommit('shared.txt', 'theirs\n', 'feature edit')
      await checkout(repo, 'main')

      await merge(repo, 'feature')

      const content = await readFile(join(tmp, 'shared.txt'), 'utf8')
      expect(content).toContain('<<<<<<<')
      expect(content).toContain('=======')
      expect(content).toContain('>>>>>>>')
      expect(content).toContain('ours')
      expect(content).toContain('theirs')
    })

    it('does not create a merge commit when there are conflicts', async () => {
      await makeCommit('shared.txt', 'base\n', 'initial')
      await createBranch(repo, 'feature')
      await makeCommit('shared.txt', 'ours\n', 'main edit')
      await checkout(repo, 'feature')
      await makeCommit('shared.txt', 'theirs\n', 'feature edit')
      await checkout(repo, 'main')

      const headBefore = await repo.refStore.readHead()
      await merge(repo, 'feature')
      const headAfter = await repo.refStore.readHead()

      // HEAD should not have advanced
      expect(headAfter).toBe(headBefore)
    })

    it('non-conflicted files are merged cleanly alongside conflicts', async () => {
      await makeCommit('conflict.txt', 'base\n', 'initial')
      await createBranch(repo, 'feature')

      await makeCommit('conflict.txt', 'ours\n', 'main edit')
      await stage('clean.txt', 'from main\n')
      await commit(repo, 'main adds clean.txt')

      await checkout(repo, 'feature')
      await makeCommit('conflict.txt', 'theirs\n', 'feature edit')
      await checkout(repo, 'main')

      const result = await merge(repo, 'feature')
      expect(result.status).toBe('conflict')
      expect(result.conflicts).toContain('conflict.txt')
      // clean.txt should exist and not be in conflicts
      expect(result.conflicts).not.toContain('clean.txt')
    })
  })

  describe('error cases', () => {
    it('throws when merging into an unborn repo', async () => {
      await expect(merge(repo, 'feature')).rejects.toThrow('no commits')
    })

    it('throws when the target branch does not exist', async () => {
      await makeCommit('a.txt', 'hello\n', 'initial')
      await expect(merge(repo, 'nonexistent')).rejects.toThrow(
        'Branch not found',
      )
    })
  })
})
