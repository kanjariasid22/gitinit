import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { gitDir, readFileMaybe, writeFileWithDirs } from '../utils/fs'
import type { FileMode } from '../objects'

export interface IndexEntry {
  readonly hash: string
  readonly mode: FileMode
  /** Modification time in milliseconds — used for change detection */
  readonly mtime: number
  /** File size in bytes — used for change detection alongside mtime */
  readonly size: number
}

/** The full index: a map from repo-relative path to its staged entry. */
export type Index = Record<string, IndexEntry>

export class IndexManager {
  private readonly indexPath: string

  constructor(rootPath: string) {
    this.indexPath = join(gitDir(rootPath), 'index')
  }

  /**
   * Read the index from disk. Returns an empty index if the file does not
   * exist (i.e. nothing has been staged yet).
   */
  async readIndex(): Promise<Index> {
    const data = await readFileMaybe(this.indexPath)
    if (!data) return {}
    return JSON.parse(data.toString('utf8')) as Index
  }

  /**
   * Write the index to disk.
   */
  async writeIndex(index: Index): Promise<void> {
    await writeFileWithDirs(this.indexPath, JSON.stringify(index, null, 2))
  }

  /**
   * Stage a file: add or update its entry in the index.
   *
   * Returns the new index — does not mutate the input.
   */
  async stageFile(
    index: Index,
    repoPath: string,
    hash: string,
    mode: FileMode,
    absolutePath: string,
  ): Promise<Index> {
    const fileStat = await stat(absolutePath)
    return {
      ...index,
      [repoPath]: {
        hash,
        mode,
        mtime: fileStat.mtimeMs,
        size: fileStat.size,
      },
    }
  }

  /**
   * Remove a file from the index.
   *
   * Returns the new index — does not mutate the input. No-ops silently if
   * the path is not staged.
   */
  removeFile(index: Index, repoPath: string): Index {
    const { [repoPath]: _removed, ...rest } = index
    return rest
  }

  /**
   * Check whether a file's content is likely unchanged since it was staged,
   * using mtime and size as a fast proxy before rehashing.
   *
   * Real Git uses the same strategy — it only rehashes when stat data changes.
   * This avoids an O(n) hash-everything scan on every status call.
   *
   * Returns true if the file appears unchanged (no need to rehash).
   */
  async isUnchanged(
    entry: IndexEntry,
    absolutePath: string,
  ): Promise<boolean> {
    try {
      const fileStat = await stat(absolutePath)
      return fileStat.mtimeMs === entry.mtime && fileStat.size === entry.size
    } catch {
      // File no longer exists
      return false
    }
  }
}
