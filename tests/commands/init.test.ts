import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/commands/init'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-init-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('init command', () => {
  it('creates the .gitinit/ directory', async () => {
    await init(tmp)
    const s = await stat(join(tmp, '.gitinit'))
    expect(s.isDirectory()).toBe(true)
  })

  it('creates .gitinit/objects/', async () => {
    await init(tmp)
    const s = await stat(join(tmp, '.gitinit', 'objects'))
    expect(s.isDirectory()).toBe(true)
  })

  it('creates .gitinit/refs/heads/', async () => {
    await init(tmp)
    const s = await stat(join(tmp, '.gitinit', 'refs', 'heads'))
    expect(s.isDirectory()).toBe(true)
  })

  it('creates a HEAD file pointing at main', async () => {
    const repo = await init(tmp)
    const branch = await repo.refStore.readHeadBranch()
    expect(branch).toBe('main')
  })

  it('HEAD resolves to null (unborn branch — no commits yet)', async () => {
    const repo = await init(tmp)
    expect(await repo.refStore.readHead()).toBeNull()
  })

  it('throws if a repository already exists at the path', async () => {
    await init(tmp)
    await expect(init(tmp)).rejects.toThrow('Already a gitinit repository')
  })
})
