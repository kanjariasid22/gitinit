import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/commands/init'
import { add } from '../../src/commands/add'
import { commit } from '../../src/commands/commit'
import type { Repository } from '../../src/repository'

let tmp: string
let repo: Repository

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-commit-'))
  repo = await init(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function stage(name: string, content = 'content'): Promise<void> {
  await writeFile(join(tmp, name), content)
  await add(repo, join(tmp, name))
}

describe('commit command', () => {
  it('throws when the index is empty', async () => {
    await expect(commit(repo, 'empty')).rejects.toThrow('Nothing to commit')
  })

  it('returns a 40-char hex commit hash', async () => {
    await stage('hello.txt')
    const hash = await commit(repo, 'initial commit')
    expect(hash).toHaveLength(40)
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('advances HEAD to the new commit hash', async () => {
    await stage('hello.txt')
    const hash = await commit(repo, 'initial commit')
    expect(await repo.refStore.readHead()).toBe(hash)
  })

  it('advances the main branch ref', async () => {
    await stage('hello.txt')
    const hash = await commit(repo, 'initial commit')
    expect(await repo.refStore.readBranch('main')).toBe(hash)
  })

  it('the commit object is stored in the object store', async () => {
    await stage('hello.txt')
    const hash = await commit(repo, 'initial commit')
    expect(await repo.objectStore.hasObject(hash)).toBe(true)
  })

  it('the commit points to a valid tree object', async () => {
    await stage('hello.txt')
    const hash = await commit(repo, 'initial commit')

    const commitObj = await repo.objectStore.readObject(hash)
    expect(commitObj.type).toBe('commit')
    if (commitObj.type !== 'commit') return

    const treeObj = await repo.objectStore.readObject(commitObj.treeHash)
    expect(treeObj.type).toBe('tree')
  })

  it('root commit has no parents', async () => {
    await stage('hello.txt')
    const hash = await commit(repo, 'initial commit')

    const commitObj = await repo.objectStore.readObject(hash)
    if (commitObj.type !== 'commit') return
    expect(commitObj.parentHashes).toEqual([])
  })

  it('second commit has the first as its parent', async () => {
    await stage('a.txt')
    const first = await commit(repo, 'first')

    await stage('b.txt')
    const second = await commit(repo, 'second')

    const commitObj = await repo.objectStore.readObject(second)
    if (commitObj.type !== 'commit') return
    expect(commitObj.parentHashes).toEqual([first])
  })

  it('the tree contains the staged file', async () => {
    await stage('hello.txt', 'hello\n')
    const hash = await commit(repo, 'initial commit')

    const commitObj = await repo.objectStore.readObject(hash)
    if (commitObj.type !== 'commit') return

    const treeObj = await repo.objectStore.readObject(commitObj.treeHash)
    if (treeObj.type !== 'tree') return

    expect(treeObj.entries.some((e) => e.name === 'hello.txt')).toBe(true)
  })

  it('builds nested trees for files in subdirectories', async () => {
    await mkdir(join(tmp, 'src'))
    await writeFile(join(tmp, 'src', 'main.ts'), 'export {}')
    await add(repo, join(tmp, 'src', 'main.ts'))
    const hash = await commit(repo, 'with subdir')

    const commitObj = await repo.objectStore.readObject(hash)
    if (commitObj.type !== 'commit') return

    const rootTree = await repo.objectStore.readObject(commitObj.treeHash)
    if (rootTree.type !== 'tree') return

    // Root tree should have a "src" directory entry (mode 040000)
    const srcEntry = rootTree.entries.find((e) => e.name === 'src')
    expect(srcEntry).toBeDefined()
    expect(srcEntry?.mode).toBe('040000')

    // The src subtree should contain main.ts
    const srcTree = await repo.objectStore.readObject(srcEntry!.hash)
    if (srcTree.type !== 'tree') return
    expect(srcTree.entries.some((e) => e.name === 'main.ts')).toBe(true)
  })

  it('commit message is stored correctly', async () => {
    await stage('hello.txt')
    const hash = await commit(repo, 'my commit message')

    const commitObj = await repo.objectStore.readObject(hash)
    if (commitObj.type !== 'commit') return
    expect(commitObj.message).toBe('my commit message')
  })
})
