import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/commands/init'
import { add } from '../../src/commands/add'
import { commit } from '../../src/commands/commit'
import { log } from '../../src/commands/log'
import type { Repository } from '../../src/repository'

let tmp: string
let repo: Repository

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-log-'))
  repo = await init(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function stage(name: string, content = 'content'): Promise<void> {
  await writeFile(join(tmp, name), content)
  await add(repo, join(tmp, name))
}

describe('log command', () => {
  it('returns empty array on an unborn repo', async () => {
    expect(await log(repo)).toEqual([])
  })

  it('returns one entry after the first commit', async () => {
    await stage('a.txt')
    const hash = await commit(repo, 'first')
    const entries = await log(repo)

    expect(entries).toHaveLength(1)
    expect(entries[0].hash).toBe(hash)
    expect(entries[0].commit.message).toBe('first')
  })

  it('returns entries most-recent-first', async () => {
    await stage('a.txt')
    const first = await commit(repo, 'first')

    await stage('b.txt')
    const second = await commit(repo, 'second')

    await stage('c.txt')
    const third = await commit(repo, 'third')

    const entries = await log(repo)
    expect(entries).toHaveLength(3)
    expect(entries[0].hash).toBe(third)
    expect(entries[1].hash).toBe(second)
    expect(entries[2].hash).toBe(first)
  })

  it('each entry exposes the full CommitObject', async () => {
    await stage('a.txt')
    await commit(repo, 'initial commit')

    const [entry] = await log(repo)
    expect(entry.commit.type).toBe('commit')
    expect(entry.commit.parentHashes).toEqual([])
    expect(entry.commit.treeHash).toHaveLength(40)
    expect(entry.commit.author.name).toBeDefined()
  })

  it('correctly links the parent chain', async () => {
    await stage('a.txt')
    const first = await commit(repo, 'first')
    await stage('b.txt')
    const second = await commit(repo, 'second')

    const entries = await log(repo)
    expect(entries[0].commit.parentHashes[0]).toBe(first)
    expect(entries[1].commit.parentHashes).toEqual([])
    expect(entries[0].hash).toBe(second)
  })
})
