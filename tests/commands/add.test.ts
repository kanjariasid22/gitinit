import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/commands/init'
import { add } from '../../src/commands/add'
import type { Repository } from '../../src/repository'

let tmp: string
let repo: Repository

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-cmd-add-'))
  repo = await init(tmp)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('add command', () => {
  it('stages a single file', async () => {
    await writeFile(join(tmp, 'hello.txt'), 'hello')
    await add(repo, join(tmp, 'hello.txt'))

    const index = await repo.indexManager.readIndex()
    expect(index['hello.txt']).toBeDefined()
  })

  it('writes the blob to the object store', async () => {
    await writeFile(join(tmp, 'hello.txt'), 'hello')
    await add(repo, join(tmp, 'hello.txt'))

    const index = await repo.indexManager.readIndex()
    const hash = index['hello.txt'].hash
    expect(await repo.objectStore.hasObject(hash)).toBe(true)
  })

  it('stores the correct hash for known content', async () => {
    // "hello\n" → blob hash matches real Git
    await writeFile(join(tmp, 'hello.txt'), 'hello\n')
    await add(repo, join(tmp, 'hello.txt'))

    const index = await repo.indexManager.readIndex()
    expect(index['hello.txt'].hash).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    )
  })

  it('records the path relative to the repo root with forward slashes', async () => {
    await mkdir(join(tmp, 'src'))
    await writeFile(join(tmp, 'src', 'main.ts'), 'export {}')
    await add(repo, join(tmp, 'src', 'main.ts'))

    const index = await repo.indexManager.readIndex()
    expect(index['src/main.ts']).toBeDefined()
  })

  it('recursively stages a directory', async () => {
    await mkdir(join(tmp, 'lib'))
    await writeFile(join(tmp, 'lib', 'a.ts'), 'a')
    await writeFile(join(tmp, 'lib', 'b.ts'), 'b')
    await add(repo, join(tmp, 'lib'))

    const index = await repo.indexManager.readIndex()
    expect(index['lib/a.ts']).toBeDefined()
    expect(index['lib/b.ts']).toBeDefined()
  })

  it('staging the same file twice updates the index entry', async () => {
    const file = join(tmp, 'hello.txt')
    await writeFile(file, 'version 1')
    await add(repo, file)
    const hash1 = (await repo.indexManager.readIndex())['hello.txt'].hash

    await writeFile(file, 'version 2')
    await add(repo, file)
    const hash2 = (await repo.indexManager.readIndex())['hello.txt'].hash

    expect(hash1).not.toBe(hash2)
  })
})
