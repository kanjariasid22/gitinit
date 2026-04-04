import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Returns the path to the .gitinit directory for a given working root.
 */
export function gitDir(rootPath: string): string {
  return join(rootPath, '.gitinit')
}

/**
 * Returns the on-disk path for a loose object identified by its 40-char hex hash.
 *
 * Real Git (and gitinit) splits the hash into a 2-char directory prefix and a
 * 38-char filename to avoid dumping all objects in a single directory — most
 * filesystems degrade significantly when a directory exceeds ~10k entries.
 *
 * Example: hash "a1b2c3d4..." → ".gitinit/objects/a1/b2c3d4..."
 */
export function objectPath(rootPath: string, hash: string): string {
  return join(gitDir(rootPath), 'objects', hash.slice(0, 2), hash.slice(2))
}

/**
 * Create a directory and all missing parents. No-ops if it already exists.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

/**
 * Read a file and return its contents, or null if the file does not exist.
 *
 * Only swallows ENOENT. All other errors (permissions, I/O failures) are
 * re-thrown — we don't want to silently hide real problems.
 */
export async function readFileMaybe(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return null
    throw err
  }
}

/**
 * Write data to a file, creating all missing parent directories first.
 */
export async function writeFileWithDirs(
  filePath: string,
  data: Buffer | string,
): Promise<void> {
  await ensureDir(dirname(filePath))
  await writeFile(filePath, data)
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
