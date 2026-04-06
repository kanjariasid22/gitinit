import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/commands/init'
import { add } from '../../src/commands/add'
import { commit } from '../../src/commands/commit'
import { diff, diffStaged } from '../../src/commands/diff'
import type { Repository } from '../../src/repository'

let tmp: string
let repo: Repository

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-diff-'))
  repo = await init(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function write(name: string, content: string): Promise<void> {
  await writeFile(join(tmp, name), content)
}

async function stage(name: string, content: string): Promise<void> {
  await write(name, content)
  await add(repo, join(tmp, name))
}

describe('diff (unstaged)', () => {
  it('returns empty array when nothing has changed', async () => {
    await stage('a.txt', 'hello\n')
    await commit(repo, 'initial')
    expect(await diff(repo)).toEqual([])
  })

  it('returns empty array when index is empty', async () => {
    expect(await diff(repo)).toEqual([])
  })

  it('detects a modified file', async () => {
    await stage('a.txt', 'line1\n')
    await commit(repo, 'initial')
    await write('a.txt', 'line1\nline2\n')

    const result = await diff(repo)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('a.txt')
    expect(result[0].changeType).toBe('modified')
  })

  it('detects a deleted file', async () => {
    await stage('a.txt', 'content\n')
    await commit(repo, 'initial')
    const { unlink } = await import('node:fs/promises')
    await unlink(join(tmp, 'a.txt'))

    const result = await diff(repo)
    expect(result).toHaveLength(1)
    expect(result[0].changeType).toBe('deleted')
  })

  it('shows added lines with "+" kind', async () => {
    await stage('a.txt', 'line1\n')
    await commit(repo, 'initial')
    await write('a.txt', 'line1\nline2\n')

    const result = await diff(repo)
    const addedLines = result[0].hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.kind === '+')
    expect(addedLines.some((l) => l.content === 'line2')).toBe(true)
  })

  it('shows removed lines with "-" kind', async () => {
    await stage('a.txt', 'line1\nline2\n')
    await commit(repo, 'initial')
    await write('a.txt', 'line1\n')

    const result = await diff(repo)
    const removedLines = result[0].hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.kind === '-')
    expect(removedLines.some((l) => l.content === 'line2')).toBe(true)
  })

  it('includes context lines around changes', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`)
    await stage('a.txt', lines.join('\n') + '\n')
    await commit(repo, 'initial')

    // Change only line5
    const modified = [...lines]
    modified[4] = 'changed'
    await write('a.txt', modified.join('\n') + '\n')

    const result = await diff(repo)
    const contextLines = result[0].hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.kind === ' ')
    expect(contextLines.length).toBeGreaterThan(0)
  })
})

describe('diffStaged', () => {
  it('returns empty array when nothing is staged', async () => {
    expect(await diffStaged(repo)).toEqual([])
  })

  it('shows staged new file as added', async () => {
    await stage('a.txt', 'hello\n')
    const result = await diffStaged(repo)

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('a.txt')
    expect(result[0].changeType).toBe('added')
  })

  it('shows staged modification', async () => {
    await stage('a.txt', 'original\n')
    await commit(repo, 'initial')
    await stage('a.txt', 'modified\n')

    const result = await diffStaged(repo)
    expect(result).toHaveLength(1)
    expect(result[0].changeType).toBe('modified')
  })

  it('shows staged deletion', async () => {
    await stage('a.txt', 'content\n')
    await commit(repo, 'initial')

    const index = await repo.indexManager.readIndex()
    await repo.indexManager.writeIndex(
      repo.indexManager.removeFile(index, 'a.txt'),
    )

    const result = await diffStaged(repo)
    expect(result).toHaveLength(1)
    expect(result[0].changeType).toBe('deleted')
  })

  it('is empty after a clean commit', async () => {
    await stage('a.txt', 'content\n')
    await commit(repo, 'initial')
    expect(await diffStaged(repo)).toEqual([])
  })

  it('added lines show correct "+" kind in hunks', async () => {
    await stage('a.txt', 'line1\n')
    await commit(repo, 'initial')
    await stage('a.txt', 'line1\nline2\n')

    const result = await diffStaged(repo)
    const added = result[0].hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.kind === '+')
    expect(added.some((l) => l.content === 'line2')).toBe(true)
  })

  it('results are sorted by path', async () => {
    await stage('z.txt', 'z\n')
    await stage('a.txt', 'a\n')
    const result = await diffStaged(repo)
    expect(result[0].path).toBe('a.txt')
    expect(result[1].path).toBe('z.txt')
  })
})
