import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { gitDir, readFileMaybe, writeFileWithDirs } from '../utils/fs'

const SYMREF_PREFIX = 'ref: '

export class RefStore {
  private readonly gitDirPath: string

  constructor(rootPath: string) {
    this.gitDirPath = gitDir(rootPath)
  }

  // ---------------------------------------------------------------------------
  // HEAD
  // ---------------------------------------------------------------------------

  /**
   * Read HEAD and return its resolved commit hash.
   *
   * In normal state HEAD is a symbolic ref pointing to a branch:
   *   "ref: refs/heads/main"  →  resolve the branch  →  commit hash
   *
   * In detached HEAD state HEAD contains the hash directly:
   *   "a1b2c3d4..."  →  return it as-is
   *
   * Returns null if HEAD does not exist (unborn repo) or if the branch it
   * points to has no commits yet.
   */
  async readHead(): Promise<string | null> {
    const raw = await this.readRef('HEAD')
    if (!raw) return null

    if (raw.startsWith(SYMREF_PREFIX)) {
      const branchRef = raw.slice(SYMREF_PREFIX.length)
      return this.readRef(branchRef)
    }

    return raw
  }

  /**
   * Read HEAD and return the current branch name (e.g. "main"), or null if
   * HEAD is in detached state or the repo is unborn.
   */
  async readHeadBranch(): Promise<string | null> {
    const raw = await this.readRef('HEAD')
    if (!raw || !raw.startsWith(SYMREF_PREFIX)) return null

    const branchRef = raw.slice(SYMREF_PREFIX.length)
    // "refs/heads/main" → "main"
    return branchRef.startsWith('refs/heads/')
      ? branchRef.slice('refs/heads/'.length)
      : null
  }

  /**
   * Point HEAD at a branch (normal state).
   * Writes: "ref: refs/heads/<name>"
   */
  async writeHeadSymbolic(branchName: string): Promise<void> {
    await this.writeRef('HEAD', `${SYMREF_PREFIX}refs/heads/${branchName}`)
  }

  /**
   * Point HEAD directly at a commit hash (detached HEAD state).
   */
  async writeHeadDetached(hash: string): Promise<void> {
    await this.writeRef('HEAD', hash)
  }

  // ---------------------------------------------------------------------------
  // Branches
  // ---------------------------------------------------------------------------

  /**
   * Read the commit hash a branch points to, or null if the branch does not
   * exist.
   */
  async readBranch(name: string): Promise<string | null> {
    return this.readRef(`refs/heads/${name}`)
  }

  /**
   * Advance (or create) a branch to point at the given commit hash.
   */
  async writeBranch(name: string, hash: string): Promise<void> {
    await this.writeRef(`refs/heads/${name}`, hash)
  }

  /**
   * Delete a branch ref file. Throws if the branch does not exist.
   */
  async deleteBranch(name: string): Promise<void> {
    const { unlink } = await import('node:fs/promises')
    const path = join(this.gitDirPath, 'refs', 'heads', name)
    try {
      await unlink(path)
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        throw new Error(`Branch not found: ${name}`)
      }
      throw err
    }
  }

  /**
   * List all local branch names.
   */
  async listBranches(): Promise<string[]> {
    const headsDir = join(this.gitDirPath, 'refs', 'heads')
    try {
      const entries = await readdir(headsDir)
      return entries.sort()
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return []
      throw err
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Read a ref file relative to the git directory and return its trimmed
   * contents, or null if the file does not exist.
   */
  private async readRef(ref: string): Promise<string | null> {
    const data = await readFileMaybe(join(this.gitDirPath, ref))
    return data ? data.toString('utf8').trim() : null
  }

  /**
   * Write a ref file relative to the git directory, creating parent dirs.
   */
  private async writeRef(ref: string, value: string): Promise<void> {
    await writeFileWithDirs(join(this.gitDirPath, ref), value + '\n')
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
