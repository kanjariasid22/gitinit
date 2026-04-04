import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  gitDir,
  objectPath,
  ensureDir,
  readFileMaybe,
  writeFileWithDirs,
} from '../../src/utils/fs'

// Each test gets its own temp directory, cleaned up afterward
let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'gitinit-test-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('gitDir', () => {
  it('appends .gitinit to the root path', () => {
    const root = join('some', 'project')
    expect(gitDir(root)).toBe(join(root, '.gitinit'))
  })
})

describe('objectPath', () => {
  it('splits the hash into a 2-char dir and 38-char filename', () => {
    const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    const result = objectPath(join('repo'), hash)
    expect(result).toContain('a1') // 2-char dir prefix
    expect(result).toContain('b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2') // 38-char filename
  })

  it('places objects under .gitinit/objects/', () => {
    const hash = 'a'.repeat(40)
    expect(objectPath('repo', hash)).toContain(
      join('.gitinit', 'objects') + sep,
    )
  })
})

describe('ensureDir', () => {
  it('creates a directory that does not exist', async () => {
    const dir = join(tmp, 'a', 'b', 'c')
    await ensureDir(dir)
    const { stat } = await import('node:fs/promises')
    const s = await stat(dir)
    expect(s.isDirectory()).toBe(true)
  })

  it('does not throw if the directory already exists', async () => {
    await ensureDir(tmp)
    await expect(ensureDir(tmp)).resolves.toBeUndefined()
  })
})

describe('readFileMaybe', () => {
  it('returns the file contents as a Buffer when the file exists', async () => {
    const file = join(tmp, 'test.txt')
    await writeFileWithDirs(file, Buffer.from('hello'))
    const result = await readFileMaybe(file)
    expect(result).toEqual(Buffer.from('hello'))
  })

  it('returns null when the file does not exist', async () => {
    const result = await readFileMaybe(join(tmp, 'nonexistent.txt'))
    expect(result).toBeNull()
  })
})

describe('writeFileWithDirs', () => {
  it('writes a Buffer to a file', async () => {
    const file = join(tmp, 'out.bin')
    await writeFileWithDirs(file, Buffer.from([0x01, 0x02, 0x03]))
    const result = await readFileMaybe(file)
    expect(result).toEqual(Buffer.from([0x01, 0x02, 0x03]))
  })

  it('creates all missing parent directories automatically', async () => {
    const file = join(tmp, 'a', 'b', 'c', 'deep.txt')
    await expect(writeFileWithDirs(file, 'content')).resolves.toBeUndefined()
    const result = await readFileMaybe(file)
    expect(result?.toString()).toBe('content')
  })
})
